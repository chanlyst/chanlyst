// Where the interface language lives between visits.
//
// It used to live in localStorage, which the server cannot read, so every page
// was painted in the default language first and corrected afterwards. In the
// dashboard the correction sat inside the `.then()` of a Promise.all over
// eleven API calls, so the interface stayed in the wrong language until the
// slowest request came back — one to two seconds of Russian on an English
// account, on every navigation.
//
// A cookie is sent with the document request, so the server already knows the
// language before the first pixel and there is nothing left to switch.
// localStorage is still written for the accounts that chose a language before
// this existed; the cookie is what decides.

export const LOCALE_COOKIE = "chanlyst_locale";

/** A year: the choice should outlive the session it was made in. */
const MAX_AGE = 60 * 60 * 24 * 365;

const LOCALES = ["ru", "en"];

/**
 * @param {string | null | undefined} header a raw Cookie request header
 * @param {"ru" | "en"} fallback what to use when nothing is stored yet
 * @returns {"ru" | "en"}
 */
export function localeFromCookieHeader(header, fallback) {
  const match = /(?:^|;\s*)chanlyst_locale=([^;]*)/.exec(String(header || ""));
  const value = match ? decodeURIComponent(match[1]) : "";
  return LOCALES.includes(value) ? /** @type {"ru"|"en"} */ (value) : fallback;
}

/**
 * The `document.cookie` string that stores a choice. SameSite=Lax so the
 * cookie survives a normal link into the app; no Secure flag decision here
 * because the app is served over HTTPS in every environment that matters.
 *
 * @param {"ru" | "en"} locale
 */
export function localeCookie(locale) {
  return `${LOCALE_COOKIE}=${locale}; path=/; max-age=${MAX_AGE}; samesite=lax`;
}
