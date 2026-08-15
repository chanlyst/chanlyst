import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  AFFILIATE_HINT_PREFIX,
  detectAffiliateNetwork,
  formatAffiliateHint,
  parseAffiliateHint,
  planAffiliateHint,
} from "../app/lib/contact-extract.mjs";
import {
  MAX_SUPPLY_SIDE_RESULTS,
  applyDiscoveryGuards,
  isSupplySideChannel,
} from "../app/lib/discovery-guards.mjs";
import { engagementModeForLead } from "../app/lib/engagement-mode-core.mjs";
import {
  buildDiscoveryPrompt,
  wantsSupplySideChannels,
} from "../app/lib/discovery-prompt.mjs";

const fixture = (name) =>
  readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

// --- detectAffiliateNetwork -------------------------------------------------

test("detectAffiliateNetwork finds generic tracker markers", () => {
  const hint = detectAffiliateNetwork(
    `<a href="https://t.example-track.com/408026/7793?aff_sub5=SF_006">go</a>`,
  );
  assert.ok(hint, "a tracker link is a hint");
  assert.equal(hint.domain, "t.example-track.com");
  assert.equal(hint.network, "t.example-track.com");
  assert.deepEqual(hint.markers, ["aff_sub5="]);
});

test("detectAffiliateNetwork names a known network and prefers it", () => {
  const hint = detectAffiliateNetwork(
    `<a href="https://plain.example.com/x?ref=abc">first</a>
     <a href="https://partner.pxf.io/c/123/456">network</a>`,
  );
  assert.equal(hint.network, "Impact");
  assert.equal(hint.domain, "partner.pxf.io");
});

test("a tracker parameter outranks a bare ?ref= merchant link", () => {
  const hint = detectAffiliateNetwork(
    `<a href="https://merchant.example/?ref=abc">merchant</a>
     <a href="https://t.tracker.example/408/7?aff_sub5=SF">tracker</a>`,
  );
  assert.equal(hint.domain, "t.tracker.example");
  assert.deepEqual(hint.markers, ["aff_sub5="]);
});

test("a bare ?ref= link is still reported when it is all there is", () => {
  const hint = detectAffiliateNetwork(`<a href="https://shop.example/?ref=abc">m</a>`);
  assert.equal(hint.domain, "shop.example");
  assert.deepEqual(hint.markers, ["ref="]);
});

test("detectAffiliateNetwork ignores ordinary outbound links", () => {
  const hint = detectAffiliateNetwork(
    `<a href="https://example.com/blog/post">blog</a>
     <a href="https://x.com/acme">x</a>
     <a href="mailto:hi@example.com">mail</a>
     <a href="/about">about</a>
     <a href="https://news.example.org/story?id=12&page=2">story</a>`,
  );
  assert.equal(hint, null);
});

test("detectAffiliateNetwork skips the site's own links", () => {
  const markup = `<a href="https://blog.acme.com/go/deal?ref=home">own</a>`;
  assert.equal(detectAffiliateNetwork(markup, "acme.com"), null);
  assert.ok(detectAffiliateNetwork(markup, "other.com"));
});

test("detectAffiliateNetwork works on the real aigfprices.com page", async () => {
  const html = await fixture("aigfprices.html");
  const hint = detectAffiliateNetwork(html, "aigfprices.com");
  assert.ok(hint, "the page monetises through a network");
  // The page has both a merchant link with ?ref= and a tracker redirector
  // carrying aff_sub5; the tracker is the one worth reporting.
  assert.deepEqual(hint.markers, ["aff_sub5="]);
  assert.match(hint.url, /aff_sub5=/);
  const evidence = formatAffiliateHint(hint);
  assert.ok(evidence.startsWith(AFFILIATE_HINT_PREFIX));
  assert.equal(parseAffiliateHint(evidence), hint.network);
});

test("a page with plain outbound links produces no hint", async () => {
  const html = `<html><body>
    <a href="https://openai.com">a</a><a href="https://example.org/docs">b</a>
  </body></html>`;
  assert.equal(detectAffiliateNetwork(html, "reviews.example"), null);
});

// --- planAffiliateHint ------------------------------------------------------

test("planAffiliateHint records nothing when a contact was found", () => {
  const hint = detectAffiliateNetwork(`<a href="https://x.pxf.io/c/1">n</a>`);
  assert.equal(planAffiliateHint({ hasContact: true, hint }), null);
  assert.equal(planAffiliateHint({ hasContact: false, hint: null }), null);
});

test("planAffiliateHint proposes a next action only for an empty field", () => {
  const hint = detectAffiliateNetwork(`<a href="https://x.pxf.io/c/1">n</a>`);
  const fresh = planAffiliateHint({ hasContact: false, hint });
  assert.match(fresh.contactEvidence, /^affiliate_network: Impact/);
  assert.match(fresh.nextAction, /рекламодатель.*Impact/);

  const written = planAffiliateHint({
    hasContact: false,
    hint,
    currentNextAction: "Написать редактору в X",
  });
  assert.equal(written.nextAction, null, "never overwrites the user's text");
  assert.equal(written.contactEvidence, fresh.contactEvidence);
});

test("parseAffiliateHint ignores an ordinary contact excerpt", () => {
  assert.equal(parseAffiliateHint("Свяжитесь с нами: ads@example.com"), "");
  assert.equal(parseAffiliateHint(""), "");
});

// --- the server-side drop rule ---------------------------------------------

const networkEntry = (extra = {}) => ({
  company: "SomeNetwork",
  opportunityType: "affiliate_network",
  actionType: "list_offer",
  registrationUrl: "https://network.example/advertisers/signup",
  ...extra,
});

test("an affiliate_network without registrationUrl is dropped and counted", () => {
  const { results, dropped } = applyDiscoveryGuards([
    networkEntry(),
    networkEntry({ company: "Invented", registrationUrl: "" }),
    networkEntry({ company: "Blank", registrationUrl: "   " }),
    { company: "Publisher", opportunityType: "affiliate_publisher", registrationUrl: "" },
  ]);
  assert.deepEqual(
    results.map((item) => item.company),
    ["SomeNetwork", "Publisher"],
  );
  assert.equal(dropped.affiliate_network_without_registration_url, 2);
});

test("supply-side entries are capped so they cannot crowd out publishers", () => {
  const many = Array.from({ length: 6 }, (_, index) =>
    networkEntry({ company: `N${index}` }),
  );
  const { results, dropped } = applyDiscoveryGuards(many);
  assert.equal(results.length, MAX_SUPPLY_SIDE_RESULTS);
  assert.equal(dropped.affiliate_network_over_cap, 6 - MAX_SUPPLY_SIDE_RESULTS);
});

test("guards leave an ordinary result set untouched", () => {
  const input = [{ company: "A", opportunityType: "directory", registrationUrl: "" }];
  const { results, dropped } = applyDiscoveryGuards(input);
  assert.deepEqual(results, input);
  assert.deepEqual(dropped, {});
});

// --- engagement mode --------------------------------------------------------

test("supply-side channels are free_listing, or paid when the network charges", () => {
  assert.equal(
    engagementModeForLead({ opportunityType: "affiliate_network" }),
    "free_listing",
  );
  assert.equal(
    engagementModeForLead({ actionType: "list_offer", commercialModel: "commission" }),
    "free_listing",
  );
  assert.equal(
    engagementModeForLead({
      opportunityType: "affiliate_network",
      commercialModel: "paid",
    }),
    "paid_placement",
  );
  assert.equal(
    engagementModeForLead({
      opportunityType: "affiliate_network",
      engagementMode: "paid_placement",
    }),
    "paid_placement",
  );
});

test("a supply-side channel is never outreach, whatever the model claimed", () => {
  const lead = {
    opportunityType: "affiliate_network",
    actionType: "list_offer",
    engagementMode: "outreach",
    channelType: "Партнёрская сеть",
  };
  assert.equal(engagementModeForLead(lead), "free_listing");
  assert.ok(isSupplySideChannel(lead));
  // outreachEligible is derived from the same predicate in discovery-core.
  assert.equal(
    lead.engagementMode === "outreach" && !isSupplySideChannel(lead),
    false,
  );
});

test("the existing taxonomy keeps its modes", () => {
  assert.equal(engagementModeForLead({ opportunityType: "directory" }), "free_listing");
  assert.equal(
    engagementModeForLead({ opportunityType: "paid_placement" }),
    "paid_placement",
  );
  assert.equal(engagementModeForLead({ opportunityType: "partner" }), "outreach");
});

// --- the prompt gate --------------------------------------------------------

const supplyLine = /Также найди партнёрские сети и маркетплейсы офферов/;

test("the supply-side instruction is absent without a reason to ask for it", () => {
  const prompt = buildDiscoveryPrompt({
    product: {
      name: "X",
      partnerTerms: "   ",
      analysis: {
        acquisitionMotions: [
          { id: "directories", score: 90 },
          { id: "creators", score: 80 },
          { id: "communities", score: 70 },
          { id: "affiliates", score: 10 },
        ],
      },
    },
  });
  assert.equal(wantsSupplySideChannels({ name: "X" }), false);
  assert.doesNotMatch(prompt, supplyLine);
});

test("partnerTerms alone opens the supply-side gate", () => {
  const product = { name: "X", partnerTerms: "30% на 12 месяцев" };
  assert.equal(wantsSupplySideChannels(product), true);
  const prompt = buildDiscoveryPrompt({ product });
  assert.match(prompt, supplyLine);
  assert.match(prompt, /opportunityType="affiliate_network", actionType="list_offer"/);
  assert.match(prompt, /registrationUrl ведёт на страницу подключения рекламодателя/);
  assert.match(prompt, /без такой ссылки не включай её вовсе/);
  assert.match(prompt, /только публично описанные условия/);
  assert.match(prompt, /Максимум 3 такие записи/);
});

test("a top affiliates or paid_placements motion opens the gate too", () => {
  for (const id of ["affiliates", "paid_placements"]) {
    const product = {
      name: "X",
      analysis: { acquisitionMotions: [{ id: "creators", score: 60 }, { id, score: 88 }] },
    };
    assert.equal(wantsSupplySideChannels(product), true, id);
    assert.match(buildDiscoveryPrompt({ product }), supplyLine);
  }
});

test("the supply-side block is the only difference the gate makes", () => {
  const closed = buildDiscoveryPrompt({ product: { name: "X" } });
  const open = buildDiscoveryPrompt({ product: { name: "X", partnerTerms: "30%" } });
  assert.ok(open.length > closed.length);
  assert.ok(open.length - closed.length < 700, "the block stays compact");
});
