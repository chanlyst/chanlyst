import { env } from "cloudflare:workers";
import { serperSearch } from "./serper-gate";
import { getIntegrationSecret } from "./secret";
import {
  buildSourceQueries,
  normaliseSourceCandidates,
  sourceRequestPlan,
} from "./discovery-source-core.mjs";
import type { DiscoveryProduct } from "./discovery-core";

export type SourceCandidate = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  focusMotion: string;
  position: number;
  rank: number;
  query: string;
  specific: boolean;
};

const SERPER_TIMEOUT_MS = 8_000;

export async function harvestSerperCandidates({
  workspaceId,
  product,
  focusMotion,
  locale = "en",
  pages,
  round = 0,
}: {
  workspaceId: string;
  product: DiscoveryProduct;
  focusMotion: string;
  locale?: string;
  /** Depth in SERP pages. The expansion lanes read one, to stay in budget. */
  pages?: number;
  /**
   * How many runs this product has already had. Later runs rotate to the next
   * window of analysed queries and start further down the results, because
   * repeating the first run verbatim finds the first run's channels again.
   */
  round?: number;
}): Promise<SourceCandidate[]> {
  const bindings = env as unknown as { SERPER_API_KEY?: string };
  const apiKey =
    bindings.SERPER_API_KEY ||
    (await getIntegrationSecret("serper", workspaceId).catch(() => ""));
  if (!apiKey) return [];

  // One request per query per page. Depth is the whole point: page two shares
  // no links with page one and holds the part of the market a founder has to
  // be told about.
  const plan = sourceRequestPlan(
    buildSourceQueries({ product, focusMotion, round }),
    pages,
    round,
  );
  // Every lane now runs at once, so a whole run can put fifty requests in
  // flight. A refusal used to be indistinguishable from a query that genuinely
  // matched nothing: both returned {} and the run carried on a little poorer
  // with no trace. Failures are counted and logged.
  const failures: Record<string, number> = {};
  const note = (key: string) => {
    failures[key] = (failures[key] || 0) + 1;
  };
  const entries = await Promise.all(
    plan.map(async (step: { query: string; page: number; specific: boolean }) => {
      const outcome = await serperSearch(
        apiKey,
        {
          q: step.query,
          num: 10,
          page: step.page,
          hl: locale === "ru" ? "ru" : "en",
        },
        SERPER_TIMEOUT_MS,
      );
      if (!outcome.ok) {
        note(outcome.reason);
        return { ...step, response: {} };
      }
      return { ...step, response: outcome.data };
    }),
  );
  const candidates = normaliseSourceCandidates(entries, focusMotion) as SourceCandidate[];
  const failed = Object.entries(failures)
    .map(([key, count]) => `${key}=${count}`)
    .join(",");
  console.info(
    `discovery source=serper motion=${focusMotion} round=${round} requests=${plan.length} candidates=${candidates.length} failed=${failed || "none"}`,
  );
  // An empty result means two different things, and they cost differently:
  // nothing matched, or we never got to ask. The caller pays twenty times more
  // for a lane it believes found nothing, so it has to be able to tell.
  return Object.assign(candidates, { searchFailed: candidates.length === 0 && failed !== "" });
}
