"use client";

import Link from "next/link";
import { useState } from "react";
import { BrandMark } from "../components/brand-mark";

type Locale = "ru" | "en";

const copy = {
  ru: {
    eyebrow: "АККАУНТ CHANLYST",
    title: "Войдите и продолжите привлекать клиентов",
    text: "Один аккаунт хранит ваши продукты, найденные площадки, сообщения и фактические результаты.",
    google: "Продолжить с Google",
    apple: "Продолжить с Apple",
    github: "Продолжить с GitHub",
    divider: "или",
    emailLabel: "Электронная почта",
    emailPlaceholder: "you@company.com",
    emailSubmit: "Получить ссылку для входа",
    emailSending: "Отправляем…",
    emailSent: "Проверьте почту — ссылка действует 15 минут.",
    emailAgain: "Отправить ещё раз",
    emailInvalid: "Введите корректный адрес электронной почты.",
    emailLimit: "Слишком много запросов. Попробуйте через 15 минут.",
    emailUnavailable: "Вход по ссылке временно недоступен.",
    owner: "Вход владельца",
    login: "Логин",
    password: "Пароль",
    submit: "Войти",
    loading: "Проверяем…",
    secure: "Защищённая сессия · данные разных аккаунтов разделены",
    terms: "Продолжая, вы принимаете Условия использования и Политику конфиденциальности.",
    invalid: "Неверный логин или пароль.",
    attempts: "Слишком много попыток. Попробуйте через 15 минут.",
    googleSetup: "Вход через Google появится после подключения OAuth-приложения.",
    appleSetup: "Для Apple потребуется аккаунт Apple Developer и Services ID.",
    githubSetup: "Вход через GitHub появится после подключения OAuth-приложения.",
    githubEmail:
      "GitHub не вернул подтверждённый адрес. Подтвердите почту в GitHub и повторите вход.",
    linkInvalid: "Ссылка для входа недействительна. Запросите новую.",
    linkExpired: "Срок действия ссылки истёк. Запросите новую.",
    oauth: "Не удалось завершить вход. Попробуйте ещё раз.",
    back: "На главную",
  },
  en: {
    eyebrow: "CHANLYST ACCOUNT",
    title: "Sign in and keep acquiring customers",
    text: "One account keeps your products, discovered channels, outreach and actual outcomes.",
    google: "Continue with Google",
    apple: "Continue with Apple",
    github: "Continue with GitHub",
    divider: "or",
    emailLabel: "Email",
    emailPlaceholder: "you@company.com",
    emailSubmit: "Email me a sign-in link",
    emailSending: "Sending…",
    emailSent: "Check your inbox — the link is valid for 15 minutes.",
    emailAgain: "Send another link",
    emailInvalid: "Enter a valid email address.",
    emailLimit: "Too many requests. Try again in 15 minutes.",
    emailUnavailable: "Link sign-in is temporarily unavailable.",
    owner: "Owner sign in",
    login: "Login",
    password: "Password",
    submit: "Sign in",
    loading: "Checking…",
    secure: "Secure session · account data is isolated",
    terms: "By continuing, you agree to the Terms of Use and Privacy Policy.",
    invalid: "Incorrect login or password.",
    attempts: "Too many attempts. Try again in 15 minutes.",
    googleSetup: "Google sign-in will work after the OAuth app is connected.",
    appleSetup: "Apple requires an Apple Developer account and a Services ID.",
    githubSetup: "GitHub sign-in will work after the OAuth app is connected.",
    githubEmail:
      "GitHub returned no verified address. Verify your email on GitHub and try again.",
    linkInvalid: "This sign-in link is not valid. Request a new one.",
    linkExpired: "This sign-in link has expired. Request a new one.",
    oauth: "Sign-in could not be completed. Please try again.",
    back: "Back to home",
  },
};

export default function LoginScreen({
  initialError = "",
  googleAvailable = false,
  appleAvailable = false,
  githubAvailable = false,
  emailLoginAvailable = false,
}: {
  initialError?: string;
  googleAvailable?: boolean;
  appleAvailable?: boolean;
  githubAvailable?: boolean;
  emailLoginAvailable?: boolean;
}) {
  const [locale, setLocale] = useState<Locale>("en");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkError, setLinkError] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const t = copy[locale];
  const providerError =
    initialError === "google_not_configured"
      ? t.googleSetup
      : initialError === "apple_not_configured"
        ? t.appleSetup
        : initialError === "github_not_configured"
          ? t.githubSetup
          : initialError === "github_email_unverified"
            ? t.githubEmail
            : initialError === "login_link_expired"
              ? t.linkExpired
              : initialError === "login_link_invalid"
                ? t.linkInvalid
                : initialError
                  ? t.oauth
                  : "";
  const displayedError = error || providerError;

  async function sendLoginLink(event: React.FormEvent) {
    event.preventDefault();
    setLinkBusy(true);
    setLinkError("");
    try {
      const response = await fetch("/api/auth/email/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: linkEmail, locale }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setLinkError(
          result.error === "too_many_attempts"
            ? t.emailLimit
            : result.error === "invalid_email"
              ? t.emailInvalid
              : t.emailUnavailable,
        );
        return;
      }
      setLinkSent(true);
    } catch {
      setLinkError(t.emailUnavailable);
    } finally {
      setLinkBusy(false);
    }
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(result.error === "too_many_attempts" ? t.attempts : t.invalid);
        return;
      }
      window.location.assign("/dashboard");
    } catch {
      setError(t.oauth);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <Link href="/" className="auth-brand"><BrandMark size={34} tile="transparent" />Chanlyst</Link>
        <div className="auth-story-copy">
          <p><i />{t.eyebrow}</p>
          <h1>{t.title}</h1>
          <strong>{t.text}</strong>
          <div className="auth-flow">
            <article><span>01</span><div><b>Product intelligence</b><small>Audience, offer and acquisition strategy</small></div><i>✓</i></article>
            <article><span>02</span><div><b>Channel discovery</b><small>Qualified audience owners across the web</small></div><i>✓</i></article>
            <article><span>03</span><div><b>Measured outreach</b><small>Replies, meetings and paying customers</small></div><i>→</i></article>
          </div>
        </div>
        <small>© 2026 Chanlyst</small>
      </section>

      <section className="auth-entry">
        <div className="auth-top">
          <Link href="/">← {t.back}</Link>
          <div className="language"><button className={locale === "ru" ? "active" : ""} onClick={() => setLocale("ru")}>RU</button><button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")}>EN</button></div>
        </div>
        <div className="auth-card">
          <div className="auth-mobile-brand"><BrandMark size={30} />Chanlyst</div>
          <small>{t.eyebrow}</small>
          <h2>{locale === "ru" ? "Войти или создать аккаунт" : "Sign in or create an account"}</h2>
          <p>{locale === "ru" ? "Регистрация занимает несколько секунд." : "Registration takes only a few seconds."}</p>
          <div className="oauth-buttons">
            {googleAvailable ? (
              <a href="/api/auth/google/start" className="google-button"><span>G</span>{t.google}</a>
            ) : (
              <span className="google-button oauth-unavailable"><i>G</i>{t.google}<small>{locale === "ru" ? "Настраивается" : "Setup in progress"}</small></span>
            )}
            {githubAvailable && (
              <a href="/api/auth/github/start" className="github-button">
                <span aria-hidden="true">
                  <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                  </svg>
                </span>
                {t.github}
              </a>
            )}
            {/* Apple stays hidden until the Services ID exists; a disabled
                placeholder reads as a broken button. */}
            {appleAvailable && (
              <a href="/api/auth/apple/start" className="apple-button"><span>●</span>{t.apple}</a>
            )}
          </div>
          {emailLoginAvailable && (
            <form className="magic-link" onSubmit={sendLoginLink}>
              <label>
                <span>{t.emailLabel}</span>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder={t.emailPlaceholder}
                  value={linkEmail}
                  onChange={(event) => {
                    setLinkEmail(event.target.value);
                    setLinkSent(false);
                  }}
                  required
                />
              </label>
              {linkError && <p className="auth-error">{linkError}</p>}
              {linkSent && <p className="magic-link-sent">{t.emailSent}</p>}
              <button type="submit" disabled={linkBusy || !linkEmail}>
                {linkBusy ? t.emailSending : linkSent ? t.emailAgain : t.emailSubmit}
              </button>
            </form>
          )}
          {!googleAvailable && (
            <p className="oauth-setup-banner">
              {locale === "ru"
                ? "Google-вход временно недоступен: завершается подключение защищённого OAuth-приложения. Пока используйте вход владельца ниже."
                : "Google sign-in is temporarily unavailable while the secure OAuth app is being connected. Use owner sign-in below for now."}
            </p>
          )}
          <div className="auth-divider"><span>{t.divider}</span></div>
          <details className="owner-login" open>
            <summary>{t.owner}<span>⌄</span></summary>
            <form onSubmit={signIn}>
              <label><span>{t.login}</span><input autoComplete="username" value={login} onChange={(event) => setLogin(event.target.value)} required /></label>
              <label><span>{t.password}</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
              {displayedError && <p className="auth-error">{displayedError}</p>}
              <button className="lime" disabled={busy || !login || !password}>{busy ? t.loading : t.submit}<span>→</span></button>
            </form>
          </details>
          <div className="auth-security"><span>✓</span>{t.secure}</div>
          <p className="auth-terms">{t.terms} <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link></p>
        </div>
      </section>
    </main>
  );
}
