import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  ENRICHMENT_BUDGET_DEFAULTS,
  ENRICHMENT_BUDGET_RANGES,
  enrichmentBudget,
} from "../app/lib/ai-cost.mjs";
import {
  LINK_SCAN_CHARS,
  buildPageEvidence,
  detectAffiliateNetworkAcrossPages,
  planAffiliateHint,
} from "../app/lib/contact-extract.mjs";

const fixture = (name) =>
  readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

// Three enrichment calls today returned 200, were billed $0.151/$0.136/$0.114
// against a ~$0.05 target, and produced nothing. Every input the request
// carries is bounded here, and the bound is asserted on the real pages.

// --- the budget -------------------------------------------------------------

test("the defaults are the shipped budget", () => {
  assert.deepEqual(enrichmentBudget({}), ENRICHMENT_BUDGET_DEFAULTS);
  assert.deepEqual(enrichmentBudget(), ENRICHMENT_BUDGET_DEFAULTS);
});

test("operator overrides are clamped into their range", () => {
  const budget = enrichmentBudget({
    ENRICHMENT_DIGEST_CHARS: "999999",
    ENRICHMENT_MAX_TOTAL_RESULTS: "0",
    ENRICHMENT_MAX_TOOL_CALLS: "3",
    ENRICHMENT_MAX_OUTPUT_TOKENS: "nonsense",
  });
  assert.equal(budget.digestChars, ENRICHMENT_BUDGET_RANGES.digestChars.max);
  assert.equal(budget.maxTotalResults, ENRICHMENT_BUDGET_RANGES.maxTotalResults.min);
  assert.equal(budget.maxToolCalls, 3);
  assert.equal(
    budget.maxOutputTokens,
    ENRICHMENT_BUDGET_DEFAULTS.maxOutputTokens,
    "an unparseable override falls back rather than removing the cap",
  );
});

test("the retry cap is always larger than the first attempt", () => {
  const budget = enrichmentBudget({
    ENRICHMENT_MAX_OUTPUT_TOKENS: "4000",
    ENRICHMENT_RETRY_OUTPUT_TOKENS: "800",
  });
  assert.ok(
    budget.retryOutputTokens > budget.maxOutputTokens,
    "a retry that is not bigger cannot fix a truncated answer",
  );
});

test("the web-search tool is bounded on every axis", () => {
  const budget = enrichmentBudget({});
  assert.ok(budget.maxToolCalls >= 1, "the call count is capped, it used to be absent");
  assert.ok(budget.maxTotalResults <= 8, "fewer injected results than the old 8");
  assert.ok(budget.maxResults <= budget.maxTotalResults + 1);
});

// --- the digest cap on the real pages --------------------------------------

test("the digest sent to the model is hard-capped on a huge page", async () => {
  const html = await fixture("datingdroid.html");
  assert.ok(html.length > 900_000, "the fixture really is the 963 KB page");
  const budget = enrichmentBudget({});
  const pages = [{ url: "https://datingdroid.com/", html }];
  const unbounded = buildPageEvidence(pages, {
    siteDomain: "datingdroid.com",
    digestChars: Number.MAX_SAFE_INTEGER,
    pageChars: 16_000,
    maxEmails: Number.MAX_SAFE_INTEGER,
  });
  const bounded = buildPageEvidence(pages, { siteDomain: "datingdroid.com", ...budget });
  assert.ok(unbounded.text.length > budget.digestChars, "the cap actually binds here");
  assert.equal(bounded.text.length, budget.digestChars);
  assert.ok(bounded.emails.length <= budget.maxEmails);
});

test("a small page is not padded up to the cap", async () => {
  const html = await fixture("aigfprices.html");
  const budget = enrichmentBudget({});
  const evidence = buildPageEvidence([{ url: "https://aigfprices.com/", html }], {
    siteDomain: "aigfprices.com",
    ...budget,
  });
  assert.ok(evidence.text.length > 0);
  assert.ok(evidence.text.length <= budget.digestChars);
});

test("the e-mail list glued onto the prompt is capped", () => {
  const html = Array.from({ length: 60 }, (_, index) => `<p>a${index}@site.example</p>`).join("");
  const evidence = buildPageEvidence([{ url: "https://site.example/", html }], {
    siteDomain: "site.example",
    maxEmails: 12,
  });
  assert.equal(evidence.emails.length, 12);
});

test("pages beyond the page cap never reach the digest", () => {
  const pages = Array.from({ length: 9 }, (_, index) => ({
    url: `https://site.example/p${index}`,
    html: `<html><body>contact: p${index}@site.example</body></html>`,
  }));
  // The route slices the candidate list by budget.maxPages before fetching;
  // the digest header proves only the pages handed in are described.
  const budget = enrichmentBudget({});
  const evidence = buildPageEvidence(pages.slice(0, budget.maxPages), {
    siteDomain: "site.example",
    ...budget,
  });
  assert.equal(evidence.pages.length, budget.maxPages);
  assert.ok(evidence.text.length <= budget.digestChars);
});

// --- the affiliate detector, end to end through the enrichment path ---------

test("datingdroid.com: the network is found through the enrichment path", async () => {
  const html = await fixture("datingdroid.html");
  const evidence = buildPageEvidence([{ url: "https://datingdroid.com/", html }], {
    siteDomain: "datingdroid.com",
    ...enrichmentBudget({}),
  });
  assert.ok(evidence.affiliate, "the page monetises through a network");
  assert.equal(evidence.affiliate.domain, "candyai.gg");
  assert.deepEqual(evidence.affiliate.markers, ["affid="]);
  // The page publishes no contact, so the hint is what turns it into a lead.
  const hint = planAffiliateHint({ hasContact: false, hint: evidence.affiliate });
  assert.match(hint.contactEvidence, /^affiliate_network: candyai\.gg/);
  assert.match(hint.nextAction, /рекламодател/i);
});

test("the old 250 000-char slice is exactly what hid it", async () => {
  const html = await fixture("datingdroid.html");
  const at = html.search(/affid=/i);
  assert.ok(at > 250_000, `the first affiliate link sits at ${at}, past the old limit`);
  assert.equal(
    detectAffiliateNetworkAcrossPages([html], "datingdroid.com", 250_000),
    null,
    "the old limit found nothing",
  );
  assert.ok(
    detectAffiliateNetworkAcrossPages([html], "datingdroid.com", LINK_SCAN_CHARS),
    "the link-scan limit finds it",
  );
});

test("aigfprices.com still resolves to its tracker", async () => {
  const html = await fixture("aigfprices.html");
  const evidence = buildPageEvidence([{ url: "https://aigfprices.com/", html }], {
    siteDomain: "aigfprices.com",
    ...enrichmentBudget({}),
  });
  assert.ok(evidence.affiliate);
  assert.deepEqual(evidence.affiliate.markers, ["aff_sub5="]);
});

test("the strongest hint across pages wins, whichever page carried it", () => {
  const weak = `<a href="https://shop.example/?ref=abc">m</a>`;
  const strong = `<a href="https://partner.pxf.io/c/1/2">n</a>`;
  assert.equal(detectAffiliateNetworkAcrossPages([weak, strong], "site.example").network, "Impact");
  assert.equal(detectAffiliateNetworkAcrossPages([strong, weak], "site.example").network, "Impact");
  assert.equal(detectAffiliateNetworkAcrossPages([], "site.example"), null);
});

test("a page whose contact pages are missing still yields the home-page hint", () => {
  // datingdroid has no /contact, /about, /advertise: contact-ish markup is
  // empty and the old code scanned nothing but that.
  const home = `<a href="https://t.track.example/1?affid=9">go</a>`;
  const evidence = buildPageEvidence([{ url: "https://site.example/", html: home }], {
    siteDomain: "site.example",
  });
  assert.equal(evidence.affiliate.domain, "t.track.example");
});
