import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanEventLabel,
  dwellBucket,
  isEventKind,
  scrollMark,
  scrolledRatio,
} from "../app/lib/page-events.mjs";
import { browserTimeZone, needsConsent } from "../app/lib/consent-region.mjs";

// The number the ad budget hangs on. A visit under two seconds was not a
// decision — it is a thumb brushing a post in a feed — and it has to be its own
// bucket, or it hides inside "under five seconds" with the people who looked.
test("the accidental tap gets its own bucket", () => {
  assert.equal(dwellBucket(0), "0-2s");
  assert.equal(dwellBucket(1.9), "0-2s");
  assert.equal(dwellBucket(2), "2-5s");
  assert.equal(dwellBucket(4.9), "2-5s");
  assert.equal(dwellBucket(59), "30-60s");
  assert.equal(dwellBucket(180), "180s+");
  assert.equal(dwellBucket(9999), "180s+");
});

test("an unusable duration is reported as nothing, not as zero seconds", () => {
  assert.equal(dwellBucket(-1), "");
  assert.equal(dwellBucket("later"), "");
  assert.equal(dwellBucket(undefined), "");
});

test("scroll is reported at thresholds", () => {
  assert.equal(scrollMark(0), 0);
  assert.equal(scrollMark(0.2), 0);
  assert.equal(scrollMark(0.25), 25);
  assert.equal(scrollMark(0.74), 50);
  assert.equal(scrollMark(1), 100);
  assert.equal(scrollMark(2), 100, "over-scroll cannot exceed the page");
});

// A page shorter than the window cannot be scrolled at all. Reporting 0% there
// would read as "left immediately" for someone who saw everything there was.
test("a page that fits the window counts as fully seen", () => {
  assert.equal(scrolledRatio({ scrollY: 0, viewport: 900, document: 800 }), 1);
  assert.equal(scrolledRatio({ scrollY: 0, viewport: 900, document: 900 }), 1);
  assert.equal(scrolledRatio({}), 1);
});

test("scrolled ratio is measured against what can be scrolled", () => {
  assert.equal(scrolledRatio({ scrollY: 0, viewport: 1000, document: 3000 }), 0);
  assert.equal(scrolledRatio({ scrollY: 1000, viewport: 1000, document: 3000 }), 0.5);
  assert.equal(scrolledRatio({ scrollY: 5000, viewport: 1000, document: 3000 }), 1);
});

// Labels come from markup we control, but the endpoint is public, so anything
// arriving there has to be reduced to something safe to store and group by.
test("labels cannot carry free text", () => {
  assert.equal(cleanEventLabel("Start_Hero"), "start_hero");
  assert.equal(cleanEventLabel("<script>alert(1)</script>"), "scriptalert1script");
  assert.equal(cleanEventLabel("a".repeat(80)).length, 40);
  assert.equal(cleanEventLabel(null), "");
});

test("only the three known event kinds are accepted", () => {
  assert.equal(isEventKind("click"), true);
  assert.equal(isEventKind("scroll"), true);
  assert.equal(isEventKind("dwell"), true);
  assert.equal(isEventKind("keystroke"), false, "we never record typing");
  assert.equal(isEventKind(""), false);
});

// The banner is shown where the law requires it and skipped where it does not.
// Every unclear case has to fall on the "ask" side: a missed banner in Europe
// is a legal problem, an extra banner in Texas is only a lost recording.
test("Europe is asked, and so is anything unreadable", () => {
  assert.equal(needsConsent("Europe/London"), true);
  assert.equal(needsConsent("Europe/Berlin"), true);
  assert.equal(needsConsent("Atlantic/Reykjavik"), true);
  assert.equal(needsConsent(""), true);
  assert.equal(needsConsent(undefined), true);
  assert.equal(needsConsent("UTC"), true, "UTC is what a locked-down browser says");
});

test("the campaign's other three countries are not asked", () => {
  assert.equal(needsConsent("America/New_York"), false);
  assert.equal(needsConsent("America/Toronto"), false);
  assert.equal(needsConsent("Australia/Sydney"), false);
  assert.equal(needsConsent("Asia/Phnom_Penh"), false);
});

test("a browser that refuses to say its zone is treated as Europe", () => {
  assert.equal(browserTimeZone(undefined), "");
  assert.equal(
    browserTimeZone({
      DateTimeFormat: () => {
        throw new Error("blocked");
      },
    }),
    "",
  );
  assert.equal(needsConsent(browserTimeZone(undefined)), true);
});
