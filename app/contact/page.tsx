"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import PublicHeader, {
  DEFAULT_PUBLIC_LOCALE,
  type PublicLocale,
} from "../components/public-header";

const contactCopy = {
  ru: {
    back: "На главную",
    kicker: "Контакты",
    title: "Напишите команде Chanlyst",
    lead: "Вопросы по продукту, подключению, оплате, возвратам и данным принимаются через эту форму.",
    response: "Обычно отвечаем в течение 2 рабочих дней. Запросы на возврат и удаление данных — до 5 рабочих дней.",
    name: "Ваше имя",
    email: "Email для ответа",
    company: "Компания или продукт",
    topic: "Тема",
    topics: { general: "Общий вопрос", sales: "Подключение и тарифы", billing: "Оплата или возврат", privacy: "Конфиденциальность и данные", abuse: "Сообщить о нарушении" },
    message: "Сообщение",
    consent: "Отправляя форму, вы разрешаете обработать данные для ответа на обращение в соответствии с Политикой конфиденциальности.",
    send: "Отправить обращение",
    sending: "Отправляем…",
    success: "Спасибо. Обращение зарегистрировано.",
    error: "Не удалось отправить форму. Проверьте поля и попробуйте ещё раз.",
    noteTitle: "Для безопасности",
    note: "Не отправляйте пароли, API-ключи, полные номера банковских карт или документы, удостоверяющие личность.",
  },
  en: {
    back: "Back home",
    kicker: "Contact",
    title: "Contact the Chanlyst team",
    lead: "Product, onboarding, billing, refund and data questions can be submitted through this form.",
    response: "We normally respond within 2 business days. Refund and data-deletion requests may take up to 5 business days.",
    name: "Your name",
    email: "Reply email",
    company: "Company or product",
    topic: "Topic",
    topics: { general: "General question", sales: "Onboarding and pricing", billing: "Billing or refund", privacy: "Privacy and data", abuse: "Report abuse" },
    message: "Message",
    consent: "By submitting, you authorize us to process this information to answer your request under our Privacy Policy.",
    send: "Submit request",
    sending: "Submitting…",
    success: "Thank you. Your request has been registered.",
    error: "The form could not be submitted. Check the fields and try again.",
    noteTitle: "For your security",
    note: "Do not send passwords, API keys, full payment-card numbers or identity documents.",
  },
} as const;

export default function ContactPage() {
  const [locale, setLocale] = useState<PublicLocale>(DEFAULT_PUBLIC_LOCALE);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const t = contactCopy[locale];

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    const form = event.currentTarget;
    const response = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    }).catch(() => null);

    if (response?.ok) {
      form.reset();
      setState("sent");
    } else {
      setState("error");
    }
  }

  return (
    <main className="contact-shell">
      <PublicHeader locale={locale} onLocaleChange={chooseLocale} compact />
      <section className="contact-layout">
        <div className="contact-intro">
          <Link className="back-link" href="/">← {t.back}</Link>
          <p className="section-kicker">{t.kicker}</p>
          <h1>{t.title}</h1>
          <p>{t.lead}</p>
          <div className="response-card"><span>↗</span><p>{t.response}</p></div>
          <div className="security-note"><strong>{t.noteTitle}</strong><p>{t.note}</p></div>
        </div>
        <form className="contact-form" onSubmit={submit}>
          <div className="contact-two">
            <label><span>{t.name}</span><input name="name" autoComplete="name" minLength={2} maxLength={120} required /></label>
            <label><span>{t.email}</span><input name="email" type="email" inputMode="email" autoComplete="email" spellCheck={false} maxLength={254} required /></label>
          </div>
          <label><span>{t.company}</span><input name="company" autoComplete="organization" maxLength={180} /></label>
          <label><span>{t.topic}</span><select name="topic" defaultValue="general">{Object.entries(t.topics).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label><span>{t.message}</span><textarea name="message" minLength={10} maxLength={5000} required /></label>
          <label className="website-trap" aria-hidden="true"><span>Website</span><input name="website" tabIndex={-1} autoComplete="off" /></label>
          <p className="form-consent">{t.consent} <Link href="/privacy">{locale === "ru" ? "Подробнее" : "Learn more"}</Link>.</p>
          <button className="primary-cta" type="submit" disabled={state === "sending"}>{state === "sending" ? t.sending : t.send} <span>↗</span></button>
          {state === "sent" && <p className="form-state success">✓ {t.success}</p>}
          {state === "error" && <p className="form-state error">{t.error}</p>}
        </form>
      </section>
    </main>
  );
}
