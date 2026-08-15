import { env } from "cloudflare:workers";
import { cookieValue, randomToken, sha256 } from "./auth";
import {
  type DiscoveryProduct,
  type DiscoveryResult,
} from "./discovery-core";
import { MAX_BATCH_DISCOVERY_RESULTS, runBroadDiscovery } from "./discovery-batch";
import { saveProspects } from "./prospect-store";
import { fetchPublic } from "./fetch-public";
import { clientIpFromHeaders, safePublicUrl } from "./security-helpers.mjs";
import { IDENTITY_SCAN_CHARS, parseSiteIdentity } from "./site-identity.mjs";
import { usageSnapshot } from "./usage-limits";

export const PUBLIC_PREVIEW_COOKIE = "chanlyst_preview";
export const PUBLIC_PREVIEW_VISIBLE_RESULTS = 5;
const PREVIEW_TTL_MS = 48 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_IP_LIMIT = 3;
const DEFAULT_GLOBAL_COST_LIMIT_MICROUSD = 25_000_000;
// Each request runs two provider calls at a time. Two public requests keep the
// real provider concurrency bounded at four instead of multiplying it to 16.
const DEFAULT_CONCURRENT_LIMIT = 2;

const choiceCopy = {
  audience: {
    founders: {
      en: "Founders and small teams",
      ru: "Основатели и небольшие команды",
    },
    growth_teams: {
      en: "Marketing and growth teams",
      ru: "Команды маркетинга и роста",
    },
    mid_market: { en: "Mid-market companies", ru: "Средний бизнес" },
  },
  goal: {
    early_users: { en: "Get early users", ru: "Получить первых пользователей" },
    qualified_leads: {
      en: "Generate qualified leads",
      ru: "Получать целевые лиды",
    },
    partnerships: { en: "Build partnerships", ru: "Найти партнёров" },
  },
  geography: {
    worldwide: { en: "Worldwide (English-speaking markets)", ru: "По всему миру" },
    north_america: {
      en: "United States and Canada",
      ru: "США и Канада",
    },
    europe: { en: "Europe (UK and EU)", ru: "Европа" },
  },
} as const;

type AudienceId = keyof typeof choiceCopy.audience;
type GoalId = keyof typeof choiceCopy.goal;
type GeographyId = keyof typeof choiceCopy.geography;

export type PublicPreviewInput = {
  website?: string;
  locale?: "ru" | "en";
  audience?: AudienceId;
  goal?: GoalId;
  geography?: GeographyId;
};

type NormalizedPreviewInput = {
  website: string;
  locale: "ru" | "en";
  audience: AudienceId;
  goal: GoalId;
  geography: GeographyId;
  audienceLabel: string;
  goalLabel: string;
  geographyLabel: string;
};

type PreviewAnalysis = {
  name: string;
  summary: string;
  category: string;
  audience: string;
  negativeAudience: string;
  offer: string;
  channelTypes: string[];
  searchQueries: string[];
  competitors: Array<{ name: string; domain: string; confirmed?: boolean }>;
  acquisitionMotions: unknown[];
};

type PreviewRow = {
  id: string;
  tokenHash?: string;
  inputHash?: string;
  inputJson?: string;
  analysisJson?: string;
  resultsJson?: string;
  resultCount?: number;
  status?: string;
  workspaceId?: string;
  productId?: string;
  expiresAt?: string;
};

export type PublicPreviewChannel = {
  name: string;
  domain: string;
  reason: string;
  score: number;
  action: string;
  actionUrl: string;
  engagementMode: DiscoveryResult["engagementMode"];
};

export type PublicPreviewPayload = {
  mode: "live";
  analysis: {
    audience: string;
    goal: string;
    geography: string;
    summary: string;
  };
  results: PublicPreviewChannel[];
  total: number;
};

export type PublicPreviewOutcome =
  | { ok: true; payload: PublicPreviewPayload; cookie?: string }
  | {
      ok: false;
      error:
        | "invalid_request"
        | "database_unavailable"
        | "preview_limit_reached"
        | "preview_busy"
        | "preview_budget_reached"
        | "analysis_unavailable"
        | "ai_credits_exhausted"
        | "openrouter_request_failed"
        | "discovery_format_invalid"
        | "no_channels_found";
      status: number;
    };

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function label<
  K extends "audience" | "goal" | "geography",
  I extends keyof (typeof choiceCopy)[K],
>(kind: K, id: I, locale: "ru" | "en") {
  const value = choiceCopy[kind][id] as { ru: string; en: string };
  return value[locale];
}

export function normalizePublicPreviewInput(
  payload: PublicPreviewInput,
): NormalizedPreviewInput | null {
  const safeUrl = safePublicUrl(payload.website || "");
  if (
    !safeUrl ||
    safeUrl.username ||
    safeUrl.password ||
    safeUrl.toString().length > 2048 ||
    !safeUrl.hostname.includes(".")
  ) {
    return null;
  }
  const locale = payload.locale === "ru" ? "ru" : "en";
  const audience = Object.hasOwn(choiceCopy.audience, payload.audience || "")
    ? (payload.audience as AudienceId)
    : null;
  const goal = Object.hasOwn(choiceCopy.goal, payload.goal || "")
    ? (payload.goal as GoalId)
    : null;
  const geography = Object.hasOwn(
    choiceCopy.geography,
    payload.geography || "",
  )
    ? (payload.geography as GeographyId)
    : null;
  if (!audience || !goal || !geography) return null;
  safeUrl.hash = "";
  return {
    website: safeUrl.toString(),
    locale,
    audience,
    goal,
    geography,
    audienceLabel: label("audience", audience, locale),
    goalLabel: label("goal", goal, locale),
    geographyLabel: label("geography", geography, locale),
  };
}

function previewCookie(token: string, request: Request) {
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const secure =
    forwardedProtocol === "https" || new URL(request.url).protocol === "https:"
      ? "; Secure"
      : "";
  return `${PUBLIC_PREVIEW_COOKIE}=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${Math.round(PREVIEW_TTL_MS / 1000)}`;
}

function actionLabel(item: DiscoveryResult, locale: "ru" | "en") {
  if (item.engagementMode === "free_listing") {
    return locale === "ru" ? "Подать бесплатно" : "Submit free";
  }
  if (item.engagementMode === "paid_placement") {
    return locale === "ru" ? "Узнать условия" : "View terms";
  }
  return locale === "ru" ? "Связаться" : "Contact";
}

export function publicPayload(
  input: NormalizedPreviewInput,
  analysis: PreviewAnalysis,
  results: DiscoveryResult[],
): PublicPreviewPayload {
  return {
    mode: "live",
    analysis: {
      audience: input.audienceLabel,
      goal: input.goalLabel,
      geography: input.geographyLabel,
      summary: analysis.summary,
    },
    // This slice is the product boundary, not only a visual choice. Hidden
    // results never cross the network before the preview is claimed.
    results: results.slice(0, PUBLIC_PREVIEW_VISIBLE_RESULTS).map((item) => ({
      name: item.company,
      domain: item.domain,
      reason: item.reason,
      score: Math.max(0, Math.min(100, Math.round(Number(item.score) || 0))),
      action: actionLabel(item, input.locale),
      actionUrl: item.actionUrl || item.registrationUrl || item.url,
      engagementMode: item.engagementMode,
    })),
    total: results.length,
  };
}

function focusMotion(goal: GoalId) {
  if (goal === "partnerships") return "partnerships";
  if (goal === "early_users") return "directories";
  return "direct_sales";
}

/** How long the visitor's own site gets to describe itself before we search. */
const PREVIEW_IDENTITY_TIMEOUT_MS = 6_000;

/**
 * The visitor's site, in its own words: <title> and the meta description.
 *
 * Everything about a preview run is generic except this. It goes through the
 * shared public fetcher, so every redirect hop is re-validated against
 * safePublicUrl and a URL pointing at internal address space never leaves the
 * worker. A site that is slow, blocked or unparseable simply yields nothing
 * and the run falls back to the domain.
 */
async function readSiteIdentity(website: string) {
  const target = safePublicUrl(website);
  if (!target) return { title: "", description: "" };
  try {
    const fetched = await Promise.race([
      fetchPublic(target, { userAgent: "Chanlyst Channel Research/1.0" }),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), PREVIEW_IDENTITY_TIMEOUT_MS),
      ),
    ]);
    if (!fetched) return { title: "", description: "" };
    const html = (await fetched.response.text()).slice(0, IDENTITY_SCAN_CHARS);
    const identity = parseSiteIdentity(html);
    return { title: identity.title || "", description: identity.description || "" };
  } catch {
    return { title: "", description: "" };
  }
}

function usageCostMicrousd(usages: Array<{ cost?: number }> | undefined) {
  return Math.max(
    0,
    Math.round(
      (usages || []).reduce((sum, usage) => sum + Math.max(0, usage.cost || 0), 0) *
        1_000_000,
    ),
  );
}

async function cachedPreview(
  db: D1Database,
  request: Request,
  input: NormalizedPreviewInput,
  inputHash: string,
) {
  const token = cookieValue(
    request.headers.get("cookie"),
    PUBLIC_PREVIEW_COOKIE,
  );
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT id, input_json as inputJson, analysis_json as analysisJson,
       results_json as resultsJson, status, expires_at as expiresAt
       FROM public_previews WHERE token_hash=? AND input_hash=?
       AND status IN ('completed','claimed') AND expires_at>?`,
    )
    .bind(await sha256(token), inputHash, new Date().toISOString())
    .first<PreviewRow>();
  if (!row) return null;
  try {
    return publicPayload(
      input,
      JSON.parse(row.analysisJson || "{}") as PreviewAnalysis,
      JSON.parse(row.resultsJson || "[]") as DiscoveryResult[],
    );
  } catch {
    return null;
  }
}

export async function runPublicPreview(
  request: Request,
  raw: PublicPreviewInput,
): Promise<PublicPreviewOutcome> {
  const input = normalizePublicPreviewInput(raw);
  if (!input) return { ok: false, error: "invalid_request", status: 400 };
  const db = database();
  if (!db) return { ok: false, error: "database_unavailable", status: 503 };
  const bindings = env as unknown as {
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;
    INTEGRATION_ENCRYPTION_KEY?: string;
    PUBLIC_PREVIEW_IP_LIMIT?: string;
    PUBLIC_PREVIEW_GLOBAL_DAILY_COST_USD?: string;
    PUBLIC_PREVIEW_CONCURRENT_LIMIT?: string;
  };
  if (!bindings.OPENROUTER_API_KEY) {
    return { ok: false, error: "analysis_unavailable", status: 503 };
  }
  const canonicalInput = JSON.stringify(input);
  const inputHash = await sha256(canonicalInput);
  const cached = await cachedPreview(db, request, input, inputHash);
  if (cached) return { ok: true, payload: cached };

  const now = new Date();
  const since = new Date(now.getTime() - RATE_WINDOW_MS).toISOString();
  const runningSince = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  // On the VPS nginx overwrites x-real-ip with the socket peer. Prefer that
  // trusted hop over cf-connecting-ip, which a direct client can spoof.
  const ip =
    request.headers.get("x-real-ip")?.trim() ||
    clientIpFromHeaders(request.headers);
  // Reuse a server-only secret as a pepper so stored hashes
  // cannot be reversed with a small dictionary of common IP addresses.
  const pepper = bindings.INTEGRATION_ENCRYPTION_KEY || bindings.OPENROUTER_API_KEY;
  const ipHash = await sha256(`${pepper}:${ip}:public-preview`);
  await db
    .prepare("DELETE FROM public_previews WHERE expires_at<? AND status<>'running'")
    .bind(now.toISOString())
    .run()
    .catch(() => undefined);
  const [ipUsage, globalUsage] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) as count FROM public_previews
         WHERE ip_hash=? AND created_at>=?`,
      )
      .bind(ipHash, since)
      .first<{ count?: number }>(),
    db
      .prepare(
        `SELECT SUM(cost_microusd) as cost,
         SUM(CASE WHEN status='running' AND created_at>=? THEN 1 ELSE 0 END) as running
         FROM public_previews WHERE created_at>=?`,
      )
      .bind(runningSince, since)
      .first<{ cost?: number; running?: number }>(),
  ]);
  const ipLimit = positiveInteger(bindings.PUBLIC_PREVIEW_IP_LIMIT, DEFAULT_IP_LIMIT);
  if (Number(ipUsage?.count || 0) >= ipLimit) {
    return { ok: false, error: "preview_limit_reached", status: 429 };
  }
  const concurrentLimit = positiveInteger(
    bindings.PUBLIC_PREVIEW_CONCURRENT_LIMIT,
    DEFAULT_CONCURRENT_LIMIT,
  );
  if (Number(globalUsage?.running || 0) >= concurrentLimit) {
    return { ok: false, error: "preview_busy", status: 429 };
  }
  const globalCostLimit = Math.round(
    Number(bindings.PUBLIC_PREVIEW_GLOBAL_DAILY_COST_USD || 25) * 1_000_000,
  );
  if (
    Number(globalUsage?.cost || 0) >=
    (Number.isFinite(globalCostLimit) && globalCostLimit > 0
      ? globalCostLimit
      : DEFAULT_GLOBAL_COST_LIMIT_MICROUSD)
  ) {
    return { ok: false, error: "preview_budget_reached", status: 429 };
  }

  const id = crypto.randomUUID();
  const token = randomToken(36);
  const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO public_previews
       (id, token_hash, ip_hash, input_hash, website, locale, input_json,
        analysis_json, results_json, result_count, status, error_code, model,
        cost_microusd, workspace_id, product_id, created_at, completed_at,
        claimed_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '[]', 0, 'running', '', ?, 0, '', '', ?, NULL, NULL, ?)`,
    )
    .bind(
      id,
      await sha256(token),
      ipHash,
      inputHash,
      input.website,
      input.locale,
      canonicalInput,
      bindings.OPENROUTER_MODEL || "openai/gpt-5.2",
      now.toISOString(),
      expiresAt,
    )
    .run();

  try {
    const url = new URL(input.website);
    const domain = url.hostname.replace(/^www\./, "");

    const summary =
      input.locale === "ru"
        ? `Анализ каналов привлечения для ${domain}`
        : `Customer-acquisition channel analysis for ${domain}`;
    // A preview has no analysis behind it, so `category` is empty and the
    // search topic falls through to `description` — which used to hold an
    // instruction addressed to the model. Every preview therefore searched
    // Google for "Review the product website before finding channels…", a
    // sentence no page contains. The site's own title and meta description
    // say what the product is, cost one HTTP request and no tokens.
    const identity = await readSiteIdentity(input.website);
    const product: DiscoveryProduct = {
      name: identity.title || domain,
      website: input.website,
      category: identity.title || domain,
      description:
        identity.description ||
        identity.title ||
        `${domain} — ${input.audienceLabel}`,
      audience: input.audienceLabel,
      geography: input.geographyLabel,
      paidOffer: input.goalLabel,
      analysis: {
        summary,
        offer: input.goalLabel,
        channelTypes: [],
        // The one place a preview can be specific about this product: what its
        // own site calls itself, and who the visitor said it sells to.
        searchQueries: [identity.title, identity.description, input.audienceLabel]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
          .slice(0, 3),
        // A preview never asks the visitor to confirm anything, so it carries
        // no competitors and shows no gap.
        competitors: [],
        acquisitionMotions: [],
      },
    };
    const outcome = await runBroadDiscovery({
      workspaceId: `public-preview:${ipHash.slice(0, 16)}`,
      product,
      preferredMotion: focusMotion(input.goal),
      locale: input.locale,
      // A preview has no workspace and no plan behind it, so the cap is pinned
      // rather than derived: what an anonymous visitor sees is the free
      // allowance, which is also what they get if they sign up.
      maxResults: MAX_BATCH_DISCOVERY_RESULTS,
    });
    if (!outcome.ok) {
      await db
        .prepare(
          "UPDATE public_previews SET status='failed', error_code=? WHERE id=?",
        )
        .bind(outcome.error, id)
        .run();
      return { ok: false, error: outcome.error, status: outcome.status };
    }
    if (outcome.mode !== "live") {
      await db
        .prepare(
          "UPDATE public_previews SET status='failed', error_code='analysis_unavailable' WHERE id=?",
        )
        .bind(id)
        .run();
      return { ok: false, error: "analysis_unavailable", status: 503 };
    }
    const runCostMicrousd = usageCostMicrousd(outcome.providerUsage);
    const results = outcome.results.filter(
      (item) => item.relevance !== "doubtful",
    );
    if (!results.length) {
      await db
        .prepare(
          `UPDATE public_previews SET status='failed',
           error_code='no_channels_found', cost_microusd=? WHERE id=?`,
        )
        .bind(runCostMicrousd, id)
        .run();
      return { ok: false, error: "no_channels_found", status: 422 };
    }
    const analysis: PreviewAnalysis = {
      name: product.name || url.hostname,
      summary,
      category: "",
      audience: input.audienceLabel,
      negativeAudience:
        input.locale === "ru"
          ? "Нерелевантные сегменты без подтверждённого покупательского намерения"
          : "Irrelevant segments without demonstrated buying intent",
      offer: input.goalLabel,
      channelTypes: [...new Set(results.map((item) => item.channelType))].slice(0, 8),
      searchQueries: [],
      competitors: [],
      acquisitionMotions: [],
    };
    await db
      .prepare(
        `UPDATE public_previews SET analysis_json=?, results_json=?,
         result_count=?, status='completed', completed_at=?, cost_microusd=?
         WHERE id=?`,
      )
      .bind(
        JSON.stringify(analysis),
        JSON.stringify(results),
        results.length,
        new Date().toISOString(),
        runCostMicrousd,
        id,
      )
      .run();
    return {
      ok: true,
      payload: publicPayload(input, analysis, results),
      cookie: previewCookie(token, request),
    };
  } catch (error) {
    console.error(
      "[public-preview] failed",
      error instanceof Error ? error.message : "unknown",
    );
    await db
      .prepare(
        "UPDATE public_previews SET status='failed', error_code='openrouter_request_failed' WHERE id=?",
      )
      .bind(id)
      .run();
    return { ok: false, error: "openrouter_request_failed", status: 502 };
  }
}

export async function claimPublicPreview(
  cookieHeader: string | null,
  workspaceId: string,
): Promise<{ productId?: string; claimedNow?: boolean; error?: string }> {
  const db = database();
  const token = cookieValue(cookieHeader, PUBLIC_PREVIEW_COOKIE);
  if (!db || !token) return {};
  const row = await db
    .prepare(
      `SELECT id, input_json as inputJson, analysis_json as analysisJson,
       results_json as resultsJson, result_count as resultCount, status,
       workspace_id as workspaceId, product_id as productId,
       expires_at as expiresAt FROM public_previews WHERE token_hash=?`,
    )
    .bind(await sha256(token))
    .first<PreviewRow>();
  if (!row || Date.parse(row.expiresAt || "") <= Date.now()) return {};
  if (row.status === "claimed") {
    return row.workspaceId === workspaceId ? { productId: row.productId } : {};
  }
  if (row.status !== "completed") return {};

  let input: NormalizedPreviewInput;
  let analysis: PreviewAnalysis;
  let results: DiscoveryResult[];
  try {
    input = JSON.parse(row.inputJson || "{}") as NormalizedPreviewInput;
    analysis = JSON.parse(row.analysisJson || "{}") as PreviewAnalysis;
    results = JSON.parse(row.resultsJson || "[]") as DiscoveryResult[];
  } catch {
    return { error: "preview_invalid" };
  }
  if (!analysis.name || !input.website || !results.length) {
    return { error: "preview_invalid" };
  }
  const snapshot = await usageSnapshot(workspaceId);
  if (snapshot.used.products >= snapshot.limits.products) {
    return { error: "product_limit_reached" };
  }
  const channelRemaining = Math.max(
    0,
    snapshot.limits.channelsPerMonth - snapshot.used.channelsThisMonth,
  );
  if (!channelRemaining) return { error: "channel_limit_reached" };

  const productId = `preview-${row.id}`;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO products
       (id, name, website, description, category, audience, negative_audience,
        geography, languages, goal, monetization_model, paid_offer, price_range,
        payment_point, conversion_event, attribution_method, partner_terms,
        analysis, created_at, updated_at, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, '', '', '', '', '', ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      productId,
      analysis.name,
      input.website,
      analysis.summary,
      analysis.category,
      input.audienceLabel,
      analysis.negativeAudience,
      input.geographyLabel,
      input.locale === "ru" ? "Russian" : "English",
      input.goal,
      analysis.offer,
      JSON.stringify(analysis),
      now,
      now,
      workspaceId,
    )
    .run();
  const owned = await db
    .prepare("SELECT id FROM products WHERE id=? AND workspace_id=?")
    .bind(productId, workspaceId)
    .first();
  if (!owned) return { error: "product_id_conflict" };
  await saveProspects(
    workspaceId,
    productId,
    results.slice(0, channelRemaining),
    "discovered",
  );
  await db
    .prepare(
      `UPDATE public_previews SET status='claimed', workspace_id=?, product_id=?,
       claimed_at=? WHERE id=? AND status='completed'`,
    )
    .bind(workspaceId, productId, now, row.id)
    .run();
  return { productId, claimedNow: true };
}
