// Rewrites the six Gumroad product descriptions from the plan catalogue.
//
// The descriptions were written by hand once and then the plans changed:
// Pro promised 500 channels where the plan gives 300, Scale promised 2 000
// against 1 000. That text is not decoration — it is the offer a buyer reads,
// it is what Gumroad puts in og:description for link previews, and it is in
// the page HTML for crawlers even behind a custom landing page. It has to say
// what the plan actually does.
//
//   GUMROAD_ACCESS_TOKEN=… node deploy/gumroad-descriptions.mjs [--dry]

import { PLANS } from "./gumroad-landing.mjs";
import { planCatalog } from "../app/lib/plans.mjs";

const API = "https://api.gumroad.com/v2";

// Opens by naming the unit of output. Read without that, the product lands in
// the contact-database category — an agent that researched it from the outside
// filed it next to Apollo and Clay, which sell people, not places.
const LEAD =
  "Contact databases give you people. Chanlyst gives you places: the " +
  "directories, communities, creators, newsletters and partners that already " +
  "own your paying audience, each with the reason it fits, what it requires " +
  "and a ready-to-review outreach draft. Nothing is sent without your click.";

/**
 * Limits read from the catalogue the app enforces, not from the display list:
 * "a month" belongs to the metered ones, seats are not monthly, and a
 * description that reads oddly is a description nobody trusts.
 */
function limitsSentence(plan) {
  const limits = planCatalog[plan.name.toLowerCase()].limits;
  const products = `${limits.products} active product${limits.products === 1 ? "" : "s"}`;
  const seats = `${limits.workspaceMembers} seat${limits.workspaceMembers === 1 ? "" : "s"}`;
  const period = plan.recurrence === "yearly" ? ", billed yearly" : "";
  return (
    `${plan.name} covers ${products}, ${limits.channelsPerMonth.toLocaleString("en-US")} ` +
    `qualified channels and ${limits.contactChecksPerMonth} contact checks a month, ` +
    `with ${seats}${period}.`
  );
}

async function main() {
  const token = process.env.GUMROAD_ACCESS_TOKEN;
  const dry = process.argv.includes("--dry");
  if (!token) throw new Error("GUMROAD_ACCESS_TOKEN не задан");

  for (const plan of PLANS) {
    const description = `${LEAD} ${limitsSentence(plan)}`;
    if (dry) {
      console.log(`${plan.permalink}\n  ${description}\n`);
      continue;
    }
    const response = await fetch(`${API}/products/${encodeURIComponent(plan.id)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    const payload = await response.json();
    console.log(
      `${plan.permalink.padEnd(17)} http:${response.status} ${payload?.success ? "ok" : JSON.stringify(payload).slice(0, 120)}`,
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
