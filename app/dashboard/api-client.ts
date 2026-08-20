import type { PlanId } from "../lib/plans";
import type { ChannelStats } from "../lib/channel-stats";
import type {
  AgentData,
  DigestData,
  IntegrationData,
  Lead,
  LeadComment,
  LeadTask,
  LeadModeCounts,
  LeadModeFilter,
  Message,
  MonthlyReport,
  OutreachSequence,
  OutreachTemplate,
  PipelineRun,
  TemplateEngagementMode,
  PlacementCounts,
  PlacementStatus,
  PrefillFields,
  Product,
  ProductAnalysis,
  SequenceStep,
  TeamData,
  WorkspaceInvite,
} from "./types";
import type { Locale } from "./i18n";

export type ApiResult<T> = { ok: boolean; result: T };

async function requestJson<T>(
  url: string,
  method: "POST" | "PATCH" | "PUT",
  payload: unknown,
): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = (await response.json()) as T;
  return { ok: response.ok, result };
}

export function loadOrNull<T>(url: string): Promise<T | null> {
  return fetch(url)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
}

export function fetchProspects(
  productId: string,
  options: {
    signal?: AbortSignal;
    limit?: number;
    offset?: number;
    mode?: Exclude<LeadModeFilter, "all" | "network_route" | "doubtful">;
    /** The contact-route grouping chip; mutually exclusive with `mode`. */
    route?: "network";
    /** The grouped-off channels whose own page disagrees with the product. */
    relevance?: "doubtful";
    assigned?: "me";
    kind?: "channel" | "contact";
  } = {},
): Promise<{
  prospects?: Lead[];
  total?: number;
  counts?: LeadModeCounts;
  placementCounts?: PlacementCounts;
  outcomeLeads?: Lead[];
  newCount?: number;
}> {
  const params = new URLSearchParams({ productId });
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
    params.set("offset", String(options.offset || 0));
  }
  if (options.mode) params.set("mode", options.mode);
  if (options.route) params.set("route", options.route);
  if (options.relevance) params.set("relevance", options.relevance);
  if (options.assigned) params.set("assigned", options.assigned);
  if (options.kind) params.set("kind", options.kind);
  return fetch(`/api/prospects?${params}`, { signal: options.signal }).then(
    (response) => response.json(),
  );
}

// The lifecycle queue: what the service decided to do next with each lead.
export function fetchTasks(
  productId = "",
): Promise<{ tasks?: LeadTask[] }> {
  const query = productId
    ? `?productId=${encodeURIComponent(productId)}`
    : "";
  return fetch(`/api/tasks${query}`).then((response) => response.json());
}

export function updateTaskApi(payload: {
  id: string;
  action: "done" | "dismiss" | "snooze";
  days?: number;
}) {
  return requestJson<{ error?: string }>("/api/tasks", "PATCH", payload);
}

// "Refresh my tasks": re-runs the rule engine for the session workspace only.
// It prepares and closes tasks — it never sends anything.
export function runLifecycleApi() {
  return requestJson<{
    results?: Array<{ created?: number; closed?: number }>;
    error?: string;
  }>("/api/lifecycle/run", "POST", { mode: "manual" });
}

// The "prepare everything for me" pipeline. `start` only registers the run;
// `advance` moves it one slice forward from the browser so the user sees
// progress without waiting for the two-minute cron. Nothing here sends
// anything — the run only prepares queued messages and draft sequences.
export function fetchPipelineRun(
  productId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ run?: PipelineRun | null }> {
  return fetch(`/api/pipeline?productId=${encodeURIComponent(productId)}`, {
    signal: options.signal,
  }).then((response) => (response.ok ? response.json() : { run: null }));
}

export function startPipelineApi(
  productId: string,
  scope: "full" | "discovery" = "full",
) {
  return requestJson<{ run?: PipelineRun; error?: string }>(
    "/api/pipeline/start",
    "POST",
    { productId, scope },
  );
}

export function advancePipelineApi(
  productId: string,
  action: "advance" | "resume" = "advance",
) {
  return requestJson<{ run?: PipelineRun; error?: string }>(
    "/api/pipeline/run",
    "POST",
    { productId, action },
  );
}

export function fetchChannelAnalytics(
  productId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ChannelStats | null> {
  return fetch(
    `/api/analytics/channels?productId=${encodeURIComponent(productId)}`,
    { signal: options.signal },
  ).then((response) => (response.ok ? response.json() : null));
}

// The monthly performance report for one complete month. Read-only.
export function fetchMonthlyReport(
  period: string,
  productId: string,
  options: { signal?: AbortSignal } = {},
): Promise<MonthlyReport | null> {
  const params = new URLSearchParams({ period });
  if (productId) params.set("productId", productId);
  return fetch(`/api/reports/monthly?${params}`, {
    signal: options.signal,
  }).then((response) => (response.ok ? response.json() : null));
}

export function saveProspectsApi(productId: string, prospects: Lead[]) {
  return fetch("/api/prospects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId, prospects }),
  });
}

export async function updateProspectApi(payload: {
  id: string;
  status?: "approved" | "rejected";
  stage?: Lead["stage"];
  revenueCents?: number;
  outcomeNote?: string;
  placementStatus?: PlacementStatus;
  placementUrl?: string;
  utmLink?: string;
  assignedUserId?: string;
}): Promise<boolean> {
  const response = await fetch("/api/prospects", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.ok;
}

export async function saveProductApi(
  product: Product,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const response = await fetch("/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(product),
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    id?: string;
  };
  // The id matters on the way back, not just on the way out. A product saved
  // without one is given a fresh uuid by the server, and this function used to
  // throw that answer away: the browser kept an id of "", every later call sent
  // it, and analyse / discover / competitor-gap all answered 400 until the page
  // was reloaded. Each save also wrote another row, because an empty id can
  // never match an existing one.
  if (response.ok) return { ok: true, id: result.id };
  return { ok: false, error: result.error };
}

// Niche monitoring settings live outside the full product upsert so they can
// be toggled without resending (and re-validating) the whole product form.
export function saveProductMonitoringApi(payload: {
  id: string;
  monitoringEnabled: boolean;
  monitoringSources: string[];
}) {
  return requestJson<{ error?: string }>("/api/products", "PATCH", payload);
}

// Record "the user viewed this product's leads": resets the newCount badge.
export async function markProductSeenApi(id: string): Promise<boolean> {
  const response = await fetch("/api/products", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, markSeen: true }),
  });
  return response.ok;
}

export function analyzeProductApi(payload: Product & { locale: Locale }) {
  return requestJson<{
    analysis?: ProductAnalysis;
    mode?: string;
    error?: string;
  }>("/api/analyze", "POST", payload);
}

export function prefillProductApi(url: string, locale: Locale) {
  return requestJson<{ fields?: PrefillFields; error?: string }>(
    "/api/products/prefill",
    "POST",
    { url, locale },
  );
}

export function discoverApi(
  product: Product,
  sources: string[],
  focusMotion: string | undefined,
  locale: Locale,
) {
  return requestJson<{
    results?: Array<
      Omit<Lead, "id" | "status" | "stage" | "revenueCents" | "outcomeNote">
    >;
    note?: string;
    error?: string;
  }>("/api/discover", "POST", {
    product,
    sources,
    locale,
    focusMotion: focusMotion || undefined,
  });
}

export function enrichContactApi(leadId: string) {
  return requestJson<{
    contact?: string;
    role?: string;
    email?: string;
    telegram?: string;
    linkedin?: string;
    contactStatus?: Lead["contactStatus"];
    contactSourceUrl?: string;
    contactEvidence?: string;
    /** Set when enrichment filled an empty next action with a network hint. */
    nextAction?: string;
    contactConfidence?: number;
    contactCheckedAt?: string;
    /** Set when the model answered but the answer could not be read. */
    modelError?: "unparsable_response" | "provider_error";
    error?: string;
  }>("/api/contacts/enrich", "POST", { leadId });
}

export function generateOutreachApi(payload: {
  product: Product;
  lead: Lead;
  channel: "email" | "telegram" | "linkedin";
  locale: Locale;
}) {
  return requestJson<{ subject?: string; body?: string; error?: string }>(
    "/api/outreach",
    "POST",
    payload,
  );
}

export function createMessageApi(message: Message) {
  return requestJson<{
    persisted?: boolean;
    id?: string;
    stage?: Lead["stage"];
    error?: string;
  }>("/api/messages", "POST", message);
}

export async function deleteMessageApi(id: string): Promise<boolean> {
  const response = await fetch(`/api/messages?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return response.ok;
}

export function sendEmailApi(payload: {
  messageId: string;
  provider: "gmail";
  to: string;
  subject: string;
  body: string;
}) {
  return requestJson<{
    error?: string;
    diagnostic?: string;
    statusCode?: number;
    sent?: boolean;
    reconciled?: boolean;
    alreadySent?: boolean;
  }>(
    "/api/send",
    "POST",
    payload,
  );
}

export function saveAgentScheduleApi(payload: {
  enabled: boolean;
  cadence: "daily" | "weekly";
  maxResults: number;
  sources: string[];
}) {
  return requestJson<AgentData & { error?: string }>(
    "/api/agent/schedule",
    "POST",
    payload,
  );
}

export function fetchAgentSchedule(): Promise<AgentData> {
  return fetch("/api/agent/schedule").then((item) => item.json());
}

export function runAgentApi() {
  return requestJson<{ opportunitiesFound?: number; error?: string }>(
    "/api/agent/run",
    "POST",
    { mode: "manual" },
  );
}

export function fetchDigestSettings(): Promise<DigestData> {
  return fetch("/api/digest/settings").then((item) => item.json());
}

export function saveDigestSettingsApi(payload: {
  enabled: boolean;
  cadence: "daily" | "weekly";
  locale: "ru" | "en";
}) {
  return requestJson<DigestData & { error?: string }>(
    "/api/digest/settings",
    "PATCH",
    payload,
  );
}

export function sendDigestNowApi() {
  return requestJson<{
    results?: Array<{ status?: string; error?: string }>;
    error?: string;
  }>("/api/digest/run", "POST", { mode: "manual" });
}

export function checkRepliesApi() {
  return requestJson<{
    results?: Array<{ checked?: number; replies?: number; errors?: number }>;
    error?: string;
  }>("/api/outreach-engine/replies", "POST", { mode: "manual" });
}

export function fetchOutreachSequences(): Promise<{
  sequences?: OutreachSequence[];
}> {
  return fetch("/api/outreach-sequences").then((item) => item.json());
}

export function createOutreachSequenceApi(payload: {
  productId: string;
  leadId: string;
  name: string;
  steps: SequenceStep[];
}) {
  return requestJson<{ id?: string; error?: string }>(
    "/api/outreach-sequences",
    "POST",
    payload,
  );
}

export function updateOutreachSequenceApi(
  id: string,
  action: "activate" | "pause" | "resume" | "cancel",
) {
  return requestJson<{ error?: string }>("/api/outreach-sequences", "PATCH", {
    id,
    action,
  });
}

// Archived templates are included so the management block can restore them;
// pickers filter them out on the client.
export function fetchTemplates(): Promise<{ templates?: OutreachTemplate[] }> {
  return fetch("/api/templates?archived=1").then((item) => item.json());
}

export function createTemplateApi(payload: {
  name: string;
  channel: "email" | "telegram" | "linkedin";
  engagementMode: TemplateEngagementMode;
  locale: Locale;
  subject: string;
  body: string;
}) {
  return requestJson<{ id?: string; error?: string }>(
    "/api/templates",
    "POST",
    payload,
  );
}

export function updateTemplateApi(
  payload: { id: string } & Partial<{
    name: string;
    channel: "email" | "telegram" | "linkedin";
    engagementMode: TemplateEngagementMode;
    locale: Locale;
    subject: string;
    body: string;
    archived: boolean;
  }>,
) {
  return requestJson<{ error?: string }>("/api/templates", "PATCH", payload);
}

export async function deleteTemplateApi(
  id: string,
): Promise<ApiResult<{ outcome?: "deleted" | "archived"; error?: string }>> {
  const response = await fetch(`/api/templates?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const result = await response.json();
  return { ok: response.ok, result };
}

export function saveIntegrationApi(
  payload: { provider: "gmail_config"; clientId: string; clientSecret: string },
) {
  return requestJson<{ error?: string }>("/api/integrations", "POST", payload);
}

export function fetchIntegrations(): Promise<IntegrationData> {
  return fetch("/api/integrations").then((item) => item.json());
}

export function fetchTeam(): Promise<TeamData> {
  return fetch("/api/workspace/members").then((item) => item.json());
}

export function inviteMemberApi(email: string) {
  return requestJson<{
    invite?: WorkspaceInvite;
    inviteUrl?: string;
    error?: string;
  }>("/api/workspace/members", "POST", { email });
}

export async function removeMemberApi(userId: string): Promise<boolean> {
  const response = await fetch(
    `/api/workspace/members?userId=${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
  return response.ok;
}

export async function revokeInviteApi(inviteId: string): Promise<boolean> {
  const response = await fetch(
    `/api/workspace/members?inviteId=${encodeURIComponent(inviteId)}`,
    { method: "DELETE" },
  );
  return response.ok;
}

export function fetchLeadComments(
  leadId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ comments?: LeadComment[] }> {
  return fetch(`/api/leads/comments?leadId=${encodeURIComponent(leadId)}`, {
    signal: options.signal,
  }).then((response) => response.json());
}

export function addLeadCommentApi(leadId: string, body: string) {
  return requestJson<{ comment?: LeadComment; error?: string }>(
    "/api/leads/comments",
    "POST",
    { leadId, body },
  );
}

export async function deleteLeadCommentApi(id: string): Promise<boolean> {
  const response = await fetch(
    `/api/leads/comments?id=${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  return response.ok;
}

export function deleteSessionApi() {
  return fetch("/api/auth/session", { method: "DELETE" });
}

export function startCheckoutApi(
  plan: PlanId,
  interval: "monthly" | "annual",
) {
  return requestJson<{ url?: string; error?: string }>("/api/billing", "POST", {
    plan,
    interval,
  });
}

/**
 * Records the workspace's content language.
 *
 * The switch used to write a cookie and nothing else, so the language a run
 * generated in was whatever the browser happened to hold — and a cron run,
 * having no browser, fell back to a language nobody had chosen. Returns how
 * many stored channels are still in the previous language, because switching
 * cannot rewrite what was already generated.
 */
export function setLocaleApi(locale: Locale) {
  return requestJson<{ locale: Locale; staleChannels: number }>(
    "/api/locale",
    "PUT",
    { locale },
  );
}

/**
 * Checks the product's channels for confirmed competitors.
 *
 * Started by a press and never on its own: it spends a search request per
 * channel per rival, which is more than the run that found the channels.
 */
export function runCompetitorGapApi(productId: string) {
  return requestJson<{
    gaps?: Array<{ domain: string; company: string; competitors: Array<{ name: string; url: string }> }>;
    checked?: number;
    requests?: number;
    present?: number;
    error?: string;
  }>("/api/competitor-gap", "POST", { productId });
}
