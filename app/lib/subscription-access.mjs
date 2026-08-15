// Does this subscription still grant paid access?
//
// One rule, one place. The rule already existed as `hasActiveAccess` in
// billing.ts and was correct — and nothing called it. The limits that actually
// gate the product asked the database instead, with
// `status IN ('active','on_trial')`, which silently dropped a customer to the
// free plan the moment they clicked cancel, days or weeks before the period
// they had already paid for ran out.
//
// The distinction that matters: cancelling ends the RENEWAL, not the current
// period. A refund or chargeback ends the access itself, and those arrive as
// "expired" — which never grants access here, whatever the dates say.

/** Statuses that grant access outright. */
const LIVE_STATUSES = ["active", "on_trial"];

/**
 * @param {unknown} value ISO timestamp or null
 * @param {number} now epoch ms
 * @returns {boolean} true when the moment is still ahead of us
 */
function inFuture(value, now) {
  const text = String(value || "").trim();
  if (!text) return false;
  const at = new Date(text).getTime();
  return Number.isFinite(at) && at > now;
}

/**
 * @param {{status?: string, endsAt?: string | null, renewsAt?: string | null} | null | undefined} subscription
 * @param {number} [now] epoch ms, injectable so the rule is testable
 * @returns {boolean}
 */
export function hasPaidAccess(subscription, now = Date.now()) {
  if (!subscription) return false;
  const status = String(subscription.status || "");
  if (LIVE_STATUSES.includes(status)) return true;
  if (status !== "cancelled") return false;
  // A cancelled subscription keeps what was paid for. `ends_at` is the date the
  // provider gives for the end of access; when a cancellation ping omits it,
  // the next-charge date is the same boundary seen from the other side, so it
  // is accepted as a fallback rather than cutting the customer off early.
  return (
    inFuture(subscription.endsAt, now) || inFuture(subscription.renewsAt, now)
  );
}
