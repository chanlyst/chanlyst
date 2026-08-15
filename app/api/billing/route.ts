import {
  billingBindings,
  checkoutBaseUrl,
  getWorkspaceSubscription,
  hasActiveAccess,
} from "../../lib/billing";
import {
  gumroadBindings,
  gumroadCheckoutUrl,
  isGumroadConfigured,
} from "../../lib/billing-gumroad";
import { isAuthResponse, publicUrl, requireApiSession } from "../../lib/auth";
import { isPlanId } from "../../lib/plans";
import { usageSnapshot } from "../../lib/usage-limits";

// Провайдер выбирается переменной окружения: пока Lemon Squeezy на модерации,
// оплату принимает Gumroad, и переключение обратно — это одна строка в конфиге.
function activeProvider(): "gumroad" | "lemon_squeezy" {
  const configured = String(gumroadBindings().BILLING_PROVIDER || "").toLowerCase();
  if (configured === "gumroad") return "gumroad";
  if (configured === "lemon_squeezy") return "lemon_squeezy";
  // Явного выбора нет — берём того, кто вообще настроен.
  return isGumroadConfigured() ? "gumroad" : "lemon_squeezy";
}

export async function GET(request: Request) {
  const session = await requireApiSession(request);
  if (isAuthResponse(session)) return session;
  const subscription = await getWorkspaceSubscription(session.workspaceId);
  const usage = await usageSnapshot(session.workspaceId);
  // Internal/founder workspaces report the unlimited plan regardless of any
  // subscription row, so the UI stops gating features behind billing.
  const unlimited = usage.plan === "unlimited";
  const provider = activeProvider();
  return Response.json({
    provider,
    configured:
      provider === "gumroad"
        ? isGumroadConfigured()
        : Boolean(billingBindings().LEMON_SQUEEZY_WEBHOOK_SECRET),
    plan: unlimited ? "unlimited" : subscription?.plan || "free",
    usage,
    active: unlimited || hasActiveAccess(subscription),
    subscription: subscription
      ? {
          status: subscription.status,
          variantName: subscription.variantName,
          renewsAt: subscription.renewsAt,
          endsAt: subscription.endsAt,
          cardBrand: subscription.cardBrand,
          cardLastFour: subscription.cardLastFour,
          portalUrl: subscription.portalUrl,
          updatePaymentUrl: subscription.updatePaymentUrl,
          testMode: Boolean(subscription.testMode),
        }
      : null,
  });
}

export async function POST(request: Request) {
  const session = await requireApiSession(request);
  if (isAuthResponse(session)) return session;
  const body = (await request.json().catch(() => ({}))) as {
    interval?: string;
    plan?: string;
  };
  const interval = body.interval === "annual" ? "annual" : "monthly";
  const plan = body.plan && isPlanId(body.plan) ? body.plan : "pro";

  if (activeProvider() === "gumroad") {
    const base = gumroadCheckoutUrl(plan, interval);
    if (!base) {
      return Response.json({ error: "checkout_not_configured" }, { status: 503 });
    }
    // Произвольные query-параметры Gumroad возвращает в вебхуке как url_params —
    // так покупка связывается с рабочим пространством.
    const checkout = new URL(base);
    checkout.searchParams.set("workspace_id", session.workspaceId);
    checkout.searchParams.set("user_id", session.userId);
    checkout.searchParams.set("wanted", "true");
    return Response.json({
      url: checkout.toString(),
      interval,
      plan,
      provider: "gumroad",
    });
  }

  const checkout = new URL(checkoutBaseUrl(plan, interval));
  checkout.searchParams.set(
    "checkout[custom][workspace_id]",
    session.workspaceId,
  );
  checkout.searchParams.set("checkout[custom][user_id]", session.userId);
  if (session.email) checkout.searchParams.set("checkout[email]", session.email);
  if (session.name) checkout.searchParams.set("checkout[name]", session.name);
  checkout.searchParams.set(
    "checkout[custom][return_url]",
    publicUrl(request, "/dashboard?checkout=success").toString(),
  );
  return Response.json({ url: checkout.toString(), interval, plan });
}
