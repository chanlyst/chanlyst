// Pure helpers for reading an OpenRouter /responses payload: getting the text
// out of it, getting JSON out of that text, telling a truncated answer from a
// malformed one, and describing a failure in a log line that carries no key
// and no full body. Kept as an .mjs module so `node --test tests/*.test.mjs`
// and the TypeScript routes share exactly one implementation.
//
// Why this exists: three enrichment calls were billed at 200 OK and then
// discarded because `JSON.parse(outputText(raw))` threw. The old reader
// accepted a single content shape (`output[].content[].type === "output_text"`)
// and the old parser only stripped a ```json fence sitting at the very start
// and end of the string. Everything else — a reasoning item before the message,
// `output_text` arriving as an array of chunks, a sentence in front of the
// fence, or an answer cut off mid-object because the reasoning tokens ate the
// `max_output_tokens` budget — landed in the same silent `catch`.

/** Chars of model text kept in a failure log line. */
export const PARSE_FAILURE_SAMPLE_CHARS = 300;

/**
 * Every text-bearing content type the Responses API is known to emit for the
 * final message. Reasoning items carry `summary_text`/`reasoning` and are
 * deliberately excluded: they are never the JSON answer.
 */
const TEXT_CONTENT_TYPES = new Set(["output_text", "text", "input_text"]);

/** Item types that hold thinking, never the answer. */
const REASONING_ITEM_TYPES = /^(reasoning|thinking)/i;

/**
 * @param {unknown} value
 * @returns {string}
 */
function asText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(asText).join("");
  if (value && typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    if (typeof record.text === "string") return record.text;
    if (typeof record.value === "string") return record.value;
  }
  return "";
}

/**
 * Collects the model's answer text out of a Responses payload, whatever shape
 * the provider used this time.
 *
 * @param {unknown} response
 * @returns {string}
 */
export function collectOutputText(response) {
  const payload = /** @type {Record<string, any>} */ (response || {});
  const direct = asText(payload.output_text);
  if (direct.trim()) return direct;

  const items = Array.isArray(payload.output) ? payload.output : [];
  const parts = [];
  for (const item of items) {
    const type = String(item?.type || "");
    if (REASONING_ITEM_TYPES.test(type)) continue;
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const partType = String(part?.type || "");
      // An untyped part is still text when it carries a `text` field: some
      // providers omit `type` on the single content block.
      if (partType && !TEXT_CONTENT_TYPES.has(partType)) continue;
      parts.push(asText(part));
    }
  }
  if (parts.join("").trim()) return parts.join("");

  // Chat-completions shape, in case the account is routed through it.
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  return choices.map((choice) => asText(choice?.message?.content)).join("");
}

/**
 * Pulls the first complete JSON object or array out of a model answer:
 * tolerates a ```json fence anywhere, a sentence in front of it and trailing
 * prose behind it. Brace counting skips over strings and escapes so a `}`
 * inside a value cannot end the scan early.
 *
 * @param {string} text
 * @returns {string} the JSON slice, or "" when the text holds none
 */
export function extractJsonSlice(text) {
  const source = String(text ?? "");
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fenced ? [fenced[1], source] : [source];
  for (const candidate of candidates) {
    const slice = firstBalanced(candidate);
    if (slice) return slice;
  }
  return "";
}

/**
 * @param {string} text
 * @returns {string}
 */
function firstBalanced(text) {
  const start = text.search(/[[{]/);
  if (start < 0) return "";
  const opener = text[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return "";
}

/**
 * Parses the model's JSON answer, or throws when there is none to parse.
 *
 * @param {string} text
 * @returns {unknown}
 */
export function parseModelJson(text) {
  const slice = extractJsonSlice(text);
  if (!slice) throw new SyntaxError("no JSON object in model output");
  return JSON.parse(slice);
}

/**
 * True when the provider says the answer was cut off by the output-token cap
 * rather than finished. This is the ONLY condition a retry may key on: an
 * unconditional retry doubles the bill on every malformed answer.
 *
 * @param {unknown} response
 * @returns {boolean}
 */
export function isTruncatedResponse(response) {
  const payload = /** @type {Record<string, any>} */ (response || {});
  const reason = String(payload.incomplete_details?.reason || "");
  if (/max_output_tokens|max_tokens|length/i.test(reason)) return true;
  if (String(payload.status || "") === "incomplete") return true;
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  if (
    choices.some((choice) =>
      /^(length|max_output_tokens|max_tokens)$/i.test(
        String(choice?.finish_reason || choice?.native_finish_reason || ""),
      ),
    )
  ) {
    return true;
  }
  const items = Array.isArray(payload.output) ? payload.output : [];
  return items.some(
    (item) =>
      String(item?.type || "") === "message" &&
      String(item?.status || "") === "incomplete",
  );
}

/**
 * The single place that decides whether a billed attempt earns a retry.
 * True only for an attempt that failed AND carried a truncation signal: an
 * unconditional retry would double the bill on every malformed answer, and a
 * retry on a provider error would hammer a provider that is already refusing.
 *
 * @param {{kind?: string, truncated?: boolean} | null | undefined} attempt
 * @returns {boolean}
 */
export function shouldRetryForTruncation(attempt) {
  return attempt?.kind === "failed" && attempt?.truncated === true;
}

// The search-evidence readers that used to live here are gone, together with
// the citation rule they served. The provider does return `web_search_call`
// items — five of them in the run that prompted all this — but they carry only
// the query, and the message's `annotations` array comes back empty, so there
// was never anything for them to read. Checking the returned domains directly
// showed the rule was guarding nothing: every one was a live, real site. The
// mismatch that did reach the channel list is judged in relevance-check.mjs,
// against what each site says about itself.

/**
 * One-line, key-free description of a failed parse: enough to tell truncation
 * from a wrapped answer from an unknown content shape, without dumping the
 * body. Never includes headers, so the Authorization value cannot leak.
 *
 * @param {{operation: string, statusCode?: number, response?: unknown, text?: string, error?: unknown}} input
 * @returns {string}
 */
export function describeParseFailure({
  operation,
  statusCode = 0,
  response,
  text = "",
  error,
}) {
  const payload = /** @type {Record<string, any>} */ (response || {});
  const sample = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PARSE_FAILURE_SAMPLE_CHARS);
  const fields = [
    `openrouter ${operation} parse failed`,
    `status=${Math.max(0, Math.round(Number(statusCode) || 0))}`,
    `response_status=${String(payload.status || "unknown")}`,
    `incomplete_reason=${String(payload.incomplete_details?.reason || "none")}`,
    `truncated=${isTruncatedResponse(response)}`,
    `output_tokens=${Number(payload.usage?.output_tokens || payload.usage?.completion_tokens || 0)}`,
    `reasoning_tokens=${Number(
      payload.usage?.output_tokens_details?.reasoning_tokens ||
        payload.usage?.completion_tokens_details?.reasoning_tokens ||
        0,
    )}`,
    `text_chars=${String(text || "").length}`,
    `error=${String(/** @type {Error} */ (error)?.message || error || "none").slice(0, 120)}`,
    `text_head="${sample}"`,
  ];
  return fields.join(" ");
}
