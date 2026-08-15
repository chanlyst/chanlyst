import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildContactPageQuery,
  contactPageUrls,
} from "../app/lib/contact-search-core.mjs";

test("one word, no operators — measured to be what works", () => {
  assert.equal(buildContactPageQuery({ domain: "saastr.com" }), "site:saastr.com contact");
  // Whatever shape the domain arrives in.
  assert.equal(
    buildContactPageQuery({ domain: "https://www.saastr.com/pricing" }),
    "site:saastr.com contact",
  );
  assert.equal(buildContactPageQuery({}), "");
});

test("a desk on a subdomain counts; a neighbouring company does not", () => {
  const candidates = [
    { url: "https://support.joinpavilion.com/s/contactsupport" },
    // Google answers a site: query with neighbours when it has nothing on the
    // domain — this one is a different company entirely.
    { url: "https://www.pavilionadvertising.com/content-partner-request-access" },
    { url: "https://www.joinpavilion.com/sponsorships" },
  ];
  assert.deepEqual(contactPageUrls(candidates, "joinpavilion.com"), [
    "https://support.joinpavilion.com/s/contactsupport",
    "https://www.joinpavilion.com/sponsorships",
  ]);
});

test("the path has to name a desk, not mention one", () => {
  const candidates = [
    { url: "https://www.saastr.com/ai-should-kill-contact-me-in-2025-its-long-since-time/" },
    { url: "https://www.saastr.com/contact-saastr/" },
  ];
  // The article is about contact forms; only the second is a desk.
  assert.deepEqual(contactPageUrls(candidates, "saastr.com"), [
    "https://www.saastr.com/contact-saastr/",
  ]);
});

test("bad input yields no urls rather than throwing", () => {
  assert.deepEqual(contactPageUrls([{ url: "not a url" }], "example.com"), []);
  assert.deepEqual(contactPageUrls([], ""), []);
  assert.deepEqual(contactPageUrls(), []);
});

test("enrichment reads real pages before it pays a model to search", () => {
  const source = readFileSync("app/lib/enrichment-core.ts", "utf8");
  assert.match(source, /findContactPages/);
  // Indexed URLs are tried ahead of the guessed paths.
  assert.match(source, /\.\.\.knownPages[\s\S]{0,200}new URL\("\/contact", root\)/);
  // The small model extracts from page text; the search tool is the fallback
  // for a site that gave us nothing to read.
  assert.match(source, /const hasPages = Boolean\(evidence\.text\)/);
  assert.match(source, /hasPages\s*\n?\s*\?\s*bindings\.DISCOVERY_CLASSIFIER_MODEL/);
  assert.match(source, /\.\.\.\(hasPages\s*\n?\s*\?\s*\{\}/);
});
