import type { Metadata } from "next";
import Link from "next/link";
import GuideShell from "../components/guide-shell";
import VisitBeacon from "../components/visit-beacon";
import { loadFound } from "../lib/found";

// The list is read from the production database on every request: a cached
// copy would eventually claim a number the database no longer agrees with,
// and the number is the whole point of the page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    absolute: "What Chanlyst found for itself — the full list, with terms",
  },
  description:
    "Every channel Chanlyst found for its own product, exactly as it sits in the database: the place, what it requires, what a placement costs where the price is published, and the status of every submission. No signup.",
  alternates: { canonical: "/found" },
};

export default async function FoundPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = (await searchParams) || {};
  const data = await loadFound();

  return (
    <GuideShell>
      <article className="legal-document guide found">
        <nav className="guide-crumbs" aria-label="Breadcrumb">
          <Link href="/">Chanlyst</Link>
          <span aria-hidden="true">›</span>
          <span>What it found</span>
        </nav>

        {!data ? (
          <>
            <h1>The list is not available right now</h1>
            <p className="guide-intro">
              This page publishes a live run out of the database rather than a
              stored copy, so when the database cannot be read there is nothing
              honest to put here. Try again shortly.
            </p>
          </>
        ) : (
          <>
            <h1>Chanlyst found {data.total} places for itself</h1>
            <p className="guide-intro">
              Here are all of them, exactly as they sit in the database — the
              same product finding channels for the same product that sells it.
              Every place, what it requires, what a placement costs where the
              price is published, and where a submission has got to.
            </p>
            <p className="guide-intro">
              Nothing is filtered to look better. Every one of these is
              explained — why it fits, and what the site says it is. Hard terms
              are rarer: {data.withRequirements} of {data.total} record what a
              submission requires and {data.withPrice} record a price. Where a
              term is missing the card says so.
            </p>

            <dl className="found-counts">
              <div>
                <dt>Places found</dt>
                <dd>{data.total}</dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>{data.submitted}</dd>
              </div>
              <div>
                <dt>Published</dt>
                <dd>{data.published}</dd>
              </div>
            </dl>

            {data.groups.map((group) => (
              <section key={group.key} className="found-group">
                <h2>
                  {group.label} <span>{group.channels.length}</span>
                </h2>
                <p className="found-note">{group.note}</p>
                <ul>
                  {group.channels.map((channel) => (
                    <li key={channel.id}>
                      <div className="found-head">
                        <h3>
                          {channel.url ? (
                            <a
                              href={channel.url}
                              rel="nofollow noopener external"
                              target="_blank"
                            >
                              {channel.name}
                            </a>
                          ) : (
                            channel.name
                          )}
                        </h3>
                        <span className="found-score">{channel.score}</span>
                      </div>
                      {channel.host && <p className="found-host">{channel.host}</p>}
                      {channel.siteTitle && (
                        <p className="found-site">{channel.siteTitle}</p>
                      )}
                      {channel.reason && <p>{channel.reason}</p>}
                      <dl className="found-terms">
                        {channel.terms.map(([label, value, missing]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd className={missing ? "found-missing" : ""}>
                              {value || missing}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <p className="found-meta">
                        {channel.placement && <b>{channel.placement}</b>}
                        {channel.doubtful && <span>relevance in question</span>}
                        {channel.checkedAt && <span>checked {channel.checkedAt}</span>}
                        {channel.submitUrl && (
                          <a
                            href={channel.submitUrl}
                            rel="nofollow noopener external"
                            target="_blank"
                          >
                            {channel.submitLabel}
                          </a>
                        )}
                        {channel.placementUrl && (
                          <a
                            href={channel.placementUrl}
                            rel="nofollow noopener external"
                            target="_blank"
                          >
                            the listing
                          </a>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {/* Said plainly, because it is the first objection: giving this
                away costs nothing. The value was never the list about us. */}
            <aside className="guide-cta">
              <h2>The same run, for your product</h2>
              <p>
                This list is worth reading and worth nothing to copy — it is the
                answer for one product, ours. Describe yours and get its own:
                ten channels a month free, no card.
              </p>
              <Link href="/login">Start free</Link>
            </aside>

            <p className="found-privacy">
              People are not published here. Outreach channels are listed as
              places with their public terms; the names, addresses and profiles
              held against them are excluded by the query that builds this page,
              not by the template that renders it.
            </p>
          </>
        )}
      </article>
      <VisitBeacon path="/found" params={query} />
    </GuideShell>
  );
}
