import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const dashboard = () => readFileSync("app/dashboard/signalist-dashboard.tsx", "utf8");
const composer = () => readFileSync("app/dashboard/sections/composer.tsx", "utf8");
const copy = () => readFileSync("app/dashboard/i18n.ts", "utf8");
const sendRoute = () => readFileSync("app/api/send/route.ts", "utf8");
const sequenceRoute = () =>
  readFileSync("app/api/outreach-sequences/route.ts", "utf8");
const sequenceEngine = () =>
  readFileSync("app/api/outreach-engine/run/route.ts", "utf8");
const messagesRoute = () => readFileSync("app/api/messages/route.ts", "utf8");
const queue = () => readFileSync("app/dashboard/sections/queue-section.tsx", "utf8");

// The whole point of the product is that a message leaves. /api/send was not
// called once in thirty days while three messages sat in the queue, because
// the button that ended the compose form said "Add to queue" and the toast
// agreed — and neither said the job was unfinished.
test("the composer can send, not only queue", () => {
  const source = composer();

  assert.ok(source.includes("queueMessage(true)"), "there is no send action");
  assert.ok(source.includes("queueMessage(false)"), "queueing lost its explicit argument");
  assert.ok(
    source.includes("gmailConnected"),
    "send must be offered only where there is a mailbox to send from",
  );
  assert.ok(
    dashboard().includes("gmailConnected={Boolean(connected.gmail)}"),
    "the composer is never told whether Gmail is connected",
  );
});

test("queueing hands the message straight to the sender when asked", () => {
  const source = dashboard();

  assert.ok(source.includes("async function queueMessage(sendNow = false)"));
  assert.ok(
    /if \(sendNow\) \{\s*await sendEmail\(message\);/.test(source),
    "sendNow does not reach sendEmail",
  );
});

test("the client only shows a queued message after the server persisted it", () => {
  const source = dashboard();
  const persist = source.indexOf("await createMessageApi(message)");
  const render = source.indexOf("setMessages((current) => [message, ...current])", persist);

  assert.ok(persist > -1 && render > persist, "the optimistic ghost message is back");
  assert.ok(source.includes("if (!ok || !result.persisted)"));
  assert.ok(
    !source.includes('await updateOutcome(selectedLead.id, "queued"'),
    "queue creation still performs a second, non-atomic stage write",
  );
});

test("the message route persists the queue row and funnel stage together", () => {
  const source = messagesRoute();

  assert.ok(source.includes("validateOutreachRecipient(lead"));
  assert.ok(source.includes("isRecipientSuppressed("));
  assert.ok(source.includes("const results = await db.batch(["));
  assert.ok(source.includes("results[0]?.meta?.changes"));
  assert.ok(source.includes("results[1]?.meta?.changes"));
  assert.ok(source.includes('error: "message_persist_failed"'));
});

test("a stale sending row becomes retryable in the queue", () => {
  const source = messagesRoute();
  assert.ok(source.includes("SEND_ATTEMPT_TIMEOUT_MS"));
  assert.ok(source.includes("THEN 'failed' ELSE status END as status"));
  assert.ok(source.includes("THEN 1 ELSE send_uncertain END as sendUncertain"));
});

test("the send route resolves recipient and content from stored workspace data", () => {
  const source = sendRoute();

  assert.ok(source.includes("JOIN prospects p ON p.id=m.lead_id"));
  assert.ok(source.includes("validateOutreachRecipient("));
  assert.ok(source.includes("isRecipientSuppressed("));
  assert.ok(source.includes("message.subject || \"\""));
  assert.ok(source.includes("message.body || \"\""));
  assert.ok(
    !source.includes("sanitizeHeaderValue(payload.subject"),
    "the browser can still replace the stored subject",
  );
  assert.ok(
    !source.includes("payload.body || \"\""),
    "the browser can still replace the stored body",
  );
});

test("the send route atomically claims and reconciles one-off messages", () => {
  const source = sendRoute();
  assert.ok(source.includes("status='sending'"));
  assert.ok(source.includes("status IN ('queued','failed')"));
  assert.ok(source.includes("claim.meta.changes"));
  assert.ok(source.includes("stableGmailMessageId("));
  assert.ok(source.includes("rfc822msgid:"));
  assert.ok(source.includes("findSentByMessageId("));
  assert.ok(source.includes("reconciled: true"));
  assert.ok(source.includes("send_uncertain=?"));
});

test("sequences re-check the recipient on activation and before every send", () => {
  assert.ok(sequenceRoute().includes("validateOutreachRecipient("));
  assert.ok(sequenceRoute().includes("isRecipientSuppressed("));
  assert.ok(sequenceEngine().includes("validateOutreachRecipient("));
  assert.ok(sequenceEngine().includes("isRecipientSuppressed("));
});

test("sequence workers atomically claim and reconcile a step before sending", () => {
  const source = sequenceEngine();
  assert.ok(source.includes("claim.meta.changes"));
  assert.ok(source.includes("send_started_at IS NULL OR send_started_at<=?"));
  assert.ok(source.includes("send_uncertain=1"));
  assert.ok(source.includes("stableGmailMessageId("));
  assert.ok(source.includes("rfc822msgid:"));
  assert.ok(source.includes("findSentByMessageId("));
  assert.ok(source.includes("INSERT OR IGNORE INTO outreach_events"));
  assert.ok(source.includes("sequence.preserveUncertainty"));
  assert.ok(source.includes("sequence.gmailAccepted = true"));
  assert.ok(source.includes("`Message-ID: ${stableMessageId}`"));
});

test("a sequence cannot resume while Gmail delivery is still unresolved", () => {
  const route = sequenceRoute();
  assert.ok(route.includes("sequenceSendAttemptDecision(sequence)"));
  assert.ok(route.includes('error: "send_in_progress"'));
  assert.ok(route.includes('error: "gmail_delivery_unconfirmed"'));
  assert.ok(queue().includes("item.sendInProgress"));
});

test("Gmail failures keep a safe category and status without provider bodies", () => {
  const interactive = sendRoute();
  const engine = sequenceEngine();

  assert.ok(interactive.includes('await gmailResponseError(sent, "send")'));
  assert.ok(interactive.includes("error_status_code=?"));
  assert.ok(interactive.includes("statusCode: failure.statusCode"));
  assert.ok(engine.includes('await gmailResponseError(response, "send")'));
  assert.ok(engine.includes("statusCode: failure.statusCode"));
  assert.ok(engine.includes("JSON.stringify({"));
  assert.ok(
    !interactive.includes("await sent.text()") && !engine.includes("await response.text()"),
    "a Google response body can still leak into diagnostics",
  );
});

test("the queue translates Gmail error codes into actions", () => {
  const source = queue();
  assert.ok(
    source.includes(
      'deliveryFailureMessage(message.sendUncertain ? "gmail_delivery_unconfirmed" : message.error, locale)',
    ),
  );
  assert.ok(source.includes("Google HTTP ${message.errorStatusCode}"));
  assert.ok(source.includes("deliveryFailureMessage(item.stoppedReason, locale)"));
  assert.ok(source.includes("deliveryFailureNeedsReconnect(message.error)"));
  assert.ok(source.includes('href="/dashboard/integrations"'));
  assert.ok(source.includes('message.status === "sending"'));
  assert.ok(source.includes('["queued", "failed"].includes(message.status)'));
});

// A confirmation that hides an unfinished step is a lie told politely.
test("the queued toast says it has not been sent, and offers to send", () => {
  const source = dashboard();
  const text = copy();

  assert.ok(source.includes("href: \"/dashboard/queue\""), "the toast offers no way on");
  assert.ok(source.includes("action?: { href: string; label: string }"));
  assert.ok(
    text.includes("Ещё не отправлено") && text.includes("Not sent yet"),
    "the toast still claims the job is done, in one language or both",
  );
  // A toast with something to do in it has to outlast the reflex to ignore it.
  assert.ok(source.includes("action ? 7000 : 3200"));
});
