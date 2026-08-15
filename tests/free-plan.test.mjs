import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { freePlan, planCatalog } from "../app/lib/plans.mjs";

// The free tier existed and was enforced for weeks while the marketing page
// advertised $49 as the entry price, because the limits lived in a file the
// page could not import. Both now read the same object.
test("the free tier is a real plan, not a trial", () => {
  assert.equal(freePlan.monthlyUsd, 0);
  assert.equal(freePlan.available, true);
  for (const key of Object.keys(planCatalog.starter.limits)) {
    assert.ok(
      freePlan.limits[key] <= planCatalog.starter.limits[key],
      `free.${key} must not exceed starter.${key}`,
    );
  }
});

// The allowance answers "can a free user reach a first submission", not "what
// does a free user cost". deploy/activation-depth.mjs put the only observed
// distance to a first submission at 30 channels — a sample of one, so this
// holds the floor rather than the exact figure.
test("free reaches far enough to produce a result", () => {
  assert.ok(
    freePlan.limits.channelsPerMonth >= 30,
    "below the only measured distance to a first submission",
  );
  assert.ok(freePlan.limits.products >= 1);
  // Roughly a third of channels discovered so far need a contact behind them.
  assert.ok(
    freePlan.limits.contactChecksPerMonth * 3 >= freePlan.limits.channelsPerMonth,
    "outreach channels outnumber the contact checks that make them usable",
  );
});

// Measured on production usage: discover $0.143 for seven channels, contact
// check $0.068, analyse $0.030, a draft $0.003.
//
// The ceiling used to be a dollar, chosen so abuse would not be worth anyone's
// time. It is now $2.50, chosen against a $49 subscription: the failure this
// plan can actually suffer is a user who never sees a result, and that is
// worth more than the difference. It is still a ceiling — a free month that
// costs real money is a decision, not a drift.
test("a fully used free month stays under the ceiling", () => {
  const cost =
    (freePlan.limits.channelsPerMonth / 7) * 0.143 +
    freePlan.limits.contactChecksPerMonth * 0.068 +
    0.03 +
    freePlan.limits.aiMessagesPerMonth * 0.003;

  assert.ok(cost < 2.5, `free month costs $${cost.toFixed(2)}`);
});

// The page builds its bullet lists from these limits now. This catches the
// other half of the same bug: hand-written copy that promised Pro 500 channels
// where the limiter allowed 300, and Scale five seats where it allowed ten.
test("the marketing page states no plan numbers of its own", () => {
  // The marketing markup lives in home-screen.tsx; page.tsx is the server
  // wrapper that counts the visit and renders it.
  const page = readFileSync("app/home-screen.tsx", "utf8");

  assert.equal(page.includes("planItems"), false, "hand-written plan bullets are back");
  assert.match(page, /planFeatures\(plan\.limits\)/);
});

// The reason PROJECT_STATUS.md drifted to $29/$49/$99 and 100/500/2000 is that
// nothing noticed. Prices and limits are going to change again; this makes the
// document change with them instead of quietly describing a product we stopped
// selling a month ago.
test("the status document states the prices the code charges", () => {
  const doc = readFileSync("docs/PROJECT_STATUS.md", "utf8");

  for (const plan of Object.values(planCatalog)) {
    assert.ok(
      doc.includes(`$${plan.monthlyUsd}`),
      `${plan.name} costs $${plan.monthlyUsd} and the document does not say so`,
    );
  }
  for (const [plan, limits] of [
    ["free", freePlan.limits],
    ...Object.entries(planCatalog).map(([id, plan]) => [id, plan.limits]),
  ]) {
    assert.ok(
      doc.includes(String(limits.channelsPerMonth).replace(/(\d)(\d{3})$/, "$1 $2")),
      `the ${plan} channel allowance is missing from the document`,
    );
  }
  // The old single "AI-запросов" counter described a limit that no longer
  // exists; naming it again would misdescribe the product a second time.
  assert.equal(
    doc.includes("AI-запросов в месяц"),
    false,
    "the document is back to a single AI counter the code does not have",
  );
});
