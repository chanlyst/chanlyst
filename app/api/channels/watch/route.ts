import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../../lib/auth";
import { fetchPublic } from "../../../lib/fetch-public";
import { planWatchTasks } from "../../../lib/lifecycle-rules.mjs";
import {
  diffSnapshots,
  isUnreachable,
  snapshotFromPage,
  watchConditions,
} from "../../../lib/channel-watch.mjs";
import { safePublicUrl, timingSafeEqualStrings } from "../../../lib/security-helpers.mjs";

// Channel monitoring: the recurring half of the product.
//
// Discovery only ever finds NEW channels. This pass looks at the channels the
// user already works with and answers three questions with a plain HTTP GET:
// is our listing still on the page, is the page still reachable, and did the
// price or terms move. It costs one request per channel per week and NOT ONE
// MODEL CALL — the comparison lives in app/lib/channel-watch.mjs and is pure
// string work. Findings become lead_tasks; the user decides what to do.

type WorkspaceResult = {
  workspaceId: string;
  checked: number;
  findings: number;
  tasksCreated: number;
  tasksClosed: number;
};

type WatchLead = {
  id: string;
  productId: string;
  url: string;
  placementUrl: string;
  registrationUrl: string;
  productWebsite: string;
  productName: string;
  domain: string;
};

type SnapshotRow = {
  statusCode: number;
  contentHash: string;
  title: string;
  mentionsProduct: number;
  priceExcerpt: string;
  checkedAt: string;
};

// Upper bounds so one cron tick can never turn into an unbounded crawl.
const workspaceBatchSize = 50;
const leadsPerWorkspace = 40;
// Politeness gap between two outbound requests inside one workspace.
const fetchDelayMs = 400;
// Enough history to count a run of failures without reading the whole table.
const historyDepth = 5;
const maxPageChars = 250_000;

function bindings() {
  return env as unknown as { DB?: D1Database; AGENT_CRON_SECRET?: string };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Which page represents this channel. The published listing is the most
 * specific answer, then the place we registered, then the channel's own page.
 */
function watchUrl(lead: WatchLead) {
  return (
    lead.placementUrl?.trim() ||
    lead.registrationUrl?.trim() ||
    lead.url?.trim() ||
    lead.domain?.trim() ||
    ""
  );
}

/** Take one snapshot of one channel. Never throws: a failure IS a data point. */
async function checkLead(lead: WatchLead) {
  const target = watchUrl(lead);
  const safe = safePublicUrl(target);
  if (!safe) {
    return {
      url: target,
      ...snapshotFromPage({ html: "", url: target, statusCode: 0 }),
    };
  }
  try {
    const fetched = await fetchPublic(safe, {
      userAgent: "Chanlyst Channel Monitor/1.0",
      allowErrorStatus: true,
    });
    if (!fetched) {
      return {
        url: safe.toString(),
        ...snapshotFromPage({ html: "", url: safe.toString(), statusCode: 0 }),
      };
    }
    const status = fetched.response.status;
    // An error page's body says nothing about the listing, so it is not read.
    const html = isUnreachable(status)
      ? ""
      : (await fetched.response.text()).slice(0, maxPageChars);
    return {
      url: fetched.url.toString(),
      ...snapshotFromPage({
        html,
        url: fetched.url.toString(),
        statusCode: status,
        productDomain: lead.productWebsite,
        productName: lead.productName,
      }),
    };
  } catch {
    // DNS failure, TLS error, timeout: recorded as status 0 and only reported
    // to the user if it happens twice in a row.
    return {
      url: safe.toString(),
      ...snapshotFromPage({ html: "", url: safe.toString(), statusCode: 0 }),
    };
  }
}

async function processWorkspace(workspaceId: string): Promise<WorkspaceResult> {
  const db = bindings().DB!;
  // Worth watching: a live listing, a place we registered at, or terms we
  // recorded. Everything else is still just a discovery result.
  const leads = await db
    .prepare(
      `SELECT p.id as id, p.product_id as productId, p.url as url,
       p.domain as domain, p.placement_url as placementUrl,
       p.registration_url as registrationUrl,
       pr.website as productWebsite, pr.name as productName,
       (SELECT MAX(s.checked_at) FROM channel_snapshots s
        WHERE s.lead_id=p.id) as lastCheckedAt
       FROM prospects p
       JOIN products pr ON pr.id=p.product_id AND pr.workspace_id=p.workspace_id
       WHERE p.workspace_id=?
         AND (p.placement_status='published' OR p.registration_url<>''
              OR p.placement_url<>'' OR p.pricing_summary<>'')
       ORDER BY COALESCE(lastCheckedAt, '') ASC, p.created_at ASC
       LIMIT ?`,
    )
    .bind(workspaceId, leadsPerWorkspace)
    .all<WatchLead & { lastCheckedAt?: string | null }>();

  let checked = 0;
  let findingCount = 0;
  let created = 0;
  let closed = 0;

  for (const [index, lead] of leads.results.entries()) {
    if (!watchUrl(lead)) continue;
    if (index > 0) await delay(fetchDelayMs);
    const now = new Date().toISOString();
    const [history, tasks] = await Promise.all([
      db
        .prepare(
          `SELECT status_code as statusCode, content_hash as contentHash,
           title, mentions_product as mentionsProduct,
           price_excerpt as priceExcerpt, checked_at as checkedAt
           FROM channel_snapshots WHERE lead_id=? AND workspace_id=?
           ORDER BY checked_at DESC LIMIT ?`,
        )
        .bind(lead.id, workspaceId, historyDepth)
        .all<SnapshotRow>(),
      db
        .prepare(
          `SELECT id, lead_id as leadId, type, status FROM lead_tasks
           WHERE workspace_id=? AND lead_id=?`,
        )
        .bind(workspaceId, lead.id)
        .all<Record<string, unknown>>(),
    ]);

    const rows = history.results;
    // The newest snapshot that actually read the page is the baseline; an
    // unreachable check carries no content to compare against.
    const previous = rows.find((row) => !isUnreachable(Number(row.statusCode))) || null;
    let previousFailures = 0;
    for (const row of rows) {
      if (!isUnreachable(Number(row.statusCode))) break;
      previousFailures += 1;
    }
    const everMentioned = rows.some((row) => Number(row.mentionsProduct) === 1);

    const snapshot = await checkLead(lead);
    checked += 1;
    const findings = diffSnapshots(previous, snapshot, { previousFailures });
    // content_changed is informational: it proves the check ran and the page
    // moved, but on its own it is not worth interrupting anybody.
    findingCount += findings.filter(
      (finding) => finding.type !== "content_changed",
    ).length;
    const conditions = watchConditions({
      previous,
      current: snapshot,
      previousFailures,
      everMentioned,
    });
    const terms = findings.find((finding) => finding.type === "terms_changed");
    const unreachable = findings.find(
      (finding) => finding.type === "page_unreachable",
    );
    const plan = planWatchTasks({
      now,
      lead: { id: lead.id, workspaceId, productId: lead.productId },
      conditions,
      payloads: {
        listing_missing: {
          watchUrl: snapshot.url,
          statusCode: snapshot.statusCode,
        },
        terms_changed: {
          watchUrl: snapshot.url,
          previousTerms: String(terms?.from || previous?.priceExcerpt || ""),
          currentTerms: String(terms?.to || snapshot.priceExcerpt || ""),
        },
        channel_unreachable: {
          watchUrl: snapshot.url,
          statusCode: snapshot.statusCode,
          failures: Number(unreachable?.failures || previousFailures + 1),
        },
      },
      tasks: tasks.results,
    });

    const statements = [
      db
        .prepare(
          `INSERT INTO channel_snapshots
           (id, workspace_id, lead_id, url, status_code, content_hash, title,
            mentions_product, price_excerpt, checked_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          workspaceId,
          lead.id,
          String(snapshot.url || "").slice(0, 2000),
          snapshot.statusCode,
          snapshot.contentHash,
          String(snapshot.title || "").slice(0, 300),
          snapshot.mentionsProduct ? 1 : 0,
          String(snapshot.priceExcerpt || "").slice(0, 200),
          now,
          now,
        ),
      ...plan.create.map((task) =>
        db
          .prepare(
            `INSERT INTO lead_tasks
             (id, workspace_id, product_id, lead_id, type, due_at, payload,
              status, snoozed_until, created_at, updated_at, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?, NULL)`,
          )
          .bind(
            crypto.randomUUID(),
            workspaceId,
            String(task.productId || ""),
            lead.id,
            String(task.type || ""),
            String(task.dueAt || now),
            JSON.stringify(task.payload || {}),
            now,
            now,
          ),
      ),
      // A monitoring task closes itself the moment a later snapshot proves the
      // problem is over: the listing is back, the page answers again, or the
      // terms held steady for a whole cycle.
      ...plan.close.map((task) =>
        db
          .prepare(
            `UPDATE lead_tasks SET status='done', snoozed_until=NULL,
             completed_at=?, updated_at=? WHERE id=? AND workspace_id=?`,
          )
          .bind(now, now, task.id, workspaceId),
      ),
    ];
    await db.batch(statements);
    created += plan.create.length;
    closed += plan.close.length;
  }

  return {
    workspaceId,
    checked,
    findings: findingCount,
    tasksCreated: created,
    tasksClosed: closed,
  };
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

  if (!isCron) {
    // "Check my channels now" from the dashboard: the caller's workspace only.
    const auth = await requireApiSession(request);
    if (isAuthResponse(auth)) return auth;
    const result = await processWorkspace(auth.workspaceId);
    return Response.json({ ok: true, results: [result] });
  }

  const workspaces = await db
    .prepare(
      `SELECT w.id as id FROM workspaces w
       WHERE EXISTS (SELECT 1 FROM prospects p WHERE p.workspace_id=w.id)
       ORDER BY w.created_at ASC LIMIT ?`,
    )
    .bind(workspaceBatchSize)
    .all<{ id: string }>();
  const results: WorkspaceResult[] = [];
  for (const row of workspaces.results) {
    try {
      results.push(await processWorkspace(row.id));
    } catch {
      // One unhappy workspace must not stop the rest of the sweep.
      results.push({
        workspaceId: row.id,
        checked: 0,
        findings: 0,
        tasksCreated: 0,
        tasksClosed: 0,
      });
    }
  }
  return Response.json({
    ok: true,
    workspaces: workspaces.results.length,
    checked: results.reduce((sum, item) => sum + item.checked, 0),
    findings: results.reduce((sum, item) => sum + item.findings, 0),
    tasksCreated: results.reduce((sum, item) => sum + item.tasksCreated, 0),
    tasksClosed: results.reduce((sum, item) => sum + item.tasksClosed, 0),
    results,
  });
}
