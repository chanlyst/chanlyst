import { env } from "cloudflare:workers";
import { getIntegrationSecret } from "./secret";
import { officialEvidence } from "./enrichment-core";
import { saveProspects, type StoredProspect } from "./prospect-store";
import {
  buildContactSearchQuery,
  contactQueryCount,
  normaliseContactSearchResults,
} from "./contact-discovery-core.mjs";
import type { DiscoveryProduct } from "./discovery-core";

const SEARCH_TIMEOUT_MS = 8_000;
// Serper's current search endpoint rejects values above 10 on this account.
// Breadth comes from distinct deterministic queries, never an invalid oversized page.
const RESULTS_PER_QUERY = 10;
const CRAWL_PER_SLICE = 12;
const CRAWL_CONCURRENCY = 4;

export type ContactDiscoveryBatch = {
  ok: true;
  query: number;
  queryCount: number;
  candidates: number;
  stored: number;
  verified: number;
} | {
  ok: false;
  error: "serper_not_configured" | "serper_request_failed";
};

function bindings() {
  return env as unknown as { DB?: D1Database; SERPER_API_KEY?: string };
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  work: (value: T) => Promise<R>,
) {
  const queue = [...values];
  const output: R[] = [];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let value = queue.shift(); value !== undefined; value = queue.shift()) {
      output.push(await work(value));
    }
  });
  await Promise.all(workers);
  return output;
}

/** One bounded, resumable slice of contact expansion. No LLM calls. */
export async function discoverContactBatch({
  workspaceId,
  product,
  queryIndex,
  locale = "en",
}: {
  workspaceId: string;
  product: DiscoveryProduct;
  queryIndex: number;
  locale?: string;
}): Promise<ContactDiscoveryBatch> {
  const apiKey =
    bindings().SERPER_API_KEY ||
    (await getIntegrationSecret("serper", workspaceId).catch(() => ""));
  if (!apiKey) return { ok: false, error: "serper_not_configured" };

  const queryCount = contactQueryCount(product);
  const query = buildContactSearchQuery(product, queryIndex % queryCount);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  let raw: unknown;
  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({
        q: query,
        num: RESULTS_PER_QUERY,
        hl: locale === "ru" ? "ru" : "en",
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: "serper_request_failed" };
    raw = await response.json();
  } catch {
    return { ok: false, error: "serper_request_failed" };
  } finally {
    clearTimeout(timer);
  }

  const candidates = normaliseContactSearchResults(
    (raw || {}) as { organic?: Array<Record<string, unknown>> },
  ).slice(0, CRAWL_PER_SLICE);
  const known = bindings().DB && product.id
    ? await bindings().DB!
        .prepare(
          `SELECT domain FROM prospects
           WHERE workspace_id=? AND product_id=? AND record_kind='contact'`,
        )
        .bind(workspaceId, product.id)
        .all<{ domain: string }>()
    : { results: [] as Array<{ domain: string }> };
  const knownDomains = new Set((known.results || []).map((row) => row.domain.toLowerCase()));
  const fresh = candidates.filter((item: { domain: string }) => !knownDomains.has(item.domain.toLowerCase()));
  const checkedAt = new Date().toISOString();
  const researched = await mapConcurrent(fresh, CRAWL_CONCURRENCY, async (item) => {
    const evidence = await officialEvidence(item.url || item.domain, {
      maxPages: 2,
      pageChars: 4_000,
      digestChars: 1_500,
      maxEmails: 5,
      maxResults: 1,
      maxTotalResults: 1,
      maxToolCalls: 1,
      maxOutputTokens: 600,
      retryOutputTokens: 1_000,
    });
    const confident = evidence.confident;
    const email = String(confident?.email || evidence.emails[0] || "").toLowerCase();
    const verified = Boolean(confident?.email);
    return {
      company: item.company,
      domain: item.domain,
      url: item.url,
      description: item.description,
      source: "Serper + public website",
      channelType: "Direct outreach",
      reason: "Concrete organisation matching the product audience.",
      contact: "",
      email,
      telegram: evidence.telegram || "",
      score: email ? 78 : 68,
      opportunityType: "direct_buyer",
      actionType: "find_decision_maker",
      nextAction: email
        ? "Review the public contact and prepare outreach."
        : "Find a public decision-maker contact.",
      actionUrl: confident?.sourceUrl || item.url,
      engagementMode: "outreach",
      commercialModel: "unknown",
      outreachEligible: true,
      origin: "discovered",
      recordKind: "contact",
      contactRole: confident?.role || "",
      contactStatus: verified
        ? "verified_public"
        : email
          ? "found_unverified"
          : "not_checked",
      contactSourceUrl: confident?.sourceUrl || evidence.pages[0] || item.url,
      contactEvidence: confident?.evidence || "",
      contactConfidence: verified ? 100 : email ? 55 : 0,
      contactCheckedAt: checkedAt,
    } satisfies StoredProspect;
  });

  if (product.id && researched.length) {
    await saveProspects(workspaceId, product.id, researched, "discovered");
  }
  return {
    ok: true,
    query: queryIndex,
    queryCount,
    candidates: candidates.length,
    stored: researched.length,
    verified: researched.filter((item) => item.contactStatus === "verified_public").length,
  };
}
