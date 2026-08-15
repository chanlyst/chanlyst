import assert from "node:assert/strict";
import test from "node:test";
import {
  BROAD_DISCOVERY_PASSES,
  batchResultCap,
  EXPANSION_DISCOVERY_PASSES,
  MAX_BATCH_DISCOVERY_RESULTS,
  MIN_USEFUL_DISCOVERY_RESULTS,
  balanceDiscoveryResults,
  discoveryEntityKey,
  discoveryPasses,
  mergeDiscoveryRuns,
} from "../app/lib/discovery-batch-core.mjs";
import { summaryReconciles } from "../app/lib/discovery-audit.mjs";
import { readFileSync } from "node:fs";

const result = (domain, score = 80, extra = {}) => ({
  company: domain,
  domain,
  url: `https://${domain}/`,
  score,
  ...extra,
});

const run = (results, reasons = {}) => ({
  results,
  summary: {
    modelReturned: results.length + Object.values(reasons).reduce((a, b) => a + b, 0),
    returned: results.length,
    dropped: Object.values(reasons).reduce((a, b) => a + b, 0),
    reasons,
    kept: {},
  },
});

test("broad discovery covers four different acquisition markets", () => {
  assert.equal(BROAD_DISCOVERY_PASSES.length, 4);
  assert.deepEqual(
    BROAD_DISCOVERY_PASSES.map((pass) => pass.focusMotion),
    ["directories", "communities", "creators", "partnerships"],
  );
  assert.equal(new Set(BROAD_DISCOVERY_PASSES.map((pass) => pass.id)).size, 4);
  assert.deepEqual(
    EXPANSION_DISCOVERY_PASSES.map((pass) => pass.focusMotion),
    ["content_seo", "paid_placements", "affiliates", "partnerships"],
  );
});

test("a distinct user goal replaces the final broad lane", () => {
  const direct = discoveryPasses("direct_sales");
  assert.equal(direct.length, 4);
  assert.equal(direct[3].focusMotion, "direct_sales");
  assert.ok(direct[3].sources.includes("potential buyers"));

  const alreadyCovered = discoveryPasses("creators");
  assert.equal(alreadyCovered[2].focusMotion, "creators");
  assert.equal(alreadyCovered[3].focusMotion, "partnerships");
});

test("an explicit narrow source selection is respected", () => {
  assert.deepEqual(
    discoveryPasses("", ["communities"]).map((pass) => pass.focusMotion),
    ["communities"],
  );
  assert.deepEqual(
    discoveryPasses("", ["creators"]).map((pass) => pass.focusMotion),
    ["creators"],
  );
  assert.equal(discoveryPasses("", ["web"]).length, 4);
  assert.equal(discoveryPasses("", ["invalid-source"]).length, 4);
});

test("batch merge removes cross-pass duplicates and keeps the stronger row", () => {
  const merged = mergeDiscoveryRuns([
    run([result("one.example", 70), result("same.example", 75)], { score_below_threshold: 1 }),
    run([result("same.example", 92), result("two.example", 85)]),
  ]);

  assert.deepEqual(
    merged.results.map((item) => [item.domain, item.score]),
    [
      ["same.example", 92],
      ["two.example", 85],
      ["one.example", 70],
    ],
  );
  assert.equal(merged.summary.reasons.duplicate_across_batches, 1);
  assert.equal(merged.summary.reasons.score_below_threshold, 1);
  assert.ok(summaryReconciles(merged.summary));
});

test("entity keys collapse one brand but preserve independent hosted audiences", () => {
  assert.equal(
    discoveryEntityKey(result("help.hackernoon.com")),
    discoveryEntityKey(result("hackernoon.com")),
  );
  assert.notEqual(
    discoveryEntityKey({ domain: "reddit.com", url: "https://old.reddit.com/r/SaaS" }),
    discoveryEntityKey({ domain: "reddit.com", url: "https://reddit.com/r/startups" }),
  );
  assert.notEqual(
    discoveryEntityKey(result("one.substack.com")),
    discoveryEntityKey(result("two.substack.com")),
  );
});

test("balanced selection prevents paid inventory from crowding out every other lane", () => {
  const rows = [
    ...Array.from({ length: 20 }, (_, index) =>
      result(`paid-${index}.example`, 100 - index, {
        opportunityType: "paid_placement",
        engagementMode: "paid_placement",
      }),
    ),
    ...Array.from({ length: 8 }, (_, index) =>
      result(`directory-${index}.example`, 70 - index, {
        opportunityType: "directory",
        engagementMode: "free_listing",
      }),
    ),
    ...Array.from({ length: 8 }, (_, index) =>
      result(`buyer-${index}.example`, 65 - index, {
        opportunityType: "direct_buyer",
        engagementMode: "outreach",
      }),
    ),
    ...Array.from({ length: 7 }, (_, index) =>
      result(`creator-${index}.example`, 60 - index, {
        opportunityType: "creator",
        engagementMode: "outreach",
      }),
    ),
  ];
  const selected = balanceDiscoveryResults(rows, 30);
  const counts = selected.reduce((acc, item) => {
    const key = item.opportunityType;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  assert.equal(selected.length, 30);
  assert.equal(counts.directory, 8);
  assert.equal(counts.direct_buyer, 8);
  assert.equal(counts.creator, 7);
  assert.equal(counts.paid_placement, 7);
});

test("a doubtful high score cannot displace a relevant channel", () => {
  const merged = mergeDiscoveryRuns([
    run([
      result("wrong.example", 99, { relevance: "doubtful" }),
      result("good.example", 72, { relevance: "ok" }),
      result("unknown.example", 80, { relevance: "unknown" }),
    ]),
  ]);

  assert.deepEqual(
    merged.results.map((item) => item.domain),
    ["unknown.example", "good.example", "wrong.example"],
  );
});

test("batch cap is counted rather than silently slicing results", () => {
  const rows = Array.from({ length: 35 }, (_, index) =>
    result(`d${index}.example`, 100 - index),
  );
  const merged = mergeDiscoveryRuns([run(rows)], MAX_BATCH_DISCOVERY_RESULTS);

  assert.equal(merged.results.length, 30);
  assert.equal(merged.summary.reasons.over_batch_cap, 5);
  assert.ok(summaryReconciles(merged.summary));
});

test("the broad lanes run together and a weak initial map expands", () => {
  const source = readFileSync("app/lib/discovery-batch.ts", "utf8");

  assert.equal(MIN_USEFUL_DISCOVERY_RESULTS, 30);
  // One round for all four lanes, not two serial pairs: the barrier removed
  // four duplicates on a real run and cost 45 seconds, which was enough to
  // push the request past the proxy timeout and lose the entire result.
  assert.match(source, /await runWave\(passes\)/);
  assert.doesNotMatch(source, /runWave\(passes\.slice/);
  // What the lanes do repeat is still collapsed after the fact.
  assert.match(source, /excludeDomains: excluded/);
  assert.match(
    source,
    /usefulInitialResults\.length < MIN_USEFUL_DISCOVERY_RESULTS/,
  );
  assert.match(source, /EXPANSION_DISCOVERY_PASSES\.slice\(wave, wave \+ 2\)/);
  assert.match(source, /harvestSerperCandidates/);
});

test("main dashboard and pipeline use broad discovery; motion tiles stay narrow", () => {
  const route = readFileSync("app/api/discover/route.ts", "utf8");
  const pipeline = readFileSync("app/lib/pipeline-runner.ts", "utf8");
  const preview = readFileSync("app/lib/public-preview.ts", "utf8");

  assert.match(route, /payload\.focusMotion[\s\S]*runDiscovery[\s\S]*runBroadDiscovery/);
  assert.match(pipeline, /runBroadDiscovery\(/);
  assert.match(preview, /runBroadDiscovery\(/);
});

test("a refused search does not become an expensive one", () => {
  const source = readFileSync("app/lib/discovery-batch.ts", "utf8");
  const serper = readFileSync("app/lib/discovery-serper.ts", "utf8");
  const gate = readFileSync("app/lib/serper-gate.ts", "utf8");

  // Fifty requests in one second earned 25 refusals from Serper and cost one
  // lane every candidate it had. The lanes still overlap, they queue — and the
  // gate is shared, or two features each keep their own count and together
  // exceed the limit it exists to hold.
  assert.match(gate, /const MAX_CONCURRENT = \d+/);
  assert.match(gate, /withSerperSlot/);
  assert.match(gate, /response\.status === 429/);
  assert.match(serper, /serperSearch\(/);
  assert.doesNotMatch(serper, /MAX_CONCURRENT/);

  // Empty-because-refused and empty-because-nothing-matched cost twenty times
  // differently, so they are told apart and only the second one falls back.
  assert.match(serper, /searchFailed: candidates\.length === 0 && failed !== ""/);
  assert.match(source, /searchFailed/);
  assert.match(source, /source_search_failed/);
});

test("a paying workspace gets fifty from one run, a free one thirty", () => {
  assert.equal(batchResultCap("free"), 30);
  assert.equal(batchResultCap(""), 30);
  assert.equal(batchResultCap(undefined), 30);
  for (const plan of ["starter", "pro", "scale", "unlimited"]) {
    assert.equal(batchResultCap(plan), 50, plan);
  }

  // The per-category quotas scale with the cap, or the extra room fills with
  // whichever category is easiest to find.
  const items = Array.from({ length: 90 }, (_, index) => ({
    domain: `d${index}.example`,
    url: `https://d${index}.example`,
    score: 100 - index,
    engagementMode: index % 2 ? "free_listing" : "paid_placement",
    opportunityType: "partner",
  }));
  assert.equal(balanceDiscoveryResults(items, 30).length, 30);
  assert.equal(balanceDiscoveryResults(items, 50).length, 50);
});

test("the public preview shows the free allowance, not a plan's", () => {
  const preview = readFileSync("app/lib/public-preview.ts", "utf8");
  assert.match(preview, /maxResults: MAX_BATCH_DISCOVERY_RESULTS/);
});
