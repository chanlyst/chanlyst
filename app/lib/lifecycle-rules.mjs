// The lead lifecycle rule engine.
//
// This module is deliberately pure: no database, no network, no clock of its
// own. `planLeadTasks` receives a snapshot of a workspace and returns the set
// of tasks that SHOULD exist right now, so the whole decision layer of the
// product can be unit-tested offline.
//
// The engine never sends anything. It only prepares work items that the user
// executes with an explicit click, which is what the "nothing is sent without
// your confirmation" promise in the sidebar guarantees.
//
// Kept as an .mjs module so tests/lifecycle-rules.test.mjs can import it
// directly with `node --test` while TypeScript routes import it via allowJs.

import { isReachableByOutreach } from "./contact-route.mjs";

/**
 * @typedef {"follow_up" | "revive" | "placement_check" | "placement_verify" | "advance_deal"} LifecycleTaskType
 */

/**
 * @typedef {"listing_missing" | "terms_changed" | "channel_unreachable"} WatchTaskType
 */

/**
 * @typedef {LifecycleTaskType | WatchTaskType} LeadTaskType
 */

/**
 * @typedef {Object} LifecycleSettings
 * @property {number} [followUpDays] Days of silence after a finished sequence.
 * @property {number} [reviveDays] Days of silence before a re-approach.
 * @property {number} [placementCheckDays] Days after a submission before checking it.
 * @property {number} [placementVerifyDays] Days before re-verifying a live listing.
 * @property {number} [advanceDealDays] Days a reply may sit in the 'replied' stage.
 * @property {number} [maxFollowUps] Lifetime cap of follow-up tasks per lead.
 */

/** Defaults for every threshold the rules use. */
export const defaultLifecycleSettings = {
  followUpDays: 21,
  reviveDays: 90,
  placementCheckDays: 7,
  placementVerifyDays: 30,
  advanceDealDays: 7,
  maxFollowUps: 3,
};

/** Task types the time-based engine can create, in the order they are evaluated. */
export const lifecycleTaskTypes = [
  "follow_up",
  "revive",
  "placement_check",
  "placement_verify",
  "advance_deal",
];

/**
 * Task types produced by channel monitoring (/api/channels/watch). They live in
 * the same lead_tasks queue and obey the same idempotency and auto-close rules,
 * but their condition comes from a channel_snapshots comparison rather than
 * from the clock — so `planLeadTasks` must never create or close them.
 */
export const watchTaskTypes = [
  "listing_missing",
  "terms_changed",
  "channel_unreachable",
];

/** Every type that may appear in the lead_tasks table. */
export const leadTaskTypes = [...lifecycleTaskTypes, ...watchTaskTypes];

/** Fast membership test used to keep the two engines out of each other's way. */
const watchTypeSet = new Set(watchTaskTypes);

/** Statuses that block creating another task of the same type for a lead. */
const blockingStatuses = new Set(["open", "snoozed", "dismissed"]);

/** Statuses of a task that the engine may auto-close. */
const liveStatuses = new Set(["open", "snoozed"]);

const dayMs = 86_400_000;

/**
 * @param {unknown} value
 * @returns {number | null} epoch milliseconds, or null when unusable
 */
function time(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * True when `value` is a usable timestamp at least `days` days before `now`.
 * A missing timestamp never satisfies an age threshold.
 * @param {unknown} value
 * @param {number} nowMs
 * @param {number} days
 */
function olderThan(value, nowMs, days) {
  const parsed = time(value);
  if (parsed === null) return false;
  return nowMs - parsed >= days * dayMs;
}

/**
 * @param {LifecycleSettings | undefined} settings
 */
function withDefaults(settings) {
  const merged = { ...defaultLifecycleSettings };
  for (const key of Object.keys(defaultLifecycleSettings)) {
    const value = Number(settings?.[key]);
    if (Number.isFinite(value) && value >= 0) merged[key] = value;
  }
  return merged;
}

/**
 * Group a list by its `leadId` field.
 * @template {{ leadId?: string }} T
 * @param {T[]} items
 * @returns {Map<string, T[]>}
 */
function byLead(items) {
  /** @type {Map<string, any[]>} */
  const map = new Map();
  for (const item of items || []) {
    const key = String(item?.leadId || "");
    if (!key) continue;
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/**
 * The most recent outreach event for a lead, ignoring events without a usable
 * timestamp. 'failed' events are counted: a failed attempt is still a touch of
 * the lead's timeline and must not make the engine look "silent" forever.
 * @param {Array<{ occurredAt?: string, eventType?: string, sequenceId?: string, metadata?: string }>} events
 */
function lastEvent(events) {
  let best = null;
  let bestAt = -Infinity;
  for (const event of events || []) {
    const at = time(event?.occurredAt);
    if (at === null || at < bestAt) continue;
    best = event;
    bestAt = at;
  }
  return best;
}

/**
 * The last moment anybody touched this lead in either direction. Used by the
 * revive rule so a lead that was worked on recently by hand is never labelled
 * "cold" just because its sequence finished long ago.
 * @param {Record<string, any>} lead
 * @param {Array<{ occurredAt?: string }>} events
 * @param {Array<Record<string, any>>} tasks
 */
function lastTouchAt(lead, events, tasks) {
  const candidates = [
    lead?.contactedAt,
    lead?.repliedAt,
    lead?.meetingAt,
    lead?.convertedAt,
    lead?.placementSubmittedAt,
    lead?.placementCheckedAt,
    lastEvent(events)?.occurredAt,
    ...(tasks || []).map((task) => task?.completedAt),
  ];
  let best = null;
  for (const candidate of candidates) {
    const at = time(candidate);
    if (at !== null && (best === null || at > best)) best = at;
  }
  return best;
}

/**
 * Parse a JSON payload without throwing on malformed data.
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function parsePayload(value) {
  if (value && typeof value === "object") {
    return /** @type {Record<string, unknown>} */ (value);
  }
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Whether each rule's condition currently holds for a lead. This is the single
 * source of truth used both for creating tasks and for auto-closing them, so a
 * task can never outlive the situation that produced it.
 *
 * The lifetime cap and the "one open task per type" rule are deliberately NOT
 * part of these conditions: they gate creation only. Otherwise the third
 * follow-up task would close itself the moment it was created.
 *
 * @param {Object} input
 * @param {number} input.nowMs
 * @param {Record<string, any>} input.lead
 * @param {Array<Record<string, any>>} input.sequences
 * @param {Array<Record<string, any>>} input.events
 * @param {Array<Record<string, any>>} input.tasks
 * @param {ReturnType<typeof withDefaults>} input.thresholds
 */
function evaluateLead({ nowMs, lead, sequences, events, tasks, thresholds }) {
  const completedSequences = sequences.filter(
    (sequence) => String(sequence?.status || "") === "completed",
  );
  const last = lastEvent(events);
  const replied = Boolean(lead?.repliedAt);
  const stage = String(lead?.stage || "");
  const placementStatus = String(lead?.placementStatus || "");

  // Both re-approach rules assume there is somebody to write to. A lead whose
  // route is `network` (the way in is registering in an affiliate network) or
  // `none` (checked, no contact anywhere) has no outreach path, so proposing
  // another touch is asking the user to write into the void.
  const reachable = isReachableByOutreach(lead || {});

  // follow_up: a sequence ran to the end, the lead never answered, and enough
  // silence has passed to justify one more touch with a different angle.
  const followUp =
    reachable &&
    completedSequences.length > 0 &&
    !replied &&
    stage !== "won" &&
    stage !== "lost" &&
    olderThan(last?.occurredAt, nowMs, thresholds.followUpDays);

  // revive: either the lead was written off, or it absorbed several finished
  // follow-ups without a word — and nothing has happened for a long time.
  const doneFollowUps = tasks.filter(
    (task) =>
      String(task?.type || "") === "follow_up" &&
      String(task?.status || "") === "done",
  ).length;
  const touchedAt = lastTouchAt(lead, events, tasks);
  const revive =
    reachable &&
    (stage === "lost" || (doneFollowUps >= 2 && !replied)) &&
    stage !== "won" &&
    touchedAt !== null &&
    nowMs - touchedAt >= thresholds.reviveDays * dayMs;

  // placement_check: the submission was sent and never looked at since.
  const submittedAt = time(lead?.placementSubmittedAt);
  const checkedAt = time(lead?.placementCheckedAt);
  const placementCheck =
    placementStatus === "submitted" &&
    olderThan(lead?.placementSubmittedAt, nowMs, thresholds.placementCheckDays) &&
    !(checkedAt !== null && submittedAt !== null && checkedAt > submittedAt);

  // placement_verify: a published listing can quietly disappear, so it is
  // re-verified on a slow cadence measured from the last time it was seen.
  const verifyFrom = lead?.placementCheckedAt || lead?.placementSubmittedAt;
  const placementVerify =
    placementStatus === "published" &&
    olderThan(verifyFrom, nowMs, thresholds.placementVerifyDays);

  // advance_deal: somebody answered and the deal has been parked ever since.
  const advanceDeal =
    replied &&
    stage === "replied" &&
    olderThan(lead?.repliedAt, nowMs, thresholds.advanceDealDays);

  return {
    follow_up: followUp,
    revive,
    placement_check: placementCheck,
    placement_verify: placementVerify,
    advance_deal: advanceDeal,
  };
}

/**
 * Build the payload stored with a new task. `sinceAt` is the timestamp the UI
 * measures the task's age from ("подано 9 дней назад").
 * @param {LeadTaskType} type
 * @param {Object} context
 */
function buildPayload(type, { lead, sequences, events }) {
  const last = lastEvent(events);
  if (type === "follow_up" || type === "revive") {
    const completed = sequences.filter(
      (sequence) => String(sequence?.status || "") === "completed",
    );
    const lastSequence = completed[completed.length - 1] || sequences[0] || null;
    const metadata = parsePayload(last?.metadata);
    return {
      sinceAt: last?.occurredAt || lead?.contactedAt || "",
      // The UI proposes a DIFFERENT template than the one that went unanswered.
      lastSequenceId: String(lastSequence?.id || ""),
      lastSequenceName: String(lastSequence?.name || ""),
      lastTemplateId: String(metadata.templateId || ""),
      lastStepNumber: Number(last?.stepNumber || 0),
      ...(type === "revive"
        ? { lastOutcomeNote: String(lead?.outcomeNote || ""), stage: String(lead?.stage || "") }
        : {}),
    };
  }
  if (type === "placement_check") {
    return { sinceAt: String(lead?.placementSubmittedAt || "") };
  }
  if (type === "placement_verify") {
    return {
      sinceAt: String(lead?.placementCheckedAt || lead?.placementSubmittedAt || ""),
      placementUrl: String(lead?.placementUrl || ""),
    };
  }
  return { sinceAt: String(lead?.repliedAt || "") };
}

/**
 * Decide what the workspace should do next with each of its leads.
 *
 * The function is idempotent: called twice on the same state (including the
 * tasks it produced the first time) the second call returns nothing new.
 *
 * @param {Object} input
 * @param {string | number | Date} input.now Current time.
 * @param {Array<Record<string, any>>} input.leads Every lead in scope.
 * @param {Array<Record<string, any>>} input.sequences Outreach sequences (need `leadId`, `status`).
 * @param {Array<Record<string, any>>} input.events outreach_events rows (need `leadId`, `occurredAt`).
 * @param {Array<Record<string, any>>} [input.tasks] Tasks that already exist, any status.
 * @param {LifecycleSettings} [input.settings] Threshold overrides.
 * @returns {{ create: Array<Record<string, any>>, close: Array<{ id: string, type: string, leadId: string, reason: string }> }}
 */
export function planLeadTasks({ now, leads, sequences, events, tasks, settings }) {
  const nowMs = time(now) ?? Number(now);
  const thresholds = withDefaults(settings);
  const nowIso = new Date(nowMs).toISOString();
  const leadList = Array.isArray(leads) ? leads : [];
  const taskList = Array.isArray(tasks) ? tasks : [];
  const sequencesByLead = byLead(sequences || []);
  const eventsByLead = byLead(events || []);
  const tasksByLead = byLead(taskList);

  /** @type {Array<Record<string, any>>} */
  const create = [];
  /** @type {Array<{ id: string, type: string, leadId: string, reason: string }>} */
  const close = [];
  /** @type {Map<string, ReturnType<typeof evaluateLead>>} */
  const conditions = new Map();

  for (const lead of leadList) {
    const leadId = String(lead?.id || "");
    if (!leadId) continue;
    const leadTasks = tasksByLead.get(leadId) || [];
    const leadSequences = sequencesByLead.get(leadId) || [];
    const leadEvents = eventsByLead.get(leadId) || [];
    const state = evaluateLead({
      nowMs,
      lead,
      sequences: leadSequences,
      events: leadEvents,
      tasks: leadTasks,
      thresholds,
    });
    conditions.set(leadId, state);

    for (const type of lifecycleTaskTypes) {
      if (!state[type]) continue;
      // Never a second live task of the same type for the same lead, and never
      // a task the user has already waved away.
      const blocked = leadTasks.some(
        (task) =>
          String(task?.type || "") === type &&
          blockingStatuses.has(String(task?.status || "")),
      );
      if (blocked) continue;
      // Lifetime cap: three follow-ups is where persistence turns into spam.
      if (type === "follow_up") {
        const historical = leadTasks.filter(
          (task) => String(task?.type || "") === "follow_up",
        ).length;
        if (historical >= thresholds.maxFollowUps) continue;
      }
      create.push({
        workspaceId: String(lead?.workspaceId || ""),
        productId: String(lead?.productId || ""),
        leadId,
        type,
        dueAt: nowIso,
        payload: buildPayload(type, {
          lead,
          sequences: leadSequences,
          events: leadEvents,
        }),
      });
    }
  }

  // Auto-close: anything still live whose reason to exist has disappeared, for
  // example a follow-up prepared before the lead finally answered.
  for (const task of taskList) {
    if (!liveStatuses.has(String(task?.status || ""))) continue;
    const leadId = String(task?.leadId || "");
    const type = String(task?.type || "");
    // Product-level tasks carry no lead condition and are left to the user.
    if (!leadId) continue;
    // Monitoring tasks are owned by the watch runner: only a fresh snapshot
    // can say whether the listing came back, so the time-based pass must not
    // close them just because it has no opinion about them.
    if (watchTypeSet.has(type)) continue;
    const state = conditions.get(leadId);
    if (!state) {
      close.push({ id: String(task?.id || ""), type, leadId, reason: "lead_missing" });
      continue;
    }
    if (!state[type]) {
      close.push({ id: String(task?.id || ""), type, leadId, reason: "condition_cleared" });
    }
  }

  return { create, close };
}

/**
 * Turn one lead's monitoring verdict into task bookkeeping.
 *
 * Same discipline as `planLeadTasks`: idempotent (a condition that is already
 * represented by a live task creates nothing), respectful of a dismissed task,
 * and self-closing (a condition that a later snapshot proved resolved finishes
 * the task without the user touching it).
 *
 * `conditions[type]` is a three-state value:
 *   true  — the condition holds now, a task should exist;
 *   false — it is demonstrably resolved, a live task is closed;
 *   null  — unknown (the page could not be read), nothing is touched.
 *
 * @param {Object} input
 * @param {string | number | Date} input.now
 * @param {Record<string, any>} input.lead Needs `id`, `workspaceId`, `productId`.
 * @param {Record<string, boolean | null>} input.conditions Keyed by watch task type.
 * @param {Record<string, Record<string, any>>} [input.payloads] Payload per type.
 * @param {Array<Record<string, any>>} [input.tasks] Existing tasks for this lead.
 * @returns {{create: Array<Record<string, any>>, close: Array<{id: string, type: string, leadId: string, reason: string}>}}
 */
export function planWatchTasks({ now, lead, conditions, payloads, tasks }) {
  const nowMs = time(now) ?? Number(now);
  const nowIso = new Date(nowMs).toISOString();
  const leadId = String(lead?.id || "");
  const leadTasks = (Array.isArray(tasks) ? tasks : []).filter(
    (task) => !task?.leadId || String(task.leadId) === leadId,
  );
  /** @type {Array<Record<string, any>>} */
  const create = [];
  /** @type {Array<{id: string, type: string, leadId: string, reason: string}>} */
  const close = [];
  if (!leadId) return { create, close };

  for (const type of watchTaskTypes) {
    const state = conditions?.[type];
    const existing = leadTasks.filter(
      (task) => String(task?.type || "") === type,
    );
    if (state === true) {
      // One live task per finding per channel: monitoring must never turn a
      // long-running problem into a growing pile of identical rows.
      const blocked = existing.some((task) =>
        blockingStatuses.has(String(task?.status || "")),
      );
      if (blocked) continue;
      create.push({
        workspaceId: String(lead?.workspaceId || ""),
        productId: String(lead?.productId || ""),
        leadId,
        type,
        dueAt: nowIso,
        payload: { sinceAt: nowIso, ...(payloads?.[type] || {}) },
      });
      continue;
    }
    if (state === false) {
      for (const task of existing) {
        if (!liveStatuses.has(String(task?.status || ""))) continue;
        close.push({
          id: String(task?.id || ""),
          type,
          leadId,
          reason: "condition_cleared",
        });
      }
    }
    // state === null: the check could not tell, so the queue is left alone.
  }
  return { create, close };
}
