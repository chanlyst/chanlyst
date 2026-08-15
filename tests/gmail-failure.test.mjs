import assert from "node:assert/strict";
import test from "node:test";

import {
  GmailProviderError,
  classifyGmailStatus,
  gmailFailure,
  gmailFailureHttpStatus,
  gmailResponseError,
} from "../app/lib/gmail-failure.mjs";

test("Gmail statuses become actionable categories", () => {
  assert.equal(classifyGmailStatus(400, "refresh"), "gmail_reconnect_required");
  assert.equal(classifyGmailStatus(401, "send"), "gmail_reconnect_required");
  assert.equal(classifyGmailStatus(403, "send"), "gmail_permission_required");
  assert.equal(classifyGmailStatus(429, "send"), "gmail_rate_limited");
  assert.equal(classifyGmailStatus(503, "send"), "gmail_service_unavailable");
  assert.equal(classifyGmailStatus(400, "send"), "gmail_request_rejected");
  assert.equal(classifyGmailStatus(404, "read"), "gmail_read_failed");
});

test("Gmail diagnostics retain only category and HTTP status", async () => {
  const error = await gmailResponseError({ status: 403 }, "send");
  assert.ok(error instanceof GmailProviderError);
  assert.deepEqual(gmailFailure(error), {
    code: "gmail_permission_required",
    statusCode: 403,
  });
  assert.deepEqual(gmailFailure(new Error("private provider response")), {
    code: "gmail_send_failed",
    statusCode: 0,
  });
});

test("a 403 quota reason is not misreported as a permissions problem", async () => {
  const error = await gmailResponseError(
    {
      status: 403,
      clone: () => ({
        json: async () => ({
          error: { errors: [{ reason: "userRateLimitExceeded" }] },
        }),
      }),
    },
    "send",
  );
  assert.deepEqual(gmailFailure(error), {
    code: "gmail_rate_limited",
    statusCode: 403,
  });
});

test("public response statuses distinguish retry and user action", () => {
  assert.equal(gmailFailureHttpStatus("gmail_rate_limited"), 429);
  assert.equal(gmailFailureHttpStatus("gmail_service_unavailable"), 503);
  assert.equal(gmailFailureHttpStatus("gmail_reconnect_required"), 409);
  assert.equal(gmailFailureHttpStatus("gmail_request_rejected"), 422);
});
