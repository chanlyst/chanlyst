import {
  billingBindings,
  saveSubscriptionFromWebhook,
  verifyLemonSignature,
} from "../../../lib/billing";
import { sha256 } from "../../../lib/auth";

const subscriptionEvents = new Set([
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "subscription_resumed",
  "subscription_expired",
  "subscription_paused",
  "subscription_unpaused",
]);

export async function POST(request: Request) {
  if (!billingBindings().LEMON_SQUEEZY_WEBHOOK_SECRET) {
    return Response.json({ error: "billing_not_configured" }, { status: 503 });
  }
  const rawBody = await request.text();
  const valid = await verifyLemonSignature(
    rawBody,
    request.headers.get("x-signature"),
  );
  if (!valid) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as {
    meta?: {
      event_name?: string;
      test_mode?: boolean;
      custom_data?: Record<string, unknown>;
    };
    data?: {
      id?: string;
      type?: string;
      attributes?: Record<string, unknown>;
    };
  };
  const eventName =
    payload.meta?.event_name || request.headers.get("x-event-name") || "";
  if (!subscriptionEvents.has(eventName)) {
    return Response.json({ received: true, ignored: true });
  }
  const attributes = payload.data?.attributes || {};
  const testMode =
    payload.meta?.test_mode === true || attributes.test_mode === true;
  if (testMode && billingBindings().LEMONSQUEEZY_ALLOW_TEST_MODE !== "true") {
    console.warn("billing_webhook_skipped_test_mode", eventName);
    return Response.json({ received: true, skipped: "test_mode" });
  }
  const eventId =
    request.headers.get("x-event-id") ||
    (await sha256(
      `${eventName}:${payload.data?.id || ""}:${String(attributes.updated_at || "")}`,
    ));
  const database = billingBindings().DB;
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
  const saved = await saveSubscriptionFromWebhook(payload);
  return Response.json({ received: true, saved });
}
