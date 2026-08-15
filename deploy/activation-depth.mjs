// How many channels a product goes through before anything happens.
//
// The free plan currently allows ten channels a month, and that ten was
// derived from what ten costs to serve ($0.46), not from what ten achieves. If
// the first published placement takes twenty submissions, nobody on the free
// plan ever reaches the moment the product proves itself, and the plan fails
// for a reason no pricing page can fix.
//
// This measures the distance rather than guessing it. Read-only, and it prints
// the sample size next to every number: on a young database most of these will
// be based on one or two products, and a small honest figure is worth more
// than a confident invented threshold.
//
// Usage: node deploy/activation-depth.mjs /path/to/database.sqlite

import { DatabaseSync } from "node:sqlite";

const path = process.argv[2];
if (!path) {
  console.error("usage: node deploy/activation-depth.mjs /path/to/database.sqlite");
  process.exit(1);
}

const db = new DatabaseSync(path, { readOnly: true });

/**
 * Channels discovered for a product before its first event of a given kind.
 *
 * "Before" is by discovery order, not by count: a product with forty channels
 * whose third one got published took three, not forty. Ordering by created_at
 * is what makes that distinction, and it is the whole measurement.
 */
function depthTo(condition, label) {
  // The condition is written against a `@` placeholder and bound to whichever
  // alias each subquery uses. Writing it against a fixed alias is how the
  // first version of this silently asked for a column that was not in scope.
  const on = (alias) => condition.replaceAll("@.", `${alias}.`);

  const rows = db
    .prepare(
      `SELECT p.id AS productId, p.name AS productName,
              (SELECT COUNT(*) FROM prospects e
                WHERE e.product_id = p.id
                  AND e.created_at <= (
                    SELECT MIN(f.created_at) FROM prospects f
                     WHERE f.product_id = p.id AND (${on("f")})
                  )
              ) AS depth,
              (SELECT COUNT(*) FROM prospects t WHERE t.product_id = p.id) AS total
         FROM products p
        WHERE EXISTS (
                SELECT 1 FROM prospects x
                 WHERE x.product_id = p.id AND (${on("x")})
              )`,
    )
    .all();

  if (!rows.length) {
    console.log(`\n${label}: no product has reached this yet.`);
    return null;
  }

  const depths = rows.map((row) => Number(row.depth)).sort((a, b) => a - b);
  const median = depths[Math.floor(depths.length / 2)];
  const worst = depths[depths.length - 1];

  console.log(`\n${label} — ${rows.length} product(s) reached it`);
  console.log(`  median ${median}, worst ${worst}, best ${depths[0]}`);
  for (const row of rows) {
    console.log(`  ${row.depth} of ${row.total}  ${row.productName}`);
  }
  return { median, worst, sample: rows.length };
}

console.log("Activation depth — channels discovered before the first…");

const submitted = depthTo("@.placement_status IN ('submitted','published')", "submission");
const replied = depthTo("@.replied_at IS NOT NULL", "reply");
const published = depthTo("@.placement_status = 'published'", "published placement");

// The same question per bucket: a free listing and an outreach contact are not
// the same amount of work, and a single free-plan limit has to cover whichever
// one the user's product actually depends on.
console.log("\nBy engagement mode, channels discovered in total:");
for (const row of db
  .prepare(
    `SELECT COALESCE(NULLIF(engagement_mode,''),'unclassified') AS mode,
            COUNT(*) AS channels,
            SUM(CASE WHEN placement_status IN ('submitted','published') THEN 1 ELSE 0 END) AS submitted,
            SUM(CASE WHEN placement_status = 'published' THEN 1 ELSE 0 END) AS published
       FROM prospects GROUP BY mode ORDER BY channels DESC`,
  )
  .all()) {
  console.log(
    `  ${String(row.mode).padEnd(16)} ${String(row.channels).padStart(5)} channels` +
      `  ${String(row.submitted).padStart(4)} submitted` +
      `  ${String(row.published).padStart(4)} published`,
  );
}

const totals = db
  .prepare(
    `SELECT (SELECT COUNT(*) FROM products) AS products,
            (SELECT COUNT(*) FROM prospects) AS channels`,
  )
  .get();

console.log(
  `\nSample: ${totals.products} product(s), ${totals.channels} channel(s) in the database.`,
);

const suggestion = published?.median ?? submitted?.median ?? null;
console.log(
  suggestion
    ? `\nSuggested free allowance: ${suggestion} channels a month — the median` +
      ` distance to the first result, from a sample of ${published?.sample ?? submitted?.sample}.` +
      ` Treat a single-digit sample as a direction, not a number.`
    : "\nNo product has produced a result yet, so there is no distance to measure." +
      " Leave the free allowance where it is until there is one.",
);
