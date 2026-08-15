// Drop-reason accounting for a discovery run, kept pure so `node --test` can
// exercise it without a Worker runtime.
//
// Two runs on 25 July succeeded, cost $0.140 and $0.128 and stored nothing —
// and nothing anywhere said why, because the server filtered the model's
// entries through an anonymous chain of `.filter()` calls and threw the
// difference away. Every rule now names itself and counts what it removed, so
// `returned + dropped === model_returned` always holds and a run that produced
// results but stored none is explainable from one log line.

import { applyDiscoveryGuards } from "./discovery-guards.mjs";

// The citation rule that used to live here is gone. It required the model to
// have cited a candidate's domain, which the provider stopped reporting (five
// searches, zero citation URLs in the response), and every workaround built
// around that silence only made the run harder to explain. Checking the
// candidates against the internet directly settled the question the rule was
// meant to answer: none of the returned domains were invented. What did get
// through was a live, correctly described site aimed at the wrong audience,
// which a citation would have confirmed rather than caught. That judgement now
// happens in relevance-check.mjs, against the site's own words.

/** Every reason an entry can be removed, in the order the rules run. */
export const DISCOVERY_DROP_REASONS = [
  "missing_url_or_company",
  "score_below_threshold",
  "duplicate_in_batch",
  "duplicate_known_domain",
  "affiliate_network_without_registration_url",
  "affiliate_network_over_cap",
  "over_result_cap",
  "duplicate_across_batches",
  "over_batch_cap",
  "quota_trim",
];

/**
 * @param {string} url
 * @returns {string}
 */
export function domainOf(url) {
  const value = String(url || "").trim();
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return value.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
  }
}

/**
 * @param {Record<string, number>} counts
 * @param {string} reason
 * @param {number} [by]
 */
function count(counts, reason, by = 1) {
  if (by <= 0) return;
  counts[reason] = (counts[reason] || 0) + by;
}

/**
 * @param {Record<string, number>} counts
 * @returns {number}
 */
export function droppedTotal(counts) {
  return Object.values(counts || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

/**
 * Filters the model's entries through every server rule, counting each removal
 * under the rule that made it.
 *
 * @template {{url?: string, company?: string, domain?: string, score?: unknown}} T
 * @param {{
 *   entries: readonly T[],
 *   minScore?: number,
 *   maxResults?: number,
 *   knownDomains?: readonly string[],
 *   normalise?: (item: T) => T,
 * }} input
 * @returns {{results: T[], dropped: Record<string, number>, summary: {modelReturned: number, returned: number, dropped: number, reasons: Record<string, number>, kept: Record<string, number>}}}
 */
export function auditDiscoveryResults({
  entries,
  minScore = 0,
  maxResults = Number.POSITIVE_INFINITY,
  knownDomains = [],
  normalise = (item) => item,
}) {
  const list = Array.isArray(entries) ? entries : [];
  /** @type {Record<string, number>} */
  const dropped = {};
  /** @type {Record<string, number>} */
  const keptReasons = {};
  const known = new Set(
    (knownDomains || []).map((domain) => domainOf(String(domain || ""))).filter(Boolean),
  );
  const seen = new Set();
  /** @type {T[]} */
  const kept = [];

  for (const entry of list) {
    if (!entry?.url || !entry?.company) {
      count(dropped, "missing_url_or_company");
      continue;
    }
    if (Number(entry.score) < minScore) {
      count(dropped, "score_below_threshold");
      continue;
    }
    const item = normalise(entry);
    const domain = domainOf(item.domain || item.url || "");
    if (domain && seen.has(domain)) {
      count(dropped, "duplicate_in_batch");
      continue;
    }
    if (domain && known.has(domain)) {
      count(dropped, "duplicate_known_domain");
      continue;
    }
    if (domain) seen.add(domain);
    kept.push(item);
  }

  // The supply-side rules keep living in discovery-guards.mjs; their counts are
  // merged in so there is still exactly one implementation of that rule.
  const guarded = applyDiscoveryGuards(kept);
  for (const [reason, value] of Object.entries(guarded.dropped)) {
    count(dropped, reason, Number(value) || 0);
  }

  const capped = guarded.results.slice(0, Math.max(0, maxResults));
  count(dropped, "over_result_cap", guarded.results.length - capped.length);

  return {
    results: capped,
    dropped,
    summary: {
      modelReturned: list.length,
      returned: capped.length,
      dropped: droppedTotal(dropped),
      reasons: dropped,
      kept: keptReasons,
    },
  };
}

/**
 * Applies the caller's remaining plan quota on top of an audited run, counting
 * whatever the quota removes as its own reason so the totals still reconcile.
 *
 * @template T
 * @param {{results: readonly T[], summary: {modelReturned: number, returned: number, dropped: number, reasons: Record<string, number>, kept?: Record<string, number>}, limit: number}} input
 * @returns {{results: T[], summary: {modelReturned: number, returned: number, dropped: number, reasons: Record<string, number>, kept: Record<string, number>}}}
 */
export function applyQuotaTrim({ results, summary, limit }) {
  const list = Array.isArray(results) ? [...results] : [];
  const kept = list.slice(0, Math.max(0, Number(limit) || 0));
  const reasons = { ...(summary?.reasons || {}) };
  count(reasons, "quota_trim", list.length - kept.length);
  return {
    results: kept,
    summary: {
      modelReturned: Number(summary?.modelReturned) || 0,
      returned: kept.length,
      dropped: droppedTotal(reasons),
      reasons,
      kept: { ...(summary?.kept || {}) },
    },
  };
}

/**
 * True when the accounting adds up. Used by the tests and cheap enough to
 * assert on in the log line itself.
 *
 * @param {{modelReturned: number, returned: number, dropped: number}} summary
 * @returns {boolean}
 */
export function summaryReconciles(summary) {
  return (
    Number(summary?.returned || 0) + Number(summary?.dropped || 0) ===
    Number(summary?.modelReturned || 0)
  );
}

/**
 * One structured log line per run. Carries counts only — never a domain list
 * and never the model output.
 *
 * @param {{modelReturned: number, returned: number, dropped: number, reasons: Record<string, number>, kept?: Record<string, number>}} summary
 * @param {Record<string, string | number | undefined>} [context]
 * @returns {string}
 */
export function formatDiscoverySummary(summary, context = {}) {
  const reasons = formatCounts(summary?.reasons) || "none";
  const kept = formatCounts(summary?.kept);
  const extras = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`);
  return [
    "discovery run:",
    ...extras,
    `model_returned=${Number(summary?.modelReturned) || 0}`,
    `returned=${Number(summary?.returned) || 0}`,
    `dropped=${Number(summary?.dropped) || 0}`,
    `reasons=${reasons}`,
    // Only printed when something was kept against a rule, so it reads as an
    // exception and not as noise.
    ...(kept ? [`kept=${kept}`] : []),
    `reconciles=${summaryReconciles(summary)}`,
  ].join(" ");
}

/**
 * @param {Record<string, number> | undefined} counts
 * @returns {string}
 */
function formatCounts(counts) {
  return Object.entries(counts || {})
    .filter(([, value]) => Number(value) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, value]) => `${reason}=${value}`)
    .join(",");
}
