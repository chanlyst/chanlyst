import { env } from "cloudflare:workers";

export const SESSION_COOKIE = "__Host-chanlyst_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

export type AuthSession = {
  userId: string;
  workspaceId: string;
  email: string;
  name: string;
  avatarUrl: string;
  role: string;
};

type AuthBindings = {
  DB?: D1Database;
  PUBLIC_BASE_URL?: string;
  OWNER_LOGIN?: string;
  OWNER_PASSWORD_HASH?: string;
  GOOGLE_AUTH_CLIENT_ID?: string;
  GOOGLE_AUTH_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
};

/** Identity providers that can own a row in oauth_accounts. */
export type AuthProvider = "google" | "apple" | "github" | "email";

export function authBindings() {
  return env as unknown as AuthBindings;
}

export function authDatabase() {
  return authBindings().DB;
}

export function publicUrl(request: Request, path: string) {
  const base = authBindings().PUBLIC_BASE_URL;
  if (base) return new URL(path, base);
  // x-forwarded-host is client-controlled and must not decide redirect URLs.
  const incoming = new URL(request.url);
  const protocol =
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ||
    incoming.protocol.replace(":", "");
  const host = request.headers.get("host") || incoming.host;
  return new URL(path, `${protocol}://${host}`);
}

export function cookieValue(cookieHeader: string | null, name: string) {
  return cookieHeader
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function randomToken(size = 32) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function getSessionFromCookieHeader(cookieHeader: string | null) {
  const database = authDatabase();
  const token = cookieValue(cookieHeader, SESSION_COOKIE);
  if (!database || !token) return null;
  const tokenHash = await sha256(token);
  const session = await database
    .prepare(
      `SELECT s.user_id as userId, s.workspace_id as workspaceId,
       u.email, u.name, u.avatar_url as avatarUrl, m.role
       FROM sessions s
       JOIN users u ON u.id=s.user_id
       JOIN workspace_members m
         ON m.user_id=s.user_id AND m.workspace_id=s.workspace_id
       WHERE s.token_hash=? AND s.expires_at>?`,
    )
    .bind(tokenHash, new Date().toISOString())
    .first<AuthSession>();
  if (!session) return null;
  await database
    .prepare("UPDATE sessions SET last_seen_at=? WHERE token_hash=?")
    .bind(new Date().toISOString(), tokenHash)
    .run();
  return session;
}

export async function getSession(request: Request) {
  return getSessionFromCookieHeader(request.headers.get("cookie"));
}

export async function requireApiSession(request: Request) {
  const session = await getSession(request);
  return session || Response.json({ error: "unauthorized" }, { status: 401 });
}

export function isAuthResponse(value: AuthSession | Response): value is Response {
  return value instanceof Response;
}

export function sessionCookie(token: string, maxAge = SESSION_SECONDS) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function createSession(userId: string, workspaceId: string) {
  const database = authDatabase();
  if (!database) throw new Error("database_unavailable");
  const token = randomToken(36);
  const now = new Date();
  await database
    .prepare(
      `INSERT INTO sessions
       (token_hash, user_id, workspace_id, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      await sha256(token),
      userId,
      workspaceId,
      new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString(),
      now.toISOString(),
      now.toISOString(),
    )
    .run();
  return token;
}

export async function deleteSession(request: Request) {
  const database = authDatabase();
  const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  if (database && token) {
    await database
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .bind(await sha256(token))
      .run();
  }
}

function workspaceName(name: string, email: string) {
  const first = name.trim().split(/\s+/)[0] || email.split("@")[0] || "My";
  return `${first}'s workspace`;
}

export async function upsertOauthUser(profile: {
  provider: AuthProvider;
  providerAccountId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}) {
  const database = authDatabase();
  if (!database) throw new Error("database_unavailable");
  const account = await database
    .prepare(
      `SELECT user_id as userId FROM oauth_accounts
       WHERE provider=? AND provider_account_id=?`,
    )
    .bind(profile.provider, profile.providerAccountId)
    .first<{ userId?: string }>();
  let userId = account?.userId || "";
  if (!userId && profile.email) {
    const existing = await database
      .prepare("SELECT id FROM users WHERE lower(email)=lower(?) LIMIT 1")
      .bind(profile.email)
      .first<{ id?: string }>();
    userId = existing?.id || "";
  }
  const now = new Date().toISOString();
  if (!userId) {
    userId = `usr_${crypto.randomUUID()}`;
    await database
      .prepare(
        `INSERT INTO users (id, email, name, avatar_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        userId,
        profile.email,
        profile.name || profile.email.split("@")[0],
        profile.avatarUrl || "",
        now,
        now,
      )
      .run();
  } else {
    await database
      .prepare(
        `UPDATE users SET email=CASE WHEN ?<>'' THEN ? ELSE email END,
         name=CASE WHEN ?<>'' THEN ? ELSE name END,
         avatar_url=CASE WHEN ?<>'' THEN ? ELSE avatar_url END,
         updated_at=? WHERE id=?`,
      )
      .bind(
        profile.email,
        profile.email,
        profile.name,
        profile.name,
        profile.avatarUrl || "",
        profile.avatarUrl || "",
        now,
        userId,
      )
      .run();
  }
  await database
    .prepare(
      `INSERT INTO oauth_accounts
       (provider, provider_account_id, user_id, email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, provider_account_id) DO UPDATE SET
       user_id=excluded.user_id, email=excluded.email, updated_at=excluded.updated_at`,
    )
    .bind(
      profile.provider,
      profile.providerAccountId,
      userId,
      profile.email,
      now,
      now,
    )
    .run();
  let membership = await database
    .prepare(
      `SELECT workspace_id as workspaceId FROM workspace_members
       WHERE user_id=? ORDER BY created_at ASC LIMIT 1`,
    )
    .bind(userId)
    .first<{ workspaceId?: string }>();
  if (!membership?.workspaceId) {
    const workspaceId = `ws_${crypto.randomUUID()}`;
    await database.batch([
      database
        .prepare(
          `INSERT INTO workspaces
           (id, name, owner_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          workspaceId,
          workspaceName(profile.name, profile.email),
          userId,
          now,
          now,
        ),
      database
        .prepare(
          `INSERT INTO workspace_members
           (workspace_id, user_id, role, created_at)
           VALUES (?, ?, 'owner', ?)`,
        )
        .bind(workspaceId, userId, now),
    ]);
    membership = { workspaceId };
  }
  return { userId, workspaceId: membership.workspaceId! };
}

export async function ensureOwnerUser() {
  const database = authDatabase();
  if (!database) throw new Error("database_unavailable");
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO users
         (id, email, name, avatar_url, created_at, updated_at)
         VALUES ('owner', '', 'Owner', '', ?, ?)`,
      )
      .bind(now, now),
    database
      .prepare(
        `INSERT OR IGNORE INTO workspaces
         (id, name, owner_user_id, created_at, updated_at)
         VALUES ('workspace-owner', 'Chanlyst', 'owner', ?, ?)`,
      )
      .bind(now, now),
    database
      .prepare(
        `INSERT OR IGNORE INTO workspace_members
         (workspace_id, user_id, role, created_at)
         VALUES ('workspace-owner', 'owner', 'owner', ?)`,
      )
      .bind(now),
  ]);
  return { userId: "owner", workspaceId: "workspace-owner" };
}

export async function saveOauthState(
  provider: AuthProvider,
  state: string,
  verifier: string,
  nonce: string,
) {
  const database = authDatabase();
  if (!database) throw new Error("database_unavailable");
  const now = new Date();
  await database
    .prepare(
      `INSERT INTO oauth_states
       (state_hash, provider, verifier, nonce, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      await sha256(state),
      provider,
      verifier,
      nonce,
      new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
      now.toISOString(),
    )
    .run();
}

export async function consumeOauthState(
  provider: AuthProvider,
  state: string,
) {
  const database = authDatabase();
  if (!database) return null;
  const stateHash = await sha256(state);
  const row = await database
    .prepare(
      `SELECT verifier, nonce FROM oauth_states
       WHERE state_hash=? AND provider=? AND expires_at>?`,
    )
    .bind(stateHash, provider, new Date().toISOString())
    .first<{ verifier?: string; nonce?: string }>();
  await database
    .prepare("DELETE FROM oauth_states WHERE state_hash=?")
    .bind(stateHash)
    .run();
  return row?.nonce ? { verifier: row.verifier || "", nonce: row.nonce } : null;
}

export async function verifyOwnerPassword(password: string) {
  const stored = authBindings().OWNER_PASSWORD_HASH || "";
  const [algorithm, iterationText, saltText, expectedText] = stored.split(/[$:]/);
  if (algorithm !== "pbkdf2" || !saltText || !expectedText) return false;
  const iterations = Number(iterationText);
  if (!Number.isFinite(iterations) || iterations < 100_000) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const actual = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations,
        salt: Uint8Array.from(atob(saltText), (character) =>
          character.charCodeAt(0),
        ),
      },
      key,
      256,
    ),
  );
  const expected = Uint8Array.from(atob(expectedText), (character) =>
    character.charCodeAt(0),
  );
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual[index] ^ expected[index];
  }
  return difference === 0;
}
