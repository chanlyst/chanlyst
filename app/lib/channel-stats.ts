import {
  OTHER_CHANNEL_TYPE,
  computeChannelStats as computeChannelStatsJs,
} from "./channel-stats-core.mjs";
import { type EngagementMode } from "./engagement-mode";

export { OTHER_CHANNEL_TYPE };

// Raw counts only: rates (reply rate, conversion) are derived by the client
// so a single source of truth exists for every number that is displayed.
export type ChannelMetrics = {
  total: number;
  contacted: number;
  replied: number;
  meetings: number;
  converted: number;
  revenueCents: number;
  published: number;
};

export type ChannelTypeMetrics = ChannelMetrics & { channelType: string };

export type ChannelStats = {
  modes: Record<Exclude<EngagementMode, "unknown">, ChannelMetrics>;
  channelTypes: ChannelTypeMetrics[];
  totals: ChannelMetrics;
};

// Minimal prospect row shape the aggregation needs. Matches the aliased
// columns selected by loadChannelStats and by GET /api/prospects.
export type ChannelStatsRow = {
  channelType?: string | null;
  engagementMode?: string | null;
  opportunityType?: string | null;
  actionType?: string | null;
  commercialModel?: string | null;
  stage?: string | null;
  contactedAt?: string | null;
  repliedAt?: string | null;
  meetingAt?: string | null;
  convertedAt?: string | null;
  revenueCents?: number | null;
  placementStatus?: string | null;
};

// Typed wrapper around the shared implementation in channel-stats-core.mjs, which
// the monthly report reuses so the two features cannot drift apart.
export function computeChannelStats(rows: ChannelStatsRow[]): ChannelStats {
  return computeChannelStatsJs(rows) as ChannelStats;
}

export async function loadChannelStats(
  db: D1Database,
  workspaceId: string,
  productId: string,
): Promise<ChannelStats> {
  const result = await db
    .prepare(
      `SELECT channel_type as channelType, engagement_mode as engagementMode,
       opportunity_type as opportunityType, action_type as actionType,
       commercial_model as commercialModel,
       stage, contacted_at as contactedAt, replied_at as repliedAt,
       meeting_at as meetingAt, converted_at as convertedAt,
       revenue_cents as revenueCents, placement_status as placementStatus
       FROM prospects WHERE product_id = ? AND workspace_id = ?`,
    )
    .bind(productId, workspaceId)
    .all();
  return computeChannelStats(result.results as ChannelStatsRow[]);
}

const RU_MODE_LABELS: Record<Exclude<EngagementMode, "unknown">, string> = {
  free_listing: "бесплатные размещения и каталоги",
  paid_placement: "платные размещения",
  outreach: "прямой аутрич",
};

function pluralRu(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Builds the 1-2 sentence "what already works" hint appended to the discovery
// prompt. Returns "" until the product has enough real outcomes (>= 3 leads
// that replied or converted) so early noise never steers the search.
export function buildDiscoveryHint(stats: ChannelStats): string {
  if (stats.totals.converted < 3 && stats.totals.replied < 3) return "";
  const modes = (
    Object.keys(stats.modes) as Array<Exclude<EngagementMode, "unknown">>
  )
    .map((mode) => ({ mode, metrics: stats.modes[mode] }))
    .filter((item) => item.metrics.converted > 0 || item.metrics.replied > 0)
    .sort(
      (a, b) =>
        b.metrics.converted - a.metrics.converted ||
        b.metrics.replied - a.metrics.replied,
    )
    .slice(0, 2)
    .map(({ mode, metrics }) =>
      metrics.converted > 0
        ? `${RU_MODE_LABELS[mode]} (${metrics.converted} ${pluralRu(metrics.converted, "клиент", "клиента", "клиентов")})`
        : `${RU_MODE_LABELS[mode]} (${metrics.replied} ${pluralRu(metrics.replied, "ответ", "ответа", "ответов")})`,
    );
  if (!modes.length) return "";
  const types = stats.channelTypes
    .filter(
      (item) =>
        item.channelType !== OTHER_CHANNEL_TYPE &&
        (item.converted > 0 || item.replied > 0),
    )
    .sort((a, b) => b.converted - a.converted || b.replied - a.replied)
    .slice(0, 3)
    .map((item) => item.channelType);
  const typesSentence = types.length
    ? ` Особенно результативные типы каналов: ${types.join(", ")}.`
    : "";
  return (
    `По фактическим результатам этого продукта уже работают: ${modes.join(", ")}.` +
    `${typesSentence} Отдавай приоритет похожим типам каналов.`
  );
}
