import assert from "node:assert/strict";
import test from "node:test";
import {
  loginLinkState,
  magicLinkEmail,
  normalizeEmail,
  pickGithubEmail,
} from "../app/lib/auth-helpers.mjs";

test("pickGithubEmail prefers the primary verified address", () => {
  assert.equal(
    pickGithubEmail([
      { email: "old@example.com", primary: false, verified: true },
      { email: "main@example.com", primary: true, verified: true },
    ]),
    "main@example.com",
  );
});

test("pickGithubEmail falls back to another verified address", () => {
  assert.equal(
    pickGithubEmail([
      { email: "main@example.com", primary: true, verified: false },
      { email: "backup@example.com", primary: false, verified: true },
    ]),
    "backup@example.com",
  );
});

test("pickGithubEmail never returns an unverified address", () => {
  assert.equal(
    pickGithubEmail([
      { email: "spoof@victim.test", primary: true, verified: false },
    ]),
    "",
  );
  assert.equal(pickGithubEmail([]), "");
  assert.equal(pickGithubEmail(null), "");
  assert.equal(pickGithubEmail({ email: "x@y.test", verified: true }), "");
  assert.equal(
    pickGithubEmail([{ email: "not-an-address", verified: true }]),
    "",
  );
});

test("loginLinkState classifies missing, used, expired and valid rows", () => {
  const now = Date.parse("2026-07-26T12:00:00.000Z");
  assert.equal(loginLinkState(null, now), "missing");
  assert.equal(loginLinkState(undefined, now), "missing");
  assert.equal(
    loginLinkState(
      { usedAt: "2026-07-26T11:59:00.000Z", expiresAt: "2026-07-26T12:10:00.000Z" },
      now,
    ),
    "used",
  );
  assert.equal(
    loginLinkState({ expiresAt: "2026-07-26T11:59:59.000Z" }, now),
    "expired",
  );
  assert.equal(loginLinkState({ expiresAt: "" }, now), "expired");
  assert.equal(loginLinkState({ expiresAt: "not a date" }, now), "expired");
  // Exactly at the deadline the link is already gone.
  assert.equal(
    loginLinkState({ expiresAt: "2026-07-26T12:00:00.000Z" }, now),
    "expired",
  );
  assert.equal(
    loginLinkState({ expiresAt: "2026-07-26T12:14:59.000Z" }, now),
    "valid",
  );
});

test("normalizeEmail trims and lower-cases", () => {
  assert.equal(normalizeEmail("  USER@Example.COM "), "user@example.com");
  assert.equal(normalizeEmail(undefined), "");
});

test("magicLinkEmail localises the letter and always carries the link", () => {
  const link = "https://chanlyst.com/api/auth/email/callback?token=abc";
  const ru = magicLinkEmail("ru", link);
  const en = magicLinkEmail("en", link);
  assert.equal(ru.subject, "Ссылка для входа в Chanlyst");
  assert.equal(en.subject, "Your Chanlyst sign-in link");
  assert.ok(ru.text.includes(link));
  assert.ok(en.text.includes(link));
  assert.ok(ru.text.includes("15 минут"));
  assert.ok(en.text.includes("15 minutes"));
  // Anything other than "en" falls back to Russian.
  assert.equal(magicLinkEmail(undefined, link).subject, ru.subject);
  assert.equal(magicLinkEmail("de", link).subject, ru.subject);
});
