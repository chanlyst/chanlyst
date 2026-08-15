import assert from "node:assert/strict";
import test from "node:test";
import { hasPaidAccess } from "../app/lib/subscription-access.mjs";

const NOW = Date.parse("2026-07-28T12:00:00.000Z");
const inDays = (days) =>
  new Date(NOW + days * 24 * 60 * 60 * 1000).toISOString();

test("a live subscription grants access", () => {
  assert.equal(hasPaidAccess({ status: "active" }, NOW), true);
  assert.equal(hasPaidAccess({ status: "on_trial" }, NOW), true);
});

// The bug this rule exists for: cancelling stops the renewal, not the month
// already paid for. The old query dropped such a customer to the free plan
// (1 product, 10 channels) the instant they clicked cancel.
test("cancelling keeps access until the paid period runs out", () => {
  assert.equal(
    hasPaidAccess({ status: "cancelled", endsAt: inDays(19) }, NOW),
    true,
  );
  assert.equal(
    hasPaidAccess({ status: "cancelled", endsAt: inDays(-1) }, NOW),
    false,
  );
});

test("a cancellation without an end date falls back to the next charge date", () => {
  assert.equal(
    hasPaidAccess({ status: "cancelled", endsAt: "", renewsAt: inDays(12) }, NOW),
    true,
  );
  // Nothing to go on at all: no date can be read as "still paid for".
  assert.equal(hasPaidAccess({ status: "cancelled" }, NOW), false);
});

// Refunds and chargebacks are not cancellations: the money went back, so the
// access goes with it regardless of how far away the period end is.
test("a refunded or disputed subscription loses access immediately", () => {
  assert.equal(
    hasPaidAccess({ status: "expired", endsAt: inDays(30) }, NOW),
    false,
  );
  assert.equal(
    hasPaidAccess({ status: "inactive", renewsAt: inDays(30) }, NOW),
    false,
  );
});

test("no subscription and unreadable dates never grant access", () => {
  assert.equal(hasPaidAccess(null, NOW), false);
  assert.equal(hasPaidAccess(undefined, NOW), false);
  assert.equal(
    hasPaidAccess({ status: "cancelled", endsAt: "не дата" }, NOW),
    false,
  );
});
