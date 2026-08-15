"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import ChanlystDashboard, { type DashboardView } from "./signalist-dashboard";

/**
 * Keeps the dashboard mounted while the section changes.
 *
 * Every section used to be its own page rendering its own copy of the whole
 * dashboard, reached through a plain <a href>. That made switching sections a
 * full document load: the server re-checked the session and re-read the
 * preview, the browser threw away the page and re-parsed 370KB of JavaScript,
 * React rebuilt the tree from nothing, and the fifteen requests the dashboard
 * makes on mount all went out again. On production the HTML alone took 1.2s
 * before any of that started.
 *
 * The section is a route segment, so it is read here instead. This component
 * lives in the layout, which survives navigation between its children — the
 * dashboard is mounted once and only its `view` changes, and <Link> turns each
 * switch into a small payload rather than a page load.
 */
const VIEWS = new Set<DashboardView>([
  "products",
  "channels",
  "contacts",
  "queue",
  "agent",
  "integrations",
  "billing",
  "results",
]);

export default function DashboardRouter({
  initialLocale,
  initialProductId,
}: {
  initialLocale: "en" | "ru";
  initialProductId: string;
}) {
  // Null at /dashboard itself. That used to be a section of its own — the
  // portfolio, a metrics strip, «Сегодня» and the launch checklist — but the
  // Products page grew the same portfolio and Channels grew the same metrics,
  // so what was left was a duplicate wrapped around two blocks. Both blocks
  // moved to the page that owns their subject, and /dashboard now lands on
  // Products. An unknown segment lands there too, rather than rendering
  // nothing.
  const segment = useSelectedLayoutSegment();
  const view: DashboardView =
    segment && VIEWS.has(segment as DashboardView)
      ? (segment as DashboardView)
      : "products";

  return (
    <ChanlystDashboard
      view={view}
      initialLocale={initialLocale}
      initialProductId={initialProductId}
    />
  );
}
