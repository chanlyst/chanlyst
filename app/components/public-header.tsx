"use client";

import Link from "next/link";
import { BrandMark } from "./brand-mark";

export type PublicLocale = "ru" | "en";

/**
 * The language the server renders and Google therefore indexes. English,
 * because that is where the buyers are: the plans are priced in dollars and
 * the channels the product finds — G2, Product Hunt, Reddit — are English.
 * Russian stays a switch, remembered per browser but never a separate URL,
 * so it is deliberately not something search engines see.
 */
export const DEFAULT_PUBLIC_LOCALE: PublicLocale = "en";

export default function PublicHeader({
  locale,
  onLocaleChange,
  compact = false,
  conversion = false,
  // The campaign tags a paid visitor arrived with. Without them this link
  // sends people to the sign-in page credited to our own domain, and the
  // campaign that paid for the visit shows nobody reaching the second step.
  loginHref = "/login",
}: {
  locale: PublicLocale;
  onLocaleChange: (locale: PublicLocale) => void;
  compact?: boolean;
  conversion?: boolean;
  loginHref?: string;
}) {
  const nav =
    locale === "ru"
      ? { product: "Возможности", process: "Как работает", pricing: "Тарифы", contact: "Контакты", app: "Открыть сервис" }
      : { product: "Features", process: "How it works", pricing: "Pricing", contact: "Contact", app: "Open app" };

  const conversionNav = locale === "ru"
    ? { examples: "Пример", pricing: "Тарифы", app: "Войти" }
    : { examples: "Example", pricing: "Pricing", app: "Sign in" };

  return (
    <header className={`public-header ${compact ? "compact" : ""} ${conversion ? "conversion" : ""}`}>
      <Link className="public-brand" href="/">
        <BrandMark size={34} />
        Chanlyst
      </Link>
      {!compact && !conversion && (
        <nav aria-label={locale === "ru" ? "Основная навигация" : "Main navigation"}>
          <Link href="/#features">{nav.product}</Link>
          <Link href="/#process">{nav.process}</Link>
          <Link href="/#pricing">{nav.pricing}</Link>
          <Link href="/contact">{nav.contact}</Link>
        </nav>
      )}
      {conversion && (
        <nav aria-label={locale === "ru" ? "Основная навигация" : "Main navigation"}>
          <Link href="/found">{conversionNav.examples}</Link>
          <Link href="/#pricing">{conversionNav.pricing}</Link>
        </nav>
      )}
      <div className="public-header-actions">
        <div
          className="public-language"
          role="group"
          aria-label={locale === "ru" ? "Язык" : "Language"}
        >
          <button
            type="button"
            aria-pressed={locale === "ru"}
            className={locale === "ru" ? "active" : ""}
            onClick={() => onLocaleChange("ru")}
          >
            RU
          </button>
          <button
            type="button"
            aria-pressed={locale === "en"}
            className={locale === "en" ? "active" : ""}
            onClick={() => onLocaleChange("en")}
          >
            EN
          </button>
        </div>
        <Link className="public-app-link" href={loginHref}>{conversion ? conversionNav.app : nav.app}</Link>
      </div>
    </header>
  );
}
