import { env } from "cloudflare:workers";
import { engagementModeForLead } from "../../lib/engagement-mode";
import { contactRouteForLead } from "../../lib/contact-route.mjs";
import { orderByGroup } from "../../lib/channel-groups.mjs";
import { isAuthResponse, requireApiSession } from "../../lib/auth";
import { enforceUsageLimit } from "../../lib/usage-limits";
import { isValidEmail } from "../../lib/security-helpers.mjs";
// The upsert itself lives in app/lib/prospect-store.ts so the pipeline runner
// stores discovered channels through exactly the same statement.
import {
  saveProspects as saveMany,
  type ResearchedProspect,
} from "../../lib/prospect-store";

type ProspectPayload = ResearchedProspect & {
  id?: string;
  status?: "review" | "approved" | "rejected";
  stage?: ProspectStage;
  revenueCents?: number;
  outcomeNote?: string;
  opportunityType?: string;
  actionType?: string;
  nextAction?: string;
  actionUrl?: string;
  engagementMode?: "free_listing" | "paid_placement" | "outreach" | "unknown";
  commercialModel?: "free" | "paid" | "commission" | "unknown";
  pricingSummary?: string;
  placementRequirements?: string;
  usageTerms?: string;
  registrationUrl?: string;
  outreachEligible?: boolean;
  origin?: "curated" | "discovered";
};

type ProspectStage =
  | "discovered"
  | "queued"
  | "contacted"
  | "replied"
  | "meeting"
  | "won"
  | "lost";

const prospectStages: ProspectStage[] = [
  "discovered",
  "queued",
  "contacted",
  "replied",
  "meeting",
  "won",
  "lost",
];

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

function normalizedEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  return isValidEmail(email) ? email : "";
}


type ProspectRow = {
  status?: string;
  stage?: string;
  placementStatus?: string;
  revenueCents?: number;
  engagementMode?: string;
  opportunityType?: string;
  actionType?: string;
  channelType?: string;
  assignedUserId?: string;
} & Record<string, unknown>;

const engagementModes = ["free_listing", "paid_placement", "outreach"] as const;

type PlacementStatus = "" | "to_submit" | "submitted" | "published" | "rejected";

const placementStatuses: PlacementStatus[] = [
  "",
  "to_submit",
  "submitted",
  "published",
  "rejected",
];

// Placement URLs are stored and rendered as links, so only http(s) is allowed.
function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseCount(value: string | null, max: number) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(max, parsed);
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  const searchParams = new URL(request.url).searchParams;
  const productId = searchParams.get("productId") || "";
  // Optional pagination. The paginated response shape ({ prospects, total,
  // counts, outcomeLeads }) is only used when `limit` is present so existing
  // consumers keep receiving the full flat list.
  const limit = parseCount(searchParams.get("limit"), 100);
  const offset = parseCount(searchParams.get("offset"), Number.MAX_SAFE_INTEGER) || 0;
  const modeParam = searchParams.get("mode");
  const mode = engagementModes.find((item) => item === modeParam) || null;
  // "route=network" is the fourth grouping chip: leads whose way in is an
  // affiliate network rather than a mailbox. Applied server-side exactly like
  // `mode` and `assigned`, so it composes with pagination.
  const routeFilter = searchParams.get("route") === "network" ? "network" : null;
  // Channels the relevance pass flagged: live and real, aimed at a different
  // audience. They are grouped off rather than deleted, so they are reachable
  // through their own chip and absent everywhere else.
  const doubtfulOnly = searchParams.get("relevance") === "doubtful";
  // Channels where a confirmed rival holds a listing and this product does
  // not. Written by the gap analysis, read here — never recomputed on view.
  const competitorsOnly = searchParams.get("gap") === "competitors";
  // "assigned=me" narrows the list to leads assigned to the current user.
  // It is applied server-side (like `mode`) so it composes with pagination.
  const assignedToMe = searchParams.get("assigned") === "me";
  const requestedKind = searchParams.get("kind");
  const recordKind =
    requestedKind === "contact"
      ? "contact"
      : requestedKind === "channel"
        ? "channel"
        : "";
  if (!db || !productId) {
    return limit === null
      ? Response.json({ prospects: [], persisted: false })
      : Response.json({
          prospects: [],
          total: 0,
          counts: {
            all: 0,
            free_listing: 0,
            paid_placement: 0,
            outreach: 0,
            network_route: 0,
            competitors: 0,
            doubtful: 0,
          },
          placementCounts: { to_submit: 0, submitted: 0, published: 0, rejected: 0 },
          outcomeLeads: [],
          newCount: 0,
          persisted: false,
        });
  }
  // `site_title`/`site_description` are what the channel's own page says it is,
  // and `relevance` is how that squared with the product. Both ride along so a
  // card can show what a site actually is without anyone opening it.
  // The newest channel-monitoring check rides along as three correlated
  // subqueries on the (lead_id, checked_at) index. That is cheaper than a
  // second request from the dashboard and it keeps every consumer of this
  // endpoint — paginated or not — showing the same freshness line.
  const result = await db
    .prepare(
      `SELECT id, company, domain, url, description, source,
       channel_type as channelType, reason, contact, email, telegram,
       score, status, stage, contacted_at as contactedAt,
       replied_at as repliedAt, meeting_at as meetingAt,
       converted_at as convertedAt, revenue_cents as revenueCents,
       outcome_note as outcomeNote, opportunity_type as opportunityType,
       action_type as actionType, next_action as nextAction,
       action_url as actionUrl, engagement_mode as engagementMode,
       commercial_model as commercialModel, pricing_summary as pricingSummary,
       placement_requirements as placementRequirements,
       usage_terms as usageTerms, registration_url as registrationUrl,
       outreach_eligible as outreachEligible,
       placement_status as placementStatus,
       placement_submitted_at as placementSubmittedAt,
       placement_checked_at as placementCheckedAt,
       placement_url as placementUrl, utm_link as utmLink,
       contact_role as contactRole,
       linkedin, contact_status as contactStatus,
       contact_source_url as contactSourceUrl,
       contact_evidence as contactEvidence,
       contact_confidence as contactConfidence,
       contact_checked_at as contactCheckedAt,
       origin,
       site_title as siteTitle, site_description as siteDescription,
       relevance, relevance_reason as relevanceReason,
       competitor_presence as competitorPresence,
       record_kind as recordKind, parent_channel_id as parentChannelId,
       assigned_user_id as assignedUserId,
       (SELECT COUNT(*) FROM lead_comments c
        WHERE c.lead_id = prospects.id) as commentCount,
       (SELECT s.checked_at FROM channel_snapshots s
        WHERE s.lead_id = prospects.id
        ORDER BY s.checked_at DESC LIMIT 1) as watchCheckedAt,
       (SELECT s.status_code FROM channel_snapshots s
        WHERE s.lead_id = prospects.id
        ORDER BY s.checked_at DESC LIMIT 1) as watchStatusCode,
       (SELECT s.mentions_product FROM channel_snapshots s
        WHERE s.lead_id = prospects.id
        ORDER BY s.checked_at DESC LIMIT 1) as watchMentionsProduct
       FROM prospects WHERE product_id = ? AND workspace_id=?
         AND (?='' OR record_kind=?)
       ORDER BY score DESC, company ASC`,
    )
    .bind(productId, auth.workspaceId, recordKind, recordKind)
    .all();
  const rows = result.results as ProspectRow[];
  // The assignment scope narrows everything the mode filter sees, so the
  // mode chips show counts within "mine" while it is active.
  const scoped = assignedToMe
    ? rows.filter((row) => String(row.assignedUserId || "") === auth.userId)
    : rows;
  // A `network` lead has left the outreach queue: its way in is registering in
  // an affiliate network, so it belongs to the «Через партнёрскую сеть» chip
  // and not to «Для рассылки». `none` leads stay under outreach — the user
  // still has to decide between manual research and rejection there.
  const isDoubtful = (row: ProspectRow) => String(row.relevance || "") === "doubtful";
  const hasRival = (row: ProspectRow) => Boolean(String(row.competitorPresence || ""));
  const inMode = (row: ProspectRow, target: string) =>
    engagementModeForLead(row) === target &&
    !(target === "outreach" && contactRouteForLead(row) === "network");
  // Every other view works on the channels that were NOT flagged: a doubtful
  // channel dilutes a count it does not belong in.
  const working = scoped.filter((row) => !isDoubtful(row));
  const filtered = doubtfulOnly
    ? scoped.filter(isDoubtful)
    : competitorsOnly
      ? working.filter(hasRival)
      : routeFilter
      ? working.filter((row) => contactRouteForLead(row) === routeFilter)
      : mode
        ? working.filter((row) => inMode(row, mode))
        : // The unfiltered list leads with what can be submitted today rather
          // than with the highest score, which was a media sponsorship priced
          // by request. A chip is already one group, so it keeps score order.
          orderByGroup(working);
  if (limit === null) {
    return Response.json({ prospects: filtered, persisted: true });
  }
  const counts = {
    all: working.length,
    free_listing: 0,
    paid_placement: 0,
    outreach: 0,
    network_route: 0,
    competitors: 0,
    doubtful: scoped.length - working.length,
  };
  for (const row of working) {
    for (const item of engagementModes) if (inMode(row, item)) counts[item] += 1;
    if (contactRouteForLead(row) === "network") counts.network_route += 1;
    if (hasRival(row)) counts.competitors += 1;
  }
  // Placement pipeline counters over the whole filtered set (not just the
  // visible page) so the dashboard summary stays accurate under pagination.
  const placementCounts = { to_submit: 0, submitted: 0, published: 0, rejected: 0 };
  for (const row of filtered) {
    const status = String(row.placementStatus || "");
    if (status && status in placementCounts) {
      placementCounts[status as keyof typeof placementCounts] += 1;
    }
  }
  // Leads that already entered the funnel: the dashboard renders the results
  // section from this list so pagination does not skew funnel metrics.
  const outcomeLeads = rows.filter(
    (row) => row.status === "approved" || row.stage !== "discovered",
  );
  // Prospects created after the user's last visit to this product's leads
  // (products.monitoring_last_seen_at). NULL last-seen compares as NULL in
  // SQLite, so the count is 0 until the first visit is recorded.
  const newRow = await db
    .prepare(
      `SELECT COUNT(*) as count FROM prospects
       WHERE product_id=?1 AND workspace_id=?2 AND created_at >
         (SELECT monitoring_last_seen_at FROM products
          WHERE id=?1 AND workspace_id=?2)`,
    )
    .bind(productId, auth.workspaceId)
    .first<{ count?: number }>();
  return Response.json({
    prospects: filtered.slice(offset, offset + limit),
    total: filtered.length,
    counts,
    placementCounts,
    outcomeLeads,
    newCount: Number(newRow?.count || 0),
    persisted: true,
  });
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const payload = (await request.json()) as {
    productId?: string;
    prospects?: ProspectPayload[];
  };
  if (!payload.productId || !Array.isArray(payload.prospects)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const db = database();
  const product = db
    ? await db
        .prepare("SELECT id FROM products WHERE id=? AND workspace_id=?")
        .bind(payload.productId, auth.workspaceId)
        .first()
    : null;
  if (!product) {
    return Response.json({ error: "product_not_found" }, { status: 404 });
  }
  const quota = await enforceUsageLimit(auth.workspaceId, "channels", {
    count: payload.prospects.length,
  });
  if (!quota.allowed && quota.remaining <= 0) return quota.response!;
  // The client cannot mint trusted prospects: status, origin and email are
  // always re-derived on the server, and the batch is trimmed to the quota.
  const items = payload.prospects.slice(0, quota.remaining).map((item) => ({
    ...item,
    status: "review" as const,
    origin: "discovered" as const,
    email: normalizedEmail(item.email),
  }));
  await saveMany(auth.workspaceId, payload.productId, items);
  return Response.json({ persisted: true, count: items.length });
}

export async function PATCH(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  const payload = (await request.json()) as {
    id?: string;
    status?: "review" | "approved" | "rejected";
    stage?: ProspectStage;
    revenueCents?: number;
    outcomeNote?: string;
    placementStatus?: PlacementStatus;
    placementUrl?: string;
    utmLink?: string;
    assignedUserId?: string;
  };
  const validStatus =
    payload.status === undefined ||
    ["review", "approved", "rejected"].includes(payload.status);
  const validStage =
    payload.stage === undefined || prospectStages.includes(payload.stage);
  const validPlacementStatus =
    payload.placementStatus === undefined ||
    placementStatuses.includes(payload.placementStatus);
  const placementUrl =
    payload.placementUrl === undefined
      ? undefined
      : String(payload.placementUrl).trim().slice(0, 2000);
  const utmLink =
    payload.utmLink === undefined
      ? undefined
      : String(payload.utmLink).trim().slice(0, 2000);
  const validPlacementUrl =
    placementUrl === undefined || placementUrl === "" || isHttpUrl(placementUrl);
  const validUtmLink =
    utmLink === undefined || utmLink === "" || isHttpUrl(utmLink);
  const assignedUserId =
    payload.assignedUserId === undefined
      ? undefined
      : String(payload.assignedUserId);
  // '' clears the assignment; any other value must be a workspace member.
  const validAssignee =
    assignedUserId === undefined ||
    assignedUserId === "" ||
    Boolean(
      db &&
        (await db
          .prepare(
            "SELECT user_id FROM workspace_members WHERE workspace_id=? AND user_id=?",
          )
          .bind(auth.workspaceId, assignedUserId)
          .first()),
    );
  const hasChange =
    payload.status !== undefined ||
    payload.stage !== undefined ||
    payload.revenueCents !== undefined ||
    payload.outcomeNote !== undefined ||
    payload.placementStatus !== undefined ||
    placementUrl !== undefined ||
    utmLink !== undefined ||
    assignedUserId !== undefined;
  if (
    !db ||
    !payload.id ||
    !validStatus ||
    !validStage ||
    !validPlacementStatus ||
    !validPlacementUrl ||
    !validUtmLink ||
    !validAssignee ||
    !hasChange
  ) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const current = await db
    .prepare(
      `SELECT status, stage, revenue_cents as revenueCents,
       outcome_note as outcomeNote, placement_status as placementStatus,
       placement_submitted_at as placementSubmittedAt,
       placement_checked_at as placementCheckedAt,
       placement_url as placementUrl, utm_link as utmLink,
       assigned_user_id as assignedUserId
       FROM prospects WHERE id = ? AND workspace_id=?`,
    )
    .bind(payload.id, auth.workspaceId)
    .first<{
      status?: string;
      stage?: string;
      revenueCents?: number;
      outcomeNote?: string;
      placementStatus?: string;
      placementSubmittedAt?: string | null;
      placementCheckedAt?: string | null;
      placementUrl?: string;
      utmLink?: string;
      assignedUserId?: string;
    }>();
  if (!current) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const now = new Date().toISOString();
  const nextStage = payload.stage || current.stage || "discovered";
  const nextPlacementStatus =
    payload.placementStatus ?? String(current.placementStatus || "");
  // The submission timestamp is server-authoritative: it is stamped once on
  // the transition to 'submitted' and never overwritten afterwards.
  const nextPlacementSubmittedAt =
    current.placementSubmittedAt ||
    (payload.placementStatus === "submitted" ? now : null);
  // A transition to a terminal state doubles as "I checked the listing now".
  const nextPlacementCheckedAt =
    payload.placementStatus === "published" ||
    payload.placementStatus === "rejected"
      ? now
      : current.placementCheckedAt || null;
  const nextPlacementUrl = placementUrl ?? String(current.placementUrl || "");
  const nextUtmLink = utmLink ?? String(current.utmLink || "");
  const nextAssignedUserId =
    assignedUserId ?? String(current.assignedUserId || "");
  const revenueCents = Math.max(
    0,
    Math.min(
      100_000_000_00,
      Math.round(payload.revenueCents ?? Number(current.revenueCents || 0)),
    ),
  );
  await db
    .prepare(
      `UPDATE prospects SET status = ?, stage = ?, revenue_cents = ?,
       outcome_note = ?, placement_status = ?, placement_submitted_at = ?,
       placement_checked_at = ?, placement_url = ?, utm_link = ?,
       assigned_user_id = ?,
       contacted_at = CASE WHEN ? IN ('contacted','replied','meeting','won')
         THEN COALESCE(contacted_at, ?) ELSE contacted_at END,
       replied_at = CASE WHEN ? IN ('replied','meeting','won')
         THEN COALESCE(replied_at, ?) ELSE replied_at END,
       meeting_at = CASE WHEN ? IN ('meeting','won')
         THEN COALESCE(meeting_at, ?) ELSE meeting_at END,
       converted_at = CASE WHEN ? = 'won'
         THEN COALESCE(converted_at, ?) ELSE converted_at END,
       updated_at = ? WHERE id = ? AND workspace_id=?`,
    )
    .bind(
      payload.status || current.status || "review",
      nextStage,
      revenueCents,
      String(payload.outcomeNote ?? current.outcomeNote ?? "").slice(0, 2000),
      nextPlacementStatus,
      nextPlacementSubmittedAt,
      nextPlacementCheckedAt,
      nextPlacementUrl,
      nextUtmLink,
      nextAssignedUserId,
      nextStage,
      now,
      nextStage,
      now,
      nextStage,
      now,
      nextStage,
      now,
      now,
      payload.id,
      auth.workspaceId,
    )
    .run();
  return Response.json({
    persisted: true,
    prospect: {
      id: payload.id,
      status: payload.status || current.status,
      stage: nextStage,
      revenueCents,
      outcomeNote: String(payload.outcomeNote ?? current.outcomeNote ?? ""),
      placementStatus: nextPlacementStatus,
      placementSubmittedAt: nextPlacementSubmittedAt,
      placementCheckedAt: nextPlacementCheckedAt,
      placementUrl: nextPlacementUrl,
      utmLink: nextUtmLink,
      assignedUserId: nextAssignedUserId,
    },
  });
}
