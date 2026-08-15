import { useState } from "react";
import { planCatalog, type PlanId } from "../../lib/plans";
import type { Dictionary, Locale } from "../i18n";
import type { BillingData, BusyState } from "../types";

export default function BillingSection({
  t,
  locale,
  billingData,
  currentPlan,
  busy,
  startCheckout,
  formatBillingDate,
}: {
  t: Dictionary;
  locale: Locale;
  billingData: BillingData;
  currentPlan: (typeof planCatalog)[PlanId];
  busy: BusyState;
  startCheckout: (plan: PlanId, interval: "monthly" | "annual") => Promise<void>;
  formatBillingDate: (value?: string | null) => string;
}) {
  // Only the billing picker cares about the interval toggle, so it is local.
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual">("monthly");
  const unlimited = billingData.plan === "unlimited";
  const planLabel = unlimited
    ? locale === "ru" ? "Безлимит" : "Unlimited"
    : currentPlan.name;
  // Unlimited workspaces carry a sentinel ceiling; show ∞ instead of 1000000.
  const limitLabel = (limit: number) => (limit >= 1_000_000 ? "∞" : String(limit));
  return (
        <section className="panel billing-panel" id="billing">
          <div className="section-head">
            <div><div><h2>{t.billing}</h2><p>{t.billingHint}</p></div></div>
            <strong className={billingData.active ? "billing-active" : ""}>
              {billingData.active ? planLabel.toUpperCase() : "FREE"}
            </strong>
          </div>
          <div className="billing-layout">
            <div className="billing-summary">
              <span className="billing-mark">C</span>
              <div>
                <small>{t.currentPlan}</small>
                <h3>
                  {billingData.active
                    ? locale === "ru"
                      ? `${planLabel} активен`
                      : `${planLabel} is active`
                    : t.freePlan}
                </h3>
                {billingData.subscription?.testMode && <em>{t.testPlan}</em>}
                {billingData.subscription?.renewsAt && (
                  <p>{t.renewal}: <b>{formatBillingDate(billingData.subscription.renewsAt)}</b></p>
                )}
                {billingData.subscription?.endsAt && (
                  <p>{t.accessUntil}: <b>{formatBillingDate(billingData.subscription.endsAt)}</b></p>
                )}
                {billingData.subscription?.cardLastFour && (
                  <p>{billingData.subscription.cardBrand || "Card"} •••• {billingData.subscription.cardLastFour}</p>
                )}
              </div>
              {billingData.subscription?.portalUrl && (
                <a href={billingData.subscription.portalUrl} target="_blank" rel="noreferrer">
                  {t.manageBilling}
                </a>
              )}
            </div>
            {billingData.active && billingData.usage && (
              <div className="billing-usage">
                {[
                  {
                    label: locale === "ru" ? "Продукты" : "Products",
                    used: billingData.usage.used?.products || 0,
                    limit: billingData.usage.limits?.products || 0,
                  },
                  {
                    label: locale === "ru" ? "Каналы за месяц" : "Channels this month",
                    used: billingData.usage.used?.channelsThisMonth || 0,
                    limit: billingData.usage.limits?.channelsPerMonth || 0,
                  },
                  {
                    label:
                      locale === "ru" ? "Проверки контактов" : "Contact checks this month",
                    used: billingData.usage.used?.contactChecksThisMonth || 0,
                    limit: billingData.usage.limits?.contactChecksPerMonth || 0,
                  },
                  {
                    label: locale === "ru" ? "AI-запросы за месяц" : "AI requests this month",
                    used: billingData.usage.used?.aiMessagesThisMonth || 0,
                    limit: billingData.usage.limits?.aiMessagesPerMonth || 0,
                  },
                ].map((item) => (
                  <div key={item.label}>
                    <span><b>{item.label}</b><em>{item.used} / {limitLabel(item.limit)}</em></span>
                    <i><u style={{ width: `${unlimited ? 0 : Math.min(100, item.limit ? item.used / item.limit * 100 : 0)}%` }} /></i>
                  </div>
                ))}
              </div>
            )}
            {!billingData.active && (
              <div className="billing-picker">
                <div className="billing-cycle" role="group" aria-label={locale === "ru" ? "Период оплаты" : "Billing period"}>
                  <button className={billingInterval === "monthly" ? "active" : ""} onClick={() => setBillingInterval("monthly")}>
                    {locale === "ru" ? "Ежемесячно" : "Monthly"}
                  </button>
                  <button className={billingInterval === "annual" ? "active" : ""} onClick={() => setBillingInterval("annual")}>
                    {locale === "ru" ? "Ежегодно · 2 месяца бесплатно" : "Yearly · 2 months free"}
                  </button>
                </div>
                <div className="billing-options">
                  {Object.values(planCatalog).map((plan) => {
                    const price = billingInterval === "annual" ? plan.annualUsd : plan.monthlyUsd;
                    return (
                      <article className={plan.id === "pro" ? "recommended-plan" : ""} key={plan.id}>
                        {plan.id === "pro" && <span>{locale === "ru" ? "Популярный" : "Popular"}</span>}
                        <div>
                          <small>{plan.name}</small>
                          <h3>${price}</h3>
                          <p>
                            {plan.limits.products} {locale === "ru" ? "продуктов" : "products"} ·{" "}
                            {plan.limits.channelsPerMonth} {locale === "ru" ? "каналов" : "channels"} ·{" "}
                            {plan.limits.contactChecksPerMonth}{" "}
                            {locale === "ru" ? "проверок контактов" : "contact checks"}
                          </p>
                        </div>
                        <button
                          className={plan.id === "pro" ? "lime" : "dark"}
                          disabled={busy === "billing"}
                          onClick={() => startCheckout(plan.id as PlanId, billingInterval)}
                        >
                          {busy === "billing"
                            ? t.paymentOpening
                            : locale === "ru"
                              ? `Выбрать ${plan.name}`
                              : `Choose ${plan.name}`}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {!billingData.configured && <div className="setup-note"><strong>{t.billingNotReady}</strong></div>}
        </section>
  );
}
