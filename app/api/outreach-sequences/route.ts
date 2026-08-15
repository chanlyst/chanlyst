import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../lib/auth";
import {
  createSequenceDraft,
  normalizeSteps,
  type SequenceStepInput as Step,
} from "../../lib/sequence-core";
import {
  isRecipientSuppressed,
  validateOutreachRecipient,
} from "../../lib/outreach-recipient.mjs";
import {
  SEND_ATTEMPT_TIMEOUT_MS,
  sequenceSendAttemptDecision,
} from "../../lib/gmail-send-state.mjs";

type SequenceActivationRow = {
  status?: string;
  nextStep?: number;
  recipientEmail?: string;
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

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  if (!db) return Response.json({ sequences: [], persisted: false });
  const recentAfter = new Date(
    Date.now() - SEND_ATTEMPT_TIMEOUT_MS,
  ).toISOString();
  const result = await db
    .prepare(
      `SELECT id, product_id as productId, lead_id as leadId, name,
       recipient_email as recipientEmail, recipient_name as recipientName,
       company, steps, status, next_step as nextStep,
       next_run_at as nextRunAt, daily_limit as dailyLimit,
       last_sent_at as lastSentAt, stopped_reason as stoppedReason,
       send_started_at as sendStartedAt, send_uncertain as sendUncertain,
       CASE WHEN status='active' AND send_started_at>?
         THEN 1 ELSE 0 END as sendInProgress,
       created_at as createdAt, updated_at as updatedAt
       FROM outreach_sequences WHERE workspace_id=?
       ORDER BY updated_at DESC LIMIT 100`,
    )
    .bind(recentAfter, auth.workspaceId)
    .all<Record<string, unknown>>();
  return Response.json({
    persisted: true,
    sequences: result.results.map((item: Record<string, unknown>) => ({
      ...item,
      steps: JSON.parse(String(item.steps || "[]")),
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  if (!db) return Response.json({ error: "database_unavailable" }, { status: 503 });
  const payload = (await request.json()) as {
    productId?: string;
    leadId?: string;
    name?: string;
    steps?: Step[];
  };
  const outcome = await createSequenceDraft({
    workspaceId: auth.workspaceId,
    productId: payload.productId,
    leadId: payload.leadId,
    name: payload.name,
    steps: payload.steps,
    gate: "approval",
  });
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: outcome.status });
  }
  return Response.json({ created: true, id: outcome.id, status: "draft" });
}

export async function PATCH(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  const payload = (await request.json()) as {
    id?: string;
    action?: "activate" | "pause" | "resume" | "cancel";
    steps?: Step[];
  };
  if (!db || !payload.id || !payload.action) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const sequence = await db
    .prepare(
      `SELECT s.status, s.next_step as nextStep,
       s.recipient_email as recipientEmail, p.email,
       p.status as leadStatus, p.outreach_eligible as outreachEligible,
       p.telegram, p.linkedin, p.contact_status as contactStatus,
       p.contact_evidence as contactEvidence,
       p.opportunity_type as opportunityType, p.action_type as actionType,
       s.send_started_at as sendStartedAt,
       s.send_uncertain as sendUncertain
       FROM outreach_sequences s
       JOIN prospects p ON p.id=s.lead_id AND p.product_id=s.product_id
       WHERE s.id=? AND s.workspace_id=? AND p.workspace_id=?`,
    )
    .bind(payload.id, auth.workspaceId, auth.workspaceId)
    .first<SequenceActivationRow>();
  if (!sequence) return Response.json({ error: "not_found" }, { status: 404 });
  if (payload.action === "resume") {
    const attempt = sequenceSendAttemptDecision(sequence);
    if (attempt.action === "in_progress") {
      return Response.json({ error: "send_in_progress" }, { status: 409 });
    }
    if (attempt.action === "unconfirmed") {
      return Response.json(
        { error: "gmail_delivery_unconfirmed" },
        { status: 409 },
      );
    }
  }
  if (payload.action === "activate" || payload.action === "resume") {
    const eligibility = validateOutreachRecipient(
      { ...sequence, status: sequence.leadStatus },
      { gate: "approval" },
    );
    if (!eligibility.ok) {
      return Response.json({ error: eligibility.error }, { status: 409 });
    }
    if (eligibility.email !== String(sequence.recipientEmail || "").toLowerCase()) {
      return Response.json({ error: "verified_email_required" }, { status: 409 });
    }
    if (await isRecipientSuppressed(db, auth.workspaceId, eligibility.email)) {
      return Response.json({ error: "recipient_suppressed" }, { status: 409 });
    }
    const gmail = await db
      .prepare(
        `SELECT provider FROM workspace_integrations
         WHERE workspace_id=? AND provider='gmail' AND status='connected'`,
      )
      .bind(auth.workspaceId)
      .first();
    if (!gmail) {
      return Response.json({ error: "gmail_not_connected" }, { status: 409 });
    }
  }
  const now = new Date().toISOString();
  const nextStatus =
    payload.action === "cancel"
      ? "cancelled"
      : payload.action === "pause"
        ? "paused"
        : "active";
  const steps = payload.steps ? normalizeSteps(payload.steps) : null;
  await db
    .prepare(
      `UPDATE outreach_sequences SET status=?,
       next_run_at=CASE WHEN ?='active' THEN ? ELSE NULL END,
       stopped_reason=CASE WHEN ?='cancelled' THEN 'cancelled_by_user' ELSE '' END,
       steps=COALESCE(?, steps), updated_at=?
       WHERE id=? AND workspace_id=?`,
    )
    .bind(
      nextStatus,
      nextStatus,
      now,
      nextStatus,
      steps ? JSON.stringify(steps) : null,
      now,
      payload.id,
      auth.workspaceId,
    )
    .run();
  return Response.json({ updated: true, status: nextStatus });
}
