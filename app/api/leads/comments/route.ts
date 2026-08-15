import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../../lib/auth";

const maxCommentLength = 2000;

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

async function leadInWorkspace(
  db: D1Database,
  leadId: string,
  workspaceId: string,
) {
  const lead = await db
    .prepare("SELECT id FROM prospects WHERE id=? AND workspace_id=?")
    .bind(leadId, workspaceId)
    .first<{ id?: string }>();
  return Boolean(lead?.id);
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  const leadId = new URL(request.url).searchParams.get("leadId") || "";
  if (!db || !leadId) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (!(await leadInWorkspace(db, leadId, auth.workspaceId))) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const result = await db
    .prepare(
      `SELECT c.id, c.lead_id as leadId, c.user_id as userId, c.body,
       c.created_at as createdAt, u.name as userName,
       u.avatar_url as userAvatarUrl
       FROM lead_comments c JOIN users u ON u.id=c.user_id
       WHERE c.lead_id=? AND c.workspace_id=?
       ORDER BY c.created_at ASC`,
    )
    .bind(leadId, auth.workspaceId)
    .all();
  return Response.json({ comments: result.results || [] });
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  const payload = (await request.json().catch(() => ({}))) as {
    leadId?: string;
    body?: string;
  };
  const leadId = String(payload.leadId || "");
  const body = String(payload.body || "").trim().slice(0, maxCommentLength);
  if (!db || !leadId || !body) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (!(await leadInWorkspace(db, leadId, auth.workspaceId))) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const id = `cmt_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO lead_comments
       (id, workspace_id, lead_id, user_id, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, auth.workspaceId, leadId, auth.userId, body, now)
    .run();
  return Response.json({
    comment: {
      id,
      leadId,
      userId: auth.userId,
      userName: auth.name,
      userAvatarUrl: auth.avatarUrl,
      body,
      createdAt: now,
    },
  });
}

export async function DELETE(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!db || !id) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const comment = await db
    .prepare(
      "SELECT user_id as userId FROM lead_comments WHERE id=? AND workspace_id=?",
    )
    .bind(id, auth.workspaceId)
    .first<{ userId?: string }>();
  if (!comment?.userId) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  // Authors can delete their own comments; the workspace owner can moderate.
  if (comment.userId !== auth.userId && auth.role !== "owner") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  await db
    .prepare("DELETE FROM lead_comments WHERE id=? AND workspace_id=?")
    .bind(id, auth.workspaceId)
    .run();
  return Response.json({ removed: true });
}
