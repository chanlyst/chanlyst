import {
  OTHER_CHANNEL_TYPE,
  computeChannelStats,
} from "./channel-stats-core.mjs";

// Re-exported so consumers of the report never need both modules.
export { OTHER_CHANNEL_TYPE };

// The monthly performance report: what the service actually produced in one
// calendar month, compared with the month before it. Pure — no DB, no
// network, no model. The API route loads rows and the digest cron formats an
// e-mail, but every number displayed anywhere comes from here.
//
// Counting rules (deliberately event-based, not stage-based): a lead counts
// towards a metric when the corresponding timestamp falls inside the period,
// so a lead discovered in May and won in June is "found" in May and a
// "customer" in June. Revenue follows converted_at for the same reason.

/** Metrics compared against the previous period, in display order. */
export const REPORT_METRICS = [
  "found",
  "contacted",
  "replied",
  "meetings",
  "customers",
  "revenueCents",
  "placementsPublished",
];

/** The five numbers the e-mail and the dashboard lead with. */
export const HEADLINE_METRICS = [
  "found",
  "contacted",
  "replied",
  "customers",
  "revenueCents",
];

/** A metric counts as regressed when it drops by at least this share... */
export const REGRESSION_DROP = 0.3;
/** ...and the previous period was big enough for the drop to mean anything. */
export const REGRESSION_MIN_PREVIOUS = 3;

/** How many channel types the report carries. */
export const TOP_REPORT_TYPES = 6;

/** Below this sample size a relative change is noise, not a story. */
const CHANGE_MIN_SAMPLE = 3;

function pad2(value) {
  return String(value).padStart(2, "0");
}

/**
 * "YYYY-MM" for a Date or an ISO string, in UTC (all stored timestamps are
 * UTC ISO strings, so the month boundaries line up with plain comparisons).
 * @param {Date|string} value
 */
export function monthLabel(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

/** @param {string} label */
export function isMonthLabel(label) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(label || ""));
}

/**
 * Half-open [start, end) ISO bounds of a "YYYY-MM" month.
 * @param {string} label
 */
export function monthPeriod(label) {
  const [year, month] = String(label).split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return {
    label,
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

/** @param {string} label */
export function previousMonthLabel(label) {
  const [year, month] = String(label).split("-").map(Number);
  return monthLabel(new Date(Date.UTC(year, month - 2, 1)));
}

/**
 * The most recent complete months, newest first. "now" is never included:
 * the report only ever describes a month that has finished.
 * @param {Date|string} now
 * @param {number} count
 */
export function recentMonthLabels(now, count = 6) {
  const date = now instanceof Date ? now : new Date(now);
  const labels = [];
  let cursor = monthLabel(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
  );
  for (let index = 0; index < count; index += 1) {
    cursor = previousMonthLabel(cursor);
    labels.push(cursor);
  }
  return labels;
}

/** The default report period: the last complete month before "now". */
export function defaultPeriodLabel(now) {
  return recentMonthLabels(now, 1)[0];
}

function inPeriod(timestamp, start, end) {
  if (!timestamp) return false;
  const value = String(timestamp);
  return value >= start && value < end;
}

/**
 * Projects a lead onto one period: every milestone that happened outside the
 * window is erased, and `stage` is reset so the aggregator can only credit
 * milestones it can date. Revenue survives only for deals won in the window.
 */
function project(lead, start, end) {
  const convertedAt = inPeriod(lead.convertedAt, start, end)
    ? lead.convertedAt
    : null;
  return {
    channelType: lead.channelType,
    engagementMode: lead.engagementMode,
    opportunityType: lead.opportunityType,
    actionType: lead.actionType,
    commercialModel: lead.commercialModel,
    stage: "discovered",
    contactedAt: inPeriod(lead.contactedAt, start, end) ? lead.contactedAt : null,
    repliedAt: inPeriod(lead.repliedAt, start, end) ? lead.repliedAt : null,
    meetingAt: inPeriod(lead.meetingAt, start, end) ? lead.meetingAt : null,
    convertedAt,
    revenueCents: convertedAt ? Math.max(0, Number(lead.revenueCents) || 0) : 0,
    placementStatus:
      lead.placementStatus === "published" &&
      inPeriod(lead.placementCheckedAt, start, end)
        ? "published"
        : "",
    // Carried only so the caller can split found/active; ignored downstream.
    foundInPeriod: inPeriod(lead.createdAt, start, end),
  };
}

function hasActivity(row) {
  return Boolean(
    row.contactedAt ||
      row.repliedAt ||
      row.meetingAt ||
      row.convertedAt ||
      row.placementStatus === "published",
  );
}

function typeKey(label) {
  const trimmed = String(label || "").trim();
  return trimmed ? trimmed.toLowerCase() : OTHER_CHANNEL_TYPE;
}

/**
 * Everything one period contributes, computed with the shared channel
 * aggregator. It runs twice on the same projected rows: once over the leads
 * discovered in the period (its `total` is "found") and once over the leads
 * that produced an outcome in the period (every other counter). Two passes
 * over one aggregator, rather than a second aggregator.
 */
function collect({ periodStart, periodEnd, leads, messages, snapshots }) {
  const projected = (leads || []).map((lead) =>
    project(lead, periodStart, periodEnd),
  );
  const foundStats = computeChannelStats(
    projected.filter((row) => row.foundInPeriod),
  );
  const activeStats = computeChannelStats(projected.filter(hasActivity));
  const messagesSent = (messages || []).filter(
    (message) =>
      (message.status || "sent") === "sent" &&
      inPeriod(message.sentAt, periodStart, periodEnd),
  ).length;
  const checkedChannels = new Set();
  for (const snapshot of snapshots || []) {
    if (inPeriod(snapshot.checkedAt, periodStart, periodEnd)) {
      checkedChannels.add(String(snapshot.leadId || ""));
    }
  }
  const totals = {
    found: foundStats.totals.total,
    contacted: activeStats.totals.contacted,
    replied: activeStats.totals.replied,
    meetings: activeStats.totals.meetings,
    customers: activeStats.totals.converted,
    revenueCents: activeStats.totals.revenueCents,
    placementsPublished: activeStats.totals.published,
    messagesSent,
    channelsChecked: checkedChannels.size,
  };
  return { totals, foundStats, activeStats };
}

/** Merges the "found" pass and the "outcomes" pass into one row per type. */
function mergeChannelTypes({ foundStats, activeStats }) {
  const byKey = new Map();
  const entry = (label) => {
    const key = typeKey(label);
    let found = byKey.get(key);
    if (!found) {
      found = {
        channelType: label,
        found: 0,
        contacted: 0,
        replied: 0,
        meetings: 0,
        customers: 0,
        revenueCents: 0,
      };
      byKey.set(key, found);
    }
    return found;
  };
  for (const item of foundStats.channelTypes) {
    entry(item.channelType).found += item.total;
  }
  for (const item of activeStats.channelTypes) {
    const row = entry(item.channelType);
    row.contacted += item.contacted;
    row.replied += item.replied;
    row.meetings += item.meetings;
    row.customers += item.converted;
    row.revenueCents += item.revenueCents;
  }
  return [...byKey.values()]
    .filter(
      (row) =>
        row.found ||
        row.contacted ||
        row.replied ||
        row.meetings ||
        row.customers,
    )
    .sort(
      (a, b) =>
        b.customers - a.customers ||
        b.replied - a.replied ||
        b.found - a.found ||
        a.channelType.localeCompare(b.channelType),
    )
    .slice(0, TOP_REPORT_TYPES);
}

/**
 * One comparison against the previous period. A previous value of zero has no
 * meaningful ratio, so it is reported as "new" (or "flat" at 0 → 0) instead
 * of an infinite percentage.
 */
export function compareValues(current, previous) {
  const delta = current - previous;
  if (previous === 0) {
    return {
      current,
      previous,
      delta,
      ratio: null,
      direction: current > 0 ? "new" : "flat",
    };
  }
  return {
    current,
    previous,
    delta,
    ratio: delta / previous,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

function buildHighlights(channelTypes, changes, totals) {
  const highlights = [];
  const best = channelTypes.find((row) => row.customers > 0 || row.replied > 0);
  if (best) {
    highlights.push({
      kind: "best_channel_type",
      channelType: best.channelType,
      customers: best.customers,
      replied: best.replied,
      revenueCents: best.revenueCents,
    });
  }
  if (changes) {
    // The biggest move, ignoring metrics whose sample is too small for a
    // percentage to be honest (1 → 2 is not "+100%" worth printing).
    let biggest = null;
    for (const metric of HEADLINE_METRICS) {
      const change = changes[metric];
      if (!change || change.ratio === null || change.delta === 0) continue;
      if (Math.max(change.current, change.previous) < CHANGE_MIN_SAMPLE) continue;
      if (!biggest || Math.abs(change.ratio) > Math.abs(biggest.ratio)) {
        biggest = { metric, ...change };
      }
    }
    if (biggest) highlights.push({ kind: "biggest_change", ...biggest });
    // Regressions are ranked by severity, not by metric order, so when
    // several things slipped the worst two are the ones that get printed.
    const regressions = REPORT_METRICS.map((metric) => ({
      metric,
      change: changes[metric],
    }))
      .filter(
        ({ change }) =>
          change &&
          change.ratio !== null &&
          change.previous >= REGRESSION_MIN_PREVIOUS &&
          change.ratio <= -REGRESSION_DROP,
      )
      .sort((a, b) => a.change.ratio - b.change.ratio)
      .slice(0, 2);
    for (const { metric, change } of regressions) {
      highlights.push({ kind: "regression", metric, ...change });
    }
  }
  if (!highlights.length && totals.found > 0) {
    highlights.push({ kind: "quiet_month", found: totals.found });
  }
  return highlights;
}

/**
 * @param {Object} input
 * @param {Date|string} [input.now]
 * @param {string} input.periodStart ISO, inclusive
 * @param {string} input.periodEnd ISO, exclusive
 * @param {Array<Object>} [input.leads] prospect rows (camelCase aliases)
 * @param {Array<Object>} [input.messages] outbound_messages rows
 * @param {Array<Object>} [input.snapshots] channel_snapshots rows
 * @param {Object|null} [input.previous] same shape for the preceding period;
 *   the row arrays may simply be the same arrays — rows are filtered by date.
 */
export function buildMonthlyReport({
  now = new Date(),
  periodStart,
  periodEnd,
  leads = [],
  messages = [],
  snapshots = [],
  previous = null,
}) {
  const current = collect({
    periodStart,
    periodEnd,
    leads,
    messages,
    snapshots,
  });
  const previousCollected = previous
    ? collect({
        periodStart: previous.periodStart,
        periodEnd: previous.periodEnd,
        leads: previous.leads || leads,
        messages: previous.messages || messages,
        snapshots: previous.snapshots || snapshots,
      })
    : null;
  const totals = current.totals;
  const previousTotals = previousCollected ? previousCollected.totals : null;
  const changes = previousTotals
    ? Object.fromEntries(
        REPORT_METRICS.map((metric) => [
          metric,
          compareValues(totals[metric], previousTotals[metric]),
        ]),
      )
    : null;
  const channelTypes = mergeChannelTypes(current);
  const hasAnyActivity =
    totals.found > 0 ||
    totals.contacted > 0 ||
    totals.replied > 0 ||
    totals.meetings > 0 ||
    totals.customers > 0 ||
    totals.placementsPublished > 0 ||
    totals.messagesSent > 0;
  return {
    generatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    period: { label: monthLabel(periodStart), start: periodStart, end: periodEnd },
    previousPeriod: previous
      ? {
          label: monthLabel(previous.periodStart),
          start: previous.periodStart,
          end: previous.periodEnd,
        }
      : null,
    totals,
    previousTotals,
    changes,
    channelTypes,
    // Average revenue per customer — the only per-customer money figure the
    // data supports (the service records revenue, not acquisition cost).
    revenuePerCustomerCents:
      totals.customers > 0 && totals.revenueCents > 0
        ? Math.round(totals.revenueCents / totals.customers)
        : null,
    highlights: buildHighlights(channelTypes, changes, totals),
    hasActivity: hasAnyActivity,
  };
}

const METRIC_LABELS = {
  ru: {
    found: "найдено каналов",
    contacted: "контактов",
    replied: "ответов",
    meetings: "встреч",
    customers: "клиентов",
    revenueCents: "выручка",
    placementsPublished: "размещений",
  },
  en: {
    found: "channels found",
    contacted: "contacted",
    replied: "replies",
    meetings: "meetings",
    customers: "customers",
    revenueCents: "revenue",
    placementsPublished: "placements",
  },
};

/** Localized metric name — shared by the e-mail and the dashboard table. */
export function metricLabel(metric, locale) {
  const table = METRIC_LABELS[locale === "en" ? "en" : "ru"];
  return table[metric] || metric;
}

export function formatMoney(revenueCents) {
  return `$${Math.round(revenueCents / 100).toLocaleString("en-US")}`;
}

/** Metric value formatted for display (money is the only special case). */
export function formatMetric(metric, value) {
  return metric === "revenueCents" ? formatMoney(value) : String(value);
}

/** "+12" / "−3" / "0" — the delta as the dashboard and the e-mail print it. */
export function formatDelta(metric, change) {
  if (!change) return "";
  if (change.direction === "new") {
    return metric === "revenueCents"
      ? `+${formatMoney(change.delta)}`
      : `+${change.delta}`;
  }
  const sign = change.delta > 0 ? "+" : change.delta < 0 ? "−" : "";
  const value =
    metric === "revenueCents"
      ? formatMoney(Math.abs(change.delta))
      : String(Math.abs(change.delta));
  return `${sign}${value}`;
}

export function formatPercent(change) {
  if (!change || change.ratio === null) return "";
  const percent = Math.round(change.ratio * 100);
  return `${percent > 0 ? "+" : percent < 0 ? "−" : ""}${Math.abs(percent)}%`;
}

/** "июнь 2026" / "June 2026". */
export function formatPeriod(label, locale) {
  const { start } = monthPeriod(label);
  const formatted = new Intl.DateTimeFormat(
    locale === "en" ? "en-US" : "ru-RU",
    { month: "long", year: "numeric", timeZone: "UTC" },
  ).format(new Date(start));
  // ru-RU renders "июнь 2026 г."; the abbreviation adds nothing here. Every
  // caller places the month in the nominative, so no case handling is needed.
  return formatted.replace(/\s*г\.$/, "");
}

/**
 * A highlight rendered as the one line the e-mail and the dashboard print
 * verbatim. Kept next to the computation so both surfaces say the same thing.
 */
export function highlightText(highlight, locale) {
  const ru = locale !== "en";
  if (highlight.kind === "best_channel_type") {
    const name =
      highlight.channelType === OTHER_CHANNEL_TYPE
        ? ru
          ? "прочие каналы"
          : "other channels"
        : highlight.channelType;
    const detail = highlight.customers
      ? ru
        ? `${highlight.customers} клиент(ов), ${formatMoney(highlight.revenueCents)}`
        : `${highlight.customers} customer(s), ${formatMoney(highlight.revenueCents)}`
      : ru
        ? `${highlight.replied} ответ(ов)`
        : `${highlight.replied} repl(ies)`;
    return ru
      ? `Лучший тип канала: ${name} — ${detail}.`
      : `Best channel type: ${name} — ${detail}.`;
  }
  if (highlight.kind === "biggest_change") {
    const name = metricLabel(highlight.metric, locale);
    const value = formatMetric(highlight.metric, highlight.current);
    const previous = formatMetric(highlight.metric, highlight.previous);
    const percent = formatPercent(highlight);
    return ru
      ? `Сильнее всего изменилось: ${name} — ${value} против ${previous} (${percent}).`
      : `Biggest change: ${name} — ${value} vs ${previous} (${percent}).`;
  }
  if (highlight.kind === "regression") {
    const name = metricLabel(highlight.metric, locale);
    const percent = formatPercent(highlight);
    const value = formatMetric(highlight.metric, highlight.current);
    const previous = formatMetric(highlight.metric, highlight.previous);
    return ru
      ? `Просело: ${name} — ${value} против ${previous} (${percent}).`
      : `Down: ${name} — ${value} vs ${previous} (${percent}).`;
  }
  if (highlight.kind === "quiet_month") {
    return ru
      ? `Каналы найдены (${highlight.found}), но исходов пока нет — отметьте их на странице результатов.`
      : `Channels were found (${highlight.found}) but no outcomes were logged yet.`;
  }
  return "";
}
