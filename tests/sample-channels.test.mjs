import assert from "node:assert/strict";
import test from "node:test";
import {
  HERO_CHANNELS,
  HERO_COUNTS,
  SAMPLE_PRODUCT,
} from "../app/lib/sample-channels.mjs";
import { CHANNEL_GROUPS } from "../app/lib/channel-groups.mjs";

// The point of putting a run in the hero is that a stranger can check it. A row
// without a real domain or a real score is a claim rather than a result, and
// the page had enough claims already.
test("every row in the hero is checkable", () => {
  assert.equal(HERO_CHANNELS.length, 4);

  for (const channel of HERO_CHANNELS) {
    assert.match(channel.domain, /^[a-z0-9.-]+\.[a-z]{2,}$/, channel.name);
    assert.ok(channel.name.length > 1, "a row needs a name");
    assert.ok(channel.score > 0 && channel.score <= 100, `${channel.name} score`);
    assert.ok(
      CHANNEL_GROUPS.includes(channel.group),
      `${channel.name} is in group "${channel.group}", which the product does not have`,
    );
  }
});

// Four rows have to cover all three groups. A panel of nothing but free
// listings would advertise an easier product than the one that exists.
test("the rows span every group a run produces", () => {
  const groups = new Set(HERO_CHANNELS.map((channel) => channel.group));

  for (const group of ["free_listing", "paid_placement", "outreach"]) {
    assert.ok(groups.has(group), `the hero never shows a ${group} channel`);
  }
});

// The counter climbs while the rows appear. Its last value is the only one a
// reader could check, so it has to be the total the run actually returned.
test("the counter lands on the run's real total", () => {
  assert.equal(HERO_COUNTS.at(-1), SAMPLE_PRODUCT.found);
  assert.equal(HERO_COUNTS.length, HERO_CHANNELS.length, "one count per row");

  for (let index = 1; index < HERO_COUNTS.length; index += 1) {
    assert.ok(
      HERO_COUNTS[index] > HERO_COUNTS[index - 1],
      "a discovery count that goes down is not a discovery count",
    );
  }
});

test("the hero shows a subset, never more than was found", () => {
  assert.ok(HERO_CHANNELS.length < SAMPLE_PRODUCT.found);
});

test("no channel appears twice", () => {
  const seen = new Set(HERO_CHANNELS.map((channel) => channel.domain));
  assert.equal(seen.size, HERO_CHANNELS.length);
});

// Every row wears a sign, and the sign carries a mark rather than a slice of
// the name: "r/SaaS" and "TechnologyAdvice" do not abbreviate the same way.
test("every row has a mark short enough to fit its sign", () => {
  for (const channel of HERO_CHANNELS) {
    assert.ok(channel.mark, `${channel.name} has no mark`);
    assert.ok(channel.mark.length <= 2, `${channel.name}'s mark overflows the sign`);
  }
});
