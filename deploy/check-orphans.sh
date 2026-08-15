#!/bin/sh
# Reports orphaned rows for every logical foreign-key relationship in the
# Chanlyst schema. Read-only: runs SELECT COUNT(*) only. Run it against the
# production D1 sqlite file before attempting the foreign-key migration.
#
# Usage: sh deploy/check-orphans.sh /path/to/database.sqlite
set -eu

DB="${1:?usage: sh deploy/check-orphans.sh /path/to/database.sqlite}"

table_exists() {
  [ "$(sqlite3 "$DB" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='$1';")" = "1" ]
}

check() {
  child="$1" child_col="$2" parent="$3" parent_col="$4" extra="${5:-1=1}"
  if ! table_exists "$child" || ! table_exists "$parent"; then
    printf '%-55s skipped (table missing)\n' "$child.$child_col -> $parent.$parent_col"
    return
  fi
  count=$(sqlite3 "$DB" "
    SELECT COUNT(*) FROM \`$child\` c
    LEFT JOIN \`$parent\` p ON c.\`$child_col\` = p.\`$parent_col\`
    WHERE p.\`$parent_col\` IS NULL AND $extra;")
  if [ "$count" = "0" ]; then
    printf '%-55s ok\n' "$child.$child_col -> $parent.$parent_col"
  else
    printf '%-55s %s ORPHANS\n' "$child.$child_col -> $parent.$parent_col" "$count"
  fi
}

echo "Orphan check for $DB"
echo

# workspace ownership
check workspaces owner_user_id users id
check workspace_members workspace_id workspaces id
check workspace_members user_id users id
check workspace_integrations workspace_id workspaces id
check subscriptions workspace_id workspaces id

# auth
check sessions user_id users id
check sessions workspace_id workspaces id
check oauth_accounts user_id users id

# product data (empty string means "not linked", not a reference)
check products workspace_id workspaces id
check prospects product_id products id
check prospects workspace_id workspaces id
check outbound_messages lead_id prospects id
check outbound_messages product_id products id "c.product_id <> ''"
check outbound_messages workspace_id workspaces id
check campaigns workspace_id workspaces id
check ai_usage workspace_id workspaces id
check ai_usage product_id products id "c.product_id <> ''"

# background agent + outreach engine
check agent_schedules workspace_id workspaces id
check agent_runs workspace_id workspaces id
check outreach_sequences workspace_id workspaces id
check outreach_sequences product_id products id
check outreach_sequences lead_id prospects id
check outreach_events workspace_id workspaces id
check outreach_events sequence_id outreach_sequences id
check outreach_events lead_id prospects id
check suppression_list workspace_id workspaces id
