import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../lib/auth";

// The "today" queue. Reading it never changes anything; the PATCH handler only
// records what the user decided to do with a task. Nothing here sends mail.

type TaskAction = "done" | "dismiss" | "snooze";

const taskActions: TaskAction[] = ["done", "dismiss", "snooze"];

// One screen of work. The dashboard shows five at a time and can expand.
const taskPageSize = 100;
const defaultSnoozeDays = 7;
const maxSnoozeDays = 90;

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

function parsePayload(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  if (!db) return Response.json({ tasks: [] });
  const productId = new URL(request.url).searchParams.get("productId") || "";
  // The lead is embedded whole so the dashboard can act on a task without
  // hunting for the lead's page in the paginated channel list. The join is
  // deliberate: it also drops tasks whose lead was deleted. Product-level
  // tasks (lead_id '') are reserved by the schema but no rule creates them
  // yet, so they are not surfaced here either.
  const result = await db
    .prepare(
      `SELECT t.id as id, t.type as type, t.due_at as dueAt,
       t.payload as payload, t.status as status, t.created_at as createdAt,
       t.product_id as productId, pr.name as productName,
       p.id as leadId, p.company, p.domain, p.url, p.description, p.source,
       p.channel_type as channelType, p.reason, p.contact, p.email, p.telegram,
       p.score, p.status as leadStatus, p.stage,
       p.contacted_at as contactedAt, p.replied_at as repliedAt,
       p.meeting_at as meetingAt, p.converted_at as convertedAt,
       p.revenue_cents as revenueCents, p.outcome_note as outcomeNote,
       p.opportunity_type as opportunityType, p.action_type as actionType,
       p.next_action as nextAction, p.action_url as actionUrl,
       p.engagement_mode as engagementMode,
       p.commercial_model as commercialModel,
       p.pricing_summary as pricingSummary,
       p.placement_requirements as placementRequirements,
       p.usage_terms as usageTerms, p.registration_url as registrationUrl,
       p.outreach_eligible as outreachEligible,
       p.placement_status as placementStatus,
       p.placement_submitted_at as placementSubmittedAt,
       p.placement_checked_at as placementCheckedAt,
       p.placement_url as placementUrl, p.utm_link as utmLink,
       p.contact_role as contactRole, p.linkedin,
       p.contact_status as contactStatus,
       p.contact_source_url as contactSourceUrl,
       p.contact_evidence as contactEvidence,
       p.contact_confidence as contactConfidence,
       p.contact_checked_at as contactCheckedAt,
       p.assigned_user_id as assignedUserId
       FROM lead_tasks t
       JOIN prospects p ON p.id=t.lead_id AND p.workspace_id=t.workspace_id
       LEFT JOIN products pr ON pr.id=t.product_id AND pr.workspace_id=t.workspace_id
       WHERE t.workspace_id=? AND t.status='open' AND (?='' OR t.product_id=?)
       ORDER BY t.due_at ASC, t.created_at ASC LIMIT ?`,
    )
    .bind(auth.workspaceId, productId, productId, taskPageSize)
    .all<Record<string, unknown>>();
  // The task columns and the lead columns are separated explicitly so the
  // embedded lead has exactly the shape the dashboard's Lead type expects.
  const leadColumns = [
    "company",
    "domain",
    "url",
    "description",
    "source",
    "channelType",
    "reason",
    "contact",
    "email",
    "telegram",
    "score",
    "stage",
    "contactedAt",
    "repliedAt",
    "meetingAt",
    "convertedAt",
    "revenueCents",
    "outcomeNote",
    "opportunityType",
    "actionType",
    "nextAction",
    "actionUrl",
    "engagementMode",
    "commercialModel",
    "pricingSummary",
    "placementRequirements",
    "usageTerms",
    "registrationUrl",
    "placementStatus",
    "placementSubmittedAt",
    "placementCheckedAt",
    "placementUrl",
    "utmLink",
    "contactRole",
    "linkedin",
    "contactStatus",
    "contactSourceUrl",
    "contactEvidence",
    "contactConfidence",
    "contactCheckedAt",
    "assignedUserId",
  ];
  const tasks = result.results.map((row) => {
    const lead: Record<string, unknown> = {
      id: String(row.leadId || ""),
      status: String(row.leadStatus || "review"),
      outreachEligible: Boolean(row.outreachEligible),
    };
    for (const column of leadColumns) lead[column] = row[column];
    return {
      id: String(row.id || ""),
      type: String(row.type || ""),
      dueAt: String(row.dueAt || ""),
      createdAt: String(row.createdAt || ""),
      productId: String(row.productId || ""),
      productName: String(row.productName || ""),
      payload: parsePayload(row.payload),
      lead,
    };
  });
  return Response.json({ tasks });
}

export async function PATCH(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  const payload = (await request.json()) as {
    id?: string;
    action?: TaskAction;
    days?: number;
  };
  const action = payload.action;
  if (!db || !payload.id || !action || !taskActions.includes(action)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const existing = await db
    .prepare("SELECT id FROM lead_tasks WHERE id=? AND workspace_id=?")
    .bind(payload.id, auth.workspaceId)
    .first<{ id?: string }>();
  if (!existing) return Response.json({ error: "not_found" }, { status: 404 });
  const now = new Date().toISOString();
  if (action === "snooze") {
    const days = Math.min(
      maxSnoozeDays,
      Math.max(1, Math.round(Number(payload.days) || defaultSnoozeDays)),
    );
    const until = new Date(Date.now() + days * 86_400_000).toISOString();
    await db
      .prepare(
        `UPDATE lead_tasks SET status='snoozed', snoozed_until=?, updated_at=?
         WHERE id=? AND workspace_id=?`,
      )
      .bind(until, now, payload.id, auth.workspaceId)
      .run();
    return Response.json({ persisted: true, status: "snoozed", snoozedUntil: until });
  }
  const status = action === "done" ? "done" : "dismissed";
  await db
    .prepare(
      `UPDATE lead_tasks SET status=?, snoozed_until=NULL, completed_at=?,
       updated_at=? WHERE id=? AND workspace_id=?`,
    )
    .bind(status, now, now, payload.id, auth.workspaceId)
    .run();
  return Response.json({ persisted: true, status });
}
