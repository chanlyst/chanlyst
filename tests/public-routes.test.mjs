import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import {
  EXCLUDED_ROUTES,
  PUBLIC_ROUTES,
  SITE_ORIGIN,
  buildRobots,
  buildSitemap,
} from "../app/lib/public-routes.mjs";
import { GUIDE_SLUGS } from "../app/lib/guides.mjs";

/**
 * Every route the app actually serves under app/, minus the private trees.
 *
 * The guides are a dynamic segment, so there is no directory per page to find;
 * they are served for exactly the slugs in GUIDE_SLUGS and are enumerated from
 * there. That is not a loophole — the same list generates the sitemap entries
 * and the static params, so the three cannot disagree.
 */
function routesOnDisk() {
  const skip = new Set(["api", "dashboard", "lib", "components", "_sites-preview"]);
  const found = ["/"];
  for (const entry of readdirSync("app", { withFileTypes: true })) {
    if (!entry.isDirectory() || skip.has(entry.name) || entry.name.startsWith("_")) continue;
    if (existsSync(`app/${entry.name}/page.tsx`)) found.push(`/${entry.name}`);
  }
  for (const slug of GUIDE_SLUGS) found.push(`/guides/${slug}`);
  return found;
}

// A page nobody adds to the list is a page search engines never see, and
// nothing anywhere would say so. This is the only thing that notices.
test("every public page is either in the sitemap or excluded on purpose", () => {
  const listed = new Set(PUBLIC_ROUTES.map((route) => route.path));
  const excluded = new Set(Object.keys(EXCLUDED_ROUTES));

  for (const route of routesOnDisk()) {
    assert.ok(
      listed.has(route) || excluded.has(route),
      `${route} is served but missing from PUBLIC_ROUTES (add it, or explain it in EXCLUDED_ROUTES)`,
    );
  }
});

test("the sitemap never lists a page that no longer exists", () => {
  const onDisk = new Set(routesOnDisk());
  for (const route of PUBLIC_ROUTES) {
    assert.ok(onDisk.has(route.path), `${route.path} is in the sitemap but not served`);
  }
});

test("the generated sitemap is valid and absolute", () => {
  const xml = buildSitemap("2026-07-29");

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.equal((xml.match(/<loc>/g) || []).length, PUBLIC_ROUTES.length);
  // Relative locs are ignored by crawlers, so every one has to carry the origin.
  for (const route of PUBLIC_ROUTES) {
    assert.ok(xml.includes(`<loc>${SITE_ORIGIN}${route.path}</loc>`), route.path);
  }
});

test("robots keeps crawlers out of the app and points at the sitemap", () => {
  const robots = buildRobots();

  assert.match(robots, /^User-agent: \*/m);
  assert.match(robots, /^Allow: \/$/m);
  for (const path of ["/api/", "/dashboard/", "/invite/"]) {
    assert.match(robots, new RegExp(`^Disallow: ${path.replace("/", "\\/")}`, "m"));
  }
  assert.match(robots, /^Sitemap: https:\/\/chanlyst\.com\/sitemap\.xml$/m);
});

// The files are static, so they only match the code if somebody regenerated
// them. This is what makes "somebody" not a matter of memory.
test("the checked-in files match what the generator produces", () => {
  const sitemap = readFileSync("public/sitemap.xml", "utf8");
  const lastmod = /<lastmod>([\d-]+)<\/lastmod>/.exec(sitemap)?.[1];

  assert.ok(lastmod, "public/sitemap.xml has no lastmod");
  assert.equal(sitemap, buildSitemap(lastmod), "run node deploy/build-seo-files.mjs");
  assert.equal(readFileSync("public/robots.txt", "utf8"), buildRobots());
});
