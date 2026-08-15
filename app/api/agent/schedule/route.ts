import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../../lib/auth";
import { workspacePlan } from "../../../lib/usage-limits";

const allowedSources = new Set([
  "web",
  "reviews",
  "creators",
  "communities",
  "directories",
  "publishers",
]);

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

function nextRun(cadence: "daily" | "weekly") {
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + (cadence === "daily" ? 1 : 7));
  return next.toISOString();
}

async function scheduleFor(workspaceId: string) {
  const db = database();
  if (!db) return null;
  const schedule = await db
    .prepare(
      `SELECT enabled, cadence, max_results as maxResults, sources,
       next_run_at as nextRunAt, last_run_at as lastRunAt,
       updated_at as updatedAt
       FROM agent_schedules WHERE workspace_id=?`,
    )
    .bind(workspaceId)
    .first<Record<string, unknown>>();
  const lastRun = await db
    .prepare(
      `SELECT id, status, products_processed as productsProcessed,
       opportunities_found as opportunitiesFound, error,
       started_at as startedAt, finished_at as finishedAt
       FROM agent_runs WHERE workspace_id=? ORDER BY started_at DESC LIMIT 1`,
    )
    .bind(workspaceId)
    .first<Record<string, unknown>>();
  return {
    enabled: Boolean(schedule?.enabled),
    cadence: schedule?.cadence === "daily" ? "daily" : "weekly",
    maxResults: Number(schedule?.maxResults || 12),
    sources: schedule?.sources
      ? JSON.parse(String(schedule.sources))
      : ["web", "reviews", "creators", "communities"],
    nextRunAt: schedule?.nextRunAt || null,
    lastRunAt: schedule?.lastRunAt || null,
    lastRun: lastRun || null,
  };
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const plan = await workspacePlan(auth.workspaceId);
  return Response.json({
    schedule: await scheduleFor(auth.workspaceId),
    plan: plan.id,
    canSchedule: plan.id !== "free",
    canRunDaily: plan.id === "pro" || plan.id === "scale",
  });
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  if (!db) return Response.json({ error: "database_unavailable" }, { status: 503 });
  const payload = (await request.json()) as {
    enabled?: boolean;
    cadence?: "daily" | "weekly";
    maxResults?: number;
    sources?: string[];
  };
  const plan = await workspacePlan(auth.workspaceId);
  if (payload.enabled && plan.id === "free") {
    return Response.json({ error: "paid_plan_required" }, { status: 402 });
  }
  const cadence =
    payload.cadence === "daily" && (plan.id === "pro" || plan.id === "scale")
      ? "daily"
      : "weekly";
  const maxResults = Math.max(3, Math.min(24, Number(payload.maxResults) || 12));
  const sources = Array.isArray(payload.sources)
    ? payload.sources.filter((source) => allowedSources.has(source)).slice(0, 6)
    : ["web", "reviews", "creators", "communities"];
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO agent_schedules
       (workspace_id, enabled, cadence, max_results, sources, next_run_at,
        last_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
       enabled=excluded.enabled, cadence=excluded.cadence,
       max_results=excluded.max_results, sources=excluded.sources,
       next_run_at=CASE
         WHEN excluded.enabled=0 THEN NULL
         WHEN agent_schedules.enabled=0 OR agent_schedules.next_run_at IS NULL
           THEN excluded.next_run_at
         ELSE agent_schedules.next_run_at END,
       updated_at=excluded.updated_at`,
    )
    .bind(
      auth.workspaceId,
      payload.enabled ? 1 : 0,
      cadence,
      maxResults,
      JSON.stringify(sources.length ? sources : ["web"]),
      payload.enabled ? nextRun(cadence) : null,
      now,
      now,
    )
    .run();
  return Response.json({
    saved: true,
    schedule: await scheduleFor(auth.workspaceId),
    plan: plan.id,
    canSchedule: plan.id !== "free",
    canRunDaily: plan.id === "pro" || plan.id === "scale",
  });
}
