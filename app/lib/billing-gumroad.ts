import { env } from "cloudflare:workers";
import type { PlanId } from "./plans";
import {
  firstString,
  planFromPermalink as planFromPermalinkCore,
  resolvePlan,
  statusFromResource as statusFromResourceCore,
} from "./billing-gumroad-core.mjs";

// Gumroad как второй провайдер оплаты. Ключевое отличие от Lemon Squeezy:
// Gumroad Ping приходит БЕЗ подписи (в их API-документации подписи нет вовсе),
// поэтому телу вебхука доверять нельзя. Схема защиты двухслойная:
//   1) секрет в самом URL вебхука (Gumroad позволяет задать произвольный post_url);
//   2) обратная проверка через API Gumroad нашим access token — только ответ API
//      считается источником правды о статусе и суммах.
type GumroadBindings = {
  DB?: D1Database;
  BILLING_PROVIDER?: string;
  GUMROAD_ACCESS_TOKEN?: string;
  GUMROAD_SELLER_ID?: string;
  GUMROAD_WEBHOOK_TOKEN?: string;
  GUMROAD_STARTER_MONTHLY_URL?: string;
  GUMROAD_STARTER_ANNUAL_URL?: string;
  GUMROAD_PRO_MONTHLY_URL?: string;
  GUMROAD_PRO_ANNUAL_URL?: string;
  GUMROAD_SCALE_MONTHLY_URL?: string;
  GUMROAD_SCALE_ANNUAL_URL?: string;
};

export type BillingInterval = "monthly" | "annual";

const API = "https://api.gumroad.com/v2";

export function gumroadBindings() {
  return env as unknown as GumroadBindings;
}

export function isGumroadConfigured() {
  const bindings = gumroadBindings();
  return Boolean(bindings.GUMROAD_ACCESS_TOKEN && bindings.GUMROAD_WEBHOOK_TOKEN);
}

function checkoutUrls(): Record<PlanId, Record<BillingInterval, string | undefined>> {
  const bindings = gumroadBindings();
  return {
    starter: {
      monthly: bindings.GUMROAD_STARTER_MONTHLY_URL,
      annual: bindings.GUMROAD_STARTER_ANNUAL_URL,
    },
    pro: {
      monthly: bindings.GUMROAD_PRO_MONTHLY_URL,
      annual: bindings.GUMROAD_PRO_ANNUAL_URL,
    },
    scale: {
      monthly: bindings.GUMROAD_SCALE_MONTHLY_URL,
      annual: bindings.GUMROAD_SCALE_ANNUAL_URL,
    },
  };
}

export function gumroadCheckoutUrl(plan: PlanId, interval: BillingInterval) {
  return checkoutUrls()[plan][interval] || "";
}

export function planFromPermalink(permalink: string) {
  return planFromPermalinkCore(permalink, checkoutUrls()) as
    | { plan: PlanId; interval: BillingInterval }
    | null;
}

export type GumroadSale = {
  id?: string;
  seller_id?: string;
  email?: string;
  product_id?: string;
  product_name?: string;
  product_permalink?: string;
  order_id?: number | string;
  subscription_id?: string;
  subscription_duration?: string;
  refunded?: boolean;
  partially_refunded?: boolean;
  chargedback?: boolean;
  disputed?: boolean;
  dispute_won?: boolean;
  cancelled?: boolean;
  ended?: boolean;
  access_revoked?: boolean;
  variants?: Record<string, string>;
  [key: string]: unknown;
};

async function gumroadGet(path: string) {
  const token = gumroadBindings().GUMROAD_ACCESS_TOKEN;
  if (!token) return null;
  const response = await fetch(
    `${API}${path}?access_token=${encodeURIComponent(token)}`,
    { method: "GET" },
  );
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as
    | { success?: boolean; sale?: GumroadSale; subscriber?: Record<string, unknown> }
    | null;
  if (!payload?.success) return null;
  return payload;
}

// Источник правды о продаже — ответ API, а не тело вебхука.
export async function fetchSale(saleId: string) {
  if (!saleId) return null;
  const payload = await gumroadGet(`/sales/${encodeURIComponent(saleId)}`);
  return (payload?.sale as GumroadSale | undefined) || null;
}

export async function fetchSubscriber(subscriptionId: string) {
  if (!subscriptionId) return null;
  const payload = await gumroadGet(
    `/subscribers/${encodeURIComponent(subscriptionId)}`,
  );
  return (payload?.subscriber as Record<string, unknown> | undefined) || null;
}

export function sellerMatches(sale: Pick<GumroadSale, "seller_id">) {
  const expected = gumroadBindings().GUMROAD_SELLER_ID || "";
  if (!expected) return true; // не задан — не блокируем, но и не проверяем
  return String(sale.seller_id || "") === expected;
}

export function statusFromResource(resource: string, sale: GumroadSale | null): string {
  return statusFromResourceCore(resource, sale);
}

export async function saveGumroadSubscription(input: {
  resource: string;
  workspaceId: string;
  sale: GumroadSale | null;
  subscriptionId: string;
}) {
  const database = gumroadBindings().DB;
  if (!database) throw new Error("database_unavailable");

  const status = statusFromResource(input.resource, input.sale);
  if (!status) return false;

  let workspaceId = input.workspaceId;
  if (!workspaceId && input.subscriptionId) {
    const existing = await database
      .prepare(
        "SELECT workspace_id as workspaceId FROM subscriptions WHERE subscription_id=? LIMIT 1",
      )
      .bind(input.subscriptionId)
      .first<{ workspaceId?: string }>();
    workspaceId = existing?.workspaceId || "";
  }
  if (!workspaceId) return false;

  // workspace_id приходит из URL-параметров чекаута, то есть управляется
  // покупателем: применяем подписку только к существующему рабочему пространству.
  const workspace = await database
    .prepare("SELECT id FROM workspaces WHERE id=? LIMIT 1")
    .bind(workspaceId)
    .first<{ id?: string }>();
  if (!workspace?.id) return false;

  const sale = input.sale || {};
  const mapped = planFromPermalink(String(sale.product_permalink || ""));
  // Which plan the workspace is already on. Cancellation and subscription
  // pings arrive with only a subscription id — no permalink to map — and
  // defaulting those to "pro" silently upgraded Starter customers and
  // downgraded Scale ones. An event that says nothing about the plan must not
  // change it.
  const stored = await database
    .prepare("SELECT plan FROM subscriptions WHERE workspace_id=? LIMIT 1")
    .bind(workspaceId)
    .first<{ plan?: string }>();
  const plan = resolvePlan(mapped, stored?.plan);
  const subscriber = input.subscriptionId
    ? await fetchSubscriber(input.subscriptionId)
    : null;
  const renewsAt = firstString(subscriber, [
    "charge_occurrence_at",
    "next_charge_at",
    "renews_at",
  ]);
  const endsAt = firstString(subscriber, [
    "ended_at",
    "cancelled_at",
    "user_requested_cancellation_at",
  ]);
  const trialEndsAt = firstString(subscriber, ["free_trial_ends_at"]);
  const now = new Date().toISOString();

  await database
    .prepare(
      `INSERT INTO subscriptions
       (workspace_id, provider, customer_id, subscription_id, order_id,
        product_id, variant_id, variant_name, status, plan, renews_at, ends_at,
        trial_ends_at, card_brand, card_last_four, portal_url,
        update_payment_url, test_mode, created_at, updated_at)
       VALUES (?, 'gumroad', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', '', 0, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
       provider='gumroad',
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
       test_mode=excluded.test_mode,
       updated_at=excluded.updated_at`,
    )
    .bind(
      workspaceId,
      String(sale.email || ""),
      input.subscriptionId,
      String(sale.order_id ?? ""),
      String(sale.product_id || ""),
      String(sale.product_permalink || ""),
      String(sale.product_name || ""),
      status,
      plan,
      renewsAt,
      endsAt,
      trialEndsAt,
      now,
      now,
    )
    .run();
  return true;
}
