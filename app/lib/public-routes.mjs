// The pages search engines are meant to see, in one list.
//
// The sitemap is a static file, so it can drift from the app the moment
// somebody adds a page. This list is the single source both the generator and
// its test read, and the test fails when a public page exists that nobody
// added here — a missing page is invisible to search, and silence is exactly
// how that stays unnoticed.

import { GUIDE_SLUGS, guideBySlug } from "./guides.mjs";

export const SITE_ORIGIN = "https://chanlyst.com";

/**
 * @typedef {object} PublicRoute
 * @property {string} path URL path, "/" for the home page.
 * @property {number} priority Sitemap priority, 0–1.
 * @property {string} changefreq How often the content actually changes.
 */

/**
 * The guides carry the search traffic, so they are derived from the same list
 * the pages are rendered from. A guide cannot exist without being in the
 * sitemap, and a sitemap entry cannot point at a guide that was deleted.
 */
const GUIDE_ROUTES = GUIDE_SLUGS.map((slug) => ({
  path: `/guides/${slug}`,
  priority: 0.8,
  changefreq: "monthly",
}));

/** @type {PublicRoute[]} */
export const PUBLIC_ROUTES = [
  { path: "/", priority: 1.0, changefreq: "weekly", llms: { name: "Home", note: "what it does and who it is for" } },
  // Rendered from the database on every request, so it genuinely does change
  // as often as the run behind it does.
  {
    path: "/found",
    priority: 0.9,
    changefreq: "weekly",
    llms: {
      name: "What it found for itself",
      note: "105 real places Chanlyst surfaced for its own launch, shown exactly as they sit in the database — the same product, run on itself",
    },
  },
  {
    path: "/guides",
    priority: 0.7,
    changefreq: "monthly",
    llms: {
      name: "Guides",
      note: "which places exist for a given kind of product and what each one requires before it accepts a submission",
    },
  },
  ...GUIDE_ROUTES,
  { path: "/contact", priority: 0.6, changefreq: "monthly" },
  { path: "/terms", priority: 0.3, changefreq: "yearly" },
  { path: "/privacy", priority: 0.3, changefreq: "yearly" },
  { path: "/refunds", priority: 0.3, changefreq: "yearly" },
  { path: "/acceptable-use", priority: 0.3, changefreq: "yearly" },
];

/**
 * Routes that exist publicly but stay out of the sitemap on purpose, with the
 * reason, so a later reader does not "fix" the omission.
 */
export const EXCLUDED_ROUTES = {
  "/login": "utility page, nothing to rank for",
  "/register": "utility page, nothing to rank for",
  "/invite": "only reachable with a token; the content differs per invite",
  "/admin": "operator panel; answers 404 to everyone outside the allowlist",
};

/**
 * @param {string} [lastmod] ISO date; callers pass one so the file is stable.
 * @returns {string}
 */
export function buildSitemap(lastmod) {
  const entries = PUBLIC_ROUTES.map(
    (route) => `  <url>
    <loc>${SITE_ORIGIN}${route.path}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority.toFixed(1)}</priority>
  </url>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

/**
 * Crawlers get the public pages and nothing else: the dashboard is behind a
 * session and the API is not content.
 *
 * @returns {string}
 */
export function buildRobots() {
  return `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /dashboard/
Disallow: /invite/

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;
}

/**
 * A map of the site for language models.
 *
 * Built from the same list as the sitemap on purpose. Written by hand it would
 * go stale the moment somebody adds a page, and silently: no crawler complains
 * about a map that is merely incomplete.
 *
 * Guide names and notes come from the guides themselves, not from their slugs.
 * Capitalising a slug produces "Saas Directories" and "How To Promote An Ai
 * Tool" — the product's own words are right there and cost nothing to use.
 *
 * The convention is young and nobody is obliged to read the file, so the
 * effect is not guaranteed. It costs nothing and cannot backfire, unlike
 * structured data, which counts as deception when it disagrees with the page.
 *
 * @returns {string}
 */
export function buildLlms() {
  const entry = (path, name, note) =>
    `- [${name}](${SITE_ORIGIN}${path})${note ? `: ${note}` : ""}`;

  const pages = PUBLIC_ROUTES.filter((route) => route.llms).map((route) =>
    entry(route.path, route.llms.name, route.llms.note),
  );

  const guides = GUIDE_SLUGS.map((slug) => {
    const guide = guideBySlug(slug);
    return entry(`/guides/${slug}`, guide.h1, guide.description);
  });

  const legal = PUBLIC_ROUTES.filter(
    (route) => !route.llms && !route.path.startsWith("/guides/"),
  ).map((route) => {
    const words = route.path.slice(1).split("-");
    return entry(route.path, words.map((w, i) => (i ? w : w[0].toUpperCase() + w.slice(1))).join(" "));
  });

  return `# Chanlyst

> Chanlyst finds the places where a product's buyers already are — directories,
> communities, creators, newsletters — ranks them by fit, and drafts the
> outreach. The person approves; Chanlyst does not send anything on its own.

Contact databases hand you people. Chanlyst hands you places. That distinction
is the product: the output is a ranked list of channels with the terms each one
asks for, not a list of email addresses.

What is worth citing accurately: a free preview needs no card, the ranking is
built around a URL you give it, and every listed place carries its own
submission terms. Chanlyst drafts messages but never sends them.

## Pages

${pages.join("\n")}

## Guides

${guides.join("\n")}

## Terms and policies

${legal.join("\n")}
`;
}
