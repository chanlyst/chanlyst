import { domainOf, droppedTotal } from "./discovery-audit.mjs";
import { baseDomain } from "./contact-extract.mjs";

/** Four deliberately different markets, rather than four rewrites of one query. */
export const BROAD_DISCOVERY_PASSES = [
  {
    id: "directories",
    focusMotion: "directories",
    sources: ["web", "directories", "review platforms", "launch platforms"],
  },
  {
    id: "communities",
    focusMotion: "communities",
    sources: ["web", "communities", "forums", "professional groups"],
  },
  {
    id: "creators",
    focusMotion: "creators",
    sources: ["web", "creators", "newsletters", "podcasts"],
  },
  {
    id: "partnerships",
    focusMotion: "partnerships",
    sources: ["web", "publishers", "affiliate publishers", "industry media"],
  },
];

/** The broad run is intentionally capped at the free plan's monthly allowance. */
export const MAX_BATCH_DISCOVERY_RESULTS = 30;

/**
 * What a paying workspace gets from one run.
 *
 * Thirty was the free plan's whole month, used as the cap for everyone. A
 * Starter customer is sold a hundred channels a month and had to press the
 * button four times to collect them, which reads as a restriction rather than
 * a product.
 *
 * This costs nothing to raise. The run of 13 August returned 51 results across
 * its eight lanes and the merge discarded 21 of them — the work was already
 * done and paid for, and the cap threw it away.
 */
export const PAID_BATCH_DISCOVERY_RESULTS = 50;

/** @param {string} plan @returns {number} */
export function batchResultCap(plan) {
  return !plan || plan === "free" ? MAX_BATCH_DISCOVERY_RESULTS : PAID_BATCH_DISCOVERY_RESULTS;
}

/** The public promise is a complete first map, not a token sample. */
export const MIN_USEFUL_DISCOVERY_RESULTS = 30;

export const EXPANSION_DISCOVERY_PASSES = [
  {
    id: "content_seo",
    focusMotion: "content_seo",
    sources: ["web", "industry publications", "guest content", "newsletters"],
  },
  {
    id: "paid_placements",
    focusMotion: "paid_placements",
    sources: ["web", "sponsorships", "paid placements", "media kits"],
  },
  {
    id: "affiliates",
    focusMotion: "affiliates",
    sources: ["web", "affiliate publishers", "comparison sites", "review media"],
  },
  {
    id: "partnerships_tail",
    focusMotion: "partnerships",
    sources: ["web", "niche publishers", "associations", "industry media"],
  },
];

/**
 * Most hosts represent one organisation, but several publishing platforms host
 * many independent audience owners below one domain. Keep those properties
 * distinct while collapsing help.example.com and example.com into one brand.
 * @param {{domain?: string, url?: string}} item
 */
export function discoveryEntityKey(item = {}) {
  // URL first: `domain` intentionally loses the subreddit/channel path on
  // hosted platforms, while the action URL still identifies its real owner.
  const raw = String(item.url || item.domain || "").trim();
  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return domainOf(raw);
  }
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
  const platformHost = baseDomain(host);
  if (/^(reddit\.com|youtube\.com|medium\.com|t\.me|telegram\.me)$/.test(platformHost)) {
    const parts = path.split("/").filter(Boolean).slice(0, 2);
    return parts.length ? `${platformHost}/${parts.join("/")}` : platformHost;
  }
  if (/\.(substack\.com|github\.io)$/.test(host)) return host;
  return baseDomain(host) || host;
}

function resultBucket(item) {
  const opportunity = String(item?.opportunityType || "");
  const mode = String(item?.engagementMode || "");
  if (opportunity === "directory" || mode === "free_listing") return "listing";
  if (opportunity === "paid_placement" || mode === "paid_placement") return "paid";
  if (["direct_buyer", "partner", "affiliate_publisher", "affiliate_network"].includes(opportunity)) {
    return "commercial";
  }
  return "audience";
}

/**
 * Preserve useful breadth in the first 30 instead of letting the easiest
 * category (usually paid media) occupy every slot.
 */
export function balanceDiscoveryResults(items, maxResults = MAX_BATCH_DISCOVERY_RESULTS) {
  // The per-category quotas scale with the cap, or a larger run would fill its
  // extra room from whichever category is easiest — which is the very thing
  // this function exists to prevent.
  const share = maxResults / MAX_BATCH_DISCOVERY_RESULTS;
  const scale = (value) => Math.max(1, Math.round(value * share));
  const limits = {
    listing: scale(8),
    paid: scale(7),
    commercial: scale(8),
    audience: scale(7),
  };
  const buckets = { listing: [], paid: [], commercial: [], audience: [] };
  for (const item of items || []) buckets[resultBucket(item)].push(item);
  const selected = [];
  const selectedKeys = new Set();
  for (const [bucket, limit] of Object.entries(limits)) {
    for (const item of buckets[bucket].slice(0, limit)) {
      selected.push(item);
      selectedKeys.add(discoveryEntityKey(item));
    }
  }
  for (const item of items || []) {
    if (selected.length >= maxResults) break;
    const key = discoveryEntityKey(item);
    if (!selectedKeys.has(key)) {
      selected.push(item);
      selectedKeys.add(key);
    }
  }
  return selected
    .sort((left, right) => {
      const relevanceDelta =
        Number(left?.relevance === "doubtful") -
        Number(right?.relevance === "doubtful");
      return relevanceDelta || (Number(right?.score) || 0) - (Number(left?.score) || 0);
    })
    .slice(0, Math.max(0, maxResults));
}

/**
 * The visitor's chosen goal affects the final lane without removing the three
 * discovery lanes every useful acquisition map needs.
 * @param {string} preferredMotion
 * @param {string[]} selectedSources
 */
export function discoveryPasses(preferredMotion = "", selectedSources = []) {
  const passes = BROAD_DISCOVERY_PASSES.map((pass) => ({
    ...pass,
    sources: [...pass.sources],
  }));
  const known = new Set(passes.map((pass) => pass.focusMotion));
  if (preferredMotion && !known.has(preferredMotion)) {
    const replacements = {
      direct_sales: ["web", "potential buyers", "decision makers", "buyer communities"],
      affiliates: ["web", "affiliate publishers", "comparison sites", "review media"],
      content_seo: ["web", "industry publications", "guest content", "newsletters"],
      paid_placements: ["web", "sponsorships", "paid placements", "media kits"],
    };
    if (replacements[preferredMotion]) {
      passes[3] = {
        id: preferredMotion,
        focusMotion: preferredMotion,
        sources: replacements[preferredMotion],
      };
    }
  }
  const selected = new Set(selectedSources || []);
  if (!selected.size || selected.has("web")) return passes;
  const sourceForPass = {
    directories: ["reviews", "directories", "local"],
    communities: ["communities"],
    creators: ["creators"],
    partnerships: ["publishers"],
    direct_sales: ["local"],
    affiliates: ["reviews"],
    content_seo: ["reviews", "creators"],
    paid_placements: ["reviews", "creators"],
  };
  const filtered = passes.filter((pass) =>
    (sourceForPass[pass.focusMotion] || []).some((source) => selected.has(source)),
  );
  return filtered.length ? filtered : passes;
}

/**
 * Merge independently audited runs, keep the stronger duplicate and preserve
 * complete accounting across the new batch boundary.
 * @param {Array<{results?: object[], summary?: object, dropped?: object}>} runs
 * @param {number} maxResults
 */
export function mergeDiscoveryRuns(runs, maxResults = MAX_BATCH_DISCOVERY_RESULTS) {
  const reasons = {};
  let modelReturned = 0;
  const byDomain = new Map();

  for (const run of runs || []) {
    const summary = run?.summary || {};
    modelReturned += Number(summary.modelReturned) || (run?.results || []).length;
    for (const [reason, value] of Object.entries(summary.reasons || run?.dropped || {})) {
      reasons[reason] = (reasons[reason] || 0) + (Number(value) || 0);
    }
    for (const item of run?.results || []) {
      const key = discoveryEntityKey(item);
      if (!key) continue;
      const current = byDomain.get(key);
      if (!current) {
        byDomain.set(key, item);
        continue;
      }
      reasons.duplicate_across_batches =
        (reasons.duplicate_across_batches || 0) + 1;
      if ((Number(item?.score) || 0) > (Number(current?.score) || 0)) {
        byDomain.set(key, item);
      }
    }
  }

  const unique = [...byDomain.values()].sort((left, right) => {
    // A confirmed audience mismatch must never displace a usable channel just
    // because the discovery model gave it a confident score.
    const relevanceDelta =
      Number(left?.relevance === "doubtful") -
      Number(right?.relevance === "doubtful");
    return relevanceDelta || (Number(right?.score) || 0) - (Number(left?.score) || 0);
  });
  const results = balanceDiscoveryResults(unique, maxResults);
  const overCap = unique.length - results.length;
  if (overCap > 0) reasons.over_batch_cap = (reasons.over_batch_cap || 0) + overCap;

  return {
    results,
    dropped: reasons,
    summary: {
      modelReturned,
      returned: results.length,
      dropped: droppedTotal(reasons),
      reasons,
      kept: {},
    },
  };
}
