import { authBindings, authDatabase } from "./auth";
import { foundSummary } from "./found-core.mjs";

// The query behind the public page.
//
// The column list is the privacy boundary, and it is a whitelist on purpose:
// contact, email, telegram, linkedin, contact_role, contact_status,
// contact_source_url, contact_evidence and contact_confidence are never
// selected, so no template change can start showing them and no reviewer has
// to remember that it must not. To publish a person somebody would have to
// come to this file and add a column, which is a decision rather than a slip.
//
// action_url is the one field that is loaded and then withheld: for a free
// listing or a paid placement it is a submission form or an advertise page,
// and for an outreach channel it is frequently a mailto: or a profile. It is
// published for the first two and dropped for the third, in found-core.

const COLUMNS = `id, company, domain, url, reason, score,
  engagement_mode AS engagementMode, commercial_model AS commercialModel,
  opportunity_type AS opportunityType, action_type AS actionType,
  channel_type AS channelType,
  pricing_summary AS pricingSummary,
  placement_requirements AS placementRequirements,
  usage_terms AS usageTerms,
  registration_url AS registrationUrl,
  action_url AS actionUrl,
  placement_status AS placementStatus,
  placement_url AS placementUrl,
  placement_checked_at AS placementCheckedAt,
  site_title AS siteTitle, relevance, updated_at AS updatedAt`;

/**
 * The product whose run is published.
 *
 * FOUND_PRODUCT_ID pins it, and in production it is set: everything else here
 * is a fallback for a database where it is not.
 *
 * The fallback matches on the website rather than on the workspace. It was the
 * other way round first — workspace-owner, which reads like the obvious home
 * for our own data — and on production that workspace holds an unrelated
 * product while Chanlyst's own entry lives in a different one. Selecting by
 * workspace would have published somebody else's run under a headline claiming
 * it was ours, which is a worse failure than an empty page.
 *
 * Matching the site's own domain is what makes it ours. A customer could in
 * principle enter chanlyst.com as their product's website, which is the reason
 * the binding exists and is set.
 */
async function showcaseProductId(db: D1Database) {
  const pinned = (authBindings() as unknown as { FOUND_PRODUCT_ID?: string })
    .FOUND_PRODUCT_ID;
  if (pinned) return pinned;

  const row = await db
    .prepare(
      `SELECT id FROM products
        WHERE website LIKE '%chanlyst.com%'
        ORDER BY updated_at DESC
        LIMIT 1`,
    )
    .first<{ id: string }>();
  return row?.id || "";
}

export type FoundData = ReturnType<typeof foundSummary> | null;

/**
 * Returns null when there is nothing honest to show — no database, no product,
 * no channels. The page renders an explanation in that case rather than a
 * headline claiming a number it does not have.
 */
export async function loadFound(): Promise<FoundData> {
  const db = authDatabase();
  if (!db) return null;

  try {
    const productId = await showcaseProductId(db);
    if (!productId) return null;

    const { results } = await db
      .prepare(
        // Scoped by product alone: product_id belongs to exactly one product,
        // and adding a workspace filter here is what made the first version
        // return nothing on production.
        `SELECT ${COLUMNS} FROM prospects WHERE product_id = ?1
         AND record_kind='channel'`,
      )
      .bind(productId)
      .all<Record<string, unknown>>();

    if (!results?.length) return null;
    return foundSummary(results);
  } catch {
    // A missing column on an older database must not take the marketing site
    // down; the page says the list is unavailable instead.
    return null;
  }
}
