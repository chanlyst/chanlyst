import { safePublicUrl } from "./security-helpers.mjs";

// The single outbound fetcher for user-supplied URLs.
//
// Redirects are followed manually so that EVERY hop is re-validated against
// safePublicUrl before the request leaves the worker: a public URL that
// redirects to 169.254.169.254 or to an .internal host must not become an SSRF
// hole. Extracted from the contact-enrichment route so channel monitoring
// reuses the exact same code path instead of growing a second fetcher.

export type PublicFetchResult = { response: Response; url: URL } | null;

/** Redirect hops we are willing to follow before giving up. */
const maxHops = 4;

export async function fetchPublic(
  initial: URL,
  options: { userAgent?: string; allowErrorStatus?: boolean } = {},
): Promise<PublicFetchResult> {
  let current: URL | null = initial;
  for (let hop = 0; hop < maxHops && current; hop += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        "User-Agent": options.userAgent || "Chanlyst Contact Research/1.0",
      },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      // Re-validate the destination of every single hop.
      current = safePublicUrl(new URL(location, current).toString());
      continue;
    }
    // Monitoring needs the failing status itself (a 404 IS the finding), so it
    // opts into error responses; enrichment keeps treating them as "no page".
    if (response.ok || options.allowErrorStatus) return { response, url: current };
    return null;
  }
  return null;
}
