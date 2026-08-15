// Where a visitor came from, reduced to four short labels and a country.
//
// This exists because an ad click and a signup were the only two things we
// could see, and everything interesting happens between them. It records the
// source of a visit and nothing about the visitor: no address, no user agent,
// no full URL. A referrer keeps its host and loses its path, because paths
// carry search queries and personal identifiers and we have no use for them.

/** Longest label we keep. Anything longer is a tracking payload, not a name. */
const MAX_LABEL = 64;

/**
 * Trims a label to something safe to store and group by: lowercase, no control
 * characters, no runaway length. Returns "" for anything unusable.
 */
export function cleanLabel(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, MAX_LABEL);
}

/** The host of a referrer, or "" when there isn't a usable one. */
export function referrerHost(referer) {
  const raw = String(referer ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return cleanLabel(url.hostname.replace(/^www\./, ""));
  } catch {
    return "";
  }
}

// Hosts that are a redirector rather than a place. t.co is every link posted
// on X, so a visit through it is an X visit even when the campaign tags were
// stripped along the way.
const HOST_SOURCES = {
  "t.co": "x",
  "x.com": "x",
  "twitter.com": "x",
  "lnkd.in": "linkedin",
  "linkedin.com": "linkedin",
  "news.ycombinator.com": "hackernews",
  "reddit.com": "reddit",
  "out.reddit.com": "reddit",
  "producthunt.com": "producthunt",
};

/**
 * The source of a visit: the campaign tags when they survived the trip, the
 * referring host when they did not, "direct" when there is nothing at all.
 *
 * `params` is anything with a .get(), so both URLSearchParams and a plain
 * object wrapper work.
 */
export function visitSource(params, referer) {
  const get = (key) =>
    cleanLabel(typeof params?.get === "function" ? params.get(key) : params?.[key]);

  const host = referrerHost(referer);
  const taggedSource = get("utm_source");
  const source = taggedSource || HOST_SOURCES[host] || host || "direct";

  return {
    source,
    // An untagged visit through a known redirector is still paid or organic
    // social; we simply cannot tell which, so we say nothing rather than guess.
    medium: get("utm_medium") || (taggedSource ? "" : host ? "referral" : "none"),
    campaign: get("utm_campaign"),
    content: get("utm_content"),
    referrerHost: host,
  };
}

// Crawlers, link checkers and uptime monitors outnumber people on a small site
// and would quietly double every number in the panel. X itself fetches a page
// to build the link card, so the ad's own destination gets hit before anyone
// clicks it.
const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|scrape|monitor|uptime|curl|wget|python-requests|headless|lighthouse|pingdom|facebookexternalhit|embedly|whatsapp|telegrambot/i;

export function isBot(userAgent) {
  const agent = String(userAgent ?? "").trim();
  // A browser always says something. Silence is a script.
  if (!agent) return true;
  return BOT_PATTERN.test(agent);
}


/** The campaign tags to carry across an internal link, as a query string. */
export function forwardedCampaign(params) {
  const carried = new URLSearchParams();
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
    const raw = typeof params?.get === "function" ? params.get(key) : params?.[key];
    const value = cleanLabel(Array.isArray(raw) ? raw[0] : raw);
    if (value) carried.set(key, value);
  }
  return carried.toString();
}
