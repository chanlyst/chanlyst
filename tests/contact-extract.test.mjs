import assert from "node:assert/strict";
import test from "node:test";
import {
  baseDomain,
  buildContactDigest,
  findConfidentEmail,
  harvestEmailCandidates,
  harvestTelegram,
  telegramHandleFromUrl,
  htmlToText,
  isNonContactEmail,
  isRoleAddress,
  legacyDigest,
  pageTitle,
  roleLabelForEmail,
} from "../app/lib/contact-extract.mjs";

test("isNonContactEmail accepts real business addresses", () => {
  assert.equal(isNonContactEmail("info@channel.com", "channel.com"), false);
  assert.equal(isNonContactEmail("editor@blog.channel.com", "channel.com"), false);
  assert.equal(isNonContactEmail("anna.petrova@channel.com", "channel.com"), false);
  assert.equal(isNonContactEmail("info@channel.com", "www.channel.com"), false);
  assert.equal(isNonContactEmail("contact@channel.co.uk", "channel.co.uk"), false);
});

test("isNonContactEmail keeps role addresses on unrelated domains", () => {
  for (const local of [
    "info",
    "contact",
    "hello",
    "press",
    "partners",
    "ads",
    "sales",
    "support",
    "editor",
  ]) {
    assert.equal(
      isNonContactEmail(`${local}@othermail.com`, "channel.com"),
      false,
      `${local}@ should stay acceptable`,
    );
  }
});

test("isNonContactEmail rejects bounce, vendor, asset and unrelated addresses", () => {
  assert.equal(isNonContactEmail("no-reply@channel.com", "channel.com"), true);
  assert.equal(isNonContactEmail("noreply@channel.com", "channel.com"), true);
  assert.equal(isNonContactEmail("donotreply@channel.com", "channel.com"), true);
  assert.equal(isNonContactEmail("user@example.com", "channel.com"), true);
  assert.equal(isNonContactEmail("abc@sentry.io", "channel.com"), true);
  assert.equal(isNonContactEmail("x@sentry.wixpress.com", "channel.com"), true);
  assert.equal(isNonContactEmail("a@cloudflare.com", "channel.com"), true);
  assert.equal(isNonContactEmail("a@godaddy.com", "channel.com"), true);
  assert.equal(isNonContactEmail("a@automattic.com", "channel.com"), true);
  assert.equal(isNonContactEmail("a@shopify.com", "channel.com"), true);
  assert.equal(isNonContactEmail("a@squarespace.com", "channel.com"), true);
  assert.equal(isNonContactEmail("logo@2x.png", "channel.com"), true);
  assert.equal(isNonContactEmail("sprite@hero.jpg", "channel.com"), true);
  assert.equal(isNonContactEmail("john.doe@unrelated.com", "channel.com"), true);
  assert.equal(isNonContactEmail("not-an-email", "channel.com"), true);
  assert.equal(isNonContactEmail("", "channel.com"), true);
});

test("role helpers derive localised labels", () => {
  assert.equal(isRoleAddress("ads@channel.com"), true);
  assert.equal(isRoleAddress("john@channel.com"), false);
  assert.equal(roleLabelForEmail("info@channel.com"), "Общие вопросы");
  assert.equal(roleLabelForEmail("ads@channel.com"), "Реклама");
  assert.equal(roleLabelForEmail("partners@channel.com"), "Партнёрства");
  assert.equal(roleLabelForEmail("press@channel.com"), "Пресса");
  assert.equal(roleLabelForEmail("support@channel.com"), "Поддержка");
  assert.equal(roleLabelForEmail("editor@channel.com"), "Редакция");
  assert.equal(roleLabelForEmail("someone@channel.com"), "Общие вопросы");
});

test("baseDomain normalises hosts and public suffixes", () => {
  assert.equal(baseDomain("www.channel.com"), "channel.com");
  assert.equal(baseDomain("blog.news.channel.com"), "channel.com");
  assert.equal(baseDomain("shop.channel.co.uk"), "channel.co.uk");
});

test("harvestEmailCandidates flags mailto links and contact link labels", () => {
  const html = `<a href="mailto:press%40channel.com">Write us</a>
    <a href="/about-team">team: hr@channel.com</a>
    <p>random text peter@channel.com here</p>`;
  const candidates = harvestEmailCandidates(html);
  const byEmail = Object.fromEntries(candidates.map((item) => [item.email, item]));
  assert.equal(byEmail["press@channel.com"].mailto, true);
  assert.equal(byEmail["hr@channel.com"].linkKeyword, true);
  assert.equal(byEmail["peter@channel.com"].mailto, false);
  assert.equal(byEmail["peter@channel.com"].linkKeyword, false);
  assert.ok(byEmail["peter@channel.com"].snippet.includes("random text"));
});

test("findConfidentEmail requires mailto or a contact-ish context", () => {
  const plain = `<p>reach me at peter@channel.com</p>`;
  assert.equal(
    findConfidentEmail({ html: plain, pageUrl: "https://channel.com/blog/post", siteDomain: "channel.com" }),
    null,
  );
  const onContactPage = findConfidentEmail({
    html: plain,
    pageUrl: "https://channel.com/contacts/",
    siteDomain: "channel.com",
  });
  assert.equal(onContactPage?.email, "peter@channel.com");

  const mailto = findConfidentEmail({
    html: `<a href="mailto:ads@channel.com">x</a>`,
    pageUrl: "https://channel.com/blog/post",
    siteDomain: "channel.com",
  });
  assert.equal(mailto?.email, "ads@channel.com");
  assert.equal(mailto?.role, "Реклама");
  assert.equal(mailto?.sourceUrl, "https://channel.com/blog/post");
  assert.ok(mailto.evidence.length <= 300);
});

test("findConfidentEmail never returns a filtered address", () => {
  assert.equal(
    findConfidentEmail({
      html: `<a href="mailto:no-reply@channel.com">x</a><a href="mailto:abc@sentry.io">y</a>`,
      pageUrl: "https://channel.com/contact",
      siteDomain: "channel.com",
    }),
    null,
  );
});

test("findConfidentEmail prefers the mailto, on-domain, role address", () => {
  const html = `<p>guest@unrelated-blog.com</p>
    <p>john@channel.com</p>
    <a href="mailto:info@channel.com">Contact us</a>`;
  const result = findConfidentEmail({
    html,
    pageUrl: "https://channel.com/contact",
    siteDomain: "channel.com",
  });
  assert.equal(result?.email, "info@channel.com");
});

test("buildContactDigest windows matches, dedupes overlap and caps output", () => {
  const filler = "x".repeat(3_000);
  const text = `${filler} write to info@channel.com or ads@channel.com ${filler} nothing ${filler}`;
  const digest = buildContactDigest([
    { url: "https://channel.com/contact", title: "Contact us", text },
  ]);
  assert.ok(digest.includes("https://channel.com/contact"));
  assert.ok(digest.includes("Contact us"));
  assert.ok(digest.includes("info@channel.com"));
  assert.ok(digest.includes("ads@channel.com"));
  // The two adjacent hits share one merged window instead of two copies.
  assert.equal(digest.split("info@channel.com").length - 1, 1);
  assert.ok(digest.length < 2_000, `digest too large: ${digest.length}`);
  assert.ok(digest.length < text.length / 4);
});

test("buildContactDigest respects the hard cap on noisy pages", () => {
  const noisy = "contact us at a@b.com. ".repeat(4_000);
  const digest = buildContactDigest([{ url: "https://channel.com/", title: "Home", text: noisy }]);
  assert.ok(digest.length <= 6_200, `cap exceeded: ${digest.length}`);
  assert.ok(digest.length < legacyDigest([noisy]).length);
});

test("buildContactDigest falls back to the head of the main page", () => {
  const text = "y".repeat(20_000);
  const digest = buildContactDigest([{ url: "https://channel.com/", title: "", text }]);
  assert.ok(digest.length <= 4_100, `fallback too large: ${digest.length}`);
  assert.ok(digest.startsWith("https://channel.com/"));
});

test("buildContactDigest handles empty input", () => {
  assert.equal(buildContactDigest([]), "");
});

test("html helpers strip markup and read titles and telegram handles", () => {
  assert.equal(htmlToText("<b>hi</b><script>bad()</script> there").trim(), "hi there");
  assert.equal(pageTitle("<head><title> Contact — Channel </title></head>"), "Contact — Channel");
  assert.equal(pageTitle("<html></html>"), "");
  assert.equal(harvestTelegram("write https://t.me/channel_ads now"), "https://t.me/channel_ads");
  assert.equal(harvestTelegram("no handle here"), "");
});

test("a Telegram result names its own channel through the URL", () => {
  // The form Google returns for a public channel is the /s/ preview.
  assert.equal(telegramHandleFromUrl("https://t.me/s/revops_chat"), "t.me/revops_chat");
  assert.equal(telegramHandleFromUrl("https://t.me/revops_chat/"), "t.me/revops_chat");
  assert.equal(telegramHandleFromUrl("t.me/revops_chat?before=10"), "t.me/revops_chat");
  assert.equal(telegramHandleFromUrl("https://telegram.me/revops_chat"), "t.me/revops_chat");
  // Named nobody: an invite link, a reserved path, another host entirely.
  assert.equal(telegramHandleFromUrl("https://t.me/+AbCdEfG"), "");
  assert.equal(telegramHandleFromUrl("https://t.me/joinchat/AAAA"), "");
  assert.equal(telegramHandleFromUrl("https://t.me/"), "");
  assert.equal(telegramHandleFromUrl("https://example.com/t.me/channel"), "");
  assert.equal(telegramHandleFromUrl(""), "");
});
