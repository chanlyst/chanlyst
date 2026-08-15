import { env } from "cloudflare:workers";
import { POST as discover } from "../../discover/route";
import { isAuthResponse, requireApiSession } from "../../../lib/auth";
import { timingSafeEqualStrings } from "../../../lib/security-helpers.mjs";

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
  monitoringEnabled: number;
  monitoringSources: string;
};

type Discovered = {
  company?: string;
  domain?: string;
  url?: string;
  description?: string;
  source?: string;
  channelType?: string;
  reason?: string;
  contact?: string;
  email?: string;
  telegram?: string;
  score?: number;
  opportunityType?: string;
  actionType?: string;
  nextAction?: string;
  actionUrl?: string;
  // Carried through from discovery: without these the background agent would
  // store a doubtful channel as an ordinary one, and the grouping the user
  // sees after an interactive search would silently not apply to scheduled runs.
  siteTitle?: string;
  siteDescription?: string;
  relevance?: string;
  relevanceReason?: string;
};

type AgentSchedule = {
  workspaceId: string;
  cadence: "daily" | "weekly";
  maxResults: number;
  sources: string;
};

function bindings() {
  return env as unknown as { DB?: D1Database; AGENT_CRON_SECRET?: string };
}

function nextRun(cadence: "daily" | "weekly") {
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + (cadence === "daily" ? 1 : 7));
  return next.toISOString();
}

function prospectId(productId: string, item: Discovered) {
  return `${productId}:${item.domain || ""}:${item.url || ""}`.toLowerCase();
}

// Source keys the discovery pipeline understands; anything else stored in
// products.monitoring_sources is dropped defensively.
const knownSources = new Set([
  "web",
  "reviews",
  "creators",
  "communities",
  "directories",
  "publishers",
  "local",
]);

// products.monitoring_sources holds a JSON array like the schedule's sources
// column; '' (or anything malformed/empty) means "inherit workspace sources".
function parseMonitoringSources(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .filter((item) => knownSources.has(item))
      .slice(0, 8);
  } catch {
    return [];
  }
}

async function saveProspects(
  db: D1Database,
  workspaceId: string,
  productId: string,
  items: Discovered[],
) {
  if (!items.length) return;
  const now = new Date().toISOString();
  await db.batch(
    items.map((item) =>
      db
        .prepare(
          `INSERT INTO prospects
           (id, product_id, company, domain, url, description, source,
            channel_type, reason, contact, email, telegram, score, status, stage,
            revenue_cents, outcome_note, opportunity_type, action_type,
            next_action, action_url, site_title, site_description, relevance,
            relevance_reason, created_at, updated_at, workspace_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'review', 'discovered',
            0, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             company=excluded.company, description=excluded.description,
             source=excluded.source, channel_type=excluded.channel_type,
             reason=excluded.reason, score=excluded.score,
             opportunity_type=excluded.opportunity_type,
             action_type=excluded.action_type, next_action=excluded.next_action,
             action_url=excluded.action_url,
             site_title=excluded.site_title,
             site_description=excluded.site_description,
             relevance=excluded.relevance,
             relevance_reason=excluded.relevance_reason,
             updated_at=excluded.updated_at
           WHERE prospects.workspace_id=excluded.workspace_id`,
        )
        .bind(
          prospectId(productId, item),
          productId,
          item.company || item.domain || "Opportunity",
          item.domain || "",
          item.url || "",
          item.description || "",
          item.source || "",
          item.channelType || "",
          item.reason || "",
          item.contact || "",
          item.email || "",
          item.telegram || "",
          Math.max(0, Math.min(100, Number(item.score) || 0)),
          item.opportunityType || "partner",
          item.actionType || "propose_partnership",
          String(item.nextAction || "").slice(0, 1000),
          String(item.actionUrl || item.url || "").slice(0, 2000),
          String(item.siteTitle || "").slice(0, 200),
          String(item.siteDescription || "").slice(0, 500),
          item.relevance || "unknown",
          String(item.relevanceReason || "").slice(0, 200),
          now,
          now,
          workspaceId,
        ),
    ),
  );
}

async function runWorkspace(
  request: Request,
  schedule: AgentSchedule,
  isCron: boolean,
) {
  const db = bindings().DB!;
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO agent_runs
       (id, workspace_id, status, products_processed, opportunities_found,
        error, started_at, finished_at)
       VALUES (?, ?, 'running', 0, 0, '', ?, NULL)`,
    )
    .bind(runId, schedule.workspaceId, startedAt)
    .run();
  let productsProcessed = 0;
  let opportunitiesFound = 0;
  try {
    // The workspace schedule covers the 3 most recently updated products
    // (current behavior); products with monitoring enabled are always
    // included on top of that, using their own sources when configured.
    const products = await db
      .prepare(
        `SELECT id, name, website, description, category, audience,
         negative_audience as negativeAudience, geography, languages,
         monetization_model as monetizationModel, paid_offer as paidOffer,
         price_range as priceRange, payment_point as paymentPoint,
         conversion_event as conversionEvent,
         attribution_method as attributionMethod, partner_terms as partnerTerms,
         analysis, monitoring_enabled as monitoringEnabled,
         monitoring_sources as monitoringSources
         FROM products WHERE workspace_id=?1
         AND (monitoring_enabled=1 OR id IN
           (SELECT id FROM products WHERE workspace_id=?1
            ORDER BY updated_at DESC LIMIT 3))
         ORDER BY updated_at DESC`,
      )
      .bind(schedule.workspaceId)
      .all<ProductRow>();
    const sourceList = JSON.parse(schedule.sources || "[]") as string[];
    for (const row of products.results) {
      const monitoringSources = Number(row.monitoringEnabled)
        ? parseMonitoringSources(row.monitoringSources)
        : [];
      const productSources = monitoringSources.length
        ? monitoringSources
        : sourceList;
      // Keep the discovery payload shape unchanged: the monitoring columns
      // are agent-internal and never forwarded.
      const productFields: Partial<ProductRow> = { ...row };
      delete productFields.monitoringEnabled;
      delete productFields.monitoringSources;
      const headers = new Headers({ "Content-Type": "application/json" });
      if (isCron) {
        headers.set("Authorization", `Bearer ${bindings().AGENT_CRON_SECRET}`);
      } else {
        const cookie = request.headers.get("cookie");
        if (cookie) headers.set("Cookie", cookie);
      }
      const response = await discover(
        new Request(new URL("/api/discover", request.url), {
          method: "POST",
          headers,
          body: JSON.stringify({
            workspaceId: schedule.workspaceId,
            sources: productSources,
            product: {
              ...productFields,
              analysis: JSON.parse(row.analysis || "{}"),
            },
          }),
        }),
      );
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error || `discovery_failed_${response.status}`);
      }
      const result = (await response.json()) as { results?: Discovered[] };
      const found = (result.results || []).slice(
        0,
        Math.max(0, schedule.maxResults - opportunitiesFound),
      );
      await saveProspects(db, schedule.workspaceId, row.id, found);
      productsProcessed += 1;
      opportunitiesFound += found.length;
      if (opportunitiesFound >= schedule.maxResults) break;
    }
    const finishedAt = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `UPDATE agent_runs SET status='completed', products_processed=?,
           opportunities_found=?, finished_at=? WHERE id=?`,
        )
        .bind(productsProcessed, opportunitiesFound, finishedAt, runId),
      db
        .prepare(
          `UPDATE agent_schedules SET last_run_at=?, next_run_at=?,
           updated_at=? WHERE workspace_id=?`,
        )
        .bind(
          finishedAt,
          nextRun(schedule.cadence),
          finishedAt,
          schedule.workspaceId,
        ),
    ]);
    return { runId, productsProcessed, opportunitiesFound };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "agent_failed";
    await db
      .prepare(
        `UPDATE agent_runs SET status='failed', products_processed=?,
         opportunities_found=?, error=?, finished_at=? WHERE id=?`,
      )
      .bind(
        productsProcessed,
        opportunitiesFound,
        message.slice(0, 500),
        finishedAt,
        runId,
      )
      .run();
    throw error;
  }
}

export async function POST(request: Request) {
  const db = bindings().DB;
  if (!db) return Response.json({ error: "database_unavailable" }, { status: 503 });
  const authorization = request.headers.get("authorization") || "";
  const isCron =
    Boolean(bindings().AGENT_CRON_SECRET) &&
    (await timingSafeEqualStrings(
      authorization,
      `Bearer ${bindings().AGENT_CRON_SECRET}`,
    ));

  let schedule: AgentSchedule;
  if (isCron) {
    const due = await db
      .prepare(
        `SELECT workspace_id as workspaceId, cadence,
         max_results as maxResults, sources FROM agent_schedules
         WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at ASC LIMIT 1`,
      )
      .bind(new Date().toISOString())
      .first<AgentSchedule>();
    if (!due) return Response.json({ ok: true, due: false });
    schedule = due;
  } else {
    const auth = await requireApiSession(request);
    if (isAuthResponse(auth)) return auth;
    const saved = await db
      .prepare(
        `SELECT workspace_id as workspaceId, cadence,
         max_results as maxResults, sources
         FROM agent_schedules WHERE workspace_id=?`,
      )
      .bind(auth.workspaceId)
      .first<AgentSchedule>();
    schedule = saved || {
      workspaceId: auth.workspaceId,
      cadence: "weekly",
      maxResults: 12,
      sources: '["web","reviews","creators","communities"]',
    };
  }

  try {
    return Response.json({
      ok: true,
      due: true,
      ...(await runWorkspace(request, schedule, isCron)),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "agent_failed" },
      { status: 500 },
    );
  }
}
