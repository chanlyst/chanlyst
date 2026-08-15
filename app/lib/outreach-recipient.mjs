import { isReachableByOutreach } from "./contact-route.mjs";
import { isValidEmail } from "./security-helpers.mjs";

/**
 * The server-side eligibility rule shared by one-off sends and sequences.
 *
 * Keeping this rule outside the UI is intentional: a hidden button is useful
 * guidance, but it is not an authorization boundary. Every delivery path must
 * prove that the current lead row is still eligible immediately before it
 * hands an address to a provider.
 *
 * @param {Record<string, unknown>|null|undefined} lead
 * @param {{gate?: "approval"|"qualified"}} [options]
 * @returns {{ok: true, email: string}|{ok: false, error: string}}
 */
export function validateOutreachRecipient(lead, { gate = "approval" } = {}) {
  if (!lead) return { ok: false, error: "lead_not_found" };

  if (gate === "approval") {
    if (lead.status !== "approved") {
      return { ok: false, error: "lead_approval_required" };
    }
  } else if (lead.status === "rejected" || !Number(lead.outreachEligible)) {
    return { ok: false, error: "lead_not_qualified" };
  }

  if (!isReachableByOutreach(lead)) {
    return { ok: false, error: "lead_not_qualified" };
  }
  if (lead.contactStatus !== "verified_public") {
    return { ok: false, error: "verified_email_required" };
  }

  const email = String(lead.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return { ok: false, error: "verified_email_required" };
  }
  return { ok: true, email };
}

/**
 * Suppression is workspace-scoped and checked separately because it is live
 * mutable state rather than a property of the lead row.
 *
 * @param {D1Database} db
 * @param {string} workspaceId
 * @param {string} email
 */
export async function isRecipientSuppressed(db, workspaceId, email) {
  const row = await db
    .prepare("SELECT email FROM suppression_list WHERE workspace_id=? AND email=?")
    .bind(workspaceId, email)
    .first();
  return Boolean(row);
}
