import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../lib/auth";

type CampaignPayload = {
  name?: string;
  website?: string;
  target?: string;
  negative?: string;
  sources?: string[];
  leads?: unknown[];
};

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const payload = (await request.json()) as CampaignPayload;
  const db = (env as unknown as { DB?: D1Database }).DB;

  if (!db) {
    return Response.json({ persisted: false, reason: "database_unavailable" });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO campaigns
      (id, name, website, target, negative, sources, leads, lead_count, created_at, updated_at, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      payload.name || "Untitled campaign",
      payload.website || "",
      payload.target || "",
      payload.negative || "",
      JSON.stringify(payload.sources || []),
      JSON.stringify(payload.leads || []),
      payload.leads?.length || 0,
      now,
      now,
      auth.workspaceId,
    )
    .run();

  return Response.json({ persisted: true, id });
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) return Response.json({ campaigns: [], persisted: false });

  const result = await db
    .prepare(
      `SELECT id, name, website, lead_count, created_at, updated_at
       FROM campaigns WHERE workspace_id=?
       ORDER BY updated_at DESC LIMIT 50`,
    )
    .bind(auth.workspaceId)
    .all();

  return Response.json({ campaigns: result.results, persisted: true });
}
