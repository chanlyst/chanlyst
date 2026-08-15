import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  authBindings,
  authDatabase,
  getSessionFromCookieHeader,
} from "../lib/auth";
import { isAdminEmail } from "../lib/admin-access.mjs";
import { loadAdminStats } from "../lib/admin-stats";

export const dynamic = "force-dynamic";
// Nothing here should ever be indexed or cached by anything in front of it.
export const metadata = { robots: { index: false, follow: false } };

/** A date without the noise: "29 Jul, 15:17". */
function when(value?: string | null) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(parsed);
}

const usd = (value: number) =>
  value >= 10 ? `$${value.toFixed(0)}` : `$${value.toFixed(2)}`;

export default async function AdminPage() {
  const requestHeaders = await headers();
  const session = await getSessionFromCookieHeader(requestHeaders.get("cookie"));
  // A visitor who is not an admin gets the same answer as a visitor who
  // mistyped a URL. Telling them the page exists but is forbidden would be
  // telling them there is something here worth attacking.
  if (!session) notFound();

  const db = authDatabase();
  const account = await db
    ?.prepare(`SELECT email FROM users WHERE id = ?`)
    .bind(session.userId)
    .first<{ email?: string }>();
  const allowlist = (authBindings() as unknown as { ADMIN_EMAILS?: string })
    .ADMIN_EMAILS;
  if (!isAdminEmail(account?.email, allowlist)) notFound();

  const stats = await loadAdminStats();
  if (!stats) notFound();

  return (
    <main className="admin">
      <header>
        <h1>Operations</h1>
        <p>
          Counts only — no channel, contact or message content from other
          workspaces is read here.
        </p>
      </header>

      <section className="admin-totals">
        <article>
          <span>Accounts</span>
          <b>{stats.users}</b>
        </article>
        <article>
          <span>Workspaces</span>
          <b>{stats.workspaces}</b>
        </article>
        <article>
          <span>Paying</span>
          <b>{stats.paying}</b>
        </article>
        <article>
          <span>MRR</span>
          <b>{usd(stats.mrrUsd)}</b>
        </article>
        <article>
          <span>Model spend, 30 d</span>
          <b>{usd(stats.spendUsd30d)}</b>
        </article>
      </section>

      <section className="admin-traffic">
        <h2>
          Traffic, last {stats.visitDays} days
          <small>
            page views, not people — a reload counts again, and only visitors
            whose browser loads images are here
          </small>
        </h2>
        {stats.visitRows.length ? (
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Campaign</th>
                <th className="num">Landed</th>
                <th className="num">Reached sign-in</th>
                <th className="num">Step rate</th>
              </tr>
            </thead>
            <tbody>
              {stats.visitRows.map((row) => (
                <tr key={`${row.source}/${row.campaign}`}>
                  <td>{row.source || "direct"}</td>
                  <td>{row.campaign || "—"}</td>
                  <td className="num">{row.landed}</td>
                  <td className="num">{row.signIn}</td>
                  <td className="num">
                    {row.landed
                      ? `${Math.round((row.signIn / row.landed) * 100)}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="admin-empty">
            No visits recorded yet. If this stays empty while the ad runs, the
            migration that creates <code>site_visits</code> has not been applied.
          </p>
        )}
      </section>

      <section className="admin-traffic">
        <h2>
          On the page, last {stats.visitDays} days
          <small>
            no cookie, no third party — 0-2s is the accidental-tap bucket
          </small>
        </h2>
        {stats.dwellRows.length || stats.clickRows.length ? (
          <div className="admin-events">
            {(
              [
                ["Time on page", stats.dwellRows],
                ["Scrolled to", stats.scrollRows],
                ["Clicked", stats.clickRows],
              ] as const
            ).map(([title, rows]) => (
              <div key={title}>
                <h3>{title}</h3>
                {rows.length ? (
                  <ul>
                    {rows.map((row) => (
                      <li key={`${row.source}/${row.label}`}>
                        <span>{row.source || "direct"}</span>
                        <b>{title === "Scrolled to" ? `${row.label}%` : row.label}</b>
                        <i>{row.visits}</i>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="admin-empty">nothing yet</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="admin-empty">
            No page events yet. If this stays empty, the migration that creates{" "}
            <code>site_events</code> has not been applied.
          </p>
        )}
      </section>

      <section className="admin-table">
        <table>
          <thead>
            <tr>
              <th>Workspace</th>
              <th>Owner</th>
              <th>Signed up</th>
              <th>Plan</th>
              <th className="num">Products</th>
              <th className="num">Channels</th>
              <th>Last run</th>
              <th className="num">Spend</th>
            </tr>
          </thead>
          <tbody>
            {stats.workspaceRows.map((row) => (
              <tr key={row.id}>
                <td>{row.name || row.id}</td>
                <td>{row.ownerEmail || "—"}</td>
                <td>{when(row.createdAt)}</td>
                <td>
                  {row.plan ? (
                    <span className={`admin-plan ${row.subscriptionStatus}`}>
                      {row.plan} · {row.subscriptionStatus}
                    </span>
                  ) : (
                    <span className="admin-plan none">free</span>
                  )}
                </td>
                <td className="num">{row.products}</td>
                <td className="num">{row.channels}</td>
                <td>{when(row.lastRunAt)}</td>
                <td className="num">{usd(row.spendMicroUsd / 1_000_000)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
