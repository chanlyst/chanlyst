import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../../lib/auth";
import { planLeadTasks } from "../../../lib/lifecycle-rules.mjs";
import { timingSafeEqualStrings } from "../../../lib/security-helpers.mjs";

// The lifecycle pass is a pure bookkeeping job: it reads leads, sequences and
// events, asks the rule engine what should be on the user's list today, and
// writes the difference. It never calls a model and never sends a message —
// every task it creates waits for an explicit click in the dashboard.

type WorkspaceResult = {
  workspaceId: string;
  created: number;
  closed: number;
  reopened: number;
};

// Upper bounds so one cron tick can never turn into an unbounded job.
const workspaceBatchSize = 50;
const maxTasksPerWorkspace = 200;

function bindings() {
  return env as unknown as { DB?: D1Database; AGENT_CRON_SECRET?: string };
}

/** Reopen snoozed tasks whose snooze has expired. */
async function reopenSnoozed(workspaceId: string, now: string) {
  const result = await bindings()
    .DB!.prepare(
      `UPDATE lead_tasks SET status='open', snoozed_until=NULL, updated_at=?
       WHERE workspace_id=? AND status='snoozed'
         AND snoozed_until IS NOT NULL AND snoozed_until<=?`,
    )
    .bind(now, workspaceId, now)
    .run();
  return Number(result.meta?.changes || 0);
}

async function processWorkspace(workspaceId: string): Promise<WorkspaceResult> {
  const db = bindings().DB!;
  const now = new Date().toISOString();
  const reopened = await reopenSnoozed(workspaceId, now);
  const [leads, sequences, events, tasks] = await Promise.all([
    db
      .prepare(
        `SELECT id, product_id as productId, workspace_id as workspaceId,
         stage, outcome_note as outcomeNote, contacted_at as contactedAt,
         replied_at as repliedAt, meeting_at as meetingAt,
         converted_at as convertedAt, placement_status as placementStatus,
         placement_submitted_at as placementSubmittedAt,
         placement_checked_at as placementCheckedAt,
         placement_url as placementUrl,
         email, telegram, linkedin, contact_status as contactStatus,
         contact_evidence as contactEvidence,
         opportunity_type as opportunityType, action_type as actionType
         FROM prospects WHERE workspace_id=?`,
      )
      .bind(workspaceId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT id, lead_id as leadId, name, status
         FROM outreach_sequences WHERE workspace_id=?`,
      )
      .bind(workspaceId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT lead_id as leadId, sequence_id as sequenceId,
         step_number as stepNumber, event_type as eventType, metadata,
         occurred_at as occurredAt
         FROM outreach_events WHERE workspace_id=?`,
      )
      .bind(workspaceId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT id, lead_id as leadId, type, status,
         completed_at as completedAt FROM lead_tasks WHERE workspace_id=?`,
      )
      .bind(workspaceId)
      .all<Record<string, unknown>>(),
  ]);

  const plan = planLeadTasks({
    now,
    leads: leads.results,
    sequences: sequences.results,
    events: events.results,
    tasks: tasks.results,
  });
  const creates = plan.create.slice(0, maxTasksPerWorkspace);
  const closes = plan.close.slice(0, maxTasksPerWorkspace);
  const statements = [
    ...creates.map((task) =>
      db
        .prepare(
          `INSERT INTO lead_tasks
           (id, workspace_id, product_id, lead_id, type, due_at, payload,
            status, snoozed_until, created_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?, NULL)`,
        )
        .bind(
          crypto.randomUUID(),
          workspaceId,
          String(task.productId || ""),
          String(task.leadId || ""),
          String(task.type || ""),
          String(task.dueAt || now),
          JSON.stringify(task.payload || {}),
          now,
          now,
        ),
    ),
    // An auto-closed task is simply a finished one: the reason it existed is
    // gone, so it must not keep sitting in the user's list.
    ...closes.map((task) =>
      db
        .prepare(
          `UPDATE lead_tasks SET status='done', snoozed_until=NULL,
           completed_at=?, updated_at=? WHERE id=? AND workspace_id=?`,
        )
        .bind(now, now, task.id, workspaceId),
    ),
  ];
  if (statements.length) await db.batch(statements);
  return {
    workspaceId,
    created: creates.length,
    closed: closes.length,
    reopened,
  };
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
    // "Refresh my tasks" from the dashboard: the caller's workspace only.
    const auth = await requireApiSession(request);
    if (isAuthResponse(auth)) return auth;
    const result = await processWorkspace(auth.workspaceId);
    return Response.json({ ok: true, results: [result] });
  }

  // Only workspaces that actually own leads are worth a pass.
  const workspaces = await db
    .prepare(
      `SELECT w.id as id FROM workspaces w
       WHERE EXISTS (SELECT 1 FROM prospects p WHERE p.workspace_id=w.id)
       ORDER BY w.created_at ASC LIMIT ?`,
    )
    .bind(workspaceBatchSize)
    .all<{ id: string }>();
  const results: WorkspaceResult[] = [];
  for (const row of workspaces.results) {
    try {
      results.push(await processWorkspace(row.id));
    } catch {
      results.push({ workspaceId: row.id, created: 0, closed: 0, reopened: 0 });
    }
  }
  return Response.json({
    ok: true,
    workspaces: workspaces.results.length,
    created: results.reduce((sum, item) => sum + item.created, 0),
    closed: results.reduce((sum, item) => sum + item.closed, 0),
    reopened: results.reduce((sum, item) => sum + item.reopened, 0),
    results,
  });
}
