import assert from "node:assert/strict";
import test from "node:test";
import {
  PARSE_FAILURE_SAMPLE_CHARS,
  collectOutputText,
  describeParseFailure,
  extractJsonSlice,
  isTruncatedResponse,
  parseModelJson,
  shouldRetryForTruncation,
} from "../app/lib/model-output.mjs";

// The three billed-but-discarded enrichment calls (200 OK, $0.151/$0.136/$0.114)
// all died in the same silent catch. These are the response shapes the old
// reader and the old parser could not handle, reconstructed from what the code
// expected versus what the Responses API actually emits.

// --- collectOutputText ------------------------------------------------------

test("collectOutputText reads the plain output_text field", () => {
  assert.equal(collectOutputText({ output_text: '{"email":"a@b.co"}' }), '{"email":"a@b.co"}');
});

test("collectOutputText joins an output_text delivered as chunks", () => {
  assert.equal(collectOutputText({ output_text: ['{"a":', "1}"] }), '{"a":1}');
});

test("collectOutputText skips a reasoning item sitting before the message", () => {
  const raw = {
    output: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "thinking…" }] },
      { type: "message", content: [{ type: "output_text", text: '{"email":"x@y.z"}' }] },
    ],
  };
  assert.equal(collectOutputText(raw), '{"email":"x@y.z"}');
});

test("collectOutputText accepts a content part typed plain 'text'", () => {
  const raw = { output: [{ type: "message", content: [{ type: "text", text: "{}" }] }] };
  assert.equal(collectOutputText(raw), "{}");
});

test("collectOutputText accepts an untyped content part carrying text", () => {
  const raw = { output: [{ type: "message", content: [{ text: "{}" }] }] };
  assert.equal(collectOutputText(raw), "{}");
});

test("collectOutputText falls back to the chat-completions shape", () => {
  const raw = { choices: [{ message: { content: '{"ok":true}' } }] };
  assert.equal(collectOutputText(raw), '{"ok":true}');
});

test("collectOutputText returns '' for a body with no text at all", () => {
  assert.equal(collectOutputText({ output: [{ type: "reasoning" }] }), "");
  assert.equal(collectOutputText(null), "");
});

// --- extractJsonSlice / parseModelJson --------------------------------------

test("parseModelJson survives a markdown fence anywhere in the answer", () => {
  const text = 'Вот контакт, который я нашёл:\n```json\n{"email":"ads@site.com"}\n```\nГотово.';
  assert.deepEqual(parseModelJson(text), { email: "ads@site.com" });
});

test("parseModelJson survives prose in front of a bare object", () => {
  assert.deepEqual(parseModelJson('Ответ: {"email":"a@b.co"} — источник страница /contact'), {
    email: "a@b.co",
  });
});

test("extractJsonSlice does not stop on a brace inside a string value", () => {
  const slice = extractJsonSlice('{"evidence":"пишите на {mail}","email":"a@b.co"}');
  assert.deepEqual(JSON.parse(slice), { evidence: "пишите на {mail}", email: "a@b.co" });
});

test("extractJsonSlice handles an escaped quote inside a value", () => {
  const slice = extractJsonSlice('{"evidence":"he said \\"hi\\"","confidence":40}');
  assert.deepEqual(JSON.parse(slice), { evidence: 'he said "hi"', confidence: 40 });
});

test("parseModelJson throws on a truncated object rather than inventing one", () => {
  // Exactly what a max_output_tokens cut-off looks like.
  assert.throws(() => parseModelJson('{"contactName":"Anna","role":"Partner'), SyntaxError);
});

test("parseModelJson throws when the answer holds no JSON at all", () => {
  assert.throws(() => parseModelJson("Не удалось найти контакт."), SyntaxError);
  assert.throws(() => parseModelJson(""), SyntaxError);
});

// --- the truncation signal and the retry condition --------------------------

const truncatedByCap = {
  status: "incomplete",
  incomplete_details: { reason: "max_output_tokens" },
  output: [
    {
      type: "message",
      status: "incomplete",
      content: [{ type: "output_text", text: '{"contactName":"Anna","ro' }],
    },
  ],
  usage: { output_tokens: 900, output_tokens_details: { reasoning_tokens: 832 } },
};

const wrappedInProse = {
  status: "completed",
  output: [
    {
      type: "message",
      status: "completed",
      content: [{ type: "output_text", text: 'Конечно! ```json\n{"email":"a@b.co"}\n```' }],
    },
  ],
};

test("isTruncatedResponse fires on the max_output_tokens cut-off", () => {
  assert.equal(isTruncatedResponse(truncatedByCap), true);
});

test("isTruncatedResponse fires on a chat-completions length finish", () => {
  assert.equal(isTruncatedResponse({ choices: [{ finish_reason: "length" }] }), true);
});

test("isTruncatedResponse stays false for a completed answer", () => {
  assert.equal(isTruncatedResponse(wrappedInProse), false);
  assert.equal(isTruncatedResponse({ status: "completed" }), false);
  assert.equal(isTruncatedResponse({}), false);
  assert.equal(isTruncatedResponse(null), false);
});

test("the retry fires on a truncation signal and on nothing else", () => {
  assert.equal(
    shouldRetryForTruncation({ kind: "failed", truncated: true }),
    true,
    "a truncated failure is the one case worth paying twice for",
  );
  // Everything else must NOT retry: an unconditional retry doubles the bill.
  assert.equal(shouldRetryForTruncation({ kind: "failed", truncated: false }), false);
  assert.equal(shouldRetryForTruncation({ kind: "ok", parsed: {} }), false);
  assert.equal(shouldRetryForTruncation({ kind: "credits" }), false);
  assert.equal(shouldRetryForTruncation(undefined), false);
});

test("the failing shapes end up on the right side of the retry rule", () => {
  const attempt = (raw) => {
    let parsed = null;
    try {
      parsed = parseModelJson(collectOutputText(raw));
    } catch {
      parsed = null;
    }
    return parsed
      ? { kind: "ok", parsed }
      : { kind: "failed", truncated: isTruncatedResponse(raw) };
  };
  // Cut off by the token cap → one bigger retry.
  assert.equal(shouldRetryForTruncation(attempt(truncatedByCap)), true);
  // Wrapped in prose → now parses on the first try, so no retry is even asked.
  const wrapped = attempt(wrappedInProse);
  assert.equal(wrapped.kind, "ok");
  assert.deepEqual(wrapped.parsed, { email: "a@b.co" });
  assert.equal(shouldRetryForTruncation(wrapped), false);
  // Complete but meaningless → failed, and NOT retried.
  const garbage = attempt({ status: "completed", output_text: "нет данных" });
  assert.equal(garbage.kind, "failed");
  assert.equal(shouldRetryForTruncation(garbage), false);
});

// --- the failure log line ---------------------------------------------------

test("describeParseFailure names the cause without leaking the body", () => {
  const line = describeParseFailure({
    operation: "contact_enrichment",
    statusCode: 200,
    response: truncatedByCap,
    text: collectOutputText(truncatedByCap),
    error: new SyntaxError("Unexpected end of JSON input"),
  });
  assert.match(line, /status=200/);
  assert.match(line, /response_status=incomplete/);
  assert.match(line, /incomplete_reason=max_output_tokens/);
  assert.match(line, /truncated=true/);
  assert.match(line, /reasoning_tokens=832/);
  assert.match(line, /Unexpected end of JSON input/);
  assert.match(line, /text_head="\{"contactName":"Anna","ro"/);
});

test("describeParseFailure clips the sample and carries no secret", () => {
  const line = describeParseFailure({
    operation: "contact_enrichment",
    statusCode: 200,
    response: { status: "completed" },
    text: `sk-or-v1-${"x".repeat(2000)}`,
  });
  assert.ok(line.length < 700, `log line stays short, got ${line.length}`);
  assert.equal(
    (line.match(/x/g) || []).length <= PARSE_FAILURE_SAMPLE_CHARS,
    true,
    "the sample is clipped, the body never lands in the log",
  );
  assert.match(line, /truncated=false/);
});
