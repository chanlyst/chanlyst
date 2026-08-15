import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../../lib/auth";
import {
  activeRunForProduct,
  advanceRun,
  latestRunForProduct,
  pendingRuns,
  resumeRun,
  toRunView,
  type PipelineRunRow,
} from "../../../lib/pipeline-runner";
import { timingSafeEqualStrings } from "../../../lib/security-helpers.mjs";

// One tick of the "prepare everything" pipeline.
//
// Cron mode (bearer AGENT_CRON_SECRET): advances a bounded batch of pending
// runs across workspaces, ONE slice each, so a single tick can never turn into
// an unbounded job.
//
// Session mode: advances (or resumes) the caller's own run for one product.
//
// Neither mode sends anything: the slices only prepare queued messages and
// draft sequences.

/** Runs touched per cron tick. */
const runBatchSize = 10;

function bindings() {
  return env as unknown as { DB?: D1Database; AGENT_CRON_SECRET?: string };
}

export async function POST(request: Request) {
  const db = bindings().DB;
  if (!db) return Response.json({ error: "database_unavailable" }, { status: 503 });
  const authorization = request.headers.get("authorization") || "";
  const isCron =
    Boolean(bindings().AGENT_CRON_SECRET) &&
    (await timingSafeEqualStrings(
      authorization,
      `Bearer ${bindings().AGENT_CRON_SECRET}`,
    ));

  if (isCron) {
    const due = await pendingRuns(runBatchSize);
    const results: Array<{ id: string; status: string; step: string }> = [];
    for (const row of due) {
      try {
        const advanced = await advanceRun(row);
        results.push({
          id: advanced.id,
          status: advanced.status,
          step: advanced.step,
        });
      } catch {
        // A single broken run must not stop the batch; its own retry budget
        // is what eventually marks it failed.
        results.push({ id: row.id, status: row.status, step: row.step });
      }
    }
    return Response.json({ ok: true, due: due.length, results });
  }

  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const payload = (await request.json().catch(() => ({}))) as {
    productId?: string;
    action?: "advance" | "resume";
  };
  const productId = String(payload.productId || "").trim();
  if (!productId) {
    return Response.json({ error: "missing_product" }, { status: 400 });
  }
  let row: PipelineRunRow | null =
    (await activeRunForProduct(auth.workspaceId, productId)) ||
    (await latestRunForProduct(auth.workspaceId, productId));
  if (!row) return Response.json({ error: "run_not_found" }, { status: 404 });
  // "Продолжить" after the provider ran out of credits.
  if (payload.action === "resume" || row.status === "paused") {
    if (row.status !== "paused") {
      return Response.json({ error: "run_not_paused" }, { status: 409 });
    }
    row = await resumeRun(row);
    return Response.json({ ok: true, run: toRunView(row) });
  }
  row = await advanceRun(row);
  return Response.json({ ok: true, run: toRunView(row) });
}
