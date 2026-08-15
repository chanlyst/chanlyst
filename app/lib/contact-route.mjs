// How a lead can actually be reached — the one question the card, the
// pipeline, the sequence engine and the lifecycle rules all used to answer
// separately, and wrongly.
//
// datingdroid.com publishes no contact anywhere; enrichment concluded exactly
// that and additionally found that its outbound links run through an affiliate
// network. The card still offered «Найти контакт», the leads list still filed
// it under «для рассылки», the pipeline still spent enrichment money on it and
// the lifecycle rules still planned follow-ups for a mailbox that does not
// exist. Every one of those asks the user to hunt for something the service
// already knows is not there.
//
// The route is DERIVED, never stored: every input already lives on the row
// (contact_status, email/telegram/linkedin, contact_evidence, opportunity_type
// and action_type), every caller already loads them, and a derived value can
// never fall out of sync with the enrichment result that produced it. That is
// strictly cheaper than an additive column plus a migration plus a backfill.
//
// Kept as an .mjs module so `node --test` imports it directly while the
// TypeScript routes and the dashboard import it through allowJs.

import { parseAffiliateHintDetails } from "./contact-extract.mjs";
import { isSupplySideChannel } from "./discovery-guards.mjs";

/**
 * @typedef {"direct" | "network" | "none"} ContactRoute
 *
 * direct  — a usable contact exists, or the contact has not been settled yet
 *           (never checked, or the check itself failed): writing is still on
 *           the table and looking for a contact is worth the money.
 * network — nobody to write to, but an affiliate network was detected (or the
 *           channel is itself a supply-side network): the way in is to
 *           register there as an advertiser.
 * none    — checked, no contact, no network: manual research or reject.
 */

/** Every route, in the order the UI groups them. */
export const CONTACT_ROUTES = /** @type {ContactRoute[]} */ ([
  "direct",
  "network",
  "none",
]);

/** Contact statuses that mean the check ran to a conclusion. */
const SETTLED_STATUSES = new Set([
  "verified_public",
  "found_unverified",
  "not_found",
]);

/**
 * @typedef {Object} ContactRouteSource
 * @property {string|null} [email]
 * @property {string|null} [telegram]
 * @property {string|null} [linkedin]
 * @property {string|null} [contactStatus]
 * @property {string|null} [contactEvidence]
 * @property {string|null} [opportunityType]
 * @property {string|null} [actionType]
 * @property {string|null} [registrationUrl]
 * @property {string|null} [actionUrl]
 * @property {string|null} [url]
 * @property {string|null} [company]
 * @property {string|null} [domain]
 */

/**
 * True when the row already carries something a human could write to.
 * @param {ContactRouteSource} lead
 */
export function hasUsableContact(lead) {
  return Boolean(
    String(lead?.email || "").trim() ||
      String(lead?.telegram || "").trim() ||
      String(lead?.linkedin || "").trim(),
  );
}

/**
 * The network to register with, or null when there is none.
 *
 * Two sources, in order: a channel that IS a supply-side network (its own
 * registration link is the way in), and the affiliate fingerprint enrichment
 * stored in contact_evidence for a channel that publishes no contact.
 *
 * @param {ContactRouteSource} lead
 * @returns {{network: string, url: string, domain: string} | null}
 */
export function contactNetworkFor(lead) {
  if (!lead) return null;
  if (isSupplySideChannel(lead)) {
    const url = String(
      lead.registrationUrl || lead.actionUrl || lead.url || "",
    ).trim();
    let domain = String(lead.domain || "").trim();
    try {
      if (url) domain = new URL(url).hostname.replace(/^www\./, "") || domain;
    } catch {
      // Keep the row's own domain when the stored link is unusable.
    }
    const network = String(lead.company || "").trim() || domain;
    if (!network) return null;
    return { network, url, domain: domain || network };
  }
  return parseAffiliateHintDetails(lead.contactEvidence || "");
}

/**
 * The single place that decides how this lead can be reached.
 *
 * @param {ContactRouteSource} lead
 * @returns {ContactRoute}
 */
export function contactRouteForLead(lead) {
  // A supply-side channel has nobody to write to by construction, whatever
  // its contact columns happen to hold.
  if (isSupplySideChannel(lead || {})) return "network";
  if (hasUsableContact(lead)) return "direct";
  // Not checked, or the check did not finish: the question is still open, so
  // the user is still allowed to spend a check on it.
  if (!SETTLED_STATUSES.has(String(lead?.contactStatus || ""))) return "direct";
  return contactNetworkFor(lead) ? "network" : "none";
}

/**
 * True for a lead that has an outreach path. Everything that assumes a mailbox
 * — sequence qualification, the pipeline's enrichment targets and draft
 * building, the follow-up and revive lifecycle rules — gates on this.
 *
 * @param {ContactRouteSource} lead
 */
export function isReachableByOutreach(lead) {
  return contactRouteForLead(lead) === "direct";
}
