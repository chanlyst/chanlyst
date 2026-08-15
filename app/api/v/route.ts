import { env } from "cloudflare:workers";
import { isBot, visitSource } from "../../lib/visit-source.mjs";

export const dynamic = "force-dynamic";

// A 1×1 transparent GIF. The page embeds it, the browser fetches it once, and
// that fetch is the visit.
//
// Recording during render was tried first and cannot work here: the page is
// rendered twice per request — once without the query string, once with it —
// and nothing in the request distinguishes the passes, so every visit was
// counted twice and half the rows lost their campaign. A request for an image
// happens exactly once per page load.
//
// An image rather than a script means no client-side tracking code, no cookie,
// and visitors with JavaScript disabled are still counted. Crawlers that never
// fetch images drop out on their own.
const PIXEL = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x44, 0x01, 0x00, 0x3b,
]);

function pixel() {
  return new Response(PIXEL, {
    headers: {
      "content-type": "image/gif",
      // Never cached: a cached pixel is an uncounted visit.
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}

/** Paths we are willing to count. Anything else is someone poking the URL. */
const COUNTED_PATHS = new Set(["/", "/login", "/found"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = url.searchParams.get("p") || "";

  if (!COUNTED_PATHS.has(path)) return pixel();
  if (isBot(request.headers.get("user-agent"))) return pixel();

  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) return pixel();

  // The page passes on the campaign tags and the referrer it was loaded with;
  // the pixel's own referrer is our page, which would tell us nothing.
  const source = visitSource(url.searchParams, url.searchParams.get("r") || "");

  try {
    await db
      .prepare(
        `INSERT INTO site_visits
           (id, path, source, medium, campaign, content, referrer_host, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        path,
        source.source,
        source.medium,
        source.campaign,
        source.content,
        source.referrerHost,
        new Date().toISOString(),
      )
      .run();
  } catch {
    // Counting is never worth a broken image.
  }

  return pixel();
}
