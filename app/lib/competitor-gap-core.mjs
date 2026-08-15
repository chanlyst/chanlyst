// "Your competitor is listed here and you are not."
//
// The obvious way to build this is to ask the web where a competitor appears.
// Measured on Serper, 14 August, and it does not work:
//
//   "clay.com" -site:clay.com          0 results — the operator is ignored
//   "Clay" alternatives                alabamaclaycounty.com, a ceramics
//                                      network, "Tales of a Red Clay Rambler"
//   "SparkToro" review platform tools  backlinko, cognism, lindy.ai — articles
//                                      and rival vendors writing comparisons
//
// A one-word brand is drowned by its homonyms, and the best-looking queries
// return commentary rather than placements.
//
// Inverting it works. We already hold a catalogue of channels for this
// product, so instead of asking where the competitor is, ask each channel
// whether the competitor is on it:
//
//   site:g2.com "SparkToro"           → g2.com/products/sparktoro/reviews
//   site:producthunt.com "SparkToro"  → producthunt.com/products/sparktoro
//   site:producthunt.com "Chanlyst"   → 0
//
// One credit per channel per brand, an answer that is checkable by opening the
// link, and the gap falls out of the difference.

const compact = (value, max = 120) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

/** @param {string} value @returns {string} */
export function bareDomain(value) {
  return compact(value, 160)
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .toLowerCase();
}

/**
 * The forms of a brand that can appear inside a listing URL.
 *
 * G2 writes /products/sparktoro/, Product Hunt /products/sparktoro, and a
 * two-word brand may be hyphenated, joined or neither. The registrable name
 * from the domain is included because a listing often uses it verbatim.
 *
 * @param {{name?: string, domain?: string}} brand
 * @returns {string[]}
 */
export function brandSlugs(brand = {}) {
  const name = compact(brand.name, 60).toLowerCase();
  const domain = bareDomain(brand.domain);
  const stem = domain.split(".")[0];
  const words = name.split(/[^a-z0-9]+/i).filter(Boolean);
  const slugs = new Set();
  if (words.length) {
    slugs.add(words.join("-"));
    slugs.add(words.join(""));
    // A single distinctive word is enough; "clay" alone is not, but that is
    // handled by requiring the slug to appear in the PATH of a page on the
    // channel's own domain, not anywhere on the web.
    if (words.length === 1) slugs.add(words[0]);
  }
  if (stem && stem.length >= 3) slugs.add(stem);
  return [...slugs].filter((slug) => slug.length >= 3);
}

/**
 * @param {string} channelDomain
 * @param {{name?: string, domain?: string}} brand
 * @returns {string} "" when there is nothing to ask
 */
export function buildPresenceQuery(channelDomain, brand = {}) {
  const site = bareDomain(channelDomain);
  const name = compact(brand.name, 60) || bareDomain(brand.domain).split(".")[0];
  if (!site || !name) return "";
  return `site:${site} "${name}"`;
}

/**
 * Is the brand actually listed on this channel, or merely mentioned by it?
 *
 * Capterra answered `site:capterra.com "SparkToro"` with a review page for
 * Social-Animal that names SparkToro in its comparison text. That is a mention
 * and not a placement, and shipping it as one would put a claim in front of
 * the user that falls apart the moment they open the link.
 *
 * So the page has to live on the channel and carry the brand in its path.
 *
 * @param {Array<{url?: string, title?: string}>} results
 * @param {string} channelDomain
 * @param {{name?: string, domain?: string}} brand
 * @returns {{present: boolean, url: string}}
 */
export function presenceFromResults(results = [], channelDomain = "", brand = {}) {
  const site = bareDomain(channelDomain);
  const slugs = brandSlugs(brand);
  if (!site || !slugs.length) return { present: false, url: "" };
  for (const item of results || []) {
    let parsed;
    try {
      parsed = new URL(String(item?.url || ""));
    } catch {
      continue;
    }
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== site && !host.endsWith(`.${site}`)) continue;
    // A whole path SEGMENT, never a substring.
    //
    // "contains the brand" was too weak by far. Run against 25 real channels
    // on 14 August it returned thirteen hits of which four were listings; the
    // rest were articles whose slug happens to carry the name, or a different
    // thing with the same one:
    //
    //   /mag/behind-clays-explosive-growth      an article about Clay
    //   /u/claykelly                            a person called Clay Kelly
    //   /r/explainlikeimfive/.../what_is_clay   the material
    //   /r/apolloapp/...                        a Reddit client
    //   /case-studies/apollo-neuro-case-study   a wearable
    //   /product/guest-post-on-clay-pl          a Polish site, clay.pl
    //
    // Segment equality keeps /tools/clay, /page/apollo and
    // /integrations/clay, and rejects every one of those. It also loses
    // youtube.com/c/apolloio, which is a real page — a trade worth making,
    // because a wrong claim costs more than a missed one.
    const segments = parsed.pathname.toLowerCase().split("/").filter(Boolean);
    if (segments.some((segment) => slugs.includes(segment))) {
      return { present: true, url: parsed.toString() };
    }
  }
  return { present: false, url: "" };
}

/**
 * The channels a competitor occupies and the product does not.
 *
 * Only a confirmed presence counts as a gap: "we could not find you there"
 * is not the same as "you are not there", and the weaker claim is the one
 * worth making to a user who is about to spend an afternoon on it.
 *
 * @param {Array<{domain: string, competitors: Array<{name: string, url: string}>, self: boolean}>} rows
 * @returns {Array<{domain: string, competitors: Array<{name: string, url: string}>}>}
 */
export function distributionGaps(rows = []) {
  return (rows || [])
    .filter((row) => !row?.self && (row?.competitors || []).length > 0)
    .map((row) => ({ domain: row.domain, competitors: row.competitors }))
    .sort((left, right) => right.competitors.length - left.competitors.length);
}
