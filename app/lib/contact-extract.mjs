// Pure contact-extraction helpers shared by the enrichment route, the offline
// measurement harness and unit tests. Kept as an .mjs module so both
// `node --test tests/*.test.mjs` and the TypeScript route can import it.
//
// The goal is to answer "who do we write to?" from the page markup itself
// whenever the answer is unambiguous, so the expensive LLM call can be skipped,
// and to shrink the prompt to relevant excerpts when the LLM is still needed.

import { isValidEmail } from "./security-helpers.mjs";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Pages and link labels that plausibly host a business contact. */
export const CONTACT_KEYWORD =
  /contact|contacts|about|team|advertis|partner|press|связ|контакт|реклам|сотрудни/i;

/** Chars kept per page by the legacy pipeline. */
export const LEGACY_PAGE_CHARS = 16_000;
/** Chars sent to the model by the legacy pipeline. */
export const LEGACY_TOTAL_CHARS = 36_000;

const ASSET_SUFFIXES = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "css",
  "js",
  "json",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "mp4",
  "webm",
  "pdf",
];

const BLOCKED_LOCAL_PARTS =
  /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|noreply|bounce|mailer[-_.]?daemon|postmaster|abuse|unsubscribe)/i;

/** Infrastructure and platform vendors that never own the channel's inbox. */
const VENDOR_DOMAINS = [
  "example.com",
  "example.org",
  "example.net",
  "sentry.io",
  "sentry-next.wixpress.com",
  "wixpress.com",
  "wix.com",
  "cloudflare.com",
  "godaddy.com",
  "secureserver.net",
  "automattic.com",
  "wordpress.com",
  "wordpress.org",
  "shopify.com",
  "squarespace.com",
  "weebly.com",
  "webflow.com",
  "tilda.cc",
  "w3.org",
  "schema.org",
  "sentry.wixpress.com",
  "googleapis.com",
  "gstatic.com",
  "jsdelivr.net",
  "domain.com",
  "yourdomain.com",
  "email.com",
  "sitename.com",
];

/** Local parts that are role mailboxes and stay trustworthy off-domain. */
const ROLE_LABELS = [
  [/^(info|hello|hi|mail|office|admin|inbox|general)$/i, "Общие вопросы"],
  [/^(contact|contacts|contactus|kontakt)$/i, "Контакты"],
  [/^(ads|adv|advert|advertise|advertising|reklama|media)$/i, "Реклама"],
  [
    /^(partner|partners|partnership|partnerships|affiliate|affiliates|bd|business)$/i,
    "Партнёрства",
  ],
  [/^(press|pr)$/i, "Пресса"],
  [/^(sales|marketing|order|orders)$/i, "Продажи"],
  [/^(support|help|helpdesk|care)$/i, "Поддержка"],
  [/^(editor|editorial|edit|news|redaction|content)$/i, "Редакция"],
];

/**
 * @param {string} email
 * @returns {string}
 */
function localPart(email) {
  return email.slice(0, email.lastIndexOf("@"));
}

/**
 * @param {string} email
 * @returns {string}
 */
function emailDomain(email) {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

/**
 * True when the local part is a well-known role mailbox.
 * @param {string} email
 * @returns {boolean}
 */
export function isRoleAddress(email) {
  const local = localPart(String(email || "")).toLowerCase();
  return ROLE_LABELS.some(([pattern]) => /** @type {RegExp} */ (pattern).test(local));
}

/**
 * Localised human label for a role mailbox, used as contact_role.
 * @param {string} email
 * @returns {string}
 */
export function roleLabelForEmail(email) {
  const local = localPart(String(email || "")).toLowerCase();
  for (const [pattern, label] of ROLE_LABELS) {
    if (/** @type {RegExp} */ (pattern).test(local)) return String(label);
  }
  return "Общие вопросы";
}

/**
 * Reduce a hostname to its registrable-ish base so that
 * blog.example.co.uk and www.example.co.uk compare equal.
 * @param {string} hostname
 * @returns {string}
 */
export function baseDomain(hostname) {
  const labels = String(hostname || "")
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const secondLevel = labels[labels.length - 2];
  if (/^(co|com|org|net|gov|edu|ac)$/.test(secondLevel) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
export function sameSite(left, right) {
  const a = baseDomain(left);
  const b = baseDomain(right);
  return Boolean(a && b && a === b);
}

/**
 * Reject addresses that are clearly not a business contact: bounce mailboxes,
 * vendor/platform inboxes, asset filenames mis-parsed as e-mail, and unrelated
 * domains that are not role mailboxes.
 * @param {string} email
 * @param {string} [siteDomain]
 * @returns {boolean}
 */
export function isNonContactEmail(email, siteDomain = "") {
  const value = String(email || "").trim().toLowerCase();
  if (!isValidEmail(value)) return true;
  if (BLOCKED_LOCAL_PARTS.test(localPart(value))) return true;
  const domain = emailDomain(value);
  const suffix = domain.slice(domain.lastIndexOf(".") + 1);
  if (ASSET_SUFFIXES.includes(suffix)) return true;
  if (/\d+x$/.test(domain) || domain.includes("..")) return true;
  if (VENDOR_DOMAINS.some((vendor) => domain === vendor || domain.endsWith(`.${vendor}`))) {
    return true;
  }
  if (siteDomain && !sameSite(domain, siteDomain) && !isRoleAddress(value)) return true;
  return false;
}

/**
 * Turn markup into readable text the way the enrichment pipeline always has.
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * @param {string} html
 * @returns {string}
 */
export function pageTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  return match ? htmlToText(match[1]).trim().slice(0, 200) : "";
}

/**
 * @param {string} value
 * @returns {string}
 */
function decodeMailto(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Collect every e-mail on a page together with the evidence that makes it
 * trustworthy: whether it came from a mailto: link, whether the link label
 * looks contact related, and a short snippet around the first occurrence.
 * @param {string} html
 * @returns {Array<{email: string, mailto: boolean, linkKeyword: boolean, snippet: string}>}
 */
export function harvestEmailCandidates(html) {
  const markup = String(html || "");
  const text = htmlToText(markup);
  /** @type {Map<string, {email: string, mailto: boolean, linkKeyword: boolean, snippet: string}>} */
  const found = new Map();

  /**
   * @param {string} raw
   * @param {{mailto?: boolean, linkKeyword?: boolean}} flags
   */
  const add = (raw, flags) => {
    const email = String(raw || "").trim().toLowerCase().replace(/[.,;:]+$/, "");
    if (!email.includes("@")) return;
    const entry = found.get(email) || {
      email,
      mailto: false,
      linkKeyword: false,
      snippet: "",
    };
    entry.mailto = entry.mailto || Boolean(flags.mailto);
    entry.linkKeyword = entry.linkKeyword || Boolean(flags.linkKeyword);
    found.set(email, entry);
  };

  for (const match of markup.matchAll(/href\s*=\s*["']?\s*mailto:([^"'>\s?&]+)/gi)) {
    add(decodeMailto(match[1]), { mailto: true });
  }
  for (const match of markup.matchAll(/<a\b([^>]*)>([\s\S]{0,600}?)<\/a>/gi)) {
    const attributes = match[1] || "";
    const label = htmlToText(match[2] || "");
    const keyword = CONTACT_KEYWORD.test(`${decodeMailto(attributes)} ${label}`);
    for (const email of `${decodeMailto(attributes)} ${label}`.match(EMAIL_PATTERN) || []) {
      add(email, { linkKeyword: keyword });
    }
  }
  for (const email of text.match(EMAIL_PATTERN) || []) add(email, {});
  for (const email of markup.match(EMAIL_PATTERN) || []) add(email, {});

  for (const entry of found.values()) {
    const source = text.toLowerCase().includes(entry.email) ? text : markup;
    const at = source.toLowerCase().indexOf(entry.email);
    entry.snippet =
      at < 0
        ? entry.email
        : source.slice(Math.max(0, at - 140), at + entry.email.length + 140).trim();
  }
  return [...found.values()];
}

/**
 * @param {string} value
 * @returns {string}
 */
export function harvestTelegram(value) {
  return (
    String(value || "").match(/(?:https?:\/\/)?t\.me\/[A-Za-z0-9_]{4,}/i)?.[0] || ""
  );
}

/**
 * A Telegram channel found as a search result IS its own contact — the handle
 * is in the URL. Nothing needs to be fetched or inferred, so the enrichment
 * step (the most expensive one we run) never has to touch it.
 *
 * t.me/s/name is the indexed web preview of t.me/name; both name the same
 * channel, and the /s/ form is the one Google returns. Reserved paths like
 * joinchat and the +invite form identify no public channel and yield nothing.
 * @param {string} url
 * @returns {string} canonical t.me/<handle>, or "" when the URL names none
 */
const TELEGRAM_RESERVED = new Set(["s", "joinchat", "share", "addstickers", "proxy", "socks"]);

export function telegramHandleFromUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "t.me" && host !== "telegram.me") return "";
  const parts = parsed.pathname.split("/").filter(Boolean);
  // t.me/s/<handle> — drop the preview segment and keep the channel.
  const handle = parts[0] === "s" ? parts[1] : parts[0];
  if (!handle || TELEGRAM_RESERVED.has(handle.toLowerCase())) return "";
  if (handle.startsWith("+")) return "";
  if (!/^[A-Za-z0-9_]{4,}$/.test(handle)) return "";
  return `t.me/${handle}`;
}

/**
 * Decide whether a page yields a contact e-mail we trust enough to skip the
 * LLM entirely. Conservative by design: the address must come from a mailto:
 * link or a contact-ish page/link, pass isValidEmail, and survive the
 * non-contact filters.
 * @param {{html: string, pageUrl: string, siteDomain?: string}} input
 * @returns {{email: string, role: string, sourceUrl: string, evidence: string} | null}
 */
export function findConfidentEmail({ html, pageUrl, siteDomain = "" }) {
  const pageIsContactish = CONTACT_KEYWORD.test(decodeMailto(String(pageUrl || "")));
  const accepted = harvestEmailCandidates(html)
    .filter(
      (candidate) =>
        (candidate.mailto || candidate.linkKeyword || pageIsContactish) &&
        isValidEmail(candidate.email) &&
        !isNonContactEmail(candidate.email, siteDomain),
    )
    .map((candidate) => ({
      candidate,
      score:
        (candidate.mailto ? 4 : 0) +
        (siteDomain && sameSite(emailDomain(candidate.email), siteDomain) ? 2 : 0) +
        (isRoleAddress(candidate.email) ? 1 : 0),
    }))
    .sort((left, right) => right.score - left.score);
  const best = accepted[0]?.candidate;
  if (!best) return null;
  return {
    email: best.email,
    role: roleLabelForEmail(best.email),
    sourceUrl: String(pageUrl),
    evidence: best.snippet.slice(0, 300),
  };
}

// ---------------------------------------------------------------------------
// Supply-side detection: a channel that publishes no contact at all is not
// necessarily a dead end. When its outbound links run through an affiliate
// network, the route to that publisher is to register as an advertiser in the
// network, not to write an e-mail nobody reads.
// ---------------------------------------------------------------------------

/**
 * Unmistakable network hosts. Deliberately short: the generic tracker markers
 * below carry most of the recall, this list only names what it recognises.
 * @type {Array<[RegExp, string]>}
 */
const AFFILIATE_NETWORK_HOSTS = [
  [/(^|\.)(impact\.com|impactradius\.com|pxf\.io|sjv\.io|ojrq\.net)$/i, "Impact"],
  [
    /(^|\.)(anrdoezrs\.net|dpbolvw\.net|kqzyfj\.com|jdoqocy\.com|tkqlhce\.com|cj\.com)$/i,
    "CJ Affiliate",
  ],
  [/(^|\.)shareasale\.com$/i, "ShareASale"],
  [/(^|\.)(awin1\.com|awin\.com|zenaps\.com)$/i, "Awin"],
  [/(^|\.)linksynergy\.com$/i, "Rakuten Advertising"],
  [/(^|\.)partnerstack\.com$/i, "PartnerStack"],
  [/(^|\.)(fprom\.co|firstpromoter\.com)$/i, "FirstPromoter"],
  [/(^|\.)tapfiliate\.com$/i, "Tapfiliate"],
  [/(^|\.)clickbank\.net$/i, "ClickBank"],
  [/(^|\.)digistore24\.com$/i, "Digistore24"],
  [/(^|\.)admitad\.com$/i, "Admitad"],
  [/(^|\.)everflowclient\.io$/i, "Everflow"],
  [/(^|\.)go2cloud\.org$/i, "TUNE"],
  [/(^|\.)(skimresources\.com|skimlinks\.com)$/i, "Skimlinks"],
  [/(^|\.)viglink\.com$/i, "Sovrn Commerce"],
  [/(^|\.)refersion\.com$/i, "Refersion"],
  [/(^|\.)postaffiliatepro\.com$/i, "Post Affiliate Pro"],
];

/**
 * Query parameters that only exist to attribute a click to a partner.
 * The strong ones belong to tracker infrastructure; `ref`/`via` also appear on
 * ordinary referral links, so they rank lower when both are present.
 */
const AFFILIATE_PARAM_STRONG =
  /^(aff|affid|aff_id|affiliate|affiliate_id|aff_sub\d*|sub_?id\d*|sub\d|a_aid|irclickid|clickid)$/i;
const AFFILIATE_PARAM_WEAK = /^(ref|via)$/i;

/** Redirector paths used by trackers ("/click?...", "/go/...", "/out?..."). */
const AFFILIATE_PATH = /^\/(click|go|out|aff|redirect|track)(\/|$)/i;

/** Marker written in front of an affiliate hint stored in contact_evidence. */
export const AFFILIATE_HINT_PREFIX = "affiliate_network:";

/**
 * @param {string} host
 * @returns {string} network label, or "" when the host is not a known network
 */
function knownNetwork(host) {
  for (const [pattern, label] of AFFILIATE_NETWORK_HOSTS) {
    if (pattern.test(host)) return String(label);
  }
  return "";
}

/**
 * Look for affiliate-network fingerprints in a page's outbound links.
 *
 * Pure and cheap: no network, no parsing beyond `href` attributes. The best
 * hint on the page wins: a named network first, then a tracker parameter, then
 * a bare referral marker — so a merchant link carrying `?ref=` never hides the
 * network redirector further down the page.
 *
 * @param {string} html
 * @param {string} [siteDomain] Own domain, so self-links are ignored.
 * @returns {{network: string, domain: string, url: string, markers: string[], rank: number} | null}
 */
export function detectAffiliateNetwork(html, siteDomain = "") {
  const markup = String(html || "");
  /** @type {{network: string, domain: string, url: string, markers: string[], rank: number} | null} */
  let best = null;
  let bestRank = 0;
  for (const match of markup.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = decodeMailto(String(match[1] || "").trim());
    if (!/^https?:\/\//i.test(href)) continue;
    let url;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (siteDomain && sameSite(host, siteDomain)) continue;
    const network = knownNetwork(host);
    /** @type {string[]} */
    const markers = [];
    let rank = network ? 3 : 0;
    for (const name of url.searchParams.keys()) {
      if (AFFILIATE_PARAM_STRONG.test(name)) {
        markers.push(`${name}=`);
        rank = Math.max(rank, 2);
      } else if (AFFILIATE_PARAM_WEAK.test(name)) {
        markers.push(`${name}=`);
        rank = Math.max(rank, 1);
      }
    }
    if (AFFILIATE_PATH.test(url.pathname) && url.search) {
      markers.push(url.pathname);
      rank = Math.max(rank, 2);
    }
    if (!rank || rank <= bestRank) continue;
    bestRank = rank;
    best = {
      network: network || host,
      domain: host,
      url: url.toString(),
      markers,
      rank,
    };
    if (rank === 3) break;
  }
  return best;
}

/**
 * Chars of markup scanned for affiliate links, per page.
 *
 * Deliberately far above the 250 000 the fetcher used to keep: this pass is a
 * local regex over `href` attributes, it costs no tokens and no network. On
 * datingdroid.com (963 KB) the first affiliate link sits at byte 768 894, so
 * the old limit hid the only evidence the page had. The text sent to the model
 * is capped separately and stays small.
 */
export const LINK_SCAN_CHARS = 2_000_000;

/**
 * Run the detector over EVERY fetched page, not just the contact-ish ones, and
 * keep the strongest hint found anywhere on the site.
 *
 * @param {readonly string[]} markups Raw HTML of each fetched page.
 * @param {string} [siteDomain]
 * @param {number} [limit] Per-page scan cap.
 * @returns {ReturnType<typeof detectAffiliateNetwork>}
 */
export function detectAffiliateNetworkAcrossPages(
  markups,
  siteDomain = "",
  limit = LINK_SCAN_CHARS,
) {
  let best = null;
  for (const markup of Array.isArray(markups) ? markups : []) {
    const hint = detectAffiliateNetwork(String(markup || "").slice(0, limit), siteDomain);
    if (hint && (!best || hint.rank > best.rank)) best = hint;
    if (best?.rank === 3) break;
  }
  return best;
}

/**
 * One-line evidence for a detected network, stored in contact_evidence and
 * parsed back by the dashboard card.
 * @param {{network: string, domain: string, url: string, markers: string[]}} hint
 * @returns {string}
 */
export function formatAffiliateHint(hint) {
  const parts = [hint.network, hint.markers.join(" "), hint.url].filter(Boolean);
  return `${AFFILIATE_HINT_PREFIX} ${parts.join(" · ")}`.slice(0, 1000);
}

/**
 * Network name inside a stored contact_evidence line, or "" when the line is
 * an ordinary contact excerpt.
 * @param {string} evidence
 * @returns {string}
 */
export function parseAffiliateHint(evidence) {
  const value = String(evidence || "").trim();
  if (!value.toLowerCase().startsWith(AFFILIATE_HINT_PREFIX)) return "";
  return value.slice(AFFILIATE_HINT_PREFIX.length).split("·")[0].trim();
}

/**
 * The same stored line, read in full: the network name, the tracker URL and
 * the host the user actually has to register with. `formatAffiliateHint`
 * drops empty parts, so the URL is located by shape rather than by position.
 *
 * @param {string} evidence
 * @returns {{network: string, url: string, domain: string} | null}
 */
export function parseAffiliateHintDetails(evidence) {
  const network = parseAffiliateHint(evidence);
  if (!network) return null;
  const parts = String(evidence || "")
    .trim()
    .slice(AFFILIATE_HINT_PREFIX.length)
    .split("·")
    .map((part) => part.trim());
  const url = parts.find((part) => /^https?:\/\//i.test(part)) || "";
  let domain = "";
  try {
    domain = url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    domain = "";
  }
  return { network, url, domain: domain || network };
}

/**
 * Decide what enrichment should record when the page yielded no contact.
 * Returns null when nothing should change — in particular when a contact WAS
 * found, or when no network fingerprint exists. `nextAction` is only proposed
 * for an empty field: whatever the user (or an earlier run) wrote stays.
 *
 * @param {{hasContact: boolean, hint: ReturnType<typeof detectAffiliateNetwork>, currentNextAction?: string}} input
 * @returns {{contactEvidence: string, nextAction: string | null} | null}
 */
export function planAffiliateHint({ hasContact, hint, currentNextAction = "" }) {
  if (hasContact || !hint) return null;
  return {
    contactEvidence: formatAffiliateHint(hint),
    nextAction: String(currentNextAction || "").trim()
      ? null
      : `Зарегистрироваться как рекламодатель в партнёрской сети ${hint.network}.`,
  };
}

/** Chars of markup kept for e-mail harvesting and the text digest. */
export const CONTACT_MARKUP_CHARS = 250_000;

/**
 * Every address in a blob, minus the shapes that are never a business inbox.
 * Same rule the enrichment route has always applied — deliberately looser than
 * `isNonContactEmail`, because this list is also what verifies an address the
 * model returns as "published on the site".
 *
 * @param {string} value
 * @returns {string[]}
 */
export function harvestPlainEmails(value) {
  return [
    ...new Set(
      (String(value || "").match(EMAIL_PATTERN) || []).map((email) =>
        email.toLowerCase(),
      ),
    ),
  ].filter(
    (email) =>
      !email.endsWith("@example.com") &&
      !email.includes("sentry") &&
      !email.endsWith(".png") &&
      !email.endsWith(".jpg"),
  );
}

/**
 * Everything the enrichment step derives from the pages it fetched, assembled
 * in one pure place so the whole path can be exercised offline against a
 * fixture instead of only through a live crawl.
 *
 * The two limits are deliberately different: `linkScanChars` is a local regex
 * pass over `href` attributes and costs nothing, so it sees the whole page,
 * while `digestChars` bounds the only part that is paid for per token.
 *
 * @param {ReadonlyArray<{url: string, html: string}>} pages
 * @param {{siteDomain?: string, digestChars?: number, pageChars?: number, maxEmails?: number, linkScanChars?: number, markupChars?: number}} [options]
 * @returns {{text: string, emails: string[], telegram: string, pages: string[], affiliate: ReturnType<typeof detectAffiliateNetwork>}}
 */
export function buildPageEvidence(pages, options = {}) {
  const {
    siteDomain = "",
    digestChars = 4_000,
    pageChars = 12_000,
    maxEmails = 12,
    linkScanChars = LINK_SCAN_CHARS,
    markupChars = CONTACT_MARKUP_CHARS,
  } = options;
  const list = (Array.isArray(pages) ? pages : []).filter((page) => page?.html);

  const excerpts = [];
  const markups = [];
  const texts = [];
  for (const page of list) {
    const markup = String(page.html).slice(0, markupChars);
    markups.push(markup);
    const text = htmlToText(markup).slice(0, pageChars);
    texts.push(text);
    excerpts.push({ url: String(page.url || ""), title: pageTitle(markup), text });
  }
  const combined = texts.join("\n");
  const contactMarkup = markups.join("\n");

  return {
    // Hard-capped twice: the digest builder stops at `digestChars` of excerpt,
    // and the header it prepends is trimmed off by the final slice.
    text: buildContactDigest(excerpts, { limit: digestChars }).slice(0, digestChars),
    emails: harvestPlainEmails(`${contactMarkup}\n${combined}`).slice(0, maxEmails),
    telegram: harvestTelegram(contactMarkup) || harvestTelegram(combined) || "",
    pages: list.map((page) => String(page.url || "")),
    // Scanned across EVERY fetched page at the link-scan limit, not just the
    // contact-ish ones at 250 000 chars.
    affiliate: detectAffiliateNetworkAcrossPages(
      list.map((page) => String(page.html)),
      siteDomain,
      linkScanChars,
    ),
  };
}

/**
 * Legacy prompt payload, kept only so the measurement harness can compare
 * old and new prompt sizes.
 * @param {string[]} texts
 * @returns {string}
 */
export function legacyDigest(texts) {
  return texts
    .map((text) => String(text || "").slice(0, LEGACY_PAGE_CHARS))
    .join("\n")
    .slice(0, LEGACY_TOTAL_CHARS);
}

const DIGEST_ANCHOR =
  /@|mailto:|t\.me|telegram|contact|about|team|advertis|partner|press|связ|контакт|реклам|сотрудни/gi;

/**
 * Build a focused excerpt digest instead of shipping whole pages to the model:
 * a window around every contact-looking anchor, overlapping windows merged,
 * hard-capped. Falls back to the head of the main page when nothing matches.
 * @param {Array<{url: string, title?: string, text: string}>} pages
 * @param {{window?: number, limit?: number, fallback?: number}} [options]
 * @returns {string}
 */
export function buildContactDigest(pages, options = {}) {
  const windowSize = options.window ?? 400;
  const limit = options.limit ?? 6_000;
  const fallback = options.fallback ?? 4_000;
  const half = Math.floor(windowSize / 2);
  const list = (pages || []).filter((page) => page && typeof page.text === "string");

  const header = list
    .map((page) => `${page.url}${page.title ? ` — ${page.title}` : ""}`)
    .join("\n");

  /** @type {string[]} */
  const excerpts = [];
  let used = 0;
  for (const page of list) {
    /** @type {Array<[number, number]>} */
    const windows = [];
    DIGEST_ANCHOR.lastIndex = 0;
    for (const match of page.text.matchAll(DIGEST_ANCHOR)) {
      const at = match.index ?? 0;
      const start = Math.max(0, at - half);
      const end = Math.min(page.text.length, at + (match[0]?.length || 1) + half);
      const previous = windows[windows.length - 1];
      if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
      else windows.push([start, end]);
    }
    for (const [start, end] of windows) {
      if (used >= limit) break;
      const piece = page.text.slice(start, Math.min(end, start + (limit - used)));
      if (!piece.trim()) continue;
      excerpts.push(piece.trim());
      used += piece.length;
    }
    if (used >= limit) break;
  }

  const body = excerpts.length
    ? excerpts.join("\n…\n")
    : (list[0]?.text || "").slice(0, fallback);
  return `${header}\n${body}`.trim();
}
