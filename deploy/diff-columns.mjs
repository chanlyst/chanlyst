// Compares table columns between two sqlite files (old vs new) and reports
// columns present in old but missing in new. Read-only.
// Usage: node diff-columns.mjs <old.sqlite> <new.sqlite>
import { DatabaseSync } from "node:sqlite";

const [oldPath, newPath] = process.argv.slice(2);
const oldDb = new DatabaseSync(oldPath, { readOnly: true });
const newDb = new DatabaseSync(newPath, { readOnly: true });

const tables = oldDb
  .prepare(
    `SELECT name FROM sqlite_master WHERE type='table'
     AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%'`,
  )
  .all()
  .map((row) => row.name);

let problems = 0;
for (const table of tables) {
  const oldCols = oldDb
    .prepare(`SELECT name FROM pragma_table_info(?)`)
    .all(table)
    .map((row) => row.name);
  let newCols = [];
  try {
    newCols = newDb
      .prepare(`SELECT name FROM pragma_table_info(?)`)
      .all(table)
      .map((row) => row.name);
  } catch {
    // table missing entirely
  }
  const missing = oldCols.filter((c) => !newCols.includes(c));
  if (missing.length) {
    problems += missing.length;
    console.log(`${table}: MISSING ${missing.join(", ")}`);
  }
}
console.log(problems ? `TOTAL MISSING: ${problems}` : "No missing columns.");
