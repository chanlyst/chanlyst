import { runAnalysis, type AnalyzeInput } from "../../lib/analysis-core";
import { isAuthResponse, requireApiSession } from "../../lib/auth";
import { enforceUsageLimit } from "../../lib/usage-limits";

// The model call itself lives in app/lib/analysis-core.ts so the pipeline
// runner uses the very same implementation. This route stays responsible for
// the session, the plan quota and the HTTP shape.

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const quota = await enforceUsageLimit(auth.workspaceId, "aiMessages");
  if (!quota.allowed) return quota.response!;
  const payload = (await request.json()) as AnalyzeInput;
  const outcome = await runAnalysis(payload, { workspaceId: auth.workspaceId });
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: outcome.status });
  }
  return Response.json({ mode: outcome.mode, analysis: outcome.analysis });
}
