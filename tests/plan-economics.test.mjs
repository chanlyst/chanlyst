import assert from "node:assert/strict";
import test from "node:test";
import { planCatalog } from "../app/lib/plans.mjs";

// What each operation actually costs us, measured from the ai_usage table on
// 29 July 2026 (averages over successful calls):
const COST = {
  /** One discovery run, which returns about seven channels. */
  discoveryRun: 0.145,
  channelsPerRun: 7,
  /** One contact check — the expensive one, and the reason it has its own limit. */
  contactCheck: 0.084,
  /** Analysis, prefill or a drafted message. */
  aiMessage: 0.028,
};

/** Gumroad keeps 10% + $0.50 of every direct sale. */
const netRevenue = (gross) => gross - gross * 0.1 - 0.5;

/** What a month costs us if a customer uses everything the plan promises. */
function worstCaseCost(limits) {
  const runs = limits.channelsPerMonth / COST.channelsPerRun;
  return (
    runs * COST.discoveryRun +
    limits.contactChecksPerMonth * COST.contactCheck +
    limits.aiMessagesPerMonth * COST.aiMessage
  );
}

// The old Scale plan allowed 2 000 channels and 1 000 AI operations for $99,
// which cost about $126 to serve — a customer using what they bought lost us
// money. Nothing in the code would have said so.
test("no plan loses money when a customer uses everything it promises", () => {
  for (const [id, plan] of Object.entries(planCatalog)) {
    const cost = worstCaseCost(plan.limits);
    const net = netRevenue(plan.monthlyUsd);
    assert.ok(
      cost < net,
      `${id}: worst-case cost $${cost.toFixed(2)} exceeds net revenue $${net.toFixed(2)}`,
    );
  }
});

test("worst-case cost stays under a third of net revenue", () => {
  for (const [id, plan] of Object.entries(planCatalog)) {
    const share = worstCaseCost(plan.limits) / netRevenue(plan.monthlyUsd);
    assert.ok(
      share < 0.34,
      `${id}: worst case eats ${(share * 100).toFixed(0)}% of net revenue`,
    );
  }
});

// Annual billing is the discount, not a different product: two months free.
test("annual pricing is consistent across plans", () => {
  for (const [id, plan] of Object.entries(planCatalog)) {
    assert.equal(plan.annualUsd, plan.monthlyUsd * 10, `${id} annual price`);
  }
});

test("every plan is strictly more generous than the one below it", () => {
  const order = ["starter", "pro", "scale"];
  const keys = [
    "products",
    "channelsPerMonth",
    "contactChecksPerMonth",
    "aiMessagesPerMonth",
    "workspaceMembers",
  ];
  for (let i = 1; i < order.length; i += 1) {
    const lower = planCatalog[order[i - 1]];
    const higher = planCatalog[order[i]];
    assert.ok(higher.monthlyUsd > lower.monthlyUsd, `${order[i]} price`);
    for (const key of keys) {
      assert.ok(
        higher.limits[key] >= lower.limits[key],
        `${order[i]}.${key} (${higher.limits[key]}) is below ${order[i - 1]} (${lower.limits[key]})`,
      );
    }
  }
});
