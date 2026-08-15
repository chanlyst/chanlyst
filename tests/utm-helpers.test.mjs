import assert from "node:assert/strict";
import test from "node:test";
import { buildUtmLink, slugifyUtmValue } from "../app/lib/utm.mjs";

test("slugifyUtmValue reduces values to safe utm tokens", () => {
  assert.equal(slugifyUtmValue("There's An AI For That"), "there-s-an-ai-for-that");
  assert.equal(slugifyUtmValue("futuretools.io"), "futuretools-io");
  assert.equal(slugifyUtmValue("  Прайс  "), "");
  assert.equal(slugifyUtmValue(null), "");
});

test("buildUtmLink appends utm params to a bare website", () => {
  assert.equal(
    buildUtmLink("https://example-product.com", {
      source: "futuretools.io",
      medium: "listing",
      campaign: "example-product",
    }),
    "https://example-product.com/?utm_source=futuretools-io&utm_medium=listing&utm_campaign=chanlyst-example-product",
  );
});

test("buildUtmLink accepts a scheme-less website", () => {
  const link = buildUtmLink("example.com/landing", {
    source: "toolify.ai",
    medium: "paid",
    campaign: "prod-1",
  });
  assert.equal(
    link,
    "https://example.com/landing?utm_source=toolify-ai&utm_medium=paid&utm_campaign=chanlyst-prod-1",
  );
});

test("buildUtmLink preserves existing non-utm query params", () => {
  const link = buildUtmLink("https://example.com/?ref=abc&x=1", {
    source: "dir.example",
    medium: "listing",
    campaign: "p",
  });
  const url = new URL(link);
  assert.equal(url.searchParams.get("ref"), "abc");
  assert.equal(url.searchParams.get("x"), "1");
  assert.equal(url.searchParams.get("utm_source"), "dir-example");
  assert.equal(url.searchParams.get("utm_medium"), "listing");
  assert.equal(url.searchParams.get("utm_campaign"), "chanlyst-p");
});

test("buildUtmLink replaces existing utm params without duplicates", () => {
  const link = buildUtmLink(
    "https://example.com/?utm_source=old&utm_source=older&utm_medium=cpc&keep=1",
    { source: "new.site", medium: "outreach", campaign: "camp" },
  );
  assert.equal((link.match(/utm_source=/g) || []).length, 1);
  assert.equal((link.match(/utm_medium=/g) || []).length, 1);
  const url = new URL(link);
  assert.equal(url.searchParams.get("utm_source"), "new-site");
  assert.equal(url.searchParams.get("utm_medium"), "outreach");
  assert.equal(url.searchParams.get("utm_campaign"), "chanlyst-camp");
  assert.equal(url.searchParams.get("keep"), "1");
});

test("buildUtmLink falls back to defaults for empty parts", () => {
  const url = new URL(
    buildUtmLink("https://example.com", { source: "", medium: "", campaign: "" }),
  );
  assert.equal(url.searchParams.get("utm_source"), "chanlyst");
  assert.equal(url.searchParams.get("utm_medium"), "listing");
  assert.equal(url.searchParams.get("utm_campaign"), "chanlyst");
});

test("buildUtmLink returns '' for invalid or non-http websites", () => {
  assert.equal(buildUtmLink(""), "");
  assert.equal(buildUtmLink("   "), "");
  assert.equal(buildUtmLink("not a url at all"), "");
  assert.equal(buildUtmLink("ftp://example.com"), "");
  assert.equal(buildUtmLink("javascript:alert(1)"), "");
  assert.equal(buildUtmLink(null), "");
});
