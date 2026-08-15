import { env } from "cloudflare:workers";
import type { PlanId } from "./plans";
import { hasPaidAccess } from "./subscription-access.mjs";

type BillingBindings = {
  DB?: D1Database;
  LEMON_SQUEEZY_WEBHOOK_SECRET?: string;
  LEMONSQUEEZY_ALLOW_TEST_MODE?: string;
  LEMON_SQUEEZY_API_KEY?: string;
  LEMON_SQUEEZY_STARTER_MONTHLY_CHECKOUT_URL?: string;
  LEMON_SQUEEZY_STARTER_ANNUAL_CHECKOUT_URL?: string;
  LEMON_SQUEEZY_MONTHLY_CHECKOUT_URL?: string;
  LEMON_SQUEEZY_ANNUAL_CHECKOUT_URL?: string;
  LEMON_SQUEEZY_SCALE_MONTHLY_CHECKOUT_URL?: string;
  LEMON_SQUEEZY_SCALE_ANNUAL_CHECKOUT_URL?: string;
};

export type SubscriptionRecord = {
  workspaceId: string;
  customerId: string;
  subscriptionId: string;
  orderId: string;
  productId: string;
  variantId: string;
  variantName: string;
  status: string;
  plan: string;
  renewsAt: string | null;
  endsAt: string | null;
  trialEndsAt: string | null;
  cardBrand: string;
  cardLastFour: string;
  portalUrl: string;
  updatePaymentUrl: string;
  testMode: number | boolean;
  createdAt: string;
  updatedAt: string;
};

const TEST_CHECKOUT_BASE =
  "https://chanlyst.lemonsqueezy.com/checkout/buy/49f5608a-8c81-468b-95cf-9d840f694d1f";
const TEST_VARIANTS: Record<PlanId, Record<"monthly" | "annual", string>> = {
  starter: { monthly: "1945361", annual: "1945553" },
  pro: { monthly: "1945357", annual: "1945354" },
  scale: { monthly: "1945555", annual: "1945558" },
};

export function billingBindings() {
  return env as unknown as BillingBindings;
}

export function checkoutBaseUrl(
  plan: PlanId,
  interval: "monthly" | "annual",
) {
  const bindings = billingBindings();
  const configured: Record<
    PlanId,
    Record<"monthly" | "annual", string | undefined>
  > = {
    starter: {
      monthly: bindings.LEMON_SQUEEZY_STARTER_MONTHLY_CHECKOUT_URL,
      annual: bindings.LEMON_SQUEEZY_STARTER_ANNUAL_CHECKOUT_URL,
    },
    pro: {
      monthly: bindings.LEMON_SQUEEZY_MONTHLY_CHECKOUT_URL,
      annual: bindings.LEMON_SQUEEZY_ANNUAL_CHECKOUT_URL,
    },
    scale: {
      monthly: bindings.LEMON_SQUEEZY_SCALE_MONTHLY_CHECKOUT_URL,
      annual: bindings.LEMON_SQUEEZY_SCALE_ANNUAL_CHECKOUT_URL,
    },
  };
  return (
    configured[plan][interval] ||
    `${TEST_CHECKOUT_BASE}?enabled=${TEST_VARIANTS[plan][interval]}`
  );
}

export function hasActiveAccess(
  subscription: Pick<SubscriptionRecord, "status" | "endsAt"> | null,
) {
  return hasPaidAccess(subscription);
}

export async function getWorkspaceSubscription(workspaceId: string) {
  const database = billingBindings().DB;
  if (!database) throw new Error("database_unavailable");
  return database
    .prepare(
      `SELECT workspace_id as workspaceId, customer_id as customerId,
       subscription_id as subscriptionId, order_id as orderId,
       product_id as productId, variant_id as variantId,
       variant_name as variantName, status, plan, renews_at as renewsAt,
       ends_at as endsAt, trial_ends_at as trialEndsAt,
       card_brand as cardBrand, card_last_four as cardLastFour,
       portal_url as portalUrl, update_payment_url as updatePaymentUrl,
       test_mode as testMode, created_at as createdAt, updated_at as updatedAt
       FROM subscriptions WHERE workspace_id=? LIMIT 1`,
    )
    .bind(workspaceId)
    .first<SubscriptionRecord>();
}

function safeString(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export function planFromVariantName(value: unknown): PlanId {
  const name = safeString(value).toLowerCase();
  if (name.includes("starter")) return "starter";
  if (name.includes("scale")) return "scale";
  return "pro";
}

export async function saveSubscriptionFromWebhook(payload: {
  meta?: {
    custom_data?: Record<string, unknown>;
  };
  data?: {
    id?: string;
    type?: string;
    attributes?: Record<string, unknown>;
  };
}) {
  const database = billingBindings().DB;
  if (!database) throw new Error("database_unavailable");

  const attributes = payload.data?.attributes || {};
  let workspaceId = safeString(payload.meta?.custom_data?.workspace_id);
  const subscriptionId = safeString(payload.data?.id);

  if (!workspaceId && subscriptionId) {
    const existing = await database
      .prepare(
        "SELECT workspace_id as workspaceId FROM subscriptions WHERE subscription_id=? LIMIT 1",
      )
      .bind(subscriptionId)
      .first<{ workspaceId?: string }>();
    workspaceId = existing?.workspaceId || "";
  }
  if (!workspaceId || !subscriptionId) return false;
  // custom_data is attacker-influenced: only apply the subscription to a
  // workspace that actually exists.
  const workspace = await database
    .prepare("SELECT id FROM workspaces WHERE id=? LIMIT 1")
    .bind(workspaceId)
    .first<{ id?: string }>();
  if (!workspace?.id) return false;

  const now = new Date().toISOString();
  const urls =
    attributes.urls && typeof attributes.urls === "object"
      ? (attributes.urls as Record<string, unknown>)
      : {};
  const plan = planFromVariantName(attributes.variant_name);
  await database
    .prepare(
      `INSERT INTO subscriptions
       (workspace_id, provider, customer_id, subscription_id, order_id,
        product_id, variant_id, variant_name, status, plan, renews_at, ends_at,
        trial_ends_at, card_brand, card_last_four, portal_url,
        update_payment_url, test_mode, created_at, updated_at)
       VALUES (?, 'lemon_squeezy', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
       customer_id=excluded.customer_id,
       subscription_id=excluded.subscription_id,
       order_id=excluded.order_id,
       product_id=excluded.product_id,
       variant_id=excluded.variant_id,
       variant_name=excluded.variant_name,
       status=excluded.status,
       plan=excluded.plan,
       renews_at=excluded.renews_at,
       ends_at=excluded.ends_at,
       trial_ends_at=excluded.trial_ends_at,
       card_brand=excluded.card_brand,
       card_last_four=excluded.card_last_four,
       portal_url=excluded.portal_url,
       update_payment_url=excluded.update_payment_url,
       test_mode=excluded.test_mode,
       updated_at=excluded.updated_at`,
    )
    .bind(
      workspaceId,
      safeString(attributes.customer_id),
      subscriptionId,
      safeString(attributes.order_id),
      safeString(attributes.product_id),
      safeString(attributes.variant_id),
      safeString(attributes.variant_name),
      safeString(attributes.status) || "inactive",
      plan,
      attributes.renews_at ? safeString(attributes.renews_at) : null,
      attributes.ends_at ? safeString(attributes.ends_at) : null,
      attributes.trial_ends_at ? safeString(attributes.trial_ends_at) : null,
      safeString(attributes.card_brand),
      safeString(attributes.card_last_four),
      safeString(urls.customer_portal),
      safeString(urls.update_payment_method),
      attributes.test_mode === false ? 0 : 1,
      now,
      now,
    )
    .run();
  return true;
}

function toHex(bytes: Uint8Array) {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyLemonSignature(
  body: string,
  signature: string | null,
) {
  const secret = billingBindings().LEMON_SQUEEZY_WEBHOOK_SECRET || "";
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  const expected = toHex(digest);
  const actual = signature.trim().toLowerCase();
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}
