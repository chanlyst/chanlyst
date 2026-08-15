// Pure UTM helpers shared by the dashboard and unit tests.
// Kept as an .mjs module so tests/utm-helpers.test.mjs can import it
// directly with `node --test` while TypeScript imports it via allowJs.

/**
 * Reduce a value (channel domain, product id) to a safe utm token:
 * lowercase ASCII letters, digits and dashes.
 * @param {unknown} value
 * @returns {string}
 */
export function slugifyUtmValue(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
}

/**
 * Build a trackable link to the product website:
 * utm_source=<slugified channel domain>, utm_medium=<listing|paid|outreach>,
 * utm_campaign=chanlyst-<product id or slug>. Existing query params are
 * preserved; existing utm_* params are replaced, never duplicated.
 * @param {unknown} productWebsite
 * @param {{ source?: unknown; medium?: unknown; campaign?: unknown }} params
 * @returns {string} the final URL, or '' when the website is not a valid
 *   http(s) URL.
 */
export function buildUtmLink(productWebsite, { source, medium, campaign } = {}) {
  const raw = String(productWebsite ?? "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  const values = {
    utm_source: slugifyUtmValue(source) || "chanlyst",
    utm_medium: slugifyUtmValue(medium) || "listing",
    utm_campaign: `chanlyst-${slugifyUtmValue(campaign)}`.replace(/-+$/, ""),
  };
  for (const [key, value] of Object.entries(values)) {
    url.searchParams.delete(key);
    url.searchParams.set(key, value);
  }
  return url.toString();
}
