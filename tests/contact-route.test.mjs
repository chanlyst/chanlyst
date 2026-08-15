import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  CONTACT_ROUTES,
  contactNetworkFor,
  contactRouteForLead,
  hasUsableContact,
  isReachableByOutreach,
} from "../app/lib/contact-route.mjs";
import {
  buildPageEvidence,
  formatAffiliateHint,
  planAffiliateHint,
} from "../app/lib/contact-extract.mjs";
import {
  qualifiesForSequence,
  selectEnrichmentTargets,
  selectSequenceTargets,
} from "../app/lib/pipeline-core.mjs";
import { planLeadTasks } from "../app/lib/lifecycle-rules.mjs";

const fixture = (name) =>
  readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

const hint = formatAffiliateHint({
  network: "Impact",
  domain: "alpha.pxf.io",
  url: "https://alpha.pxf.io/click?aff_id=1",
  markers: ["aff_id="],
});

// --- the route matrix ------------------------------------------------------
//
// Rows: what the row carries. Columns: the answer the whole product now agrees
// on. Every state the enrichment step can leave a lead in appears exactly once.

const matrix = [
  ["never checked, nothing found yet", {}, "direct"],
  [
    "never checked but the discovery step already had an e-mail",
    { email: "hi@alpha.example" },
    "direct",
  ],
  [
    "verified public e-mail",
    { email: "partners@alpha.example", contactStatus: "verified_public" },
    "direct",
  ],
  [
    "unverified e-mail found by the model",
    { email: "guess@alpha.example", contactStatus: "found_unverified" },
    "direct",
  ],
  [
    "telegram only",
    { telegram: "@alpha", contactStatus: "found_unverified" },
    "direct",
  ],
  [
    "linkedin only",
    { linkedin: "https://linkedin.com/in/a", contactStatus: "found_unverified" },
    "direct",
  ],
  [
    "the check itself did not finish — nothing was actually checked",
    { contactStatus: "check_failed" },
    "direct",
  ],
  [
    "the check failed even though a network fingerprint exists",
    { contactStatus: "check_failed", contactEvidence: hint },
    "direct",
  ],
  [
    "checked, no contact, an affiliate network was detected",
    { contactStatus: "not_found", contactEvidence: hint },
    "network",
  ],
  [
    "a supply-side network channel, whatever its contact columns say",
    { opportunityType: "affiliate_network", registrationUrl: "https://net.example/signup" },
    "network",
  ],
  [
    "a supply-side channel by action type, even carrying an e-mail",
    { actionType: "list_offer", email: "hi@net.example" },
    "network",
  ],
  [
    "checked, no contact, no network",
    { contactStatus: "not_found" },
    "none",
  ],
  [
    "checked, no contact, an ordinary evidence excerpt (not a network hint)",
    { contactStatus: "not_found", contactEvidence: "Партнёрская программа описана на странице." },
    "none",
  ],
];

for (const [name, lead, expected] of matrix) {
  test(`contactRouteForLead: ${name} → ${expected}`, () => {
    assert.equal(contactRouteForLead(lead), expected);
    assert.ok(CONTACT_ROUTES.includes(contactRouteForLead(lead)));
    assert.equal(isReachableByOutreach(lead), expected === "direct");
  });
}

test("contactRouteForLead survives null and junk", () => {
  assert.equal(contactRouteForLead(null), "direct");
  assert.equal(contactRouteForLead({ contactStatus: "nonsense" }), "direct");
  assert.equal(hasUsableContact({ email: "  " }), false);
});

test("contactNetworkFor names the domain the user must register with", () => {
  const network = contactNetworkFor({ contactStatus: "not_found", contactEvidence: hint });
  assert.equal(network.network, "Impact");
  assert.equal(network.domain, "alpha.pxf.io");
  assert.equal(network.url, "https://alpha.pxf.io/click?aff_id=1");
});

test("contactNetworkFor uses a supply-side channel's own signup link", () => {
  const network = contactNetworkFor({
    opportunityType: "affiliate_network",
    company: "OfferNet",
    domain: "offernet.example",
    registrationUrl: "https://advertisers.offernet.example/signup",
  });
  assert.equal(network.network, "OfferNet");
  assert.equal(network.domain, "advertisers.offernet.example");
});

test("a direct lead has no network to offer", () => {
  assert.equal(contactNetworkFor({ email: "a@b.example" }), null);
});

// --- exclusions ------------------------------------------------------------

const base = {
  id: "lead-1",
  score: 90,
  status: "review",
  outreachEligible: 1,
  contactStatus: "verified_public",
  email: "partners@alpha.example",
};

test("selectEnrichmentTargets skips network and none leads", () => {
  const channels = [
    { ...base, id: "direct", email: "", contactStatus: "not_checked" },
    { ...base, id: "failed", email: "", contactStatus: "check_failed" },
    { ...base, id: "network", email: "", contactStatus: "not_found", contactEvidence: hint },
    { ...base, id: "none", email: "", contactStatus: "not_found" },
  ];
  const picked = selectEnrichmentTargets(channels, { cap: 10 }).map((item) => item.id);
  assert.deepEqual(picked.sort(), ["direct", "failed"]);
});

test("qualifiesForSequence refuses network and none leads", () => {
  assert.ok(qualifiesForSequence(base));
  assert.equal(
    qualifiesForSequence({
      ...base,
      opportunityType: "affiliate_network",
    }),
    false,
    "a supply-side network is joined, never e-mailed",
  );
  assert.equal(
    qualifiesForSequence({
      ...base,
      email: "",
      contactStatus: "not_found",
      contactEvidence: hint,
    }),
    false,
  );
  assert.equal(
    qualifiesForSequence({ ...base, email: "", contactStatus: "not_found" }),
    false,
  );
});

test("selectSequenceTargets drafts only for direct leads", () => {
  const targets = selectSequenceTargets(
    [
      { ...base, id: "direct" },
      { ...base, id: "network", actionType: "list_offer" },
    ],
    { cap: 5 },
  );
  assert.deepEqual(targets.map((item) => item.id), ["direct"]);
});

test("lifecycle follow-up and revive skip leads with no outreach path", () => {
  const now = "2026-07-27T00:00:00.000Z";
  const long = "2026-01-01T00:00:00.000Z";
  const lead = (extra) => ({
    id: extra.id,
    workspaceId: "w",
    productId: "p",
    stage: "contacted",
    ...extra,
  });
  const leads = [
    lead({ id: "direct", email: "a@b.example", contactStatus: "verified_public" }),
    lead({ id: "network", contactStatus: "not_found", contactEvidence: hint }),
    lead({ id: "none", contactStatus: "not_found" }),
  ];
  const sequences = leads.map((item) => ({
    id: `s-${item.id}`,
    leadId: item.id,
    status: "completed",
  }));
  const events = leads.map((item) => ({ leadId: item.id, occurredAt: long }));
  const { create } = planLeadTasks({ now, leads, sequences, events, tasks: [] });
  assert.deepEqual(
    create.filter((task) => task.type === "follow_up").map((task) => task.leadId),
    ["direct"],
  );
});

test("a follow-up already open closes once the lead turns out unreachable", () => {
  const { close } = planLeadTasks({
    now: "2026-07-27T00:00:00.000Z",
    leads: [
      {
        id: "network",
        workspaceId: "w",
        productId: "p",
        stage: "contacted",
        contactStatus: "not_found",
        contactEvidence: hint,
      },
    ],
    sequences: [{ id: "s", leadId: "network", status: "completed" }],
    events: [{ leadId: "network", occurredAt: "2026-01-01T00:00:00.000Z" }],
    tasks: [{ id: "t", leadId: "network", type: "follow_up", status: "open" }],
  });
  assert.deepEqual(close.map((task) => task.reason), ["condition_cleared"]);
});

// --- the live check, driven by the fixtures, with no model spend ------------

test("datingdroid ends on the network route, aigfprices stays direct", async () => {
  // datingdroid.com publishes no contact anywhere; its outbound links carry an
  // affiliate tracker. This drives the same pure path the enrichment step uses
  // after its fetches — no network, no model, nothing billed.
  const html = await fixture("datingdroid.html");
  const evidence = buildPageEvidence(
    [{ url: "https://datingdroid.com/", html }],
    { siteDomain: "datingdroid.com" },
  );
  assert.equal(evidence.emails.length, 0, "the fixture publishes no e-mail");
  assert.ok(evidence.affiliate, "the tracker is found");
  const plan = planAffiliateHint({ hasContact: false, hint: evidence.affiliate });
  const lead = {
    company: "Dating Droid",
    domain: "datingdroid.com",
    url: "https://datingdroid.com/",
    email: "",
    telegram: "",
    linkedin: "",
    contactStatus: "not_found",
    contactEvidence: plan.contactEvidence,
  };
  assert.equal(contactRouteForLead(lead), "network");
  assert.equal(isReachableByOutreach(lead), false);
  const network = contactNetworkFor(lead);
  assert.ok(network.domain, "the card can name the network to join");
  assert.ok(/^https?:\/\//.test(network.url), "and open its URL");
  // Excluded from everything that assumes a mailbox.
  assert.equal(qualifiesForSequence({ ...lead, id: "x", outreachEligible: 1 }), false);
  assert.deepEqual(
    selectEnrichmentTargets([{ ...lead, id: "x", outreachEligible: 1 }], { cap: 5 }),
    [],
  );

  // The other fixture is monetised the same way but does publish nothing
  // either, so the "direct" half uses a page that DOES carry an address —
  // still the same pure path, still no network and no model call.
  const monetised = await fixture("aigfprices.html");
  assert.ok(
    buildPageEvidence([{ url: "https://aigfprices.com/", html: monetised }], {
      siteDomain: "aigfprices.com",
    }).affiliate,
    "the second fixture is monetised through a network too",
  );
  const otherEvidence = buildPageEvidence(
    [
      {
        url: "https://reachable.example/contact",
        html: `<html><body><h1>Contact</h1>
          <p>Partnerships: <a href="mailto:partners@reachable.example">write to us</a></p>
          </body></html>`,
      },
    ],
    { siteDomain: "reachable.example" },
  );
  assert.ok(otherEvidence.emails.length, "the page publishes an e-mail");
  const direct = {
    company: "Reachable",
    domain: "reachable.example",
    email: otherEvidence.emails[0],
    contactStatus: "verified_public",
  };
  assert.equal(contactRouteForLead(direct), "direct");
  assert.equal(isReachableByOutreach(direct), true);
});
