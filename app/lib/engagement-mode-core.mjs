// Engagement-mode classification. Plain JS so the pure aggregation modules
// (channel-stats.mjs, monthly-report.mjs) and their node:test suites can use
// it; engagement-mode.ts re-exports it with the TypeScript types attached.

import { isSupplySideChannel } from "./discovery-guards.mjs";

/**
 * @typedef {Object} EngagementModeSource
 * @property {string|null} [engagementMode]
 * @property {string|null} [opportunityType]
 * @property {string|null} [actionType]
 * @property {string|null} [channelType]
 * @property {string|null} [commercialModel]
 */

/**
 * @param {EngagementModeSource} lead
 * @returns {"free_listing"|"paid_placement"|"outreach"}
 */
export function engagementModeForLead(lead) {
  // Supply-side channels (affiliate networks, offer marketplaces) are never
  // outreach: the user registers the offer instead of writing to anybody.
  // Joining is normally free and commission-based; only a network that charges
  // for the listing is a paid placement.
  if (isSupplySideChannel(lead)) {
    return lead.engagementMode === "paid_placement" ||
      lead.commercialModel === "paid"
      ? "paid_placement"
      : "free_listing";
  }
  if (
    lead.engagementMode === "free_listing" ||
    lead.engagementMode === "paid_placement" ||
    lead.engagementMode === "outreach"
  ) {
    return lead.engagementMode;
  }
  if (
    lead.opportunityType === "paid_placement" ||
    lead.actionType === "request_media_kit" ||
    /платн|paid/i.test(lead.channelType || "")
  ) {
    return "paid_placement";
  }
  if (
    lead.opportunityType === "directory" ||
    lead.actionType === "apply_listing" ||
    lead.actionType === "submit_product" ||
    /каталог|listing|заявк|directory/i.test(lead.channelType || "")
  ) {
    return "free_listing";
  }
  return "outreach";
}
