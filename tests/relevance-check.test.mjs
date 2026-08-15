import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_REASON_CHARS,
  MAX_RELEVANCE_CANDIDATES,
  RELEVANCE_DOUBTFUL,
  RELEVANCE_OK,
  RELEVANCE_UNKNOWN,
  applyRelevanceVerdicts,
  buildRelevancePrompt,
  relevanceCandidates,
  summariseRelevance,
} from "../app/lib/relevance-check.mjs";

const identity = (title, description) => ({ title, description, siteName: "" });

const RESULTS = [
  {
    company: "TrafficJunky",
    url: "https://trafficjunky.com/",
    identity: identity("TrafficJunky", "Advertising network for adult traffic"),
  },
  {
    company: "AdultLifestyleCommunities.com",
    url: "https://adultlifestylecommunities.com/",
    identity: identity(
      "Home - Adult Lifestyle Communities",
      "The ultimate resource for active adults 55+",
    ),
  },
  // Fetched nothing: the page was unreadable, so there is nothing to judge on.
  { company: "SavageLAB", url: "https://savagelab.app/", identity: identity("", "") },
];

test("only candidates whose page we read are sent to the judge", () => {
  const candidates = relevanceCandidates(RESULTS);

  assert.deepEqual(
    candidates.map((candidate) => candidate.index),
    [0, 1],
  );
  // Judging an unreadable page would score the model's own description again,
  // which is exactly the evidence this step exists to cross-check.
  assert.ok(!candidates.some((candidate) => candidate.company === "SavageLAB"));
});

test("the candidate list is capped", () => {
  const many = Array.from({ length: 30 }, (_, index) => ({
    company: `c${index}`,
    identity: identity(`Site ${index}`, "desc"),
  }));
  assert.equal(relevanceCandidates(many).length, MAX_RELEVANCE_CANDIDATES);
});

test("the prompt carries the site's own words, not the model's pitch", () => {
  const prompt = buildRelevancePrompt({
    product: {
      name: "NaughtyTalk",
      description: "NSFW AI companion chat",
      audience: "adults 18+ looking for AI chat",
      negativeAudience: "minors",
    },
    candidates: relevanceCandidates(RESULTS),
  });

  assert.match(prompt, /NaughtyTalk/);
  assert.match(prompt, /НЕ аудитория: minors/);
  assert.match(prompt, /1\. AdultLifestyleCommunities\.com — Home - Adult Lifestyle/);
  assert.match(prompt, /active adults 55\+/);
  // The indices in the prompt must be the result indices, or verdicts land on
  // the wrong channel when a candidate was skipped.
  assert.match(prompt, /^0\. TrafficJunky/m);
});

test("verdicts land on the right results and doubtful ones carry a reason", () => {
  const judged = applyRelevanceVerdicts(RESULTS, {
    verdicts: [
      { index: 0, verdict: RELEVANCE_OK, reason: "рекламная сеть в нужной нише" },
      {
        index: 1,
        verdict: RELEVANCE_DOUBTFUL,
        reason: "  форум для   пенсионеров 55+, а не 18+  ",
      },
    ],
  });

  assert.equal(judged[0].relevance, RELEVANCE_OK);
  // A reason on an "ok" card is noise; it is only kept where it explains a grouping.
  assert.equal(judged[0].relevanceReason, "");
  assert.equal(judged[1].relevance, RELEVANCE_DOUBTFUL);
  assert.equal(judged[1].relevanceReason, "форум для пенсионеров 55+, а не 18+");
  // Never asked about, so never judged — and still a normal channel.
  assert.equal(judged[2].relevance, RELEVANCE_UNKNOWN);
});

test("silence, junk and repeats never turn into a verdict against a channel", () => {
  const judged = applyRelevanceVerdicts(RESULTS, {
    verdicts: [
      { index: "nonsense", verdict: RELEVANCE_DOUBTFUL, reason: "x" },
      { index: 0, verdict: "reject", reason: "not a permitted verdict" },
      { index: 1, verdict: RELEVANCE_OK, reason: "first answer wins" },
      { index: 1, verdict: RELEVANCE_DOUBTFUL, reason: "contradicts itself" },
    ],
  });

  assert.equal(judged[0].relevance, RELEVANCE_UNKNOWN);
  assert.equal(judged[1].relevance, RELEVANCE_OK);
  assert.deepEqual(applyRelevanceVerdicts(RESULTS, {})[1].relevance, RELEVANCE_UNKNOWN);
  assert.deepEqual(applyRelevanceVerdicts(RESULTS, null)[0].relevance, RELEVANCE_UNKNOWN);
});

test("reasons are capped", () => {
  const judged = applyRelevanceVerdicts(RESULTS, {
    verdicts: [
      { index: 0, verdict: RELEVANCE_DOUBTFUL, reason: "д".repeat(400) },
    ],
  });
  assert.equal(judged[0].relevanceReason.length, MAX_REASON_CHARS);
});

test("summariseRelevance counts what the run did", () => {
  const judged = applyRelevanceVerdicts(RESULTS, {
    verdicts: [
      { index: 0, verdict: RELEVANCE_OK, reason: "" },
      { index: 1, verdict: RELEVANCE_DOUBTFUL, reason: "не та аудитория" },
    ],
  });
  assert.deepEqual(summariseRelevance(judged), { ok: 1, doubtful: 1, unknown: 1 });
});

// The reason lands on a channel card, so it follows the interface language.
// It used to be pinned to Russian in the prompt text itself.
test("the relevance prompt follows the interface language", () => {
  const candidates = relevanceCandidates(RESULTS);
  const english = buildRelevancePrompt({ product: {}, candidates, locale: "en" });

  assert.match(english, /Язык всех текстовых полей ответа: English\./);
  assert.ok(!english.includes("по-русски"), "the hardcoded Russian is gone");
  assert.match(
    buildRelevancePrompt({ product: {}, candidates }),
    /Язык всех текстовых полей ответа: Russian\./,
  );
});
