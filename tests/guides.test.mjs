import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { GUIDES, GUIDE_SLUGS, guideBySlug } from "../app/lib/guides.mjs";
import { guideGraph, guideIndexGraph } from "../app/lib/structured-data.mjs";

const KEYWORDS = JSON.parse(readFileSync("docs/seo/keywords.json", "utf8"));

// Two pages written for the same phrasing compete with each other: the links
// and the relevance split between them and neither one ranks. This is the rule
// the whole page map rests on, so it is the first thing checked.
test("no two guides chase the same search phrase", () => {
  const owner = new Map();
  for (const guide of GUIDES) {
    for (const phrase of guide.targets) {
      const existing = owner.get(phrase);
      assert.equal(
        existing,
        undefined,
        `"${phrase}" is targeted by both ${existing} and ${guide.slug}`,
      );
      owner.set(phrase, guide.slug);
    }
  }
});

// The point of harvesting real phrasing is that the pages are written for it.
// A guide whose targets are all invented is a guide aimed at nothing.
test("every guide is anchored to phrasing people actually typed", () => {
  const harvested = new Set(KEYWORDS.map((row) => row.phrase));

  for (const guide of GUIDES) {
    const grounded = guide.targets.filter((phrase) => harvested.has(phrase));
    assert.ok(
      grounded.length >= 2,
      `${guide.slug} has ${grounded.length} targets from the harvested core, needs at least 2`,
    );
  }
});

test("slugs are unique, url-safe and match their related links", () => {
  assert.equal(new Set(GUIDE_SLUGS).size, GUIDE_SLUGS.length, "duplicate slug");

  for (const guide of GUIDES) {
    assert.match(guide.slug, /^[a-z0-9-]+$/, `${guide.slug} is not url-safe`);
    assert.match(guide.updated, /^\d{4}-\d{2}-\d{2}$/, `${guide.slug} has no check date`);
    for (const other of guide.related) {
      assert.ok(guideBySlug(other), `${guide.slug} links to a missing guide: ${other}`);
      assert.notEqual(other, guide.slug, `${guide.slug} links to itself`);
    }
  }
});

// Search results truncate, and a title cut mid-word is a click that does not
// happen. The description bound is looser because Google rewrites it anyway.
test("titles and descriptions fit a search result", () => {
  for (const guide of GUIDES) {
    assert.ok(
      guide.title.length <= 70,
      `${guide.slug} title is ${guide.title.length} chars, gets truncated`,
    );
    assert.ok(guide.description.length >= 110, `${guide.slug} description is too thin`);
    assert.ok(guide.description.length <= 320, `${guide.slug} description is too long`);
    assert.ok(guide.h1.length <= 60, `${guide.slug} h1 is unwieldy`);
  }
});

// The rule from docs/SEO-CORE.md: nothing ships that a template could have
// produced. A word count is a crude proxy for it and it is the proxy that
// catches the actual failure — a page padded out to look finished.
test("no guide is thin", () => {
  for (const guide of GUIDES) {
    const prose = [
      ...guide.intro,
      ...guide.sections.flatMap((section) => [
        ...(section.body || []),
        ...(section.list || []).map(([term, detail]) => `${term} ${detail}`),
      ]),
      ...guide.faq.flat(),
    ].join(" ");

    const words = prose.split(/\s+/).filter(Boolean).length;
    assert.ok(words >= 600, `${guide.slug} is ${words} words, too thin to be worth a page`);
    assert.ok(guide.sections.length >= 3, `${guide.slug} has too few sections`);
    assert.ok(guide.faq.length >= 3, `${guide.slug} has too few questions`);
  }
});

// The cap is deliberate. Scale is the failure mode of this whole approach:
// forty templated pages is what Google demoted, not what it rewards.
test("the guide count stays capped", () => {
  assert.ok(GUIDES.length <= 12, "more than twelve guides needs a decision, not a commit");
});

test("a guide's structured data describes that guide", () => {
  const guide = GUIDES[0];
  const nodes = Object.fromEntries(
    guideGraph(guide)["@graph"].map((node) => [node["@type"], node]),
  );

  assert.equal(nodes.Article.headline, guide.h1);
  assert.equal(nodes.Article.dateModified, guide.updated);
  assert.ok(nodes.Article.url.endsWith(`/guides/${guide.slug}`));
  // An invented byline is the one piece of schema that would be a lie.
  assert.equal(nodes.Article.author, undefined);
  assert.equal(nodes.FAQPage.mainEntity.length, guide.faq.length);

  const crumbs = nodes.BreadcrumbList.itemListElement;
  assert.deepEqual(
    crumbs.map((crumb) => crumb.position),
    [1, 2, 3],
  );
  assert.ok(crumbs[2].item.endsWith(guide.slug));

  const index = guideIndexGraph(GUIDES)["@graph"][0];
  assert.equal(index.mainEntity.itemListElement.length, GUIDES.length);
});

// A page nothing links to is crawled last or not at all, and these are the only
// pages on the site written to be found by search.
test("the guides are reachable from the home page", () => {
  const home = readFileSync("app/home-screen.tsx", "utf8");
  assert.ok(home.includes('href="/guides"'), "the footer must link to the guides");
});
