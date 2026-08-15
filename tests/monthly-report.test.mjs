import assert from "node:assert/strict";
import test from "node:test";
import {
  REGRESSION_DROP,
  buildMonthlyReport,
  defaultPeriodLabel,
  formatDelta,
  highlightText,
  monthPeriod,
  recentMonthLabels,
} from "../app/lib/monthly-report.mjs";

const june = monthPeriod("2026-06");
const may = monthPeriod("2026-05");
const now = "2026-07-27T09:00:00.000Z";

/** A prospect row as the API aliases it out of D1. */
function lead(overrides = {}) {
  return {
    channelType: "каталог",
    engagementMode: "free_listing",
    stage: "discovered",
    createdAt: "2026-06-05T10:00:00.000Z",
    contactedAt: null,
    repliedAt: null,
    meetingAt: null,
    convertedAt: null,
    revenueCents: 0,
    placementStatus: "",
    placementCheckedAt: null,
    ...overrides,
  };
}

function report({ leads = [], messages = [], snapshots = [], previous = true }) {
  return buildMonthlyReport({
    now,
    periodStart: june.start,
    periodEnd: june.end,
    leads,
    messages,
    snapshots,
    previous: previous
      ? { periodStart: may.start, periodEnd: may.end, leads, messages, snapshots }
      : null,
  });
}

test("period helpers only ever offer complete months", () => {
  assert.equal(defaultPeriodLabel(now), "2026-06");
  assert.deepEqual(recentMonthLabels(now, 3), ["2026-06", "2026-05", "2026-04"]);
  // January rolls back into the previous year.
  assert.deepEqual(recentMonthLabels("2026-01-04T00:00:00.000Z", 2), [
    "2025-12",
    "2025-11",
  ]);
  assert.equal(monthPeriod("2026-06").end, "2026-07-01T00:00:00.000Z");
});

test("totals count each milestone in the period it happened in", () => {
  const result = report({
    leads: [
      // Found and contacted in June.
      lead({ contactedAt: "2026-06-10T10:00:00.000Z" }),
      // Found in May, replied in June: not "found", but a June reply.
      lead({
        createdAt: "2026-05-02T10:00:00.000Z",
        contactedAt: "2026-05-03T10:00:00.000Z",
        repliedAt: "2026-06-08T10:00:00.000Z",
        stage: "replied",
      }),
      // Full journey inside June, won with revenue.
      lead({
        contactedAt: "2026-06-02T10:00:00.000Z",
        repliedAt: "2026-06-04T10:00:00.000Z",
        meetingAt: "2026-06-06T10:00:00.000Z",
        convertedAt: "2026-06-09T10:00:00.000Z",
        revenueCents: 120_000,
        stage: "won",
      }),
      // Placement published in June.
      lead({
        placementStatus: "published",
        placementCheckedAt: "2026-06-20T10:00:00.000Z",
      }),
    ],
    messages: [
      { status: "sent", sentAt: "2026-06-03T10:00:00.000Z" },
      { status: "sent", sentAt: "2026-05-03T10:00:00.000Z" },
      { status: "queued", sentAt: null },
    ],
    snapshots: [
      { leadId: "a", checkedAt: "2026-06-11T10:00:00.000Z" },
      { leadId: "a", checkedAt: "2026-06-12T10:00:00.000Z" },
      { leadId: "b", checkedAt: "2026-06-12T10:00:00.000Z" },
      { leadId: "c", checkedAt: "2026-05-12T10:00:00.000Z" },
    ],
    previous: false,
  });
  assert.deepEqual(result.totals, {
    found: 3,
    contacted: 2,
    replied: 2,
    meetings: 1,
    customers: 1,
    revenueCents: 120_000,
    placementsPublished: 1,
    messagesSent: 1,
    channelsChecked: 2,
  });
  assert.equal(result.hasActivity, true);
  assert.equal(result.changes, null);
  assert.equal(result.previousTotals, null);
  assert.equal(result.revenuePerCustomerCents, 120_000);
});

test("revenue counts only deals won inside the period", () => {
  const leads = [
    // Won in May: its revenue belongs to May, never to June.
    lead({
      createdAt: "2026-04-01T10:00:00.000Z",
      convertedAt: "2026-05-20T10:00:00.000Z",
      revenueCents: 500_000,
      stage: "won",
    }),
    // Won in June.
    lead({
      convertedAt: "2026-06-20T10:00:00.000Z",
      revenueCents: 90_000,
      stage: "won",
    }),
    // Won after the period.
    lead({
      convertedAt: "2026-07-02T10:00:00.000Z",
      revenueCents: 700_000,
      stage: "won",
    }),
  ];
  const result = report({ leads });
  assert.equal(result.totals.customers, 1);
  assert.equal(result.totals.revenueCents, 90_000);
  assert.equal(result.previousTotals.customers, 1);
  assert.equal(result.previousTotals.revenueCents, 500_000);
  // A "won" stage alone must not leak revenue into a period that has no
  // converted_at inside it.
  const stageOnly = buildMonthlyReport({
    now,
    periodStart: june.start,
    periodEnd: june.end,
    leads: [lead({ stage: "won", revenueCents: 400_000, convertedAt: null })],
  });
  assert.equal(stageOnly.totals.customers, 0);
  assert.equal(stageOnly.totals.revenueCents, 0);
});

test("channel types rank by customers, then replies", () => {
  const result = report({
    leads: [
      lead({
        channelType: "Каталоги",
        convertedAt: "2026-06-10T10:00:00.000Z",
        revenueCents: 50_000,
        stage: "won",
      }),
      lead({ channelType: "каталоги", repliedAt: "2026-06-11T10:00:00.000Z" }),
      lead({ channelType: "Telegram", repliedAt: "2026-06-12T10:00:00.000Z" }),
      lead({ channelType: "Telegram", repliedAt: "2026-06-13T10:00:00.000Z" }),
      lead({ channelType: "Telegram", repliedAt: "2026-06-14T10:00:00.000Z" }),
      lead({ channelType: "Блоги" }),
    ],
    previous: false,
  });
  assert.deepEqual(
    result.channelTypes.map((row) => [row.channelType, row.customers, row.replied]),
    [
      ["Каталоги", 1, 1],
      ["Telegram", 0, 3],
      ["Блоги", 0, 0],
    ],
  );
  // Case-insensitive grouping keeps the first-seen spelling and sums "found".
  assert.equal(result.channelTypes[0].found, 2);
  assert.equal(result.channelTypes[0].revenueCents, 50_000);
  assert.equal(
    highlightText(result.highlights[0], "ru"),
    "Лучший тип канала: Каталоги — 1 клиент(ов), $500.",
  );
});

test("comparison with the previous period, including an empty one", () => {
  const result = report({
    leads: [
      lead({ createdAt: "2026-05-04T10:00:00.000Z" }),
      lead({ createdAt: "2026-05-05T10:00:00.000Z" }),
      lead({ createdAt: "2026-06-04T10:00:00.000Z" }),
      lead({ createdAt: "2026-06-05T10:00:00.000Z" }),
      lead({ createdAt: "2026-06-06T10:00:00.000Z" }),
      lead({
        createdAt: "2026-06-07T10:00:00.000Z",
        convertedAt: "2026-06-08T10:00:00.000Z",
        revenueCents: 30_000,
        stage: "won",
      }),
    ],
  });
  assert.equal(result.totals.found, 4);
  assert.equal(result.previousTotals.found, 2);
  assert.deepEqual(result.changes.found, {
    current: 4,
    previous: 2,
    delta: 2,
    ratio: 1,
    direction: "up",
  });
  // Previous period had no customers at all: "new", never a division by zero.
  assert.deepEqual(result.changes.customers, {
    current: 1,
    previous: 0,
    delta: 1,
    ratio: null,
    direction: "new",
  });
  assert.equal(result.changes.revenueCents.ratio, null);
  assert.equal(result.changes.revenueCents.direction, "new");
  // 0 → 0 is flat, not "new".
  assert.equal(result.changes.meetings.direction, "flat");
  assert.equal(result.changes.meetings.ratio, null);
  assert.equal(formatDelta("found", result.changes.found), "+2");
  assert.equal(formatDelta("revenueCents", result.changes.revenueCents), "+$300");
});

test("a drop past the regression threshold becomes a highlight", () => {
  /** `count` leads found and contacted in `month`, of which `replied` replied. */
  const month = (label, count, replied) =>
    Array.from({ length: count }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      const date = `${label}-${day}T10:00:00.000Z`;
      return lead({
        createdAt: date,
        contactedAt: date,
        repliedAt: index < replied ? date : null,
      });
    });
  // Discovery and outreach held steady (10 → 10); only replies moved,
  // 10 → 6, which is −40% and past the 30% threshold.
  const regressed = report({
    leads: [...month("2026-05", 10, 10), ...month("2026-06", 10, 6)],
  });
  const regression = regressed.highlights.find(
    (item) => item.kind === "regression" && item.metric === "replied",
  );
  assert.ok(regression, "expected a replies regression highlight");
  assert.equal(regression.ratio, -0.4);
  assert.equal(
    highlightText(regression, "en"),
    "Down: replies — 6 vs 10 (−40%).",
  );

  // 10 → 8 is −20%: under the threshold, no highlight.
  const mild = report({
    leads: [...month("2026-05", 10, 10), ...month("2026-06", 10, 8)],
  });
  assert.equal(
    mild.highlights.filter((item) => item.kind === "regression").length,
    0,
  );
  assert.equal(REGRESSION_DROP, 0.3);

  // A drop from a tiny previous period (2 → 0) is noise, not a regression.
  const tiny = report({ leads: month("2026-05", 2, 2) });
  assert.equal(
    tiny.highlights.filter((item) => item.kind === "regression").length,
    0,
  );
});

test("an empty period reports no activity and no highlights", () => {
  const result = report({ leads: [], previous: true });
  assert.equal(result.hasActivity, false);
  assert.deepEqual(result.channelTypes, []);
  assert.deepEqual(result.highlights, []);
  assert.equal(result.revenuePerCustomerCents, null);
  assert.equal(result.changes.found.direction, "flat");
});
