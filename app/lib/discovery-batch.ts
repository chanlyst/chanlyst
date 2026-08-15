import { env } from "cloudflare:workers";
import {
  runDiscovery,
  type DiscoveryOutcome,
  type DiscoveryProduct,
  type DiscoveryResult,
  type DiscoverySummary,
} from "./discovery-core";
import {
  BROAD_DISCOVERY_PASSES,
  batchResultCap,
  discoveryPasses,
  EXPANSION_DISCOVERY_PASSES,
  MAX_BATCH_DISCOVERY_RESULTS,
  MIN_USEFUL_DISCOVERY_RESULTS,
  mergeDiscoveryRuns,
} from "./discovery-batch-core.mjs";
import { usageSnapshot } from "./usage-limits";
import type { OpenRouterUsage } from "./ai-usage";
import { harvestSerperCandidates } from "./discovery-serper";

export { MAX_BATCH_DISCOVERY_RESULTS };

type LiveDiscoveryOutcome = Extract<
  DiscoveryOutcome,
  { ok: true; mode: "live" }
>;

export type BroadDiscoveryOutcome =
  | (LiveDiscoveryOutcome & { passesCompleted: number; passesAttempted: number })
  | Extract<DiscoveryOutcome, { ok: true; mode: "setup" }>
  | Extract<DiscoveryOutcome, { ok: false }>;

/**
 * Discovery runs this product has already finished.
 *
 * Zero on any failure: a rotation that cannot be worked out should repeat the
 * first run rather than refuse to search.
 */
async function completedDiscoveryRuns(workspaceId: string, productId: string) {
  if (!productId) return 0;
  try {
    const db = (env as unknown as { DB?: D1Database }).DB;
    if (!db) return 0;
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM pipeline_runs
         WHERE workspace_id=? AND product_id=? AND status='done'`,
      )
      .bind(workspaceId, productId)
      .first<{ n?: number }>();
    return Math.max(0, Number(row?.n) || 0);
  } catch {
    return 0;
  }
}

function resultDomains(results: DiscoveryResult[]) {
  return results
    .map((item) => item.domain || item.url)
    .filter((value): value is string => Boolean(value));
}

/**
 * Broad discovery runs two waves of two specialised searches. The second wave
 * knows everything the first wave returned, which materially reduces paid
 * rediscovery while keeping wall time close to two ordinary searches.
 */
export async function runBroadDiscovery({
  workspaceId,
  product,
  // English, not Russian, when a caller forgets. Every caller passes the
  // workspace's language; the default only decides which way a mistake falls,
  // and on 15 August one fell the wrong way — the pipeline asked a table that
  // had no row, took "ru" three times over, and an English account started
  // getting Russian channels again.
  locale = "en",
  preferredMotion = "",
  selectedSources = [],
  maxResults,
  round,
}: {
  workspaceId: string;
  product: DiscoveryProduct;
  locale?: string;
  preferredMotion?: string;
  selectedSources?: string[];
  /** Overrides the plan-derived cap. The public preview pins its own. */
  maxResults?: number;
  /**
   * Runs already completed for this product. A second run asking the first
   * run's questions gets the first run's answers: measured on 15 August, the
   * third run over one product returned nought to two new channels a lane and
   * dropped the rest as already known — at full price.
   */
  round?: number;
}): Promise<BroadDiscoveryOutcome> {
  // Which run this is for the product, counted from the runs already finished.
  // Derived rather than stored: the rows exist, and a counter that has to be
  // kept in step with them is one more thing to get wrong.
  const runIndex = round ?? (await completedDiscoveryRuns(workspaceId, product.id || ""));
  // How many results this run may return. A paying workspace gets more from
  // one press of the button, because the lanes already find more than thirty
  // and the merge was discarding the rest.
  const cap =
    maxResults ??
    (await usageSnapshot(workspaceId)
      .then((snapshot) => batchResultCap(snapshot.plan))
      .catch(() => MAX_BATCH_DISCOVERY_RESULTS));
  const passes = discoveryPasses(preferredMotion, selectedSources);
  const live: LiveDiscoveryOutcome[] = [];
  const failures: Array<Extract<DiscoveryOutcome, { ok: false }>> = [];
  let setup: Extract<DiscoveryOutcome, { ok: true; mode: "setup" }> | null = null;
  let passesAttempted = 0;

  // Depth costs a Serper request per page. The four broad lanes read two
  // pages, because page two is where anything a founder has not already found
  // lives. The expansion lanes only run when the broad ones underdelivered,
  // and adding depth on top of that would put the run over its cost target —
  // so they read one.
  async function runWave(wavePasses: typeof passes, pages?: number) {
    const excluded = resultDomains(live.flatMap((outcome) => outcome.results));
    passesAttempted += wavePasses.length;
    const sourceCandidates = await Promise.all(
      wavePasses.map((pass) =>
        harvestSerperCandidates({
          workspaceId,
          product,
          focusMotion: pass.focusMotion,
          locale,
          pages,
          round: runIndex,
        }),
      ),
    );
    const outcomes = await Promise.all(
      wavePasses.map((pass, index) => {
        // A lane whose search was refused, not answered, must not be handed to
        // the model with its own web-search tool: on 13 August one such lane
        // cost $0.1334 against $0.0057 for a lane Serper had covered — three
        // times the price of the seven working lanes put together, and enough
        // on its own to push the run past its cost target. The other lanes
        // still cover the ground.
        const candidates = sourceCandidates[index];
        if ((candidates as { searchFailed?: boolean }).searchFailed) {
          console.info(
            `discovery lane skipped motion=${pass.focusMotion} reason=source_search_failed`,
          );
          return Promise.resolve({
            ok: true as const,
            mode: "live" as const,
            provider: "serper" as const,
            results: [] as DiscoveryResult[],
            dropped: {},
            summary: {
              modelReturned: 0,
              returned: 0,
              dropped: 0,
              reasons: { source_search_failed: 1 },
            },
            providerUsage: [] as OpenRouterUsage[],
          });
        }
        return runDiscovery({
          workspaceId,
          product,
          sources: pass.sources,
          focusMotion: pass.focusMotion,
          excludeDomains: excluded,
          sourceCandidates: candidates,
          locale,
        });
      }),
    );
    for (const outcome of outcomes) {
      if (!outcome.ok) failures.push(outcome);
      else if (outcome.mode === "live") live.push(outcome);
      else setup ||= outcome;
    }
  }

  // The four broad lanes run together rather than in two waves.
  //
  // The waves existed so the second pair could be told what the first pair had
  // already found, and paid for that with its own wall time: two model rounds
  // of roughly 45 seconds where one would do. Measured on the run of 13 August,
  // that barrier removed four duplicates out of thirty-six results — the lanes
  // are four deliberately different markets and barely overlap — while the
  // serial rounds pushed the request past the 180-second proxy timeout, so the
  // whole run was thrown away with nothing saved.
  //
  // Anything the lanes do repeat is still collapsed afterwards:
  // mergeDiscoveryRuns keys by entity and keeps the higher-scoring copy. The
  // domains the workspace already had are still excluded, because those are
  // known before any lane starts.
  await runWave(passes);
  if (failures.some((failure) => failure.error === "ai_credits_exhausted")) {
    return { ok: false, error: "ai_credits_exhausted", status: 402 };
  }

  const initialMerge = mergeDiscoveryRuns(live, cap);
  const usefulInitialResults = initialMerge.results.filter(
    (item: DiscoveryResult) => item.relevance !== "doubtful",
  );
  if (
    passes.length >= BROAD_DISCOVERY_PASSES.length &&
    usefulInitialResults.length < MIN_USEFUL_DISCOVERY_RESULTS
  ) {
    for (let wave = 0; wave < EXPANSION_DISCOVERY_PASSES.length; wave += 2) {
      await runWave(EXPANSION_DISCOVERY_PASSES.slice(wave, wave + 2), 1);
      const current = mergeDiscoveryRuns(live, cap);
      const useful = current.results.filter(
        (item: DiscoveryResult) => item.relevance !== "doubtful",
      );
      if (useful.length >= MIN_USEFUL_DISCOVERY_RESULTS) break;
      if (failures.some((failure) => failure.error === "ai_credits_exhausted")) {
        return { ok: false, error: "ai_credits_exhausted", status: 402 };
      }
    }
  }

  if (!live.length) {
    if (failures.some((failure) => failure.error === "ai_credits_exhausted")) {
      return { ok: false, error: "ai_credits_exhausted", status: 402 };
    }
    return failures[0] || setup || {
      ok: false,
      error: "openrouter_request_failed",
      status: 502,
    };
  }

  const merged = mergeDiscoveryRuns(live, cap) as unknown as {
    results: DiscoveryResult[];
    dropped: Record<string, number>;
    summary: DiscoverySummary;
  };
  return {
    ok: true,
    mode: "live",
    provider: "openrouter_agent_search",
    results: merged.results,
    dropped: merged.dropped,
    summary: merged.summary,
    providerUsage: live.flatMap((outcome) => outcome.providerUsage || []) as OpenRouterUsage[],
    passesCompleted: live.length,
    passesAttempted,
    note:
      failures.length > 0
        ? `${live.length} of ${passesAttempted} discovery passes completed.`
        : undefined,
  };
}
