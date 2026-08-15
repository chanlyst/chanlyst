"use client";

import { useEffect, useSyncExternalStore } from "react";
import { mayRecord, readConsent, writeConsent } from "../lib/consent.mjs";
import { browserTimeZone, needsConsent } from "../lib/consent-region.mjs";

/** Project xv5y7v00ym — the Chanlyst project on clarity.microsoft.com. */
const CLARITY_PROJECT = "xv5y7v00ym";

/**
 * Loads Microsoft Clarity, and only after the visitor says yes.
 *
 * The script tag is created here rather than in the document head on purpose:
 * a tag in the head runs for everyone, including the visitor who declined, and
 * no amount of configuration afterwards un-sends that request. Not a byte
 * leaves for Microsoft until this function is called, and a test holds that by
 * counting the host below — it must appear exactly once in this file.
 */
function loadClarity() {
  if (document.getElementById("clarity-script")) return;

  // Microsoft's published snippet defines this queue before loading the tag,
  // and the tag will not start without it. Loading the tag alone gets a 200 and
  // nothing else — which looks like a working install and records no sessions.
  const target = window as unknown as {
    clarity?: { q?: unknown[] } & ((...args: unknown[]) => void);
  };
  if (!target.clarity) {
    const queued = function (...args: unknown[]) {
      (queued.q = queued.q || []).push(args);
    } as { q?: unknown[] } & ((...args: unknown[]) => void);
    target.clarity = queued;
  }

  const script = document.createElement("script");
  script.id = "clarity-script";
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${CLARITY_PROJECT}`;
  document.head.appendChild(script);
}

// localStorage is an external store React has to read rather than own, and it
// emits nothing on its own, so the notifying is ours to do. Reading it in an
// effect and calling setState would work, but it is the cascading-render
// pattern the linter rightly objects to.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

// One value drives everything, and it is computed only in the browser. The
// region cannot be known on the server — its clock is not the visitor’s — so
// deciding there and again here rendered the banner in the HTML and removed it
// on hydration, which React reports as a mismatch.
function snapshot() {
  // A refusal outranks the region. Nobody outside Europe is asked, but anyone
  // who has said no — here or while travelling — stays refused.
  const stored = readConsent(window.localStorage);
  if (stored === "denied") return "denied";
  if (!needsConsent(browserTimeZone(Intl))) return "not-required";
  return stored;
}

/** The server renders nothing: it has nothing to decide with. */
function serverSnapshot() {
  return "server";
}

export default function AnalyticsConsent({
  locale = "en",
}: {
  locale?: "en" | "ru";
}) {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  // Outside Europe there is nothing to ask, so nothing is asked and recording
  // simply starts. Inside it, and anywhere the zone is unreadable, the stored
  // answer decides and the default is no.
  useEffect(() => {
    if (state === "not-required" || mayRecord(window.localStorage)) loadClarity();
  }, [state]);

  function answer(value: "granted" | "denied") {
    writeConsent(window.localStorage, value);
    for (const listener of listeners) listener();
  }

  if (state !== "unknown") return null;

  const t =
    locale === "ru"
      ? {
          title: "Можно записывать, как вы пользуетесь сайтом?",
          text: "Мы хотим понять, где страница непонятна. Запись делает Microsoft Clarity: движения мыши, клики и прокрутка — без текста, который вы вводите. Посещения мы считаем в любом случае, без cookie и без сторонних сервисов.",
          yes: "Можно",
          no: "Не надо",
          more: "Подробнее",
        }
      : {
          title: "May we record how you use the site?",
          text: "We want to see where the page confuses people. Recording is done by Microsoft Clarity: mouse movement, clicks and scrolling — never the text you type. Visits are counted either way, with no cookie and no third party.",
          yes: "Allow",
          no: "No thanks",
          more: "Details",
        };

  return (
    <aside className="consent-bar" role="dialog" aria-label={t.title}>
      <div>
        <b>{t.title}</b>
        <p>
          {t.text} <a href="/privacy">{t.more}</a>
        </p>
      </div>
      <div className="consent-actions">
        <button type="button" onClick={() => answer("denied")}>
          {t.no}
        </button>
        <button
          type="button"
          className="consent-yes"
          onClick={() => answer("granted")}
        >
          {t.yes}
        </button>
      </div>
    </aside>
  );
}
