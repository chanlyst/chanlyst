// What a visitor did on the page, without knowing who they are.
//
// The counter answered "they landed and never reached sign-in" and stopped
// there. The likeliest explanation is the cheapest one to test: a thumb
// brushing the ad in a feed, a page opening, a page closing two seconds later.
// That costs $0.72 a time and looks identical to a considered rejection.
//
// So three things are recorded, all of them aggregate: how long the page was
// open, how far it was scrolled, and what was clicked. No cookie, no storage,
// no identifier that survives the page — the id below is made per page load,
// lives in memory, and is gone when the tab closes. It exists only so the
// events of one visit can be counted as one visit.

/** Buckets, because a second-by-second histogram answers nothing extra. */
export const DWELL_BUCKETS = [2, 5, 15, 30, 60, 180];

/** Scroll is reported at thresholds, not continuously. */
export const SCROLL_MARKS = [25, 50, 75, 100];

/**
 * The dwell bucket a duration falls into, as a label: "0-2s", "2-5s" … "180s+".
 * Under two seconds is its own bucket on purpose — that is the accidental-tap
 * bucket, and it is the number the ad spend hangs on.
 */
export function dwellBucket(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "";

  let previous = 0;
  for (const edge of DWELL_BUCKETS) {
    if (value < edge) return `${previous}-${edge}s`;
    previous = edge;
  }
  return `${previous}s+`;
}

/** The highest threshold passed, or 0 before the first one. */
export function scrollMark(scrolledRatio) {
  const ratio = Number(scrolledRatio);
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;

  const percent = Math.min(100, Math.round(ratio * 100));
  let reached = 0;
  for (const mark of SCROLL_MARKS) if (percent >= mark) reached = mark;
  return reached;
}

/**
 * How far down the document the visitor has seen, as 0..1.
 *
 * Measured against what is scrollable rather than the document height: on a
 * page shorter than the window nothing can be scrolled, and reporting 0% there
 * would read as "left immediately" when they saw everything there was.
 */
export function scrolledRatio({ scrollY = 0, viewport = 0, document: total = 0 } = {}) {
  const scrollable = Math.max(0, total - viewport);
  if (scrollable <= 0) return 1;
  return Math.min(1, Math.max(0, scrollY / scrollable));
}

/** Labels we are willing to store: short, lowercase, no free text. */
export function cleanEventLabel(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);
}

export const EVENT_KINDS = ["click", "scroll", "dwell"];

export function isEventKind(value) {
  return EVENT_KINDS.includes(String(value ?? ""));
}
