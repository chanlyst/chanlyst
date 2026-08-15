import { env } from "cloudflare:workers";
import { buildDiscoveryHint, loadChannelStats } from "./channel-stats";
import { getIntegrationSecret } from "./secret";
import {
  recordAiUsage,
  reportOpenRouterFailure,
  type OpenRouterUsage,
} from "./ai-usage";
import { discoverySearchBudget } from "./ai-cost.mjs";
import { buildDiscoveryPrompt } from "./discovery-prompt.mjs";
import { isSupplySideChannel } from "./discovery-guards.mjs";
import {
  auditDiscoveryResults,
  formatDiscoverySummary,
} from "./discovery-audit.mjs";
import { telegramHandleFromUrl } from "./contact-extract.mjs";
import { collectOutputText, parseModelJson } from "./model-output.mjs";
import { fetchPublic } from "./fetch-public";
import { safePublicUrl } from "./security-helpers.mjs";
import { IDENTITY_SCAN_CHARS, parseSiteIdentity } from "./site-identity.mjs";
import {
  applyRelevanceVerdicts,
  buildRelevancePrompt,
  relevanceCandidates,
  relevanceSchema,
  summariseRelevance,
} from "./relevance-check.mjs";

// The channel-discovery step, extracted out of app/api/discover/route.ts so
// the interactive route, the background agent and the "prepare everything"
// pipeline all run the same implementation. Auth, the channel quota and the
// HTTP shape stay in the route.

export type DiscoveryProduct = {
  id?: string;
  name?: string;
  website?: string;
  description?: string;
  category?: string;
  audience?: string;
  negativeAudience?: string;
  geography?: string;
  languages?: string;
  monetizationModel?: string;
  paidOffer?: string;
  priceRange?: string;
  paymentPoint?: string;
  conversionEvent?: string;
  attributionMethod?: string;
  partnerTerms?: string;
  analysis?: {
    summary?: string;
    offer?: string;
    channelTypes?: string[];
    searchQueries?: string[];
    /**
     * Rivals to measure the distribution gap against. `confirmed` separates a
     * model's suggestion from the user's answer: an unconfirmed name is shown
     * for approval and never searched on.
     */
    competitors?: Array<{ name: string; domain: string; confirmed?: boolean }>;

    acquisitionMotions?: Array<{
      id?: string;
      score?: number;
      rationale?: string;
      firstAction?: string;
    }>;
  };
};

export type DiscoveryResult = {
  company: string;
  domain: string;
  url: string;
  description: string;
  source: string;
  channelType: string;
  reason: string;
  contact: string;
  email: string;
  telegram: string;
  score: number;
  opportunityType:
    | "direct_buyer"
    | "partner"
    | "affiliate_publisher"
    | "directory"
    | "creator"
    | "community"
    | "content_opportunity"
    | "paid_placement"
    | "affiliate_network";
  actionType:
    | "find_decision_maker"
    | "propose_partnership"
    | "apply_listing"
    | "submit_product"
    | "contact_creator"
    | "join_community"
    | "pitch_content"
    | "request_media_kit"
    | "list_offer";
  nextAction: string;
  actionUrl: string;
  engagementMode: "free_listing" | "paid_placement" | "outreach" | "unknown";
  commercialModel: "free" | "paid" | "commission" | "unknown";
  pricingSummary: string;
  placementRequirements: string;
  usageTerms: string;
  registrationUrl: string;
  outreachEligible: boolean;
  origin?: "discovered";
  /**
   * What the candidate's own page says it is, read from the site rather than
   * from the model. Empty when the page could not be fetched.
   */
  siteTitle?: string;
  siteDescription?: string;
  /**
   * Whether the site's own words fit the product: "ok", "doubtful" (live and
   * real, aimed elsewhere — grouped off, never deleted) or "unknown" (nobody
   * judged it, so it is treated as a normal channel).
   */
  relevance?: "ok" | "doubtful" | "unknown";
  relevanceReason?: string;
};

/** Run accounting: how many entries the model returned and where they went. */
export type DiscoverySummary = {
  modelReturned: number;
  returned: number;
  dropped: number;
  reasons: Record<string, number>;
  /** Entries kept despite a failed rule, by the reason they were kept. */
  kept?: Record<string, number>;
};

export type DiscoveryOutcome =
  | {
      ok: true;
      mode: "live";
      provider: "openrouter_agent_search" | "serper";
      results: DiscoveryResult[];
      note?: string;
      /** Entries the server refused to return, counted by reason. */
      dropped?: Record<string, number>;
      /** Full run accounting: model output vs returned vs every drop rule. */
      summary?: DiscoverySummary;
      /** Provider usage is returned to trusted server callers only. Public API
       * routes must never forward it verbatim to the browser. */
      providerUsage?: OpenRouterUsage[];
    }
  | { ok: true; mode: "setup"; results: DiscoveryResult[]; note: string }
  | {
      ok: false;
      error:
        | "ai_credits_exhausted"
        | "openrouter_request_failed"
        | "discovery_format_invalid";
      status: 402 | 502;
    };

export const knownMotionIds = [
  "direct_sales",
  "partnerships",
  "affiliates",
  "directories",
  "creators",
  "communities",
  "content_seo",
  "paid_placements",
];

/** Upper bound on results a single discovery run may return. */
export const MAX_DISCOVERY_RESULTS = 8;

/** Entries below this score are refused, mirroring the prompt's rule. */
export const MIN_DISCOVERY_SCORE = 65;

type OpenRouterResponse = {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{
        type?: string;
        url_citation?: { url?: string };
      }>;
    }>;
  }>;
  usage?: OpenRouterUsage;
};

const discoverySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          company: { type: "string" },
          domain: { type: "string" },
          url: { type: "string" },
          description: { type: "string" },
          source: { type: "string" },
          channelType: { type: "string" },
          reason: { type: "string" },
          contact: { type: "string" },
          email: { type: "string" },
          telegram: { type: "string" },
          score: { type: "integer", minimum: 0, maximum: 100 },
          opportunityType: {
            type: "string",
            enum: [
              "direct_buyer",
              "partner",
              "affiliate_publisher",
              "directory",
              "creator",
              "community",
              "content_opportunity",
              "paid_placement",
              "affiliate_network",
            ],
          },
          actionType: {
            type: "string",
            enum: [
              "find_decision_maker",
              "propose_partnership",
              "apply_listing",
              "submit_product",
              "contact_creator",
              "join_community",
              "pitch_content",
              "request_media_kit",
              "list_offer",
            ],
          },
          nextAction: { type: "string" },
          actionUrl: { type: "string" },
          engagementMode: {
            type: "string",
            enum: ["free_listing", "paid_placement", "outreach", "unknown"],
          },
          commercialModel: {
            type: "string",
            enum: ["free", "paid", "commission", "unknown"],
          },
          pricingSummary: { type: "string" },
          placementRequirements: { type: "string" },
          usageTerms: { type: "string" },
          registrationUrl: { type: "string" },
          outreachEligible: { type: "boolean" },
        },
        required: [
          "company",
          "domain",
          "url",
          "description",
          "source",
          "channelType",
          "reason",
          "contact",
          "email",
          "telegram",
          "score",
          "opportunityType",
          "actionType",
          "nextAction",
          "actionUrl",
          "engagementMode",
          "commercialModel",
          "pricingSummary",
          "placementRequirements",
          "usageTerms",
          "registrationUrl",
          "outreachEligible",
        ],
      },
    },
  },
  required: ["results"],
} as const;

function parseJson(text: string) {
  const parsed = parseModelJson(text) as { results?: DiscoveryResult[] };
  return Array.isArray(parsed?.results) ? parsed.results : [];
}

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Sites fetched at once: enough to finish quickly, few enough to stay polite. */
const IDENTITY_CONCURRENCY = 4;

/** A site that has not answered by now is not worth holding the run for. */
const IDENTITY_TIMEOUT_MS = 8_000;

/**
 * Reads each candidate's own <head>: title, description, site name.
 *
 * Failures are silent by design. A site that blocks us, times out or answers
 * with nothing leaves the identity empty, and an empty identity means "not
 * judged" — never "rejected". The channel then behaves exactly as it did
 * before this step existed.
 */
async function readSiteIdentities(
  results: DiscoveryResult[],
): Promise<DiscoveryResult[]> {
  const enriched = [...results];
  const queue = results.map((_, index) => index);

  const worker = async () => {
    for (let index = queue.shift(); index !== undefined; index = queue.shift()) {
      const item = results[index];
      const target = safePublicUrl(item?.url || "");
      if (!target) continue;
      try {
        const fetched = await Promise.race([
          fetchPublic(target, { userAgent: "Chanlyst Channel Research/1.0" }),
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), IDENTITY_TIMEOUT_MS),
          ),
        ]);
        if (!fetched) continue;
        const html = (await fetched.response.text()).slice(0, IDENTITY_SCAN_CHARS);
        const identity = parseSiteIdentity(html);
        enriched[index] = {
          ...item,
          siteTitle: identity.title,
          siteDescription: identity.description,
          // Carried for the judge only; not stored.
          identity,
        } as DiscoveryResult;
      } catch {
        // Unreachable, blocked or unparseable: judged by nobody, dropped by nobody.
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(IDENTITY_CONCURRENCY, results.length) }, worker),
  );
  return enriched;
}

/**
 * Asks once, for the whole batch, whether each candidate fits the product —
 * judging the site's own words rather than the model's pitch for it.
 *
 * No web search and a small output, so the call is a fraction of the discovery
 * run it follows. If it fails for any reason the channels are returned
 * unjudged: this step exists to sort the list, not to gate it.
 */
async function judgeRelevance({
  results,
  product,
  openrouterKey,
  model,
  workspaceId,
  locale,
}: {
  results: DiscoveryResult[];
  product: DiscoveryProduct;
  openrouterKey: string;
  model: string;
  workspaceId: string;
  locale: string;
}): Promise<{ results: DiscoveryResult[]; usage?: OpenRouterUsage }> {
  const strip = (list: DiscoveryResult[]) =>
    list.map(({ identity: _identity, ...rest }: DiscoveryResult & { identity?: unknown }) => rest);

  const candidates = relevanceCandidates(
    results as Array<DiscoveryResult & { identity?: object }>,
  );
  if (!candidates.length) {
    return { results: strip(applyRelevanceVerdicts(results, null)) };
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://chanlyst.com",
        "X-OpenRouter-Title": "Chanlyst",
      },
      body: JSON.stringify({
        model,
        input: buildRelevancePrompt({ product, candidates, locale }),
        reasoning: { effort: "low" },
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "chanlyst_channel_relevance",
            strict: true,
            schema: relevanceSchema,
          },
        },
        max_output_tokens: 1200,
      }),
    });
    if (!response.ok) {
      return { results: strip(applyRelevanceVerdicts(results, null)) };
    }

    const raw = (await response.json()) as OpenRouterResponse;
    await recordAiUsage({
      workspaceId,
      productId: product.id,
      operation: "relevance",
      model,
      usage: raw.usage,
      statusCode: response.status,
      response: raw,
    });
    const judgement = parseModelJson(collectOutputText(raw)) as {
      verdicts?: Array<{ index?: unknown; verdict?: unknown; reason?: unknown }>;
    } | null;
    return {
      results: strip(applyRelevanceVerdicts(results, judgement)),
      usage: raw.usage,
    };
  } catch {
    return { results: strip(applyRelevanceVerdicts(results, null)) };
  }
}

export async function runDiscovery({
  workspaceId,
  product,
  sources,
  focusMotion: requestedMotion,
  excludeDomains = [],
  sourceCandidates = [],
  locale = "en",
}: {
  workspaceId: string;
  product: DiscoveryProduct;
  sources: string[];
  focusMotion?: string;
  /** Domains found by earlier passes in the same broad discovery run. */
  excludeDomains?: string[];
  /** Structured candidates harvested outside the model's own web search. */
  sourceCandidates?: Array<{ title: string; url: string; snippet: string; source: string }>;
  /** Interface language: the channel text a user reads is written in it. */
  locale?: string;
}): Promise<DiscoveryOutcome> {
  const bindings = env as unknown as {
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;
    DISCOVERY_CLASSIFIER_MODEL?: string;
    SERPER_API_KEY?: string;
  };
  const openrouterKey =
    bindings.OPENROUTER_API_KEY ||
    (await getIntegrationSecret("openrouter", workspaceId));
  // Accept only known motion ids so arbitrary text never reaches the prompt.
  const focusMotion = knownMotionIds.includes(requestedMotion || "")
    ? requestedMotion!
    : "";

  // Feedback loop: when the product already has enough real outcomes, tell
  // the model which engagement modes and channel types actually performed.
  // The hint is best-effort — analytics must never break discovery itself.
  let performanceHint = "";
  const statsDb = (env as unknown as { DB?: D1Database }).DB;
  if (statsDb && product.id) {
    try {
      const stats = await loadChannelStats(statsDb, workspaceId, product.id);
      performanceHint = buildDiscoveryHint(stats);
    } catch {
      performanceHint = "";
    }
  }

  // Every run used to rediscover channels the product already stores; the
  // server drops them on save, so those tokens bought nothing. The most
  // recent domains are handed to the model as a skip list.
  let knownDomains: string[] = [];
  if (statsDb && product.id) {
    try {
      const stored = await statsDb
        .prepare(
          `SELECT domain, MAX(created_at) AS lastSeen FROM prospects
           WHERE product_id = ? AND workspace_id = ? AND domain <> ''
           GROUP BY domain ORDER BY lastSeen DESC LIMIT 200`,
        )
        .bind(product.id, workspaceId)
        .all<{ domain: string }>();
      knownDomains = (stored.results || []).map((row) => row.domain);
    } catch {
      knownDomains = [];
    }
  }
  knownDomains = [...new Set([...knownDomains, ...excludeDomains])];

  if (openrouterKey) {
    const budget = discoverySearchBudget(
      bindings as unknown as Record<string, unknown>,
    );
    const prompt = buildDiscoveryPrompt({
      product,
      sources: sources || [],
      focusMotion,
      performanceHint,
      knownDomains,
      sourceCandidates,
      locale,
    });
    const hasSourceCandidates = sourceCandidates.length > 0;
    // Serper has already done the search on the ordinary production path.
    // The model only classifies a bounded candidate list, so it must not pay
    // for another round of web-search tools.
    const model = hasSourceCandidates
      ? bindings.DISCOVERY_CLASSIFIER_MODEL || "openai/gpt-5-mini"
      : bindings.OPENROUTER_MODEL || "openai/gpt-5.2";
    const searchTools = hasSourceCandidates
      ? {}
      : {
          tools: [
            {
              type: "openrouter:web_search",
              parameters: {
                max_results: budget.maxResults,
                max_total_results: budget.maxTotalResults,
              },
            },
          ],
          max_tool_calls: budget.maxToolCalls,
        };
    const response = await fetch("https://openrouter.ai/api/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          "https://chanlyst.com",
        "X-OpenRouter-Title": "Chanlyst",
      },
      body: JSON.stringify({
        model,
        input: prompt,
        reasoning: { effort: "low" },
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "chanlyst_channel_discovery",
            strict: true,
            schema: discoverySchema,
          },
        },
        ...searchTools,
        max_output_tokens: hasSourceCandidates
          ? Math.min(budget.maxOutputTokens, 3_000)
          : budget.maxOutputTokens,
      }),
    });
    if (!response.ok) {
      const failure = await reportOpenRouterFailure({
        response,
        operation: "discover",
        workspaceId,
        productId: product.id,
        model,
      });
      if (failure.creditsExhausted) {
        return { ok: false, error: "ai_credits_exhausted", status: 402 };
      }
      return { ok: false, error: "openrouter_request_failed", status: 502 };
    }

    const raw = (await response.json()) as OpenRouterResponse;
    await recordAiUsage({
      workspaceId,
      productId: product.id,
      operation: "discover",
      model,
      usage: raw.usage,
      statusCode: response.status,
      response: raw,
    });

    try {
      // Every rule below names itself and counts what it removed, so a run
      // that returned entries and stored none is explainable afterwards.
      const { results: audited, dropped, summary } = auditDiscoveryResults({
        entries: parseJson(collectOutputText(raw)),
        minScore: MIN_DISCOVERY_SCORE,
        maxResults: MAX_DISCOVERY_RESULTS,
        knownDomains,
        normalise: (item) => ({
          ...item,
          domain: item.domain || domainFromUrl(item.url),
          // A t.me result carries its own handle. Taking it from the URL means
          // a Telegram channel arrives contactable without an enrichment call.
          telegram:
            item.telegram ||
            telegramHandleFromUrl(item.actionUrl || "") ||
            telegramHandleFromUrl(item.url || ""),
          score: Math.max(0, Math.min(100, Number(item.score) || 0)),
          opportunityType: item.opportunityType || "partner",
          actionType: item.actionType || "propose_partnership",
          nextAction:
            item.nextAction || "Проверить условия и найти подходящий контакт.",
          actionUrl: item.actionUrl || item.url,
          engagementMode: item.engagementMode || "unknown",
          commercialModel: item.commercialModel || "unknown",
          pricingSummary: item.pricingSummary || "",
          placementRequirements: item.placementRequirements || "",
          usageTerms: item.usageTerms || "",
          registrationUrl: item.registrationUrl || "",
          // Supply-side channels have nobody to write to: the action is to
          // register the offer, so they never enter the outreach queue.
          outreachEligible:
            item.engagementMode === "outreach" &&
            !isSupplySideChannel(item) &&
            Boolean(item.outreachEligible),
        }),
      });

      // What the candidates say about THEMSELVES, read from the sites. This
      // is the cross-check the citation rule could never perform: it confirmed
      // that a page exists, which was never in doubt.
      const relevancePass = await judgeRelevance({
        results: await readSiteIdentities(audited),
        product,
        openrouterKey,
        model,
        workspaceId,
        locale,
      });
      const results = relevancePass.results;
      const relevance = summariseRelevance(results);

      // Counts only: no domains, no model output.
      console.info(
        formatDiscoverySummary(summary, {
          workspace: workspaceId,
          product: product.id,
          known_domains: knownDomains.length,
          relevance_ok: relevance.ok,
          relevance_doubtful: relevance.doubtful,
          relevance_unknown: relevance.unknown,
        }),
      );

      return {
        ok: true,
        mode: "live",
        provider: "openrouter_agent_search",
        results,
        dropped,
        summary,
        providerUsage: [raw.usage, relevancePass.usage].filter(
          (usage): usage is OpenRouterUsage => Boolean(usage),
        ),
        note: results.length
          ? undefined
          : summary.reasons.duplicate_known_domain
            ? // The exact shape of the 25 July runs: the model found channels,
              // every one of them was already stored, nothing new was saved.
              "Поиск завершён: все найденные площадки уже есть в вашем списке."
            : "Поиск завершён, но площадок с достаточным рейтингом не найдено.",
      };
    } catch {
      return { ok: false, error: "discovery_format_invalid", status: 502 };
    }
  }

  if (bindings.SERPER_API_KEY) {
    const query = `${product.audience || product.description || product.name || ""} ${
      (product.analysis?.channelTypes || []).join(" OR ")
    }`;
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": bindings.SERPER_API_KEY,
      },
      body: JSON.stringify({ q: query, num: 20 }),
    });
    if (response.ok) {
      const data = (await response.json()) as {
        organic?: Array<{ title?: string; link?: string; snippet?: string }>;
      };
      const results = (data.organic || [])
        .filter((item) => item.link)
        .map((item) => ({
          company: item.title?.split(/[|–—]/)[0].trim() || domainFromUrl(item.link || ""),
          domain: domainFromUrl(item.link || ""),
          url: item.link || "",
          description: item.snippet || "",
          source: "Open web",
          channelType: "Требует проверки",
          reason: "Найден по целевой аудитории; проверьте перед контактом.",
          contact: "",
          email: "",
          telegram: "",
          score: 50,
          opportunityType: "partner" as const,
          actionType: "propose_partnership" as const,
          nextAction: "Проверить релевантность и найти подходящий контакт.",
          actionUrl: item.link || "",
          engagementMode: "unknown" as const,
          commercialModel: "unknown" as const,
          pricingSummary: "",
          placementRequirements: "",
          usageTerms: "",
          registrationUrl: "",
          outreachEligible: false,
        }));
      return { ok: true, mode: "live", provider: "serper", results };
    }
  }

  return {
    ok: true,
    mode: "setup",
    results: [],
    note: "Подключите OpenRouter API: он выполнит анализ и поиск по открытому интернету без Serper.",
  };
}
