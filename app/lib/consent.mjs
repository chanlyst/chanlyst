// Whether the visitor has agreed to being recorded.
//
// Chanlyst counts page views without a cookie and without a third party — that
// was deliberate, and it is why no consent banner existed. Session replay
// cannot be done that way: it is Microsoft's script, it sets cookies, and in
// the UK and the EU it is unlawful without consent. So the answer is stored
// here and nothing loads until it is "granted".
//
// The default is "unknown", never "granted". A visitor who ignores the banner
// is not recorded, and a visitor who declines is asked once and left alone.

export const CONSENT_KEY = "chanlyst_analytics_consent";

/** 'granted' | 'denied' | 'unknown' */
export function readConsent(store) {
  try {
    const value = store?.getItem?.(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : "unknown";
  } catch {
    // Private browsing can throw on storage access. Silence is not consent.
    return "unknown";
  }
}

export function writeConsent(store, value) {
  if (value !== "granted" && value !== "denied") return false;
  try {
    store?.setItem?.(CONSENT_KEY, value);
    return true;
  } catch {
    return false;
  }
}

/** The banner is shown exactly when we have no answer yet. */
export function shouldAskConsent(store) {
  return readConsent(store) === "unknown";
}

/** Recording happens only on an explicit yes. */
export function mayRecord(store) {
  return readConsent(store) === "granted";
}
