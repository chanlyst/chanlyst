import {
  buildMonthlyReport,
  monthPeriod,
  previousMonthLabel,
} from "./monthly-report.mjs";

// The single loader behind the monthly report: the API route and the digest
// cron both go through it, so the e-mail and the dashboard can never be
// computed from different queries.

// A lead is loaded when any of its milestones lands in the two-month window;
// buildMonthlyReport then decides which month each milestone belongs to.
const DATE_COLUMNS = [
  "created_at",
  "contacted_at",
  "replied_at",
  "meeting_at",
  "converted_at",
  "placement_checked_at",
];

export type MonthlyReport = ReturnType<typeof buildMonthlyReport>;

export async function loadMonthlyReport(
  db: D1Database,
  workspaceId: string,
  options: { period: string; productId?: string; now?: Date },
): Promise<MonthlyReport> {
  const now = options.now || new Date();
  const period = monthPeriod(options.period);
  const previous = monthPeriod(previousMonthLabel(options.period));
  const from = previous.start;
  const to = period.end;
  const productId = options.productId || "";
  const productFilter = productId ? " AND product_id=?" : "";
  const productBinding = productId ? [productId] : [];
  const windowClause = DATE_COLUMNS.map(
    (column) => `(${column}>=? AND ${column}<?)`,
  ).join(" OR ");

  const [leads, messages, snapshots] = await Promise.all([
    db
      .prepare(
        `SELECT channel_type as channelType, engagement_mode as engagementMode,
         opportunity_type as opportunityType, action_type as actionType,
         commercial_model as commercialModel,
         stage, created_at as createdAt, contacted_at as contactedAt,
         replied_at as repliedAt, meeting_at as meetingAt,
         converted_at as convertedAt, revenue_cents as revenueCents,
         placement_status as placementStatus,
         placement_checked_at as placementCheckedAt
         FROM prospects WHERE workspace_id=?${productFilter}
         AND (${windowClause})`,
      )
      .bind(
        workspaceId,
        ...productBinding,
        ...DATE_COLUMNS.flatMap(() => [from, to]),
      )
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT status, sent_at as sentAt FROM outbound_messages
         WHERE workspace_id=?${productFilter} AND status='sent'
         AND sent_at>=? AND sent_at<?`,
      )
      .bind(workspaceId, ...productBinding, from, to)
      .all<Record<string, unknown>>(),
    // Snapshots carry no product_id, so a per-product report still shows the
    // workspace-wide monitoring count.
    db
      .prepare(
        `SELECT lead_id as leadId, checked_at as checkedAt
         FROM channel_snapshots
         WHERE workspace_id=? AND checked_at>=? AND checked_at<?`,
      )
      .bind(workspaceId, from, to)
      .all<Record<string, unknown>>(),
  ]);

  return buildMonthlyReport({
    now,
    periodStart: period.start,
    periodEnd: period.end,
    leads: leads.results,
    messages: messages.results,
    snapshots: snapshots.results,
    // The same arrays serve both periods: rows are filtered by date.
    previous: {
      periodStart: previous.start,
      periodEnd: previous.end,
      leads: leads.results,
      messages: messages.results,
      snapshots: snapshots.results,
    },
  });
}
