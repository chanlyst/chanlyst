import { env } from "cloudflare:workers";
import {
  isRecipientSuppressed,
  validateOutreachRecipient,
} from "./outreach-recipient.mjs";

// Draft creation for the native e-mail sequence engine, extracted out of
// app/api/outreach-sequences/route.ts so the composer and the pipeline write
// identical rows.
//
// A sequence created here is ALWAYS a draft: status 'draft', next_step 0 and
// next_run_at NULL. The outreach engine only ever picks up rows with
// status='active', so nothing created by this function can send anything until
// the user presses «Запустить».

export type SequenceStepInput = {
  subject?: string;
  body?: string;
  delayDays?: number;
};

type SequenceDraftError =
  | "invalid_sequence"
  | "lead_not_found"
  | "lead_approval_required"
  | "verified_email_required"
  | "recipient_suppressed"
  | "lead_not_qualified";

export type SequenceDraftOutcome =
  | { ok: true; id: string; status: "draft" }
  | {
      ok: false;
      error: SequenceDraftError;
      status: 400 | 404 | 409;
    };

type LeadRow = {
  company?: string;
  email?: string;
  contact?: string;
  status?: string;
  outreachEligible?: number;
  // Read so a `network` / `none` lead can never receive a sequence, whichever
  // gate the caller used.
  telegram?: string;
  linkedin?: string;
  contactStatus?: string;
  contactEvidence?: string;
  opportunityType?: string;
  actionType?: string;
};

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

export function normalizeSteps(steps: SequenceStepInput[]) {
  return steps.slice(0, 5).map((step, index) => ({
    subject: String(step.subject || "").slice(0, 300),
    body: String(step.body || "").trim().slice(0, 10_000),
    delayDays:
      index === 0
        ? 0
        : Math.max(1, Math.min(30, Math.round(Number(step.delayDays) || 3))),
  }));
}

/**
 * Creates one draft sequence.
 *
 * `gate` decides who is allowed a draft:
 *  - "approval" — the interactive path: the user must have approved the lead
 *    (unchanged behaviour of POST /api/outreach-sequences);
 *  - "qualified" — the pipeline path: the lead must be outreach-eligible and
 *    not rejected. The e-mail requirement below is the same for both, so the
 *    pipeline can never draft to an address the user has not seen verified.
 */
export async function createSequenceDraft({
  workspaceId,
  productId,
  leadId,
  name,
  steps: rawSteps,
  gate = "approval",
}: {
  workspaceId: string;
  productId?: string;
  leadId?: string;
  name?: string;
  steps?: SequenceStepInput[];
  gate?: "approval" | "qualified";
}): Promise<SequenceDraftOutcome> {
  const db = database()!;
  const steps = normalizeSteps(Array.isArray(rawSteps) ? rawSteps : []);
  if (!productId || !leadId || !steps.length || steps.some((step) => !step.body)) {
    return { ok: false, error: "invalid_sequence", status: 400 };
  }
  const lead = await db
    .prepare(
      `SELECT company, email, contact, status,
       outreach_eligible as outreachEligible, telegram, linkedin,
       contact_status as contactStatus, contact_evidence as contactEvidence,
       opportunity_type as opportunityType, action_type as actionType
       FROM prospects
       WHERE id=? AND product_id=? AND workspace_id=?`,
    )
    .bind(leadId, productId, workspaceId)
    .first<LeadRow>();
  if (!lead) return { ok: false, error: "lead_not_found", status: 404 };
  const recipient = validateOutreachRecipient(lead, { gate });
  if (!recipient.ok) {
    return {
      ok: false,
      error: recipient.error as SequenceDraftError,
      status: recipient.error === "lead_not_found" ? 404 : 409,
    };
  }
  const email = recipient.email;
  if (await isRecipientSuppressed(db, workspaceId, email)) {
    return { ok: false, error: "recipient_suppressed", status: 409 };
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO outreach_sequences
       (id, workspace_id, product_id, lead_id, name, recipient_email,
        recipient_name, company, steps, status, next_step, next_run_at,
        daily_limit, last_sent_at, stopped_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, NULL, 20, NULL, '', ?, ?)`,
    )
    .bind(
      id,
      workspaceId,
      productId,
      leadId,
      String(name || `Outreach · ${lead.company || email}`).slice(0, 200),
      email,
      lead.contact || "",
      lead.company || "",
      JSON.stringify(steps),
      now,
      now,
    )
    .run();
  return { ok: true, id, status: "draft" };
}
