// What a candidate site SAYS IT IS, taken from the site itself.
//
// Discovery used to verify candidates by asking whether the model had cited
// them. That check guarded the wrong thing: every domain the model returned
// turned out to be real and reachable. The failure that actually reached the
// channel list was a live, correctly described site aimed at the wrong
// audience — a 55+ retirement forum returned as a paid placement for an adult
// AI product because both are described as "adult".
//
// A citation would have confirmed that page: it exists, and the search really
// did visit it. Its own title and description are what expose the mismatch,
// so those are what we read, straight from the page and free of model
// opinion.

/** Longest title we keep; anything past this is decoration. */
export const MAX_TITLE_CHARS = 160;

/** Longest description we keep. */
export const MAX_DESCRIPTION_CHARS = 400;

/** Only this much HTML is scanned: <head> comes first in every real page. */
export const IDENTITY_SCAN_CHARS = 200_000;

const NAMED_ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
  ["ndash", "–"],
  ["mdash", "—"],
  ["hellip", "…"],
  ["#39", "'"],
  ["#x27", "'"],
  ["#34", '"'],
]);

/**
 * Entities and whitespace normalised, tags stripped. Titles routinely carry
 * `&amp;` and `&#39;`, and a raw entity in the UI reads as a bug.
 *
 * @param {string} value
 * @returns {string}
 */
function clean(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name) => {
      const key = String(name).toLowerCase();
      const named = NAMED_ENTITIES.get(key);
      if (named) return named;
      const numeric = /^#x/i.test(key)
        ? Number.parseInt(key.slice(2), 16)
        : /^#/.test(key)
          ? Number.parseInt(key.slice(1), 10)
          : Number.NaN;
      return Number.isFinite(numeric) && numeric > 0 && numeric < 0x10ffff
        ? String.fromCodePoint(numeric)
        : match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reads a `<meta>` value by attribute, in either attribute order: `name`
 * before `content` and `content` before `name` are both common, and a page
 * that puts them the "wrong" way round must not read as having no description.
 *
 * @param {string} html
 * @param {string[]} names
 * @returns {string}
 */
function metaContent(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:name|property)\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:name|property)\\s*=\\s*["']${escaped}["']`,
        "i",
      ),
    ];
    for (const pattern of patterns) {
      const found = pattern.exec(html);
      const value = clean(found?.[1] || "");
      if (value) return value;
    }
  }
  return "";
}

/**
 * What the page says it is: its title, its description, and the site name it
 * gives itself. Never throws — an unparseable page yields empty strings, and
 * the caller treats that as "unknown", not as "irrelevant".
 *
 * @param {string} html
 * @returns {{title: string, description: string, siteName: string}}
 */
export function parseSiteIdentity(html) {
  const source = String(html || "").slice(0, IDENTITY_SCAN_CHARS);
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source);
  const title =
    clean(titleTag?.[1] || "") || metaContent(source, ["og:title", "twitter:title"]);
  const description = metaContent(source, [
    "description",
    "og:description",
    "twitter:description",
  ]);
  const siteName = metaContent(source, ["og:site_name", "application-name"]);
  return {
    title: title.slice(0, MAX_TITLE_CHARS),
    description: description.slice(0, MAX_DESCRIPTION_CHARS),
    siteName: siteName.slice(0, MAX_TITLE_CHARS),
  };
}

/**
 * True when the page told us nothing we can judge on. Kept separate from the
 * judgement itself so "we could not read the site" is never confused with
 * "the site does not fit": one is our failure, the other is a finding.
 *
 * @param {{title?: string, description?: string, siteName?: string}} identity
 * @returns {boolean}
 */
export function isIdentityEmpty(identity) {
  const { title = "", description = "", siteName = "" } = identity || {};
  return !`${title}${description}${siteName}`.trim();
}

/**
 * One line describing the candidate, for the relevance prompt and for logs.
 * The site's own words only — no model text, so the judge sees the page
 * rather than the description that got the page shortlisted.
 *
 * @param {{title?: string, description?: string, siteName?: string}} identity
 * @returns {string}
 */
export function describeIdentity(identity) {
  const { title = "", description = "", siteName = "" } = identity || {};
  const heading = [title, siteName && siteName !== title ? `(${siteName})` : ""]
    .filter(Boolean)
    .join(" ");
  return [heading, description].filter(Boolean).join(" — ").trim();
}
