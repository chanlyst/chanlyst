import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../lib/auth";
import { enforceUsageLimit } from "../../lib/usage-limits";

type ProductPayload = {
  id?: string;
  name?: string;
  website?: string;
  description?: string;
  category?: string;
  audience?: string;
  negativeAudience?: string;
  geography?: string;
  languages?: string;
  goal?: string;
  monetizationModel?: string;
  paidOffer?: string;
  priceRange?: string;
  paymentPoint?: string;
  conversionEvent?: string;
  attributionMethod?: string;
  partnerTerms?: string;
  analysis?: unknown;
};

function db() {
  return (env as unknown as { DB?: D1Database }).DB;
}

// Source keys the discovery pipeline understands (mirrors the dashboard's
// sourceOptions plus the agent schedule's allowed set).
const monitoringSourceKeys = new Set([
  "web",
  "reviews",
  "creators",
  "communities",
  "directories",
  "publishers",
  "local",
]);

// monitoring_sources is stored as '' (inherit workspace agent sources) or a
// JSON array of known source keys; anything malformed collapses to ''.
function parseSources(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .filter((item) => monitoringSourceKeys.has(item))
      .slice(0, 8);
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const database = db();
  if (!database) return Response.json({ products: [], persisted: false });
  const result = await database
    .prepare(
      `SELECT id, name, website, description, category, audience,
       negative_audience as negativeAudience, geography, languages, goal,
       monetization_model as monetizationModel, paid_offer as paidOffer,
       price_range as priceRange, payment_point as paymentPoint,
       conversion_event as conversionEvent,
       attribution_method as attributionMethod, partner_terms as partnerTerms,
       analysis, monitoring_enabled as monitoringEnabled,
       monitoring_sources as monitoringSources,
       monitoring_last_seen_at as monitoringLastSeenAt,
       (SELECT COUNT(*) FROM prospects p
        WHERE p.product_id=products.id AND p.workspace_id=products.workspace_id
          AND p.record_kind='channel'
          AND p.created_at > products.monitoring_last_seen_at) as newCount,
       created_at as createdAt, updated_at as updatedAt
       FROM products WHERE workspace_id=? ORDER BY updated_at DESC`,
    )
    .bind(auth.workspaceId)
    .all();
  return Response.json({
    persisted: true,
    products: result.results.map((item: Record<string, unknown>) => ({
      ...item,
      analysis: JSON.parse(String(item.analysis || "{}")),
      monitoringEnabled: Boolean(item.monitoringEnabled),
      monitoringSources: parseSources(String(item.monitoringSources || "")),
      newCount: Number(item.newCount || 0),
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const database = db();
  if (!database) return Response.json({ persisted: false }, { status: 503 });
  const payload = (await request.json()) as ProductPayload;
  if (!payload.name?.trim()) {
    return Response.json({ error: "name_required" }, { status: 400 });
  }
  const id = payload.id || crypto.randomUUID();
  const existing = payload.id
    ? await database
        .prepare("SELECT id FROM products WHERE id=? AND workspace_id=?")
        .bind(payload.id, auth.workspaceId)
        .first()
    : null;
  const quota = await enforceUsageLimit(auth.workspaceId, "products", {
    isNewProduct: !existing,
  });
  if (!quota.allowed) return quota.response!;
  const now = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO products
       (id, name, website, description, category, audience, negative_audience,
        geography, languages, goal, monetization_model, paid_offer, price_range,
        payment_point, conversion_event, attribution_method, partner_terms,
        analysis, created_at, updated_at, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, website=excluded.website,
         description=excluded.description, category=excluded.category,
         audience=excluded.audience, negative_audience=excluded.negative_audience,
         geography=excluded.geography, languages=excluded.languages,
         goal=excluded.goal, monetization_model=excluded.monetization_model,
         paid_offer=excluded.paid_offer, price_range=excluded.price_range,
         payment_point=excluded.payment_point,
         conversion_event=excluded.conversion_event,
         attribution_method=excluded.attribution_method,
         partner_terms=excluded.partner_terms,
         analysis=excluded.analysis, updated_at=excluded.updated_at
       WHERE products.workspace_id=excluded.workspace_id`,
    )
    .bind(
      id,
      payload.name.trim(),
      payload.website || "",
      payload.description || "",
      payload.category || "",
      payload.audience || "",
      payload.negativeAudience || "",
      payload.geography || "",
      payload.languages || "",
      payload.goal || "paid_customers",
      payload.monetizationModel || "",
      payload.paidOffer || "",
      payload.priceRange || "",
      payload.paymentPoint || "",
      payload.conversionEvent || "",
      payload.attributionMethod || "",
      payload.partnerTerms || "",
      JSON.stringify(payload.analysis || {}),
      now,
      now,
      auth.workspaceId,
    )
    .run();
  const saved = await database
    .prepare("SELECT id FROM products WHERE id=? AND workspace_id=?")
    .bind(id, auth.workspaceId)
    .first();
  if (!saved) {
    return Response.json({ error: "product_id_conflict" }, { status: 409 });
  }
  return Response.json({ persisted: true, id });
}

// Lightweight per-product updates that must not go through the full upsert:
// niche monitoring settings and the "leads viewed" (mark-seen) timestamp.
export async function PATCH(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const database = db();
  if (!database) return Response.json({ persisted: false }, { status: 503 });
  const payload = (await request.json()) as {
    id?: string;
    markSeen?: boolean;
    monitoringEnabled?: boolean;
    monitoringSources?: string[];
  };
  const hasChange =
    payload.markSeen === true ||
    payload.monitoringEnabled !== undefined ||
    payload.monitoringSources !== undefined;
  if (!payload.id || !hasChange) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const existing = await database
    .prepare("SELECT id FROM products WHERE id=? AND workspace_id=?")
    .bind(payload.id, auth.workspaceId)
    .first();
  if (!existing) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const now = new Date().toISOString();
  const updates: string[] = [];
  const values: unknown[] = [];
  if (payload.monitoringEnabled !== undefined) {
    updates.push("monitoring_enabled=?");
    values.push(payload.monitoringEnabled ? 1 : 0);
  }
  let sources: string[] | undefined;
  if (payload.monitoringSources !== undefined) {
    sources = Array.isArray(payload.monitoringSources)
      ? payload.monitoringSources
          .filter((item): item is string => typeof item === "string")
          .filter((item) => monitoringSourceKeys.has(item))
          .slice(0, 8)
      : [];
    updates.push("monitoring_sources=?");
    // '' keeps the "inherit workspace agent sources" convention.
    values.push(sources.length ? JSON.stringify(sources) : "");
  }
  if (payload.markSeen === true) {
    updates.push("monitoring_last_seen_at=?");
    values.push(now);
  }
  // Deliberately no updated_at bump: mark-seen fires on every product view
  // and must not reshuffle the "recently updated" ordering the agent uses.
  await database
    .prepare(
      `UPDATE products SET ${updates.join(", ")} WHERE id=? AND workspace_id=?`,
    )
    .bind(...values, payload.id, auth.workspaceId)
    .run();
  return Response.json({
    persisted: true,
    ...(payload.markSeen === true ? { monitoringLastSeenAt: now } : {}),
    ...(payload.monitoringEnabled !== undefined
      ? { monitoringEnabled: Boolean(payload.monitoringEnabled) }
      : {}),
    ...(sources !== undefined ? { monitoringSources: sources } : {}),
  });
}

export async function DELETE(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const database = db();
  const id = new URL(request.url).searchParams.get("id");
  if (!database || !id) return Response.json({ error: "invalid_request" }, { status: 400 });
  await database.batch([
    database
      .prepare("DELETE FROM products WHERE id = ? AND workspace_id=?")
      .bind(id, auth.workspaceId),
    database
      .prepare("DELETE FROM outbound_messages WHERE product_id = ? AND workspace_id=?")
      .bind(id, auth.workspaceId),
    database
      .prepare("DELETE FROM prospects WHERE product_id = ? AND workspace_id=?")
      .bind(id, auth.workspaceId),
  ]);
  return Response.json({ persisted: true });
}
