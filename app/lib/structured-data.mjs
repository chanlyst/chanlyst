// What the homepage tells machines about itself.
//
// A landing page says everything in prose: what the product is, what it costs,
// what it answers. A crawler has to guess at all of it. These three objects
// state the same facts in the vocabulary schema.org defines, so the guessing
// stops — and so an assistant answering "tools that find places to promote a
// SaaS" has something to quote other than our own marketing adjectives.
//
// Everything here is derived from data the app already serves: prices come out
// of the plan catalogue, questions out of the FAQ. Nothing is retyped, because
// a price that is right on the page and stale in the schema is worse than no
// schema at all.

export const SITE_URL = "https://chanlyst.com";

/** Who publishes the site. */
export function organizationSchema() {
  return {
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: "Chanlyst",
    url: SITE_URL,
    logo: `${SITE_URL}/favicon.svg`,
    description:
      "Chanlyst finds the places that already have a product's paying customers — directories, communities, creators, newsletters and partners — with the requirements, the price and a link to the source for each one.",
  };
}

/**
 * The product, and what it costs.
 *
 * Plans that are not open yet are left out: an offer is a claim that something
 * can be bought, and listing a coming-soon tier as purchasable is the kind of
 * small lie that costs trust in a rich result.
 */
export function softwareSchema({ freePlan, planCatalog }) {
  const paid = Object.values(planCatalog)
    .filter((plan) => plan.available)
    .map((plan) => ({
      "@type": "Offer",
      name: plan.name,
      price: String(plan.monthlyUsd),
      priceCurrency: "USD",
      category: "subscription",
      url: `${SITE_URL}/login`,
    }));

  return {
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#software`,
    name: "Chanlyst",
    url: SITE_URL,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web browser",
    publisher: { "@id": `${SITE_URL}/#organization` },
    description:
      "Describe a product and get a list of specific places to promote it: where to submit for free, where a placement is paid, and who to contact directly — each with its requirements and a link to the source.",
    offers: [
      {
        "@type": "Offer",
        name: freePlan.name,
        price: "0",
        priceCurrency: "USD",
        category: "free",
        description: `${freePlan.limits.channelsPerMonth} channels a month, no card required.`,
        url: `${SITE_URL}/login`,
      },
      ...paid,
    ],
  };
}

/** The questions on the page, in the form a machine can lift an answer from. */
export function faqSchema(entries) {
  return {
    "@type": "FAQPage",
    "@id": `${SITE_URL}/#faq`,
    mainEntity: entries.map(([question, answer]) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}

/**
 * A guide: the article itself, the trail that leads to it, and its questions.
 *
 * The breadcrumb is not decoration — it is what puts "chanlyst.com › Guides ›"
 * above the result instead of a bare URL, and it is the cheapest way for a page
 * three weeks old to look like part of a site rather than a stray document.
 */
export function guideGraph(guide) {
  const url = `${SITE_URL}/guides/${guide.slug}`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${url}#article`,
        headline: guide.h1,
        description: guide.description,
        url,
        // No author is claimed. An invented byline is the one piece of
        // structured data that is a lie rather than a shortcut.
        publisher: { "@id": `${SITE_URL}/#organization` },
        dateModified: guide.updated,
        inLanguage: "en",
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Chanlyst", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE_URL}/guides` },
          { "@type": "ListItem", position: 3, name: guide.h1, item: url },
        ],
      },
      { ...faqSchema(guide.faq), "@id": `${url}#faq` },
      organizationSchema(),
    ],
  };
}

/** The index, as a list a crawler can walk without following every link. */
export function guideIndexGraph(guides) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${SITE_URL}/guides#page`,
        name: "Guides",
        url: `${SITE_URL}/guides`,
        publisher: { "@id": `${SITE_URL}/#organization` },
        mainEntity: {
          "@type": "ItemList",
          itemListElement: guides.map((guide, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: guide.h1,
            url: `${SITE_URL}/guides/${guide.slug}`,
          })),
        },
      },
      organizationSchema(),
    ],
  };
}

/**
 * One graph rather than three separate script tags: the pieces reference each
 * other by @id, and a single document keeps those references resolvable.
 */
export function homepageGraph({ freePlan, planCatalog, faq }) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationSchema(),
      softwareSchema({ freePlan, planCatalog }),
      faqSchema(faq),
    ],
  };
}
