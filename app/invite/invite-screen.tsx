"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandMark } from "../components/brand-mark";

type Locale = "ru" | "en";

const copy = {
  ru: {
    brand: "Приглашение в воркспейс",
    working: "Проверяю приглашение…",
    success: "Приглашение принято. Открываю дашборд…",
    unauthenticated:
      "Сначала войдите через Google или Apple, затем откройте ссылку-приглашение ещё раз.",
    login: "Войти",
    invalid: "Ссылка-приглашение недействительна.",
    expired: "Срок действия приглашения истёк. Попросите владельца прислать новую ссылку.",
    alreadyAccepted: "Это приглашение уже использовано.",
    failed: "Не удалось принять приглашение. Попробуйте ещё раз.",
    retry: "Повторить",
    home: "На главную",
  },
  en: {
    brand: "Workspace invitation",
    working: "Checking the invitation…",
    success: "Invitation accepted. Opening the dashboard…",
    unauthenticated:
      "Sign in with Google or Apple first, then open the invite link again.",
    login: "Sign in",
    invalid: "This invite link is not valid.",
    expired: "This invitation has expired. Ask the owner for a new link.",
    alreadyAccepted: "This invitation has already been used.",
    failed: "The invitation could not be accepted. Please try again.",
    retry: "Retry",
    home: "Back to home",
  },
};

type Status =
  | "working"
  | "success"
  | "unauthenticated"
  | "invalid"
  | "expired"
  | "already_accepted"
  | "failed";

export default function InviteScreen({ token }: { token: string }) {
  const [locale, setLocale] = useState<Locale>("en");
  const [status, setStatus] = useState<Status>(token ? "working" : "invalid");
  const [attempt, setAttempt] = useState(0);
  const t = copy[locale];

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/workspace/invites/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        if (cancelled) return;
        if (response.ok) {
          setStatus("success");
          window.location.assign("/dashboard");
          return;
        }
        if (response.status === 401) {
          setStatus("unauthenticated");
          return;
        }
        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setStatus(
          result.error === "expired"
            ? "expired"
            : result.error === "already_accepted"
              ? "already_accepted"
              : result.error === "invalid_token"
                ? "invalid"
                : "failed",
        );
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  const message =
    status === "working"
      ? t.working
      : status === "success"
        ? t.success
        : status === "unauthenticated"
          ? t.unauthenticated
          : status === "expired"
            ? t.expired
            : status === "already_accepted"
              ? t.alreadyAccepted
              : status === "invalid"
                ? t.invalid
                : t.failed;

  return (
    <main className="invite-shell">
      <section className="invite-card">
        <Link href="/" className="auth-brand"><BrandMark size={34} tile="transparent" />Chanlyst</Link>
        <div className="language">
          <button className={locale === "ru" ? "active" : ""} onClick={() => setLocale("ru")}>RU</button>
          <button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")}>EN</button>
        </div>
        <h1>{t.brand}</h1>
        <p role={status === "working" || status === "success" ? "status" : "alert"}>
          {message}
        </p>
        {status === "unauthenticated" && (
          <a className="invite-action" href="/login">{t.login}</a>
        )}
        {status === "failed" && (
          <button
            className="invite-action"
            onClick={() => {
              setStatus("working");
              setAttempt((n) => n + 1);
            }}
          >
            {t.retry}
          </button>
        )}
        {(status === "invalid" ||
          status === "expired" ||
          status === "already_accepted") && (
          <Link className="invite-action" href="/">{t.home}</Link>
        )}
      </section>
    </main>
  );
}
