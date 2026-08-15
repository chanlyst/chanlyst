import {
  HEADLINE_METRICS,
  OTHER_CHANNEL_TYPE,
  formatDelta,
  formatMetric,
  formatMoney,
  formatPercent,
  formatPeriod,
  highlightText,
  metricLabel,
} from "./monthly-report.mjs";

// Plain-text rendering of the monthly report for the digest e-mail. Pure
// formatting: every number already came out of buildMonthlyReport, so the
// e-mail can never disagree with the dashboard.

function padEnd(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function padStart(value, width) {
  const text = String(value);
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

/** Renders rows as a fixed-width table that survives a monospace mail client. */
function table(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, column) =>
    Math.max(...all.map((row) => String(row[column]).length)),
  );
  return all.map((row) =>
    row
      .map((cell, column) =>
        column === 0
          ? padEnd(cell, widths[column])
          : padStart(cell, widths[column]),
      )
      .join("  ")
      .trimEnd(),
  );
}

export function buildMonthlyReportSubject(report, locale) {
  const period = formatPeriod(report.period.label, locale);
  const { customers, revenueCents } = report.totals;
  if (locale === "en") {
    return `Chanlyst report for ${period}: ${customers} customers, ${formatMoney(revenueCents)}`;
  }
  return `Отчёт Chanlyst за ${period}: клиентов ${customers}, ${formatMoney(revenueCents)}`;
}

export function buildMonthlyReportBody(report, locale, reportUrl) {
  const ru = locale !== "en";
  const period = formatPeriod(report.period.label, locale);
  const previous = report.previousPeriod
    ? formatPeriod(report.previousPeriod.label, locale)
    : "";
  const lines = [
    ru
      ? `Отчёт Chanlyst за ${period}`
      : `Chanlyst performance report for ${period}`,
    "",
  ];
  if (previous) {
    // Nominative on both sides: Russian month names would have to decline
    // after a preposition, and a colon sidesteps that entirely.
    lines.push(
      ru ? `Предыдущий месяц: ${previous}` : `Compared with ${previous}`,
      "",
    );
  }
  // Five headline numbers, each with its change against the previous month.
  for (const metric of HEADLINE_METRICS) {
    const change = report.changes ? report.changes[metric] : null;
    const value = formatMetric(metric, report.totals[metric]);
    const suffix = change
      ? change.direction === "new"
        ? ru
          ? " (новое)"
          : " (new)"
        : change.delta === 0
          ? ""
          : ` (${formatDelta(metric, change)}${
              formatPercent(change) ? `, ${formatPercent(change)}` : ""
            })`
      : "";
    const name = metricLabel(metric, locale);
    lines.push(`${name.charAt(0).toUpperCase()}${name.slice(1)}: ${value}${suffix}`);
  }
  if (report.revenuePerCustomerCents !== null) {
    lines.push(
      ru
        ? `Выручка на клиента: ${formatMoney(report.revenuePerCustomerCents)}`
        : `Revenue per customer: ${formatMoney(report.revenuePerCustomerCents)}`,
    );
  }
  if (report.channelTypes.length) {
    lines.push(
      "",
      ru ? "По типам каналов:" : "By channel type:",
      ...table(
        [
          ru ? "Тип" : "Type",
          ru ? "Найдено" : "Found",
          ru ? "Контакты" : "Contacted",
          ru ? "Ответы" : "Replies",
          ru ? "Клиенты" : "Customers",
          ru ? "Выручка" : "Revenue",
        ],
        report.channelTypes.map((row) => [
          row.channelType === OTHER_CHANNEL_TYPE
            ? ru
              ? "Прочие"
              : "Other"
            : row.channelType,
          row.found,
          row.contacted,
          row.replied,
          row.customers,
          formatMoney(row.revenueCents),
        ]),
      ).map((line) => `  ${line}`),
    );
  }
  if (report.highlights.length) {
    lines.push(
      "",
      ru ? "Главное:" : "Highlights:",
      ...report.highlights.map((item) => `  - ${highlightText(item, locale)}`),
    );
  }
  lines.push(
    "",
    ru ? `Открыть отчёт: ${reportUrl}` : `Open the report: ${reportUrl}`,
  );
  return lines.join("\n");
}
