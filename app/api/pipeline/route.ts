import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../lib/auth";
import {
  latestRunForProduct,
  pipelineCaps,
  toRunView,
} from "../../lib/pipeline-runner";

// The current (or most recent) "prepare everything" run for one product, so
// the dashboard can poll while it is active. Read-only.

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) return Response.json({ run: null, persisted: false });
  const productId = new URL(request.url).searchParams.get("productId") || "";
  if (!productId) {
    return Response.json({ error: "missing_product" }, { status: 400 });
  }
  const row = await latestRunForProduct(auth.workspaceId, productId);
  return Response.json({
    persisted: true,
    run: row ? toRunView(row) : null,
    caps: pipelineCaps(),
  });
}
