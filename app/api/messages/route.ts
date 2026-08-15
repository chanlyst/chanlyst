import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../lib/auth";
import {
  isRecipientSuppressed,
  validateOutreachRecipient,
} from "../../lib/outreach-recipient.mjs";
import { SEND_ATTEMPT_TIMEOUT_MS } from "../../lib/gmail-send-state.mjs";

type MessagePayload = {
  id?: string;
  productId?: string;
  leadId?: string;
  company?: string;
  channel?: string;
  subject?: string;
  body?: string;
  templateId?: string;
};

type MessageLead = {
  company?: string;
  email?: string;
  status?: string;
  stage?: string;
  outreachEligible?: number;
  telegram?: string;
  linkedin?: string;
  contactStatus?: string;
  contactEvidence?: string;
  opportunityType?: string;
  actionType?: string;
};

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) return Response.json({ messages: [], persisted: false });
  const staleBefore = new Date(Date.now() - SEND_ATTEMPT_TIMEOUT_MS).toISOString();

  const result = await db
    .prepare(
      `SELECT id, lead_id as leadId, company, channel, subject, body,
       CASE WHEN status='sending' AND (send_started_at IS NULL OR send_started_at<=?)
         THEN 'failed' ELSE status END as status,
       created_at as createdAt
       , product_id as productId, template_id as templateId, sent_at as sentAt, error,
       error_status_code as errorStatusCode, send_started_at as sendStartedAt,
       CASE WHEN status='sending' AND (send_started_at IS NULL OR send_started_at<=?)
         THEN 1 ELSE send_uncertain END as sendUncertain
       FROM outbound_messages WHERE workspace_id=?
       ORDER BY created_at DESC
       LIMIT 100`,
    )
    .bind(staleBefore, staleBefore, auth.workspaceId)
    .all();

  return Response.json({ messages: result.results, persisted: true });
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const payload = (await request.json()) as MessagePayload;
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) {
    return Response.json(
      { persisted: false, error: "database_unavailable" },
      { status: 503 },
    );
  }

  const channel = String(payload.channel || "email");
  if (
    !payload.productId ||
    !payload.leadId ||
    !["email", "telegram", "linkedin"].includes(channel)
  ) {
    return Response.json({ persisted: false, error: "invalid_request" }, { status: 400 });
  }

  const lead = await db
    .prepare(
      `SELECT p.company, p.email, p.status, p.stage,
       p.outreach_eligible as outreachEligible, p.telegram, p.linkedin,
       p.contact_status as contactStatus, p.contact_evidence as contactEvidence,
       p.opportunity_type as opportunityType, p.action_type as actionType
       FROM prospects p
       JOIN products pr ON pr.id=p.product_id AND pr.workspace_id=p.workspace_id
       WHERE p.id=? AND p.product_id=? AND p.workspace_id=?`,
    )
    .bind(payload.leadId, payload.productId, auth.workspaceId)
    .first<MessageLead>();
  if (!lead) {
    return Response.json({ persisted: false, error: "lead_not_found" }, { status: 404 });
  }

  if (channel === "email") {
    const recipient = validateOutreachRecipient(lead, { gate: "approval" });
    if (!recipient.ok) {
      return Response.json(
        { persisted: false, error: recipient.error },
        { status: 409 },
      );
    }
    if (await isRecipientSuppressed(db, auth.workspaceId, recipient.email)) {
      return Response.json(
        { persisted: false, error: "recipient_suppressed" },
        { status: 409 },
      );
    }
  }

  const id = payload.id || crypto.randomUUID();
  const now = new Date().toISOString();
  const nextStage = ["discovered", "queued"].includes(String(lead.stage || ""))
    ? "queued"
    : String(lead.stage || "discovered");
  try {
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO outbound_messages
           (id, product_id, lead_id, company, channel, subject, body,
            template_id, status, created_at, workspace_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
        )
        .bind(
          id,
          payload.productId,
          payload.leadId,
          lead.company || payload.company || "",
          channel,
          payload.subject || "",
          payload.body || "",
          payload.templateId || "",
          now,
          auth.workspaceId,
        ),
      db
        .prepare(
          `UPDATE prospects SET stage=?, updated_at=?
           WHERE id=? AND product_id=? AND workspace_id=?`,
        )
        .bind(nextStage, now, payload.leadId, payload.productId, auth.workspaceId),
    ]);
    if (
      Number(results[0]?.meta?.changes || 0) !== 1 ||
      Number(results[1]?.meta?.changes || 0) !== 1
    ) {
      throw new Error("message_persist_incomplete");
    }
  } catch (error) {
    console.error(
      "message_create_failed",
      error instanceof Error ? error.message : "unknown",
    );
    return Response.json(
      { persisted: false, error: "message_persist_failed" },
      { status: 500 },
    );
  }

  return Response.json({ persisted: true, id, stage: nextStage });
}

export async function DELETE(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) return Response.json({ persisted: false });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

  await db
    .prepare("DELETE FROM outbound_messages WHERE id = ? AND workspace_id=?")
    .bind(id, auth.workspaceId)
    .run();
  return Response.json({ persisted: true });
}
