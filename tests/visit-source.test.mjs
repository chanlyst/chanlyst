import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanLabel,
  forwardedCampaign,
  isBot,
  referrerHost,
  visitSource,
} from "../app/lib/visit-source.mjs";

test("campaign tags survive the trip and are what we group by", () => {
  const source = visitSource(
    new URLSearchParams(
      "utm_source=x&utm_medium=paid_social&utm_campaign=founders_en&utm_content=stop_guessing",
    ),
    "https://t.co/abc",
  );

  assert.equal(source.source, "x");
  assert.equal(source.medium, "paid_social");
  assert.equal(source.campaign, "founders_en");
  assert.equal(source.content, "stop_guessing");
});

// The first paid campaign ran with no way to tell a click that arrived from a
// click that did not. An untagged visit still has to land somewhere useful.
test("an untagged visit falls back to the referring host", () => {
  const fromX = visitSource(new URLSearchParams(""), "https://t.co/abc");
  assert.equal(fromX.source, "x", "t.co is X, not a site called t.co");
  assert.equal(fromX.medium, "referral");

  const typedIn = visitSource(new URLSearchParams(""), "");
  assert.equal(typedIn.source, "direct");
  assert.equal(typedIn.medium, "none");
});

// The places this product is actually promoted by hand. A visit from one of
// them arriving as a bare hostname would sit in the traffic table next to
// "direct" and tell us nothing about which conversation sent it.
test("the communities we post in are named, not left as hosts", () => {
  const expected = {
    "https://news.ycombinator.com/item?id=1": "hackernews",
    "https://www.indiehackers.com/post/whatever": "indiehackers",
    "https://www.producthunt.com/posts/x": "producthunt",
    "https://old.reddit.com/r/SaaS/": "reddit",
    "https://m.reddit.com/r/SaaS/": "reddit",
  };

  for (const [referer, source] of Object.entries(expected)) {
    assert.equal(visitSource(new URLSearchParams(""), referer).source, source, referer);
  }
});

// A referrer path can carry a search query or an identifier. We want to know
// the visitor came from Reddit, not what they were reading there.
test("a referrer keeps its host and loses everything else", () => {
  assert.equal(
    referrerHost("https://www.reddit.com/r/SaaS/comments/abc?utm=1"),
    "reddit.com",
  );
  assert.equal(referrerHost("javascript:alert(1)"), "");
  assert.equal(referrerHost("not a url"), "");
  assert.equal(referrerHost(""), "");
});

test("labels cannot become a payload", () => {
  assert.equal(cleanLabel("  Founders_EN  "), "founders_en");
  assert.equal(cleanLabel("a".repeat(200)).length, 64);
  assert.equal(cleanLabel(undefined), "");
});

// X fetches the destination itself to build the link card, so the ad's landing
// page is hit before a single person clicks it. Counting that as a visitor
// would make every campaign look better than it is.
test("machines are not visitors", () => {
  assert.equal(isBot("Twitterbot/1.0"), true);
  assert.equal(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)"), true);
  assert.equal(isBot("curl/8.4.0"), true);
  assert.equal(isBot(""), true, "a request with no user agent is a script");
  assert.equal(
    isBot(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
    ),
    false,
  );
});


// The sign-in step is reached through an internal link, so without carrying
// the tags the second half of every funnel is credited to our own domain: the
// campaign shows visitors who landed and nobody who went on.
test("the campaign is carried across the internal link", () => {
  const carried = new URLSearchParams(
    forwardedCampaign({
      utm_source: "X",
      utm_campaign: "Founders_EN",
      ref: "ignored",
    }),
  );

  assert.equal(carried.get("utm_source"), "x");
  assert.equal(carried.get("utm_campaign"), "founders_en");
  assert.equal(carried.get("ref"), null, "only campaign tags travel");
  assert.equal(forwardedCampaign({}), "", "an untagged visit adds no query");
});

// A domain that merely ends with a known name is not that place. Matching by
// suffix would have made reddit.com.phish.example resolve to "reddit".
test("a lookalike domain is not mistaken for the real one", () => {
  const fake = visitSource(new URLSearchParams(""), "https://reddit.com.example.org/x");
  assert.equal(fake.source, "reddit.com.example.org");
});
