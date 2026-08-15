import type { Metadata } from "next";
import Link from "next/link";
import GuideShell from "../components/guide-shell";
import JsonLd from "../components/json-ld";
import { GUIDES } from "../lib/guides.mjs";
import { guideIndexGraph } from "../lib/structured-data.mjs";

export const metadata: Metadata = {
  title: { absolute: "Guides — where to promote a product, and what each place requires" },
  description:
    "Practical guides to finding places that already have your paying customers: directories and what they require, launch platforms and what they are for, and where early adopters actually gather.",
  alternates: { canonical: "/guides" },
};

export default function GuidesIndex() {
  return (
    <GuideShell>
      <JsonLd data={guideIndexGraph(GUIDES)} />
      <article className="legal-document guide">
        <nav className="guide-crumbs" aria-label="Breadcrumb">
          <Link href="/">Chanlyst</Link>
          <span aria-hidden="true">›</span>
          <span>Guides</span>
        </nav>
        <h1>Guides</h1>
        <p className="legal-lead">
          Chanlyst finds places, so these are about places: which ones exist for
          a given kind of product, what each one asks for before it accepts you,
          and which are worth the afternoon. No list assembled from other lists.
        </p>
        <ul className="guide-index">
          {GUIDES.map((guide) => (
            <li key={guide.slug}>
              <Link href={`/guides/${guide.slug}`}>{guide.h1}</Link>
              <p>{guide.description}</p>
            </li>
          ))}
        </ul>
      </article>
    </GuideShell>
  );
}
