import { env } from "cloudflare:workers";
import { workspaceContentLocale } from "./workspace-locale";

// The prospects upsert, extracted out of app/api/prospects/route.ts so the
// pipeline runner stores discovered channels through exactly the same
// statement (and therefore the same defaults, clamping and dedupe key).

/**
 * The channel fields every source produces — discovery, the pipeline, CSV
 * import. Previously declared in a file of demo data, which made a fixture the
 * owner of a type the live upsert depends on.
 */
export type ResearchedProspect = {
  company: string;
  domain: string;
  url: string;
  description: string;
  source: string;
  channelType: string;
  reason: string;
  contact: string;
  email: string;
  telegram: string;
  score: number;
};

export type ProspectStage =
  | "discovered"
  | "queued"
  | "contacted"
  | "replied"
  | "meeting"
  | "won"
  | "lost";

export type StoredProspect = ResearchedProspect & {
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
  origin?: ProspectOrigin;
  /** What the channel's own page says it is, read during discovery. */
  siteTitle?: string;
  siteDescription?: string;
  /** Fit against the product, judged on the site's own words. */
  relevance?: string;
  relevanceReason?: string;
  recordKind?: "channel" | "contact";
  parentChannelId?: string;
  contactRole?: string;
  linkedin?: string;
  contactStatus?:
    | "not_checked"
    | "verified_public"
    | "found_unverified"
    | "not_found"
    | "check_failed";
  contactSourceUrl?: string;
  contactEvidence?: string;
  contactConfidence?: number;
  contactCheckedAt?: string;
};

/**
 * Provenance, stored in the existing `origin` text column. Anything other than
 * "curated" counts against the plan quota (`origin<>'curated'` in
 * usage-limits) — we paid the provider for it.
 */
export type ProspectOrigin = "curated" | "discovered";

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

export function prospectId(productId: string, item: { domain?: string; url?: string }) {
  return `${productId}:${item.domain}:${item.url}`.toLowerCase();
}

function storedProspectId(productId: string, item: StoredProspect) {
  const prefix = item.recordKind === "contact" ? "contact:" : "";
  return `${productId}:${prefix}${item.domain}:${item.url}`.toLowerCase();
}

export async function saveProspects(
  workspaceId: string,
  productId: string,
  items: StoredProspect[],
  origin: ProspectOrigin = "discovered",
) {
  const db = database();
  if (!db || !items.length) return;
  const now = new Date().toISOString();
  // Every row remembers the language it was written in. Without this a list
  // mixing two languages could be seen but not found: nothing distinguished a
  // row generated in July under an English switch from one generated in August
  // under a Russian one.
  const contentLocale = await workspaceContentLocale(workspaceId);
  await db.batch(
    items.map((item) =>
      db
        .prepare(
          `INSERT INTO prospects
           (id, product_id, company, domain, url, description, source,
            channel_type, reason, contact, email, telegram, score, status, stage,
            revenue_cents, outcome_note, opportunity_type, action_type,
            next_action, action_url, engagement_mode, commercial_model,
            pricing_summary, placement_requirements, usage_terms, registration_url,
            outreach_eligible, origin, site_title, site_description, relevance,
            relevance_reason, record_kind, parent_channel_id, contact_role,
            linkedin, contact_status, contact_source_url, contact_evidence,
            contact_confidence, contact_checked_at, created_at, updated_at,
            workspace_id, content_locale)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             company=excluded.company, description=excluded.description,
             source=excluded.source, channel_type=excluded.channel_type,
             reason=excluded.reason, contact=excluded.contact,
             email=excluded.email, telegram=excluded.telegram,
             score=excluded.score, opportunity_type=excluded.opportunity_type,
             action_type=excluded.action_type, next_action=excluded.next_action,
             action_url=excluded.action_url,
             engagement_mode=excluded.engagement_mode,
             commercial_model=excluded.commercial_model,
             pricing_summary=excluded.pricing_summary,
             placement_requirements=excluded.placement_requirements,
             usage_terms=excluded.usage_terms,
             registration_url=excluded.registration_url,
             outreach_eligible=excluded.outreach_eligible,
             origin=excluded.origin,
             site_title=excluded.site_title,
             site_description=excluded.site_description,
             relevance=excluded.relevance,
             relevance_reason=excluded.relevance_reason,
             record_kind=excluded.record_kind,
             parent_channel_id=excluded.parent_channel_id,
             contact_role=CASE WHEN excluded.contact_role<>'' THEN excluded.contact_role ELSE prospects.contact_role END,
             linkedin=CASE WHEN excluded.linkedin<>'' THEN excluded.linkedin ELSE prospects.linkedin END,
             contact_status=CASE WHEN excluded.contact_status<>'not_checked' THEN excluded.contact_status ELSE prospects.contact_status END,
             contact_source_url=CASE WHEN excluded.contact_source_url<>'' THEN excluded.contact_source_url ELSE prospects.contact_source_url END,
             contact_evidence=CASE WHEN excluded.contact_evidence<>'' THEN excluded.contact_evidence ELSE prospects.contact_evidence END,
             contact_confidence=MAX(prospects.contact_confidence, excluded.contact_confidence),
             contact_checked_at=COALESCE(excluded.contact_checked_at, prospects.contact_checked_at),
             updated_at=excluded.updated_at,
             content_locale=excluded.content_locale
           WHERE prospects.workspace_id=excluded.workspace_id`,
        )
        .bind(
          item.id || storedProspectId(productId, item),
          productId,
          item.company,
          item.domain,
          item.url,
          item.description || "",
          item.source || "",
          item.channelType || "",
          item.reason || "",
          item.contact || "",
          item.email || "",
          item.telegram || "",
          Math.max(0, Math.min(100, Number(item.score) || 0)),
          item.status || "review",
          item.stage || "discovered",
          Math.max(0, Math.round(Number(item.revenueCents) || 0)),
          String(item.outcomeNote || "").slice(0, 2000),
          item.opportunityType || "partner",
          item.actionType || "propose_partnership",
          String(item.nextAction || "").slice(0, 1000),
          String(item.actionUrl || item.url || "").slice(0, 2000),
          item.engagementMode || "unknown",
          item.commercialModel || "unknown",
          String(item.pricingSummary || "").slice(0, 1000),
          String(item.placementRequirements || "").slice(0, 2000),
          String(item.usageTerms || "").slice(0, 2000),
          String(item.registrationUrl || "").slice(0, 2000),
          item.outreachEligible ? 1 : 0,
          item.origin || origin,
          String(item.siteTitle || "").slice(0, 200),
          String(item.siteDescription || "").slice(0, 500),
          item.relevance || "unknown",
          String(item.relevanceReason || "").slice(0, 200),
          item.recordKind || "channel",
          String(item.parentChannelId || "").slice(0, 500),
          String(item.contactRole || "").slice(0, 300),
          String(item.linkedin || "").slice(0, 2000),
          item.contactStatus || "not_checked",
          String(item.contactSourceUrl || "").slice(0, 2000),
          String(item.contactEvidence || "").slice(0, 1000),
          Math.max(0, Math.min(100, Number(item.contactConfidence) || 0)),
          item.contactCheckedAt || null,
          now,
          now,
          workspaceId,
          contentLocale,
        ),
    ),
  );
}
