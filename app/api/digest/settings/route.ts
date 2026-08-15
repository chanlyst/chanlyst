import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../../lib/auth";
import { digestSettingsFor } from "../../../lib/digest";

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  return Response.json({ settings: await digestSettingsFor(auth.workspaceId) });
}

export async function PATCH(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  if (!db) return Response.json({ error: "database_unavailable" }, { status: 503 });
  const payload = (await request.json()) as {
    enabled?: boolean;
    cadence?: "daily" | "weekly";
    locale?: "ru" | "en";
  };
  const validCadence =
    payload.cadence === undefined ||
    payload.cadence === "daily" ||
    payload.cadence === "weekly";
  const validLocale =
    payload.locale === undefined ||
    payload.locale === "ru" ||
    payload.locale === "en";
  if (!validCadence || !validLocale) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const current = await digestSettingsFor(auth.workspaceId);
  const next = {
    enabled:
      payload.enabled === undefined ? current.enabled : Boolean(payload.enabled),
    cadence: payload.cadence || current.cadence,
    locale: payload.locale || current.locale,
  };
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO digest_settings
       (workspace_id, enabled, cadence, locale, last_sent_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
       enabled=excluded.enabled, cadence=excluded.cadence,
       locale=excluded.locale, updated_at=excluded.updated_at`,
    )
    .bind(auth.workspaceId, next.enabled ? 1 : 0, next.cadence, next.locale, now, now)
    .run();
  return Response.json({
    saved: true,
    settings: await digestSettingsFor(auth.workspaceId),
  });
}
