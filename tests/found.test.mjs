import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  FOUND_GROUPS,
  foundGroup,
  foundSummary,
  hostFor,
  linkFor,
  placementLabel,
  publicChannel,
  termsFor,
} from "../app/lib/found-core.mjs";

/** A row shaped like the database gives it, contacts and all. */
function row(overrides = {}) {
  return {
    id: "p1",
    company: "Example Directory",
    domain: "www.example.com",
    url: "https://example.com/submit",
    reason: "Lists B2B tools by category.",
    score: 80,
    engagementMode: "free_listing",
    pricingSummary: "",
    placementRequirements: "Screenshots and a pricing page.",
    usageTerms: "",
    registrationUrl: "https://example.com/add",
    placementStatus: "submitted",
    placementUrl: "",
    placementCheckedAt: "2026-08-01T10:00:00.000Z",
    siteTitle: "Example — software directory",
    relevance: "ok",
    updatedAt: "2026-07-20T10:00:00.000Z",
    ...overrides,
  };
}

// The promise the page makes in its own last paragraph. A person must not be
// publishable, and the guarantee has to survive somebody adding a field later,
// so it is asserted against the shape rather than against today's template.
test("no personal field can reach the page", () => {
  const published = publicChannel(
    row({
      contact: "Jane Doe",
      email: "jane@example.com",
      telegram: "@jane",
      linkedin: "https://linkedin.com/in/jane",
      contactRole: "Head of Partnerships",
      contactEvidence: "found on the about page",
      contactSourceUrl: "https://example.com/about",
      actionUrl: "mailto:jane@example.com",
    }),
  );

  const serialised = JSON.stringify(published).toLowerCase();
  for (const secret of [
    "jane",
    "@jane",
    "linkedin.com/in",
    "head of partnerships",
    "mailto:",
    "about page",
  ]) {
    assert.equal(
      serialised.includes(secret.toLowerCase()),
      false,
      `${secret} survived into the public shape`,
    );
  }
});

// The paid bucket said "request a media kit" and never said where. The link
// was in the row the whole time, under action_url, which the query used to
// exclude wholesale because on an outreach row it is often a mailto: or a
// profile. Wholesale was too blunt: a form and an advertise page are not
// people.
test("a paid placement says where to ask, an outreach channel does not", () => {
  const paid = publicChannel(
    row({
      engagementMode: "paid_placement",
      registrationUrl: "",
      actionUrl: "https://advertise.example.com/",
    }),
  );
  assert.equal(paid.submitUrl, "https://advertise.example.com/");
  assert.equal(paid.submitLabel, "where to ask");

  // On an outreach row the action is a person, so it is never borrowed.
  const person = publicChannel(
    row({
      engagementMode: "outreach",
      registrationUrl: "",
      actionUrl: "https://linkedin.com/in/someone",
    }),
  );
  assert.equal(person.submitUrl, "", "an outreach action link reached the page");

  // A submission form still wins where there is one.
  const free = publicChannel(
    row({
      engagementMode: "free_listing",
      registrationUrl: "https://example.com/add",
      actionUrl: "https://example.com/other",
    }),
  );
  assert.equal(free.submitUrl, "https://example.com/add");
  assert.equal(free.submitLabel, "where to submit");
});

// The query is the boundary, not the template: the columns that hold a person
// are never selected, so no markup change can start showing them.
test("the query never selects a contact column", () => {
  const source = readFileSync("app/lib/found.ts", "utf8");
  const select = source.slice(
    source.indexOf("const COLUMNS"),
    source.indexOf("showcaseProductId"),
  );

  for (const column of [
    "contact,",
    "email",
    "telegram",
    "linkedin",
    "contact_role",
    "contact_status",
    "contact_source_url",
    "contact_evidence",
    "contact_confidence",
  ]) {
    assert.equal(
      select.includes(column),
      false,
      `${column} is selected by the public query`,
    );
  }
});

// registration_url is a submission form, except when discovery stored a way to
// reach a human in it. That is the field the contact leaks through if nobody
// checks the scheme.
test("only http links are published", () => {
  assert.equal(linkFor("https://example.com/add"), "https://example.com/add");
  assert.equal(linkFor("http://example.com"), "http://example.com/");
  assert.equal(linkFor("mailto:jane@example.com"), "");
  assert.equal(linkFor("tel:+15550000"), "");
  assert.equal(linkFor("javascript:alert(1)"), "");
  assert.equal(linkFor("https://t.me/jane"), "https://t.me/jane", "a public channel link is a place");
  assert.equal(linkFor(""), "");
  assert.equal(linkFor("not a url"), "");

  const leaked = publicChannel(row({ registrationUrl: "mailto:jane@example.com" }));
  assert.equal(leaked.submitUrl, "");
});

test("a channel is placed in one of the three buckets", () => {
  assert.equal(foundGroup(row()), "free_listing");
  assert.equal(foundGroup(row({ engagementMode: "paid_placement" })), "paid_placement");
  assert.equal(foundGroup(row({ engagementMode: "outreach" })), "outreach");
  // Nothing may fall outside the three the page renders.
  for (const mode of ["", "nonsense", null]) {
    assert.ok(FOUND_GROUPS.includes(foundGroup(row({ engagementMode: mode }))));
  }
});

// The whole argument for publishing a real run is that it shows the real
// quality of the output. A missing price has to be visible as a missing price.
test("gaps are labelled rather than dropped", () => {
  const terms = termsFor(row({ pricingSummary: "", usageTerms: "" }));
  const price = terms.find(([label]) => label === "Price");

  assert.equal(price[1], "");
  assert.equal(price[2], "not published");
  assert.equal(terms.length, 3, "every term keeps its row even when empty");

  const requirements = terms.find(([label]) => label === "What it requires");
  assert.equal(requirements[2], "", "a present value is not marked missing");
});

test("the summary counts what the headline claims", () => {
  const data = foundSummary([
    row({ id: "a", placementStatus: "published" }),
    row({ id: "b", placementStatus: "submitted", pricingSummary: "$500 a slot." }),
    row({
      id: "c",
      engagementMode: "outreach",
      placementStatus: "",
      pricingSummary: "",
      placementRequirements: "",
      usageTerms: "",
    }),
  ]);

  assert.equal(data.total, 3);
  assert.equal(data.published, 1);
  assert.equal(data.submitted, 1);
  // Counted per term. The old single "carries nothing" figure was true and
  // read as though every card were empty, which none of them are.
  assert.equal(data.withRequirements, 2);
  assert.equal(data.withPrice, 1);
  assert.deepEqual(
    data.groups.map((group) => group.key),
    ["free_listing", "outreach"],
    "an empty bucket is not rendered",
  );
});

// usage_terms is empty for all 46 channels in the real run. Printing "not
// published" against it once per card is not honesty, it is a broken-looking
// page describing a field nobody filled in.
test("a term nobody in the run has is dropped, per-channel gaps are not", () => {
  const data = foundSummary([
    row({ id: "a", usageTerms: "", pricingSummary: "" }),
    row({ id: "b", usageTerms: "", pricingSummary: "$500 a slot." }),
  ]);

  const labels = data.groups[0].channels.map((channel) =>
    channel.terms.map(([label]) => label),
  );
  for (const set of labels) {
    assert.equal(set.includes("Terms of use"), false, "an unused term is still shown");
    assert.ok(set.includes("Price"), "a term someone has stays on every card");
  }

  // The channel without a price still says so rather than losing the row.
  const priceless = data.groups[0].channels.find((channel) => channel.id === "a");
  const price = priceless.terms.find(([label]) => label === "Price");
  assert.equal(price[2], "not published");
});

test("placement status is reported, never invented", () => {
  assert.equal(placementLabel({ placementStatus: "published" }), "Published");
  assert.equal(placementLabel({ placementStatus: "rejected" }), "Rejected");
  assert.equal(placementLabel({}), "", "no submission means no claim");
  assert.equal(placementLabel({ placementStatus: "weird" }), "");
});

test("the host is shown without the scheme", () => {
  assert.equal(hostFor(row()), "example.com");
  assert.equal(hostFor(row({ domain: "" })), "example.com");
  assert.equal(hostFor(row({ domain: "", url: "" })), "");
});

// The number in the headline is the page's entire claim, so it may not be a
// constant anywhere.
test("the headline count comes from the data", () => {
  const page = readFileSync("app/found/page.tsx", "utf8");
  assert.ok(page.includes("{data.total} places"), "the count must be read from the query");
  assert.ok(page.includes("!data ?"), "an unreadable database must not render a number");
  assert.equal(
    /found (60|42|\d+) places for itself/.test(page.replace("{data.total}", "N")),
    false,
    "the count is hard-coded",
  );
});

test("the home page starts a visitor's own run", () => {
  const home = readFileSync("app/home-screen.tsx", "utf8");
  assert.ok(home.includes("<AcquisitionPreview"), "the hero must start the acquisition preview");
  assert.equal(
    home.includes('href="/contact" data-track="contact_hero"'),
    false,
    "the hero still offers a conversation instead",
  );
});

// The showcase product does not live in workspace-owner on production — that
// workspace holds something else entirely. Selecting by workspace published
// the wrong product's run under a headline claiming it was ours, so the
// selection is by our own domain, and the channel query is scoped by product.
test("the run published is the one for this site", () => {
  const source = readFileSync("app/lib/found.ts", "utf8");

  assert.ok(
    source.includes("website LIKE '%chanlyst.com%'"),
    "the showcase product must be identified by this site's own domain",
  );
  assert.equal(
    /FROM products[\s\S]{0,200}workspace_id\s*=/.test(source),
    false,
    "a workspace filter picks the wrong product on production",
  );
  assert.ok(
    source.includes("FOUND_PRODUCT_ID"),
    "production must be able to pin the product explicitly",
  );
  assert.ok(
    /FROM prospects WHERE product_id = \?1/.test(source),
    "channels are scoped by product, which is already unique",
  );
});

// The paid bucket came back with an empty registrationUrl fourteen times out
// of fourteen, and the reason was in the prompt: the field was defined as a
// "registration, submit/listing form", which is the vocabulary of a free
// directory. A sponsorship has no submission form.
test("the discovery prompt defines the link for a paid placement too", () => {
  const prompt = readFileSync("app/lib/discovery-prompt.mjs", "utf8");

  assert.ok(
    prompt.includes("advertise/sponsorship/media kit"),
    "registrationUrl is still defined only for free listings",
  );
  // Futurepedia prints $247 and $497 on its submit page and the run stored
  // nothing, so the prompt now says to carry a printed price across.
  assert.ok(
    prompt.includes("прайс опубликован прямо на форме"),
    "the prompt no longer asks for a price that is printed on the page",
  );
});
