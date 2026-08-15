import { env } from "cloudflare:workers";
import { getIntegrationSecret } from "./secret";
import {
  bareDomain,
  buildPresenceQuery,
  distributionGaps,
  presenceFromResults,
} from "./competitor-gap-core.mjs";
import { serperSearch } from "./serper-gate";

export type Brand = { name: string; domain: string };

export type GapChannel = {
  domain: string;
  company: string;
  /** Rivals confirmed to hold a listing here, with the page that proves it. */
  competitors: Array<{ name: string; url: string }>;
};

export type CompetitorGapOutcome =
  | {
      ok: true;
      gaps: GapChannel[];
      /** Channels examined, and requests actually spent doing it. */
      checked: number;
      requests: number;
      /** Channels where the product itself already holds a listing. */
      present: number;
    }
  | { ok: false; error: "serper_not_configured" | "no_competitors" | "no_channels" };

/**
 * How many channels one analysis looks at.
 *
 * Every channel costs a request per brand, so a run with three competitors
 * over fifty channels would spend more than the search that found them. The
 * list is ordered by score, so twenty-five is the top half of a full run.
 */
export const GAP_MAX_CHANNELS = 25;
/** Rivals per analysis. Beyond three the cost climbs and the answer blurs. */
export const GAP_MAX_COMPETITORS = 3;

/**
 * Where a competitor is listed and the product is not.
 *
 * Runs against the channels already discovered for this product rather than
 * searching the web for the competitor: asking "where is SparkToro" returns
 * articles and rival vendors' comparison pages, while asking g2.com whether it
 * lists SparkToro returns g2.com/products/sparktoro. See
 * competitor-gap-core.mjs for the measurements behind that choice.
 */
export async function runCompetitorGap({
  workspaceId,
  productId,
  product,
  competitors,
}: {
  workspaceId: string;
  productId: string;
  product: Brand;
  competitors: Brand[];
}): Promise<CompetitorGapOutcome> {
  const rivals = competitors
    .map((item) => ({ name: String(item.name || "").trim(), domain: bareDomain(item.domain) }))
    .filter((item) => item.name && item.domain)
    .slice(0, GAP_MAX_COMPETITORS);
  if (!rivals.length) return { ok: false, error: "no_competitors" };

  const bindings = env as unknown as { SERPER_API_KEY?: string; DB: D1Database };
  const apiKey =
    bindings.SERPER_API_KEY ||
    (await getIntegrationSecret("serper", workspaceId).catch(() => ""));
  if (!apiKey) return { ok: false, error: "serper_not_configured" };

  const channels = await bindings.DB.prepare(
    `SELECT domain, company FROM prospects
     WHERE workspace_id=? AND product_id=? AND record_kind='channel'
       AND domain<>'' AND relevance<>'doubtful'
     ORDER BY score DESC LIMIT ?`,
  )
    .bind(workspaceId, productId, GAP_MAX_CHANNELS)
    .all<{ domain: string; company: string }>();
  const rows = channels.results || [];
  if (!rows.length) return { ok: false, error: "no_channels" };

  let requests = 0;
  const ask = async (channelDomain: string, brand: Brand) => {
    const query = buildPresenceQuery(channelDomain, brand) as string;
    if (!query) return { present: false, url: "" };
    const outcome = await serperSearch(apiKey, { q: query, num: 10, hl: "en" });
    requests += 1;
    if (!outcome.ok) return { present: false, url: "" };
    const organic = ((outcome.data as { organic?: Array<{ link?: string }> })?.organic || []).map(
      (item) => ({ url: item.link }),
    );
    return presenceFromResults(organic, channelDomain, brand) as {
      present: boolean;
      url: string;
    };
  };

  const examined = await Promise.all(
    rows.map(async (row) => {
      const found: Array<{ name: string; url: string }> = [];
      for (const rival of rivals) {
        const hit = await ask(row.domain, rival);
        if (hit.present) found.push({ name: rival.name, url: hit.url });
      }
      // The product's own presence is only worth a request where a rival was
      // actually found: everywhere else the answer changes nothing.
      const self = found.length ? (await ask(row.domain, product)).present : false;
      return { domain: row.domain, company: row.company, competitors: found, self };
    }),
  );

  // Written back onto the channel rows, so the list can show the badge without
  // paying for the analysis again. Cleared first: a rival removed from the
  // product, or one that has since dropped its listing, must not leave a claim
  // behind that nothing will ever correct.
  await bindings.DB.prepare(
    `UPDATE prospects SET competitor_presence='' 
     WHERE workspace_id=? AND product_id=? AND competitor_presence<>''`,
  )
    .bind(workspaceId, productId)
    .run();
  const withRivals = examined.filter((row) => row.competitors.length && !row.self);
  if (withRivals.length) {
    await bindings.DB.batch(
      withRivals.map((row) =>
        bindings.DB.prepare(
          `UPDATE prospects SET competitor_presence=?
           WHERE workspace_id=? AND product_id=? AND domain=? AND record_kind='channel'`,
        ).bind(JSON.stringify(row.competitors), workspaceId, productId, row.domain),
      ),
    );
  }

  const gaps = distributionGaps(examined) as Array<{
    domain: string;
    competitors: Array<{ name: string; url: string }>;
  }>;
  const byDomain = new Map(examined.map((row) => [row.domain, row.company]));
  console.info(
    `competitor-gap product=${productId} channels=${rows.length} rivals=${rivals.length} requests=${requests} gaps=${gaps.length}`,
  );
  return {
    ok: true,
    gaps: gaps.map((gap) => ({ ...gap, company: byDomain.get(gap.domain) || gap.domain })),
    checked: rows.length,
    requests,
    present: examined.filter((row) => row.self).length,
  };
}
