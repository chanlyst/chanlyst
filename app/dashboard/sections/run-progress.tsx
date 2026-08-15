"use client";

import { useEffect, useState } from "react";
import type { Dictionary, Locale } from "../i18n";
import type { PipelineRun } from "../types";

/**
 * A thin bar along the bottom of the window while a run is working.
 *
 * Pressing Find used to change nothing on screen: the run is a background job
 * now, so there was no spinner to watch and no way to tell whether the press
 * had registered or how long to wait.
 *
 * The bar is driven by the run's real step, not by a timer pretending to be
 * one. What a timer does contribute is movement inside a step — a bar that
 * sits still for ninety seconds reads as broken, so it creeps toward the next
 * boundary without ever crossing it. It can therefore be slow, but it is never
 * ahead of the truth.
 */

/** Where each step ends, as a fraction of the whole. */
const STEP_BOUNDS: Record<string, [number, number]> = {
  analyze: [0, 0.15],
  discover: [0.15, 0.75],
  expand: [0.75, 0.95],
  enrich: [0.95, 0.98],
  drafts: [0.98, 1],
  done: [1, 1],
};

/**
 * How long a step usually takes, in seconds, measured on this codebase: a
 * broad discovery run came in at 101, 179 and 216 seconds across August, and
 * the direct-buyer step is four queries.
 */
const STEP_SECONDS: Record<string, number> = {
  analyze: 25,
  discover: 150,
  expand: 40,
  enrich: 30,
  drafts: 20,
};

export default function RunProgress({
  run,
  t,
  locale,
}: {
  run: PipelineRun | null;
  t: Dictionary;
  locale: Locale;
}) {
  const [now, setNow] = useState(() => Date.now());
  const active = run?.status === "queued" || run?.status === "running";

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!run || !active) return null;

  const [from, to] = STEP_BOUNDS[run.step] || [0, 1];
  const budget = STEP_SECONDS[run.step] || 60;
  const startedAt = Date.parse(run.updatedAt || run.startedAt || "") || now;
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  // Approaches the boundary without reaching it: the step itself decides when
  // it is done, and the bar must never claim that first.
  const share = 1 - Math.exp(-elapsed / budget);
  const value = Math.min(0.99, from + (to - from) * share);

  const stepLabels: Record<string, string> = {
    analyze: t.runStepAnalyze,
    discover: t.runStepDiscover,
    expand: t.runStepExpand,
    enrich: t.runStepEnrich,
    drafts: t.runStepDrafts,
  };
  const stepLabel = stepLabels[run.step] || t.runStepWorking;

  const minutes = Math.floor(elapsed / 60);
  const seconds = Math.floor(elapsed % 60);
  const clock = minutes
    ? `${minutes} ${locale === "ru" ? "мин" : "min"} ${seconds}${locale === "ru" ? " с" : "s"}`
    : `${seconds}${locale === "ru" ? " с" : "s"}`;

  return (
    <div className="run-progress" role="status" aria-live="polite">
      <div className="run-progress-bar">
        <i style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <p>
        <strong>{stepLabel}</strong>
        <span>{clock}</span>
        <em>{t.runProgressLeave}</em>
      </p>
    </div>
  );
}
