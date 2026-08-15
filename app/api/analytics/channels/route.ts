import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../../lib/auth";
import { loadChannelStats } from "../../../lib/channel-stats";

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

// Per-product channel performance: raw counts aggregated by engagement mode
// and by channel type. Rates are computed client-side from these counts.
export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  const productId =
    new URL(request.url).searchParams.get("productId") || "";
  if (!db || !productId) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const product = await db
    .prepare("SELECT id FROM products WHERE id=? AND workspace_id=?")
    .bind(productId, auth.workspaceId)
    .first();
  if (!product) {
    return Response.json({ error: "product_not_found" }, { status: 404 });
  }
  const stats = await loadChannelStats(db, auth.workspaceId, productId);
  return Response.json(stats);
}
