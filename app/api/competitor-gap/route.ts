import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../lib/auth";
import { runCompetitorGap, type Brand } from "../../lib/competitor-gap";
import { bareDomain } from "../../lib/competitor-gap-core.mjs";

// Started by a press, never on its own: the analysis spends a Serper request
// per channel per rival, which is more than the search that found the channels
// in the first place.

type ProductRow = { name?: string; website?: string; analysis?: string };

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const payload = (await request.json().catch(() => ({}))) as { productId?: string };
  const productId = String(payload.productId || "");
  if (!productId) return Response.json({ error: "product_required" }, { status: 400 });

  const bindings = env as unknown as { DB: D1Database };
  const row = await bindings.DB.prepare(
    "SELECT name, website, analysis FROM products WHERE id=? AND workspace_id=?",
  )
    .bind(productId, auth.workspaceId)
    .first<ProductRow>();
  if (!row) return Response.json({ error: "product_not_found" }, { status: 404 });

  let analysis: { competitors?: Array<Brand & { confirmed?: boolean }> } = {};
  try {
    analysis = JSON.parse(String(row.analysis || "{}"));
  } catch {
    analysis = {};
  }
  // Only confirmed rivals are searched on. An unconfirmed suggestion is the
  // model's guess, and acting on it would point the whole analysis at somebody
  // else's audience without the user ever agreeing to it.
  const competitors = (analysis.competitors || []).filter((item) => item.confirmed);

  const outcome = await runCompetitorGap({
    workspaceId: auth.workspaceId,
    productId,
    product: { name: String(row.name || ""), domain: bareDomain(row.website || "") as string },
    competitors,
  });
  if (!outcome.ok) {
    const status = outcome.error === "serper_not_configured" ? 503 : 409;
    return Response.json({ error: outcome.error }, { status });
  }
  return Response.json(outcome);
}
