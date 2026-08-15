import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { freePlan, planCatalog } from "../app/lib/plans.mjs";
import { FAQ } from "../app/lib/faq.mjs";
import { SITE_URL, homepageGraph } from "../app/lib/structured-data.mjs";

const graph = homepageGraph({ freePlan, planCatalog, faq: FAQ.en });
const nodes = Object.fromEntries(
  graph["@graph"].map((node) => [node["@type"], node]),
);

test("the graph declares the three things a crawler needs", () => {
  assert.equal(graph["@context"], "https://schema.org");
  assert.deepEqual(Object.keys(nodes).sort(), [
    "FAQPage",
    "Organization",
    "SoftwareApplication",
  ]);
  // The software points at the organization by id, so the two must agree on it.
  assert.equal(
    nodes.SoftwareApplication.publisher["@id"],
    nodes.Organization["@id"],
  );
});

// The whole reason prices are read from the catalogue instead of retyped: a
// figure that is right on the page and wrong in the schema is worse than none,
// because the wrong one is the one shown in the search result.
test("every price comes from the catalogue the page charges from", () => {
  const offers = nodes.SoftwareApplication.offers;
  const free = offers.find((offer) => offer.price === "0");

  assert.ok(free, "the free plan must be offered — it is the whole funnel");
  assert.equal(free.name, freePlan.name);
  assert.ok(
    free.description.includes(String(freePlan.limits.channelsPerMonth)),
    "the free allowance must be the real one",
  );

  for (const plan of Object.values(planCatalog)) {
    const offer = offers.find((entry) => entry.name === plan.name);
    if (!plan.available) {
      assert.equal(offer, undefined, `${plan.name} is not on sale yet`);
      continue;
    }
    assert.equal(offer.price, String(plan.monthlyUsd));
    assert.equal(offer.priceCurrency, "USD");
  }
});

test("the FAQ a machine reads is the FAQ a person reads", () => {
  const questions = nodes.FAQPage.mainEntity;

  assert.equal(questions.length, FAQ.en.length);
  for (const [index, [question, answer]] of FAQ.en.entries()) {
    assert.equal(questions[index].name, question);
    assert.equal(questions[index].acceptedAnswer.text, answer);
  }

  // The page must render the same array rather than a second copy of it.
  const page = readFileSync("app/home-screen.tsx", "utf8");
  assert.ok(page.includes("faq: FAQ.en"), "the page keeps its own FAQ copy");
  assert.ok(page.includes("faq: FAQ.ru"), "the page keeps its own FAQ copy");
});

// The tag is written with dangerouslySetInnerHTML, which is the only way to
// emit JSON-LD — so the escaping is the thing standing between an edited FAQ
// answer and a closing tag that ends the script early.
test("the tag escapes markup and is rendered on the server", () => {
  const tag = readFileSync("app/components/json-ld.tsx", "utf8");
  const homepage = readFileSync("app/components/structured-data.tsx", "utf8");

  assert.equal(tag.includes('"use client"'), false, "must be server-side");
  assert.equal(homepage.includes('"use client"'), false, "must be server-side");
  assert.ok(tag.includes("\\\\u003c"), "'<' must be escaped");
  // One escaper, used by every page with schema. A second copy is a second
  // chance to get it wrong.
  assert.equal(
    homepage.includes("dangerouslySetInnerHTML"),
    false,
    "the escaping belongs in json-ld.tsx alone",
  );

  const injected = homepageGraph({
    freePlan,
    planCatalog,
    faq: [["q", "</script><img src=x>"]],
  });
  const json = JSON.stringify(injected).replace(/</g, "\\u003c");
  assert.equal(json.includes("</script>"), false);
});

// The schema hard-codes an origin, and so does the sitemap generator. They are
// the same site, and a mismatch would point the structured data at a host we do
// not serve.
test("the schema and the sitemap agree on where the site lives", () => {
  const robots = readFileSync("public/robots.txt", "utf8");
  assert.ok(robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`));
});

// The sitemap already leaves these out; without the header a crawler that
// arrives by a link still indexes them.
test("the auth pages ask not to be indexed", () => {
  for (const page of ["app/login/page.tsx", "app/register/page.tsx"]) {
    assert.ok(
      readFileSync(page, "utf8").includes("robots: { index: false"),
      `${page} is indexable`,
    );
  }
});
