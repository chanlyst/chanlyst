"use client";

import { useEffect } from "react";
import {
  cleanEventLabel,
  dwellBucket,
  scrollMark,
  scrolledRatio,
} from "../lib/page-events.mjs";

/**
 * Watches the page and reports three things when the visitor leaves: how long
 * it was open, how far it was scrolled, and what was clicked.
 *
 * Everything is aggregate. The visit id is generated here, kept in a local
 * variable and never written anywhere the browser keeps — it groups one page
 * load's events and disappears with the tab. Nothing is stored on the device,
 * so this needs no consent and runs for every visitor.
 *
 * Clicks are only recorded for elements that opt in with data-track, so the
 * list of possible labels is a decision in the markup rather than whatever the
 * visitor happened to touch.
 */
export default function PageEvents({
  path,
  source = "",
  campaign = "",
}: {
  path: string;
  source?: string;
  campaign?: string;
}) {
  useEffect(() => {
    const visitId = crypto.randomUUID();
    const openedAt = Date.now();
    const clicks: { k: string; l: string; n: number }[] = [];
    let deepest = 0;
    let sent = false;

    function onScroll() {
      const ratio = scrolledRatio({
        scrollY: window.scrollY,
        viewport: window.innerHeight,
        document: document.documentElement.scrollHeight,
      });
      const mark = scrollMark(ratio);
      if (mark > deepest) deepest = mark;
    }

    function onClick(event: MouseEvent) {
      const target = (event.target as Element | null)?.closest?.("[data-track]");
      const label = cleanEventLabel(target?.getAttribute("data-track"));
      if (label) clicks.push({ k: "click", l: label, n: 1 });
    }

    function send() {
      if (sent) return;
      sent = true;

      const seconds = Math.round((Date.now() - openedAt) / 1000);
      onScroll();

      const body = JSON.stringify({
        v: visitId,
        p: path,
        s: source,
        c: campaign,
        e: [
          { k: "dwell", l: dwellBucket(seconds), n: seconds },
          { k: "scroll", l: `${deepest}`, n: deepest },
          ...clicks,
        ],
      });

      // sendBeacon is the only thing that reliably survives the tab closing,
      // which is exactly when the interesting visits end.
      navigator.sendBeacon?.("/api/e", new Blob([body], { type: "application/json" }));
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick, true);
    // pagehide fires where unload does not, notably on mobile Safari.
    window.addEventListener("pagehide", send);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") send();
    });

    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pagehide", send);
      send();
    };
  }, [path, source, campaign]);

  return null;
}
