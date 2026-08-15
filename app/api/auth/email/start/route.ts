import {
  authBindings,
  authDatabase,
  publicUrl,
  randomToken,
  sha256,
} from "../../../../lib/auth";
import {
  magicLinkEmail,
  normalizeEmail,
} from "../../../../lib/auth-helpers.mjs";
import {
  clientIpFromHeaders,
  isValidEmail,
} from "../../../../lib/security-helpers.mjs";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LINK_TTL_MS = 15 * 60 * 1000;

type AttemptRow = { attempts?: number; windowStartedAt?: string };

async function readAttempt(
  database: D1Database,
  identityHash: string,
): Promise<AttemptRow | null> {
  return database
    .prepare(
      `SELECT attempts, window_started_at as windowStartedAt
       FROM auth_attempts WHERE identity_hash=?`,
    )
    .bind(identityHash)
    .first<AttemptRow>();
}

function isBlocked(row: AttemptRow | null, now: Date) {
  const windowStart = Date.parse(row?.windowStartedAt || "");
  const activeWindow =
    Number.isFinite(windowStart) && now.getTime() - windowStart < WINDOW_MS;
  return activeWindow && Number(row?.attempts || 0) >= MAX_ATTEMPTS;
}

async function recordAttempt(
  database: D1Database,
  identityHash: string,
  row: AttemptRow | null,
  now: Date,
) {
  const windowStart = Date.parse(row?.windowStartedAt || "");
  const activeWindow =
    Number.isFinite(windowStart) && now.getTime() - windowStart < WINDOW_MS;
  await database
    .prepare(
      `INSERT INTO auth_attempts
       (identity_hash, attempts, window_started_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(identity_hash) DO UPDATE SET attempts=excluded.attempts,
       window_started_at=excluded.window_started_at,
       updated_at=excluded.updated_at`,
    )
    .bind(
      identityHash,
      activeWindow ? Number(row?.attempts || 0) + 1 : 1,
      activeWindow ? String(row?.windowStartedAt) : now.toISOString(),
      now.toISOString(),
    )
    .run();
}

export async function POST(request: Request) {
  const database = authDatabase();
  if (!database) {
    return Response.json({ error: "database_unavailable" }, { status: 503 });
  }
  const bindings = authBindings();
  if (!bindings.RESEND_API_KEY || !bindings.MAIL_FROM) {
    return Response.json(
      { error: "email_login_not_configured" },
      { status: 503 },
    );
  }
  const payload = (await request.json().catch(() => ({}))) as {
    email?: string;
    locale?: string;
  };
  const email = normalizeEmail(payload.email);
  if (!isValidEmail(email)) {
    return Response.json({ error: "invalid_email" }, { status: 400 });
  }
  const ip = clientIpFromHeaders(request.headers);
  // Two independent buckets: one stops a single host from spraying many
  // addresses, the other stops many hosts from mail-bombing one address.
  const ipHash = await sha256(`${ip}:email-login`);
  const emailHash = await sha256(`${email}:email-login`);
  const now = new Date();
  const [ipRow, emailRow] = await Promise.all([
    readAttempt(database, ipHash),
    readAttempt(database, emailHash),
  ]);
  if (isBlocked(ipRow, now) || isBlocked(emailRow, now)) {
    return Response.json({ error: "too_many_attempts" }, { status: 429 });
  }
  await recordAttempt(database, ipHash, ipRow, now);
  await recordAttempt(database, emailHash, emailRow, now);

  const token = randomToken(32);
  await database
    .prepare("DELETE FROM login_links WHERE email=? AND used_at IS NULL")
    .bind(email)
    .run();
  await database
    .prepare(
      `INSERT INTO login_links
       (token_hash, email, expires_at, used_at, created_at)
       VALUES (?, ?, ?, NULL, ?)`,
    )
    .bind(
      await sha256(token),
      email,
      new Date(now.getTime() + LINK_TTL_MS).toISOString(),
      now.toISOString(),
    )
    .run();

  const link = publicUrl(
    request,
    `/api/auth/email/callback?token=${encodeURIComponent(token)}`,
  ).toString();
  const letter = magicLinkEmail(payload.locale === "en" ? "en" : "ru", link);
  try {
    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bindings.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: bindings.MAIL_FROM,
        to: [email],
        subject: letter.subject,
        text: letter.text,
      }),
    });
    if (!sent.ok) {
      console.error("[auth/email] resend rejected the message", sent.status);
    }
  } catch (error) {
    console.error(
      "[auth/email] resend request failed",
      error instanceof Error ? error.message : "unknown",
    );
  }
  // Always the same answer: the response must never reveal whether the address
  // belongs to an existing account, nor whether delivery actually succeeded.
  return Response.json({ sent: true });
}
