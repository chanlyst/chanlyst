import {
  authBindings,
  authDatabase,
  createSession,
  ensureOwnerUser,
  sessionCookie,
  sha256,
  verifyOwnerPassword,
} from "../../../lib/auth";
import { clientIpFromHeaders } from "../../../lib/security-helpers.mjs";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export async function POST(request: Request) {
  const database = authDatabase();
  if (!database) {
    return Response.json({ error: "database_unavailable" }, { status: 503 });
  }
  const payload = (await request.json().catch(() => ({}))) as {
    login?: string;
    password?: string;
  };
  const login = String(payload.login || "").trim().toLowerCase();
  const ip = clientIpFromHeaders(request.headers);
  const identityHash = await sha256(`${ip}:${login}`);
  const existing = await database
    .prepare(
      `SELECT attempts, window_started_at as windowStartedAt
       FROM auth_attempts WHERE identity_hash=?`,
    )
    .bind(identityHash)
    .first<{ attempts?: number; windowStartedAt?: string }>();
  const now = new Date();
  const windowStart = Date.parse(existing?.windowStartedAt || "");
  const activeWindow = Number.isFinite(windowStart) && now.getTime() - windowStart < WINDOW_MS;
  if (activeWindow && Number(existing?.attempts || 0) >= MAX_ATTEMPTS) {
    return Response.json({ error: "too_many_attempts" }, { status: 429 });
  }
  // "owner", matching .env.example. The default used to be one particular
  // person's name, which is a strange thing to hand someone else's install.
  const expectedLogin = (authBindings().OWNER_LOGIN || "owner").toLowerCase();
  const valid =
    login === expectedLogin &&
    Boolean(payload.password) &&
    (await verifyOwnerPassword(String(payload.password)));
  if (!valid) {
    const nextAttempts = activeWindow ? Number(existing?.attempts || 0) + 1 : 1;
    const startedAt = activeWindow
      ? String(existing?.windowStartedAt)
      : now.toISOString();
    await database
      .prepare(
        `INSERT INTO auth_attempts
         (identity_hash, attempts, window_started_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(identity_hash) DO UPDATE SET attempts=excluded.attempts,
         window_started_at=excluded.window_started_at,
         updated_at=excluded.updated_at`,
      )
      .bind(identityHash, nextAttempts, startedAt, now.toISOString())
      .run();
    return Response.json({ error: "invalid_credentials" }, { status: 401 });
  }
  await database
    .prepare("DELETE FROM auth_attempts WHERE identity_hash=?")
    .bind(identityHash)
    .run();
  const owner = await ensureOwnerUser();
  const token = await createSession(owner.userId, owner.workspaceId);
  const response = Response.json({ authenticated: true });
  response.headers.append("Set-Cookie", sessionCookie(token));
  return response;
}
