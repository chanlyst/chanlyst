import assert from "node:assert/strict";
import test from "node:test";
import {
  diffSnapshots,
  termsSignature,
  snapshotFromPage,
  watchConditions,
} from "../app/lib/channel-watch.mjs";
import { planWatchTasks } from "../app/lib/lifecycle-rules.mjs";

const now = "2026-07-27T09:00:00.000Z";

/**
 * A realistic directory listing. Everything that legitimately churns between
 * two visits — the date, the view counter, the asset cache buster, the CSRF
 * token — is injected, so the tests can prove it does not read as a change.
 */
function listingPage({
  date = "2026-07-01",
  views = "1 240",
  cacheBuster = "a1b2c3",
  csrf = "9f8e7d6c5b4a3210",
  price = "Размещение: 1 000 ₽ в месяц",
  product = "https://myproduct.io/",
} = {}) {
  return `<html><head><title>Каталог сервисов</title>
    <link rel="stylesheet" href="/app.css?v=${cacheBuster}">
    <meta name="csrf-token" content="${csrf}"></head>
    <body><h1>Каталог сервисов</h1>
    <p>Обновлено ${date}, ${views} просмотров</p>
    <p>${price}</p>
    ${product ? `<a href="${product}">MyProduct</a>` : "<a href='/other'>Другое</a>"}
    </body></html>`;
}

function snapshot(page, statusCode = 200) {
  return snapshotFromPage({
    html: page,
    url: "https://directory.example/listing",
    statusCode,
    productDomain: "myproduct.io",
    productName: "MyProduct",
  });
}

/** A failed check, exactly as the runner stores one. */
function failure(statusCode = 0) {
  return snapshotFromPage({ html: "", url: "https://directory.example/listing", statusCode });
}

test("cosmetic churn does not change the content hash", () => {
  const before = snapshot(listingPage());
  const after = snapshot(
    listingPage({
      date: "2026-07-24",
      views: "9 981",
      cacheBuster: "zz99zz",
      csrf: "0011223344556677",
    }),
  );
  assert.equal(before.contentHash, after.contentHash);
  assert.notEqual(before.contentHash, "");
  assert.deepEqual(diffSnapshots(before, after), []);
});

test("a real edit does change the content hash", () => {
  const before = snapshot(listingPage());
  const after = snapshot(
    listingPage().replace("Каталог сервисов</h1>", "Каталог сервисов (закрыт)</h1>"),
  );
  assert.notEqual(before.contentHash, after.contentHash);
});

test("listing_gone fires when the product disappears or the page 404s", () => {
  const before = snapshot(listingPage());
  assert.equal(before.mentionsProduct, true);
  const after = snapshot(listingPage({ product: "" }));
  assert.equal(after.mentionsProduct, false);
  assert.deepEqual(
    diffSnapshots(before, after).map((finding) => finding.type),
    ["listing_gone"],
  );
  // A hard 404 is a finding even on the very first check.
  assert.deepEqual(
    diffSnapshots(null, failure(404)).map((finding) => finding.type),
    ["listing_gone"],
  );
});

test("terms_changed separates a real price move from pure formatting", () => {
  const before = snapshot(listingPage({ price: "Размещение: 1 000 ₽ в месяц" }));
  const reformatted = snapshot(
    listingPage({ price: "Размещение:&nbsp;1000&nbsp;₽/в месяц" }),
  );
  assert.equal(
    termsSignature(before.priceExcerpt),
    termsSignature(reformatted.priceExcerpt),
  );
  assert.equal(
    diffSnapshots(before, reformatted).some(
      (finding) => finding.type === "terms_changed",
    ),
    false,
  );

  const raised = snapshot(listingPage({ price: "Размещение: 3 500 ₽ в месяц" }));
  const findings = diffSnapshots(before, raised);
  assert.deepEqual(
    findings.map((finding) => finding.type),
    ["terms_changed"],
  );
  assert.match(findings[0].from, /1 000/);
  assert.match(findings[0].to, /3 500/);
});

test("page_unreachable needs two consecutive failures", () => {
  const before = snapshot(listingPage());
  assert.deepEqual(
    diffSnapshots(before, failure(503), { previousFailures: 0 }),
    [],
  );
  const second = diffSnapshots(before, failure(503), { previousFailures: 1 });
  assert.deepEqual(
    second.map((finding) => finding.type),
    ["page_unreachable"],
  );
  assert.equal(second[0].failures, 2);
  // A transport error is stored as status 0 and counts the same way.
  assert.deepEqual(
    diffSnapshots(before, failure(0), { previousFailures: 1 }).map(
      (finding) => finding.type,
    ),
    ["page_unreachable"],
  );
});

test("content_changed on its own creates no task", () => {
  const before = snapshot(listingPage());
  // Same price, same product link, different prose: informational only.
  const after = snapshot(
    listingPage().replace(
      "<h1>Каталог сервисов</h1>",
      "<h1>Каталог сервисов</h1><p>Мы обновили описание раздела.</p>",
    ),
  );
  const findings = diffSnapshots(before, after);
  assert.deepEqual(
    findings.map((finding) => finding.type),
    ["content_changed"],
  );
  const plan = planWatchTasks({
    now,
    lead: { id: "lead-1", workspaceId: "ws-1", productId: "product-1" },
    conditions: watchConditions({ previous: before, current: after, everMentioned: true }),
    tasks: [],
  });
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.close, []);
});

test("a monitoring task is created once and auto-closes when the listing returns", () => {
  const before = snapshot(listingPage());
  const gone = snapshot(listingPage({ product: "" }));
  const lead = { id: "lead-1", workspaceId: "ws-1", productId: "product-1" };

  const raised = planWatchTasks({
    now,
    lead,
    conditions: watchConditions({ previous: before, current: gone, everMentioned: true }),
    payloads: { listing_missing: { watchUrl: "https://directory.example/listing" } },
    tasks: [],
  });
  assert.deepEqual(
    raised.create.map((task) => task.type),
    ["listing_missing"],
  );
  assert.equal(raised.create[0].payload.watchUrl, "https://directory.example/listing");

  // Second run, still missing: the open task blocks a duplicate, and the
  // condition stays true even though the previous snapshot is now the gone one.
  const open = [
    { id: "task-1", leadId: "lead-1", type: "listing_missing", status: "open" },
  ];
  const again = planWatchTasks({
    now,
    lead,
    conditions: watchConditions({ previous: gone, current: gone, everMentioned: true }),
    tasks: open,
  });
  assert.deepEqual(again.create, []);
  assert.deepEqual(again.close, []);

  // The listing comes back: the task closes itself.
  const restored = planWatchTasks({
    now,
    lead,
    conditions: watchConditions({ previous: gone, current: before, everMentioned: true }),
    tasks: open,
  });
  assert.deepEqual(restored.create, []);
  assert.deepEqual(
    restored.close.map((task) => [task.id, task.reason]),
    [["task-1", "condition_cleared"]],
  );

  // An unreachable page says nothing about the listing, so nothing is touched.
  const blind = planWatchTasks({
    now,
    lead,
    conditions: watchConditions({
      previous: gone,
      current: failure(503),
      previousFailures: 0,
      everMentioned: true,
    }),
    tasks: open,
  });
  assert.deepEqual(blind.create, []);
  assert.deepEqual(blind.close, []);
});
