import { env } from "cloudflare:workers";
import {
  isAuthResponse,
  publicUrl,
  randomToken,
  requireApiSession,
  sha256,
} from "../../../lib/auth";
import { workspacePlan } from "../../../lib/usage-limits";
import { isValidEmail } from "../../../lib/security-helpers.mjs";

const inviteDays = 7;

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

type MemberRow = {
  userId: string;
  role: string;
  name: string;
  email: string;
  avatarUrl: string;
  createdAt: string;
};

type InviteRow = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
};

// Members and pending (unaccepted, unexpired) invites both occupy a seat.
async function loadTeam(db: D1Database, workspaceId: string) {
  const now = new Date().toISOString();
  const [members, invites] = await Promise.all([
    db
      .prepare(
        `SELECT m.user_id as userId, m.role, m.created_at as createdAt,
         u.name, u.email, u.avatar_url as avatarUrl
         FROM workspace_members m JOIN users u ON u.id=m.user_id
         WHERE m.workspace_id=? ORDER BY m.created_at ASC`,
      )
      .bind(workspaceId)
      .all<MemberRow>(),
    db
      .prepare(
        `SELECT id, email, role, expires_at as expiresAt,
         created_at as createdAt
         FROM workspace_invites
         WHERE workspace_id=? AND accepted_at IS NULL AND expires_at>?
         ORDER BY created_at DESC`,
      )
      .bind(workspaceId, now)
      .all<InviteRow>(),
  ]);
  return {
    members: members.results || [],
    invites: invites.results || [],
  };
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  if (!db) return Response.json({ error: "database_unavailable" }, { status: 503 });
  const [team, plan] = await Promise.all([
    loadTeam(db, auth.workspaceId),
    workspacePlan(auth.workspaceId),
  ]);
  return Response.json({
    members: team.members,
    invites: team.invites,
    plan: plan.id,
    limit: plan.limits.workspaceMembers,
    role: auth.role,
  });
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  // Only 'owner' exists as an elevated role today; members cannot invite.
  if (auth.role !== "owner") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const db = database();
  if (!db) return Response.json({ error: "database_unavailable" }, { status: 503 });
  const payload = (await request.json().catch(() => ({}))) as { email?: string };
  const email = String(payload.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return Response.json({ error: "invalid_email" }, { status: 400 });
  }
  const [team, plan] = await Promise.all([
    loadTeam(db, auth.workspaceId),
    workspacePlan(auth.workspaceId),
  ]);
  if (team.members.some((member) => member.email.toLowerCase() === email)) {
    return Response.json({ error: "already_member" }, { status: 409 });
  }
  // A re-invite replaces the pending invite for the same email, so it does
  // not count twice against the seat limit.
  const pendingOthers = team.invites.filter(
    (invite) => invite.email.toLowerCase() !== email,
  );
  const limit = plan.limits.workspaceMembers;
  const used = team.members.length + pendingOthers.length;
  if (used + 1 > limit) {
    return Response.json(
      {
        error: "plan_limit_reached",
        resource: "workspaceMembers",
        plan: plan.id,
        limit,
        used,
      },
      { status: 402 },
    );
  }
  const token = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + inviteDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const id = `inv_${crypto.randomUUID()}`;
  await db.batch([
    db
      .prepare(
        `DELETE FROM workspace_invites
         WHERE workspace_id=? AND lower(email)=? AND accepted_at IS NULL`,
      )
      .bind(auth.workspaceId, email),
    db
      .prepare(
        `INSERT INTO workspace_invites
         (id, workspace_id, email, role, token_hash, expires_at, accepted_at, created_at)
         VALUES (?, ?, ?, 'member', ?, ?, NULL, ?)`,
      )
      .bind(
        id,
        auth.workspaceId,
        email,
        await sha256(token),
        expiresAt,
        now.toISOString(),
      ),
  ]);
  // The raw token is only returned here (as a shareable link); the database
  // stores its hash, mirroring session tokens.
  const inviteUrl = publicUrl(
    request,
    `/invite?token=${encodeURIComponent(token)}`,
  ).toString();
  return Response.json({
    invite: { id, email, role: "member", expiresAt, createdAt: now.toISOString() },
    inviteUrl,
  });
}

export async function DELETE(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  if (auth.role !== "owner") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const db = database();
  if (!db) return Response.json({ error: "database_unavailable" }, { status: 503 });
  const searchParams = new URL(request.url).searchParams;
  const inviteId = searchParams.get("inviteId") || "";
  const userId = searchParams.get("userId") || "";
  if (inviteId) {
    await db
      .prepare("DELETE FROM workspace_invites WHERE id=? AND workspace_id=?")
      .bind(inviteId, auth.workspaceId)
      .run();
    return Response.json({ removed: true });
  }
  if (!userId) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (userId === auth.userId) {
    return Response.json({ error: "cannot_remove_self" }, { status: 400 });
  }
  const member = await db
    .prepare(
      "SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?",
    )
    .bind(auth.workspaceId, userId)
    .first<{ role?: string }>();
  if (!member) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (member.role === "owner") {
    return Response.json({ error: "cannot_remove_owner" }, { status: 400 });
  }
  // Removing the membership also invalidates the member's sessions that
  // point at this workspace (the auth join would fail anyway; this keeps the
  // sessions table clean and forces a re-login into their own workspace).
  await db.batch([
    db
      .prepare(
        "DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?",
      )
      .bind(auth.workspaceId, userId),
    db
      .prepare("DELETE FROM sessions WHERE user_id=? AND workspace_id=?")
      .bind(userId, auth.workspaceId),
    db
      .prepare(
        `UPDATE prospects SET assigned_user_id=''
         WHERE workspace_id=? AND assigned_user_id=?`,
      )
      .bind(auth.workspaceId, userId),
  ]);
  return Response.json({ removed: true });
}
