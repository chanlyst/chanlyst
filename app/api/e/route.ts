import { env } from "cloudflare:workers";
import { isBot } from "../../lib/visit-source.mjs";
import { cleanEventLabel, isEventKind } from "../../lib/page-events.mjs";

export const dynamic = "force-dynamic";

/** Paths whose behaviour we are willing to record. */
const COUNTED_PATHS = new Set(["/", "/login"]);

/** One page load cannot honestly produce more than this. */
const MAX_EVENTS = 12;

const ok = () => new Response(null, { status: 204 });

/**
 * Receives what happened on a public page.
 *
 * POST rather than an image, because these arrive on the way out — sendBeacon
 * survives the tab closing, and an <img> does not. Nothing identifying is
 * accepted: the visit id is made per page load in the browser, the label is
 * reduced to a short slug, and the value is a number.
 */
export async function POST(request: Request) {
  if (isBot(request.headers.get("user-agent"))) return ok();

  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) return ok();

  let payload: {
    v?: string;
    p?: string;
    s?: string;
    c?: string;
    e?: { k?: string; l?: string; n?: number }[];
  };
  try {
    payload = await request.json();
  } catch {
    return ok();
  }

  const path = String(payload?.p || "");
  const visitId = String(payload?.v || "").slice(0, 40);
  if (!COUNTED_PATHS.has(path) || !visitId) return ok();

  const source = cleanEventLabel(payload?.s);
  const campaign = cleanEventLabel(payload?.c);
  const events = Array.isArray(payload?.e) ? payload.e.slice(0, MAX_EVENTS) : [];
  const now = new Date().toISOString();

  const rows = events
    .filter((event) => isEventKind(event?.k))
    .map((event) => ({
      kind: String(event.k),
      label: cleanEventLabel(event.l),
      value: Math.max(0, Math.min(100_000, Math.round(Number(event.n) || 0))),
    }));
  if (!rows.length) return ok();

  try {
    const statement = db.prepare(
      `INSERT INTO site_events
         (id, visit_id, path, source, campaign, kind, label, value, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    await db.batch(
      rows.map((row) =>
        statement.bind(
          crypto.randomUUID(),
          visitId,
          path,
          source,
          campaign,
          row.kind,
          row.label,
          row.value,
          now,
        ),
      ),
    );
  } catch {
    // Measuring is never worth a failed request on the way out of the page.
  }

  return ok();
}
