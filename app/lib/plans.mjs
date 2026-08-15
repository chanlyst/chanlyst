// Plans, and the limits that decide whether a plan pays for itself.
//
// Checking a contact costs about four times what finding a channel does
// ($0.084 against $0.021 measured on real runs), so the two are counted
// separately. Bundled together under "AI messages" the expensive operation was
// invisible: the old Scale plan allowed a month of work that cost more to
// serve than the plan charged for it.
//
// Every limit here is set so a customer using everything they were sold stays
// inside roughly a quarter of the net revenue for that plan, after Gumroad's
// 10% + $0.50.

export const planCatalog = {
  starter: {
    id: "starter",
    name: "Starter",
    monthlyUsd: 49,
    annualUsd: 490,
    available: true,
    limits: {
      products: 1,
      channelsPerMonth: 100,
      contactChecksPerMonth: 60,
      aiMessagesPerMonth: 150,
      workspaceMembers: 1,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyUsd: 99,
    annualUsd: 990,
    available: true,
    limits: {
      products: 5,
      channelsPerMonth: 300,
      contactChecksPerMonth: 150,
      aiMessagesPerMonth: 300,
      workspaceMembers: 3,
    },
  },
  scale: {
    id: "scale",
    name: "Scale",
    monthlyUsd: 249,
    annualUsd: 2490,
    available: true,
    limits: {
      products: 20,
      channelsPerMonth: 1_000,
      contactChecksPerMonth: 350,
      aiMessagesPerMonth: 700,
      workspaceMembers: 10,
    },
  },
};

/**
 * What a workspace without a subscription gets. It is not a trial: nothing
 * expires, the allowance simply resets with the month.
 *
 * It lived inside usage-limits.ts, which imports the worker environment and so
 * cannot be read by the marketing page — which is why the site advertised $49
 * as the entry price while the product had been letting people in for nothing
 * the whole time. It belongs here, beside the plans it is compared against.
 *
 * The allowance is set by how far it is to the first result, not by what the
 * allowance costs. Customers pay for placements, not for found channels: a
 * free user who receives ten channels and publishes nothing leaves regardless
 * of what those ten cost us to produce, and an allowance that cannot reach the
 * first submission fails for a reason no pricing page can fix.
 *
 * Measured with deploy/activation-depth.mjs against production on 6 August
 * 2026: the only first submission on record came at the 30th channel
 * discovered. **That is a sample of one**, and it measures discovery order
 * rather than choice — the channel we submitted to happened to be found 30th,
 * which is not the same as needing 30 to find one worth submitting. So this is
 * a direction, not a threshold, and it should be re-measured as soon as a
 * second product reaches a submission.
 *
 * Second: what it costs. About $1.44 a month at these limits — roughly four
 * and a half discovery runs at $0.143, ten contact checks at $0.068, one
 * analysis at $0.030 and thirty drafts at $0.003. Against a $49 subscription
 * that is noise, and against zero activation it is the whole question.
 */
export const freePlan = {
  id: "free",
  name: "Free",
  monthlyUsd: 0,
  annualUsd: 0,
  available: true,
  limits: {
    products: 1,
    channelsPerMonth: 30,
    // Outreach is 49 of the 127 channels discovered so far, so roughly a third
    // of an allowance needs a contact behind it.
    contactChecksPerMonth: 10,
    aiMessagesPerMonth: 30,
    workspaceMembers: 1,
  },
};

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isPlanId(value) {
  return value in planCatalog;
}
