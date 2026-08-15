import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContactSearchQuery,
  contactQueryCount,
  normaliseContactSearchResults,
} from "../app/lib/contact-discovery-core.mjs";

const product = {
  name: "Chanlyst",
  audience: "B2B SaaS founders",
  category: "customer acquisition software",
  geography: "United States",
  analysis: { searchQueries: ["SaaS growth teams", "startup marketing"] },
};

test("contact expansion has enough stable searches for a mass campaign", () => {
  assert.ok(contactQueryCount(product) >= 64);
  assert.equal(buildContactSearchQuery(product, 3), buildContactSearchQuery(product, 3));
  assert.match(buildContactSearchQuery(product, 3), /United States/);
});

test("contact search results dedupe organisations and drop social platforms", () => {
  const rows = normaliseContactSearchResults({
    organic: [
      { title: "Acme — Home", link: "https://www.acme.com/home", snippet: "A" },
      { title: "Acme contact", link: "https://blog.acme.com/contact", snippet: "B" },
      { title: "LinkedIn", link: "https://linkedin.com/company/acme", snippet: "C" },
      { title: "Beta | Product", link: "https://beta.co.uk", snippet: "D" },
    ],
  });
  assert.deepEqual(rows.map((row) => row.domain), ["acme.com", "beta.co.uk"]);
  assert.equal(rows[0].company, "Acme");
});
