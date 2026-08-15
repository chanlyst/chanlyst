import assert from "node:assert/strict";
import test from "node:test";
import {
  ENRICH_CAP_DEFAULT,
  ENRICH_CAP_MAX,
  CONTACT_QUERY_MAX_DEFAULT,
  CONTACT_TARGET_DEFAULT,
  PIPELINE_SCOPES,
  PIPELINE_STEPS,
  SEQUENCE_CAP_DEFAULT,
  SEQUENCE_CAP_MAX,
  advancePipeline,
  buildPipelineSequenceSteps,
  emptyPipelineCounts,
  firstPipelineStep,
  hasUsableAnalysis,
  nextPipelineStep,
  parsePipelineCounts,
  pipelineMaxEnrich,
  pipelineMaxSequences,
  pipelineContactQueryMax,
  pipelineContactTarget,
  qualifiesForSequence,
  selectEnrichmentTargets,
  selectSequenceTargets,
} from "../app/lib/pipeline-core.mjs";

function channel(overrides = {}) {
  return {
    id: "lead-1",
    score: 80,
    email: "",
    status: "review",
    contactStatus: "not_checked",
    outreachEligible: 1,
    ...overrides,
  };
}

/* Step ordering ------------------------------------------------------- */

test("the steps separate channel discovery from contact expansion", () => {
  assert.deepEqual(PIPELINE_STEPS, [
    "analyze",
    "discover",
    "expand",
    "enrich",
    "drafts",
    "done",
  ]);
  assert.equal(nextPipelineStep("analyze"), "discover");
  assert.equal(nextPipelineStep("discover"), "expand");
  assert.equal(nextPipelineStep("expand"), "enrich");
  assert.equal(nextPipelineStep("enrich"), "drafts");
  assert.equal(nextPipelineStep("drafts"), "done");
});

test("direct-buyer discovery is one wave by default, and can be asked for more", () => {
  // The defaults used to be the ceilings — a thousand companies over a hundred
  // and twenty-eight queries — which is an open-ended crawl rather than a
  // step. Survivable inside «Подготовить всё»; not once it rides along with
  // every press of Find.
  assert.equal(pipelineContactTarget({}), 12);
  assert.equal(pipelineContactQueryMax({}), 4);
  // An operator who wants the long crawl can still have it, up to the ceiling.
  assert.equal(pipelineContactTarget({ PIPELINE_CONTACT_TARGET: "5000" }), 1000);
  assert.equal(pipelineContactQueryMax({ PIPELINE_CONTACT_QUERY_MAX: "999" }), 128);
});

test("done is terminal and an unknown step restarts at analyze", () => {
  assert.equal(nextPipelineStep("done"), "done");
  assert.equal(nextPipelineStep("nonsense"), "analyze");
});

/* State machine ------------------------------------------------------- */

test("a queued run starts running on the same step", () => {
  const next = advancePipeline(
    { status: "queued", step: "analyze", attempts: 0 },
    { type: "start" },
  );
  assert.equal(next.status, "running");
  assert.equal(next.step, "analyze");
  assert.equal(next.finished, false);
});

test("progress keeps the step and clears the retry budget", () => {
  const next = advancePipeline(
    { status: "running", step: "enrich", attempts: 1 },
    { type: "progress" },
  );
  assert.equal(next.status, "running");
  assert.equal(next.step, "enrich");
  assert.equal(next.attempts, 0);
});

test("finishing the last step marks the run done and stamps finished_at", () => {
  const next = advancePipeline(
    { status: "running", step: "drafts", attempts: 0 },
    { type: "stepDone" },
  );
  assert.equal(next.status, "done");
  assert.equal(next.step, "done");
  assert.equal(next.finished, true);
});

test("a step gets exactly one retry before the run fails", () => {
  const first = advancePipeline(
    { status: "running", step: "discover", attempts: 0 },
    { type: "failure", code: "openrouter_request_failed", message: "boom" },
  );
  assert.equal(first.status, "running");
  assert.equal(first.attempts, 1);
  assert.equal(first.step, "discover");

  const second = advancePipeline(
    { status: "running", step: "discover", attempts: first.attempts },
    { type: "failure", code: "openrouter_request_failed", message: "boom" },
  );
  assert.equal(second.status, "failed");
  assert.equal(second.errorCode, "openrouter_request_failed");
  assert.equal(second.error, "boom");
  assert.equal(second.finished, true);
});

test("exhausted AI credits pause the run instead of failing it", () => {
  const next = advancePipeline(
    { status: "running", step: "enrich", attempts: 1 },
    { type: "failure", code: "ai_credits_exhausted" },
  );
  assert.equal(next.status, "paused");
  assert.equal(next.errorCode, "ai_credits_exhausted");
  assert.equal(next.step, "enrich");
  assert.equal(next.finished, false);
});

test("resuming a paused run clears the error and returns to the same step", () => {
  const next = advancePipeline(
    { status: "paused", step: "enrich", attempts: 1 },
    { type: "resume" },
  );
  assert.equal(next.status, "running");
  assert.equal(next.step, "enrich");
  assert.equal(next.attempts, 0);
  assert.equal(next.errorCode, "");
});

/* Spend caps ---------------------------------------------------------- */

test("the expensive enrichment fallback is opt-in and clamps to 0–40", () => {
  assert.equal(pipelineMaxEnrich({}), ENRICH_CAP_DEFAULT);
  assert.equal(pipelineMaxEnrich({ PIPELINE_MAX_ENRICH: "" }), ENRICH_CAP_DEFAULT);
  assert.equal(pipelineMaxEnrich({ PIPELINE_MAX_ENRICH: "abc" }), ENRICH_CAP_DEFAULT);
  assert.equal(pipelineMaxEnrich({ PIPELINE_MAX_ENRICH: "3" }), 3);
  assert.equal(pipelineMaxEnrich({ PIPELINE_MAX_ENRICH: "0" }), 0);
  assert.equal(pipelineMaxEnrich({ PIPELINE_MAX_ENRICH: "-5" }), 0);
  assert.equal(pipelineMaxEnrich({ PIPELINE_MAX_ENRICH: "999" }), ENRICH_CAP_MAX);
});

test("the sequence cap defaults to 5 and clamps to 0–20", () => {
  assert.equal(pipelineMaxSequences({}), SEQUENCE_CAP_DEFAULT);
  assert.equal(pipelineMaxSequences({ PIPELINE_MAX_SEQUENCES: "2" }), 2);
  assert.equal(pipelineMaxSequences({ PIPELINE_MAX_SEQUENCES: "-1" }), 0);
  assert.equal(pipelineMaxSequences({ PIPELINE_MAX_SEQUENCES: "40" }), SEQUENCE_CAP_MAX);
});

/* Enrichment target selection ----------------------------------------- */

test("enrichment targets are outreach-eligible channels without an e-mail", () => {
  const targets = selectEnrichmentTargets(
    [
      channel({ id: "a", score: 90 }),
      channel({ id: "b", score: 95, email: "hi@b.com" }),
      channel({ id: "c", score: 70, outreachEligible: 0 }),
      channel({ id: "d", score: 85, status: "rejected" }),
      channel({ id: "e", score: 88 }),
    ],
    { cap: 10 },
  );
  assert.deepEqual(
    targets.map((item) => item.id),
    ["a", "e"],
  );
});

test("enrichment targets are ordered by score and cut at the cap", () => {
  const targets = selectEnrichmentTargets(
    [
      channel({ id: "low", score: 10 }),
      channel({ id: "high", score: 99 }),
      channel({ id: "mid", score: 50 }),
    ],
    { cap: 2 },
  );
  assert.deepEqual(
    targets.map((item) => item.id),
    ["high", "mid"],
  );
});

test("the cap counts enrichments already spent by earlier slices", () => {
  const pool = [
    channel({ id: "a", score: 90 }),
    channel({ id: "b", score: 80 }),
    channel({ id: "c", score: 70 }),
  ];
  assert.equal(selectEnrichmentTargets(pool, { cap: 3, alreadyEnriched: 1 }).length, 2);
  assert.equal(selectEnrichmentTargets(pool, { cap: 3, alreadyEnriched: 3 }).length, 0);
  assert.equal(selectEnrichmentTargets(pool, { cap: 3, alreadyEnriched: 9 }).length, 0);
  assert.equal(selectEnrichmentTargets(pool, { cap: 0 }).length, 0);
});

/* Sequence qualification ---------------------------------------------- */

test("a sequence needs a verified public e-mail on an eligible channel", () => {
  assert.equal(
    qualifiesForSequence(
      channel({ email: "team@site.com", contactStatus: "verified_public" }),
    ),
    true,
  );
  // Found but unverified addresses get the single queued message only.
  assert.equal(
    qualifiesForSequence(
      channel({ email: "team@site.com", contactStatus: "found_unverified" }),
    ),
    false,
  );
  assert.equal(
    qualifiesForSequence(channel({ email: "", contactStatus: "verified_public" })),
    false,
  );
  assert.equal(
    qualifiesForSequence(
      channel({ email: "not-an-email", contactStatus: "verified_public" }),
    ),
    false,
  );
  assert.equal(
    qualifiesForSequence(
      channel({
        email: "team@site.com",
        contactStatus: "verified_public",
        outreachEligible: 0,
      }),
    ),
    false,
  );
  assert.equal(
    qualifiesForSequence(
      channel({
        email: "team@site.com",
        contactStatus: "verified_public",
        status: "rejected",
      }),
    ),
    false,
  );
});

test("sequence targets are the best qualified channels within the cap", () => {
  const targets = selectSequenceTargets(
    [
      channel({ id: "a", score: 70, email: "a@a.com", contactStatus: "verified_public" }),
      channel({ id: "b", score: 95, email: "b@b.com", contactStatus: "verified_public" }),
      channel({ id: "c", score: 99, email: "c@c.com", contactStatus: "found_unverified" }),
    ],
    { cap: 1 },
  );
  assert.deepEqual(
    targets.map((item) => item.id),
    ["b"],
  );
  assert.equal(selectSequenceTargets([channel()], { cap: 0 }).length, 0);
});

/* Counts and analysis reuse ------------------------------------------- */

test("counts parse defensively and never go negative", () => {
  assert.deepEqual(parsePipelineCounts(""), emptyPipelineCounts());
  assert.deepEqual(parsePipelineCounts("not json"), emptyPipelineCounts());
  const parsed = parsePipelineCounts(
    JSON.stringify({ channelsFound: 4, contactsFound: -2, bogus: 7 }),
  );
  assert.equal(parsed.channelsFound, 4);
  assert.equal(parsed.contactsFound, 0);
  assert.equal(parsed.sequencesCreated, 0);
  assert.equal("bogus" in parsed, false);
});

test("an already analysed product skips the analyze step", () => {
  assert.equal(hasUsableAnalysis({ summary: "Something" }), true);
  assert.equal(hasUsableAnalysis({ acquisitionMotions: [{ id: "partnerships" }] }), true);
  assert.equal(hasUsableAnalysis({ summary: "  ", acquisitionMotions: [] }), false);
  assert.equal(hasUsableAnalysis({}), false);
  assert.equal(hasUsableAnalysis(null), false);
});

/* Sequence drafting --------------------------------------------------- */

test("the drafted sequence is three steps with 0/3/5-day delays", () => {
  const steps = buildPipelineSequenceSteps({
    subject: "Идея",
    body: "Текст",
    locale: "ru",
  });
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map((step) => step.delayDays), [0, 3, 5]);
  assert.equal(steps[0].subject, "Идея");
  assert.equal(steps[0].body, "Текст");
  assert.equal(steps[1].subject, "Re: Идея");
  assert.ok(steps.every((step) => step.body.trim().length > 0));
});

test("an empty draft falls back to variable-based copy in both locales", () => {
  const ru = buildPipelineSequenceSteps({ locale: "ru" });
  assert.ok(ru[0].subject.includes("{{company_name}}"));
  assert.ok(ru[0].body.includes("{{first_name}}"));
  const en = buildPipelineSequenceSteps({ locale: "en" });
  assert.ok(en[0].subject.startsWith("Idea for"));
});

test("a discovery run is the same machine with a shorter list of steps", () => {
  // Find-channels used to be a synchronous request: 216 seconds on 13 August,
  // cut by the proxy at 180, and the whole paid-for run discarded because the
  // browser meant to save it got a 504.
  // One press finds both halves: the places and the companies.
  assert.deepEqual(PIPELINE_SCOPES.discovery, ["discover", "expand", "done"]);
  // And the second half is bounded to one wave, or a press of Find becomes a
  // crawl of a thousand companies with no way to predict its cost.
  assert.ok(CONTACT_TARGET_DEFAULT <= 20, `target ${CONTACT_TARGET_DEFAULT}`);
  assert.ok(CONTACT_QUERY_MAX_DEFAULT <= 6, `queries ${CONTACT_QUERY_MAX_DEFAULT}`);
  assert.equal(firstPipelineStep("discovery"), "discover");
  assert.equal(firstPipelineStep("full"), "analyze");
  assert.equal(firstPipelineStep("nonsense"), "analyze");

  // It ends after expand rather than walking on into enrichment and drafts,
  // which belong to «Подготовить всё».
  assert.equal(nextPipelineStep("discover", "discovery"), "expand");
  assert.equal(nextPipelineStep("expand", "discovery"), "done");
  assert.equal(nextPipelineStep("done", "discovery"), "done");
  // The full run is untouched, including its default.
  assert.equal(nextPipelineStep("expand", "full"), "enrich");
  assert.equal(nextPipelineStep("expand"), "enrich");
});

test("a run out of step for its scope falls back inside that scope", () => {
  const state = advancePipeline(
    { step: "enrich", attempts: 0, scope: "discovery" },
    { type: "stepDone" },
  );
  // Not "analyze" from the full list: a discovery run has no analyze step.
  assert.equal(state.step, "expand");
});
