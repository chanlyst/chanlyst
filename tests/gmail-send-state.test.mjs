import assert from "node:assert/strict";
import test from "node:test";

import {
  SEND_ATTEMPT_TIMEOUT_MS,
  isAmbiguousGmailFailure,
  sequenceSendAttemptDecision,
  sendAttemptDecision,
  stableGmailMessageId,
} from "../app/lib/gmail-send-state.mjs";

const now = Date.parse("2026-08-12T12:00:00.000Z");

test("a live atomic claim blocks a concurrent sender", () => {
  assert.equal(
    sendAttemptDecision(
      { status: "sending", sendStartedAt: new Date(now - 1_000).toISOString() },
      now,
    ).action,
    "in_progress",
  );
});

test("an ambiguous failure waits before reconciliation", () => {
  const recent = {
    status: "failed",
    sendUncertain: 1,
    sendStartedAt: new Date(now - SEND_ATTEMPT_TIMEOUT_MS + 1).toISOString(),
  };
  const old = {
    ...recent,
    sendStartedAt: new Date(now - SEND_ATTEMPT_TIMEOUT_MS).toISOString(),
  };
  assert.equal(sendAttemptDecision(recent, now).action, "unconfirmed");
  assert.equal(sendAttemptDecision(old, now).action, "reconcile");
});

test("a crashed sending claim is reconciled instead of blindly resent", () => {
  assert.equal(
    sendAttemptDecision({ status: "sending", sendStartedAt: null }, now).action,
    "reconcile",
  );
});

test("ordinary queued and definite failed messages can be claimed", () => {
  assert.equal(sendAttemptDecision({ status: "queued" }, now).action, "claim");
  assert.equal(
    sendAttemptDecision({ status: "failed", sendUncertain: 0 }, now).action,
    "claim",
  );
  assert.equal(sendAttemptDecision({ status: "sent" }, now).action, "already_sent");
});

test("stable Gmail Message-ID is deterministic and header-safe", async () => {
  const first = await stableGmailMessageId("workspace", "client\r\ninjected");
  const second = await stableGmailMessageId("workspace", "client\r\ninjected");
  const other = await stableGmailMessageId("workspace", "other");
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^<chanlyst\.[a-f0-9]{40}@chanlyst\.com>$/);
  assert.ok(!first.includes("\r") && !first.includes("\n"));
});

test("only transport and service failures are delivery-ambiguous", () => {
  assert.equal(isAmbiguousGmailFailure("gmail_send_failed", 0), true);
  assert.equal(isAmbiguousGmailFailure("gmail_service_unavailable", 503), true);
  assert.equal(isAmbiguousGmailFailure("gmail_rate_limited", 429), false);
  assert.equal(isAmbiguousGmailFailure("gmail_permission_required", 403), false);
  assert.equal(isAmbiguousGmailFailure("gmail_reconnect_required", 0), false);
});

test("a sequence claim distinguishes a busy worker from an uncertain send", () => {
  const recent = new Date(now - 1_000).toISOString();
  assert.equal(
    sequenceSendAttemptDecision({ sendStartedAt: recent, sendUncertain: 0 }, now)
      .action,
    "in_progress",
  );
  assert.equal(
    sequenceSendAttemptDecision({ sendStartedAt: recent, sendUncertain: 1 }, now)
      .action,
    "unconfirmed",
  );
});

test("only a stale uncertain sequence step requires reconciliation", () => {
  const stale = new Date(now - SEND_ATTEMPT_TIMEOUT_MS).toISOString();
  assert.equal(
    sequenceSendAttemptDecision({ sendStartedAt: stale, sendUncertain: 0 }, now)
      .action,
    "claim",
  );
  assert.equal(
    sequenceSendAttemptDecision({ sendStartedAt: stale, sendUncertain: 1 }, now)
      .action,
    "reconcile",
  );
});
