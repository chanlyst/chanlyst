// Who has to be asked before anything records them.
//
// The campaign targets the UK, the US, Canada and Australia. Only the first of
// those requires consent before behaviour is recorded, and asking everyone
// costs us the answer we are buying: a permission dialog on a landing page
// that already loses visitors between arriving and the first click.
//
// The country is taken from the browser's own time zone. No lookup service, no
// address sent anywhere, no extra dependency — which matters, because a geo
// API to decide whether we may call a third party is itself a call to a third
// party. It is a proxy, not proof: someone in London whose laptop is set to
// New York will not see the banner. So the rule errs the other way at every
// unclear point — an unreadable, empty or plain "UTC" zone counts as Europe
// and gets asked.
//
// This is a judgement about risk, not legal advice, and it is written down
// here so the judgement can be re-made rather than rediscovered.

/** Zones that mean "ask first". Europe, plus the ones we cannot read. */
export function needsConsent(timeZone) {
  const zone = String(timeZone ?? "").trim();
  if (!zone) return true;
  if (zone === "UTC" || zone === "GMT") return true;
  return /^(Europe|Atlantic\/(Azores|Canary|Faroe|Madeira|Reykjavik)|Arctic\/Longyearbyen)\b/i.test(
    zone,
  );
}

/** The visitor's zone, or "" when the browser will not say. */
export function browserTimeZone(intl) {
  try {
    return intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || "";
  } catch {
    return "";
  }
}
