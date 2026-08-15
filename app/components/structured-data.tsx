import JsonLd from "./json-ld";
import { freePlan, planCatalog } from "../lib/plans";
import { FAQ } from "../lib/faq.mjs";
import { homepageGraph } from "../lib/structured-data.mjs";

/**
 * The homepage's structured data.
 *
 * A server component, deliberately: this has to be in the HTML the crawler is
 * handed, not added by a script it may never run.
 */
export default function StructuredData() {
  return <JsonLd data={homepageGraph({ freePlan, planCatalog, faq: FAQ.en })} />;
}
