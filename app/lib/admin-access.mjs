// Who may open the operator panel.
//
// Every other surface in this app is scoped to one workspace, and that scope is
// what keeps one customer's channels out of another's screen. The panel is the
// single place that reads across workspaces, so its gate is deliberately dull
// and lives outside the database: an allowlist in the server environment.
//
// Not a column, because a row is one bad UPDATE away from granting itself the
// panel. Not a constant in the repository, because the repository is pushed to
// a remote. `ADMIN_EMAILS` is set in /etc/chanlyst/chanlyst.env and nowhere
// else; where it is unset — every developer machine, every preview — the panel
// simply does not exist.
//
// The panel answers "how many, on what plan, still active" and never "what did
// they find". That boundary is in the queries, not here.

/**
 * @param {string | null | undefined} raw the ADMIN_EMAILS value: addresses
 *   separated by commas, spaces or newlines
 * @returns {string[]} lowercased addresses, empty when nothing is configured
 */
export function adminEmails(raw) {
  return String(raw || "")
    .split(/[,\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether this session may see the panel.
 *
 * An empty allowlist admits nobody. That is the important case: it is what a
 * misconfigured deploy looks like, and the safe reading of "no admins are
 * configured" is "no one is an admin" rather than "everyone is".
 *
 * @param {string | null | undefined} email the signed-in user's address
 * @param {string | null | undefined} raw the ADMIN_EMAILS value
 */
export function isAdminEmail(email, raw) {
  const list = adminEmails(raw);
  const candidate = String(email || "").trim().toLowerCase();
  if (!list.length || !candidate) return false;
  return list.includes(candidate);
}
