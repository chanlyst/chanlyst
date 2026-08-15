import { env } from "cloudflare:workers";
import {
  decryptSecret,
  encryptSecret,
  getIntegrationCredentials,
} from "../../lib/secret";
import { isAuthResponse, requireApiSession } from "../../lib/auth";
import {
  encodeMimeSubject,
  sanitizeHeaderValue,
} from "../../lib/security-helpers.mjs";
import {
  isRecipientSuppressed,
  validateOutreachRecipient,
} from "../../lib/outreach-recipient.mjs";
import {
  GmailProviderError,
  gmailFailure,
  gmailFailureHttpStatus,
  gmailResponseError,
} from "../../lib/gmail-failure.mjs";
import {
  isAmbiguousGmailFailure,
  sendAttemptDecision,
  stableGmailMessageId,
} from "../../lib/gmail-send-state.mjs";

// Outreach leaves through the user's own connected Gmail account; the
// provider field stays in the payload so the stored message records which
// mailbox sent it, but "gmail" is the only value the route accepts.
type SendPayload = {
  messageId?: string;
  provider?: "gmail";
  // Kept temporarily for backwards compatibility. The server deliberately
  // sends the stored message to the current verified lead address instead of
  // trusting recipient or content supplied by the browser.
  to?: string;
  subject?: string;
  body?: string;
};

type StoredMessage = {
  id?: string;
  status?: string;
  subject?: string;
  body?: string;
  email?: string;
  leadStatus?: string;
  outreachEligible?: number;
  telegram?: string;
  linkedin?: string;
  contactStatus?: string;
  contactEvidence?: string;
  opportunityType?: string;
  actionType?: string;
  sendStartedAt?: string | null;
  sendUncertain?: number;
};

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function gmailToken(
  database: D1Database,
  record: Record<string, unknown>,
  bindings: { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string },
  workspaceId: string,
) {
  const expiresAt = Date.parse(String(record.expiresAt || ""));
  if (expiresAt > Date.now() + 60_000) {
    return decryptSecret(String(record.accessToken || ""));
  }
  const refreshToken = await decryptSecret(String(record.refreshToken || ""));
  const saved = await getIntegrationCredentials("gmail_config", workspaceId);
  const clientId = bindings.GOOGLE_CLIENT_ID || saved.accessToken;
  const clientSecret = bindings.GOOGLE_CLIENT_SECRET || saved.refreshToken;
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("gmail_reconnect_required");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw await gmailResponseError(response, "refresh");
  const tokens = (await response.json()) as { access_token: string; expires_in?: number };
  const newExpiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  await database
    .prepare(
      `UPDATE workspace_integrations SET access_token=?, expires_at=?, updated_at=?
       WHERE workspace_id=? AND provider='gmail'`,
    )
    .bind(
      await encryptSecret(tokens.access_token),
      newExpiry,
      new Date().toISOString(),
      workspaceId,
    )
    .run();
  return tokens.access_token;
}

async function findSentByMessageId(token: string, messageIdHeader: string) {
  const rfc822MessageId = messageIdHeader.replace(/^<|>$/g, "");
  const query = encodeURIComponent(`in:sent rfc822msgid:${rfc822MessageId}`);
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw await gmailResponseError(response, "read");
  const result = (await response.json()) as {
    messages?: Array<{ id?: string; threadId?: string }>;
  };
  return result.messages?.[0] || null;
}

async function markMessageSent(
  database: D1Database,
  workspaceId: string,
  messageId: string,
  gmailThreadId: string,
) {
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `UPDATE outbound_messages SET status='sent', sent_at=?,
         gmail_thread_id=?, error=NULL, error_status_code=0,
         send_started_at=NULL, send_uncertain=0
         WHERE id=? AND workspace_id=?`,
      )
      .bind(now, gmailThreadId, messageId, workspaceId),
    database
      .prepare(
        `UPDATE prospects SET stage='contacted',
         contacted_at=COALESCE(contacted_at, ?), updated_at=?
         WHERE workspace_id=? AND id=(
           SELECT lead_id FROM outbound_messages
           WHERE id=? AND workspace_id=?
         )`,
      )
      .bind(now, now, workspaceId, messageId, workspaceId),
  ]);
}

function attemptResponse(action: string) {
  if (action === "already_sent") {
    return Response.json({ sent: true, provider: "gmail", alreadySent: true });
  }
  if (action === "in_progress") {
    return Response.json({ error: "send_in_progress" }, { status: 409 });
  }
  return Response.json(
    { error: "gmail_delivery_unconfirmed" },
    { status: 409 },
  );
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const payload = (await request.json()) as SendPayload;
  const bindings = env as unknown as {
    DB?: D1Database;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
  };
  if (!bindings.DB || !payload.messageId || payload.provider !== "gmail") {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const message = await bindings.DB
    .prepare(
      `SELECT m.id, m.status, m.subject, m.body,
       m.send_started_at as sendStartedAt, m.send_uncertain as sendUncertain,
       p.email,
       p.status as leadStatus, p.outreach_eligible as outreachEligible,
       p.telegram, p.linkedin, p.contact_status as contactStatus,
       p.contact_evidence as contactEvidence,
       p.opportunity_type as opportunityType, p.action_type as actionType
       FROM outbound_messages m
       JOIN prospects p ON p.id=m.lead_id AND p.product_id=m.product_id
       WHERE m.id=? AND m.workspace_id=? AND p.workspace_id=?`,
    )
    .bind(payload.messageId, auth.workspaceId, auth.workspaceId)
    .first<StoredMessage>();
  if (!message) {
    return Response.json({ error: "message_not_found" }, { status: 404 });
  }
  const attempt = sendAttemptDecision(message);
  if (["already_sent", "in_progress", "unconfirmed"].includes(attempt.action)) {
    return attemptResponse(attempt.action);
  }
  const eligibility = validateOutreachRecipient(
    { ...message, status: message.leadStatus },
    { gate: "approval" },
  );
  if (!eligibility.ok) {
    await bindings.DB
      .prepare(
        `UPDATE outbound_messages SET status='failed', error=?, error_status_code=0,
         send_started_at=NULL, send_uncertain=0
         WHERE id=? AND workspace_id=?`,
      )
      .bind(eligibility.error, payload.messageId, auth.workspaceId)
      .run();
    return Response.json({ error: eligibility.error }, { status: 409 });
  }
  const recipient = eligibility.email;
  if (await isRecipientSuppressed(bindings.DB, auth.workspaceId, recipient)) {
    await bindings.DB
      .prepare(
        `UPDATE outbound_messages SET status='failed', error='recipient_suppressed',
         error_status_code=0, send_started_at=NULL, send_uncertain=0
         WHERE id=? AND workspace_id=?`,
      )
      .bind(payload.messageId, auth.workspaceId)
      .run();
    return Response.json({ error: "recipient_suppressed" }, { status: 409 });
  }
  const subject = sanitizeHeaderValue(message.subject || "");
  const integration = await bindings.DB
    .prepare(
      `SELECT provider, access_token as accessToken, refresh_token as refreshToken,
       expires_at as expiresAt, metadata FROM workspace_integrations
       WHERE workspace_id=? AND provider=? AND status='connected'`,
    )
    .bind(auth.workspaceId, payload.provider)
    .first<Record<string, unknown>>();
  if (!integration) {
    await bindings.DB
      .prepare(
        `UPDATE outbound_messages SET status='failed',
         error='provider_not_connected', error_status_code=0,
         send_started_at=NULL, send_uncertain=0
         WHERE id=? AND workspace_id=?`,
      )
      .bind(payload.messageId, auth.workspaceId)
      .run();
    return Response.json(
      { error: "provider_not_connected", statusCode: 0 },
      { status: 409 },
    );
  }

  let preserveUncertainty = attempt.action === "reconcile";
  let claimed = false;
  let sendRequested = false;
  try {
    const attemptStartedAt = new Date().toISOString();
    const claim = await bindings.DB
      .prepare(
        `UPDATE outbound_messages SET status='sending', send_started_at=?,
         send_uncertain=?, error=NULL, error_status_code=0
         WHERE id=? AND workspace_id=? AND (
           status IN ('queued','failed') OR
           (status='sending' AND (send_started_at IS NULL OR send_started_at<=?))
         )`,
      )
      .bind(
        attemptStartedAt,
        preserveUncertainty ? 1 : 0,
        payload.messageId,
        auth.workspaceId,
        attempt.staleBefore,
      )
      .run();
    if (Number(claim.meta.changes || 0) !== 1) {
      const current = await bindings.DB
        .prepare(
          `SELECT status, send_started_at as sendStartedAt,
           send_uncertain as sendUncertain
           FROM outbound_messages WHERE id=? AND workspace_id=?`,
        )
        .bind(payload.messageId, auth.workspaceId)
        .first<StoredMessage>();
      return attemptResponse(sendAttemptDecision(current || {}).action);
    }
    claimed = true;

    let token: string;
    try {
      token = await gmailToken(
        bindings.DB,
        integration,
        bindings,
        auth.workspaceId,
      );
    } catch (error) {
      if (error instanceof GmailProviderError) throw error;
      throw new Error("gmail_reconnect_required");
    }

    const messageIdHeader = await stableGmailMessageId(
      auth.workspaceId,
      payload.messageId,
    );
    if (preserveUncertainty) {
      const existing = await findSentByMessageId(token, messageIdHeader);
      if (existing) {
        await markMessageSent(
          bindings.DB,
          auth.workspaceId,
          payload.messageId,
          String(existing.threadId || ""),
        );
        preserveUncertainty = false;
        return Response.json({
          sent: true,
          provider: payload.provider,
          reconciled: true,
        });
      }
      preserveUncertainty = false;
    }
    const mime = [
      `To: ${recipient}`,
      `Subject: ${encodeMimeSubject(subject)}`,
      `Message-ID: ${messageIdHeader}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      message.body || "",
    ].join("\r\n");
    sendRequested = true;
    const sent = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: base64Url(mime) }),
      },
    );
    if (!sent.ok) throw await gmailResponseError(sent, "send");
    const sentMessage = (await sent.json()) as {
      id?: string;
      threadId?: string;
    };
    const gmailThreadId = String(sentMessage.threadId || "");
    await markMessageSent(
      bindings.DB,
      auth.workspaceId,
      payload.messageId,
      gmailThreadId,
    );
    return Response.json({ sent: true, provider: payload.provider });
  } catch (error) {
    const failure = gmailFailure(error);
    const uncertain =
      preserveUncertainty ||
      (sendRequested && isAmbiguousGmailFailure(failure.code, failure.statusCode));
    if (claimed && payload.messageId) {
      await bindings.DB
        .prepare(
          `UPDATE outbound_messages SET status='failed', error=?, error_status_code=?,
           send_uncertain=? WHERE id=? AND workspace_id=? AND status!='sent'`,
        )
        .bind(
          failure.code,
          failure.statusCode,
          uncertain ? 1 : 0,
          payload.messageId,
          auth.workspaceId,
        )
        .run();
    }
    return Response.json(
      {
        error: uncertain ? "gmail_delivery_unconfirmed" : failure.code,
        diagnostic: failure.code,
        statusCode: failure.statusCode,
      },
      {
        status: uncertain
          ? 409
          : gmailFailureHttpStatus(failure.code),
      },
    );
  }
}
