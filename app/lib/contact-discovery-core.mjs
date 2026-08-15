// Pure query planning and result normalisation for mass outreach discovery.
// Channel discovery answers "where can this product acquire customers?".
// This module answers the separate question "which concrete organisations can
// we contact through those motions?" without asking an LLM to invent either.

const compact = (value, max = 180) =>
  String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const SEARCH_PATTERNS = [
  "companies",
  "businesses",
  "providers",
  "vendors",
  "firms",
  "agencies",
  "organizations",
  "startups",
  "services",
  "solutions",
  "suppliers",
  "consultancies",
  "association members",
  "marketplace sellers",
  "industry directory",
  "company list",
];

const BLOCKED_HOSTS = new Set([
  "google.com",
  "bing.com",
  "yahoo.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "youtube.com",
  "reddit.com",
  "wikipedia.org",
]);

function productTerms(product = {}) {
  const supplied = Array.isArray(product?.analysis?.searchQueries)
    ? product.analysis.searchQueries
    : [];
  const values = [
    ...supplied,
    product.audience,
    product.category,
    product.description,
    product.name,
  ]
    .map((value) => compact(value, 120))
    .filter(Boolean);
  return [...new Set(values)].slice(0, 8);
}

/** Number of distinct deterministic searches available for this product. */
export function contactQueryCount(product = {}) {
  return Math.max(1, productTerms(product).length) * SEARCH_PATTERNS.length;
}

/**
 * Stable query at `index`, so a persisted background run can resume from its
 * integer counter without storing prompts or repeating paid searches.
 */
export function buildContactSearchQuery(product = {}, index = 0) {
  const terms = productTerms(product);
  const safeTerms = terms.length ? terms : ["business software customers"];
  const at = Math.max(0, Math.floor(Number(index) || 0));
  const term = safeTerms[at % safeTerms.length];
  const pattern = SEARCH_PATTERNS[Math.floor(at / safeTerms.length) % SEARCH_PATTERNS.length];
  const geography = compact(product.geography || "", 70);
  return `"${term}" ${pattern}${geography ? ` ${geography}` : ""} -jobs -careers`;
}

function baseDomain(hostname) {
  const labels = String(hostname || "")
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const second = labels.at(-2);
  if (/^(co|com|org|net|gov|edu|ac)$/.test(second || "")) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

export function normaliseContactSearchResults(response = {}) {
  const seen = new Set();
  const rows = [];
  for (const item of response?.organic || []) {
    const rawUrl = compact(item?.link, 1200);
    if (!rawUrl) continue;
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    const domain = baseDomain(url.hostname);
    if (!domain || BLOCKED_HOSTS.has(domain) || seen.has(domain)) continue;
    seen.add(domain);
    const title = compact(item?.title, 180);
    rows.push({
      company: compact(title.split(/[|–—]/)[0], 160) || domain,
      domain,
      url: url.toString(),
      description: compact(item?.snippet, 600),
      source: "serper",
    });
  }
  return rows;
}
