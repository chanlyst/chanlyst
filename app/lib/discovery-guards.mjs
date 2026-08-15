// Server-side guards applied to the model's discovery output, kept pure so
// `node --test` can exercise them without a Worker runtime.
//
// The rule that lives here is not a matter of taste: a supply-side channel
// (opportunityType="affiliate_network") is worth exactly one thing — the
// advertiser signup link. Without registrationUrl the entry is an unverifiable
// name of a network the user still has to find by hand, which is the shape a
// hallucination takes. Such entries are dropped and counted, never shown.

/** Opportunity types that describe a place where the ADVERTISER registers. */
export const supplySideOpportunityTypes = ["affiliate_network"];

/** Action types that mean "publish your offer here" rather than "write to". */
export const supplySideActionTypes = ["list_offer"];

/** Upper bound on supply-side entries per run, mirroring the prompt's rule. */
export const MAX_SUPPLY_SIDE_RESULTS = 3;

/**
 * @param {{opportunityType?: string|null, actionType?: string|null}} item
 * @returns {boolean}
 */
export function isSupplySideChannel(item) {
  return (
    supplySideOpportunityTypes.includes(String(item?.opportunityType || "")) ||
    supplySideActionTypes.includes(String(item?.actionType || ""))
  );
}

/**
 * Drop the entries that cannot be acted on, with a counted reason per rule.
 *
 * @template {{opportunityType?: string|null, actionType?: string|null, registrationUrl?: string|null}} T
 * @param {readonly T[]} results
 * @returns {{results: T[], dropped: Record<string, number>}}
 */
export function applyDiscoveryGuards(results) {
  /** @type {Record<string, number>} */
  const dropped = {};
  /** @type {T[]} */
  const kept = [];
  let supplySide = 0;
  for (const item of Array.isArray(results) ? results : []) {
    if (isSupplySideChannel(item)) {
      if (!String(item?.registrationUrl || "").trim()) {
        dropped.affiliate_network_without_registration_url =
          (dropped.affiliate_network_without_registration_url || 0) + 1;
        continue;
      }
      if (supplySide >= MAX_SUPPLY_SIDE_RESULTS) {
        dropped.affiliate_network_over_cap =
          (dropped.affiliate_network_over_cap || 0) + 1;
        continue;
      }
      supplySide += 1;
    }
    kept.push(item);
  }
  return { results: kept, dropped };
}
