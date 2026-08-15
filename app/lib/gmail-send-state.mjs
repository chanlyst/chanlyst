// Server-side Gmail send state. The browser's disabled button is useful UX,
// but only an atomic D1 transition can stop two tabs, cron workers, or retries
// from handing the same message to Gmail at once.

export const SEND_ATTEMPT_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * @param {{status?: string, sendStartedAt?: string|null, sendUncertain?: number|boolean}} message
 * @param {number} [now]
 * @returns {{action:"already_sent"|"in_progress"|"unconfirmed"|"claim"|"reconcile", staleBefore:string}}
 */
export function sendAttemptDecision(message, now = Date.now()) {
  const staleBefore = new Date(now - SEND_ATTEMPT_TIMEOUT_MS).toISOString();
  if (message?.status === "sent") return { action: "already_sent", staleBefore };

  const startedAt = Date.parse(String(message?.sendStartedAt || ""));
  const recent = Number.isFinite(startedAt) && startedAt > now - SEND_ATTEMPT_TIMEOUT_MS;
  if (message?.status === "sending" && recent) {
    return { action: "in_progress", staleBefore };
  }

  // A crashed `sending` row and an explicitly uncertain network failure both
  // need reconciliation. Waiting gives Gmail's search index time to expose an
  // accepted message before a retry is allowed to send another copy.
  const uncertain = Boolean(message?.sendUncertain) || message?.status === "sending";
  if (uncertain && recent) return { action: "unconfirmed", staleBefore };
  if (uncertain) return { action: "reconcile", staleBefore };
  return { action: "claim", staleBefore };
}

/**
 * A sequence stays `active` while a worker owns it, so its claim state is
 * separate from its product status. A stale pre-send claim can be retried;
 * a stale claim that reached Gmail must be reconciled first.
 * @param {{sendStartedAt?: string|null, sendUncertain?: number|boolean}} sequence
 * @param {number} [now]
 * @returns {{action:"in_progress"|"unconfirmed"|"claim"|"reconcile", staleBefore:string}}
 */
export function sequenceSendAttemptDecision(sequence, now = Date.now()) {
  const staleBefore = new Date(now - SEND_ATTEMPT_TIMEOUT_MS).toISOString();
  const startedAt = Date.parse(String(sequence?.sendStartedAt || ""));
  const recent = Number.isFinite(startedAt) && startedAt > now - SEND_ATTEMPT_TIMEOUT_MS;
  if (recent) {
    return {
      action: sequence?.sendUncertain ? "unconfirmed" : "in_progress",
      staleBefore,
    };
  }
  return {
    action: sequence?.sendUncertain ? "reconcile" : "claim",
    staleBefore,
  };
}

/**
 * Stable RFC Message-ID for Gmail reconciliation. Only the digest is exposed
 * to the provider, so even a client-chosen D1 id cannot inject a MIME header.
 * @param {string} workspaceId
 * @param {string} messageId
 */
export async function stableGmailMessageId(workspaceId, messageId) {
  const bytes = new TextEncoder().encode(`${workspaceId}\u0000${messageId}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `<chanlyst.${hex.slice(0, 40)}@chanlyst.com>`;
}

/** @param {string} code @param {number} statusCode */
export function isAmbiguousGmailFailure(code, statusCode) {
  return (
    (code === "gmail_send_failed" && !statusCode) ||
    code === "gmail_service_unavailable"
  );
}
