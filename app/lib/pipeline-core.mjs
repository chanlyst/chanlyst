// The "prepare everything for me" pipeline: its state machine, its spend caps
// and its target-selection rules.
//
// This module is deliberately pure — no database, no network, no clock. The
// runner (app/lib/pipeline-runner.ts) loads rows, calls these functions to
// decide what happens next, performs the one bounded action they picked and
// writes the returned state back. That keeps every decision unit-testable
// offline in tests/pipeline-core.test.mjs.
//
// The pipeline never sends anything: it prepares queued messages and draft
// sequences, and the user starts them by hand.
//
// Kept as an .mjs module so `node --test` can import it directly while the
// TypeScript runner imports it through allowJs.

import { isReachableByOutreach } from "./contact-route.mjs";

/** @typedef {"analyze" | "discover" | "expand" | "enrich" | "drafts" | "done"} PipelineStep */
/** @typedef {"queued" | "running" | "done" | "failed" | "paused"} PipelineStatus */

/** The steps in execution order. `done` is the terminal step. */
export const PIPELINE_STEPS = /** @type {PipelineStep[]} */ ([
  "analyze",
  "discover",
  "expand",
  "enrich",
  "drafts",
  "done",
]);

/**
 * The steps each kind of run performs.
 *
 * "full" is «Подготовить всё». "discovery" is the Find-channels button, which
 * used to be a synchronous request holding a browser open for three minutes;
 * as a run it advances one step per request, keeps its state in the database
 * and is finished by the timer if the tab goes away.
 */
export const PIPELINE_SCOPES = {
  full: PIPELINE_STEPS,
  // Both halves of "where are the customers": the places to be listed on, and
  // the companies to sell to directly. "expand" is the second of those, and it
  // was pulled out of this scope earlier today for being an unbounded crawl
  // riding along unasked. It is bounded now — four queries, a dozen companies
  // — and asked for, so one press finds both.
  discovery: /** @type {PipelineStep[]} */ (["discover", "expand", "done"]),
};

/** @param {unknown} scope @returns {"full" | "discovery"} */
export function pipelineScope(scope) {
  return scope === "discovery" ? "discovery" : "full";
}

/** @param {unknown} scope @returns {PipelineStep} */
export function firstPipelineStep(scope) {
  return PIPELINE_SCOPES[pipelineScope(scope)][0];
}

/** Statuses a run can still be advanced from. */
export const ACTIVE_STATUSES = /** @type {PipelineStatus[]} */ ([
  "queued",
  "running",
]);

/** Failures per step before the run gives up: one try plus one retry. */
export const MAX_STEP_ATTEMPTS = 2;

/** Default and hard ceilings for the two spend caps. */
// Mass discovery already checks the public site and its contact/about pages.
// Keep the expensive model-based fallback opt-in so a normal run has a
// predictable Serper-only acquisition cost.
export const ENRICH_CAP_DEFAULT = 0;
export const ENRICH_CAP_MAX = 40;
export const SEQUENCE_CAP_DEFAULT = 5;
export const SEQUENCE_CAP_MAX = 20;
// Direct-buyer discovery, bounded like the channel search it now rides along
// with.
//
// The defaults were a thousand companies and a hundred and twenty-eight
// queries, which is not a step but an open-ended crawl: it went slice after
// slice until it hit a ceiling nobody would ever reach on purpose. That was
// survivable while it only ran inside «Подготовить всё», and is not once it
// runs on every press of Find.
//
// Four queries and a dozen companies is one wave — the same shape as a
// discovery lane, and a cost anyone can predict before pressing. The ceilings
// stay high so an operator who wants a long crawl can still ask for one.
export const CONTACT_TARGET_DEFAULT = 12;
export const CONTACT_TARGET_MAX = 1_000;
export const CONTACT_QUERY_MAX_DEFAULT = 4;
export const CONTACT_QUERY_MAX = 128;

/**
 * The step that follows `step`. An unknown step restarts at the beginning so a
 * corrupted row can never wedge the runner.
 * @param {string} step
 * @returns {PipelineStep}
 */
export function nextPipelineStep(step, scope = "full") {
  const steps = PIPELINE_SCOPES[pipelineScope(scope)];
  const index = steps.indexOf(/** @type {PipelineStep} */ (step));
  if (index < 0) return steps[0];
  return steps[Math.min(index + 1, steps.length - 1)];
}

/**
 * Reads an integer cap from an env-like record and clamps it into [0, max].
 * Anything unparseable falls back to the default.
 * @param {Record<string, unknown>} env
 * @param {string} key
 * @param {number} fallback
 * @param {number} max
 */
export function clampCap(env, key, fallback, max) {
  const raw = env?.[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(max, Math.floor(value)));
}

/**
 * Enrichment is the expensive step (~$0.04–0.05 per contact), so it is capped
 * per run. PIPELINE_MAX_ENRICH can opt into it; the value is
 * clamped to 0–40 so an env typo can never authorise unbounded spend.
 * @param {Record<string, unknown>} env
 */
export function pipelineMaxEnrich(env) {
  return clampCap(env, "PIPELINE_MAX_ENRICH", ENRICH_CAP_DEFAULT, ENRICH_CAP_MAX);
}

/**
 * How many channels may get a 3-step sequence draft in one run.
 * PIPELINE_MAX_SEQUENCES overrides the default of 5, clamped to 0–20.
 * @param {Record<string, unknown>} env
 */
export function pipelineMaxSequences(env) {
  return clampCap(
    env,
    "PIPELINE_MAX_SEQUENCES",
    SEQUENCE_CAP_DEFAULT,
    SEQUENCE_CAP_MAX,
  );
}

/** Concrete organisations to accumulate; independent from the channel cap. */
export function pipelineContactTarget(env) {
  return clampCap(
    env,
    "PIPELINE_CONTACT_TARGET",
    CONTACT_TARGET_DEFAULT,
    CONTACT_TARGET_MAX,
  );
}

/** Paid Serper searches allowed to reach that target (roughly $0.10 at list price). */
export function pipelineContactQueryMax(env) {
  return clampCap(
    env,
    "PIPELINE_CONTACT_QUERY_MAX",
    CONTACT_QUERY_MAX_DEFAULT,
    CONTACT_QUERY_MAX,
  );
}

/**
 * @typedef {Object} PipelineChannel
 * @property {string} id
 * @property {number} [score]
 * @property {string} [email]
 * @property {string} [status]        prospects.status: review|approved|rejected
 * @property {string} [contactStatus] not_checked|verified_public|found_unverified|not_found|check_failed
 * @property {string} [telegram]
 * @property {string} [linkedin]
 * @property {string} [contactEvidence] carries the affiliate-network hint
 * @property {string} [opportunityType]
 * @property {string} [actionType]
 * @property {number|boolean} [outreachEligible]
 */

/**
 * Which channels this run should spend enrichment money on.
 *
 * The rule: outreach-eligible, not rejected by the user, reachable by outreach
 * at all, and with no e-mail yet — highest score first, capped. Channels that
 * already carry an e-mail are skipped because re-checking them buys nothing,
 * and so are channels whose route is `network` or `none`: enrichment already
 * concluded there is nobody to write to, so paying for the same conclusion a
 * second time buys nothing either.
 *
 * @param {PipelineChannel[]} channels
 * @param {{ cap: number, alreadyEnriched?: number }} options
 * @returns {PipelineChannel[]}
 */
export function selectEnrichmentTargets(channels, { cap, alreadyEnriched = 0 }) {
  const budget = Math.max(0, cap - Math.max(0, alreadyEnriched));
  if (!budget) return [];
  return (channels || [])
    .filter(
      (channel) =>
        Boolean(Number(channel.outreachEligible)) &&
        channel.status !== "rejected" &&
        isReachableByOutreach(channel) &&
        !String(channel.email || "").trim(),
    )
    .slice()
    .sort(
      (a, b) =>
        Number(b.score || 0) - Number(a.score || 0) ||
        String(a.id).localeCompare(String(b.id)),
    )
    .slice(0, budget);
}

/**
 * Whether a channel has earned a 3-email sequence draft.
 *
 * A sequence is only meaningful for an outreach channel we can actually write
 * to, so it needs a verified public e-mail. `found_unverified` addresses are
 * deliberately excluded: the user can still send the single queued message,
 * but a multi-step sequence never starts from a guessed address.
 *
 * @param {PipelineChannel} channel
 */
export function qualifiesForSequence(channel) {
  if (!channel) return false;
  if (!Number(channel.outreachEligible)) return false;
  if (channel.status === "rejected") return false;
  // A `network` or `none` lead has no outreach path at all: an affiliate
  // network is joined, not e-mailed.
  if (!isReachableByOutreach(channel)) return false;
  if (channel.contactStatus !== "verified_public") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(channel.email || "").trim());
}

/**
 * The channels a run drafts for, highest score first and capped.
 * @param {PipelineChannel[]} channels
 * @param {{ cap: number }} options
 */
export function selectSequenceTargets(channels, { cap }) {
  if (cap <= 0) return [];
  return (channels || [])
    .filter(qualifiesForSequence)
    .slice()
    .sort(
      (a, b) =>
        Number(b.score || 0) - Number(a.score || 0) ||
        String(a.id).localeCompare(String(b.id)),
    )
    .slice(0, cap);
}

/**
 * @typedef {Object} PipelineRunState
 * @property {PipelineStatus} status
 * @property {PipelineStep} step
 * @property {number} attempts
 * @property {string} [error]
 * @property {string} [errorCode]
 * @property {boolean} [finished] whether finished_at should be stamped
 */

/**
 * @typedef {{type:"start"}
 *          |{type:"progress"}
 *          |{type:"stepDone"}
 *          |{type:"failure", code: string, message?: string}
 *          |{type:"resume"}} PipelineEvent
 */

/**
 * The whole state machine in one function.
 *
 *   queued --start--> running
 *   running --progress--> running        (same step, more slices to go)
 *   running --stepDone--> running        (next step) … until step 'done'
 *   running --failure(ai_credits_exhausted)--> paused   (resumable)
 *   running --failure(other)--> running  (one retry) --> failed
 *   paused  --resume--> running          (attempts reset, error cleared)
 *
 * @param {{status: string, step: string, attempts?: number}} run
 * @param {PipelineEvent} event
 * @returns {PipelineRunState}
 */
export function advancePipeline(run, event) {
  const scope = pipelineScope(run.scope);
  const steps = PIPELINE_SCOPES[scope];
  const step = /** @type {PipelineStep} */ (
    steps.includes(/** @type {PipelineStep} */ (run.step)) ? run.step : steps[0]
  );
  const attempts = Math.max(0, Number(run.attempts) || 0);
  switch (event.type) {
    case "start":
    case "resume":
      return {
        status: "running",
        step,
        attempts: 0,
        error: "",
        errorCode: "",
        finished: false,
      };
    case "progress":
      // The step still has bounded work left; a successful slice clears the
      // retry budget so a slow site cannot accumulate failures forever.
      return {
        status: "running",
        step,
        attempts: 0,
        error: "",
        errorCode: "",
        finished: false,
      };
    case "stepDone": {
      const next = nextPipelineStep(step, scope);
      const finished = next === "done";
      return {
        status: finished ? "done" : "running",
        step: next,
        attempts: 0,
        error: "",
        errorCode: "",
        finished,
      };
    }
    case "failure": {
      // Running out of provider credits is not a defect: the user can top up
      // and resume, so the run pauses instead of failing.
      if (event.code === "ai_credits_exhausted") {
        return {
          status: "paused",
          step,
          attempts,
          error: event.message || "",
          errorCode: "ai_credits_exhausted",
          finished: false,
        };
      }
      const used = attempts + 1;
      if (used >= MAX_STEP_ATTEMPTS) {
        return {
          status: "failed",
          step,
          attempts: used,
          error: event.message || "",
          errorCode: event.code || "pipeline_failed",
          finished: true,
        };
      }
      return {
        status: "running",
        step,
        attempts: used,
        error: event.message || "",
        errorCode: event.code || "pipeline_failed",
        finished: false,
      };
    }
    default:
      return {
        status: /** @type {PipelineStatus} */ (run.status),
        step,
        attempts,
        finished: false,
      };
  }
}

/** The counters a run reports to the dashboard. */
export function emptyPipelineCounts() {
  return {
    channelsFound: 0,
    contactsFound: 0,
    templatesCreated: 0,
    sequencesCreated: 0,
    // Beyond the four the UI shows: how many messages were prepared, and how
    // many enrichment attempts were spent (the latter is what enforces the
    // per-run enrichment cap across slices, including attempts that found
    // nothing).
    messagesCreated: 0,
    contactsChecked: 0,
    contactsDiscovered: 0,
    contactsVerified: 0,
    contactQueries: 0,
  };
}

/**
 * Parses the stored counts JSON, tolerating anything malformed.
 * @param {string|null|undefined} raw
 */
export function parsePipelineCounts(raw) {
  const base = emptyPipelineCounts();
  if (!raw) return base;
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== "object") return base;
    for (const key of Object.keys(base)) {
      const value = Number(/** @type {Record<string, unknown>} */ (parsed)[key]);
      if (Number.isFinite(value)) {
        /** @type {Record<string, number>} */ (base)[key] = Math.max(
          0,
          Math.round(value),
        );
      }
    }
    return base;
  } catch {
    return base;
  }
}

/**
 * Substitutes the template variables the composer supports. Unknown variables
 * and stray braces are left untouched, exactly like the dashboard's own
 * substitution.
 *
 * @param {string} text
 * @param {{company: string, contact: string, product: string, url: string}} vars
 */
export function fillTemplateVariables(text, vars) {
  return String(text || "").replace(
    /\{\{(company|contact|product|url)\}\}/g,
    (_match, key) => vars[key] ?? "",
  );
}

/**
 * The 3-step sequence the pipeline drafts, mirroring the composer's
 * «Подготовить серию писем». Step 1 is the drafted first message; the two
 * follow-ups use the {{first_name}} / {{company_name}} variables the outreach
 * engine substitutes at send time.
 *
 * @param {{subject?: string, body?: string, locale?: "ru"|"en"}} input
 */
export function buildPipelineSequenceSteps({ subject, body, locale }) {
  const ru = locale !== "en";
  const baseSubject =
    String(subject || "").trim() ||
    (ru ? "Идея для {{company_name}}" : "Idea for {{company_name}}");
  const baseBody =
    String(body || "").trim() ||
    (ru
      ? "Здравствуйте, {{first_name}}! Есть короткая идея сотрудничества для {{company_name}}."
      : "Hi {{first_name}}, I have a short partnership idea for {{company_name}}.");
  return [
    { subject: baseSubject, body: baseBody, delayDays: 0 },
    {
      subject: `Re: ${baseSubject}`,
      body: ru
        ? "{{first_name}}, добавлю один практический момент: мы можем начать с небольшого теста и измерить результат по подтверждённым оплатам. Прислать короткий план?"
        : "{{first_name}}, one practical addition: we can start with a small test and measure confirmed payments. May I send the short plan?",
      delayDays: 3,
    },
    {
      subject: `Re: ${baseSubject}`,
      body: ru
        ? "{{first_name}}, закрываю тему, чтобы не отвлекать. Если привлечение платящих клиентов для {{company_name}} сейчас актуально, я подготовлю конкретный тест без долгих созвонов."
        : "{{first_name}}, I’ll close the loop here. If acquiring paying customers for {{company_name}} is timely, I can prepare a concrete test without a lengthy call.",
      delayDays: 5,
    },
  ];
}

/**
 * Whether the product already carries a usable analysis, in which case the
 * pipeline skips the analyze step entirely (and its cost).
 * @param {{summary?: string, acquisitionMotions?: unknown[]}|null|undefined} analysis
 */
export function hasUsableAnalysis(analysis) {
  if (!analysis || typeof analysis !== "object") return false;
  const summary = String(analysis.summary || "").trim();
  const motions = Array.isArray(analysis.acquisitionMotions)
    ? analysis.acquisitionMotions.length
    : 0;
  return Boolean(summary) || motions > 0;
}
