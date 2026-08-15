import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  bareDomain,
  brandSlugs,
  buildPresenceQuery,
  distributionGaps,
  presenceFromResults,
} from "../app/lib/competitor-gap-core.mjs";

test("the question is asked of the channel, not of the web", () => {
  assert.equal(
    buildPresenceQuery("https://www.g2.com/browse", { name: "SparkToro", domain: "sparktoro.com" }),
    'site:g2.com "SparkToro"',
  );
  // A brand with no name still has a domain to fall back on.
  assert.equal(buildPresenceQuery("g2.com", { domain: "sparktoro.com" }), 'site:g2.com "sparktoro"');
  assert.equal(buildPresenceQuery("", { name: "X" }), "");
  assert.equal(buildPresenceQuery("g2.com", {}), "");
});

test("a listing counts, a mention does not", () => {
  const brand = { name: "SparkToro", domain: "sparktoro.com" };
  // What G2 actually returned.
  assert.deepEqual(
    presenceFromResults(
      [{ url: "https://www.g2.com/products/sparktoro/reviews" }],
      "g2.com",
      brand,
    ),
    { present: true, url: "https://www.g2.com/products/sparktoro/reviews" },
  );
  // What Capterra actually returned: another product's page that names
  // SparkToro in its comparison text.
  assert.deepEqual(
    presenceFromResults(
      [{ url: "https://www.capterra.com/p/159302/Social-Animal/reviews/" }],
      "capterra.com",
      brand,
    ),
    { present: false, url: "" },
  );
  // A page on someone else's site never counts, whatever its path says.
  assert.equal(
    presenceFromResults(
      [{ url: "https://example.com/products/sparktoro" }],
      "g2.com",
      brand,
    ).present,
    false,
  );
});

test("brand forms cover how listings actually spell a name", () => {
  const slugs = brandSlugs({ name: "GTM Stack", domain: "gtmstack.directory" });
  assert.ok(slugs.includes("gtm-stack"));
  assert.ok(slugs.includes("gtmstack"));
  // Two-letter noise never becomes a slug — it would match everything.
  assert.ok(brandSlugs({ name: "Xy", domain: "" }).every((s) => s.length >= 3));
  assert.deepEqual(brandSlugs({}), []);
});

test("only a confirmed competitor on a channel you are absent from is a gap", () => {
  const rows = [
    { domain: "producthunt.com", self: false, competitors: [{ name: "Clay", url: "u1" }, { name: "SparkToro", url: "u2" }] },
    // Present on both — no gap, we are already there.
    { domain: "g2.com", self: true, competitors: [{ name: "Clay", url: "u3" }] },
    // Nobody found — silence is not evidence of a gap.
    { domain: "quiet.example", self: false, competitors: [] },
  ];
  const gaps = distributionGaps(rows);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].domain, "producthunt.com");
  // The most crowded gap leads: two rivals there is a stronger case than one.
  assert.equal(gaps[0].competitors.length, 2);
});

test("domains are normalised however they arrive", () => {
  for (const value of ["https://www.G2.com/products", "www.g2.com", "g2.com/", "G2.COM"]) {
    assert.equal(bareDomain(value), "g2.com", value);
  }
  assert.equal(bareDomain(""), "");
});

test("the analysis runs on confirmed rivals and on channels already found", () => {
  const orchestrator = readFileSync("app/lib/competitor-gap.ts", "utf8");
  const route = readFileSync("app/api/competitor-gap/route.ts", "utf8");

  // Unconfirmed is the model's guess; acting on it would aim the whole
  // analysis at somebody else's audience without the user agreeing.
  assert.match(route, /\.filter\(\(item\) => item\.confirmed\)/);

  // The channels come from what discovery already found, ordered by score and
  // bounded, because each one costs a request per rival.
  assert.match(orchestrator, /record_kind='channel'/);
  assert.match(orchestrator, /ORDER BY score DESC LIMIT \?/);
  assert.match(orchestrator, /GAP_MAX_CHANNELS = 25/);
  assert.match(orchestrator, /GAP_MAX_COMPETITORS = 3/);

  // Our own presence is only asked about where a rival was found: elsewhere
  // the answer cannot change the outcome and the request would be wasted.
  assert.match(orchestrator, /found\.length \? \(await ask\(row\.domain, product\)\)\.present : false/);

  // Every request goes through the shared gate.
  assert.match(orchestrator, /serperSearch\(/);
  assert.doesNotMatch(orchestrator, /fetch\("https:\/\/google\.serper\.dev/);
});

test("the gap is a property of a channel, not a separate report", () => {
  const migration = readFileSync("drizzle/0040_competitor_presence.sql", "utf8");
  const orchestrator = readFileSync("app/lib/competitor-gap.ts", "utf8");
  const route = readFileSync("app/api/prospects/route.ts", "utf8");
  const table = readFileSync("app/dashboard/sections/leads-table.tsx", "utf8");
  const strings = readFileSync("app/dashboard/i18n.ts", "utf8");

  // Stored, because recomputing it on every view would cost more than the
  // search that found the channels.
  assert.match(migration, /ALTER TABLE prospects ADD COLUMN competitor_presence/);
  assert.match(route, /competitor_presence as competitorPresence/);

  // Stale claims are cleared before new ones are written: a rival that has
  // dropped its listing must not leave a badge nothing will ever correct.
  assert.match(orchestrator, /UPDATE prospects SET competitor_presence=''/);
  // Only a channel we are absent from is marked.
  assert.match(orchestrator, /row\.competitors\.length && !row\.self/);

  // The chip appears only once there is something behind it.
  assert.match(table, /leadCounts\.competitors\s*\n?\s*\?/);
  // The badge links to the page that proves the claim.
  assert.match(table, /className="rival-tag"/);
  assert.match(table, /href=\{rival\.url\}/);

  for (const key of ["filterCompetitors:", "competitorUses:"]) {
    assert.equal(strings.split(key).length - 1, 2, key);
  }
});

test("the check is started by a press, and only when it can succeed", () => {
  const panel = readFileSync("app/dashboard/sections/product-panel.tsx", "utf8");
  const dashboard = readFileSync("app/dashboard/signalist-dashboard.tsx", "utf8");

  // Disabled until a rival is confirmed: the server would refuse the run, and
  // the user should not spend a click to find that out.
  assert.match(panel, /confirmedCompetitors = \(editing\.analysis\.competitors \|\| \[\]\)/);
  assert.match(panel, /disabled=\{busy === "competitorGap" \|\| !confirmedCompetitors\}/);

  // The badges live on channel rows, so the list is re-read after a run.
  assert.match(dashboard, /runCompetitorGapApi\(activeId\)/);
  assert.match(dashboard, /dispatch\(\{ type: "refreshRequested" \}\)/);
});

test("an article that names the brand is not a listing", () => {
  const clay = { name: "Clay", domain: "clay.com" };
  const apollo = { name: "Apollo", domain: "apollo.io" };
  // Every one of these came back as a "gap" from the run of 14 August.
  const rejected = [
    ["https://www.revgenius.com/mag/behind-clays-explosive-growth", "revgenius.com", clay],
    ["https://www.theinformation.com/u/claykelly", "theinformation.com", clay],
    ["https://www.reddit.com/r/explainlikeimfive/comments/1lmzehq/eli5_what_is_clay_made_of", "reddit.com", clay],
    ["https://www.reddit.com/r/apolloapp/comments/144f6xm/apollo_will_close_down", "reddit.com", apollo],
    ["https://impact.com/case-studies/apollo-neuro-case-study-pars", "impact.com", apollo],
    ["https://guestpostlinks.net/product/guest-post-on-clay-pl/", "guestpostlinks.net", clay],
    ["https://www.saastr.com/cro-confidential-ai-saas-sales-with-clay-ceo/", "saastr.com", clay],
    ["https://gtmvault.co/p/smys-6-from-clay-to-claude-code", "gtmvault.co", clay],
    ["https://saasclub.io/podcast/service-as-software-farzad-rashidi-respona/", "saasclub.io", { name: "Respona", domain: "respona.com" }],
  ];
  for (const [url, domain, brand] of rejected) {
    assert.equal(presenceFromResults([{ url }], domain, brand).present, false, url);
  }

  // And the four that were real listings still are.
  const kept = [
    ["https://www.gtmstack.directory/tools/clay", "gtmstack.directory", clay],
    ["https://www.gtmstack.directory/tools/apollo", "gtmstack.directory", apollo],
    ["https://market.partnerstack.com/page/apollo", "market.partnerstack.com", apollo],
    ["https://tapfiliate.com/integrations/clay", "tapfiliate.com", clay],
  ];
  for (const [url, domain, brand] of kept) {
    assert.equal(presenceFromResults([{ url }], domain, brand).present, true, url);
  }
});
