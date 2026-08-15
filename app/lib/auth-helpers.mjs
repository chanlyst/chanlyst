// Pure sign-in helpers shared by the auth routes and unit tests.
// Kept as an .mjs module so tests/auth-helpers.test.mjs can import it directly
// with `node --test` while TypeScript routes import it via allowJs.

/**
 * @typedef {{ email?: unknown, primary?: unknown, verified?: unknown }} GithubEmail
 */

/**
 * Pick the address GitHub should be trusted for: the primary verified address
 * when there is one, otherwise any other verified address. Unverified
 * addresses are never returned — anyone can add an unverified address to a
 * GitHub account and would otherwise take over a Chanlyst user by e-mail.
 * @param {unknown} entries payload of GET https://api.github.com/user/emails
 * @returns {string} the chosen address, or "" when nothing is verified
 */
export function pickGithubEmail(entries) {
  if (!Array.isArray(entries)) return "";
  const verified = entries.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      /** @type {GithubEmail} */ (entry).verified === true &&
      typeof (/** @type {GithubEmail} */ (entry).email) === "string" &&
      String(/** @type {GithubEmail} */ (entry).email).includes("@"),
  );
  const primary = verified.find(
    (entry) => /** @type {GithubEmail} */ (entry).primary === true,
  );
  const chosen = primary || verified[0];
  return chosen ? String(/** @type {GithubEmail} */ (chosen).email).trim() : "";
}

/**
 * Classify a magic-link row so the callback can pick the right redirect and
 * never accept a link twice.
 * @param {{ usedAt?: unknown, expiresAt?: unknown } | null | undefined} row
 * @param {number} [nowMs]
 * @returns {"missing" | "used" | "expired" | "valid"}
 */
export function loginLinkState(row, nowMs = Date.now()) {
  if (!row) return "missing";
  if (row.usedAt) return "used";
  const expiresAt = Date.parse(String(row.expiresAt ?? ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return "expired";
  return "valid";
}

/**
 * Normalise an address for storage and lookup: trimmed and lower-cased so the
 * same mailbox always maps to the same account and the same rate-limit key.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

const MAGIC_LINK_COPY = {
  ru: {
    subject: "Ссылка для входа в Chanlyst",
    body: (link) =>
      [
        "Здравствуйте!",
        "",
        "Нажмите на ссылку, чтобы войти в Chanlyst:",
        link,
        "",
        "Ссылка действует 15 минут и работает один раз.",
        "Если вы не запрашивали вход — просто проигнорируйте это письмо.",
        "",
        "Chanlyst",
      ].join("\n"),
  },
  en: {
    subject: "Your Chanlyst sign-in link",
    body: (link) =>
      [
        "Hi!",
        "",
        "Use the link below to sign in to Chanlyst:",
        link,
        "",
        "The link is valid for 15 minutes and can be used once.",
        "If you did not request it, you can safely ignore this e-mail.",
        "",
        "Chanlyst",
      ].join("\n"),
  },
};

/**
 * Build the plain-text magic-link e-mail in the requested locale.
 * @param {unknown} locale
 * @param {string} link
 * @returns {{ subject: string, text: string }}
 */
export function magicLinkEmail(locale, link) {
  const copy = locale === "en" ? MAGIC_LINK_COPY.en : MAGIC_LINK_COPY.ru;
  return { subject: copy.subject, text: copy.body(link) };
}
