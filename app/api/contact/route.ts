import { env } from "cloudflare:workers";
import { sha256 } from "../../lib/auth";
import { clientIpFromHeaders } from "../../lib/security-helpers.mjs";

type ContactPayload = {
  name?: string;
  email?: string;
  company?: string;
  topic?: string;
  message?: string;
  website?: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;

export async function POST(request: Request) {
  const database = (env as unknown as { DB?: D1Database }).DB;
  if (!database) {
    return Response.json({ error: "service_unavailable" }, { status: 503 });
  }

  const payload = (await request.json()) as ContactPayload;
  if (payload.website) return Response.json({ accepted: true });

  const ip = clientIpFromHeaders(request.headers);
  const identityHash = await sha256(`${ip}:contact`);
  const existing = await database
    .prepare(
      `SELECT attempts, window_started_at as windowStartedAt
       FROM auth_attempts WHERE identity_hash=?`,
    )
    .bind(identityHash)
    .first<{ attempts?: number; windowStartedAt?: string }>();
  const now = new Date();
  const windowStart = Date.parse(existing?.windowStartedAt || "");
  const activeWindow =
    Number.isFinite(windowStart) && now.getTime() - windowStart < WINDOW_MS;
  if (activeWindow && Number(existing?.attempts || 0) >= MAX_REQUESTS) {
    return Response.json({ error: "too_many_requests" }, { status: 429 });
  }
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
      activeWindow ? Number(existing?.attempts || 0) + 1 : 1,
      activeWindow ? String(existing?.windowStartedAt) : now.toISOString(),
      now.toISOString(),
    )
    .run();

  const name = payload.name?.trim() || "";
  const email = payload.email?.trim().toLowerCase() || "";
  const message = payload.message?.trim() || "";
  if (name.length < 2 || !emailPattern.test(email) || message.length < 10) {
    return Response.json({ error: "invalid_contact_request" }, { status: 400 });
  }

  await database
    .prepare(
      `INSERT INTO contact_requests
       (id, name, email, company, topic, message, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'new', ?)`,
    )
    .bind(
      crypto.randomUUID(),
      name.slice(0, 120),
      email.slice(0, 254),
      (payload.company || "").trim().slice(0, 180),
      (payload.topic || "general").slice(0, 40),
      message.slice(0, 5000),
      new Date().toISOString(),
    )
    .run();

  return Response.json({ accepted: true });
}
