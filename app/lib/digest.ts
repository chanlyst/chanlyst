import { env } from "cloudflare:workers";

export type DigestCadence = "daily" | "weekly";
export type DigestLocale = "ru" | "en";

export type DigestSettings = {
  enabled: boolean;
  cadence: DigestCadence;
  locale: DigestLocale;
  lastSentAt: string | null;
  /** When the monthly performance report was last e-mailed (once a month). */
  lastReportSentAt: string | null;
};

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

export async function digestSettingsFor(
  workspaceId: string,
): Promise<DigestSettings> {
  const db = database();
  const record = db
    ? await db
        .prepare(
          `SELECT enabled, cadence, locale, last_sent_at as lastSentAt,
           last_report_sent_at as lastReportSentAt
           FROM digest_settings WHERE workspace_id=?`,
        )
        .bind(workspaceId)
        .first<Record<string, unknown>>()
    : null;
  return {
    enabled: Boolean(record?.enabled),
    cadence: record?.cadence === "daily" ? "daily" : "weekly",
    locale: record?.locale === "en" ? "en" : "ru",
    lastSentAt: record?.lastSentAt ? String(record.lastSentAt) : null,
    lastReportSentAt: record?.lastReportSentAt
      ? String(record.lastReportSentAt)
      : null,
  };
}
