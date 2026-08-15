import { env } from "cloudflare:workers";
import {
  MAX_DISCOVERY_RESULTS,
  runDiscovery,
  type DiscoveryProduct,
} from "../../lib/discovery-core";
import {
  MAX_BATCH_DISCOVERY_RESULTS,
  runBroadDiscovery,
} from "../../lib/discovery-batch";
import {
  applyQuotaTrim,
  formatDiscoverySummary,
} from "../../lib/discovery-audit.mjs";
import { isAuthResponse, requireApiSession } from "../../lib/auth";
import { workspaceContentLocale } from "../../lib/workspace-locale";
import { enforceUsageLimit } from "../../lib/usage-limits";
import { timingSafeEqualStrings } from "../../lib/security-helpers.mjs";

// The search itself lives in app/lib/discovery-core.ts; this route owns the
// caller (session or internal cron bearer), the channel quota and the exact
// response payload.

type DiscoveryRequest = {
  workspaceId?: string;
  product?: DiscoveryProduct;
  sources?: string[];
  /** Optional acquisition-motion id the run should concentrate on. */
  focusMotion?: string;
  /**
   * Accepted and ignored: the language now comes from the workspace, so two
   * browsers cannot disagree about it and a cron run cannot fall back to a
   * language nobody chose. Kept in the type because older clients still send
   * it.
   */
  locale?: "ru" | "en";
};

export async function POST(request: Request) {
  const payload = (await request.json()) as DiscoveryRequest;
  const bindings = env as unknown as { AGENT_CRON_SECRET?: string };
  const authorization = request.headers.get("authorization") || "";
  const internal =
    Boolean(bindings.AGENT_CRON_SECRET) &&
    (await timingSafeEqualStrings(
      authorization,
      `Bearer ${bindings.AGENT_CRON_SECRET}`,
    )) &&
    Boolean(payload.workspaceId);
  let workspaceId = "";
  if (internal) {
    workspaceId = payload.workspaceId!;
  } else {
    const auth = await requireApiSession(request);
    if (isAuthResponse(auth)) return auth;
    workspaceId = auth.workspaceId;
  }
  const quota = await enforceUsageLimit(workspaceId, "channels", {
    count: payload.focusMotion
      ? MAX_DISCOVERY_RESULTS
      : MAX_BATCH_DISCOVERY_RESULTS,
  });
  // A full batch may not fit, but a partial one is fine: results are capped
  // to quota.remaining below. Reject only when nothing at all remains.
  if (!quota.allowed && quota.remaining <= 0) return quota.response!;

  // The language belongs to the workspace, not to the browser that happened
  // to send this request. A cron run has no browser at all, and used to fall
  // through to the default — writing in a language nobody had chosen.
  const locale = await workspaceContentLocale(workspaceId);
  // A motion tile is an intentionally narrow follow-up. The main discovery
  // action is broad and fills the initial map in four specialised passes.
  const outcome = payload.focusMotion
    ? await runDiscovery({
        workspaceId,
        product: payload.product || {},
        sources: payload.sources || [],
        focusMotion: payload.focusMotion,
        locale,
      })
    : await runBroadDiscovery({
        workspaceId,
        product: payload.product || {},
        selectedSources: payload.sources || [],
        locale,
      });
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: outcome.status });
  }
  if (outcome.mode === "setup") {
    return Response.json({
      mode: "setup",
      results: [],
      note: outcome.note,
    });
  }
  // The plan quota is the last drop rule; counting it here keeps
  // returned + dropped === model_returned true in the payload the client sees.
  const trimmed = applyQuotaTrim({
    results: outcome.results,
    summary:
      outcome.summary || {
        modelReturned: outcome.results.length,
        returned: outcome.results.length,
        dropped: 0,
        reasons: { ...(outcome.dropped || {}) },
      },
    limit: quota.remaining,
  });
  if (trimmed.summary.reasons.quota_trim) {
    console.info(
      formatDiscoverySummary(trimmed.summary, {
        workspace: workspaceId,
        stage: "after_quota",
      }),
    );
  }
  return Response.json({
    mode: "live",
    provider: outcome.provider,
    results: trimmed.results,
    note: outcome.note,
    // Entries the server refused to return, counted by reason — e.g. an
    // affiliate_network without the advertiser signup URL.
    dropped: trimmed.summary.reasons,
    // The same accounting the server logged: what the model returned, what
    // each rule removed and what finally reached the client.
    summary: trimmed.summary,
    usage: {
      used: quota.used,
      limit: quota.limit,
      remaining: Math.max(0, quota.remaining - trimmed.results.length),
    },
  });
}
