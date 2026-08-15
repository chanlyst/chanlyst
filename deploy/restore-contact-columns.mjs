// One-off recovery: copies the contact-enrichment column values lost in the
// 0020 FK rebuild from a pre-migration backup into the live database,
// matching prospects by id. Idempotent; only touches the seven columns.
// Usage: node restore-contact-columns.mjs <backup.sqlite> <live.sqlite>
import { DatabaseSync } from "node:sqlite";

const [backupPath, livePath] = process.argv.slice(2);
const backup = new DatabaseSync(backupPath, { readOnly: true });
const live = new DatabaseSync(livePath);

const rows = backup
  .prepare(
    `SELECT id, contact_role, linkedin, contact_status, contact_source_url,
            contact_evidence, contact_confidence, contact_checked_at
     FROM prospects
     WHERE contact_role <> '' OR linkedin <> ''
        OR contact_status <> 'not_checked' OR contact_source_url <> ''
        OR contact_evidence <> '' OR contact_confidence <> 0
        OR contact_checked_at IS NOT NULL`,
  )
  .all();

const update = live.prepare(
  `UPDATE prospects SET contact_role=?, linkedin=?, contact_status=?,
     contact_source_url=?, contact_evidence=?, contact_confidence=?,
     contact_checked_at=?
   WHERE id=?`,
);

let restored = 0;
live.exec("BEGIN");
for (const row of rows) {
  const result = update.run(
    row.contact_role,
    row.linkedin,
    row.contact_status,
    row.contact_source_url,
    row.contact_evidence,
    row.contact_confidence,
    row.contact_checked_at,
    row.id,
  );
  restored += Number(result.changes);
}
live.exec("COMMIT");
console.log(
  `backup rows with enrichment data: ${rows.length}, restored: ${restored}`,
);
