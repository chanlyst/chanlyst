// Read-only orphan check for the Chanlyst schema, for hosts without the
// sqlite3 CLI. Uses node:sqlite (Node >= 22, may need --experimental-sqlite).
//
// Usage: node --experimental-sqlite deploy/check-orphans.mjs /path/to/db.sqlite
import { DatabaseSync } from "node:sqlite";

const path = process.argv[2];
if (!path) {
  console.error("usage: node check-orphans.mjs /path/to/database.sqlite");
  process.exit(1);
}

const db = new DatabaseSync(path, { readOnly: true });

const CHECKS = [
  ["workspaces", "owner_user_id", "users", "id"],
  ["workspace_members", "workspace_id", "workspaces", "id"],
  ["workspace_members", "user_id", "users", "id"],
  ["workspace_integrations", "workspace_id", "workspaces", "id"],
  ["subscriptions", "workspace_id", "workspaces", "id"],
  ["sessions", "user_id", "users", "id"],
  ["sessions", "workspace_id", "workspaces", "id"],
  ["oauth_accounts", "user_id", "users", "id"],
  ["products", "workspace_id", "workspaces", "id"],
  ["prospects", "product_id", "products", "id"],
  ["prospects", "workspace_id", "workspaces", "id"],
  ["outbound_messages", "lead_id", "prospects", "id"],
  ["outbound_messages", "product_id", "products", "id", "c.product_id <> ''"],
  ["outbound_messages", "workspace_id", "workspaces", "id"],
  ["campaigns", "workspace_id", "workspaces", "id"],
  ["ai_usage", "workspace_id", "workspaces", "id"],
  ["ai_usage", "product_id", "products", "id", "c.product_id <> ''"],
  ["agent_schedules", "workspace_id", "workspaces", "id"],
  ["agent_runs", "workspace_id", "workspaces", "id"],
  ["outreach_sequences", "workspace_id", "workspaces", "id"],
  ["outreach_sequences", "product_id", "products", "id"],
  ["outreach_sequences", "lead_id", "prospects", "id"],
  ["outreach_events", "workspace_id", "workspaces", "id"],
  ["outreach_events", "sequence_id", "outreach_sequences", "id"],
  ["outreach_events", "lead_id", "prospects", "id"],
  ["suppression_list", "workspace_id", "workspaces", "id"],
];

const tables = new Set(
  db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => row.name),
);

let orphaned = 0;
for (const [child, childCol, parent, parentCol, extra = "1=1"] of CHECKS) {
  const label = `${child}.${childCol} -> ${parent}.${parentCol}`.padEnd(55);
  if (!tables.has(child) || !tables.has(parent)) {
    console.log(`${label} skipped (table missing)`);
    continue;
  }
  const { n } = db
    .prepare(
      `SELECT COUNT(*) AS n FROM "${child}" c
       LEFT JOIN "${parent}" p ON c."${childCol}" = p."${parentCol}"
       WHERE p."${parentCol}" IS NULL AND ${extra}`,
    )
    .get();
  console.log(`${label} ${n === 0 ? "ok" : `${n} ORPHANS`}`);
  if (n > 0) orphaned += n;
}

console.log(orphaned ? `\nTOTAL ORPHANS: ${orphaned}` : "\nAll clean.");
