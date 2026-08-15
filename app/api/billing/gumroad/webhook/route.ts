import {
  fetchSale,
  gumroadBindings,
  isGumroadConfigured,
  saveGumroadSubscription,
  sellerMatches,
  type GumroadSale,
} from "../../../../lib/billing-gumroad";
import { constantTimeEquals } from "../../../../lib/billing-gumroad-core.mjs";
import { sha256 } from "../../../../lib/auth";

// Gumroad Ping не подписывает запросы, поэтому подлинность подтверждается
// секретом в URL плюс обратной проверкой продажи через API Gumroad.
const resources = new Set([
  "sale",
  "refund",
  "dispute",
  "dispute_won",
  "cancellation",
  "subscription_updated",
  "subscription_ended",
  "subscription_restarted",
]);

export async function POST(request: Request) {
  const bindings = gumroadBindings();
  if (!isGumroadConfigured()) {
    return Response.json({ error: "billing_not_configured" }, { status: 503 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  if (!constantTimeEquals(token, bindings.GUMROAD_WEBHOOK_TOKEN || "")) {
    return Response.json({ error: "invalid_token" }, { status: 401 });
  }

  // Ping приходит form-urlencoded; вложенные поля выглядят как url_params[workspace_id].
  const rawBody = await request.text();
  const form = new URLSearchParams(rawBody);

  // Ресурс передаётся Gumroad в поле resource_name; путь оставлен запасным вариантом.
  const resource =
    form.get("resource_name") || url.searchParams.get("resource") || "sale";
  if (!resources.has(resource)) {
    return Response.json({ received: true, ignored: true });
  }

  const saleId = form.get("sale_id") || form.get("id") || "";
  const subscriptionId = form.get("subscription_id") || "";
  if (!saleId && !subscriptionId) {
    return Response.json({ received: true, ignored: "no_identifier" });
  }

  // Телу вебхука не доверяем: подтверждаем продажу у Gumroad собственным токеном.
  let sale: GumroadSale | null = saleId ? await fetchSale(saleId) : null;
  if (saleId && !sale) {
    return Response.json({ error: "sale_not_found" }, { status: 202 });
  }
  if (sale && !sellerMatches(sale)) {
    return Response.json({ error: "seller_mismatch" }, { status: 401 });
  }
  if (!sale && subscriptionId) {
    sale = { subscription_id: subscriptionId };
  }

  const eventId = await sha256(
    `gumroad:${resource}:${saleId || subscriptionId}`,
  );
  const database = bindings.DB;
  if (database) {
    const inserted = await database
      .prepare(
        `INSERT INTO billing_webhook_events (id, created_at)
         VALUES (?, ?) ON CONFLICT(id) DO NOTHING`,
      )
      .bind(eventId.slice(0, 200), new Date().toISOString())
      .run();
    if (!inserted.meta.changes) {
      return Response.json({ received: true, duplicate: true });
    }
  }

  const saved = await saveGumroadSubscription({
    resource,
    workspaceId: form.get("url_params[workspace_id]") || "",
    sale,
    subscriptionId: subscriptionId || String(sale?.subscription_id || ""),
  });
  return Response.json({ received: true, saved });
}
