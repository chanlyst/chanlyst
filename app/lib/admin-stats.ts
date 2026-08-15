import { authDatabase } from "./auth";
import { planCatalog } from "./plans.mjs";

// What the operator panel is allowed to know.
//
// Every query here counts or dates; none of them select a channel description,
// a contact, a message body or a comment. That is the whole boundary, and it
// lives here rather than in the page so it cannot be widened by accident in
// markup: to show a customer's content someone has to come to this file and
// write a new query, which is a decision rather than a slip.

export type WorkspaceRow = {
  id: string;
  name: string;
  createdAt: string;
  ownerEmail: string;
  plan: string;
  subscriptionStatus: string;
  products: number;
  channels: number;
  lastRunAt: string | null;
  /** ai_usage stores millionths of a dollar, not cents. */
  spendMicroUsd: number;
};

/** One traffic source over the reporting window, and how far it got. */
export type VisitRow = {
  source: string;
  campaign: string;
  landed: number;
  signIn: number;
};

/** One aggregate of page behaviour: a source, a bucket, and how many visits. */
export type EventRow = { source: string; label: string; visits: number };

export type AdminStats = {
  users: number;
  workspaces: number;
  paying: number;
  mrrUsd: number;
  spendUsd30d: number;
  workspaceRows: WorkspaceRow[];
  /** Empty until the site_visits migration has been applied. */
  visitRows: VisitRow[];
  visitDays: number;
  dwellRows: EventRow[];
  scrollRows: EventRow[];
  clickRows: EventRow[];
};

/** Monthly value of a plan, whichever way it is billed. */
function monthlyUsd(plan: string) {
  const known = planCatalog[plan as keyof typeof planCatalog];
  return known ? known.monthlyUsd : 0;
}

export async function loadAdminStats(): Promise<AdminStats | null> {
  const db = authDatabase();
  if (!db) return null;

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  // One row per workspace: who owns it, what it pays, how much of the product
  // it has actually used, and what it has cost us in model calls.
  const rows = await db
    .prepare(
      `SELECT w.id, w.name, w.created_at AS createdAt,
              COALESCE(u.email, '') AS ownerEmail,
              COALESCE(s.plan, '') AS plan,
              COALESCE(s.status, '') AS subscriptionStatus,
              (SELECT COUNT(*) FROM products p
                WHERE p.workspace_id = w.id) AS products,
              (SELECT COUNT(*) FROM prospects pr
                WHERE pr.workspace_id = w.id) AS channels,
              (SELECT MAX(r.started_at) FROM pipeline_runs r
                WHERE r.workspace_id = w.id) AS lastRunAt,
              (SELECT COALESCE(SUM(a.cost_microusd), 0) FROM ai_usage a
                WHERE a.workspace_id = w.id) AS spendMicroUsd
         FROM workspaces w
         LEFT JOIN users u ON u.id = w.owner_user_id
         LEFT JOIN subscriptions s ON s.workspace_id = w.id
        ORDER BY w.created_at DESC`,
    )
    .all<WorkspaceRow>();
  const workspaceRows = (rows.results || []) as WorkspaceRow[];

  const users = await db
    .prepare(`SELECT COUNT(*) AS n FROM users`)
    .first<{ n?: number }>();
  const spend = await db
    .prepare(`SELECT COALESCE(SUM(cost_microusd), 0) AS n FROM ai_usage
              WHERE created_at > ?`)
    .bind(since)
    .first<{ n?: number }>();

  const payingRows = workspaceRows.filter(
    (row) =>
      row.subscriptionStatus === "active" || row.subscriptionStatus === "on_trial",
  );

  const visits = await loadVisits(db, VISIT_DAYS);
  const events = await loadEvents(db, VISIT_DAYS);

  return {
    users: Number(users?.n || 0),
    workspaces: workspaceRows.length,
    paying: payingRows.length,
    mrrUsd: payingRows.reduce((sum, row) => sum + monthlyUsd(row.plan), 0),
    spendUsd30d: Number(spend?.n || 0) / 1_000_000,
    workspaceRows,
    visitRows: visits.visitRows,
    visitDays: VISIT_DAYS,
    dwellRows: events.dwellRows,
    scrollRows: events.scrollRows,
    clickRows: events.clickRows,
  };
}

/** Traffic is read over a shorter window than spend: it moves faster. */
const VISIT_DAYS = 7;

/**
 * Where visitors came from and how far they got.
 *
 * Kept separate and forgiving: the table arrives with a migration, and a panel
 * that showed nothing at all until that migration ran would be worse than one
 * that shows every other number and an empty traffic section.
 */
async function loadVisits(db: D1Database, days: number) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  try {
    const bySource = await db
      .prepare(
        `SELECT source, campaign,
                SUM(CASE WHEN path = '/' THEN 1 ELSE 0 END) AS landed,
                SUM(CASE WHEN path = '/login' THEN 1 ELSE 0 END) AS signIn
           FROM site_visits
          WHERE created_at > ?
          GROUP BY source, campaign
          ORDER BY landed DESC, signIn DESC
          LIMIT 20`,
      )
      .bind(since)
      .all<VisitRow>();

    return {
      visitRows: (bySource.results || []) as VisitRow[],
    };
  } catch {
    return { visitRows: [] as VisitRow[] };
  }
}

/**
 * How the page was actually used.
 *
 * The dwell buckets are the point: a page that is open for under two seconds
 * was not read and probably not chosen — it is a thumb brushing an ad in a
 * feed, and it costs the same as a considered click.
 */
async function loadEvents(db: D1Database, days: number) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const empty = {
    dwellRows: [] as EventRow[],
    scrollRows: [] as EventRow[],
    clickRows: [] as EventRow[],
  };

  try {
    const read = async (kind: string) => {
      const result = await db
        .prepare(
          `SELECT source, label, COUNT(DISTINCT visit_id) AS visits
             FROM site_events
            WHERE created_at > ? AND kind = ?
            GROUP BY source, label
            ORDER BY visits DESC
            LIMIT 24`,
        )
        .bind(since, kind)
        .all<EventRow>();
      return (result.results || []) as EventRow[];
    };

    return {
      dwellRows: await read("dwell"),
      scrollRows: await read("scroll"),
      clickRows: await read("click"),
    };
  } catch {
    return empty;
  }
}
