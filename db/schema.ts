import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  website: text("website").notNull(),
  target: text("target").notNull(),
  negative: text("negative").notNull(),
  sources: text("sources").notNull(),
  leads: text("leads").notNull(),
  leadCount: integer("lead_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  workspaceId: text("workspace_id")
    .notNull()
    .default("workspace-owner")
    .references(() => workspaces.id, { onDelete: "cascade" }),
});

export const outboundMessages = sqliteTable(
  "outbound_messages",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().default(""),
    leadId: text("lead_id")
    .notNull()
    .references(() => prospects.id, { onDelete: "cascade" }),
    company: text("company").notNull(),
    channel: text("channel").notNull(),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull(),
    status: text("status").notNull().default("queued"),
    // '' means no template, matching the product_id convention (no FK).
    templateId: text("template_id").notNull().default(""),
    sentAt: text("sent_at"),
    gmailThreadId: text("gmail_thread_id").notNull().default(""),
    repliedAt: text("replied_at"),
    error: text("error"),
    // Safe provider diagnostic: HTTP status only, never Google's response body.
    errorStatusCode: integer("error_status_code").notNull().default(0),
    // Atomic one-off send claim and ambiguous-delivery recovery state.
    sendStartedAt: text("send_started_at"),
    sendUncertain: integer("send_uncertain", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
    workspaceId: text("workspace_id")
    .notNull()
    .default("workspace-owner")
    .references(() => workspaces.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("messages_workspace_idx").on(table.workspaceId, table.productId),
  ],
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    website: text("website").notNull().default(""),
    description: text("description").notNull().default(""),
    category: text("category").notNull().default(""),
    audience: text("audience").notNull().default(""),
    negativeAudience: text("negative_audience").notNull().default(""),
    geography: text("geography").notNull().default(""),
    languages: text("languages").notNull().default(""),
    goal: text("goal").notNull().default("paid_customers"),
    monetizationModel: text("monetization_model").notNull().default(""),
    paidOffer: text("paid_offer").notNull().default(""),
    priceRange: text("price_range").notNull().default(""),
    paymentPoint: text("payment_point").notNull().default(""),
    conversionEvent: text("conversion_event").notNull().default(""),
    attributionMethod: text("attribution_method").notNull().default(""),
    partnerTerms: text("partner_terms").notNull().default(""),
    analysis: text("analysis").notNull().default("{}"),
    // Per-product niche monitoring: when enabled the background agent keeps
    // discovering channels for this product on every workspace run.
    monitoringEnabled: integer("monitoring_enabled").notNull().default(0),
    // '' means "inherit the workspace agent sources"; otherwise a JSON array
    // of source keys like the agent_schedules.sources column.
    monitoringSources: text("monitoring_sources").notNull().default(""),
    // When the user last viewed this product's leads; drives "new since your
    // last visit" counters. NULL until the first visit is recorded.
    monitoringLastSeenAt: text("monitoring_last_seen_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    workspaceId: text("workspace_id")
    .notNull()
    .default("workspace-owner")
    .references(() => workspaces.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("products_workspace_idx").on(table.workspaceId, table.updatedAt),
  ],
);

export const prospects = sqliteTable("prospects", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  company: text("company").notNull(),
  domain: text("domain").notNull(),
  url: text("url").notNull(),
  description: text("description").notNull().default(""),
  source: text("source").notNull().default(""),
  channelType: text("channel_type").notNull().default(""),
  reason: text("reason").notNull().default(""),
  contact: text("contact").notNull().default(""),
  email: text("email").notNull().default(""),
  telegram: text("telegram").notNull().default(""),
  // Contact enrichment (originally hand-written migration 0011; restored in
  // 0024 after the FK rebuild dropped them because they were missing here).
  contactRole: text("contact_role").notNull().default(""),
  linkedin: text("linkedin").notNull().default(""),
  contactStatus: text("contact_status").notNull().default("not_checked"),
  contactSourceUrl: text("contact_source_url").notNull().default(""),
  contactEvidence: text("contact_evidence").notNull().default(""),
  contactConfidence: integer("contact_confidence").notNull().default(0),
  contactCheckedAt: text("contact_checked_at"),
  score: integer("score").notNull().default(0),
  status: text("status").notNull().default("review"),
  stage: text("stage").notNull().default("discovered"),
  contactedAt: text("contacted_at"),
  repliedAt: text("replied_at"),
  meetingAt: text("meeting_at"),
  convertedAt: text("converted_at"),
  revenueCents: integer("revenue_cents").notNull().default(0),
  outcomeNote: text("outcome_note").notNull().default(""),
  opportunityType: text("opportunity_type").notNull().default("partner"),
  actionType: text("action_type").notNull().default("propose_partnership"),
  nextAction: text("next_action").notNull().default(""),
  actionUrl: text("action_url").notNull().default(""),
  engagementMode: text("engagement_mode").notNull().default("unknown"),
  commercialModel: text("commercial_model").notNull().default("unknown"),
  pricingSummary: text("pricing_summary").notNull().default(""),
  placementRequirements: text("placement_requirements").notNull().default(""),
  usageTerms: text("usage_terms").notNull().default(""),
  registrationUrl: text("registration_url").notNull().default(""),
  // Self-serve placement tracking: '' (not applicable / not started),
  // 'to_submit', 'submitted', 'published', 'rejected'.
  placementStatus: text("placement_status").notNull().default(""),
  placementSubmittedAt: text("placement_submitted_at"),
  placementCheckedAt: text("placement_checked_at"),
  placementUrl: text("placement_url").notNull().default(""),
  utmLink: text("utm_link").notNull().default(""),
  // What the channel's own page says it is, read from the site during
  // discovery. Shown on the card so a mismatch is visible without opening it.
  siteTitle: text("site_title").notNull().default(""),
  siteDescription: text("site_description").notNull().default(""),
  // 'ok' | 'doubtful' | 'unknown'. A doubtful channel is grouped off, never
  // deleted: the site is real, its audience is the thing in question.
  relevance: text("relevance").notNull().default("unknown"),
  relevanceReason: text("relevance_reason").notNull().default(""),
  outreachEligible: integer("outreach_eligible", { mode: "boolean" })
    .notNull()
    .default(false),
  origin: text("origin").notNull().default("discovered"),
  // A channel is one repeatable acquisition route (directory, publication,
  // community, paid placement). A contact is one concrete outreach recipient
  // found while expanding those routes. Keeping both in this table preserves
  // the existing message/sequence foreign keys while letting the UI and quota
  // count the two layers separately.
  recordKind: text("record_kind").notNull().default("channel"),
  // Optional strategic channel that led to this contact. Empty when the
  // contact came from the product-wide direct-sales expansion.
  parentChannelId: text("parent_channel_id").notNull().default(""),
  // '' means unassigned, matching the product_id convention (no FK).
  assignedUserId: text("assigned_user_id").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  workspaceId: text("workspace_id")
    .notNull()
    .default("workspace-owner")
    .references(() => workspaces.id, { onDelete: "cascade" }),
}, (table) => [
  index("prospects_workspace_idx").on(table.workspaceId, table.productId),
  index("prospects_workspace_kind_idx").on(
    table.workspaceId,
    table.productId,
    table.recordKind,
  ),
  index("prospects_workspace_created_idx").on(
    table.workspaceId,
    table.createdAt,
  ),
]);

export const integrations = sqliteTable("integrations", {
  provider: text("provider").primaryKey(),
  status: text("status").notNull().default("disconnected"),
  accountLabel: text("account_label").notNull().default(""),
  accessToken: text("access_token").notNull().default(""),
  refreshToken: text("refresh_token").notNull().default(""),
  expiresAt: text("expires_at"),
  metadata: text("metadata").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
});

export const aiUsage = sqliteTable("ai_usage", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull().default(""),
  operation: text("operation").notNull(),
  provider: text("provider").notNull().default("openrouter"),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  webSearchRequests: integer("web_search_requests").notNull().default(0),
  costMicrousd: integer("cost_microusd").notNull().default(0),
  // "ok" | "error" | "retry" — failed and discarded calls are billed too and
  // must stay visible in spend reports.
  outcome: text("outcome").notNull().default("ok"),
  // HTTP status returned by the provider, 0 when unknown.
  statusCode: integer("status_code").notNull().default(0),
  createdAt: text("created_at").notNull(),
  workspaceId: text("workspace_id")
    .notNull()
    .default("workspace-owner")
    .references(() => workspaces.id, { onDelete: "cascade" }),
}, (table) => [
  index("ai_usage_workspace_created_idx").on(
    table.workspaceId,
    table.createdAt,
  ),
]);

// Anonymous acquisition preview. The browser receives only the first five
// rows; the complete result stays server-side until the same browser creates
// an account and the dashboard claims it through the HttpOnly token cookie.
// ip_hash is deliberately irreversible and short-lived — raw addresses are
// never stored.
export const publicPreviews = sqliteTable(
  "public_previews",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    ipHash: text("ip_hash").notNull(),
    inputHash: text("input_hash").notNull(),
    website: text("website").notNull(),
    locale: text("locale").notNull().default("en"),
    inputJson: text("input_json").notNull().default("{}"),
    analysisJson: text("analysis_json").notNull().default("{}"),
    resultsJson: text("results_json").notNull().default("[]"),
    resultCount: integer("result_count").notNull().default(0),
    status: text("status").notNull().default("running"),
    errorCode: text("error_code").notNull().default(""),
    model: text("model").notNull().default(""),
    costMicrousd: integer("cost_microusd").notNull().default(0),
    workspaceId: text("workspace_id").notNull().default(""),
    productId: text("product_id").notNull().default(""),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
    claimedAt: text("claimed_at"),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("public_previews_ip_created_idx").on(table.ipHash, table.createdAt),
    index("public_previews_expires_idx").on(table.expiresAt),
  ],
);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().default(""),
  name: text("name").notNull().default(""),
  avatarUrl: text("avatar_url").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("users_email_idx")
    .on(table.email)
    .where(sql`${table.email} <> ''`),
]);

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

export const workspaceInvites = sqliteTable("workspace_invites", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  acceptedAt: text("accepted_at"),
  createdAt: text("created_at").notNull(),
});

export const leadComments = sqliteTable(
  "lead_comments",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
    leadId: text("lead_id")
    .notNull()
    .references(() => prospects.id, { onDelete: "cascade" }),
    userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("lead_comments_lead_idx").on(table.leadId, table.createdAt),
  ],
);

export const oauthAccounts = sqliteTable(
  "oauth_accounts",
  {
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
  ],
);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [
  index("sessions_user_idx").on(table.userId, table.expiresAt),
]);

export const oauthStates = sqliteTable("oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  provider: text("provider").notNull(),
  verifier: text("verifier").notNull().default(""),
  nonce: text("nonce").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const loginLinks = sqliteTable(
  "login_links",
  {
    tokenHash: text("token_hash").primaryKey(),
    email: text("email").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("login_links_email_idx").on(table.email, table.createdAt)],
);

export const authAttempts = sqliteTable("auth_attempts", {
  identityHash: text("identity_hash").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStartedAt: text("window_started_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const workspaceIntegrations = sqliteTable(
  "workspace_integrations",
  {
    workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("disconnected"),
    accountLabel: text("account_label").notNull().default(""),
    accessToken: text("access_token").notNull().default(""),
    refreshToken: text("refresh_token").notNull().default(""),
    expiresAt: text("expires_at"),
    metadata: text("metadata").notNull().default("{}"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.provider] })],
);

export const contactRequests = sqliteTable("contact_requests", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company").notNull().default(""),
  topic: text("topic").notNull().default("general"),
  message: text("message").notNull(),
  status: text("status").notNull().default("new"),
  createdAt: text("created_at").notNull(),
});

export const subscriptions = sqliteTable("subscriptions", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("lemon_squeezy"),
  customerId: text("customer_id").notNull().default(""),
  subscriptionId: text("subscription_id").notNull().default(""),
  orderId: text("order_id").notNull().default(""),
  productId: text("product_id").notNull().default(""),
  variantId: text("variant_id").notNull().default(""),
  variantName: text("variant_name").notNull().default(""),
  status: text("status").notNull().default("inactive"),
  plan: text("plan").notNull().default("pro"),
  renewsAt: text("renews_at"),
  endsAt: text("ends_at"),
  trialEndsAt: text("trial_ends_at"),
  cardBrand: text("card_brand").notNull().default(""),
  cardLastFour: text("card_last_four").notNull().default(""),
  portalUrl: text("portal_url").notNull().default(""),
  updatePaymentUrl: text("update_payment_url").notNull().default(""),
  testMode: integer("test_mode", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const agentSchedules = sqliteTable("agent_schedules", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  enabled: integer("enabled").notNull().default(0),
  cadence: text("cadence").notNull().default("weekly"),
  maxResults: integer("max_results").notNull().default(12),
  sources: text("sources")
    .notNull()
    .default('["web","reviews","creators","communities"]'),
  nextRunAt: text("next_run_at"),
  lastRunAt: text("last_run_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("agent_schedules_due_idx").on(table.enabled, table.nextRunAt),
]);

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"),
  productsProcessed: integer("products_processed").notNull().default(0),
  opportunitiesFound: integer("opportunities_found").notNull().default(0),
  error: text("error").notNull().default(""),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
}, (table) => [
  index("agent_runs_workspace_started_idx").on(
    table.workspaceId,
    table.startedAt,
  ),
]);

export const outreachSequences = sqliteTable("outreach_sequences", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  productId: text("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  leadId: text("lead_id")
    .notNull()
    .references(() => prospects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name").notNull().default(""),
  company: text("company").notNull().default(""),
  steps: text("steps").notNull().default("[]"),
  status: text("status").notNull().default("draft"),
  nextStep: integer("next_step").notNull().default(0),
  nextRunAt: text("next_run_at"),
  dailyLimit: integer("daily_limit").notNull().default(20),
  lastSentAt: text("last_sent_at"),
  stoppedReason: text("stopped_reason").notNull().default(""),
  repliedAt: text("replied_at"),
  // Atomic worker claim and Gmail delivery-reconciliation state for one step.
  sendStartedAt: text("send_started_at"),
  sendUncertain: integer("send_uncertain", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("outreach_sequences_due_idx").on(table.status, table.nextRunAt),
  index("outreach_sequences_workspace_idx").on(
    table.workspaceId,
    table.updatedAt,
  ),
]);

export const outreachEvents = sqliteTable("outreach_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  sequenceId: text("sequence_id").notNull(),
  leadId: text("lead_id")
    .notNull()
    .references(() => prospects.id, { onDelete: "cascade" }),
  stepNumber: integer("step_number").notNull().default(0),
  eventType: text("event_type").notNull(),
  gmailMessageId: text("gmail_message_id").notNull().default(""),
  gmailThreadId: text("gmail_thread_id").notNull().default(""),
  error: text("error").notNull().default(""),
  metadata: text("metadata").notNull().default("{}"),
  occurredAt: text("occurred_at").notNull(),
}, (table) => [
  index("outreach_events_sequence_idx").on(
    table.sequenceId,
    table.occurredAt,
  ),
  index("outreach_events_workspace_type_idx").on(
    table.workspaceId,
    table.eventType,
    table.occurredAt,
  ),
]);

export const suppressionList = sqliteTable(
  "suppression_list",
  {
    workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    reason: text("reason").notNull().default("manual"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.email] })],
);

export const digestSettings = sqliteTable("digest_settings", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  enabled: integer("enabled").notNull().default(0),
  cadence: text("cadence").notNull().default("weekly"),
  locale: text("locale").notNull().default("ru"),
  lastSentAt: text("last_sent_at"),
  // When the monthly performance report was last e-mailed. The cron sends one
  // per calendar month, so this timestamp is the whole de-duplication key.
  lastReportSentAt: text("last_report_sent_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const outreachTemplates = sqliteTable(
  "outreach_templates",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    channel: text("channel").notNull().default("email"),
    // Optional targeting: '', 'outreach', 'free_listing', 'paid_placement'.
    engagementMode: text("engagement_mode").notNull().default(""),
    locale: text("locale").notNull().default("ru"),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull(),
    archived: integer("archived").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("outreach_templates_workspace_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
  ],
);

// The lead lifecycle queue: what the service decided should happen next with
// a lead. Tasks are prepared by the lifecycle cron and always executed by the
// user — nothing here can send anything on its own.
export const leadTasks = sqliteTable(
  "lead_tasks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    // '' for product-level tasks that are not tied to a single lead.
    leadId: text("lead_id").notNull().default(""),
    // 'follow_up' | 'revive' | 'placement_check' | 'placement_verify' |
    // 'advance_deal'.
    type: text("type").notNull(),
    dueAt: text("due_at").notNull(),
    payload: text("payload").notNull().default("{}"),
    // 'open' | 'done' | 'dismissed' | 'snoozed'.
    status: text("status").notNull().default("open"),
    snoozedUntil: text("snoozed_until"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("lead_tasks_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.dueAt,
    ),
    index("lead_tasks_lead_type_idx").on(table.leadId, table.type),
  ],
);

// Channel monitoring: one row per HTTP check of a channel we already work
// with. The table is append-only and deliberately cheap — a status code, a
// hash of the normalised page text and two string checks are enough to answer
// "is the listing still there" and "did the terms change" without a model.
export const channelSnapshots = sqliteTable(
  "channel_snapshots",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // No FK: snapshots outlive a deleted lead only until the next cleanup and
    // must never block a prospects rebuild (the same convention as product_id).
    leadId: text("lead_id").notNull(),
    url: text("url").notNull(),
    // 0 means the fetch itself failed (DNS, TLS, blocked by safePublicUrl).
    statusCode: integer("status_code").notNull().default(0),
    contentHash: text("content_hash").notNull().default(""),
    title: text("title").notNull().default(""),
    mentionsProduct: integer("mentions_product").notNull().default(0),
    priceExcerpt: text("price_excerpt").notNull().default(""),
    checkedAt: text("checked_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("channel_snapshots_lead_idx").on(table.leadId, table.checkedAt),
  ],
);

// "Prepare everything for me": one row per pipeline run. The run is advanced
// in bounded slices by the pipeline cron, so a long analysis → discovery →
// enrichment → drafting job never lives inside a single HTTP request.
//
// The pipeline only ever PREPARES work: messages it creates stay 'queued' and
// sequences stay 'draft'. Nothing here can send anything.
export const pipelineRuns = sqliteTable(
  "pipeline_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // No FK: the product_id convention elsewhere in this schema (a deleted
    // product must never block a prospects/products rebuild).
    productId: text("product_id").notNull(),
    // 'queued' | 'running' | 'done' | 'failed' | 'paused'.
    status: text("status").notNull().default("queued"),
    // 'analyze' | 'discover' | 'enrich' | 'drafts' | 'done'.
    step: text("step").notNull().default("analyze"),
    // Retries used by the CURRENT step; reset whenever the step advances.
    attempts: integer("attempts").notNull().default(0),
    // JSON: channelsFound, contactsFound, templatesCreated, sequencesCreated,
    // messagesCreated.
    counts: text("counts").notNull().default("{}"),
    error: text("error").notNull().default(""),
    errorCode: text("error_code").notNull().default(""),
    startedAt: text("started_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (table) => [
    index("pipeline_runs_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
  ],
);

export const billingWebhookEvents = sqliteTable("billing_webhook_events", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
});

// One row per public page view, so the gap between "an ad was clicked" and
// "someone signed up" stops being invisible.
//
// There is no workspace here and no user: these rows are written before anyone
// has an account, and they hold nothing that identifies a person — no address,
// no user agent, no full URL. A referrer keeps its host and loses its path.
export const siteVisits = sqliteTable(
  "site_visits",
  {
    id: text("id").primaryKey(),
    // '/' or '/login'. The pair is the funnel: landed, then went to sign in.
    path: text("path").notNull(),
    source: text("source").notNull().default(""),
    medium: text("medium").notNull().default(""),
    campaign: text("campaign").notNull().default(""),
    content: text("content").notNull().default(""),
    referrerHost: text("referrer_host").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("site_visits_created_idx").on(table.createdAt),
    index("site_visits_source_idx").on(table.source, table.createdAt),
  ],
);

// What happened on a public page, with no idea who did it.
//
// visit_id is made in the browser per page load and never stored there: it
// groups the events of one visit and dies with the tab. Nothing here survives
// long enough to follow a person between visits, which is the whole point —
// these numbers exist to tell an accidental tap from a considered rejection.
export const siteEvents = sqliteTable(
  "site_events",
  {
    id: text("id").primaryKey(),
    visitId: text("visit_id").notNull(),
    path: text("path").notNull(),
    source: text("source").notNull().default(""),
    campaign: text("campaign").notNull().default(""),
    // 'click' | 'scroll' | 'dwell'.
    kind: text("kind").notNull(),
    // For a click, what was clicked; for scroll and dwell, the bucket.
    label: text("label").notNull().default(""),
    // Percent for scroll, seconds for dwell, 1 for a click.
    value: integer("value").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("site_events_created_idx").on(table.createdAt),
    index("site_events_kind_idx").on(table.kind, table.createdAt),
  ],
);
