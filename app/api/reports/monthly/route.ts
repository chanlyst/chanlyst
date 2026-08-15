import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../../lib/auth";
import { loadMonthlyReport } from "../../../lib/monthly-report-data";
import {
  defaultPeriodLabel,
  isMonthLabel,
} from "../../../lib/monthly-report.mjs";

// The monthly performance report: what the workspace produced in one calendar
// month, next to the month before it. Read-only and model-free.

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  if (!db) {
    return Response.json({ error: "database_unavailable" }, { status: 503 });
  }
  const params = new URL(request.url).searchParams;
  const requested = params.get("period") || "";
  if (requested && !isMonthLabel(requested)) {
    return Response.json({ error: "invalid_period" }, { status: 400 });
  }
  const now = new Date();
  // Default: the last complete month, all products of the workspace.
  const period: string = requested || defaultPeriodLabel(now);
  const productId = params.get("productId") || "";
  if (productId) {
    const product = await db
      .prepare("SELECT id FROM products WHERE id=? AND workspace_id=?")
      .bind(productId, auth.workspaceId)
      .first();
    if (!product) {
      return Response.json({ error: "product_not_found" }, { status: 404 });
    }
  }
  const report = await loadMonthlyReport(db, auth.workspaceId, {
    period,
    productId,
    now,
  });
  return Response.json(report);
}
