import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import GuideShell from "../../components/guide-shell";
import JsonLd from "../../components/json-ld";
import { GUIDES, guideBySlug } from "../../lib/guides.mjs";
import { guideGraph } from "../../lib/structured-data.mjs";

type Guide = (typeof GUIDES)[number];

/** Static params, so every guide is a real file rather than a rendered guess. */
export function generateStaticParams() {
  return GUIDES.map((guide: Guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) return {};

  return {
    // The title is absolute: the "· Chanlyst" suffix from the root template
    // eats the characters a result page actually shows, and on these pages the
    // brand is the least useful word available.
    title: { absolute: guide.title },
    description: guide.description,
    alternates: { canonical: `/guides/${guide.slug}` },
    openGraph: {
      type: "article",
      title: guide.title,
      description: guide.description,
      url: `/guides/${guide.slug}`,
      modifiedTime: guide.updated,
    },
    twitter: { card: "summary_large_image", title: guide.title, description: guide.description },
  };
}

const READABLE_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) notFound();

  const related = guide.related
    .map((other: string) => guideBySlug(other))
    .filter(Boolean) as Guide[];

  return (
    <GuideShell>
      <JsonLd data={guideGraph(guide)} />
      <article className="legal-document guide">
        <nav className="guide-crumbs" aria-label="Breadcrumb">
          <Link href="/">Chanlyst</Link>
          <span aria-hidden="true">›</span>
          <Link href="/guides">Guides</Link>
        </nav>
        <h1>{guide.h1}</h1>
        <p className="legal-updated">
          Last checked {READABLE_DATE.format(new Date(guide.updated))}
        </p>
        {guide.intro.map((paragraph: string) => (
          <p className="guide-intro" key={paragraph}>
            {paragraph}
          </p>
        ))}

        {guide.sections.map((section) => (
          <section key={section.h2}>
            <h2>{section.h2}</h2>
            {section.body?.map((paragraph: string) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.list && (
              <dl className="guide-list">
                {section.list.map(([term, detail]: [string, string]) => (
                  <div key={term}>
                    <dt>{term}</dt>
                    <dd>{detail}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        ))}

        <section>
          <h2>Questions</h2>
          <dl className="guide-list">
            {guide.faq.map(([question, answer]: string[]) => (
              <div key={question}>
                <dt>{question}</dt>
                <dd>{answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* The one piece of selling on the page, and it comes after the answer
            rather than instead of it. A guide that withholds its point until
            you sign up is the genre this is trying not to be. */}
        <aside className="guide-cta">
          <h2>Chanlyst does this part for you</h2>
          <p>
            Describe your product and get the specific places that already have
            your paying customers — what each one requires, what a placement
            costs where the price is published, and a link to the source. Ten
            channels a month free, no card.
          </p>
          <Link href="/login">Start free</Link>
        </aside>

        {related.length > 0 && (
          <section className="guide-related">
            <h2>Read next</h2>
            <ul>
              {related.map((other) => (
                <li key={other.slug}>
                  <Link href={`/guides/${other.slug}`}>{other.h1}</Link>
                  <span>{other.description}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </GuideShell>
  );
}
