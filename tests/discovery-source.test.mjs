import assert from "node:assert/strict";
import test from "node:test";
import {
  SOURCE_CANDIDATES_MAX_CHARS,
  SOURCE_CANDIDATES_MAX_ITEMS,
  buildSourceCandidateBlock,
  SOURCE_PAGES,
  buildSourceQueries,
  normaliseSourceCandidates,
  rankSourceCandidates,
  searchPhrase,
  sourceRequestPlan,
  sourceStartPage,
} from "../app/lib/discovery-source-core.mjs";

const product = {
  name: "Chanlyst",
  category: "customer acquisition software",
  audience: "SaaS founders",
  geography: "United States",
};

test("every discovery lane gets its deterministic source queries", () => {
  for (const motion of [
    "directories",
    "communities",
    "creators",
    "partnerships",
    "content_seo",
    "paid_placements",
    "direct_sales",
    "affiliates",
  ]) {
    const queries = buildSourceQueries({ product, focusMotion: motion }).map((q) => q.query);
    // Communities also searches Telegram, which no other lane does.
    assert.equal(queries.length, motion === "communities" ? 4 : 3, motion);
    assert.equal(new Set(queries).size, queries.length, motion);
    assert.ok(
      queries.every(
        (query) =>
          query.includes("customer acquisition software") ||
          query.includes("SaaS founders"),
      ),
    );
  }
});

test("the communities lane actually asks Google for Telegram", () => {
  const queries = buildSourceQueries({ product, focusMotion: "communities" }).map((q) => q.query);
  assert.ok(queries.some((query) => query.startsWith("site:t.me ")), queries.join(" | "));
  assert.ok(queries.some((query) => /telegram/i.test(query)));
});

test("a short topic is quoted, a sentence is never quoted", () => {
  assert.equal(searchPhrase("RevOps SaaS"), '"RevOps SaaS"');
  const sentence =
    "Review the product website before finding channels. Goal: get first customers.";
  const phrase = searchPhrase(sentence);
  assert.ok(!phrase.includes('"'), phrase);
  assert.ok(phrase.split(" ").length <= 5, phrase);
});

test("no query asks Google for a sentence as an exact phrase", () => {
  // The shape every public preview used to run with: no category, and a
  // description written at the model rather than about the product.
  const preview = {
    name: "example.com",
    description:
      "Review the product website before finding channels. Goal: get first customers.",
    audience: "Founders",
    geography: "worldwide",
  };
  for (const motion of ["directories", "communities", "creators", "partnerships"]) {
    for (const { query } of buildSourceQueries({ product: preview, focusMotion: motion })) {
      const quoted = query.match(/"([^"]*)"/);
      assert.ok(
        !quoted || quoted[1].split(" ").length <= 5,
        `${motion}: ${query}`,
      );
    }
  }
});

test("the product's own analysed queries reach the search, paired with the lane", () => {
  const analysed = {
    ...product,
    analysis: {
      searchQueries: [
        "revenue operations consultants community",
        "sales ops slack group",
      ],
    },
  };
  const built = buildSourceQueries({ product: analysed, focusMotion: "communities" });
  const queries = built.map((q) => q.query);
  assert.equal(queries.length, 6, queries.join(" | "));
  // The analysed ones are marked so they can lead each round of the block.
  assert.deepEqual(built.map((q) => q.specific), [false, false, false, false, true, true]);
  assert.ok(queries.some((q) => q.startsWith("revenue operations consultants community")));
  assert.ok(
    queries
      .filter((q) => q.startsWith("revenue operations"))
      .every((q) => q.includes("community forum group")),
  );
});

test("Serper results are normalised and exact pages are deduplicated", () => {
  const candidates = normaliseSourceCandidates(
    [
      {
        organic: [
          { title: "One", link: "https://example.com/submit/", snippet: "A" },
          { title: "One duplicate", link: "https://www.example.com/submit", snippet: "B" },
          { title: "Two", link: "https://two.example/", snippet: "C" },
        ],
      },
    ],
    "directories",
  );
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].source, "serper");
  assert.equal(candidates[0].focusMotion, "directories");
  // Rank survives: it is how we tell a famous result from a buried one.
  assert.equal(candidates[0].position, 1);
  assert.equal(candidates[1].position, 3);
});

test("the model-facing candidate block has hard item and character caps", () => {
  const candidates = Array.from({ length: 100 }, (_, index) => ({
    title: `Candidate ${index}`,
    url: `https://candidate-${index}.example/${"x".repeat(600)}`,
    snippet: "s".repeat(600),
  }));
  const block = buildSourceCandidateBlock(candidates);
  assert.ok(block.length <= SOURCE_CANDIDATES_MAX_CHARS + 100);
  assert.ok(block.split("\n").length - 1 <= SOURCE_CANDIDATES_MAX_ITEMS);
});

test("every query is read to depth, one request per page", () => {
  const plan = sourceRequestPlan([
    { query: "alpha", specific: false },
    { query: "beta", specific: true },
  ]);
  assert.equal(plan.length, 2 * SOURCE_PAGES);
  assert.deepEqual(
    plan.filter((step) => step.query === "beta").map((step) => step.page),
    Array.from({ length: SOURCE_PAGES }, (_, index) => index + 1),
  );
  assert.ok(plan.filter((step) => step.query === "beta").every((step) => step.specific));
});

test("depth beyond the first page keeps counting up", () => {
  const [first, second] = normaliseSourceCandidates(
    [
      { query: "q", page: 1, response: { organic: [{ link: "https://a.example" }] } },
      { query: "q", page: 2, response: { organic: [{ link: "https://b.example" }] } },
    ],
    "directories",
  );
  // Serper restarts `position` at 1 on page two; the rank must not.
  assert.equal(first.rank, 1);
  assert.equal(second.position, 1);
  assert.equal(second.rank, 11);
});

test("the block gives every query a turn before any query gets seconds", () => {
  // Two queries, forty results each: in arrival order the cap of 45 would show
  // all of the first query and five of the second.
  const make = (query, specific) =>
    Array.from({ length: 40 }, (_, index) => ({
      title: `${query} ${index}`,
      url: `https://${query}-${index}.example`,
      snippet: "s",
      query,
      specific,
      rank: index + 1,
    }));
  const ordered = rankSourceCandidates([...make("broad", false), ...make("narrow", true)]);
  const firstTen = ordered.slice(0, 10);
  assert.equal(firstTen.filter((item) => item.query === "narrow").length, 5);
  assert.equal(firstTen.filter((item) => item.query === "broad").length, 5);
  // The product's own query leads.
  assert.equal(ordered[0].query, "narrow");
  const block = buildSourceCandidateBlock([...make("broad", false), ...make("narrow", true)]);
  const shown = block.split("\n").filter((line) => line.includes("narrow-")).length;
  assert.ok(shown >= 20, `narrow lines shown: ${shown}`);
});

test("a later run asks different questions and reads further down", () => {
  const rotating = {
    ...product,
    analysis: {
      searchQueries: ["alpha one", "beta two", "gamma three", "delta four", "epsilon five", "zeta six"],
    },
  };
  const asked = (round) =>
    buildSourceQueries({ product: rotating, focusMotion: "directories", round })
      .filter((entry) => entry.specific)
      .map((entry) => entry.query.split(" ")[0]);

  // The analysis writes six to eight queries and only three fit in a run, so
  // the first run used the first three every time — which is why the third run
  // over one product returned nought to two new channels a lane on 15 August
  // and dropped the rest as already known, at full price.
  assert.deepEqual(asked(0), ["alpha", "beta", "gamma"]);
  assert.deepEqual(asked(1), ["delta", "epsilon", "zeta"]);
  // Wraps rather than running dry.
  assert.deepEqual(asked(2), ["alpha", "beta", "gamma"]);

  // And it reads further down, where pages share no links with the ones above.
  assert.equal(sourceStartPage(0), 1);
  assert.equal(sourceStartPage(1), 3);
  // It stops descending: past five a niche query has usually run out, and an
  // empty page costs what a full one does.
  assert.equal(sourceStartPage(9), 5);

  const plan = sourceRequestPlan([{ query: "q", specific: true }], 2, 1);
  assert.deepEqual(plan.map((step) => step.page), [3, 4]);
});

test("a product with no analysed queries still searches, on templates alone", () => {
  const bare = buildSourceQueries({ product, focusMotion: "directories", round: 3 });
  assert.equal(bare.length, 3);
  assert.ok(bare.every((entry) => entry.specific === false));
});
