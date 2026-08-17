import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
/** Rules only: a comment explaining what was removed is not a use of it. */
const rules = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "");

// Every item below came out of the interface audit. They are the kind of
// defect that is invisible until somebody uses a keyboard or a screen reader,
// which is exactly why they survived for months — and why they are held by a
// test rather than by anyone's memory.

test("the site has a visible focus ring", () => {
  const css = read("app/globals.css");
  assert.ok(css.includes(":focus-visible{outline"), "no focus ring is defined");
  assert.equal(
    /outline:\s*(none|0)(?![^}]*:focus-visible)/.test(css.split(":focus-visible")[0]),
    false,
    "focus is removed before it is replaced",
  );
});

// `transition: .18s ease` with no property list animates every animatable
// property, including layout ones.
test("transitions name their properties", () => {
  const css = rules("app/globals.css");
  assert.equal(css.includes("transition:.18s"), false);
  assert.equal(css.includes("transition: all"), false);
  assert.equal(css.includes("transition:all"), false);
});

test("reduced motion is honoured for the whole site, not one component", () => {
  const css = read("app/globals.css");
  const rule = css.slice(0, css.indexOf(".signalist{"));
  assert.ok(
    rule.includes("@media(prefers-reduced-motion:reduce)"),
    "the global reduced-motion rule is gone",
  );
});

// The theme it belonged to was withdrawn; the stylesheet kept shipping it.
test("no dead theme rides along", () => {
  assert.equal(rules("app/globals.css").includes("chanlyst-editorial"), false);
});

test("both language switches report their state", () => {
  for (const file of [
    "app/components/public-header.tsx",
    "app/dashboard/signalist-dashboard.tsx",
  ]) {
    const source = read(file);
    assert.ok(source.includes("aria-pressed"), `${file} has no pressed state`);
    assert.ok(source.includes('role="group"'), `${file} has an unlabelled group`);
  }
});

test("a keyboard can get past the header", () => {
  assert.ok(read("app/home-screen.tsx").includes('className="skip-link"'));
  assert.ok(read("app/globals.css").includes(".skip-link:focus"));
});

test("the acquisition questions expose their selected answer", () => {
  const preview = read("app/components/acquisition-preview.tsx");
  assert.ok(preview.includes('role="radiogroup"'));
  assert.ok(preview.includes('role="radio"'));
  assert.ok(preview.includes("aria-checked={selectedAnswer === index}"));
});

test("the contact form can be filled by a browser", () => {
  const page = read("app/contact/page.tsx");
  for (const attribute of [
    'autoComplete="name"',
    'autoComplete="email"',
    'autoComplete="organization"',
    'inputMode="email"',
    "spellCheck={false}",
  ]) {
    assert.ok(page.includes(attribute), `the form is missing ${attribute}`);
  }
});

// It was cut from the marketing hero and survived where the owner sees it
// every day. The product is not an operating system.
test("nothing calls the product an OS", () => {
  for (const file of [
    "app/dashboard/signalist-dashboard.tsx",
    "app/home-screen.tsx",
  ]) {
    assert.equal(read(file).includes("Chanlyst OS"), false, file);
  }
});

// Decorative glyphs read aloud as "black circle" and "heavy check mark".
test("decorative glyphs are hidden from screen readers", () => {
  const home = read("app/home-screen.tsx");
  assert.ok(home.includes('<span aria-hidden="true">{icon}</span>'));
  assert.ok(home.includes('<span aria-hidden="true">✓</span>'));
  assert.ok(home.includes('<span aria-hidden="true">＋</span>'));
});

// The reducer's lazy initialiser runs once on the server and once in the
// browser. Anything random in it produces two different trees, and React
// reported it on every dashboard page: the sidebar links carried a product id
// that did not match. Nothing consumed the value — the create endpoint mints
// an id when the payload has none.
test("nothing random is generated while the dashboard renders", () => {
  const types = read("app/dashboard/types.ts");
  const blank = types.slice(
    types.indexOf("export const blankProduct"),
    types.indexOf("export const blankProduct") + 400,
  );

  assert.equal(blank.includes("crypto.randomUUID()"), false, "the blank product is random again");
  assert.ok(blank.includes('id: ""'), "the placeholder needs a stable id");

  // The randomUUIDs left in the dashboard both mint a message id, and both sit
  // inside an event handler — queueMessage, from the composer, and queueDraft,
  // from approving an outreach channel. Neither runs during render, which is
  // the property this guards; the count is only how it notices a new one.
  const dashboard = read("app/dashboard/signalist-dashboard.tsx");
  const calls = dashboard.split("crypto.randomUUID()").length - 1;
  assert.equal(calls, 2, "a new randomUUID appeared; check it is not in render");
  assert.ok(
    dashboard.includes("async function queueMessage("),
    "the one call belongs to queueMessage",
  );
});

// With no product there is nothing to point at, and "?product=" is a query
// string that says nothing.
test("the sidebar drops an empty product parameter", () => {
  const dashboard = read("app/dashboard/signalist-dashboard.tsx");
  assert.ok(dashboard.includes("const productParam = activeProduct.id"));

  // Only the links rendered on every page have to survive an empty
  // workspace. The one remaining unconditional interpolation runs after
  // discovery finishes, where a product certainly exists.
  assert.ok(dashboard.includes("const channelsHref = `${channelsPath}${productParam}`"));
  assert.ok(dashboard.includes("const productsHref = `${productsPath}${productParam}`"));
  assert.ok(dashboard.includes("resultsHref={`/dashboard/results${productParam}`}"));
});

// A bare `outline:0` on an element selector beats :focus-visible, so a single
// one of them switches the keyboard ring off for every input on the site.
test("nothing switches the outline off", () => {
  const css = rules("app/globals.css");
  for (const killer of ["outline:0", "outline: 0", "outline:none", "outline: none"]) {
    assert.equal(css.includes(killer), false, `${killer} is back`);
  }
});

// A tap that waits 300ms to see whether a second tap is coming feels broken,
// and every interactive element on the site was waiting.
test("taps do not wait for a second tap", () => {
  assert.ok(rules("app/globals.css").includes("touch-action:manipulation"));
});

// IndexNow authenticates by a file whose name is the key and whose contents
// are the same key. A mismatch is rejected silently, so it is worth a test
// rather than a memory.
// The key belongs to chanlyst.com and publish-oss.sh strips it: it does
// nothing on somebody else's server. A public clone therefore has no file to
// check, and the suite still has to pass there.
test("the IndexNow key file proves what it claims", (t) => {
  const file = readdirSync("public").find((name) => /^[0-9a-f]{32}\.txt$/.test(name));

  if (!file) {
    t.skip("the IndexNow key is ours and absent from public clones");
    return;
  }
  assert.equal(
    read(`public/${file}`).trim(),
    file.replace(/\.txt$/, ""),
    "the key file must contain exactly its own name",
  );
});

// The channel list sat in its loading skeleton for ever and every metric on
// the page showed an em dash, while the data was intact and the API answered
// 200. The loading flag compares the key of the response that arrived against
// the key of the request the screen wants; splitting channels from contacts
// added the record kind to one of those keys and not the other, so they could
// never match. Two copies of a format string is how that happens, so there is
// one copy now.
test("the leads request and the loading check share one key", () => {
  const source = read("app/dashboard/signalist-dashboard.tsx");

  const definitions = source.match(/const leadQueryKey = `/g) || [];
  assert.equal(definitions.length, 1, "leadQueryKey is assembled in more than one place");

  assert.ok(
    source.includes("const queryKey = leadQueryKey;"),
    "the fetch builds its own key again instead of reading the derived one",
  );
  assert.ok(
    source.includes("const recordKind = leadRecordKind;"),
    "the record kind is derived twice again",
  );
  // The key carries the record kind, which is the part that went missing.
  assert.ok(
    /const leadQueryKey = `\$\{activeId\}\|\$\{leadRecordKind\}\|/.test(source),
    "the comparison key no longer carries the record kind",
  );
});

// Switching sections was a full document load: every section was its own page
// rendering its own copy of the dashboard, reached through a plain <a href>.
// The server re-checked the session, the browser re-parsed 370KB of bundle and
// the fifteen requests this screen makes on mount went out again — on
// production the HTML alone took 1.2s before any of that began. Measured after
// the change: four switches cost two requests and no script re-parse.
test("the dashboard is mounted once and the section is a segment", () => {
  const layout = read("app/dashboard/layout.tsx");
  const router = read("app/dashboard/dashboard-router.tsx");

  // The session and the preview claim belong to the layout, which survives
  // navigation between the sections under it.
  assert.ok(layout.includes("getSessionFromCookieHeader"));
  assert.ok(layout.includes("<DashboardRouter"));
  assert.ok(router.includes("useSelectedLayoutSegment()"));

  // The old per-section shell is gone; a copy of it would bring the reloads
  // back without anything failing.
  assert.throws(
    () => read("app/dashboard/dashboard-shell.tsx"),
    "the per-section shell is back",
  );
});

test("section links navigate without loading a document", () => {
  const dashboard = read("app/dashboard/signalist-dashboard.tsx");

  assert.ok(dashboard.includes('import Link from "next/link"'), "Link is not imported");
  // Every sidebar entry that changes section has to be a Link. A plain <a>
  // among them is a full page load hiding in a list of instant ones.
  const plain = dashboard.match(/<a className=\{view === "[a-z]+" \? "active"/g) || [];
  assert.deepEqual(plain, [], `${plain.length} section links still reload the page`);
  const links = dashboard.match(/<Link className=\{view === "[a-z]+" \? "active"/g) || [];
  // Six sections plus Today. Contacts and Integrations were deliberately taken
  // out of the sidebar — the first because its companies belong under
  // Outreach, the second because it holds one button nobody needs to see
  // daily. The floor is here so that removing a section is a decision somebody
  // makes on purpose, not something that happens to a nav by accident.
  assert.ok(links.length >= 6, `only ${links.length} section links are client-side`);
});

// A page that renders nothing has nothing to render per request, and marking
// it dynamic stopped the router prefetching the segment.
test("the empty section pages are not forced dynamic", () => {
  for (const section of ["channels", "queue", "results", "integrations"]) {
    const page = read(`app/dashboard/${section}/page.tsx`);
    assert.equal(
      page.includes('dynamic = "force-dynamic"'),
      false,
      `${section} still forces a server round trip to render null`,
    );
    assert.ok(page.includes("return null;"), `${section} renders more than a segment`);
  }
});

test("the content language belongs to the workspace, not to a browser cookie", () => {
  const discover = readFileSync("app/api/discover/route.ts", "utf8");
  const outreach = readFileSync("app/api/outreach/route.ts", "utf8");
  const store = readFileSync("app/lib/prospect-store.ts", "utf8");
  const migration = readFileSync("drizzle/0039_content_locale.sql", "utf8");

  // Generation reads the workspace, never the request payload: a cron run has
  // no browser, and two browsers must not disagree about one workspace.
  assert.match(discover, /workspaceContentLocale\(workspaceId\)/);
  assert.doesNotMatch(discover, /locale: payload\.locale/);
  assert.match(outreach, /workspaceContentLocale\(auth\.workspaceId\)/);
  assert.doesNotMatch(outreach, /locale: payload\.locale/);

  // Every stored row records what it was written in, so a mixed list can be
  // found rather than merely noticed.
  assert.match(store, /content_locale/);
  assert.match(migration, /ALTER TABLE workspaces ADD COLUMN content_locale/);
  assert.match(migration, /ALTER TABLE prospects ADD COLUMN content_locale/);
});

test("switching the language tells the user what stayed behind", () => {
  const dashboard = readFileSync("app/dashboard/signalist-dashboard.tsx", "utf8");
  const strings = readFileSync("app/dashboard/i18n.ts", "utf8");
  assert.match(dashboard, /setLocaleApi\(nextLocale\)/);
  // Both languages carry the notice; a Russian-only string would be invisible
  // to exactly the account most likely to hit this.
  assert.match(strings, /staleLocale: "\{count\} на прежнем языке"/);
  assert.match(strings, /staleLocale: "\{count\} in the previous language"/);
  assert.match(dashboard, /staleContent > 0/);
});

test("a competitor is a suggestion until the user confirms it", () => {
  const analysis = readFileSync("app/lib/analysis-core.ts", "utf8");
  const panel = readFileSync("app/dashboard/sections/product-panel.tsx", "utf8");
  const strings = readFileSync("app/dashboard/i18n.ts", "utf8");

  // The model proposes into a strict schema field...
  assert.match(analysis, /competitors: \{/);
  assert.match(analysis, /"competitors",/);
  // ...and every proposal arrives unconfirmed.
  assert.match(analysis, /confirmed: false/);

  // The user confirms, removes or adds by hand, and a hand-typed one counts.
  assert.match(panel, /setCompetitors\(/);
  assert.match(panel, /confirmed: !row\.confirmed/);
  assert.match(panel, /confirmed: true/);

  // Both languages, or the notice is invisible to half the accounts.
  assert.match(strings, /competitorsHint:/);
  assert.match(strings, /competitorConfirm:/);
  for (const key of ["competitors:", "competitorsEmpty:", "competitorAdd:"]) {
    assert.equal(strings.split(key).length - 1, 2, key);
  }
});

test("where a placement stands is visible in the list, not only in the card", () => {
  const table = read("app/dashboard/sections/leads-table.tsx");

  // The four statuses and their buttons have always existed — inside the
  // channel card, which opens one channel at a time. Reading how many of
  // twenty places had been submitted to meant opening twenty cards, so nobody
  // marked anything and every counter read zero.
  assert.match(table, /function placementLabel/);
  assert.match(table, /className=\{`placement-tag \$\{lead\.placementStatus\}`\}/);

  // Read-only in the row: the row is itself a button, and an interactive
  // control inside one is invalid and ambiguous to click.
  const row = table.slice(table.indexOf("placement-tag"), table.indexOf("placement-tag") + 200);
  assert.doesNotMatch(row, /onClick/);
});

test("a forgotten locale falls towards English, and the pipeline asks the workspace", () => {
  const runner = read("app/lib/pipeline-runner.ts");

  // The workspace has owned the content language since 13 August. The pipeline
  // was still reading digest_settings — the weekly e-mail's language — and
  // falling back to Russian three times over when that row did not exist,
  // which it usually does not. Moving discovery into the pipeline therefore
  // gave an English account Russian channels again.
  assert.match(runner, /workspaceContentLocale/);
  assert.doesNotMatch(runner, /digest_settings WHERE workspace_id/);

  // Every caller passes a language; these defaults only decide which way a
  // mistake falls, and the product is English-first.
  for (const file of [
    "app/lib/discovery-batch.ts",
    "app/lib/discovery-core.ts",
    "app/lib/discovery-serper.ts",
    "app/lib/contact-discovery.ts",
  ]) {
    assert.doesNotMatch(read(file), /locale = "ru"/, file);
  }
});

test("a task that ends in a message opens the page that can write one", () => {
  const page = read("app/dashboard/signalist-dashboard.tsx");

  // The composer moved from Channels to Outreach: Channels answers "where do
  // we go", Outreach answers "what do we say". Two things that pointed at the
  // old address had to move with it, and neither would have failed loudly —
  // the user would just have arrived at a page with nowhere to type.
  assert.match(page, /const writing = task\.type === "follow_up" \|\| task\.type === "revive"/);
  assert.match(page, /const path = writing \? queuePath : channelsPath/);

  // The hash a deep link carries is only honoured on the route that owns it.
  const ids = page.slice(page.indexOf("sectionIdsByView"), page.indexOf("function scrollToSection"));
  assert.match(ids, /queue: \[[^\]]*"composer"/);
  assert.doesNotMatch(ids, /channels: \[[^\]]*"composer"/);
});

test("the contact list keeps its columns on rows without a Find contact button", () => {
  const css = read("app/globals.css");
  const row = css.match(/\.contacts-list article\{[^}]*\}/)?.[0] || "";

  // Every row is its own grid, so an `auto` last track is measured against
  // that row's own content — and the button only renders where an email still
  // needs research. Measured in the browser on 15 August, the rows with a
  // button put their description at x=622 and their email at x=1022 while the
  // rows without put them at 646 and 1085. A fixed track ends the argument.
  assert.match(row, /grid-template-columns:[^;]*\s124px;/);
  assert.doesNotMatch(row, /grid-template-columns:[^;]*\sauto;/);

  // And the cell itself is unconditional, so every row has the same shape.
  const section = read("app/dashboard/sections/contacts-section.tsx");
  assert.match(section, /<span className="contact-action">/);
});

test("a contact can be approved from the page that writes to it", () => {
  // The server refuses to send to a lead nobody approved — deliberately, since
  // a hidden button is guidance and not an authorisation boundary. But
  // contacts are not listed among the channels, so "approve it first" pointed
  // at a page that never showed them. On 16 August production held ten
  // contacts at status `review`, five of them with verified addresses, and no
  // control anywhere could move them.
  const section = read("app/dashboard/sections/contacts-section.tsx");
  assert.match(section, /approve\(lead\.id\)/);
  assert.match(section, /lead\.status === "approved"/);

  const page = read("app/dashboard/signalist-dashboard.tsx");
  assert.match(page, /approve=\{\(id\) => void updateLeadStatus\(id, "approved"\)\}/);

  // And the refusal says where to go, not only what is missing.
  assert.match(read("app/dashboard/gmail-failure.ts"), /in the list above/);
});

test("a generated draft only lands in the composer showing that lead", () => {
  const page = read("app/dashboard/signalist-dashboard.tsx");
  const fn = page.slice(page.indexOf("async function generateOutreach"));
  const body = fn.slice(0, fn.indexOf("\n  }\n"));

  // generateOutreach writes into shared composer state, and two callers reach
  // it for a lead nobody is looking at: approving a row generates that row's
  // draft, and clicking through the list quickly leaves an earlier request in
  // flight. On the live run of 15 August a letter written about MarketingDB
  // was sent to saasconsult.co — which had already had its own letter
  // thirty-three seconds earlier — while MarketingDB got none.
  const guard = body.indexOf("lead.id === selectedLeadIdRef.current");
  assert.ok(guard > 0, "the write is not guarded by the current selection");
  for (const setter of ["setSubject(", "setBody(", "setAppliedTemplateId("]) {
    assert.ok(body.indexOf(setter) > guard, `${setter} escapes the guard`);
  }
});

test("there is one way to start a run, and a different verb for going deeper", () => {
  const sources = read("app/dashboard/sections/sources-section.tsx");
  const table = read("app/dashboard/sections/leads-table.tsx");

  // "Find channels" sat next to the list and read like the way to begin, but it
  // runs discovery alone — it skips the direct-buyer half of the same question.
  // People pressed the nearer button, got half a result, and had no way to know
  // the other half existed. That is why Outreach was empty for weeks while the
  // step that fills it had simply never run.
  //
  // So before anything is found, both places start the whole pipeline; after
  // that the narrow search stays, under a name that means "more" rather than
  // "begin" — which it now genuinely is, since a repeat run rotates to the next
  // analysed queries and reads further down the results.
  assert.match(sources, /hasDiscovered \? \(/);
  assert.match(sources, /t\.searchDeeper/);
  assert.match(sources, /startPipeline\(\)/);
  assert.match(table, /startPipeline\(\)/);
  assert.doesNotMatch(table, /onClick=\{\(\) => void discover\(\)\}/);
});

test("a generated password hash survives docker compose reading it", () => {
  const generator = read("scripts/hash-password.mjs");
  const auth = read("app/lib/auth.ts");

  // The fields used to be separated by "$", the shape crypt(3) made familiar.
  // docker compose substitutes anything after a dollar in an env file, so the
  // hash reached the container with its last two fields replaced by empty
  // strings: the site came up, the migrations ran, and signing in returned 401
  // on a correct password. The CI job that walks the README's own quickstart
  // caught it on its first run.
  assert.match(generator, /pbkdf2:\$\{ITERATIONS\}:/);
  assert.doesNotMatch(generator, /pbkdf2\$\$\{ITERATIONS\}/);

  // Both separators keep parsing, so a hash generated before the change still
  // signs in and nobody has to regenerate one.
  assert.match(auth, /stored\.split\(\/\[\$:\]\/\)/);
});
