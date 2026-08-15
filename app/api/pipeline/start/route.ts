import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../../lib/auth";
import {
  activeRunForProduct,
  createRun,
  toRunView,
} from "../../../lib/pipeline-runner";

// «Подготовить всё»: registers a pipeline run for one product. The run itself
// is advanced in bounded slices by POST /api/pipeline/run, so this endpoint
// does no work and spends nothing — it only puts the run on the board.
//
// Nothing this pipeline produces is ever sent: messages stay 'queued' and
// sequences stay 'draft' until the user acts on them in the queue.

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) return Response.json({ error: "database_unavailable" }, { status: 503 });
  const payload = (await request.json().catch(() => ({}))) as {
    productId?: string;
    /**
     * "discovery" runs the search alone. It exists because Find-channels used
     * to be a synchronous request holding a browser open for three minutes,
     * and a proxy timeout threw away a run that had already been paid for.
     */
    scope?: "full" | "discovery";
  };
  const productId = String(payload.productId || "").trim();
  if (!productId) {
    return Response.json({ error: "missing_product" }, { status: 400 });
  }
  const product = await db
    .prepare("SELECT id FROM products WHERE id=? AND workspace_id=?")
    .bind(productId, auth.workspaceId)
    .first();
  if (!product) {
    return Response.json({ error: "product_not_found" }, { status: 404 });
  }
  const active = await activeRunForProduct(auth.workspaceId, productId);
  if (active) {
    return Response.json(
      { error: "pipeline_already_running", run: toRunView(active) },
      { status: 409 },
    );
  }
  const run = await createRun(
    auth.workspaceId,
    productId,
    payload.scope === "discovery" ? "discovery" : "full",
  );
  return Response.json({ started: true, run: toRunView(run) });
}
