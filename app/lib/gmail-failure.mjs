/**
 * Safe Gmail diagnostics shared by interactive sends and the sequence engine.
 *
 * We deliberately keep only our own category and Google's HTTP status. A
 * structured error reason may be inspected in memory to distinguish quota
 * from permissions, but provider bodies and reason strings are never copied
 * to D1, logs, or the browser.
 */

const reconnectStatuses = new Set([401]);

/** @typedef {"refresh" | "send" | "read"} GmailPhase */

export class GmailProviderError extends Error {
  /**
   * @param {string} code
   * @param {number} [statusCode]
   */
  constructor(code, statusCode = 0) {
    super(code);
    this.name = "GmailProviderError";
    this.code = code;
    this.statusCode = Number.isInteger(statusCode) ? statusCode : 0;
  }
}

/**
 * @param {number} statusCode
 * @param {GmailPhase} phase
 * @param {string} [providerReason]
 */
export function classifyGmailStatus(statusCode, phase, providerReason = "") {
  const status = Number(statusCode) || 0;
  const reason = providerReason.toLowerCase();
  if (
    /ratelimit|quota|dailylimit|userratelimit|limitexceeded/.test(reason)
  ) {
    return "gmail_rate_limited";
  }
  if (/backenderror|internalerror|serviceunavailable/.test(reason)) {
    return "gmail_service_unavailable";
  }
  if (/insufficientpermission|forbidden|accessnotconfigured/.test(reason)) {
    return "gmail_permission_required";
  }
  if (/autherror|invalidcredential|unauthenticated/.test(reason)) {
    return "gmail_reconnect_required";
  }
  // Google's OAuth endpoint uses 400 for invalid_grant (expired or revoked
  // refresh token). We do not inspect or retain its response body.
  if (reconnectStatuses.has(status) || (phase === "refresh" && status === 400)) {
    return "gmail_reconnect_required";
  }
  if (status === 403) return "gmail_permission_required";
  if (status === 429) return "gmail_rate_limited";
  if (status >= 500) return "gmail_service_unavailable";
  if (phase === "send" && status === 400) return "gmail_request_rejected";
  if (phase === "read" && status >= 400) return "gmail_read_failed";
  if (phase === "refresh") return "gmail_refresh_failed";
  return "gmail_send_failed";
}

/**
 * @param {{status?: number, clone?: () => {json?: () => Promise<unknown>}}} response
 * @param {GmailPhase} phase
 */
export async function gmailResponseError(response, phase) {
  const statusCode = Number(response?.status) || 0;
  let providerReason = "";
  try {
    const body = await response?.clone?.().json?.();
    if (body && typeof body === "object") {
      const root = /** @type {Record<string, unknown>} */ (body);
      const detail = root.error && typeof root.error === "object"
        ? /** @type {Record<string, unknown>} */ (root.error)
        : root;
      const errors = Array.isArray(detail.errors) ? detail.errors : [];
      const first = errors[0] && typeof errors[0] === "object"
        ? /** @type {Record<string, unknown>} */ (errors[0])
        : {};
      providerReason = String(first.reason || detail.status || "");
    }
  } catch {
    // A non-JSON error body still has a useful HTTP status.
  }
  return new GmailProviderError(
    classifyGmailStatus(statusCode, phase, providerReason),
    statusCode,
  );
}

/**
 * Converts arbitrary runtime failures to a storage-safe diagnostic.
 * @param {unknown} error
 * @param {string} [fallback]
 */
export function gmailFailure(error, fallback = "gmail_send_failed") {
  if (error instanceof GmailProviderError) {
    return { code: error.code, statusCode: error.statusCode };
  }
  const code = error instanceof Error ? error.message : "";
  const safeCodes = new Set([
    "gmail_not_connected",
    "gmail_reconnect_required",
    "gmail_permission_required",
    "gmail_rate_limited",
    "gmail_service_unavailable",
    "gmail_request_rejected",
    "gmail_read_failed",
    "gmail_refresh_failed",
    "gmail_send_failed",
  ]);
  return { code: safeCodes.has(code) ? code : fallback, statusCode: 0 };
}

/** @param {string} code */
export function gmailFailureHttpStatus(code) {
  if (code === "gmail_rate_limited") return 429;
  if (code === "gmail_service_unavailable") return 503;
  if (code === "gmail_request_rejected") return 422;
  if (
    code === "gmail_reconnect_required" ||
    code === "gmail_permission_required" ||
    code === "gmail_not_connected"
  ) {
    return 409;
  }
  return 502;
}
