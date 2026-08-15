import { env } from "cloudflare:workers";
import {
  decryptSecret,
  encryptSecret,
  getIntegrationCredentials,
} from "../../../lib/secret";
import { isAuthResponse, requireApiSession } from "../../../lib/auth";
import {
  digestSettingsFor,
  type DigestLocale,
  type DigestSettings,
} from "../../../lib/digest";
import { engagementModeForLead } from "../../../lib/engagement-mode";
import { loadMonthlyReport } from "../../../lib/monthly-report-data";
import {
  defaultPeriodLabel,
  monthPeriod,
} from "../../../lib/monthly-report.mjs";
import {
  buildMonthlyReportBody,
  buildMonthlyReportSubject,
} from "../../../lib/monthly-report-email.mjs";
import {
  encodeMimeSubject,
  isValidEmail,
  timingSafeEqualStrings,
} from "../../../lib/security-helpers.mjs";
import {
  gmailFailure,
  gmailFailureHttpStatus,
  gmailResponseError,
} from "../../../lib/gmail-failure.mjs";

type DigestStats = {
  newProspects: number;
  freeListing: number;
  paidPlacement: number;
  outreach: number;
  emailsSent: number;
  replies: number;
  meetings: number;
  won: number;
  activeSequences: number;
  placementsPublished: number;
  placementsAwaitingCheck: number;
  /** Open lifecycle tasks waiting in the dashboard's "today" queue. */
  openTasks: number;
  /** Channels re-checked by the monitor in this window. */
  channelsChecked: number;
  /** Monitoring findings that became a task in this window. */
  channelFindings: number;
  /** New channels per monitored product ("niche monitoring") in the window. */
  monitoredProducts: Array<{ name: string; count: number }>;
};

type MonthlyReportStatus =
  | "not_due"
  | "sent"
  | "skipped_no_activity"
  | "no_recipient"
  | "error";

type WorkspaceResult = {
  workspaceId: string;
  status:
    | "sent"
    | "skipped_no_activity"
    | "gmail_not_connected"
    | "no_recipient"
    | "error";
  error?: string;
  statusCode?: number;
  /** Whether the monthly performance report went out on this run. */
  monthlyReport?: MonthlyReportStatus;
};

function bindings() {
  return env as unknown as {
    DB?: D1Database;
    AGENT_CRON_SECRET?: string;
    PUBLIC_BASE_URL?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
  };
}

function dashboardUrl(path = "/dashboard") {
  const base = bindings().PUBLIC_BASE_URL || "https://chanlyst.com";
  return new URL(path, base).toString();
}

function windowStart(settings: DigestSettings) {
  if (settings.lastSentAt) return settings.lastSentAt;
  return new Date(Date.now() - 7 * 86_400_000).toISOString();
}

function cadenceCutoff(cadence: "daily" | "weekly") {
  const days = cadence === "daily" ? 1 : 7;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Russian plural form: 1 канал, 2 канала, 5 каналов.
function pluralRu(count: number, forms: [string, string, string]) {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

async function gmailToken(workspaceId: string) {
  const db = bindings().DB!;
  const record = await db
    .prepare(
      `SELECT access_token as accessToken, refresh_token as refreshToken,
       expires_at as expiresAt FROM workspace_integrations
       WHERE workspace_id=? AND provider='gmail' AND status='connected'`,
    )
    .bind(workspaceId)
    .first<Record<string, unknown>>();
  if (!record) throw new Error("gmail_not_connected");
  const expiresAt = Date.parse(String(record.expiresAt || ""));
  if (expiresAt > Date.now() + 60_000) {
    return decryptSecret(String(record.accessToken || ""));
  }
  const refreshToken = await decryptSecret(String(record.refreshToken || ""));
  const saved = await getIntegrationCredentials("gmail_config", workspaceId);
  const clientId = bindings().GOOGLE_CLIENT_ID || saved.accessToken;
  const clientSecret = bindings().GOOGLE_CLIENT_SECRET || saved.refreshToken;
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("gmail_reconnect_required");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw await gmailResponseError(response, "refresh");
  const tokens = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };
  const expiry = new Date(
    Date.now() + (tokens.expires_in || 3600) * 1000,
  ).toISOString();
  await db
    .prepare(
      `UPDATE workspace_integrations SET access_token=?, expires_at=?,
       updated_at=? WHERE workspace_id=? AND provider='gmail'`,
    )
    .bind(
      await encryptSecret(tokens.access_token),
      expiry,
      new Date().toISOString(),
      workspaceId,
    )
    .run();
  return tokens.access_token;
}

async function gatherStats(
  workspaceId: string,
  since: string,
): Promise<DigestStats> {
  const db = bindings().DB!;
  const prospectRows = await db
    .prepare(
      `SELECT engagement_mode as engagementMode,
       opportunity_type as opportunityType, action_type as actionType,
       commercial_model as commercialModel,
       channel_type as channelType FROM prospects
       WHERE workspace_id=? AND created_at>?`,
    )
    .bind(workspaceId, since)
    .all<{
      engagementMode?: string;
      opportunityType?: string;
      actionType?: string;
      commercialModel?: string;
      channelType?: string;
    }>();
  const modes = { free_listing: 0, paid_placement: 0, outreach: 0 };
  for (const row of prospectRows.results) modes[engagementModeForLead(row)] += 1;
  const totals = await db
    .prepare(
      `SELECT
       (SELECT COUNT(*) FROM outbound_messages
        WHERE workspace_id=?1 AND status='sent' AND sent_at>?2) as emailsSent,
       (SELECT COUNT(*) FROM prospects
        WHERE workspace_id=?1 AND replied_at>?2) as replies,
       (SELECT COUNT(*) FROM prospects
        WHERE workspace_id=?1 AND meeting_at>?2) as meetings,
       (SELECT COUNT(*) FROM prospects
        WHERE workspace_id=?1 AND converted_at>?2) as won,
       (SELECT COUNT(*) FROM outreach_sequences
        WHERE workspace_id=?1 AND status='active') as activeSequences,
       (SELECT COUNT(*) FROM prospects
        WHERE workspace_id=?1 AND placement_status='published'
          AND placement_checked_at>?2) as placementsPublished,
       (SELECT COUNT(*) FROM prospects
        WHERE workspace_id=?1 AND placement_status='submitted'
          AND placement_submitted_at<=?3) as placementsAwaitingCheck,
       (SELECT COUNT(*) FROM lead_tasks
        WHERE workspace_id=?1 AND status='open') as openTasks,
       (SELECT COUNT(DISTINCT lead_id) FROM channel_snapshots
        WHERE workspace_id=?1 AND checked_at>?2) as channelsChecked,
       (SELECT COUNT(*) FROM lead_tasks
        WHERE workspace_id=?1 AND created_at>?2
          AND type IN ('listing_missing','terms_changed','channel_unreachable'))
        as channelFindings`,
    )
    // The PATCH handler stamps placement_checked_at on the transition to
    // 'published', so it is the "published in this window" timestamp.
    .bind(
      workspaceId,
      since,
      new Date(Date.now() - 5 * 86_400_000).toISOString(),
    )
    .first<Record<string, number>>();
  const monitored = await db
    .prepare(
      `SELECT pr.name as name, COUNT(*) as count FROM prospects p
       JOIN products pr ON pr.id=p.product_id AND pr.workspace_id=p.workspace_id
       WHERE p.workspace_id=? AND p.created_at>? AND pr.monitoring_enabled=1
       GROUP BY pr.id ORDER BY count DESC LIMIT 5`,
    )
    .bind(workspaceId, since)
    .all<{ name?: string; count?: number }>();
  return {
    newProspects: prospectRows.results.length,
    freeListing: modes.free_listing,
    paidPlacement: modes.paid_placement,
    outreach: modes.outreach,
    emailsSent: Number(totals?.emailsSent || 0),
    replies: Number(totals?.replies || 0),
    meetings: Number(totals?.meetings || 0),
    won: Number(totals?.won || 0),
    activeSequences: Number(totals?.activeSequences || 0),
    placementsPublished: Number(totals?.placementsPublished || 0),
    placementsAwaitingCheck: Number(totals?.placementsAwaitingCheck || 0),
    openTasks: Number(totals?.openTasks || 0),
    channelsChecked: Number(totals?.channelsChecked || 0),
    channelFindings: Number(totals?.channelFindings || 0),
    monitoredProducts: monitored.results.map((row) => ({
      name: String(row.name || ""),
      count: Number(row.count || 0),
    })),
  };
}

function buildSubject(stats: DigestStats, locale: DigestLocale) {
  if (locale === "ru") {
    const channels = `${stats.newProspects} ${pluralRu(stats.newProspects, ["новый канал", "новых канала", "новых каналов"])}`;
    const replies = `${stats.replies} ${pluralRu(stats.replies, ["ответ", "ответа", "ответов"])}`;
    return `Chanlyst: ${channels}, ${replies}`;
  }
  const channels = `${stats.newProspects} new ${stats.newProspects === 1 ? "channel" : "channels"}`;
  const replies = `${stats.replies} ${stats.replies === 1 ? "reply" : "replies"}`;
  return `Chanlyst: ${channels}, ${replies}`;
}

function buildBody(stats: DigestStats, locale: DigestLocale, since: string) {
  const date = since.slice(0, 10);
  // Kept short: only monitored products that actually got new channels.
  const monitoredLines = stats.monitoredProducts.length
    ? [
        locale === "ru" ? "Мониторинг ниши:" : "Niche monitoring:",
        ...stats.monitoredProducts.map(
          (item) =>
            `  ${item.name}: ${item.count} ${
              locale === "ru"
                ? pluralRu(item.count, ["новый канал", "новых канала", "новых каналов"])
                : item.count === 1
                  ? "new channel"
                  : "new channels"
            }`,
        ),
      ]
    : [];
  // The task queue is only worth a line when there is something in it.
  const taskLines =
    stats.openTasks > 0
      ? [
          locale === "ru"
            ? `Задач на сегодня: ${stats.openTasks}`
            : `Tasks waiting for you: ${stats.openTasks}`,
        ]
      : [];
  // Monitoring only earns a line when it actually found something: "0 changes"
  // every week is noise that teaches the reader to skip the digest.
  const watchLines =
    stats.channelFindings > 0
      ? [
          locale === "ru"
            ? `Проверено каналов: ${stats.channelsChecked}, изменений: ${stats.channelFindings}`
            : `Channels checked: ${stats.channelsChecked}, changes: ${stats.channelFindings}`,
        ]
      : [];
  if (locale === "ru") {
    return [
      `Дайджест Chanlyst с ${date}`,
      "",
      `Новые каналы: ${stats.newProspects}`,
      `  Бесплатные размещения: ${stats.freeListing}`,
      `  Платные размещения: ${stats.paidPlacement}`,
      `  Аутрич: ${stats.outreach}`,
      `Отправлено писем: ${stats.emailsSent}`,
      `Ответов: ${stats.replies}`,
      `Встреч: ${stats.meetings}`,
      `Новых клиентов: ${stats.won}`,
      `Активных цепочек аутрича: ${stats.activeSequences}`,
      `Опубликовано размещений: ${stats.placementsPublished}`,
      `Поданных заявок пора проверить (более 5 дней): ${stats.placementsAwaitingCheck}`,
      ...taskLines,
      ...watchLines,
      ...monitoredLines,
      "",
      `Открыть дашборд: ${dashboardUrl()}`,
    ].join("\n");
  }
  return [
    `Chanlyst digest since ${date}`,
    "",
    `New channels: ${stats.newProspects}`,
    `  Free listings: ${stats.freeListing}`,
    `  Paid placements: ${stats.paidPlacement}`,
    `  Outreach: ${stats.outreach}`,
    `Emails sent: ${stats.emailsSent}`,
    `Replies: ${stats.replies}`,
    `Meetings: ${stats.meetings}`,
    `New customers: ${stats.won}`,
    `Active outreach sequences: ${stats.activeSequences}`,
    `Placements published: ${stats.placementsPublished}`,
    `Submitted placements to check (older than 5 days): ${stats.placementsAwaitingCheck}`,
    ...taskLines,
    ...watchLines,
    ...monitoredLines,
    "",
    `Open the dashboard: ${dashboardUrl()}`,
  ].join("\n");
}

// The single sender: the weekly digest and the monthly report both go out
// through the workspace's connected Gmail account with the same MIME shape.
async function sendMail(
  workspaceId: string,
  recipient: string,
  subject: string,
  body: string,
) {
  const token = await gmailToken(workspaceId);
  const mime = [
    `To: ${recipient}`,
    `Subject: ${encodeMimeSubject(subject)}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: base64Url(mime) }),
    },
  );
  if (!response.ok) throw await gmailResponseError(response, "send");
}

// The monthly report is due once per calendar month: the report always
// covers the last complete month, so "already sent inside this month" is the
// whole de-duplication rule. last_report_sent_at is stamped whether the mail
// went out or was skipped for lack of activity, so a workspace can never be
// mailed twice — and a quiet month is not retried on every cron tick.
function monthlyReportDue(lastReportSentAt: string | null, now: Date) {
  const thisMonthStart = monthPeriod(
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
  ).start;
  return !lastReportSentAt || lastReportSentAt < thisMonthStart;
}

async function markReportSent(workspaceId: string) {
  const now = new Date().toISOString();
  await bindings()
    .DB!.prepare(
      `UPDATE digest_settings SET last_report_sent_at=?, updated_at=?
       WHERE workspace_id=?`,
    )
    .bind(now, now, workspaceId)
    .run();
}

/**
 * Sends the monthly performance report alongside the digest, on the first
 * cron run of a new month. Returns what happened so the cron response shows
 * it; a failure here never blocks the digest itself.
 */
async function sendMonthlyReport(
  workspaceId: string,
  settings: DigestSettings,
  now: Date,
): Promise<MonthlyReportStatus> {
  if (!monthlyReportDue(settings.lastReportSentAt, now)) return "not_due";
  const period = defaultPeriodLabel(now);
  const report = await loadMonthlyReport(bindings().DB!, workspaceId, {
    period,
    now,
  });
  if (!report.hasActivity) {
    // Nothing happened last month: stay quiet, but do not look again.
    await markReportSent(workspaceId);
    return "skipped_no_activity";
  }
  const recipient = await ownerEmail(workspaceId);
  if (!recipient) return "no_recipient";
  try {
    await sendMail(
      workspaceId,
      recipient,
      buildMonthlyReportSubject(report, settings.locale),
      buildMonthlyReportBody(
        report,
        settings.locale,
        dashboardUrl("/dashboard/results"),
      ),
    );
  } catch {
    return "error";
  }
  await markReportSent(workspaceId);
  return "sent";
}

async function markSent(workspaceId: string) {
  const now = new Date().toISOString();
  await bindings()
    .DB!.prepare(
      `INSERT INTO digest_settings
       (workspace_id, enabled, cadence, locale, last_sent_at, created_at, updated_at)
       VALUES (?, 0, 'weekly', 'ru', ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
       last_sent_at=excluded.last_sent_at, updated_at=excluded.updated_at`,
    )
    .bind(workspaceId, now, now, now)
    .run();
}

async function ownerEmail(workspaceId: string) {
  const row = await bindings()
    .DB!.prepare(
      `SELECT u.email FROM workspaces w
       JOIN users u ON u.id=w.owner_user_id WHERE w.id=?`,
    )
    .bind(workspaceId)
    .first<{ email?: string }>();
  const email = String(row?.email || "").trim();
  return isValidEmail(email) ? email : "";
}

async function processWorkspace(
  workspaceId: string,
  settings: DigestSettings,
  options: { skipWhenEmpty: boolean; withMonthlyReport: boolean },
): Promise<WorkspaceResult> {
  // The monthly report rides along with the cron digest, but it has its own
  // window and its own de-duplication, so it is decided first and never
  // depends on whether the digest itself had anything to say.
  let monthlyReport: MonthlyReportStatus | undefined;
  if (options.withMonthlyReport) {
    try {
      monthlyReport = await sendMonthlyReport(workspaceId, settings, new Date());
    } catch {
      monthlyReport = "error";
    }
  }
  const since = windowStart(settings);
  const stats = await gatherStats(workspaceId, since);
  const hasActivity =
    stats.newProspects > 0 ||
    stats.emailsSent > 0 ||
    stats.replies > 0 ||
    stats.meetings > 0 ||
    stats.won > 0 ||
    stats.activeSequences > 0 ||
    stats.placementsPublished > 0;
  if (options.skipWhenEmpty && !hasActivity) {
    // Advance the window anyway so the cron does not re-scan this range.
    await markSent(workspaceId);
    return { workspaceId, status: "skipped_no_activity", monthlyReport };
  }
  const recipient = await ownerEmail(workspaceId);
  if (!recipient) return { workspaceId, status: "no_recipient", monthlyReport };
  try {
    await sendMail(
      workspaceId,
      recipient,
      buildSubject(stats, settings.locale),
      buildBody(stats, settings.locale, since),
    );
  } catch (error) {
    const failure = gmailFailure(error, "digest_failed");
    if (failure.code === "gmail_not_connected") {
      return { workspaceId, status: "gmail_not_connected", monthlyReport };
    }
    return {
      workspaceId,
      status: "error",
      error: failure.code,
      statusCode: failure.statusCode,
      monthlyReport,
    };
  }
  await markSent(workspaceId);
  return { workspaceId, status: "sent", monthlyReport };
}

export async function POST(request: Request) {
  const db = bindings().DB;
  if (!db) return Response.json({ error: "database_unavailable" }, { status: 503 });
  const authorization = request.headers.get("authorization") || "";
  const isCron =
    Boolean(bindings().AGENT_CRON_SECRET) &&
    (await timingSafeEqualStrings(
      authorization,
      `Bearer ${bindings().AGENT_CRON_SECRET}`,
    ));

  if (!isCron) {
    // Manual "send now": sends for the session workspace regardless of the
    // due time or the enabled flag.
    const auth = await requireApiSession(request);
    if (isAuthResponse(auth)) return auth;
    const settings = await digestSettingsFor(auth.workspaceId);
    const result = await processWorkspace(auth.workspaceId, settings, {
      skipWhenEmpty: false,
      // "Send now" sends the digest only: the monthly report is a scheduled
      // artefact and must not be duplicated by a manual click.
      withMonthlyReport: false,
    });
    const status = result.status === "sent"
      ? 200
      : result.error?.startsWith("gmail_")
        ? gmailFailureHttpStatus(result.error)
        : 502;
    return Response.json({ ok: result.status === "sent", results: [result] }, { status });
  }

  const due = await db
    .prepare(
      `SELECT workspace_id as workspaceId, cadence, locale,
       last_sent_at as lastSentAt,
       last_report_sent_at as lastReportSentAt FROM digest_settings
       WHERE enabled=1 AND (last_sent_at IS NULL
         OR (cadence='daily' AND last_sent_at<=?)
         OR (cadence!='daily' AND last_sent_at<=?))
       ORDER BY last_sent_at ASC LIMIT 10`,
    )
    .bind(cadenceCutoff("daily"), cadenceCutoff("weekly"))
    .all<{
      workspaceId: string;
      cadence?: string;
      locale?: string;
      lastSentAt?: string | null;
      lastReportSentAt?: string | null;
    }>();
  const results: WorkspaceResult[] = [];
  for (const row of due.results) {
    const settings: DigestSettings = {
      enabled: true,
      cadence: row.cadence === "daily" ? "daily" : "weekly",
      locale: row.locale === "en" ? "en" : "ru",
      lastSentAt: row.lastSentAt || null,
      lastReportSentAt: row.lastReportSentAt || null,
    };
    try {
      results.push(
        await processWorkspace(row.workspaceId, settings, {
          skipWhenEmpty: true,
          withMonthlyReport: true,
        }),
      );
    } catch (error) {
      const failure = gmailFailure(error, "digest_failed");
      results.push({
        workspaceId: row.workspaceId,
        status: "error",
        error: failure.code,
        statusCode: failure.statusCode,
      });
    }
  }
  return Response.json({ ok: true, due: due.results.length, results });
}
