import { env } from "cloudflare:workers";
import {
  decryptSecret,
  encryptSecret,
  getIntegrationCredentials,
} from "../../../lib/secret";
import { isAuthResponse, requireApiSession } from "../../../lib/auth";
import { timingSafeEqualStrings } from "../../../lib/security-helpers.mjs";
import {
  gmailFailure,
  gmailFailureHttpStatus,
  gmailResponseError,
} from "../../../lib/gmail-failure.mjs";

// How many Gmail threads a single run inspects per workspace.
const threadBatchLimit = 25;
// Ignore one-off messages older than this window.
const lookbackDays = 30;
// Funnel stages that a detected reply may upgrade to "replied". Later stages
// (meeting, won) and closed leads (lost) are never downgraded.
const upgradableStages = ["discovered", "queued", "contacted"];

type GmailMessage = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  payload?: { headers?: Array<{ name?: string; value?: string }> };
};

type ThreadCandidate = {
  threadId: string;
  // ISO timestamp of our last outgoing message in this thread.
  lastSentAt: string;
  leadId: string;
  recipientEmail: string;
  sequence?: { id: string; nextStep: number };
  outboundMessageId?: string;
};

type WorkspaceResult = {
  workspaceId: string;
  checked: number;
  replies: number;
  errors: number;
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

async function refreshGmailToken(
  workspaceId: string,
  record: Record<string, unknown>,
) {
  const db = bindings().DB!;
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
  return tokens.access_token;
}

async function gmailCredentials(workspaceId: string, forceRefresh = false) {
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
  const accountEmail = String(record.accountLabel || "");
  const expiresAt = Date.parse(String(record.expiresAt || ""));
  if (!forceRefresh && expiresAt > Date.now() + 60_000) {
    return {
      token: await decryptSecret(String(record.accessToken || "")),
      accountEmail,
    };
  }
  return {
    token: await refreshGmailToken(workspaceId, record),
    accountEmail,
  };
}

async function fetchThread(token: string, threadId: string) {
  return fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

// A reply exists when the thread contains a message that is newer than our
// last outgoing message and whose From header is not the connected account.
// When the connected account label is unknown, fall back to matching the
// recipient address so an arbitrary automated message does not count.
function findReply(
  messages: GmailMessage[],
  candidate: ThreadCandidate,
  accountEmail: string,
) {
  const after = Date.parse(candidate.lastSentAt || "");
  if (!Number.isFinite(after)) return undefined;
  const account = accountEmail.trim().toLowerCase();
  const recipient = candidate.recipientEmail.trim().toLowerCase();
  return messages.find((message) => {
    if (Number(message.internalDate || 0) <= after) return false;
    const from = header(message, "From").toLowerCase();
    if (account) return !from.includes(account);
    return Boolean(recipient) && from.includes(recipient);
  });
}

async function sequenceCandidates(workspaceId: string, limit: number) {
  const db = bindings().DB!;
  const rows = await db
    .prepare(
      `SELECT s.id, s.lead_id as leadId, s.recipient_email as recipientEmail,
       s.next_step as nextStep,
       (SELECT e.gmail_thread_id FROM outreach_events e
        WHERE e.sequence_id=s.id AND e.event_type='sent'
        ORDER BY e.occurred_at DESC LIMIT 1) as threadId,
       (SELECT e.occurred_at FROM outreach_events e
        WHERE e.sequence_id=s.id AND e.event_type='sent'
        ORDER BY e.occurred_at DESC LIMIT 1) as lastSentAt
       FROM outreach_sequences s
       WHERE s.workspace_id=? AND s.status='active'
       ORDER BY s.last_sent_at DESC LIMIT ?`,
    )
    .bind(workspaceId, limit)
    .all<{
      id: string;
      leadId: string;
      recipientEmail: string;
      nextStep: number;
      threadId?: string;
      lastSentAt?: string;
    }>();
  const candidates: ThreadCandidate[] = [];
  for (const row of rows.results) {
    if (!row.threadId || !row.lastSentAt) continue;
    candidates.push({
      threadId: row.threadId,
      lastSentAt: row.lastSentAt,
      leadId: row.leadId,
      recipientEmail: row.recipientEmail || "",
      sequence: { id: row.id, nextStep: Number(row.nextStep || 0) },
    });
  }
  return candidates;
}

async function outboundCandidates(workspaceId: string, limit: number) {
  if (limit <= 0) return [];
  const db = bindings().DB!;
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const rows = await db
    .prepare(
      `SELECT m.id, m.lead_id as leadId, m.gmail_thread_id as threadId,
       m.sent_at as sentAt, p.email as recipientEmail
       FROM outbound_messages m
       LEFT JOIN prospects p ON p.id=m.lead_id AND p.workspace_id=m.workspace_id
       WHERE m.workspace_id=? AND m.status='sent' AND m.gmail_thread_id!=''
       AND m.replied_at IS NULL AND m.sent_at>=?
       ORDER BY m.sent_at DESC LIMIT ?`,
    )
    .bind(workspaceId, since, limit)
    .all<{
      id: string;
      leadId: string;
      threadId: string;
      sentAt?: string;
      recipientEmail?: string;
    }>();
  return rows.results.map<ThreadCandidate>((row) => ({
    threadId: row.threadId,
    lastSentAt: row.sentAt || "",
    leadId: row.leadId,
    recipientEmail: row.recipientEmail || "",
    outboundMessageId: row.id,
  }));
}

async function recordReply(
  workspaceId: string,
  candidate: ThreadCandidate,
  reply: GmailMessage,
) {
  const db = bindings().DB!;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (candidate.sequence) {
    statements.push(
      db
        .prepare(
          `UPDATE outreach_sequences SET status='stopped_reply', next_run_at=NULL,
           stopped_reason='reply_received', replied_at=?, updated_at=?
           WHERE id=? AND workspace_id=?`,
        )
        .bind(now, now, candidate.sequence.id, workspaceId),
      db
        .prepare(
          `INSERT INTO outreach_events
           (id, workspace_id, sequence_id, lead_id, step_number, event_type,
            gmail_message_id, gmail_thread_id, error, metadata, occurred_at)
           VALUES (?, ?, ?, ?, ?, 'reply_detected', ?, ?, '', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          workspaceId,
          candidate.sequence.id,
          candidate.leadId,
          candidate.sequence.nextStep,
          reply.id || "",
          candidate.threadId,
          JSON.stringify({ threadId: candidate.threadId }),
          now,
        ),
    );
  }
  if (candidate.outboundMessageId) {
    statements.push(
      db
        .prepare(
          `UPDATE outbound_messages SET replied_at=?
           WHERE id=? AND workspace_id=? AND replied_at IS NULL`,
        )
        .bind(now, candidate.outboundMessageId, workspaceId),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE prospects SET replied_at=COALESCE(replied_at, ?),
         stage=CASE WHEN stage IN (${upgradableStages.map(() => "?").join(",")})
           THEN 'replied' ELSE stage END,
         updated_at=? WHERE id=? AND workspace_id=?`,
      )
      .bind(now, ...upgradableStages, now, candidate.leadId, workspaceId),
  );
  await db.batch(statements);
}

async function processWorkspace(workspaceId: string): Promise<WorkspaceResult> {
  const result: WorkspaceResult = {
    workspaceId,
    checked: 0,
    replies: 0,
    errors: 0,
  };
  let credentials = await gmailCredentials(workspaceId);
  const sequences = await sequenceCandidates(workspaceId, threadBatchLimit);
  const outbound = await outboundCandidates(
    workspaceId,
    threadBatchLimit - sequences.length,
  );
  const seen = new Set<string>();
  let refreshed = false;
  for (const candidate of [...sequences, ...outbound]) {
    if (seen.has(candidate.threadId)) continue;
    seen.add(candidate.threadId);
    try {
      let response = await fetchThread(credentials.token, candidate.threadId);
      if (response.status === 401 && !refreshed) {
        // The token was revoked or expired early: refresh once per run, then
        // retry this thread a single time.
        refreshed = true;
        credentials = await gmailCredentials(workspaceId, true);
        response = await fetchThread(credentials.token, candidate.threadId);
      }
      if (!response.ok) throw await gmailResponseError(response, "read");
      const thread = (await response.json()) as { messages?: GmailMessage[] };
      result.checked += 1;
      const reply = findReply(
        thread.messages || [],
        candidate,
        credentials.accountEmail,
      );
      if (!reply) continue;
      await recordReply(workspaceId, candidate, reply);
      result.replies += 1;
    } catch {
      // One broken thread must not abort the batch.
      result.errors += 1;
    }
  }
  return result;
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

  if (!isCron) {
    // Manual "check now" for the session workspace.
    const auth = await requireApiSession(request);
    if (isAuthResponse(auth)) return auth;
    try {
      const result = await processWorkspace(auth.workspaceId);
      return Response.json({ ok: true, results: [result] });
    } catch (error) {
      const failure = gmailFailure(error, "reply_check_failed");
      const status = failure.code.startsWith("gmail_")
        ? gmailFailureHttpStatus(failure.code)
        : 502;
      return Response.json(
        { error: failure.code, statusCode: failure.statusCode },
        { status },
      );
    }
  }

  const workspaces = await db
    .prepare(
      `SELECT workspace_id as workspaceId FROM workspace_integrations
       WHERE provider='gmail' AND status='connected'
       ORDER BY workspace_id LIMIT 50`,
    )
    .all<{ workspaceId: string }>();
  const results: Array<WorkspaceResult | { workspaceId: string; error: string }> =
    [];
  for (const row of workspaces.results) {
    try {
      results.push(await processWorkspace(row.workspaceId));
    } catch (error) {
      const failure = gmailFailure(error, "reply_check_failed");
      results.push({
        workspaceId: row.workspaceId,
        error: failure.code,
      });
    }
  }
  return Response.json({ ok: true, workspaces: workspaces.results.length, results });
}
