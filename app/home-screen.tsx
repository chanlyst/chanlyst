"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PublicHeader, {
  DEFAULT_PUBLIC_LOCALE,
  type PublicLocale,
} from "./components/public-header";
import { freePlan, planCatalog } from "./lib/plans";
import { FAQ } from "./lib/faq.mjs";
import { BrandMark } from "./components/brand-mark";
import AnalyticsConsent from "./components/analytics-consent";
import PageEvents from "./components/page-events";
import AcquisitionPreview from "./components/acquisition-preview";

const copy = {
  ru: {
    start: "Начать бесплатно — без карты",
    featuresEyebrow: "Возможности",
    featuresTitle: "Один рабочий процесс вместо десятка разрозненных инструментов",
    features: [
      ["✦", "Анализ любого продукта", "Добавьте SaaS, агентство, приложение или локальный бизнес. Chanlyst определит аудиторию, исключения и коммерческую воронку."],
      ["◎", "Поиск каналов", "Система ищет владельцев нужной аудитории, а не просто похожие компании, и ранжирует результаты по потенциальной эффективности."],
      ["↗", "Персональный аутрич", "Для каждого одобренного контакта создаётся сообщение с учётом продукта, площадки и предлагаемой партнёрской модели."],
      ["◱", "Учёт размещений", "Каждая подача проходит стадии от заявки до публикации. Видно, где ждут ответа, где опубликовали и откуда пришли переходы."],
    ],
    processEyebrow: "Как работает",
    processTitle: "Четыре шага до первого разговора",
    steps: [
      ["Добавьте продукт", "Укажите сайт, монетизацию, географию и событие, которое считается платной конверсией."],
      ["Получите стратегию", "AI формирует профиль аудитории, исключает нерелевантные сегменты и выбирает каналы."],
      ["Проверьте площадки", "Откройте найденные источники, изучите объяснение и одобрите только подходящие."],
      ["Отправьте сообщение", "Письмо уходит из вашего Gmail по вашему клику. Для LinkedIn текст готов и диалог открыт — отправляете вы сами, из своего аккаунта."],
    ],
    // Two cards became one. Not owning the user's accounts is the single real
    // differentiator here — Dux-Soup charges $14.99–99 a month for exactly it —
    // and stated six times over it read as anxiety rather than confidence.
    complianceTitle: "Ваши аккаунты остаются вашими",
    complianceText:
      "Площадки блокируют инструменты, которые водят чужие аккаунты со своей инфраструктуры — через облачные прокси и браузерную автоматизацию. Chanlyst так не устроен. Письма уходят из вашего Gmail по вашему клику; в LinkedIn мы готовим текст и открываем диалог, отправляете вы сами, из своей сессии. Ни ботов, ни прокси, ни фоновой автоматизации. Chanlyst не продаёт базы контактов и не делает скрытых массовых рассылок: частоту и содержание определяете вы, и отвечаете за них тоже вы.",
    pricingEyebrow: "Прозрачные тарифы",
    pricingTitle: "Цена привязана к полезной работе агента",
    pricingNote: "Pro и Scale — для тех, кто ведёт несколько продуктов: студий, агентств и серийных основателей.",
    monthlyLabel: "Ежемесячно",
    annualLabel: "Ежегодно",
    annualSaving: "2 месяца бесплатно",
    monthlyUnit: "в месяц",
    annualUnit: "в год",
    monthlyDetail: "Помесячная оплата, отмена в любое время",
    annualDetail: (price: number, effective: string) => `$${price} в год · $${effective} в среднем за месяц`,
    available: "Доступен сейчас",
    comingSoon: "Скоро",
    chooseAvailable: "Начать работу",
    chooseComingSoon: "Сообщить о запуске",
    freeBadge: "Без карты",
    freeUnit: "навсегда",
    // Says the quiet part out loud: this is not a trial that runs out.
    freeDetail: "Не пробный период — лимиты просто обновляются каждый месяц",
    chooseFree: "Начать бесплатно",
    faqEyebrow: "Вопросы",
    faqTitle: "Коротко о главном",
    faq: FAQ.ru,
    finalTitle: "Превратите исследование рынка в понятный список действий.",
    finalText: "Добавьте продукт, проверьте стратегию и найдите первые релевантные каналы.",
    footer: "AI-assisted prospect research and human-approved outreach.",
  },
  en: {
    start: "Start free — no card",
    featuresEyebrow: "Capabilities",
    featuresTitle: "One workflow instead of a stack of disconnected tools",
    features: [
      ["✦", "Analyze any product", "Add a SaaS, agency, application or local business. Chanlyst defines the audience, exclusions and commercial funnel."],
      ["◎", "Discover channels", "Find owners of the right audience—not merely similar companies—and rank them by theoretical acquisition potential."],
      ["↗", "Personalized outreach", "Draft a tailored message for every approved prospect based on the product, channel and proposed partnership model."],
      ["◱", "Placement tracking", "Every submission moves through stages from sent to published. You can see what is waiting, what went live and where the clicks came from."],
    ],
    processEyebrow: "How it works",
    processTitle: "Four steps to the first conversation",
    steps: [
      ["Add a product", "Provide the website, monetization, geography and the event that counts as a paid conversion."],
      ["Get a strategy", "AI builds the audience profile, excludes irrelevant segments and prioritizes channels."],
      ["Review prospects", "Open the original sources, read the fit explanation and approve only relevant opportunities."],
      ["Send a message", "Email goes out from your own Gmail on your click. For LinkedIn the draft is ready and the chat is open — you send it yourself, from your own account."],
    ],
    complianceTitle: "Your accounts stay yours",
    complianceText:
      "Platforms ban tools that drive other people's accounts from their own infrastructure — cloud proxies and headless browsers. Chanlyst is not built that way. Email leaves from your own Gmail on your click; on LinkedIn we prepare the text and open the conversation, and you send it yourself from your own session. No bots, no proxies, no background automation. Chanlyst does not sell contact databases and does not run hidden bulk campaigns: you decide the frequency and the content, and you carry the responsibility for both.",
    pricingEyebrow: "Transparent pricing",
    pricingTitle: "Pricing follows the useful work your agent performs",
    pricingNote: "Pro and Scale are for people running several products — studios, agencies and serial founders.",
    monthlyLabel: "Monthly",
    annualLabel: "Yearly",
    annualSaving: "2 months free",
    monthlyUnit: "per month",
    annualUnit: "per year",
    monthlyDetail: "Monthly billing, cancel at any time",
    annualDetail: (price: number, effective: string) => `$${price} per year · $${effective} effective monthly`,
    available: "Available now",
    comingSoon: "Coming soon",
    chooseAvailable: "Get started",
    chooseComingSoon: "Notify me at launch",
    freeBadge: "No card",
    freeUnit: "forever",
    // Says the quiet part out loud: this is not a trial that runs out.
    freeDetail: "Not a trial — the allowance simply resets every month",
    chooseFree: "Start free",
    faqEyebrow: "Questions",
    faqTitle: "The essentials",
    faq: FAQ.en,
    finalTitle: "Turn market research into a clear list of actions.",
    finalText: "Add your product, review the strategy and find your first relevant acquisition channels.",
    footer: "AI-assisted prospect research and human-approved outreach.",
  },
} as const;

export default function HomeScreen({
  loginHref = "/login",
  source = "",
  campaign = "",
}: {
  loginHref?: string;
  source?: string;
  campaign?: string;
}) {
  const [locale, setLocale] = useState<PublicLocale>(DEFAULT_PUBLIC_LOCALE);
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("monthly");
  const t = copy[locale];
  // Free first: it is the entry price, and until now the page did not admit it
  // existed — the cheapest thing on offer read as $49 while the product had
  // been letting people in for nothing.
  const plans = [freePlan, ...Object.values(planCatalog)];

  useEffect(() => {
    const saved = window.localStorage.getItem("signalist-public-locale");
    if (saved !== "ru" && saved !== "en") return;
    const timer = window.setTimeout(() => setLocale(saved), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function chooseLocale(next: PublicLocale) {
    setLocale(next);
    window.localStorage.setItem("signalist-public-locale", next);
  }

  /**
   * The bullet list under a plan, read from the limits the app enforces.
   *
   * It used to be hand-written copy, and it had drifted: the page promised Pro
   * 500 channels where the catalogue allows 300, and Scale five seats where it
   * allows ten. Selling more than the product delivers is how a refund starts,
   * so the numbers now come from the same place the limiter reads.
   */
  function planFeatures(limits: typeof freePlan.limits) {
    const n = (value: number) => value.toLocaleString(locale === "ru" ? "ru-RU" : "en-US");
    return locale === "ru"
      ? [
          `${limits.products} ${limits.products === 1 ? "активный продукт" : "активных продукта"}`,
          `${n(limits.channelsPerMonth)} каналов в месяц`,
          `${n(limits.contactChecksPerMonth)} проверок контактов в месяц`,
          `${limits.workspaceMembers} ${limits.workspaceMembers === 1 ? "место" : "мест"} в команде`,
        ]
      : [
          `${limits.products} active product${limits.products === 1 ? "" : "s"}`,
          `${n(limits.channelsPerMonth)} channels a month`,
          `${n(limits.contactChecksPerMonth)} contact checks a month`,
          `${limits.workspaceMembers} seat${limits.workspaceMembers === 1 ? "" : "s"}`,
        ];
  }

  function effectiveMonthlyPrice(annualPrice: number) {
    return (annualPrice / 12).toFixed(2).replace(/\.00$/, "");
  }

  return (
    <main className="marketing">
      <a className="skip-link" href="#features">
        {locale === "ru" ? "Перейти к содержимому" : "Skip to content"}
      </a>
      <PublicHeader locale={locale} onLocaleChange={chooseLocale} loginHref={loginHref} conversion />
      {/* Only the marketing page asks and only the marketing page is recorded:
          the dashboard holds customers’ channels and contacts, and none of the
          questions we have are about that screen. */}
      <AnalyticsConsent locale={locale} />
      <PageEvents path="/" source={source} campaign={campaign} />

      <AcquisitionPreview locale={locale} loginHref={loginHref} />

      <section className="marketing-section" id="features">
        <p className="section-kicker">{t.featuresEyebrow}</p>
        <h2>{t.featuresTitle}</h2>
        <div className="feature-grid">
          {t.features.map(([icon, title, detail]) => <article key={title}><span aria-hidden="true">{icon}</span><h3>{title}</h3><p>{detail}</p></article>)}
        </div>
      </section>

      {/* The two columns are their own grid, and the card sits below it rather
          than inside it. The heading is sticky, and a sticky grid item is not
          held to its row here — it slid down over the card once the second card
          was removed and the section got shorter. Nesting the grid gives the
          heading a container that ends where the columns end. */}
      <section className="process-section" id="process">
        <div className="process-grid">
          <div className="process-copy"><p className="section-kicker">{t.processEyebrow}</p><h2>{t.processTitle}</h2></div>
          <div className="process-list">
            {t.steps.map(([title, detail], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{title}</h3><p>{detail}</p></div></article>)}
          </div>
        </div>
        <aside className="compliance-card"><span aria-hidden="true">◎</span><div><h3>{t.complianceTitle}</h3><p>{t.complianceText}</p></div></aside>
      </section>

      <section className="marketing-section pricing-section" id="pricing">
        <p className="section-kicker">{t.pricingEyebrow}</p>
        <h2>{t.pricingTitle}</h2>
        <p className="section-note">{t.pricingNote}</p>
        <div className="pricing-switch" role="group" aria-label={locale === "ru" ? "Период оплаты" : "Billing period"}>
          <button
            type="button"
            className={billingPeriod === "monthly" ? "active" : ""}
            aria-pressed={billingPeriod === "monthly"}
            onClick={() => setBillingPeriod("monthly")}
          >
            {t.monthlyLabel}
          </button>
          <button
            type="button"
            className={billingPeriod === "annual" ? "active" : ""}
            aria-pressed={billingPeriod === "annual"}
            onClick={() => setBillingPeriod("annual")}
          >
            {t.annualLabel}<span>{t.annualSaving}</span>
          </button>
        </div>
        <div className="pricing-grid">
          {plans.map((plan) => {
            const free = plan.id === "free";
            const annual = billingPeriod === "annual" && !free;
            return (
              <article className={plan.id === "pro" ? "featured" : ""} key={plan.id}>
                <span className={`popular ${plan.available ? "" : "muted"}`}>
                  {free ? t.freeBadge : plan.available ? t.available : t.comingSoon}
                </span>
                <h3>{plan.name}</h3>
                <div className="price">
                  <b key={`${plan.id}-${billingPeriod}`}>${annual ? plan.annualUsd : plan.monthlyUsd}</b>
                  <small>{free ? t.freeUnit : annual ? t.annualUnit : t.monthlyUnit}</small>
                </div>
                <p>
                  {free
                    ? t.freeDetail
                    : annual
                      ? t.annualDetail(plan.annualUsd, effectiveMonthlyPrice(plan.annualUsd))
                      : t.monthlyDetail}
                </p>
                <ul>{planFeatures(plan.limits).map((item) => <li key={item}><span aria-hidden="true">✓</span> {item}</li>)}</ul>
                <Link href={plan.available ? loginHref : "/contact"} data-track="pricing_cta">
                  {free ? t.chooseFree : plan.available ? t.chooseAvailable : t.chooseComingSoon}
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section className="faq-section">
        <div><p className="section-kicker">{t.faqEyebrow}</p><h2>{t.faqTitle}</h2></div>
        <div className="faq-list">{t.faq.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">＋</span></summary><p>{answer}</p></details>)}</div>
      </section>

      <section className="final-cta"><div><h2>{t.finalTitle}</h2><p>{t.finalText}</p></div><Link href={loginHref} data-track="start_final">{t.start}</Link></section>

      <footer className="public-footer">
        <div><Link className="public-brand" href="/"><BrandMark size={34} />Chanlyst</Link><p>{t.footer}</p></div>
        <nav>
          {/* First, and not only for the reader: a page nothing links to is a
              page a crawler reaches last or never, and the guides are the only
              pages on this site written to be found by search. */}
          <Link href="/guides">{locale === "ru" ? "Руководства" : "Guides"}</Link>
          <Link href="/terms">{locale === "ru" ? "Условия" : "Terms"}</Link>
          <Link href="/privacy">{locale === "ru" ? "Конфиденциальность" : "Privacy"}</Link>
          <Link href="/refunds">{locale === "ru" ? "Возвраты" : "Refunds"}</Link>
          <Link href="/acceptable-use">{locale === "ru" ? "Допустимое использование" : "Acceptable use"}</Link>
          <Link href="/contact">{locale === "ru" ? "Контакты" : "Contact"}</Link>
        </nav>
        <small>© 2026 Chanlyst. All rights reserved.</small>
      </footer>
    </main>
  );
}
