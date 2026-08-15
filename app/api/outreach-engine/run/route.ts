import { env } from "cloudflare:workers";
import {
  decryptSecret,
  encryptSecret,
  getIntegrationCredentials,
} from "../../../lib/secret";
import { isAuthResponse, requireApiSession } from "../../../lib/auth";
import {
  encodeMimeSubject,
  isValidEmail,
  sanitizeHeaderValue,
  timingSafeEqualStrings,
} from "../../../lib/security-helpers.mjs";
import {
  isRecipientSuppressed,
  validateOutreachRecipient,
} from "../../../lib/outreach-recipient.mjs";
import {
  GmailProviderError,
  gmailFailure,
  gmailFailureHttpStatus,
  gmailResponseError,
} from "../../../lib/gmail-failure.mjs";
import {
  SEND_ATTEMPT_TIMEOUT_MS,
  isAmbiguousGmailFailure,
  stableGmailMessageId,
} from "../../../lib/gmail-send-state.mjs";

type Step = { subject?: string; body?: string; delayDays?: number };
type Sequence = {
  id: string;
  workspaceId: string;
  leadId: string;
  recipientEmail: string;
  recipientName: string;
  company: string;
  steps: string;
  nextStep: number;
  dailyLimit: number;
  sendStartedAt?: string | null;
  sendUncertain?: number;
  preserveUncertainty?: boolean;
  sendRequested?: boolean;
  gmailAccepted?: boolean;
};
type GmailMessage = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: { headers?: Array<{ name?: string; value?: string }> };
};

function bindings() {
  return env as unknown as {
    DB?: D1Database;
    AGENT_CRON_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
  };
}

function header(message: GmailMessage, name: string) {
  return (
    message.payload?.headers?.find(
      (item) => item.name?.toLowerCase() === name.toLowerCase(),
    )?.value || ""
  );
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function personalize(value: string, sequence: Sequence) {
  return value
    .replaceAll("{{first_name}}", sequence.recipientName.split(" ")[0] || "")
    .replaceAll("{{company_name}}", sequence.company || "")
    .replaceAll("{{email}}", sequence.recipientEmail);
}

async function gmailCredentials(workspaceId: string) {
  const db = bindings().DB!;
  const record = await db
    .prepare(
      `SELECT access_token as accessToken, refresh_token as refreshToken,
       expires_at as expiresAt, account_label as accountLabel
       FROM workspace_integrations
       WHERE workspace_id=? AND provider='gmail' AND status='connected'`,
    )
    .bind(workspaceId)
    .first<Record<string, unknown>>();
  if (!record) throw new Error("gmail_not_connected");
  const expiresAt = Date.parse(String(record.expiresAt || ""));
  if (expiresAt > Date.now() + 60_000) {
    return {
      token: await decryptSecret(String(record.accessToken || "")),
      accountEmail: String(record.accountLabel || ""),
    };
  }
  const refreshToken = await decryptSecret(String(record.refreshToken || ""));
  const saved = await getIntegrationCredentials("gmail_config", workspaceId);
  const clientId = bindings().GOOGLE_CLIENT_ID || saved.accessToken;
  const clientSecret = bindings().GOOGLE_CLIENT_SECRET || saved.refreshToken;
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
  const tokens = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };
  const expiry = new Date(
    Date.now() + (tokens.expires_in || 3600) * 1000,
  ).toISOString();
  await db
    .prepare(
      `UPDATE workspace_integrations SET access_token=?, expires_at=?,
       updated_at=? WHERE workspace_id=? AND provider='gmail'`,
    )
    .bind(
      await encryptSecret(tokens.access_token),
      expiry,
      new Date().toISOString(),
      workspaceId,
    )
    .run();
  return { token: tokens.access_token, accountEmail: String(record.accountLabel || "") };
}

async function gmailGet(token: string, path: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw await gmailResponseError(response, "read");
  return response.json();
}

async function findSentByMessageId(token: string, messageIdHeader: string) {
  const rfc822MessageId = messageIdHeader.replace(/^<|>$/g, "");
  const query = encodeURIComponent(`in:sent rfc822msgid:${rfc822MessageId}`);
  return gmailGet(token, `messages?q=${query}&maxResults=1`) as Promise<{
    messages?: Array<{ id?: string; threadId?: string }>;
  }>;
}

async function lastSentEvent(sequenceId: string) {
  return bindings()
    .DB!.prepare(
      `SELECT gmail_message_id as gmailMessageId,
       gmail_thread_id as gmailThreadId, occurred_at as occurredAt
       FROM outreach_events WHERE sequence_id=? AND event_type='sent'
       ORDER BY occurred_at DESC LIMIT 1`,
    )
    .bind(sequenceId)
    .first<{
      gmailMessageId?: string;
      gmailThreadId?: string;
      occurredAt?: string;
    }>();
}

async function sentEventForStep(sequenceId: string, stepNumber: number) {
  return bindings()
    .DB!.prepare(
      `SELECT gmail_message_id as gmailMessageId,
       gmail_thread_id as gmailThreadId, occurred_at as occurredAt
       FROM outreach_events
       WHERE sequence_id=? AND step_number=? AND event_type='sent'
       ORDER BY occurred_at DESC LIMIT 1`,
    )
    .bind(sequenceId, stepNumber)
    .first<{
      gmailMessageId?: string;
      gmailThreadId?: string;
      occurredAt?: string;
    }>();
}

async function replyState(
  sequence: Sequence,
  token: string,
  accountEmail: string,
) {
  const last = await lastSentEvent(sequence.id);
  if (!last?.gmailThreadId) return { replied: false, last };
  const thread = (await gmailGet(
    token,
    `threads/${encodeURIComponent(last.gmailThreadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Message-ID`,
  )) as { messages?: GmailMessage[] };
  const after = Date.parse(last.occurredAt || "");
  const replies = (thread.messages || []).filter((message) => {
    const from = header(message, "From").toLowerCase();
    return (
      Number(message.internalDate || 0) > after &&
      from.includes(sequence.recipientEmail.toLowerCase()) &&
      (!accountEmail || !from.includes(accountEmail.toLowerCase()))
    );
  });
  const reply = replies[replies.length - 1];
  return {
    replied: Boolean(reply),
    unsubscribe: /unsubscribe|remove me|stop emailing|отпис|не пишите/i.test(
      reply?.snippet || "",
    ),
    reply,
    last,
  };
}

async function stopForReply(
  sequence: Sequence,
  unsubscribe: boolean,
  reply?: GmailMessage,
) {
  const db = bindings().DB!;
  const now = new Date().toISOString();
  const statements = [
    db
      .prepare(
        `UPDATE outreach_sequences SET status='stopped_reply', next_run_at=NULL,
         stopped_reason=?, send_started_at=NULL, send_uncertain=0,
         updated_at=? WHERE id=?`,
      )
      .bind(unsubscribe ? "unsubscribe_reply" : "reply_received", now, sequence.id),
    db
      .prepare(
        `INSERT INTO outreach_events
         (id, workspace_id, sequence_id, lead_id, step_number, event_type,
          gmail_message_id, gmail_thread_id, error, metadata, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        sequence.workspaceId,
        sequence.id,
        sequence.leadId,
        sequence.nextStep,
        unsubscribe ? "unsubscribed" : "replied",
        reply?.id || "",
        reply?.threadId || "",
        JSON.stringify({ snippet: reply?.snippet || "" }),
        now,
      ),
    db
      .prepare(
        `UPDATE prospects SET stage='replied', replied_at=COALESCE(replied_at, ?),
         updated_at=? WHERE id=? AND workspace_id=?`,
      )
      .bind(now, now, sequence.leadId, sequence.workspaceId),
  ];
  if (unsubscribe) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO suppression_list
           (workspace_id, email, reason, created_at) VALUES (?, ?, 'reply_unsubscribe', ?)`,
        )
        .bind(sequence.workspaceId, sequence.recipientEmail.toLowerCase(), now),
    );
  }
  await db.batch(statements);
}

async function sendStep(
  sequence: Sequence,
  step: Step,
  token: string,
  stableMessageId: string,
  last?: { gmailMessageId?: string; gmailThreadId?: string },
) {
  const recipient = String(sequence.recipientEmail || "").trim();
  if (!isValidEmail(recipient)) throw new Error("invalid_recipient_email");
  let messageIdHeader = "";
  if (last?.gmailMessageId) {
    const prior = (await gmailGet(
      token,
      `messages/${encodeURIComponent(last.gmailMessageId)}?format=metadata&metadataHeaders=Message-ID`,
    )) as GmailMessage;
    messageIdHeader = sanitizeHeaderValue(header(prior, "Message-ID"));
  }
  const subject = encodeMimeSubject(
    personalize(String(step.subject || ""), sequence),
  );
  const optOut =
    "\n\n—\nIf this is not relevant, reply “unsubscribe” and no further messages will be sent.";
  const mime = [
    `To: ${recipient}`,
    `Subject: ${subject}`,
    `Message-ID: ${stableMessageId}`,
    ...(messageIdHeader
      ? [`In-Reply-To: ${messageIdHeader}`, `References: ${messageIdHeader}`]
      : []),
    "Content-Type: text/plain; charset=UTF-8",
    "",
    `${personalize(String(step.body || ""), sequence)}${optOut}`,
  ].join("\r\n");
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: base64Url(mime),
        ...(last?.gmailThreadId ? { threadId: last.gmailThreadId } : {}),
      }),
    },
  );
  if (!response.ok) throw await gmailResponseError(response, "send");
  sequence.gmailAccepted = true;
  return response.json() as Promise<{ id?: string; threadId?: string }>;
}

async function finishSequenceStep(
  sequence: Sequence,
  steps: Step[],
  sent: { id?: string; threadId?: string },
  options: { reconciled?: boolean; occurredAt?: string } = {},
) {
  const db = bindings().DB!;
  const now = options.occurredAt || new Date().toISOString();
  const nextStep = sequence.nextStep + 1;
  const complete = nextStep >= steps.length;
  const nextRun = complete
    ? null
    : new Date(
        Date.now() +
          Math.max(1, Number(steps[nextStep]?.delayDays) || 3) * 86_400_000,
      ).toISOString();
  const results = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO outreach_events
         (id, workspace_id, sequence_id, lead_id, step_number, event_type,
          gmail_message_id, gmail_thread_id, error, metadata, occurred_at)
         SELECT ?, ?, ?, ?, ?, 'sent', ?, ?, '', ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM outreach_events
           WHERE sequence_id=? AND step_number=? AND event_type='sent'
         )`,
      )
      .bind(
        `sent:${sequence.id}:${sequence.nextStep}`,
        sequence.workspaceId,
        sequence.id,
        sequence.leadId,
        sequence.nextStep,
        sent.id || "",
        sent.threadId || "",
        JSON.stringify({ reconciled: Boolean(options.reconciled) }),
        now,
        sequence.id,
        sequence.nextStep,
      ),
    db
      .prepare(
        `UPDATE outreach_sequences SET
         status=CASE WHEN status='active' THEN ? ELSE status END,
         next_step=?,
         next_run_at=CASE WHEN status='active' THEN ? ELSE NULL END,
         last_sent_at=?,
         stopped_reason=CASE WHEN status='active' THEN '' ELSE stopped_reason END,
         send_started_at=NULL, send_uncertain=0, updated_at=?
         WHERE id=? AND next_step=? AND send_started_at=?`,
      )
      .bind(
        complete ? "completed" : "active",
        nextStep,
        nextRun,
        now,
        now,
        sequence.id,
        sequence.nextStep,
        sequence.sendStartedAt,
      ),
    db
      .prepare(
        `UPDATE prospects SET stage='contacted',
         contacted_at=COALESCE(contacted_at, ?), updated_at=?
         WHERE id=? AND workspace_id=?`,
      )
      .bind(now, now, sequence.leadId, sequence.workspaceId),
  ]);
  return {
    sent: true,
    step: nextStep,
    complete,
    reconciled: Boolean(options.reconciled),
    recorded: Number(results[1]?.meta?.changes || 0) === 1,
  };
}

async function releaseUnusedSequenceClaim(sequence: Sequence) {
  await bindings()
    .DB!.prepare(
      `UPDATE outreach_sequences SET send_started_at=NULL
       WHERE id=? AND next_step=? AND send_started_at=? AND send_uncertain=0`,
    )
    .bind(sequence.id, sequence.nextStep, sequence.sendStartedAt)
    .run();
}

async function processSequence(sequence: Sequence) {
  const db = bindings().DB!;
  const lead = await db
    .prepare(
      `SELECT email, status, outreach_eligible as outreachEligible,
       telegram, linkedin, contact_status as contactStatus,
       contact_evidence as contactEvidence,
       opportunity_type as opportunityType, action_type as actionType
       FROM prospects WHERE id=? AND workspace_id=?`,
    )
    .bind(sequence.leadId, sequence.workspaceId)
    .first<Record<string, unknown>>();
  const eligibility = validateOutreachRecipient(lead, { gate: "approval" });
  if (!eligibility.ok) throw new Error(eligibility.error);
  if (eligibility.email !== sequence.recipientEmail.toLowerCase()) {
    throw new Error("verified_email_required");
  }
  if (await isRecipientSuppressed(db, sequence.workspaceId, eligibility.email)) {
    await db
      .prepare(
        `UPDATE outreach_sequences SET status='cancelled', next_run_at=NULL,
         stopped_reason='suppressed', send_started_at=NULL, send_uncertain=0,
         updated_at=? WHERE id=?`,
      )
      .bind(new Date().toISOString(), sequence.id)
      .run();
    return { stopped: "suppressed" };
  }
  const steps = JSON.parse(sequence.steps || "[]") as Step[];
  const step = steps[sequence.nextStep];
  if (!step) {
    await db
      .prepare(
        `UPDATE outreach_sequences SET status='completed', next_run_at=NULL,
         send_started_at=NULL, send_uncertain=0, updated_at=?
         WHERE id=? AND next_step=? AND send_started_at=?`,
      )
      .bind(
        new Date().toISOString(),
        sequence.id,
        sequence.nextStep,
        sequence.sendStartedAt,
      )
      .run();
    return { stopped: "complete" };
  }
  const priorStep = await sentEventForStep(sequence.id, sequence.nextStep);
  if (priorStep) {
    return finishSequenceStep(
      sequence,
      steps,
      { id: priorStep.gmailMessageId, threadId: priorStep.gmailThreadId },
      { reconciled: true, occurredAt: priorStep.occurredAt },
    );
  }
  const credentials = await gmailCredentials(sequence.workspaceId);
  const stableMessageId = await stableGmailMessageId(
    sequence.workspaceId,
    `sequence:${sequence.id}:step:${sequence.nextStep}`,
  );
  if (sequence.sendUncertain) {
    sequence.preserveUncertainty = true;
    const existing = await findSentByMessageId(credentials.token, stableMessageId);
    const sentMessage = existing.messages?.[0];
    if (sentMessage) {
      return finishSequenceStep(sequence, steps, sentMessage, {
        reconciled: true,
      });
    }
    const cleared = await db
      .prepare(
        `UPDATE outreach_sequences SET send_uncertain=0
         WHERE id=? AND next_step=? AND send_started_at=? AND status='active'`,
      )
      .bind(sequence.id, sequence.nextStep, sequence.sendStartedAt)
      .run();
    if (Number(cleared.meta.changes || 0) !== 1) {
      return { stopped: "claim_lost" };
    }
    sequence.preserveUncertainty = false;
    sequence.sendUncertain = 0;
  }
  const state = await replyState(
    sequence,
    credentials.token,
    credentials.accountEmail,
  );
  if (state.replied) {
    await stopForReply(sequence, Boolean(state.unsubscribe), state.reply);
    return { stopped: "reply" };
  }
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const sentToday = await db
    .prepare(
      `SELECT COUNT(*) as count FROM outreach_events
       WHERE workspace_id=? AND event_type='sent' AND occurred_at>=?`,
    )
    .bind(sequence.workspaceId, dayStart.toISOString())
    .first<{ count?: number }>();
  if (Number(sentToday?.count || 0) >= sequence.dailyLimit) {
    const tomorrow = new Date(dayStart);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    await db
      .prepare(
        `UPDATE outreach_sequences SET next_run_at=?, send_started_at=NULL,
         send_uncertain=0, updated_at=?
         WHERE id=? AND next_step=? AND send_started_at=?`,
      )
      .bind(
        tomorrow.toISOString(),
        new Date().toISOString(),
        sequence.id,
        sequence.nextStep,
        sequence.sendStartedAt,
      )
      .run();
    return { delayed: "daily_limit" };
  }
  const sendReady = await db
    .prepare(
      `UPDATE outreach_sequences SET send_uncertain=1
       WHERE id=? AND status='active' AND next_step=? AND send_started_at=?`,
    )
    .bind(sequence.id, sequence.nextStep, sequence.sendStartedAt)
    .run();
  if (Number(sendReady.meta.changes || 0) !== 1) {
    await releaseUnusedSequenceClaim(sequence);
    return { stopped: "claim_lost" };
  }
  sequence.sendRequested = true;
  const sent = await sendStep(
    sequence,
    step,
    credentials.token,
    stableMessageId,
    state.last || undefined,
  );
  return finishSequenceStep(sequence, steps, sent);
}

export async function POST(request: Request) {
  const db = bindings().DB;
  if (!db) return Response.json({ error: "database_unavailable" }, { status: 503 });
  const authorization = request.headers.get("authorization") || "";
  const isCron =
    Boolean(bindings().AGENT_CRON_SECRET) &&
    (await timingSafeEqualStrings(
      authorization,
      `Bearer ${bindings().AGENT_CRON_SECRET}`,
    ));
  let workspaceId = "";
  if (!isCron) {
    const auth = await requireApiSession(request);
    if (isAuthResponse(auth)) return auth;
    workspaceId = auth.workspaceId;
  }
  const attemptStartedAt = new Date().toISOString();
  const staleBefore = new Date(
    Date.now() - SEND_ATTEMPT_TIMEOUT_MS,
  ).toISOString();
  const sequence = await db
    .prepare(
      `SELECT id, workspace_id as workspaceId, lead_id as leadId,
       recipient_email as recipientEmail, recipient_name as recipientName,
       company, steps, next_step as nextStep, daily_limit as dailyLimit,
       send_started_at as sendStartedAt, send_uncertain as sendUncertain
       FROM outreach_sequences
       WHERE status='active' AND next_run_at<=?
       AND (?='' OR workspace_id=?)
       AND (send_started_at IS NULL OR send_started_at<=?)
       ORDER BY next_run_at ASC LIMIT 1`,
    )
    .bind(attemptStartedAt, workspaceId, workspaceId, staleBefore)
    .first<Sequence>();
  if (!sequence) return Response.json({ ok: true, due: false });
  const claim = await db
    .prepare(
      `UPDATE outreach_sequences SET send_started_at=?
       WHERE id=? AND status='active' AND next_step=? AND next_run_at<=?
       AND (send_started_at IS NULL OR send_started_at<=?)`,
    )
    .bind(
      attemptStartedAt,
      sequence.id,
      sequence.nextStep,
      attemptStartedAt,
      staleBefore,
    )
    .run();
  if (Number(claim.meta.changes || 0) !== 1) {
    return Response.json({ ok: true, due: false, claimed: false });
  }
  sequence.sendStartedAt = attemptStartedAt;
  sequence.preserveUncertainty = Boolean(sequence.sendUncertain);
  try {
    return Response.json({ ok: true, due: true, ...(await processSequence(sequence)) });
  } catch (error) {
    const directReason = error instanceof Error ? error.message : "";
    const failure = directReason.startsWith("gmail_") || error instanceof GmailProviderError
      ? gmailFailure(error)
      : { code: directReason || "outreach_failed", statusCode: 0 };
    const uncertain =
      Boolean(sequence.preserveUncertainty) ||
      Boolean(sequence.gmailAccepted) ||
      (Boolean(sequence.sendRequested) &&
        isAmbiguousGmailFailure(failure.code, failure.statusCode));
    const publicError = uncertain
      ? "gmail_delivery_unconfirmed"
      : failure.code;
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO outreach_events
           (id, workspace_id, sequence_id, lead_id, step_number, event_type,
            gmail_message_id, gmail_thread_id, error, metadata, occurred_at)
           VALUES (?, ?, ?, ?, ?, 'failed', '', '', ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          sequence.workspaceId,
          sequence.id,
          sequence.leadId,
          sequence.nextStep,
          publicError,
          JSON.stringify({
            provider: failure.code.startsWith("gmail_") ? "gmail" : "",
            diagnostic: failure.code,
            statusCode: failure.statusCode,
            uncertain,
          }),
          now,
        ),
      db
        .prepare(
          `UPDATE outreach_sequences SET
           status=CASE WHEN status='active' THEN 'paused' ELSE status END,
           next_run_at=CASE WHEN status='active' THEN NULL ELSE next_run_at END,
           stopped_reason=CASE WHEN status IN ('active','paused')
             THEN ? ELSE stopped_reason END,
           send_started_at=CASE WHEN ?=1 THEN send_started_at ELSE NULL END,
           send_uncertain=?, updated_at=?
           WHERE id=? AND next_step=? AND send_started_at=?`,
        )
        .bind(
          publicError,
          uncertain ? 1 : 0,
          uncertain ? 1 : 0,
          now,
          sequence.id,
          sequence.nextStep,
          sequence.sendStartedAt,
        ),
    ]);
    return Response.json(
      {
        error: publicError,
        diagnostic: failure.code,
        statusCode: failure.statusCode,
      },
      {
        status: uncertain
          ? 409
          : failure.code.startsWith("gmail_")
            ? gmailFailureHttpStatus(failure.code)
            : 502,
      },
    );
  }
}
