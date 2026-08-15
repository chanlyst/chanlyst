import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../../lib/auth";
import {
  prospectContextQuery,
  runEnrichment,
  type ProspectContext,
} from "../../../lib/enrichment-core";
import { enforceUsageLimit } from "../../../lib/usage-limits";

// The enrichment work itself lives in app/lib/enrichment-core.ts so the
// pipeline runner reuses it verbatim. This route keeps the session, the plan
// quota and the response shape.

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const quota = await enforceUsageLimit(auth.workspaceId, "contactChecks");
  if (!quota.allowed) return quota.response!;
  const payload = (await request.json().catch(() => ({}))) as { leadId?: string };
  const db = database();
  if (!db || !payload.leadId) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const prospect = await db
    .prepare(prospectContextQuery)
    .bind(payload.leadId, auth.workspaceId, auth.workspaceId)
    .first<ProspectContext>();
  if (!prospect) {
    return Response.json({ error: "prospect_not_found" }, { status: 404 });
  }

  const outcome = await runEnrichment(prospect, {
    workspaceId: auth.workspaceId,
  });
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: outcome.status });
  }
  return Response.json({
    contact: outcome.contact,
    role: outcome.role,
    email: outcome.email,
    telegram: outcome.telegram,
    linkedin: outcome.linkedin,
    contactStatus: outcome.contactStatus,
    contactSourceUrl: outcome.contactSourceUrl,
    contactEvidence: outcome.contactEvidence,
    nextAction: outcome.nextAction,
    contactConfidence: outcome.contactConfidence,
    contactCheckedAt: outcome.contactCheckedAt,
    // Present only when the provider answered but the answer was unusable:
    // the card must not present that as "no public contact found".
    modelError: outcome.modelError,
  });
}
