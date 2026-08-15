import type { EngagementMode } from "../lib/engagement-mode";

export {
  engagementModeForLead,
  isSupplySideChannel,
} from "../lib/engagement-mode";
export type { EngagementMode } from "../lib/engagement-mode";
export {
  contactNetworkFor,
  contactRouteForLead,
  isReachableByOutreach,
} from "../lib/contact-route.mjs";
/** How a lead can be reached: see app/lib/contact-route.mjs. */
export type ContactRoute = "direct" | "network" | "none";
/**
 * The grouping chips above the lead list. The first four are engagement modes;
 * "network_route" is the contact-route group «Через партнёрскую сеть», which
 * the server applies through `route=network` instead of `mode=`.
 */
export type LeadModeFilter =
  | "all"
  | Exclude<EngagementMode, "unknown">
  | "network_route"
  // Channels a confirmed rival already holds a listing on and this product
  // does not. Written by the gap analysis, never derived on the fly.
  | "competitors"
  // Channels whose own page disagrees with the product. Grouped off so they
  // never dilute the working list, and never deleted so the call stays the
  // user's.
  | "doubtful";
export type LeadModeCounts = {
  all: number;
  free_listing: number;
  paid_placement: number;
  outreach: number;
  network_route: number;
  competitors: number;
  doubtful: number;
};
export type PlacementStatus =
  | ""
  | "to_submit"
  | "submitted"
  | "published"
  | "rejected";
export type PlacementCounts = {
  to_submit: number;
  submitted: number;
  published: number;
  rejected: number;
};
export type ProspectStage =
  | "discovered"
  | "queued"
  | "contacted"
  | "replied"
  | "meeting"
  | "won"
  | "lost";
export type AcquisitionMotion = {
  id:
    | "direct_sales"
    | "partnerships"
    | "affiliates"
    | "directories"
    | "creators"
    | "communities"
    | "content_seo"
    | "paid_placements";
  score: number;
  rationale: string;
  firstAction: string;
  timeToSignal: string;
  budgetLevel: "low" | "medium" | "high";
  kpi: string;
};
export type ProductAnalysis = {
  summary?: string;
  category?: string;
  audience?: string;
  negativeAudience?: string;
  offer?: string;
  channelTypes?: string[];
  searchQueries?: string[];
  /**
   * Rivals to measure the distribution gap against. `confirmed` separates a
   * model's suggestion from the user's answer: an unconfirmed name is shown
   * for approval and never searched on.
   */
  competitors?: Array<{ name: string; domain: string; confirmed?: boolean }>;
  acquisitionMotions?: AcquisitionMotion[];
};
export type Product = {
  id: string;
  name: string;
  website: string;
  description: string;
  category: string;
  audience: string;
  negativeAudience: string;
  geography: string;
  languages: string;
  goal: string;
  monetizationModel: string;
  paidOffer: string;
  priceRange: string;
  paymentPoint: string;
  conversionEvent: string;
  attributionMethod: string;
  partnerTerms: string;
  analysis: ProductAnalysis;
  /** Niche monitoring: the background agent keeps watching this product. */
  monitoringEnabled?: boolean;
  /** [] means "inherit the workspace agent sources". */
  monitoringSources?: string[];
  /** Prospects created since the user's last visit to this product's leads. */
  newCount?: number;
};
export type Lead = {
  id: string;
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
  opportunityType:
    | "direct_buyer"
    | "partner"
    | "affiliate_publisher"
    | "directory"
    | "creator"
    | "community"
    | "content_opportunity"
    | "paid_placement"
    // Supply side: a network or marketplace where the advertiser lists the
    // offer and partners come to it.
    | "affiliate_network";
  actionType:
    | "find_decision_maker"
    | "propose_partnership"
    | "apply_listing"
    | "submit_product"
    | "contact_creator"
    | "join_community"
    | "pitch_content"
    | "request_media_kit"
    | "list_offer";
  nextAction: string;
  actionUrl: string;
  engagementMode?: EngagementMode;
  commercialModel?: "free" | "paid" | "commission" | "unknown";
  pricingSummary?: string;
  placementRequirements?: string;
  usageTerms?: string;
  registrationUrl?: string;
  placementStatus?: PlacementStatus;
  placementSubmittedAt?: string | null;
  placementCheckedAt?: string | null;
  placementUrl?: string;
  utmLink?: string;
  outreachEligible?: boolean;
  contactRole?: string;
  linkedin?: string;
  contactStatus?:
    | "not_checked"
    | "verified_public"
    | "found_unverified"
    | "not_found"
    /** The provider was billed but its answer was unusable: nothing checked. */
    | "check_failed";
  contactSourceUrl?: string;
  contactEvidence?: string;
  contactConfidence?: number;
  contactCheckedAt?: string;
  origin?: "curated" | "discovered";
  /** What the channel's own page says it is, read from the site itself. */
  siteTitle?: string;
  siteDescription?: string;
  /**
   * How the site's own words squared with the product: "doubtful" means live
   * and real but aimed elsewhere. "unknown" means nobody judged it — an
   * ordinary channel, not a suspect one.
   */
  relevance?: "ok" | "doubtful" | "unknown";
  relevanceReason?: string;
  /**
   * Rivals holding a listing on this channel, as JSON — written by the gap
   * analysis. Each carries the page that proves it, because "your competitor
   * is here" without a link is a claim the user cannot check.
   */
  competitorPresence?: string;
  // Newest channel_snapshots row for this lead, joined into the lead payload
  // so the card can show "проверено 2 дня назад · размещение на месте".
  watchCheckedAt?: string | null;
  watchStatusCode?: number | null;
  watchMentionsProduct?: number | null;
  // '' means unassigned; otherwise the user id of a workspace member.
  assignedUserId?: string;
  commentCount?: number;
  status: "review" | "approved" | "rejected";
  stage: ProspectStage;
  contactedAt?: string;
  repliedAt?: string;
  meetingAt?: string;
  convertedAt?: string;
  revenueCents: number;
  outcomeNote: string;
  recordKind?: "channel" | "contact";
  parentChannelId?: string;
};

export type Message = {
  id: string;
  productId: string;
  leadId: string;
  company: string;
  channel: "email" | "telegram" | "linkedin";
  subject: string;
  body: string;
  status: "queued" | "sending" | "sent" | "failed";
  // '' means the message was not created from a template.
  templateId?: string;
  createdAt: string;
  sentAt?: string;
  error?: string;
  errorStatusCode?: number;
  sendStartedAt?: string;
  sendUncertain?: number;
  email?: string;
  telegram?: string;
};
// Optional template targeting: '' applies to any engagement mode.
export type TemplateEngagementMode =
  | ""
  | "outreach"
  | "free_listing"
  | "paid_placement";
export type OutreachTemplate = {
  id: string;
  name: string;
  channel: "email" | "telegram" | "linkedin";
  engagementMode: TemplateEngagementMode;
  locale: "ru" | "en";
  subject: string;
  body: string;
  archived: number;
  createdAt: string;
  updatedAt: string;
  // Raw counts computed from outbound_messages on the server.
  sentCount: number;
  replyCount: number;
};
export type IntegrationData = {
  integrations?: Record<
    string,
    {
      status?: string;
      accountLabel?: string;
    }
  >;
  configuration?: Record<string, boolean>;
};
export type SessionUser = {
  id?: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
};
export type WorkspaceMember = {
  userId: string;
  role: string;
  name: string;
  email: string;
  avatarUrl: string;
  createdAt: string;
};
export type WorkspaceInvite = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
};
export type TeamData = {
  members?: WorkspaceMember[];
  invites?: WorkspaceInvite[];
  plan?: string;
  limit?: number;
  role?: string;
};
export type LeadComment = {
  id: string;
  leadId: string;
  userId: string;
  userName: string;
  userAvatarUrl?: string;
  body: string;
  createdAt: string;
};
export type BillingData = {
  configured?: boolean;
  plan?: string;
  active?: boolean;
  usage?: {
    limits?: {
      products?: number;
      channelsPerMonth?: number;
      /** Contact checks are metered apart: they cost several times a channel. */
      contactChecksPerMonth?: number;
      aiMessagesPerMonth?: number;
    };
    used?: {
      products?: number;
      channelsThisMonth?: number;
      contactChecksThisMonth?: number;
      aiMessagesThisMonth?: number;
    };
  };
  subscription?: {
    status?: string;
    variantName?: string;
    renewsAt?: string | null;
    endsAt?: string | null;
    cardBrand?: string;
    cardLastFour?: string;
    portalUrl?: string;
    updatePaymentUrl?: string;
    testMode?: boolean;
  } | null;
};
export type AgentData = {
  schedule?: {
    enabled?: boolean;
    cadence?: "daily" | "weekly";
    maxResults?: number;
    sources?: string[];
    nextRunAt?: string | null;
    lastRunAt?: string | null;
    lastRun?: {
      status?: string;
      productsProcessed?: number;
      opportunitiesFound?: number;
      error?: string;
      startedAt?: string;
      finishedAt?: string;
    } | null;
  } | null;
  plan?: string;
  canSchedule?: boolean;
  canRunDaily?: boolean;
};
export type DigestData = {
  settings?: {
    enabled?: boolean;
    cadence?: "daily" | "weekly";
    locale?: "ru" | "en";
    lastSentAt?: string | null;
  } | null;
};
// The monthly performance report, as GET /api/reports/monthly returns it.
// Mirrors the output of buildMonthlyReport (app/lib/monthly-report.mjs).
export type ReportMetric =
  | "found"
  | "contacted"
  | "replied"
  | "meetings"
  | "customers"
  | "revenueCents"
  | "placementsPublished";
export type ReportTotals = Record<ReportMetric, number> & {
  messagesSent: number;
  channelsChecked: number;
};
export type ReportChange = {
  current: number;
  previous: number;
  delta: number;
  /** null when the previous period was empty — "new", never a division by 0. */
  ratio: number | null;
  direction: "up" | "down" | "flat" | "new";
};
export type ReportChannelType = {
  channelType: string;
  found: number;
  contacted: number;
  replied: number;
  meetings: number;
  customers: number;
  revenueCents: number;
};
export type ReportHighlight = {
  kind: "best_channel_type" | "biggest_change" | "regression" | "quiet_month";
  metric?: ReportMetric;
  channelType?: string;
};
export type ReportPeriod = { label: string; start: string; end: string };
export type MonthlyReport = {
  generatedAt: string;
  period: ReportPeriod;
  previousPeriod: ReportPeriod | null;
  totals: ReportTotals;
  previousTotals: ReportTotals | null;
  changes: Record<ReportMetric, ReportChange> | null;
  channelTypes: ReportChannelType[];
  revenuePerCustomerCents: number | null;
  highlights: ReportHighlight[];
  hasActivity: boolean;
};

export type SequenceStep = {
  id?: number | null;
  subject: string;
  body: string;
  delayDays: number;
};
export type OutreachSequence = {
  id: string;
  productId: string;
  leadId: string;
  name: string;
  recipientEmail: string;
  company: string;
  steps: SequenceStep[];
  status: "draft" | "active" | "paused" | "completed" | "stopped_reply" | "cancelled";
  nextStep: number;
  nextRunAt?: string | null;
  lastSentAt?: string | null;
  stoppedReason?: string;
  sendStartedAt?: string | null;
  sendUncertain?: number;
  sendInProgress?: number;
};

/**
 * Task types prepared by /api/lifecycle/run (time-based) and by
 * /api/channels/watch (channel monitoring — the last three).
 */
export type LeadTaskType =
  | "follow_up"
  | "revive"
  | "placement_check"
  | "placement_verify"
  | "advance_deal"
  | "listing_missing"
  | "terms_changed"
  | "channel_unreachable";
export type LeadTask = {
  id: string;
  type: LeadTaskType;
  dueAt: string;
  createdAt: string;
  productId: string;
  productName: string;
  payload: {
    /** Timestamp the task's age is measured from ("подано 9 дней назад"). */
    sinceAt?: string;
    lastSequenceId?: string;
    lastSequenceName?: string;
    lastTemplateId?: string;
    lastStepNumber?: number;
    lastOutcomeNote?: string;
    stage?: string;
    placementUrl?: string;
    /** Monitoring: the page that was checked, opened by the task's action. */
    watchUrl?: string;
    /** Monitoring: HTTP status of the check that raised the task. */
    statusCode?: number;
    /** Monitoring: consecutive failed checks behind channel_unreachable. */
    failures?: number;
    /** Monitoring: the price/terms excerpt before and after the change. */
    previousTerms?: string;
    currentTerms?: string;
  };
  /** The whole lead, so a task can be acted on from any page of any product. */
  lead: Lead;
};

/**
 * The placeholder a workspace shows before its first product exists.
 *
 * The id is deliberately empty rather than generated: this object is built
 * during render, and anything random at render time differs between the server
 * pass and the browser pass, which is exactly the hydration mismatch the
 * sidebar links used to report. Nothing needs the value — the create endpoint
 * mints an id when the payload has none.
 */
export const blankProduct = (): Product => ({
  id: "",
  name: "",
  website: "",
  description: "",
  category: "",
  audience: "",
  negativeAudience: "",
  geography: "Global",
  languages: "English, Русский",
  goal: "paid_customers",
  monetizationModel: "",
  paidOffer: "",
  priceRange: "",
  paymentPoint: "",
  conversionEvent: "",
  attributionMethod: "",
  partnerTerms: "",
  analysis: {},
});



export const leadsPerPage = 10;

// Product fields that /api/products/prefill can draft from a website. The
// merge never overwrites values the user already typed into the form.
export const prefillFieldKeys = [
  "name",
  "description",
  "category",
  "audience",
  "negativeAudience",
  "geography",
  "languages",
  "monetizationModel",
  "paidOffer",
  "priceRange",
  "paymentPoint",
  "conversionEvent",
  "attributionMethod",
  "partnerTerms",
] as const;

export type PrefillFields = Partial<
  Record<(typeof prefillFieldKeys)[number], string>
>;

export function mergePrefillFields(
  product: Product,
  fields: PrefillFields,
): Product {
  const next = { ...product };
  for (const key of prefillFieldKeys) {
    const value = String(fields[key] || "").trim();
    if (value && !String(next[key] || "").trim()) next[key] = value;
  }
  return next;
}

export type BusyState =
  | ""
  | "analyze"
  | "prefill"
  | "discover"
  | "competitorGap"
  | "outreach"
  | "enrich"
  | "integration"
  | "sequence"
  | "billing"
  | "agent"
  | "digest"
  | "replies"
  | "template"
  | "team"
  | "comment"
  | "monitoring"
  | "pipeline"
  | "tasks";

/** The "prepare everything for me" run, as the dashboard polls it. */
export type PipelineStep = "analyze" | "discover" | "expand" | "enrich" | "drafts" | "done";
export type PipelineStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "paused";
export type PipelineCounts = {
  channelsFound: number;
  contactsFound: number;
  templatesCreated: number;
  sequencesCreated: number;
  messagesCreated: number;
  contactsChecked: number;
  contactsDiscovered: number;
  contactsVerified: number;
  contactQueries: number;
};
export type PipelineRun = {
  /** "discovery" is the Find-channels run; "full" is «Подготовить всё». */
  scope?: "full" | "discovery";
  id: string;
  productId: string;
  status: PipelineStatus;
  step: PipelineStep;
  counts: PipelineCounts;
  error: string;
  errorCode: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};
