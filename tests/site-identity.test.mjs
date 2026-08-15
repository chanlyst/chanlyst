import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_DESCRIPTION_CHARS,
  MAX_TITLE_CHARS,
  describeIdentity,
  isIdentityEmpty,
  parseSiteIdentity,
} from "../app/lib/site-identity.mjs";

// The real page that exposed the problem: a live, well-formed site whose own
// words say it is for 55+ retirees, returned as a paid placement for an adult
// AI product. Its <head> is what a citation check could never have caught.
const RETIREMENT_FORUM = `<!doctype html><html><head>
  <title>Home - Adult Lifestyle Communities</title>
  <meta name="description" content="The ultimate resource for active adults 55+. ALC is a comprehensive forum designed to assist, connect, and inspire adults seeking a vibrant retirement lifestyle">
  <meta property="og:site_name" content="Adult Lifestyle Communities">
</head><body>…</body></html>`;

test("parseSiteIdentity reads what the page says it is", () => {
  const identity = parseSiteIdentity(RETIREMENT_FORUM);

  assert.equal(identity.title, "Home - Adult Lifestyle Communities");
  assert.match(identity.description, /active adults 55\+/);
  assert.equal(identity.siteName, "Adult Lifestyle Communities");
  assert.equal(isIdentityEmpty(identity), false);
});

test("parseSiteIdentity accepts either attribute order", () => {
  const reversed = parseSiteIdentity(
    `<meta content="Ad network for adult traffic" name="description">`,
  );
  assert.equal(reversed.description, "Ad network for adult traffic");
});

test("parseSiteIdentity falls back to open-graph tags", () => {
  const identity = parseSiteIdentity(
    `<meta property="og:title" content="TrafficJunky">
     <meta property="og:description" content="Advertising network">`,
  );
  assert.equal(identity.title, "TrafficJunky");
  assert.equal(identity.description, "Advertising network");
});

test("parseSiteIdentity decodes entities and collapses whitespace", () => {
  const identity = parseSiteIdentity(
    `<title>Girls &amp; Bots\n   &#8212; it&#39;s &quot;live&quot;</title>`,
  );
  assert.equal(identity.title, `Girls & Bots — it's "live"`);
});

test("parseSiteIdentity caps what it keeps", () => {
  const identity = parseSiteIdentity(
    `<title>${"t".repeat(400)}</title>
     <meta name="description" content="${"d".repeat(900)}">`,
  );
  assert.equal(identity.title.length, MAX_TITLE_CHARS);
  assert.equal(identity.description.length, MAX_DESCRIPTION_CHARS);
});

// An unreadable page must never masquerade as a judgement: "we could not read
// it" and "it does not fit" lead to different handling.
test("parseSiteIdentity reports emptiness instead of throwing", () => {
  for (const input of ["", null, undefined, "<html><body>no head</body></html>"]) {
    const identity = parseSiteIdentity(input);
    assert.equal(isIdentityEmpty(identity), true);
    assert.equal(identity.title, "");
  }
});

test("describeIdentity puts the site's own words on one line", () => {
  assert.equal(
    describeIdentity(parseSiteIdentity(RETIREMENT_FORUM)),
    "Home - Adult Lifestyle Communities (Adult Lifestyle Communities) — " +
      "The ultimate resource for active adults 55+. ALC is a comprehensive forum " +
      "designed to assist, connect, and inspire adults seeking a vibrant retirement lifestyle",
  );
  // No duplicate heading when the site name repeats the title.
  assert.equal(
    describeIdentity({ title: "TrafficJunky", siteName: "TrafficJunky" }),
    "TrafficJunky",
  );
  assert.equal(describeIdentity({}), "");
});
