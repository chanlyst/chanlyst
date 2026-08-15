import assert from "node:assert/strict";
import test from "node:test";
import {
  DISCOVERY_DROP_REASONS,
  applyQuotaTrim,
  auditDiscoveryResults,
  droppedTotal,
  formatDiscoverySummary,
  summaryReconciles,
} from "../app/lib/discovery-audit.mjs";

// Two runs on 25 July succeeded, cost $0.140 and $0.128 and stored nothing.
// The point of the accounting is that such a run is now explainable: every
// rule names itself, and returned + dropped always equals what the model sent.

const entry = (extra = {}) => ({
  company: "Acme",
  url: "https://acme.example/blog",
  domain: "",
  score: 80,
  ...extra,
});

test("a clean batch passes through untouched", () => {
  const entries = [entry(), entry({ company: "B", url: "https://b.example/" })];
  const { results, dropped, summary } = auditDiscoveryResults({
    entries,
    minScore: 65,
    maxResults: 8,
  });
  assert.equal(results.length, 2);
  assert.deepEqual(dropped, {});
  assert.deepEqual(summary, {
    modelReturned: 2,
    returned: 2,
    dropped: 0,
    reasons: {},
    // Nothing was kept against a rule, so the log line stays silent about it.
    kept: {},
  });
  assert.ok(summaryReconciles(summary));
});

test("each rule counts exactly what it removed", () => {
  const entries = [
    entry(), // kept
    entry({ company: "", url: "https://nameless.example/" }), // missing_url_or_company
    entry({ url: "" }), // missing_url_or_company
    entry({ score: 64, url: "https://low.example/" }), // score_below_threshold
    entry({ url: "https://known.example/page" }), // duplicate_known_domain
    entry({ url: "https://fresh.example/a" }),
    entry({ url: "https://fresh.example/b" }), // duplicate_in_batch
    entry({
      url: "https://net.example/",
      opportunityType: "affiliate_network",
      actionType: "list_offer",
      registrationUrl: "",
    }), // affiliate_network_without_registration_url
  ];
  const { results, dropped, summary } = auditDiscoveryResults({
    entries,
    minScore: 65,
    maxResults: 8,
    knownDomains: ["https://www.known.example/whatever"],
  });
  assert.deepEqual(
    results.map((item) => item.url),
    ["https://acme.example/blog", "https://fresh.example/a"],
  );
  assert.deepEqual(dropped, {
    missing_url_or_company: 2,
    score_below_threshold: 1,
    duplicate_known_domain: 1,
    duplicate_in_batch: 1,
    affiliate_network_without_registration_url: 1,
  });
  assert.equal(summary.modelReturned, 8);
  assert.equal(summary.returned, 2);
  assert.equal(summary.dropped, 6);
  assert.ok(summaryReconciles(summary), "returned + dropped === model output");
});

test("the supply-side cap is counted through the shared guard", () => {
  const entries = Array.from({ length: 5 }, (_, index) =>
    entry({
      company: `N${index}`,
      url: `https://n${index}.example/`,
      opportunityType: "affiliate_network",
      actionType: "list_offer",
      registrationUrl: "https://n.example/advertisers",
    }),
  );
  const { summary } = auditDiscoveryResults({ entries, maxResults: 8 });
  assert.equal(summary.returned, 3);
  assert.equal(summary.reasons.affiliate_network_over_cap, 2);
  assert.ok(summaryReconciles(summary));
});

test("entries beyond the result cap are counted, not silently sliced away", () => {
  const entries = Array.from({ length: 11 }, (_, index) =>
    entry({ company: `C${index}`, url: `https://c${index}.example/` }),
  );
  const { results, summary } = auditDiscoveryResults({
    entries,
    maxResults: 8,
  });
  assert.equal(results.length, 8);
  assert.equal(summary.reasons.over_result_cap, 3);
  assert.ok(summaryReconciles(summary));
});

test("a run that returned entries and stored none is fully explained", () => {
  // The production shape: everything the model found was already stored.
  const entries = Array.from({ length: 6 }, (_, index) =>
    entry({ company: `Known${index}`, url: `https://k${index}.example/x` }),
  );
  const { results, summary } = auditDiscoveryResults({
    entries,
    minScore: 65,
    maxResults: 8,
    knownDomains: entries.map((item) => item.url),
  });
  assert.equal(results.length, 0);
  assert.equal(summary.reasons.duplicate_known_domain, 6);
  assert.ok(summaryReconciles(summary));
  const line = formatDiscoverySummary(summary, { workspace: "w1" });
  assert.match(line, /model_returned=6 returned=0 dropped=6/);
  assert.match(line, /reasons=duplicate_known_domain=6/);
  assert.match(line, /reconciles=true/);
  assert.match(line, /workspace=w1/);
  assert.doesNotMatch(line, /k0\.example/, "the log carries counts, not domains");
});

test("the normaliser runs before the domain and guard rules", () => {
  const { results } = auditDiscoveryResults({
    entries: [entry({ url: "https://Www.Acme.example/x" })],
    normalise: (item) => ({ ...item, opportunityType: "directory", score: 90 }),
  });
  assert.equal(results[0].opportunityType, "directory");
  assert.equal(results[0].score, 90);
});

test("the quota is the last drop rule and keeps the totals reconciling", () => {
  const entries = Array.from({ length: 8 }, (_, index) =>
    entry({ company: `C${index}`, url: `https://c${index}.example/` }),
  );
  const audited = auditDiscoveryResults({ entries, maxResults: 8 });
  const trimmed = applyQuotaTrim({
    results: audited.results,
    summary: audited.summary,
    limit: 3,
  });
  assert.equal(trimmed.results.length, 3);
  assert.equal(trimmed.summary.returned, 3);
  assert.equal(trimmed.summary.reasons.quota_trim, 5);
  assert.ok(summaryReconciles(trimmed.summary));
});

test("a quota with room to spare trims nothing and adds no reason", () => {
  const audited = auditDiscoveryResults({
    entries: [entry()],
    maxResults: 8,
  });
  const trimmed = applyQuotaTrim({ ...audited, limit: 8 });
  assert.equal(trimmed.results.length, 1);
  assert.equal(trimmed.summary.reasons.quota_trim, undefined);
  assert.ok(summaryReconciles(trimmed.summary));
});

test("empty and malformed input never break the accounting", () => {
  for (const entries of [[], null, undefined]) {
    const { summary } = auditDiscoveryResults({ entries });
    assert.deepEqual(summary, {
      modelReturned: 0,
      returned: 0,
      dropped: 0,
      reasons: {},
      kept: {},
    });
    assert.ok(summaryReconciles(summary));
  }
  assert.equal(droppedTotal(undefined), 0);
  assert.match(formatDiscoverySummary(undefined), /reasons=none/);
});

test("every reason a rule can emit is a declared reason", () => {
  const entries = [
    entry({ company: "" }),
    entry({ score: 10, url: "https://a.example/" }),
    entry({ url: "https://b.example/" }),
    entry({ url: "https://c.example/" }),
    entry({ url: "https://c.example/other" }),
    entry({
      url: "https://n.example/",
      opportunityType: "affiliate_network",
      registrationUrl: "",
    }),
  ];
  const audited = auditDiscoveryResults({
    entries,
    minScore: 65,
    maxResults: 1,
    knownDomains: ["b.example"],
  });
  const final = applyQuotaTrim({ ...audited, limit: 0 });
  for (const reason of Object.keys(final.summary.reasons)) {
    assert.ok(
      DISCOVERY_DROP_REASONS.includes(reason),
      `${reason} must be declared in DISCOVERY_DROP_REASONS`,
    );
  }
  assert.ok(summaryReconciles(final.summary));
});
