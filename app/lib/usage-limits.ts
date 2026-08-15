import { env } from "cloudflare:workers";
import { freePlan, planCatalog, type PlanId } from "./plans";
import { hasPaidAccess } from "./subscription-access.mjs";

/**
 * "contactChecks" is split out from "aiMessages" because it is the expensive
 * one: a contact check costs roughly four times what a found channel does, and
 * while both shared a counter the cost of a plan could not be reasoned about.
 */
export type UsageKind = "products" | "channels" | "aiMessages" | "contactChecks";

// One definition, in the catalogue beside the paid plans, so the page that
// advertises the free tier and the code that enforces it cannot disagree.
const freeLimits = freePlan.limits;

// Effectively no limit; kept finite so arithmetic and JSON stay sane.
export const UNLIMITED = 1_000_000;

const unlimitedLimits = {
  products: UNLIMITED,
  channelsPerMonth: UNLIMITED,
  contactChecksPerMonth: UNLIMITED,
  aiMessagesPerMonth: UNLIMITED,
  workspaceMembers: UNLIMITED,
} as const;

/**
 * A self-hosted install has no plan to enforce.
 *
 * The limits exist to price the hosted service: every channel found and every
 * contact checked is an OpenRouter and Serper call billed to us. On someone
 * else's server they are billed to them, on their own API keys, and a free
 * tier of three products would be a limit with nothing behind it — the
 * licence lets them delete the check anyway, so leaving it in only teaches
 * them to patch the source before they can use it.
 *
 * Set SELF_HOST=1. The billing section hides itself separately, on whether a
 * payment provider is configured at all.
 */
function selfHosted() {
  const flag = String(
    (env as unknown as { SELF_HOST?: string }).SELF_HOST || "",
  ).toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

// Founder/internal workspaces exempt from plan limits, configured via the
// UNLIMITED_WORKSPACE_IDS env var (comma-separated workspace ids).
function unlimitedWorkspaceIds() {
  return String(
    (env as unknown as { UNLIMITED_WORKSPACE_IDS?: string })
      .UNLIMITED_WORKSPACE_IDS || "",
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function workspacePlan(workspaceId: string) {
  if (selfHosted() || unlimitedWorkspaceIds().includes(workspaceId)) {
    return { id: "unlimited" as const, limits: unlimitedLimits };
  }
  const db = database();
  if (!db) return { id: "free" as const, limits: freeLimits };
  // The row is read whatever its status, because "still paid for" is not a
  // status: a cancelled subscription keeps its plan until the period the
  // customer already paid for actually ends. That call is hasPaidAccess.
  const subscription = await db
    .prepare(
      `SELECT plan, status, ends_at AS endsAt, renews_at AS renewsAt
       FROM subscriptions WHERE workspace_id=?`,
    )
    .bind(workspaceId)
    .first<{
      plan?: string;
      status?: string;
      endsAt?: string | null;
      renewsAt?: string | null;
    }>();
  const id =
    subscription?.plan &&
    subscription.plan in planCatalog &&
    hasPaidAccess(subscription)
      ? (subscription.plan as PlanId)
      : "free";
  return {
    id,
    limits: id === "free" ? freeLimits : planCatalog[id].limits,
  };
}

export async function usageSnapshot(workspaceId: string) {
  const db = database();
  const plan = await workspacePlan(workspaceId);
  if (!db) {
    return {
      plan: plan.id,
      limits: plan.limits,
      used: {
        products: 0,
        channelsThisMonth: 0,
        contactChecksThisMonth: 0,
        aiMessagesThisMonth: 0,
      },
    };
  }
  const since = monthStart();
  const [products, channels, contactChecks, aiMessages] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) as count FROM products WHERE workspace_id=?")
      .bind(workspaceId)
      .first<{ count?: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) as count FROM prospects
         WHERE workspace_id=? AND created_at>=? AND origin<>'curated'
           AND record_kind='channel'`,
      )
      .bind(workspaceId, since)
      .first<{ count?: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) as count FROM ai_usage
         WHERE workspace_id=? AND operation='contact_enrichment'
         AND outcome <> 'error' AND created_at>=?`,
      )
      .bind(workspaceId, since)
      .first<{ count?: number }>(),
    db
      .prepare(
        // Failed provider calls are recorded for spend reporting but must not
        // eat the customer's plan quota. Contact checks have their own counter
        // above and are deliberately not counted twice.
        `SELECT COUNT(*) as count FROM ai_usage
         WHERE workspace_id=? AND operation IN ('analyze', 'outreach', 'prefill')
         AND outcome <> 'error' AND created_at>=?`,
      )
      .bind(workspaceId, since)
      .first<{ count?: number }>(),
  ]);
  return {
    plan: plan.id,
    limits: plan.limits,
    used: {
      products: Number(products?.count || 0),
      channelsThisMonth: Number(channels?.count || 0),
      contactChecksThisMonth: Number(contactChecks?.count || 0),
      aiMessagesThisMonth: Number(aiMessages?.count || 0),
    },
  };
}

export async function enforceUsageLimit(
  workspaceId: string,
  kind: UsageKind,
  options: { isNewProduct?: boolean; count?: number } = {},
) {
  const count = Math.max(0, Math.round(Number(options.count ?? 1)));
  const snapshot = await usageSnapshot(workspaceId);
  const limit = {
    products: snapshot.limits.products,
    channels: snapshot.limits.channelsPerMonth,
    contactChecks: snapshot.limits.contactChecksPerMonth,
    aiMessages: snapshot.limits.aiMessagesPerMonth,
  }[kind];
  const used = {
    products: snapshot.used.products,
    channels: snapshot.used.channelsThisMonth,
    contactChecks: snapshot.used.contactChecksThisMonth,
    aiMessages: snapshot.used.aiMessagesThisMonth,
  }[kind];
  const consumes = kind !== "products" || options.isNewProduct !== false;
  const allowed = !consumes || used + count <= limit;
  return {
    allowed,
    plan: snapshot.plan,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    response: allowed
      ? null
      : Response.json(
          {
            error: "plan_limit_reached",
            resource: kind,
            plan: snapshot.plan,
            limit,
            used,
          },
          { status: 402 },
        ),
  };
}
