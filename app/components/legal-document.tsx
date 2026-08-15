"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PublicHeader, {
  DEFAULT_PUBLIC_LOCALE,
  type PublicLocale,
} from "./public-header";

export type LegalSection = {
  title: string;
  paragraphs: string[];
  items?: string[];
};

export default function LegalDocument({
  title,
  description,
  sections,
}: {
  title: Record<PublicLocale, string>;
  description: Record<PublicLocale, string>;
  sections: Record<PublicLocale, LegalSection[]>;
}) {
  const [locale, setLocale] = useState<PublicLocale>(DEFAULT_PUBLIC_LOCALE);

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

  return (
    <main className="legal-shell">
      <PublicHeader locale={locale} onLocaleChange={chooseLocale} compact />
      <article className="legal-document">
        <Link className="back-link" href="/">← {locale === "ru" ? "На главную" : "Back home"}</Link>
        <p className="section-kicker">SIGNALIST · LEGAL</p>
        <h1>{title[locale]}</h1>
        <p className="legal-updated">{locale === "ru" ? "Дата вступления в силу: 24 июля 2026 г." : "Effective date: July 24, 2026"}</p>
        <p className="legal-lead">{description[locale]}</p>
        {sections[locale].map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.items && <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}
          </section>
        ))}
      </article>
      <footer className="legal-footer">
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/refunds">Refunds</Link>
        <Link href="/acceptable-use">Acceptable use</Link>
        <Link href="/contact">Contact</Link>
      </footer>
    </main>
  );
}
