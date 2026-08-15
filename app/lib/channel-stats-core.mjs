import { engagementModeForLead } from "./engagement-mode-core.mjs";

// Pure per-mode / per-channel-type aggregation. Plain JS so both the typed
// wrapper (channel-stats.ts) and the monthly report (monthly-report.mjs, plus
// its node:test suite) share one implementation — there is exactly one place
// that decides what "contacted" or "converted" means.
//
// Raw counts only: rates (reply rate, conversion) are derived by the client
// so a single source of truth exists for every number that is displayed.

/**
 * @typedef {Object} ChannelMetrics
 * @property {number} total
 * @property {number} contacted
 * @property {number} replied
 * @property {number} meetings
 * @property {number} converted
 * @property {number} revenueCents
 * @property {number} published
 */

/**
 * @typedef {Object} ChannelStatsRow
 * @property {string|null} [channelType]
 * @property {string|null} [engagementMode]
 * @property {string|null} [opportunityType]
 * @property {string|null} [actionType]
 * @property {string|null} [commercialModel]
 * @property {string|null} [stage]
 * @property {string|null} [contactedAt]
 * @property {string|null} [repliedAt]
 * @property {string|null} [meetingAt]
 * @property {string|null} [convertedAt]
 * @property {number|null} [revenueCents]
 * @property {string|null} [placementStatus]
 */

const TOP_CHANNEL_TYPES = 12;

// Sentinel label for the tail beyond the top channel types and for rows
// without a channel_type label. The client maps it to a localized string.
export const OTHER_CHANNEL_TYPE = "__other__";

/** @returns {ChannelMetrics} */
export function emptyMetrics() {
  return {
    total: 0,
    contacted: 0,
    replied: 0,
    meetings: 0,
    converted: 0,
    revenueCents: 0,
    published: 0,
  };
}

// Stage transitions and *_at timestamps are both server-stamped, but older
// rows (or rows moved by other code paths) may carry only one of the two, so
// each milestone accepts either signal. "lost" leads still count as contacted
// when contacted_at proves the touch happened.
/**
 * @param {ChannelMetrics} metrics
 * @param {ChannelStatsRow} row
 */
function addRow(metrics, row) {
  const stage = String(row.stage || "discovered");
  metrics.total += 1;
  if (
    row.contactedAt ||
    ["contacted", "replied", "meeting", "won"].includes(stage)
  ) {
    metrics.contacted += 1;
  }
  if (row.repliedAt || ["replied", "meeting", "won"].includes(stage)) {
    metrics.replied += 1;
  }
  if (row.meetingAt || ["meeting", "won"].includes(stage)) {
    metrics.meetings += 1;
  }
  const converted = Boolean(row.convertedAt) || stage === "won";
  if (converted) {
    metrics.converted += 1;
    metrics.revenueCents += Math.max(0, Number(row.revenueCents) || 0);
  }
  if (row.placementStatus === "published") metrics.published += 1;
}

/**
 * @param {ChannelStatsRow[]} rows
 */
export function computeChannelStats(rows) {
  const modes = {
    free_listing: emptyMetrics(),
    paid_placement: emptyMetrics(),
    outreach: emptyMetrics(),
  };
  const totals = emptyMetrics();
  /** @type {Map<string, ChannelMetrics & { channelType: string }>} */
  const byType = new Map();
  for (const row of rows) {
    addRow(totals, row);
    addRow(modes[engagementModeForLead(row)], row);
    // Channel types are free-text labels, so group them case-insensitively
    // but keep the first-seen spelling for display.
    const label = String(row.channelType || "").trim();
    const key = label ? label.toLowerCase() : OTHER_CHANNEL_TYPE;
    let entry = byType.get(key);
    if (!entry) {
      entry = {
        channelType: label || OTHER_CHANNEL_TYPE,
        ...emptyMetrics(),
      };
      byType.set(key, entry);
    }
    addRow(entry, row);
  }
  const ranked = [...byType.values()].sort(
    (a, b) => b.total - a.total || a.channelType.localeCompare(b.channelType),
  );
  const labelled = ranked.filter(
    (item) => item.channelType !== OTHER_CHANNEL_TYPE,
  );
  const top = labelled.slice(0, TOP_CHANNEL_TYPES);
  // Everything beyond the top list — plus unlabelled rows — folds into one
  // "other" bucket so the table stays bounded.
  const rest = ranked.filter((item) => !top.includes(item));
  const channelTypes = [...top];
  if (rest.length) {
    const other = {
      channelType: OTHER_CHANNEL_TYPE,
      ...emptyMetrics(),
    };
    for (const item of rest) {
      other.total += item.total;
      other.contacted += item.contacted;
      other.replied += item.replied;
      other.meetings += item.meetings;
      other.converted += item.converted;
      other.revenueCents += item.revenueCents;
      other.published += item.published;
    }
    channelTypes.push(other);
  }
  return { modes, channelTypes, totals };
}
