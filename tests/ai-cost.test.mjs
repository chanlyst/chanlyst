import assert from "node:assert/strict";
import test from "node:test";
import {
  DISCOVERY_BUDGET_DEFAULTS,
  ERROR_BODY_LOG_CHARS,
  clampInteger,
  countWebSearchCalls,
  discoverySearchBudget,
  isCreditsExhausted,
  truncateErrorBody,
} from "../app/lib/ai-cost.mjs";

test("clampInteger falls back on unusable input", () => {
  const bounds = { min: 1, max: 10, fallback: 4 };
  assert.equal(clampInteger(undefined, bounds), 4);
  assert.equal(clampInteger(null, bounds), 4);
  assert.equal(clampInteger("", bounds), 4);
  assert.equal(clampInteger("   ", bounds), 4);
  assert.equal(clampInteger("abc", bounds), 4);
  assert.equal(clampInteger(Number.NaN, bounds), 4);
  assert.equal(clampInteger(Infinity, bounds), 4);
});

test("clampInteger clamps into range and rounds", () => {
  const bounds = { min: 1, max: 10, fallback: 4 };
  assert.equal(clampInteger("7", bounds), 7);
  assert.equal(clampInteger("0", bounds), 1);
  assert.equal(clampInteger("-5", bounds), 1);
  assert.equal(clampInteger("999", bounds), 10);
  assert.equal(clampInteger("3.7", bounds), 4);
});

test("discoverySearchBudget keeps the production defaults when unset", () => {
  assert.deepEqual(discoverySearchBudget(), DISCOVERY_BUDGET_DEFAULTS);
  assert.deepEqual(discoverySearchBudget({}), DISCOVERY_BUDGET_DEFAULTS);
  assert.deepEqual(
    discoverySearchBudget({
      DISCOVERY_MAX_RESULTS: "",
      DISCOVERY_MAX_TOTAL_RESULTS: undefined,
    }),
    DISCOVERY_BUDGET_DEFAULTS,
  );
});

test("discoverySearchBudget applies and clamps operator overrides", () => {
  assert.deepEqual(
    discoverySearchBudget({
      DISCOVERY_MAX_RESULTS: "2",
      DISCOVERY_MAX_TOTAL_RESULTS: "5",
      DISCOVERY_MAX_TOOL_CALLS: "2",
      DISCOVERY_MAX_OUTPUT_TOKENS: "3000",
    }),
    {
      maxResults: 2,
      maxTotalResults: 5,
      maxToolCalls: 2,
      maxOutputTokens: 3000,
    },
  );
  assert.deepEqual(
    discoverySearchBudget({
      DISCOVERY_MAX_RESULTS: "999",
      DISCOVERY_MAX_TOTAL_RESULTS: "0",
      DISCOVERY_MAX_TOOL_CALLS: "-3",
      DISCOVERY_MAX_OUTPUT_TOKENS: "1000000",
    }),
    {
      maxResults: 20,
      maxTotalResults: 1,
      maxToolCalls: 1,
      maxOutputTokens: 32_000,
    },
  );
});

test("isCreditsExhausted detects the 402 status", () => {
  assert.equal(isCreditsExhausted(402), true);
  assert.equal(isCreditsExhausted(402, "anything"), true);
  assert.equal(isCreditsExhausted("402", ""), true);
});

test("isCreditsExhausted detects the provider message on other statuses", () => {
  assert.equal(
    isCreditsExhausted(
      400,
      '{"error":{"message":"This request requires more credits, or fewer max_tokens."}}',
    ),
    true,
  );
  assert.equal(isCreditsExhausted(403, "Insufficient credits"), true);
});

test("isCreditsExhausted stays false for ordinary failures", () => {
  assert.equal(isCreditsExhausted(500), false);
  assert.equal(isCreditsExhausted(429, "rate limit exceeded"), false);
  assert.equal(isCreditsExhausted(502, ""), false);
  assert.equal(isCreditsExhausted(200), false);
});

test("truncateErrorBody bounds and collapses the logged message", () => {
  assert.equal(truncateErrorBody("  a\n b  "), "a b");
  assert.equal(truncateErrorBody(undefined), "");
  const long = "x".repeat(ERROR_BODY_LOG_CHARS + 100);
  const cut = truncateErrorBody(long);
  assert.ok(cut.length < long.length);
  assert.match(cut, /\[\+100 chars\]$/);
});

test("countWebSearchCalls counts search items in the response", () => {
  assert.equal(countWebSearchCalls(undefined), 0);
  assert.equal(countWebSearchCalls({}), 0);
  assert.equal(countWebSearchCalls({ output: "nope" }), 0);
  assert.equal(
    countWebSearchCalls({
      output: [
        { type: "web_search_call" },
        { type: "message" },
        { type: "web_search_call" },
        null,
      ],
    }),
    2,
  );
});
