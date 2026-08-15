import { engagementModeForLead as classify } from "./engagement-mode-core.mjs";
import { isSupplySideChannel as isSupplySide } from "./discovery-guards.mjs";

export type EngagementMode =
  | "free_listing"
  | "paid_placement"
  | "outreach"
  | "unknown";

// Minimal shape shared by dashboard leads and prospect rows from D1.
export type EngagementModeSource = {
  engagementMode?: string | null;
  opportunityType?: string | null;
  actionType?: string | null;
  channelType?: string | null;
  commercialModel?: string | null;
};

/**
 * True for a channel where the advertiser lists the offer and partners find
 * it (affiliate networks, offer marketplaces) — there is nobody to write to.
 */
export function isSupplySideChannel(lead: EngagementModeSource): boolean {
  return isSupplySide(lead);
}

// The implementation lives in engagement-mode.mjs so the pure aggregation
// modules and their node:test suites can import it without a TS build step.
export function engagementModeForLead(
  lead: EngagementModeSource,
): Exclude<EngagementMode, "unknown"> {
  return classify(lead);
}
