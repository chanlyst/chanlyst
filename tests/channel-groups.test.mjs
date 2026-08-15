import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANNEL_GROUPS,
  channelGroup,
  orderByGroup,
} from "../app/lib/channel-groups.mjs";

const lead = (over) => ({ company: "X", score: 50, ...over });

test("a channel is grouped by what the user has to do about it", () => {
  assert.equal(channelGroup(lead({ engagementMode: "free_listing" })), "free_listing");
  assert.equal(channelGroup(lead({ engagementMode: "paid_placement" })), "paid_placement");
  assert.equal(channelGroup(lead({ engagementMode: "outreach", email: "a@b.com" })), "outreach");
});

// The real run that prompted this: a media sponsorship scoring 92 whose own
// card read "public price not found — request a media kit" sat above the four
// places the user could submit to that afternoon, two of which were on page 3.
test("the list leads with what can be submitted today, not with the top score", () => {
  const ordered = orderByGroup([
    lead({ company: "SaaStr", score: 92, engagementMode: "paid_placement" }),
    lead({ company: "G2", score: 90, engagementMode: "free_listing" }),
    lead({ company: "Capterra", score: 88, engagementMode: "free_listing" }),
    lead({ company: "StackedDeal", score: 70, engagementMode: "outreach", email: "a@b.com" }),
  ]);

  assert.deepEqual(
    ordered.map((item) => item.company),
    ["G2", "Capterra", "SaaStr", "StackedDeal"],
  );
});

// Ordering, not filtering: the user's position is that the product
// systematises the search rather than deciding anyone's budget.
test("nothing is dropped — every channel survives the reordering", () => {
  const leads = [
    lead({ company: "A", score: 10, engagementMode: "paid_placement" }),
    lead({ company: "B", score: 20, engagementMode: "free_listing" }),
    lead({ company: "C", score: 30, engagementMode: "outreach", email: "c@d.com" }),
  ];
  const ordered = orderByGroup(leads);

  assert.equal(ordered.length, leads.length);
  assert.deepEqual([...ordered].map((i) => i.company).sort(), ["A", "B", "C"]);
});

test("score still decides the order inside a group", () => {
  const ordered = orderByGroup([
    lead({ company: "Low", score: 60, engagementMode: "free_listing" }),
    lead({ company: "High", score: 95, engagementMode: "free_listing" }),
  ]);

  assert.deepEqual(ordered.map((item) => item.company), ["High", "Low"]);
});

test("the input array is left alone", () => {
  const leads = [
    lead({ company: "Paid", score: 99, engagementMode: "paid_placement" }),
    lead({ company: "Free", score: 10, engagementMode: "free_listing" }),
  ];
  orderByGroup(leads);

  assert.equal(leads[0].company, "Paid");
});

test("every group has a place in the order", () => {
  assert.deepEqual(CHANNEL_GROUPS, [
    "free_listing",
    "paid_placement",
    "outreach",
    "network",
  ]);
});
