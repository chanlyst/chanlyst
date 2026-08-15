// Applies pending drizzle/*.sql migrations to a local D1 sqlite file.
// For hosts without the sqlite3 CLI (uses node:sqlite, Node >= 22).
//
// Tracks applied migrations in a `chanlyst_migrations` table. On the first
// run against an existing database (no journal table yet, but application
// tables present) pass --baseline <prefix> to mark every migration up to and
// including that prefix as already applied without executing it, e.g.:
//
//   node deploy/apply-migrations.mjs /var/lib/chanlyst/state/.../db.sqlite \
//        --baseline 0015 ./drizzle
//
// Subsequent runs need no baseline:
//
//   node deploy/apply-migrations.mjs <db.sqlite> ./drizzle
//
// Stop the app (systemctl stop chanlyst) and back up the state directory
// before running against production.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const baselineIdx = args.indexOf("--baseline");
let baseline = "";
if (baselineIdx !== -1) {
  baseline = args[baselineIdx + 1] || "";
  args.splice(baselineIdx, 2);
}
const [dbPath, migrationsDir = "./drizzle"] = args;
if (!dbPath) {
  console.error(
    "usage: node apply-migrations.mjs <db.sqlite> [migrationsDir] [--baseline NNNN]",
  );
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec(`CREATE TABLE IF NOT EXISTS chanlyst_migrations (
  name text PRIMARY KEY NOT NULL,
  applied_at text NOT NULL
)`);

const applied = new Set(
  db
    .prepare("SELECT name FROM chanlyst_migrations")
    .all()
    .map((row) => row.name),
);

const files = readdirSync(migrationsDir)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

if (baseline) {
  for (const file of files) {
    if (file.slice(0, 4) > baseline) break;
    if (!applied.has(file)) {
      db.prepare(
        "INSERT INTO chanlyst_migrations (name, applied_at) VALUES (?, ?)",
      ).run(file, new Date().toISOString());
      applied.add(file);
      console.log(`baseline  ${file}`);
    }
  }
}

let ran = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const raw = readFileSync(join(migrationsDir, file), "utf8");
  const statements = raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  // PRAGMA foreign_keys cannot change inside a transaction, so run
  // rebuild-style migrations (which manage it themselves) without an
  // explicit wrapper; plain migrations get a transaction.
  const managesFk = /PRAGMA foreign_keys/i.test(raw);
  if (!managesFk) db.exec("BEGIN");
  try {
    for (const statement of statements) db.exec(statement);
    db.prepare(
      "INSERT INTO chanlyst_migrations (name, applied_at) VALUES (?, ?)",
    ).run(file, new Date().toISOString());
    if (!managesFk) db.exec("COMMIT");
  } catch (error) {
    if (!managesFk) db.exec("ROLLBACK");
    console.error(`FAILED   ${file}: ${error.message}`);
    process.exit(1);
  }
  console.log(`applied   ${file}`);
  ran += 1;
}

const check = db.prepare("PRAGMA foreign_key_check").all();
if (check.length > 0) {
  console.error(`foreign_key_check reported ${check.length} violations!`);
  process.exit(1);
}
console.log(ran ? `done: ${ran} migration(s) applied.` : "nothing to apply.");
