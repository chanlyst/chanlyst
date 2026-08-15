// Channel monitoring: the part that decides whether anything actually changed.
//
// The whole point of this module is that it costs nothing. A plain HTTP fetch
// plus the pure functions below answer the two questions monitoring exists for
// — "is our listing still there?" and "did the terms change?" — without a
// single model call. Nothing here touches the database, the network or the
// clock, so tests/channel-watch.test.mjs covers all of it offline.
//
// Kept as an .mjs module so `node --test` and the TypeScript route can both
// import it, exactly like lifecycle-rules.mjs and contact-extract.mjs.

import { baseDomain, htmlToText, pageTitle } from "./contact-extract.mjs";

/**
 * Volatile page furniture that changes on every request without meaning
 * anything: clocks, counters, cache busters, CSRF tokens. Stripping it is what
 * keeps a weekly re-check from reporting "the page changed" every single week.
 */
const NOISE_PATTERNS = [
  // ISO dates and timestamps: 2026-07-27, 2026-07-27T10:11:12Z.
  /\d{4}-\d{2}-\d{2}(?:[t ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?z?)?/gi,
  // Numeric dates: 27.07.2026, 27/07/2026, 7/27/26.
  /\d{1,2}[./]\d{1,2}[./]\d{2,4}/gi,
  // Spelled-out dates in both languages: 27 июля 2026 / july 27, 2026.
  /\d{1,2}\s+(?:янв|фев|мар|апр|мая|май|июн|июл|авг|сен|окт|ноя|дек)[а-я]*\.?\s*\d{0,4}/gi,
  /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s*\d{0,4}/gi,
  // Relative times: "5 minutes ago", "2 дня назад", "just now".
  /\d+\s*(?:second|minute|hour|day|week|month|year)s?\s+ago/gi,
  /\d+\s*(?:сек|мин|час|дн|дня|дней|нед|мес|год|лет)[а-я]*\.?\s+назад/gi,
  /just now|только что|сегодня в \d{1,2}:\d{2}/gi,
  // Clock times on their own: 10:11, 10:11:12.
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/gi,
  // View / like / comment counters, both orders and both languages.
  /\d[\d\s.,]*\s*(?:k|m|тыс|млн)?\s*(?:views?|reads?|likes?|comments?|shares?|subscribers?|followers?|online|просмотр[а-я]*|лайк[а-я]*|комментари[а-я]*|подписчик[а-я]*)/gi,
  /(?:views?|likes?|comments?|просмотр[а-я]*|лайк[а-я]*)\s*[:\-]?\s*\d[\d\s.,]*/gi,
  // Cache-busting and tracking query strings on assets and links.
  /[?&](?:v|ver|version|t|ts|time|cb|cache|rand|_|nocache|hash|build)=[a-z0-9._%-]+/gi,
  // CSRF / nonce / session tokens rendered into the markup.
  /(?:csrf[_-]?token|authenticity[_-]?token|nonce|request[_-]?id|session[_-]?id|_token)["'\s:=]+[a-z0-9_%+/=-]{8,}/gi,
  // Long opaque hex/base64 blobs (build ids, signed asset URLs).
  /\b[a-f0-9]{16,}\b/gi,
];

/** Currency and pricing vocabulary in both languages the product serves. */
const PRICE_PATTERN =
  /(?:[$€₽£]\s?\d|\d[\d\s.,]*\s*(?:usd|eur|rub|руб[а-я]*|₽|\$|€|£)\b|\b(?:per\s+month|per\s+year|\/\s*mo\b|monthly|price|pricing|cost|fee|rate\s*card)\b|(?:в\s+месяц|в\s+год|цена|цены|тариф[а-я]*|стоимость|прайс|расценки))/i;

/** Characters kept on either side of the first price match. */
const PRICE_WINDOW = 100;

/** Status codes that mean the listing page itself is gone for good. */
const GONE_STATUSES = new Set([404, 410]);

/**
 * True when a status code means we never saw the page: a transport failure
 * (stored as 0) or a server-side error.
 * @param {number} statusCode
 * @returns {boolean}
 */
export function isUnreachable(statusCode) {
  const code = Number(statusCode) || 0;
  return code === 0 || code >= 500;
}

/**
 * Remove the parts of a page that change without the page meaning anything
 * different, keeping the original casing. Used both for the hash and for the
 * price excerpt — a view counter next to a price must not make the terms look
 * renegotiated. Two visits a week apart to an unchanged listing must produce
 * the same string.
 * @param {string} text
 * @returns {string}
 */
export function stripVolatile(text) {
  let value = String(text || "");
  for (const pattern of NOISE_PATTERNS) value = value.replace(pattern, " ");
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The exact string that gets hashed: volatile noise gone, lowercased,
 * whitespace collapsed.
 * @param {string} text
 * @returns {string}
 */
export function normaliseForHash(text) {
  const value = stripVolatile(text).toLowerCase();
  return value.replace(/[\s ]+/g, " ").trim();
}

/**
 * FNV-1a over the normalised text, returned as 16 hex chars. A cryptographic
 * digest would need to be async in a worker; this only has to detect change,
 * not resist an attacker, and staying synchronous keeps the module pure.
 * @param {string} value
 * @returns {string}
 */
export function contentHashOf(value) {
  const text = String(value || "");
  let fnv = 0x811c9dc5;
  let djb = 0x1505;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    fnv = Math.imul(fnv ^ code, 0x01000193) >>> 0;
    djb = (Math.imul(djb, 33) ^ code) >>> 0;
  }
  // Two independent 32-bit passes concatenated: a 64-bit fingerprint is far
  // more than enough to notice that a page changed.
  return fnv.toString(16).padStart(8, "0") + djb.toString(16).padStart(8, "0");
}

/**
 * Does this page still point at the product? Both the readable text and the
 * raw markup are searched, because a listing very often mentions the product
 * only inside an href.
 * @param {string} html
 * @param {string} text
 * @param {string} productDomain
 * @param {string} productName
 * @returns {boolean}
 */
function detectProductMention(html, text, productDomain, productName) {
  const haystack = `${text} ${html}`.toLowerCase();
  const domain = String(productDomain || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^www\./, "");
  if (domain) {
    if (haystack.includes(domain)) return true;
    const base = baseDomain(domain);
    if (base && haystack.includes(base)) return true;
    return false;
  }
  // Only when no domain is known at all does the product name stand in for it.
  const name = String(productName || "").trim().toLowerCase();
  return name.length >= 3 && haystack.includes(name);
}

/**
 * The first price-looking passage on the page, with a little context on both
 * sides so a human can read it in the task row.
 * @param {string} text
 * @returns {string}
 */
export function extractPriceExcerpt(text) {
  const value = String(text || "");
  const match = value.match(PRICE_PATTERN);
  if (!match || match.index === undefined) return "";
  const start = Math.max(0, match.index - PRICE_WINDOW);
  const end = Math.min(value.length, match.index + match[0].length + PRICE_WINDOW);
  return value.slice(start, end).replace(/\s+/g, " ").trim();
}

/**
 * Everything we store about one visit to a channel page. Pure: give it the
 * markup and it returns the four columns of a channel_snapshots row.
 *
 * @param {Object} input
 * @param {string} [input.html] Response body; '' for a failed fetch.
 * @param {string} [input.url] The URL that was actually fetched.
 * @param {number} [input.statusCode] HTTP status, 0 when the fetch failed.
 * @param {string} [input.productDomain] The user's own domain.
 * @param {string} [input.productName] Fallback when no domain is known.
 * @returns {{contentHash: string, title: string, mentionsProduct: boolean, priceExcerpt: string, statusCode: number}}
 */
export function snapshotFromPage({
  html = "",
  url = "",
  statusCode = 0,
  productDomain = "",
  productName = "",
} = {}) {
  const markup = String(html || "");
  const text = htmlToText(markup);
  // Noise is stripped once, before both the hash and the price excerpt, so a
  // ticking view counter next to the rate card cannot read as new terms.
  const stable = stripVolatile(text);
  const normalised = stable.toLowerCase();
  return {
    // An empty body hashes to '' rather than to the hash of "": that way a
    // failed fetch never looks like "the page changed to nothing".
    contentHash: normalised ? contentHashOf(normalised) : "",
    title: pageTitle(markup) || String(url || "").slice(0, 200),
    mentionsProduct: markup
      ? detectProductMention(markup, text, productDomain, productName)
      : false,
    priceExcerpt: extractPriceExcerpt(stable).slice(0, 200),
    statusCode: Number(statusCode) || 0,
  };
}

/**
 * Reduce a price passage to the thing that actually matters: the numbers and
 * the words around them. "1 000 ₽ / месяц" and "1000₽/месяц" and "$10.00" and
 * "$10" must all compare equal, so re-rendering a price bar is not a finding.
 * @param {string} value
 * @returns {string}
 */
export function normalisePriceExcerpt(value) {
  return String(value || "")
    .toLowerCase()
    // Thousand separators inside a number: 1 000 / 1,000 / 1.000 -> 1000.
    .replace(/(\d)[\s ,.](?=\d{3}\b)/g, "$1")
    // Decimal comma to a dot, so 10,50 and 10.50 are the same price.
    .replace(/(\d),(\d)/g, "$1.$2")
    // Trailing zero decimals: 10.00 -> 10, 10.50 -> 10.5.
    .replace(/(\d+\.\d*?)0+(?!\d)/g, "$1")
    .replace(/(\d+)\.(?!\d)/g, "$1")
    // Everything that is not a letter, a digit or a decimal point is
    // punctuation or layout, and neither changes what the price says.
    .replace(/[^\p{L}\p{N}.$€₽£]+/gu, " ")
    .replace(/\s\.+|\.+\s/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The numbers, currencies and billing periods inside a price passage — the
 * only part of it that can change the deal.
 */
const TERMS_TOKEN =
  /\d+(?:\.\d+)?|[$€₽£]|usd|eur|rub|руб[а-я]*|мес[а-я]*|год[а-я]*|лет|нед[а-я]*|дн[а-я]*|день|month|year|week|day|free|бесплатн[а-я]*|процент|commission|%/gi;

/**
 * Reduce a price passage to just its terms. The excerpt carries ~100 chars of
 * surrounding prose for readability, and that prose gets edited for reasons
 * that have nothing to do with money — so only the signature is compared.
 * "1 000 ₽ в месяц" and "1000₽/месяц" have the same signature; "3 500 ₽ в
 * месяц" and "1 000 ₽ в год" do not.
 * @param {string} value
 * @returns {string}
 */
export function termsSignature(value) {
  const tokens = normalisePriceExcerpt(value).match(TERMS_TOKEN) || [];
  return tokens.join(" ").toLowerCase();
}

/**
 * @typedef {Object} WatchFinding
 * @property {"listing_gone" | "page_unreachable" | "terms_changed" | "content_changed"} type
 * @property {string} [from] Previous value, for terms_changed.
 * @property {string} [to] Current value, for terms_changed.
 * @property {number} [statusCode]
 * @property {number} [failures] Consecutive failed checks, for page_unreachable.
 */

/**
 * Compare two checks of the same channel and say what, if anything, happened.
 *
 * Findings are mutually exclusive by severity: a page that is gone is not also
 * "changed". `content_changed` is deliberately informational — the runner never
 * turns it into a task, it only proves the check is alive.
 *
 * @param {Record<string, any> | null | undefined} previous The last stored snapshot.
 * @param {Record<string, any>} current The snapshot just taken.
 * @param {{previousFailures?: number}} [options] Consecutive failures before this check.
 * @returns {WatchFinding[]}
 */
export function diffSnapshots(previous, current, options = {}) {
  const now = current || {};
  const before = previous || null;
  const statusCode = Number(now.statusCode) || 0;
  const previousFailures = Math.max(0, Number(options.previousFailures) || 0);

  // A hard 404/410 is the clearest possible "the listing is gone", and it is
  // worth reporting even on the very first check.
  if (GONE_STATUSES.has(statusCode)) {
    return [{ type: "listing_gone", statusCode }];
  }

  // An unreachable page tells us nothing about its content, so no other
  // finding may be derived from it. One failure is a blip and stays silent;
  // two in a row is worth a human's attention.
  if (isUnreachable(statusCode)) {
    const failures = previousFailures + 1;
    return failures >= 2
      ? [{ type: "page_unreachable", statusCode, failures }]
      : [];
  }

  // Nothing to compare against yet: the first successful check is the baseline.
  if (!before) return [];

  const wasMentioned = Boolean(
    before.mentionsProduct === true || Number(before.mentionsProduct) === 1,
  );
  const isMentioned = Boolean(
    now.mentionsProduct === true || Number(now.mentionsProduct) === 1,
  );
  if (wasMentioned && !isMentioned) {
    return [{ type: "listing_gone", statusCode }];
  }

  const fromPrice = String(before.priceExcerpt || "");
  const toPrice = String(now.priceExcerpt || "");
  if (
    (fromPrice || toPrice) &&
    termsSignature(fromPrice) !== termsSignature(toPrice)
  ) {
    return [{ type: "terms_changed", from: fromPrice, to: toPrice, statusCode }];
  }

  const fromHash = String(before.contentHash || "");
  const toHash = String(now.contentHash || "");
  if (fromHash && toHash && fromHash !== toHash) {
    return [{ type: "content_changed", statusCode }];
  }
  return [];
}

/**
 * Map of task types to their current truth for one lead.
 *
 * `true` — the condition holds, a task should exist.
 * `false` — the condition is demonstrably resolved, a live task may be closed.
 * `null` — unknown right now (the page could not be read), so whatever task
 *          already exists is left exactly as it is.
 *
 * @param {Object} input
 * @param {Record<string, any> | null | undefined} input.previous
 * @param {Record<string, any>} input.current
 * @param {number} [input.previousFailures]
 * @param {boolean} [input.everMentioned] Did any earlier snapshot see the product?
 * @returns {{listing_missing: boolean | null, terms_changed: boolean | null, channel_unreachable: boolean | null}}
 */
export function watchConditions({
  previous,
  current,
  previousFailures = 0,
  everMentioned = false,
}) {
  const statusCode = Number(current?.statusCode) || 0;
  const findings = diffSnapshots(previous, current, { previousFailures });
  const found = new Set(findings.map((finding) => finding.type));

  if (GONE_STATUSES.has(statusCode)) {
    return {
      listing_missing: true,
      terms_changed: null,
      channel_unreachable: false,
    };
  }
  if (isUnreachable(statusCode)) {
    const failures = previousFailures + 1;
    return {
      listing_missing: null,
      terms_changed: null,
      // A single failure is not yet enough to raise the task, and not enough
      // to close one either — hence null on the first miss.
      channel_unreachable: failures >= 2 ? true : null,
    };
  }

  const isMentioned = Boolean(
    current?.mentionsProduct === true || Number(current?.mentionsProduct) === 1,
  );
  const sawItBefore =
    everMentioned ||
    Boolean(previous?.mentionsProduct === true || Number(previous?.mentionsProduct) === 1);
  return {
    // Stateful on purpose: once the product has been seen on this page, its
    // absence keeps the task open until it comes back, even though the next
    // check's "previous" snapshot no longer mentions it either.
    listing_missing: sawItBefore ? !isMentioned : found.has("listing_gone"),
    // An event, not a state: the task closes on the first check where the
    // terms did not move again.
    terms_changed: found.has("terms_changed"),
    channel_unreachable: false,
  };
}
