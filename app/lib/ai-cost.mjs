// Pure helpers for AI spend control and failure accounting, shared by the
// OpenRouter routes, the offline measurement harness and unit tests. Kept as
// an .mjs module so both `node --test tests/*.test.mjs` and the TypeScript
// routes can import it.

/** Search-budget defaults: the values discovery has always run with. */
export const DISCOVERY_BUDGET_DEFAULTS = {
  maxResults: 4,
  maxTotalResults: 10,
  maxToolCalls: 4,
  maxOutputTokens: 5000,
};

/** Sane ranges for operator-supplied overrides. */
export const DISCOVERY_BUDGET_RANGES = {
  maxResults: { min: 1, max: 20 },
  maxTotalResults: { min: 1, max: 50 },
  maxToolCalls: { min: 1, max: 10 },
  maxOutputTokens: { min: 500, max: 32_000 },
};

/** Env variable backing each budget knob. */
export const DISCOVERY_BUDGET_ENV = {
  maxResults: "DISCOVERY_MAX_RESULTS",
  maxTotalResults: "DISCOVERY_MAX_TOTAL_RESULTS",
  maxToolCalls: "DISCOVERY_MAX_TOOL_CALLS",
  maxOutputTokens: "DISCOVERY_MAX_OUTPUT_TOKENS",
};

/**
 * Parses an operator-supplied value and clamps it into [min, max].
 * Anything unparseable (empty, NaN, non-numeric) falls back to the default.
 *
 * @param {unknown} value
 * @param {{min: number, max: number, fallback: number}} bounds
 * @returns {number}
 */
export function clampInteger(value, { min, max, fallback }) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  if (!text) return fallback;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

/**
 * Resolves the discovery web-search budget from env, falling back to the
 * current production values so behaviour is unchanged until an operator
 * deliberately tunes it.
 *
 * @param {Record<string, unknown>} [source]
 * @returns {{maxResults: number, maxTotalResults: number, maxToolCalls: number, maxOutputTokens: number}}
 */
export function discoverySearchBudget(source = {}) {
  const resolve = (key) =>
    clampInteger(source[DISCOVERY_BUDGET_ENV[key]], {
      ...DISCOVERY_BUDGET_RANGES[key],
      fallback: DISCOVERY_BUDGET_DEFAULTS[key],
    });
  return {
    maxResults: resolve("maxResults"),
    maxTotalResults: resolve("maxTotalResults"),
    maxToolCalls: resolve("maxToolCalls"),
    maxOutputTokens: resolve("maxOutputTokens"),
  };
}

/**
 * Contact enrichment used to send an unbounded request: the digest cap existed
 * but nothing capped the number of pages behind it, the e-mail list glued onto
 * the prompt, the web-search results injected into the context (no
 * `max_tool_calls` at all) or the reasoning budget. Three calls on real pages
 * cost $0.151/$0.136/$0.114 against a ~$0.05 target. Every one of those inputs
 * is bounded here.
 */
export const ENRICHMENT_BUDGET_DEFAULTS = {
  /** Pages fetched and considered per prospect. */
  maxPages: 4,
  /** Chars of extracted text kept per page before the digest is built. */
  pageChars: 12_000,
  /** Hard cap on the digest actually placed in the prompt. */
  digestChars: 4_000,
  /** Harvested addresses listed in the prompt. */
  maxEmails: 12,
  /** Web-search knobs: results per call, results in total, calls. */
  maxResults: 3,
  maxTotalResults: 4,
  maxToolCalls: 2,
  /**
   * Reasoning tokens are drawn from this budget too, which is why 900 was
   * enough for the JSON but not for the JSON *after* thinking — the answer was
   * cut off mid-object and the parse threw.
   */
  maxOutputTokens: 1_600,
  /** Cap used for the single retry after a truncation signal. */
  retryOutputTokens: 3_200,
};

/** Sane ranges for operator-supplied enrichment overrides. */
export const ENRICHMENT_BUDGET_RANGES = {
  maxPages: { min: 1, max: 6 },
  pageChars: { min: 2_000, max: 40_000 },
  digestChars: { min: 1_000, max: 12_000 },
  maxEmails: { min: 1, max: 40 },
  maxResults: { min: 1, max: 10 },
  maxTotalResults: { min: 1, max: 20 },
  maxToolCalls: { min: 1, max: 5 },
  maxOutputTokens: { min: 600, max: 8_000 },
  retryOutputTokens: { min: 800, max: 16_000 },
};

/** Env variable backing each enrichment knob. */
export const ENRICHMENT_BUDGET_ENV = {
  maxPages: "ENRICHMENT_MAX_PAGES",
  pageChars: "ENRICHMENT_PAGE_CHARS",
  digestChars: "ENRICHMENT_DIGEST_CHARS",
  maxEmails: "ENRICHMENT_MAX_EMAILS",
  maxResults: "ENRICHMENT_MAX_RESULTS",
  maxTotalResults: "ENRICHMENT_MAX_TOTAL_RESULTS",
  maxToolCalls: "ENRICHMENT_MAX_TOOL_CALLS",
  maxOutputTokens: "ENRICHMENT_MAX_OUTPUT_TOKENS",
  retryOutputTokens: "ENRICHMENT_RETRY_OUTPUT_TOKENS",
};

/**
 * Resolves the enrichment budget from env, clamped into the ranges above.
 *
 * @param {Record<string, unknown>} [source]
 * @returns {typeof ENRICHMENT_BUDGET_DEFAULTS}
 */
export function enrichmentBudget(source = {}) {
  const resolved = /** @type {typeof ENRICHMENT_BUDGET_DEFAULTS} */ ({});
  for (const key of /** @type {Array<keyof typeof ENRICHMENT_BUDGET_DEFAULTS>} */ (
    Object.keys(ENRICHMENT_BUDGET_DEFAULTS)
  )) {
    resolved[key] = clampInteger(source[ENRICHMENT_BUDGET_ENV[key]], {
      ...ENRICHMENT_BUDGET_RANGES[key],
      fallback: ENRICHMENT_BUDGET_DEFAULTS[key],
    });
  }
  // A retry that is not bigger than the first attempt cannot fix truncation.
  resolved.retryOutputTokens = Math.max(
    resolved.retryOutputTokens,
    resolved.maxOutputTokens + 400,
  );
  return resolved;
}

/** Longest error body ever kept for a log line. */
export const ERROR_BODY_LOG_CHARS = 400;

/**
 * Shortens a provider error body for logging. Never returns the whole body,
 * so an oversized or secret-bearing payload cannot reach the logs.
 *
 * @param {unknown} body
 * @param {number} [limit]
 * @returns {string}
 */
export function truncateErrorBody(body, limit = ERROR_BODY_LOG_CHARS) {
  const text = typeof body === "string" ? body : String(body ?? "");
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit)}…[+${collapsed.length - limit} chars]`;
}

/**
 * True when OpenRouter refused the call because the account is out of money.
 * Detected from the HTTP status (402) or from the provider's message.
 *
 * @param {number} status
 * @param {string} [body]
 * @returns {boolean}
 */
export function isCreditsExhausted(status, body = "") {
  if (Number(status) === 402) return true;
  return /requires more credits|insufficient credits/i.test(String(body || ""));
}

/**
 * Counts web-search tool calls the model reports in the response body.
 * OpenRouter sometimes omits `usage.server_tool_use_details`, in which case
 * the response items are the only evidence a search happened.
 *
 * @param {unknown} response
 * @returns {number}
 */
export function countWebSearchCalls(response) {
  const output = /** @type {{output?: unknown}} */ (response || {}).output;
  if (!Array.isArray(output)) return 0;
  return output.filter((item) => {
    const type = String(
      /** @type {{type?: unknown}} */ (item || {}).type || "",
    );
    return /web_search/i.test(type);
  }).length;
}
