import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../lib/auth";

const allowedChannels = ["email", "telegram", "linkedin"] as const;
const allowedModes = ["", "outreach", "free_listing", "paid_placement"] as const;
const allowedLocales = ["ru", "en"] as const;

const nameLimit = 120;
const subjectLimit = 500;
const bodyLimit = 20000;

type TemplatePayload = {
  id?: string;
  name?: string;
  channel?: string;
  engagementMode?: string;
  locale?: string;
  subject?: string;
  body?: string;
  archived?: boolean | number;
};

type TemplateRow = {
  id: string;
  name: string;
  channel: string;
  engagementMode: string;
  locale: string;
  subject: string;
  body: string;
  archived: number;
  createdAt: string;
  updatedAt: string;
  sentCount: number;
  replyCount: number;
};

function getDb() {
  return (env as unknown as { DB?: D1Database }).DB;
}

// Validate the mutable fields shared by POST and PATCH. Returns an error code
// or null; only fields present in `payload` are checked when partial=true.
function validateFields(
  payload: TemplatePayload,
  partial: boolean,
): string | null {
  if (!partial || payload.name !== undefined) {
    const name = String(payload.name || "").trim();
    if (!name || name.length > nameLimit) return "invalid_name";
  }
  if (!partial || payload.body !== undefined) {
    const body = String(payload.body || "");
    if (!body.trim() || body.length > bodyLimit) return "invalid_body";
  }
  if (payload.subject !== undefined && String(payload.subject).length > subjectLimit) {
    return "invalid_subject";
  }
  if (
    payload.channel !== undefined &&
    !allowedChannels.includes(payload.channel as (typeof allowedChannels)[number])
  ) {
    return "invalid_channel";
  }
  if (
    payload.engagementMode !== undefined &&
    !allowedModes.includes(payload.engagementMode as (typeof allowedModes)[number])
  ) {
    return "invalid_engagement_mode";
  }
  if (
    payload.locale !== undefined &&
    !allowedLocales.includes(payload.locale as (typeof allowedLocales)[number])
  ) {
    return "invalid_locale";
  }
  return null;
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = getDb();
  if (!db) return Response.json({ templates: [], persisted: false });

  const includeArchived =
    new URL(request.url).searchParams.get("archived") === "1";
  // One grouped query: templates joined with per-template message metrics.
  const result = await db
    .prepare(
      `SELECT t.id, t.name, t.channel, t.engagement_mode as engagementMode,
              t.locale, t.subject, t.body, t.archived,
              t.created_at as createdAt, t.updated_at as updatedAt,
              COUNT(CASE WHEN m.status='sent' THEN 1 END) as sentCount,
              COUNT(CASE WHEN m.status='sent' AND m.replied_at IS NOT NULL THEN 1 END) as replyCount
       FROM outreach_templates t
       LEFT JOIN outbound_messages m
         ON m.template_id = t.id AND m.workspace_id = t.workspace_id
       WHERE t.workspace_id=?${includeArchived ? "" : " AND t.archived=0"}
       GROUP BY t.id
       ORDER BY t.updated_at DESC
       LIMIT 200`,
    )
    .bind(auth.workspaceId)
    .all<TemplateRow>();

  return Response.json({ templates: result.results, persisted: true });
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = getDb();
  if (!db) return Response.json({ persisted: false });

  const payload = (await request.json()) as TemplatePayload;
  const error = validateFields(payload, false);
  if (error) return Response.json({ error }, { status: 400 });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO outreach_templates
       (id, workspace_id, name, channel, engagement_mode, locale, subject, body, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(
      id,
      auth.workspaceId,
      String(payload.name || "").trim(),
      payload.channel || "email",
      payload.engagementMode || "",
      payload.locale || "ru",
      String(payload.subject || ""),
      String(payload.body || ""),
      now,
      now,
    )
    .run();

  return Response.json({ persisted: true, id });
}

export async function PATCH(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = getDb();
  if (!db) return Response.json({ persisted: false });

  const payload = (await request.json()) as TemplatePayload;
  if (!payload.id) return Response.json({ error: "missing_id" }, { status: 400 });
  const error = validateFields(payload, true);
  if (error) return Response.json({ error }, { status: 400 });

  const updates: string[] = [];
  const values: (string | number)[] = [];
  if (payload.name !== undefined) {
    updates.push("name=?");
    values.push(String(payload.name).trim());
  }
  if (payload.channel !== undefined) {
    updates.push("channel=?");
    values.push(payload.channel);
  }
  if (payload.engagementMode !== undefined) {
    updates.push("engagement_mode=?");
    values.push(payload.engagementMode);
  }
  if (payload.locale !== undefined) {
    updates.push("locale=?");
    values.push(payload.locale);
  }
  if (payload.subject !== undefined) {
    updates.push("subject=?");
    values.push(String(payload.subject));
  }
  if (payload.body !== undefined) {
    updates.push("body=?");
    values.push(String(payload.body));
  }
  if (payload.archived !== undefined) {
    updates.push("archived=?");
    values.push(payload.archived ? 1 : 0);
  }
  if (!updates.length) {
    return Response.json({ error: "no_fields" }, { status: 400 });
  }
  updates.push("updated_at=?");
  values.push(new Date().toISOString());

  const result = await db
    .prepare(
      `UPDATE outreach_templates SET ${updates.join(", ")}
       WHERE id=? AND workspace_id=?`,
    )
    .bind(...values, payload.id, auth.workspaceId)
    .run();
  if (!result.meta.changes) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({ persisted: true });
}

export async function DELETE(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = getDb();
  if (!db) return Response.json({ persisted: false });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

  const referenced = await db
    .prepare(
      `SELECT 1 FROM outbound_messages WHERE template_id=? AND workspace_id=? LIMIT 1`,
    )
    .bind(id, auth.workspaceId)
    .first();

  if (referenced) {
    // Metrics history would break on a hard delete; archive instead.
    const result = await db
      .prepare(
        `UPDATE outreach_templates SET archived=1, updated_at=?
         WHERE id=? AND workspace_id=?`,
      )
      .bind(new Date().toISOString(), id, auth.workspaceId)
      .run();
    if (!result.meta.changes) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return Response.json({ persisted: true, outcome: "archived" });
  }

  const result = await db
    .prepare(`DELETE FROM outreach_templates WHERE id=? AND workspace_id=?`)
    .bind(id, auth.workspaceId)
    .run();
  if (!result.meta.changes) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({ persisted: true, outcome: "deleted" });
}
