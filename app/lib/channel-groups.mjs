// The order the channel list is read in.
//
// Sorting purely by score put the least reachable channel first: the top of a
// real run was a media sponsorship scoring 92 whose own card said "public
// price not found — request a media kit", while the four places the user could
// submit to that afternoon sat below it and on the next page.
//
// Score still says how well a channel fits. This says what the user does about
// it, and the list leads with the group that needs nothing but an hour:
//
//   free_listing   — submit it yourself, today, for nothing
//   paid_placement — worth having, but it starts with asking a price
//   outreach       — a person has to be written to
//   network        — join an affiliate network and register the offer
//
// Nothing is hidden or dropped. This is ordering, not filtering: the paid
// channels are all still there, in their own group, because the product
// systematises the search rather than deciding the budget.

import { engagementModeForLead } from "./engagement-mode-core.mjs";
import { contactRouteForLead } from "./contact-route.mjs";

/** Group keys in the order they are shown. */
export const CHANNEL_GROUPS = [
  "free_listing",
  "paid_placement",
  "outreach",
  "network",
];

/**
 * Which group a channel belongs to. Mirrors how the mode chips already
 * classify a lead, so a group and its chip can never disagree.
 *
 * @param {Record<string, unknown>} lead
 * @returns {"free_listing" | "paid_placement" | "outreach" | "network"}
 */
export function channelGroup(lead) {
  const mode = engagementModeForLead(lead);
  // A lead reachable through an affiliate network has left the outreach
  // queue: the way in is registering the offer, not writing to anybody.
  if (mode === "outreach" && contactRouteForLead(lead) === "network") {
    return "network";
  }
  if (mode === "free_listing" || mode === "paid_placement") return mode;
  return mode === "outreach" ? "outreach" : "network";
}

/**
 * Sort position of a channel's group. Unknown groups sort last rather than
 * first, so a future mode cannot silently take over the top of the list.
 *
 * @param {Record<string, unknown>} lead
 */
export function channelGroupRank(lead) {
  const index = CHANNEL_GROUPS.indexOf(channelGroup(lead));
  return index === -1 ? CHANNEL_GROUPS.length : index;
}

/**
 * The "all channels" order: by group, then by score, then by name so the list
 * is stable between requests.
 *
 * @template {Record<string, unknown>} T
 * @param {T[]} leads
 * @returns {T[]} a new array; the input is left alone
 */
export function orderByGroup(leads) {
  return [...leads].sort((a, b) => {
    const group = channelGroupRank(a) - channelGroupRank(b);
    if (group !== 0) return group;
    const score = Number(b.score || 0) - Number(a.score || 0);
    if (score !== 0) return score;
    return String(a.company || "").localeCompare(String(b.company || ""));
  });
}
