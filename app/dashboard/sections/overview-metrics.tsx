import type { Dictionary, Locale } from "../i18n";

/**
 * The five numbers that answer "how am I doing" for the active product. Every
 * value is derived from data the workspace page already loaded (the lead
 * counters and the funnel list), so the strip adds no request of its own.
 * While the lead request is in flight the values render as "—"; a real zero
 * renders as 0.
 */
export default function OverviewMetrics({
  t,
  locale,
  loading,
  found,
  inWork,
  replies,
  customers,
  revenueCents,
  resultsHref,
}: {
  t: Dictionary;
  locale: Locale;
  loading: boolean;
  found: number;
  inWork: number;
  replies: number;
  customers: number;
  revenueCents: number;
  resultsHref: string;
}) {
  // Money is formatted exactly like the funnel card on the results page.
  const money = `$${(revenueCents / 100).toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}`;
  const tiles: Array<{ label: string; value: string; href?: string }> = [
    { label: t.overviewFound, value: String(found) },
    { label: t.overviewInWork, value: String(inWork) },
    { label: t.overviewReplies, value: String(replies) },
    { label: t.overviewCustomers, value: String(customers), href: resultsHref },
    { label: t.overviewRevenue, value: money, href: resultsHref },
  ];

  return (
    <section className="metrics-strip" aria-label={t.overviewMetricsTitle}>
      {tiles.map((tile) => {
        const body = (
          <>
            <small>{tile.label}</small>
            <strong>{loading ? "—" : tile.value}</strong>
          </>
        );
        return tile.href ? (
          <a key={tile.label} className="metric-tile link" href={tile.href}>
            {body}
          </a>
        ) : (
          <article key={tile.label} className="metric-tile">
            {body}
          </article>
        );
      })}
    </section>
  );
}
