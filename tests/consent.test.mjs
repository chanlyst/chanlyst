import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  CONSENT_KEY,
  mayRecord,
  readConsent,
  shouldAskConsent,
  writeConsent,
} from "../app/lib/consent.mjs";

/** A localStorage stand-in, including the one that throws. */
function store(initial = {}, { throws = false } = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      if (throws) throw new Error("access denied");
      return key in data ? data[key] : null;
    },
    setItem(key, value) {
      if (throws) throw new Error("access denied");
      data[key] = value;
    },
    data,
  };
}

// Everything else on this page is counted without a cookie and without a third
// party. Recording is the one thing that needs a yes, so the absence of an
// answer has to mean no — including when storage itself is unavailable.
test("silence is never consent", () => {
  assert.equal(readConsent(store()), "unknown");
  assert.equal(mayRecord(store()), false);
  assert.equal(mayRecord(store({}, { throws: true })), false);
  assert.equal(readConsent(store({ [CONSENT_KEY]: "yes please" })), "unknown");
  assert.equal(mayRecord(store({ [CONSENT_KEY]: "yes please" })), false);
});

test("only an explicit grant allows recording", () => {
  assert.equal(mayRecord(store({ [CONSENT_KEY]: "granted" })), true);
  assert.equal(mayRecord(store({ [CONSENT_KEY]: "denied" })), false);
});

test("the banner appears exactly once, until answered", () => {
  assert.equal(shouldAskConsent(store()), true);
  assert.equal(shouldAskConsent(store({ [CONSENT_KEY]: "granted" })), false);
  assert.equal(shouldAskConsent(store({ [CONSENT_KEY]: "denied" })), false);
});

test("a junk answer is never written", () => {
  const target = store();
  assert.equal(writeConsent(target, "maybe"), false);
  assert.equal(CONSENT_KEY in target.data, false);
  assert.equal(writeConsent(target, "denied"), true);
  assert.equal(target.data[CONSENT_KEY], "denied");
});

// The promise this whole change rests on: a visitor who declines sends no
// request to Microsoft. A script tag in the document head would break that
// silently and no configuration afterwards could take the request back, so the
// tag must exist only inside the loader that consent gates.
test("nothing loads Clarity outside the consent gate", () => {
  const component = readFileSync("app/components/analytics-consent.tsx", "utf8");
  const layout = readFileSync("app/layout.tsx", "utf8");
  const page = readFileSync("app/home-screen.tsx", "utf8");

  assert.equal(layout.includes("clarity"), false, "clarity reached the layout");
  assert.equal(page.includes("clarity"), false, "clarity reached the page");

  const loader = component.slice(
    component.indexOf("function loadClarity"),
    component.indexOf("export default"),
  );
  const mentions = component.split("clarity.ms").length - 1;
  assert.equal(mentions, 1, "clarity.ms is referenced more than once");
  assert.ok(loader.includes("clarity.ms"), "the only reference must be the loader");
  assert.ok(
    component.includes(
      `if (state === "not-required" || mayRecord(window.localStorage)) loadClarity();`,
    ),
    "the loader must be behind the region check and the stored answer",
  );
  // The region is a browser fact, and deciding it during a server render put
  // the banner in the HTML for everyone and tore it out on hydration. It is
  // read in the client snapshot and nowhere else.
  assert.ok(
    component.includes("if (!needsConsent(browserTimeZone(Intl)))"),
    "the region must be read in the client snapshot",
  );
  assert.ok(
    component.includes(`return "server";`),
    "the server must render nothing rather than guess",
  );
});

// The policy promised that adding a tracker would be disclosed. It is the kind
// of promise that quietly stops being true, so the test holds it.
test("the privacy policy names the recorder in both locales", () => {
  const policy = readFileSync("app/privacy/page.tsx", "utf8");

  assert.equal(
    policy.split("Microsoft Clarity").length - 1,
    2,
    "both locales must name it",
  );
  assert.equal(
    policy.includes("нет сторонних рекламных трекеров"),
    false,
    "the old claim that nothing third-party runs is still there",
  );
});
