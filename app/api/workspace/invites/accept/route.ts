import { env } from "cloudflare:workers";
import {
  cookieValue,
  isAuthResponse,
  requireApiSession,
  SESSION_COOKIE,
  sha256,
} from "../../../../lib/auth";

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  if (!db) return Response.json({ error: "database_unavailable" }, { status: 503 });
  const payload = (await request.json().catch(() => ({}))) as { token?: string };
  const token = String(payload.token || "");
  if (!token) {
    return Response.json({ error: "invalid_token" }, { status: 400 });
  }
  const invite = await db
    .prepare(
      `SELECT id, workspace_id as workspaceId, role, expires_at as expiresAt,
       accepted_at as acceptedAt
       FROM workspace_invites WHERE token_hash=?`,
    )
    .bind(await sha256(token))
    .first<{
      id?: string;
      workspaceId?: string;
      role?: string;
      expiresAt?: string;
      acceptedAt?: string | null;
    }>();
  if (!invite?.id || !invite.workspaceId) {
    return Response.json({ error: "invalid_token" }, { status: 404 });
  }
  if (invite.acceptedAt) {
    return Response.json({ error: "already_accepted" }, { status: 409 });
  }
  const now = new Date().toISOString();
  if (String(invite.expiresAt || "") <= now) {
    return Response.json({ error: "expired" }, { status: 410 });
  }
  // The invitee already has a session bound to their own auto-created
  // workspace. There is no workspace switcher yet, so joining also moves the
  // current session to the joined workspace — the dashboard shows it right
  // after the redirect.
  const sessionToken = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  const statements = [
    db
      .prepare(
        `INSERT OR IGNORE INTO workspace_members
         (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
      )
      .bind(invite.workspaceId, auth.userId, invite.role || "member", now),
    db
      .prepare("UPDATE workspace_invites SET accepted_at=? WHERE id=?")
      .bind(now, invite.id),
  ];
  if (sessionToken) {
    statements.push(
      db
        .prepare("UPDATE sessions SET workspace_id=? WHERE token_hash=?")
        .bind(invite.workspaceId, await sha256(sessionToken)),
    );
  }
  await db.batch(statements);
  return Response.json({ joined: true, workspaceId: invite.workspaceId });
}
