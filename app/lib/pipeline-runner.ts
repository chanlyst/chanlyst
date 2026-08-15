import { env } from "cloudflare:workers";
import { workspaceContentLocale } from "./workspace-locale";
import { runAnalysis } from "./analysis-core";
import { discoverContactBatch } from "./contact-discovery";
import {
  type DiscoveryProduct,
} from "./discovery-core";
import {
  MAX_BATCH_DISCOVERY_RESULTS,
  runBroadDiscovery,
} from "./discovery-batch";
import {
  applyQuotaTrim,
  formatDiscoverySummary,
} from "./discovery-audit.mjs";
import {
  prospectContextQuery,
  runEnrichment,
  type ProspectContext,
} from "./enrichment-core";
import { draftOutreach } from "./outreach-core";
import { createSequenceDraft } from "./sequence-core";
import { saveProspects } from "./prospect-store";
import { enforceUsageLimit } from "./usage-limits";
import { resolveOutreachLocale } from "./outreach-language";
import {
  advancePipeline,
  buildPipelineSequenceSteps,
  emptyPipelineCounts,
  firstPipelineStep,
  pipelineScope,
  fillTemplateVariables,
  hasUsableAnalysis,
  parsePipelineCounts,
  pipelineMaxEnrich,
  pipelineMaxSequences,
  pipelineContactQueryMax,
  pipelineContactTarget,
  selectEnrichmentTargets,
  selectSequenceTargets,
} from "./pipeline-core.mjs";

// The "prepare everything for me" runner.
//
// Every invocation advances ONE slice of ONE run: a whole step for the cheap
// bookkeeping ones, a single channel for the expensive ones (enrichment and
// draft generation). The row is persisted after each slice, so a run survives
// restarts and a slow site can never stall the rest of the work.
//
// Nothing here sends anything. The drafts step writes outbound messages with
// status 'queued' and sequences with status 'draft'; both wait for a click.

export type PipelineRunRow = {
  id: string;
  workspaceId: string;
  productId: string;
  status: string;
  step: string;
  attempts: number;
  counts: string;
  error: string;
  errorCode: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  /** Which list of steps this run performs: the full preparation, or discovery. */
  scope?: string;
};

export type PipelineCounts = ReturnType<typeof emptyPipelineCounts>;

export type PipelineRunView = {
  id: string;
  productId: string;
  status: string;
  step: string;
  counts: PipelineCounts;
  error: string;
  errorCode: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  /** Which list of steps the run performs. */
  scope: "full" | "discovery";
};

type ProductRow = {
  id: string;
  name: string;
  website: string;
  description: string;
  category: string;
  audience: string;
  negativeAudience: string;
  geography: string;
  languages: string;
  monetizationModel: string;
  paidOffer: string;
  priceRange: string;
  paymentPoint: string;
  conversionEvent: string;
  attributionMethod: string;
  partnerTerms: string;
  analysis: string;
  monitoringSources: string;
};

type ChannelRow = {
  id: string;
  company: string;
  domain: string;
  url: string;
  description: string;
  channelType: string;
  reason: string;
  contact: string;
  email: string;
  score: number;
  status: string;
  contactStatus: string;
  outreachEligible: number;
  // Everything contactRouteForLead needs to tell `direct` from `network`
  // and `none`, so the enrichment and draft steps can skip the two routes
  // that have no outreach path.
  telegram: string;
  linkedin: string;
  contactEvidence: string;
  opportunityType: string;
  actionType: string;
};

const runColumns = `id, workspace_id as workspaceId, product_id as productId,
   status, step, attempts, counts, error, error_code as errorCode,
   started_at as startedAt, updated_at as updatedAt,
   finished_at as finishedAt, scope`;

const defaultSources = ["web", "reviews", "creators", "communities"];
const knownSources = new Set([
  "web",
  "reviews",
  "creators",
  "communities",
  "directories",
  "publishers",
  "local",
]);

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

/**
 * The language a background run writes its channel text in. There is no
 * interface to ask, so the workspace's digest language is used: it is the one
 * place the user has already stated which language they want to be written to
 * in. Absent that, Russian, which is what every run produced before.
 */
/**
 * The language this workspace's generated text is written in.
 *
 * It used to read digest_settings — the language of the weekly e-mail — and
 * fall back to Russian three times over when that row did not exist, which it
 * usually does not. The workspace has owned this since 13 August; the pipeline
 * was still asking the wrong table, so an English account whose runs moved to
 * the background started getting Russian channels again.
 */
async function workspaceLocale(workspaceId: string) {
  return workspaceContentLocale(workspaceId);
}

function bindings() {
  return env as unknown as Record<string, unknown>;
}

export function pipelineCaps() {
  return {
    maxEnrich: pipelineMaxEnrich(bindings()),
    maxSequences: pipelineMaxSequences(bindings()),
    contactTarget: pipelineContactTarget(bindings()),
    contactQueryMax: pipelineContactQueryMax(bindings()),
  };
}

export function toRunView(row: PipelineRunRow): PipelineRunView {
  return {
    id: row.id,
    productId: row.productId,
    status: row.status,
    step: row.step,
    counts: parsePipelineCounts(row.counts),
    error: row.error || "",
    errorCode: row.errorCode || "",
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
    scope: pipelineScope(row.scope),
  };
}

export async function loadRun(workspaceId: string, id: string) {
  return database()!
    .prepare(
      `SELECT ${runColumns} FROM pipeline_runs WHERE id=? AND workspace_id=?`,
    )
    .bind(id, workspaceId)
    .first<PipelineRunRow>();
}

/** The current or most recent run for one product. */
export async function latestRunForProduct(
  workspaceId: string,
  productId: string,
) {
  return database()!
    .prepare(
      `SELECT ${runColumns} FROM pipeline_runs
       WHERE workspace_id=? AND product_id=?
       ORDER BY started_at DESC LIMIT 1`,
    )
    .bind(workspaceId, productId)
    .first<PipelineRunRow>();
}

export async function activeRunForProduct(
  workspaceId: string,
  productId: string,
) {
  return database()!
    .prepare(
      `SELECT ${runColumns} FROM pipeline_runs
       WHERE workspace_id=? AND product_id=?
         AND status IN ('queued', 'running', 'paused')
       ORDER BY started_at DESC LIMIT 1`,
    )
    .bind(workspaceId, productId)
    .first<PipelineRunRow>();
}

export async function createRun(
  workspaceId: string,
  productId: string,
  scope: "full" | "discovery" = "full",
) {
  const db = database()!;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO pipeline_runs
       (id, workspace_id, product_id, status, step, attempts, counts, error,
        error_code, started_at, updated_at, finished_at, scope)
       VALUES (?, ?, ?, 'queued', ?, 0, ?, '', '', ?, ?, NULL, ?)`,
    )
    .bind(
      id,
      workspaceId,
      productId,
      firstPipelineStep(scope),
      JSON.stringify(emptyPipelineCounts()),
      now,
      now,
      scope,
    )
    .run();
  return (await loadRun(workspaceId, id))!;
}

async function persist(
  run: PipelineRunRow,
  state: {
    status: string;
    step: string;
    attempts: number;
    error?: string;
    errorCode?: string;
    finished?: boolean;
  },
  counts: PipelineCounts,
) {
  const now = new Date().toISOString();
  await database()!
    .prepare(
      `UPDATE pipeline_runs SET status=?, step=?, attempts=?, counts=?,
       error=?, error_code=?, updated_at=?,
       finished_at=CASE WHEN ?=1 THEN ? ELSE finished_at END
       WHERE id=? AND workspace_id=?`,
    )
    .bind(
      state.status,
      state.step,
      state.attempts,
      JSON.stringify(counts),
      String(state.error || "").slice(0, 500),
      String(state.errorCode || "").slice(0, 100),
      now,
      state.finished ? 1 : 0,
      now,
      run.id,
      run.workspaceId,
    )
    .run();
  return {
    ...run,
    status: state.status,
    step: state.step,
    attempts: state.attempts,
    counts: JSON.stringify(counts),
    error: String(state.error || ""),
    errorCode: String(state.errorCode || ""),
    updatedAt: now,
    finishedAt: state.finished ? now : run.finishedAt,
  };
}

async function loadProduct(workspaceId: string, productId: string) {
  return database()!
    .prepare(
      `SELECT id, name, website, description, category, audience,
       negative_audience as negativeAudience, geography, languages,
       monetization_model as monetizationModel, paid_offer as paidOffer,
       price_range as priceRange, payment_point as paymentPoint,
       conversion_event as conversionEvent,
       attribution_method as attributionMethod, partner_terms as partnerTerms,
       analysis, monitoring_sources as monitoringSources
       FROM products WHERE id=? AND workspace_id=?`,
    )
    .bind(productId, workspaceId)
    .first<ProductRow>();
}

function productForAi(row: ProductRow): DiscoveryProduct {
  const { analysis, monitoringSources: _sources, ...rest } = row;
  void _sources;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(analysis || "{}") as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return { ...rest, analysis: parsed };
}

function productSources(row: ProductRow) {
  try {
    const parsed = JSON.parse(row.monitoringSources || "[]") as unknown;
    if (!Array.isArray(parsed)) return defaultSources;
    const picked = parsed
      .filter((item): item is string => typeof item === "string")
      .filter((item) => knownSources.has(item))
      .slice(0, 8);
    return picked.length ? picked : defaultSources;
  } catch {
    return defaultSources;
  }
}

/** Outreach-relevant channels of the product, richest first. */
async function loadChannels(workspaceId: string, productId: string) {
  const result = await database()!
    .prepare(
      `SELECT id, company, domain, url, description,
       channel_type as channelType, reason, contact, email, score, status,
       contact_status as contactStatus, outreach_eligible as outreachEligible,
       telegram, linkedin, contact_evidence as contactEvidence,
       opportunity_type as opportunityType, action_type as actionType
       FROM prospects WHERE workspace_id=? AND product_id=?
         AND record_kind='channel'
       ORDER BY score DESC LIMIT 200`,
    )
    .bind(workspaceId, productId)
    .all<ChannelRow>();
  return result.results || [];
}

/** Concrete organisations/recipients, separate from strategic channels. */
async function loadContacts(workspaceId: string, productId: string) {
  const result = await database()!
    .prepare(
      `SELECT id, company, domain, url, description,
       channel_type as channelType, reason, contact, email, score, status,
       contact_status as contactStatus, outreach_eligible as outreachEligible,
       telegram, linkedin, contact_evidence as contactEvidence,
       opportunity_type as opportunityType, action_type as actionType
       FROM prospects WHERE workspace_id=? AND product_id=?
         AND record_kind='contact'
       ORDER BY score DESC LIMIT 1200`,
    )
    .bind(workspaceId, productId)
    .all<ChannelRow>();
  return result.results || [];
}

/** Steps -------------------------------------------------------------- */

type SliceEvent =
  | { type: "progress" }
  | { type: "stepDone" }
  | { type: "failure"; code: string; message?: string };

async function stepAnalyze(
  run: PipelineRunRow,
  counts: PipelineCounts,
): Promise<SliceEvent> {
  const product = await loadProduct(run.workspaceId, run.productId);
  if (!product) {
    return { type: "failure", code: "product_not_found", message: "Продукт не найден." };
  }
  let stored: unknown = {};
  try {
    stored = JSON.parse(product.analysis || "{}");
  } catch {
    stored = {};
  }
  // Already analysed: skip the step entirely, so re-running the pipeline
  // costs nothing here.
  if (hasUsableAnalysis(stored as { summary?: string })) return { type: "stepDone" };

  const quota = await enforceUsageLimit(run.workspaceId, "aiMessages");
  if (!quota.allowed) {
    return {
      type: "failure",
      code: "plan_limit_reached",
      message: "Месячный лимит AI-запросов исчерпан.",
    };
  }
  const outcome = await runAnalysis(
    { ...productForAi(product), id: product.id, locale: "ru" },
    { workspaceId: run.workspaceId },
  );
  if (!outcome.ok) {
    return { type: "failure", code: outcome.error, message: outcome.error };
  }
  const analysis = outcome.analysis as {
    category?: string;
    audience?: string;
    negativeAudience?: string;
  };
  const now = new Date().toISOString();
  await database()!
    .prepare(
      `UPDATE products SET analysis=?, category=?, audience=?,
       negative_audience=?, updated_at=? WHERE id=? AND workspace_id=?`,
    )
    .bind(
      JSON.stringify(analysis),
      analysis.category || product.category,
      analysis.audience || product.audience,
      analysis.negativeAudience || product.negativeAudience,
      now,
      product.id,
      run.workspaceId,
    )
    .run();
  void counts;
  return { type: "stepDone" };
}

async function stepDiscover(
  run: PipelineRunRow,
  counts: PipelineCounts,
): Promise<SliceEvent> {
  const product = await loadProduct(run.workspaceId, run.productId);
  if (!product) {
    return { type: "failure", code: "product_not_found", message: "Продукт не найден." };
  }
  const quota = await enforceUsageLimit(run.workspaceId, "channels", {
    count: MAX_BATCH_DISCOVERY_RESULTS,
  });
  if (!quota.allowed && quota.remaining <= 0) {
    return {
      type: "failure",
      code: "plan_limit_reached",
      message: "Месячный лимит найденных каналов исчерпан.",
    };
  }
  const outcome = await runBroadDiscovery({
    workspaceId: run.workspaceId,
    product: productForAi(product),
    selectedSources: productSources(product),
    locale: await workspaceLocale(run.workspaceId),
  });
  if (!outcome.ok) {
    return { type: "failure", code: outcome.error, message: outcome.error };
  }
  // Same accounting as the interactive route: the quota is a drop rule too.
  const summary = outcome.mode === "live" ? outcome.summary : undefined;
  const dropped = outcome.mode === "live" ? outcome.dropped : undefined;
  const trimmed = applyQuotaTrim({
    results: outcome.results,
    summary:
      summary || {
        modelReturned: outcome.results.length,
        returned: outcome.results.length,
        dropped: 0,
        reasons: { ...(dropped || {}) },
      },
    limit: quota.remaining,
  });
  if (trimmed.summary.reasons.quota_trim) {
    console.info(
      formatDiscoverySummary(trimmed.summary, {
        workspace: run.workspaceId,
        product: run.productId,
        stage: "after_quota",
      }),
    );
  }
  const found = trimmed.results;
  if (found.length) {
    await saveProspects(run.workspaceId, run.productId, found);
    counts.channelsFound += found.length;
  }
  return { type: "stepDone" };
}

async function stepEnrich(
  run: PipelineRunRow,
  counts: PipelineCounts,
): Promise<SliceEvent> {
  const { maxEnrich } = pipelineCaps();
  if (maxEnrich <= 0) return { type: "stepDone" };
  const [contacts, channels] = await Promise.all([
    loadContacts(run.workspaceId, run.productId),
    loadChannels(run.workspaceId, run.productId),
  ]);
  const targets = selectEnrichmentTargets([...contacts, ...channels], {
    cap: maxEnrich,
    alreadyEnriched: counts.contactsChecked,
  });
  if (!targets.length) return { type: "stepDone" };

  const quota = await enforceUsageLimit(run.workspaceId, "contactChecks");
  if (!quota.allowed) {
    return {
      type: "failure",
      code: "plan_limit_reached",
      message: "Месячный лимит AI-запросов исчерпан.",
    };
  }
  const prospect = await database()!
    .prepare(prospectContextQuery)
    .bind(targets[0].id, run.workspaceId, run.workspaceId)
    .first<ProspectContext>();
  if (!prospect) {
    // The row vanished between the two queries; count the slot as spent so
    // the loop cannot spin on it.
    counts.contactsChecked += 1;
    return { type: "progress" };
  }
  const outcome = await runEnrichment(prospect, { workspaceId: run.workspaceId });
  counts.contactsChecked += 1;
  if (!outcome.ok) {
    return { type: "failure", code: outcome.error, message: outcome.error };
  }
  if (outcome.email) counts.contactsFound += 1;
  return { type: "progress" };
}

async function stepExpand(
  run: PipelineRunRow,
  counts: PipelineCounts,
): Promise<SliceEvent> {
  const product = await loadProduct(run.workspaceId, run.productId);
  if (!product) {
    return { type: "failure", code: "product_not_found", message: "Продукт не найден." };
  }
  const { contactTarget, contactQueryMax } = pipelineCaps();
  if (
    counts.contactsDiscovered >= contactTarget ||
    counts.contactQueries >= contactQueryMax
  ) {
    return { type: "stepDone" };
  }
  const batch = await discoverContactBatch({
    workspaceId: run.workspaceId,
    product: productForAi(product),
    queryIndex: counts.contactQueries,
    locale: await workspaceLocale(run.workspaceId),
  });
  if (!batch.ok) {
    return { type: "failure", code: batch.error, message: batch.error };
  }
  counts.contactQueries += 1;
  counts.contactsDiscovered += batch.stored;
  counts.contactsVerified += batch.verified;
  counts.contactsFound += batch.verified;
  return { type: "progress" };
}

/** The starter template the pipeline leaves behind for the product. */
function starterTemplate(productName: string, locale: "ru" | "en") {
  if (locale === "en") {
    return {
      name: `${productName} · outreach`.slice(0, 120),
      subject: "Partnership idea for {{company}}",
      body: `Hello {{contact}},

I looked at {{company}} and think {{product}} is a fit for your audience.

We can start with a small, measurable test and attribute the result to confirmed paid conversions.

May I send a short placement draft and a test link?`,
    };
  }
  return {
    name: `${productName} · аутрич`.slice(0, 120),
    subject: "Идея сотрудничества для {{company}}",
    body: `Здравствуйте, {{contact}}!

Я изучил {{company}} и вижу, что {{product}} подходит вашей аудитории.

Предлагаю начать с небольшого теста с измеримым результатом по подтверждённым оплатам.

Могу прислать короткий вариант размещения и тестовую ссылку?`,
  };
}

async function stepDrafts(
  run: PipelineRunRow,
  counts: PipelineCounts,
): Promise<SliceEvent> {
  const db = database()!;
  const product = await loadProduct(run.workspaceId, run.productId);
  if (!product) {
    return { type: "failure", code: "product_not_found", message: "Продукт не найден." };
  }
  const locale = resolveOutreachLocale(productForAi(product), "ru");

  // Slice 1: leave the workspace with a reusable outreach template.
  const template = await db
    .prepare(
      `SELECT id FROM outreach_templates
       WHERE workspace_id=? AND archived=0 AND channel='email' LIMIT 1`,
    )
    .bind(run.workspaceId)
    .first<{ id: string }>();
  if (!template) {
    const starter = starterTemplate(product.name || "Chanlyst", locale);
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO outreach_templates
         (id, workspace_id, name, channel, engagement_mode, locale, subject,
          body, archived, created_at, updated_at)
         VALUES (?, ?, ?, 'email', 'outreach', ?, ?, ?, 0, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        run.workspaceId,
        starter.name,
        locale,
        starter.subject,
        starter.body,
        now,
        now,
      )
      .run();
    counts.templatesCreated += 1;
    return { type: "progress" };
  }

  // Slice 2..n: one qualified channel per invocation.
  const { maxSequences } = pipelineCaps();
  const [contacts, channels] = await Promise.all([
    loadContacts(run.workspaceId, run.productId),
    loadChannels(run.workspaceId, run.productId),
  ]);
  const recipients = [...contacts, ...channels];
  const targets = selectSequenceTargets(recipients, { cap: maxSequences });
  if (!targets.length) return { type: "stepDone" };

  const prepared = await db
    .prepare(
      `SELECT lead_id as leadId FROM outreach_sequences
       WHERE workspace_id=? AND product_id=?`,
    )
    .bind(run.workspaceId, run.productId)
    .all<{ leadId: string }>();
  const done = new Set((prepared.results || []).map((row) => row.leadId));
  const target = targets.find((item) => !done.has(item.id));
  if (!target) return { type: "stepDone" };

  const channel = recipients.find((item) => item.id === target.id)!;
  const quota = await enforceUsageLimit(run.workspaceId, "aiMessages");
  if (!quota.allowed) {
    return {
      type: "failure",
      code: "plan_limit_reached",
      message: "Месячный лимит AI-запросов исчерпан.",
    };
  }
  const generated = await draftOutreach(
    {
      product: productForAi(product),
      lead: {
        company: channel.company,
        description: channel.description,
        channelType: channel.channelType,
        reason: channel.reason,
        contact: channel.contact,
        url: channel.url,
      },
      channel: "email",
      locale,
    },
    { workspaceId: run.workspaceId },
  );
  // No copy model configured is a setup gap, not a run failure: fall back to
  // the workspace's own starter template so the user still gets a reviewable
  // draft instead of an empty queue.
  const fallback = starterTemplate(product.name || "Chanlyst", locale);
  const vars = {
    company: channel.company || "",
    contact: (channel.contact || "").split(" ")[0] || "",
    product: product.name || "",
    url: channel.url || "",
  };
  const copy =
    generated.ok
      ? generated
      : generated.error === "outreach_not_configured"
        ? {
            ok: true as const,
            subject: fillTemplateVariables(fallback.subject, vars),
            body: fillTemplateVariables(fallback.body, vars),
            locale,
          }
        : generated;
  if (!copy.ok) {
    return { type: "failure", code: copy.error, message: copy.error };
  }

  // The prepared message waits in the queue: status 'queued', never 'sent'.
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO outbound_messages
       (id, product_id, lead_id, company, channel, subject, body, template_id,
        status, created_at, workspace_id)
       VALUES (?, ?, ?, ?, 'email', ?, ?, '', 'queued', ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      run.productId,
      channel.id,
      channel.company,
      copy.subject,
      copy.body,
      now,
      run.workspaceId,
    )
    .run();
  counts.messagesCreated += 1;

  const sequence = await createSequenceDraft({
    workspaceId: run.workspaceId,
    productId: run.productId,
    leadId: channel.id,
    name: `${channel.company} · 3 email`,
    steps: buildPipelineSequenceSteps({
      subject: copy.subject,
      body: copy.body,
      locale: copy.locale,
    }),
    gate: "qualified",
  });
  if (sequence.ok) counts.sequencesCreated += 1;
  // A rejected draft (suppressed recipient, e-mail lost a race) is not a run
  // failure: the queued message is still there for the user.
  return { type: "progress" };
}

/**
 * Advances one run by exactly one slice and returns the persisted row.
 * A run that is not advanceable is returned untouched.
 */
export async function advanceRun(row: PipelineRunRow): Promise<PipelineRunRow> {
  if (!["queued", "running"].includes(row.status)) return row;
  const counts = parsePipelineCounts(row.counts);
  let run = row;
  if (run.status === "queued") {
    const started = advancePipeline(run, { type: "start" });
    run = await persist(run, started, counts);
  }
  if (run.step === "done") {
    return persist(run, advancePipeline(run, { type: "stepDone" }), counts);
  }

  let event: SliceEvent;
  try {
    if (run.step === "analyze") event = await stepAnalyze(run, counts);
    else if (run.step === "discover") event = await stepDiscover(run, counts);
    else if (run.step === "expand") event = await stepExpand(run, counts);
    else if (run.step === "enrich") event = await stepEnrich(run, counts);
    else if (run.step === "drafts") event = await stepDrafts(run, counts);
    else event = { type: "stepDone" };
  } catch (error) {
    event = {
      type: "failure",
      code: "pipeline_failed",
      message: error instanceof Error ? error.message : "pipeline_failed",
    };
  }
  return persist(run, advancePipeline(run, event), counts);
}

/** Resumes a paused run (the "top up your credits and continue" path). */
export async function resumeRun(row: PipelineRunRow) {
  if (row.status !== "paused") return row;
  return persist(
    row,
    advancePipeline(row, { type: "resume" }),
    parsePipelineCounts(row.counts),
  );
}

/** How long a run is left alone after its last slice (seconds). */
const cronQuietPeriodSeconds = 60;

/**
 * Runs waiting for a slice, oldest first, across all workspaces.
 *
 * A run the user is actively driving from an open dashboard tab updates every
 * few seconds; skipping recently-touched rows keeps the cron from running a
 * second slice concurrently and paying for it twice.
 */
export async function pendingRuns(limit: number) {
  const quiet = new Date(
    Date.now() - cronQuietPeriodSeconds * 1000,
  ).toISOString();
  const result = await database()!
    .prepare(
      `SELECT ${runColumns} FROM pipeline_runs
       WHERE status IN ('queued', 'running') AND updated_at<=?
       ORDER BY updated_at ASC LIMIT ?`,
    )
    .bind(quiet, limit)
    .all<PipelineRunRow>();
  return result.results || [];
}
