import { useEffect, useMemo, useState } from "react";
import {
  OTHER_CHANNEL_TYPE,
  type ChannelMetrics,
  type ChannelStats,
} from "../../lib/channel-stats";
import {
  HEADLINE_METRICS,
  formatDelta,
  formatMetric,
  formatPercent,
  formatPeriod,
  highlightText,
  recentMonthLabels,
} from "../../lib/monthly-report.mjs";
import { engagementModeForLead } from "../../lib/engagement-mode";
import { fetchChannelAnalytics, fetchMonthlyReport } from "../api-client";
import type { Dictionary, Locale } from "../i18n";
import type {
  Lead,
  MonthlyReport,
  ProspectStage,
  ReportMetric,
} from "../types";

const engagementModes = ["free_listing", "paid_placement", "outreach"] as const;

type ModeKey = (typeof engagementModes)[number];

function formatRevenue(revenueCents: number, locale: Locale) {
  return `$${(revenueCents / 100).toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}`;
}

function MetricCells({
  metrics,
  locale,
}: {
  metrics: ChannelMetrics;
  locale: Locale;
}) {
  return (
    <>
      <td>{metrics.total}</td>
      <td>{metrics.contacted}</td>
      <td>{metrics.replied}</td>
      <td>{metrics.meetings}</td>
      <td>{metrics.converted}</td>
      <td>{formatRevenue(metrics.revenueCents, locale)}</td>
    </>
  );
}

// The engagement mode with the best conversion (converted / total). Modes
// with fewer than 3 leads or zero conversions never qualify, so a single
// lucky deal in a tiny sample does not get highlighted.
function bestConvertingMode(stats: ChannelStats): ModeKey | "" {
  let best: ModeKey | "" = "";
  let bestRate = 0;
  for (const mode of engagementModes) {
    const metrics = stats.modes[mode];
    if (metrics.total < 3 || metrics.converted === 0) continue;
    const rate = metrics.converted / metrics.total;
    if (rate > bestRate) {
      best = mode;
      bestRate = rate;
    }
  }
  return best;
}

function ChannelStatsBlock({
  t,
  locale,
  productId,
  refreshKey,
}: {
  t: Dictionary;
  locale: Locale;
  productId: string;
  refreshKey: number;
}) {
  const [stats, setStats] = useState<ChannelStats | null>(null);
  // Loading is derived (same pattern as the lead list): the placeholder shows
  // until the response for the current product/refresh combination arrives.
  const [loadedKey, setLoadedKey] = useState("");
  const requestKey = `${productId}|${refreshKey}`;
  const loaded = loadedKey === requestKey;
  useEffect(() => {
    if (!productId) return;
    const controller = new AbortController();
    const key = `${productId}|${refreshKey}`;
    fetchChannelAnalytics(productId, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setStats(data);
        setLoadedKey(key);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStats(null);
          setLoadedKey(key);
        }
      });
    return () => controller.abort();
  }, [productId, refreshKey]);

  const modeLabels: Record<ModeKey, string> = {
    free_listing: t.modeFreeListing,
    paid_placement: t.modePaidPlacement,
    outreach: t.modeOutreach,
  };
  const columns = [
    t.discovered,
    t.channelStatsContact,
    t.replied,
    t.meetings,
    t.customers,
    t.actualRevenue,
  ];
  const bestMode = stats ? bestConvertingMode(stats) : "";
  return (
    <div className="channel-stats">
      <div className="channel-stats-head">
        <strong>{t.channelStatsTitle}</strong>
        <p>{t.channelStatsHint}</p>
      </div>
      {!loaded ? (
        <p className="channel-stats-note">{t.channelStatsLoading}</p>
      ) : !stats || stats.totals.total === 0 ? (
        <p className="channel-stats-note">{t.channelStatsEmpty}</p>
      ) : (
        <div className="channel-stats-tables">
          <table>
            <thead>
              <tr>
                <th>{t.channelStatsMode}</th>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {engagementModes.map((mode) => (
                <tr key={mode} className={mode === bestMode ? "best" : ""}>
                  <th scope="row">
                    {modeLabels[mode]}
                    {mode === bestMode && <em> · {t.channelStatsBest}</em>}
                  </th>
                  <MetricCells metrics={stats.modes[mode]} locale={locale} />
                </tr>
              ))}
            </tbody>
          </table>
          {stats.channelTypes.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>{t.channelStatsType}</th>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.channelTypes.map((item) => (
                  <tr key={item.channelType}>
                    <th scope="row">
                      {item.channelType === OTHER_CHANNEL_TYPE
                        ? t.channelStatsOther
                        : item.channelType}
                    </th>
                    <MetricCells metrics={item} locale={locale} />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// The monthly report: read-only, one complete month at a time, every number
// coming straight from the API (which shares its builder with the e-mail).
function MonthlyReportBlock({
  t,
  locale,
  productId,
  refreshKey,
}: {
  t: Dictionary;
  locale: Locale;
  productId: string;
  refreshKey: number;
}) {
  // The last six complete months; the freshest one is the default.
  const periods: string[] = useMemo(() => recentMonthLabels(new Date(), 6), []);
  const [period, setPeriod] = useState(periods[0]);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const requestKey = `${productId}|${period}|${refreshKey}`;
  const loaded = loadedKey === requestKey;

  useEffect(() => {
    const controller = new AbortController();
    const key = `${productId}|${period}|${refreshKey}`;
    fetchMonthlyReport(period, productId, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setReport(data);
        setLoadedKey(key);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setReport(null);
          setLoadedKey(key);
        }
      });
    return () => controller.abort();
  }, [productId, period, refreshKey]);

  const metricLabels: Record<ReportMetric, string> = {
    found: t.discovered,
    contacted: t.channelStatsContact,
    replied: t.replied,
    meetings: t.meetings,
    customers: t.customers,
    revenueCents: t.actualRevenue,
    placementsPublished: t.placementSummaryPublished,
  };
  // HEADLINE_METRICS comes from the shared JS module, so the e-mail and the
  // dashboard lead with the same five numbers in the same order.
  const headline = HEADLINE_METRICS as ReportMetric[];
  const previousLabel =
    report && report.previousPeriod
      ? formatPeriod(report.previousPeriod.label, locale)
      : "";

  return (
    <div className="channel-stats monthly-report">
      <div className="channel-stats-head">
        <strong>{t.monthlyReportTitle}</strong>
        <p>{t.monthlyReportHint}</p>
        <label className="monthly-report-period">
          <span>{t.monthlyReportPeriod}</span>
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            {periods.map((item) => (
              <option key={item} value={item}>
                {formatPeriod(item, locale)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!loaded ? (
        <p className="channel-stats-note">{t.monthlyReportLoading}</p>
      ) : !report || !report.hasActivity ? (
        <p className="channel-stats-note">{t.monthlyReportEmpty}</p>
      ) : (
        <>
          <div className="monthly-report-numbers">
            {headline.map((metric) => {
              const change = report.changes ? report.changes[metric] : null;
              const direction = change ? change.direction : "flat";
              return (
                <article key={metric}>
                  <small>{metricLabels[metric]}</small>
                  <strong>{formatMetric(metric, report.totals[metric])}</strong>
                  <span className={`delta ${direction}`}>
                    {!change || direction === "flat"
                      ? "—"
                      : direction === "new"
                        ? `${formatDelta(metric, change)} · ${t.monthlyReportNew}`
                        : `${formatDelta(metric, change)} · ${formatPercent(change)}`}
                  </span>
                </article>
              );
            })}
          </div>
          {previousLabel && (
            <p className="channel-stats-note">
              {t.monthlyReportVs.replace("{period}", previousLabel)}
            </p>
          )}
          {report.revenuePerCustomerCents !== null && (
            <p className="channel-stats-note">
              {t.monthlyReportPerCustomer}:{" "}
              {formatRevenue(report.revenuePerCustomerCents, locale)}
            </p>
          )}
          {report.channelTypes.length > 0 && (
            <div className="channel-stats-tables">
              <table>
                <thead>
                  <tr>
                    <th>{t.channelStatsType}</th>
                    <th>{t.discovered}</th>
                    <th>{t.channelStatsContact}</th>
                    <th>{t.replied}</th>
                    <th>{t.customers}</th>
                    <th>{t.actualRevenue}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.channelTypes.map((row) => (
                    <tr key={row.channelType}>
                      <th scope="row">
                        {row.channelType === OTHER_CHANNEL_TYPE
                          ? t.channelStatsOther
                          : row.channelType}
                      </th>
                      <td>{row.found}</td>
                      <td>{row.contacted}</td>
                      <td>{row.replied}</td>
                      <td>{row.customers}</td>
                      <td>{formatRevenue(row.revenueCents, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {report.highlights.length > 0 && (
            <div className="monthly-report-highlights">
              <strong>{t.monthlyReportHighlights}</strong>
              <ul>
                {report.highlights.map((item) => (
                  <li key={`${item.kind}-${item.metric || item.channelType || ""}`}>
                    {highlightText(item, locale)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ResultsSection({
  t,
  locale,
  productId,
  analyticsRefreshKey,
  funnel,
  revenue,
  outcomeLeads,
  stageLabels,
  updateOutcome,
  patchOutcomeLead,
}: {
  t: Dictionary;
  locale: Locale;
  productId: string;
  analyticsRefreshKey: number;
  funnel: Array<{ label: string; value: number }>;
  revenue: number;
  outcomeLeads: Lead[];
  stageLabels: Record<ProspectStage, string>;
  updateOutcome: (
    id: string,
    stage: ProspectStage,
    revenueCents?: number,
    outcomeNote?: string,
    showToast?: boolean,
  ) => Promise<void>;
  patchOutcomeLead: (id: string, changes: Partial<Lead>) => void;
}) {
  return (
        <section className="panel conversion-panel" id="results">
          <div className="section-head">
            <div><div><h2>{t.funnelTitle}</h2><p>{t.funnelHint}</p></div></div>
            <strong>{funnel[5].value}</strong>
          </div>
          <div className="funnel-grid">
            {funnel.map((item, index) => (
              <article key={item.label}>
                <small>{item.label}</small>
                <strong>{item.value}</strong>
                <span>
                  {index === 0
                    ? "100%"
                    : `${Math.round((item.value / Math.max(1, funnel[0].value)) * 100)}%`}
                </span>
              </article>
            ))}
            <article className="revenue-card">
              <small>{t.actualRevenue}</small>
              <strong>${(revenue / 100).toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}</strong>
              <span>{t.customers}: {funnel[5].value}</span>
            </article>
          </div>
          {!outcomeLeads.length ? (
            <div className="empty horizontal"><span>◎</span><p>{t.outcomeEmpty}</p></div>
          ) : (
            <div className="outcome-list">
              {outcomeLeads.map((lead) => (
                <article key={lead.id} className={`outcome-row ${lead.stage}`}>
                  <span className={`avatar ${engagementModeForLead(lead)}`}>
                    {lead.company.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="outcome-company">
                    <div><strong>{lead.company}</strong><small>{lead.channelType}</small></div>
                    <p>{lead.domain}</p>
                  </div>
                  <div className="outcome-stage">
                    <span>{stageLabels[lead.stage]}</span>
                    <div>
                      <button onClick={() => updateOutcome(lead.id, "replied")}>{t.markReplied}</button>
                      <button onClick={() => updateOutcome(lead.id, "meeting")}>{t.markMeeting}</button>
                      <button className="won" onClick={() => updateOutcome(lead.id, "won")}>{t.markWon}</button>
                      <button className="lost" onClick={() => updateOutcome(lead.id, "lost")}>{t.markLost}</button>
                    </div>
                  </div>
                  <div className="outcome-fields">
                    <label>
                      <span>{t.revenue}</span>
                      <input
                        type="number"
                        min="0"
                        value={(lead.revenueCents || 0) / 100}
                        onChange={(event) => {
                          const revenueCents = Math.max(
                            0,
                            Math.round(Number(event.target.value || 0) * 100),
                          );
                          patchOutcomeLead(lead.id, { revenueCents });
                        }}
                        onBlur={(event) =>
                          updateOutcome(
                            lead.id,
                            lead.stage,
                            Math.max(0, Math.round(Number(event.target.value || 0) * 100)),
                          )
                        }
                      />
                    </label>
                    <label>
                      <span>{t.note}</span>
                      <input
                        value={lead.outcomeNote || ""}
                        onChange={(event) => {
                          const outcomeNote = event.target.value;
                          patchOutcomeLead(lead.id, { outcomeNote });
                        }}
                        onBlur={(event) =>
                          updateOutcome(lead.id, lead.stage, undefined, event.target.value)
                        }
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          )}
          <MonthlyReportBlock
            t={t}
            locale={locale}
            productId={productId}
            refreshKey={analyticsRefreshKey}
          />
          <ChannelStatsBlock
            t={t}
            locale={locale}
            productId={productId}
            refreshKey={analyticsRefreshKey}
          />
        </section>
  );
}
