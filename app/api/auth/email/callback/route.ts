import {
  authDatabase,
  createSession,
  publicUrl,
  sessionCookie,
  sha256,
  upsertOauthUser,
} from "../../../../lib/auth";
import { loginLinkState } from "../../../../lib/auth-helpers.mjs";

type LoginLinkRow = { email?: string; expiresAt?: string; usedAt?: string };

export async function GET(request: Request) {
  const database = authDatabase();
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!database || !token) {
    return Response.redirect(publicUrl(request, "/login?error=login_link_invalid"));
  }
  const tokenHash = await sha256(token);
  const row = await database
    .prepare(
      `SELECT email, expires_at as expiresAt, used_at as usedAt
       FROM login_links WHERE token_hash=?`,
    )
    .bind(tokenHash)
    .first<LoginLinkRow>();
  const state = loginLinkState(row);
  if (state === "expired") {
    return Response.redirect(publicUrl(request, "/login?error=login_link_expired"));
  }
  if (state !== "valid" || !row?.email) {
    return Response.redirect(publicUrl(request, "/login?error=login_link_invalid"));
  }
  // Single use is decided by the database, not by the read above: only the
  // request whose UPDATE actually changed a row may open a session.
  const claimed = await database
    .prepare(
      "UPDATE login_links SET used_at=? WHERE token_hash=? AND used_at IS NULL",
    )
    .bind(new Date().toISOString(), tokenHash)
    .run();
  if (claimed.meta.changes !== 1) {
    return Response.redirect(publicUrl(request, "/login?error=login_link_invalid"));
  }
  try {
    const email = row.email;
    const account = await upsertOauthUser({
      provider: "email",
      providerAccountId: email,
      email,
      name: email.split("@")[0],
    });
    const sessionToken = await createSession(
      account.userId,
      account.workspaceId,
    );
    const headers = new Headers({
      Location: publicUrl(request, "/dashboard").toString(),
    });
    headers.append("Set-Cookie", sessionCookie(sessionToken));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error(
      "[auth/email] sign-in failed",
      error instanceof Error ? error.message : "unknown",
    );
    return Response.redirect(publicUrl(request, "/login?error=login_link_invalid"));
  }
}
