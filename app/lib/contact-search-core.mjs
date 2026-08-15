// Finding the page that holds the contact, rather than asking a model to
// find the contact.
//
// The crawler guesses paths — /contact, /about, /advertise, /partners — and a
// site that does not use them is invisible to it. SaaStr publishes its desk at
// /contact-saastr/, Pavilion at support.joinpavilion.com/s/contactsupport:
// neither is reachable by guessing, and both are the first thing Google
// returns for `site:<domain> contact`.
//
// Measured on Serper, 13 August:
//   site:saastr.com contact                          → contact page at #2
//   site:saastr.com contact partnerships advertising → contact page absent
//   site:saastr.com inurl:contact                    → 0 results
// One word, no operators. Extra words dilute the query, and this account does
// not support inurl: at all.
//
// Two of five domains tried returned nothing whatsoever: a small directory is
// not indexed deeply enough for any of this to help, so the guessed paths stay
// as the floor rather than being replaced.

const compact = (value, max = 200) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * @param {{domain?: string}} prospect
 * @returns {string} the query, or "" when there is no domain to search
 */
export function buildContactPageQuery(prospect = {}) {
  const domain = compact(prospect.domain, 120)
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0];
  return domain ? `site:${domain} contact` : "";
}

/** Paths that name a desk rather than an article about one. */
// A segment must BEGIN with the word. "contactsupport" and "contact-saastr"
// are desks; "ai-should-kill-contact-me-in-2025" is an article that happens to
// contain it, and "partnerships-school" is a course.
const DESK_PATH =
  /\/(contact[a-z0-9-]*|about(-us)?|advertis[a-z]*|sponsor[a-z]*|partner[a-z]*|media-?kit|submit[a-z-]*|press|write-for-us|work-with-us|collaborate)(\/|$)/i;

/**
 * Keeps only pages that belong to the prospect and look like a desk.
 *
 * Both filters matter. Google answers a site: query with neighbours when it
 * has nothing on the domain — a search for Pavilion returned
 * pavilionadvertising.com, a different company — and a blog post titled "your
 * contact form is broken" is not a contact page.
 *
 * @param {Array<{url?: string}>} candidates
 * @param {string} domain
 * @param {number} limit
 * @returns {string[]}
 */
export function contactPageUrls(candidates = [], domain = "", limit = 3) {
  const base = compact(domain, 120).replace(/^www\./i, "").toLowerCase();
  if (!base) return [];
  const seen = new Set();
  const urls = [];
  for (const item of candidates || []) {
    let parsed;
    try {
      parsed = new URL(String(item?.url || ""));
    } catch {
      continue;
    }
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    // The desk often lives on a subdomain (support.example.com), never on a
    // domain that merely contains this one as a substring.
    if (host !== base && !host.endsWith(`.${base}`)) continue;
    if (!DESK_PATH.test(parsed.pathname)) continue;
    const key = parsed.toString().replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(parsed.toString());
    if (urls.length >= limit) break;
  }
  return urls;
}
