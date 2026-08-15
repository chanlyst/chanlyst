import { env } from "cloudflare:workers";
import {
  recordAiUsage,
  reportOpenRouterFailure,
  type OpenRouterUsage,
} from "./ai-usage";
import { getIntegrationSecret } from "./secret";
import { findContactPages } from "./contact-search";
import { safePublicUrl } from "./security-helpers.mjs";
import { fetchPublic } from "./fetch-public";
import {
  CONTACT_MARKUP_CHARS,
  LINK_SCAN_CHARS,
  buildPageEvidence,
  detectAffiliateNetwork,
  findConfidentEmail,
  planAffiliateHint,
} from "./contact-extract.mjs";
import { enrichmentBudget } from "./ai-cost.mjs";
import {
  collectOutputText,
  describeParseFailure,
  isTruncatedResponse,
  parseModelJson,
  shouldRetryForTruncation,
} from "./model-output.mjs";

// Contact enrichment, extracted out of app/api/contacts/enrich/route.ts. This
// is the expensive step (~$0.04–0.05 per contact when the model is needed), so
// both callers — the interactive route and the pipeline — go through here and
// through the same plan-quota check in their own entry points.

export type ProspectContext = {
  id: string;
  productId: string;
  company: string;
  domain: string;
  url: string;
  description: string;
  opportunityType: string;
  /** Whatever the row already proposes; never overwritten when non-empty. */
  nextAction?: string;
  productName: string;
  productDescription: string;
  audience: string;
};

export type EnrichmentOutcome =
  | {
      ok: true;
      contact: string;
      role: string;
      email: string;
      telegram: string;
      linkedin: string;
      contactStatus:
        | "verified_public"
        | "found_unverified"
        | "not_found"
        | "check_failed";
      contactSourceUrl: string;
      contactEvidence: string;
      /**
       * Set when the provider answered (and billed) but its answer could not
       * be parsed. "not_found" would be a lie here: nothing was checked.
       */
      modelError?: "unparsable_response" | "provider_error";
      /** Possibly rewritten by the affiliate-network hint; else unchanged. */
      nextAction: string;
      contactConfidence: number;
      contactCheckedAt: string;
    }
  | { ok: false; error: "ai_credits_exhausted"; status: 402 };

type ContactResult = {
  contactName?: string;
  role?: string;
  email?: string;
  telegram?: string;
  linkedin?: string;
  sourceUrl?: string;
  evidence?: string;
  confidence?: number;
};

/** Why the model produced nothing usable, when it produced nothing usable. */
type ModelError = "unparsable_response" | "provider_error";

/**
 * The answer shape, enforced by the provider instead of asked for in prose.
 * The prose ask survived as a description; the schema is what makes a
 * markdown- or prose-wrapped answer impossible in the first place.
 */
const contactSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    contactName: { type: "string" },
    role: { type: "string" },
    email: { type: "string" },
    telegram: { type: "string" },
    linkedin: { type: "string" },
    sourceUrl: { type: "string" },
    evidence: { type: "string" },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
  },
  required: [
    "contactName",
    "role",
    "email",
    "telegram",
    "linkedin",
    "sourceUrl",
    "evidence",
    "confidence",
  ],
} as const;

type OpenRouterResponse = {
  /** "completed" | "incomplete" | … — the truncation signal lives here. */
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output_text?: string;
  output?: Array<{
    type?: string;
    status?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: OpenRouterUsage;
};

/** The SELECT the enrichment step needs; shared so both callers agree. */
export const prospectContextQuery = `SELECT p.id, p.product_id as productId, p.company, p.domain, p.url,
       p.description, p.opportunity_type as opportunityType,
       p.next_action as nextAction,
       pr.name as productName, pr.description as productDescription,
       pr.audience
       FROM prospects p JOIN products pr ON pr.id=p.product_id
       WHERE p.id=? AND p.workspace_id=? AND pr.workspace_id=?`;

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

function parseJson(text: string) {
  return parseModelJson(text) as ContactResult;
}

type ConfidentContact = ReturnType<typeof findConfidentEmail>;

export async function officialEvidence(
  urlValue: string,
  budget = enrichmentBudget({}),
  /**
   * Contact pages Google has indexed for this domain, tried before the guessed
   * ones. A site that publishes its desk at /contact-saastr/ rather than
   * /contact is invisible to guessing, and guessing is all this had.
   */
  knownPages: string[] = [],
) {
  const empty = {
    text: "",
    emails: [] as string[],
    telegram: "",
    pages: [] as string[],
    confident: null as ConfidentContact,
    affiliate: null as ReturnType<typeof detectAffiliateNetwork>,
  };
  const initial = safePublicUrl(urlValue);
  if (!initial) return empty;
  const root = new URL("/", initial);
  const candidates = [
    initial,
    // Real URLs first: they are where the desk actually is. The guessed paths
    // stay behind them as the floor, because a domain too small to be indexed
    // returns none of these.
    ...knownPages
      .map((page) => safePublicUrl(page))
      .filter((url): url is URL => Boolean(url)),
    new URL("/contact", root),
    new URL("/about", root),
    new URL("/advertise", root),
    new URL("/partners", root),
  ];
  const unique = [...new Map(candidates.map((url) => [url.toString(), url])).values()];
  const fetchedPages: Array<{ url: string; html: string }> = [];
  let confident: ConfidentContact = null;
  for (const url of unique.slice(0, budget.maxPages)) {
    try {
      const fetched = await fetchPublic(url);
      if (!fetched || fetched.url.origin !== root.origin) continue;
      // Read up to the link-scan limit: the digest and the e-mail harvest slice
      // this down again, but the free regex pass over hrefs needs the tail.
      const html = (await fetched.response.text()).slice(0, LINK_SCAN_CHARS);
      const pageUrl = fetched.url.toString();
      fetchedPages.push({ url: pageUrl, html });
      // Stop crawling as soon as a page hands us a trustworthy contact.
      confident = findConfidentEmail({
        html: html.slice(0, CONTACT_MARKUP_CHARS),
        pageUrl,
        siteDomain: root.hostname,
      });
      if (confident) break;
    } catch {
      // A missing public page is not a fatal enrichment error.
    }
  }
  // Everything derived from the markup lives in one pure helper so the whole
  // path can be replayed offline against a fixture.
  const evidence = buildPageEvidence(fetchedPages, {
    siteDomain: root.hostname,
    digestChars: budget.digestChars,
    pageChars: budget.pageChars,
    maxEmails: budget.maxEmails,
  });
  return {
    ...evidence,
    emails: [
      ...new Set([...(confident ? [confident.email] : []), ...evidence.emails]),
    ].slice(0, budget.maxEmails),
    confident,
  };
}

/**
 * Enriches one prospect and persists the result on the row. Callers are
 * responsible for loading the prospect (see `prospectContextQuery`) and for
 * charging the plan quota before calling in.
 */
export async function runEnrichment(
  prospect: ProspectContext,
  ctx: { workspaceId: string },
): Promise<EnrichmentOutcome> {
  const db = database()!;
  const bindings = env as unknown as {
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;
    DISCOVERY_CLASSIFIER_MODEL?: string;
  };
  const budget = enrichmentBudget(bindings as unknown as Record<string, unknown>);
  // One Serper credit to learn where this site keeps its contact page. It only
  // ever adds candidates for the crawl below, so a failure costs nothing.
  const knownPages = await findContactPages({
    workspaceId: ctx.workspaceId,
    domain: prospect.domain,
  });
  const evidence = await officialEvidence(
    prospect.url || prospect.domain,
    budget,
    knownPages,
  );
  const apiKey =
    bindings.OPENROUTER_API_KEY ||
    (await getIntegrationSecret("openrouter", ctx.workspaceId));
  let found: ContactResult = {};
  /** Set when the provider billed us for an answer we could not read. */
  let modelError: ModelError | undefined;
  // Regex-first: a high-confidence official e-mail makes the LLM call
  // unnecessary, which is where nearly all of the per-contact cost sits.
  if (evidence.confident) {
    found = {
      role: evidence.confident.role,
      email: evidence.confident.email,
      sourceUrl: evidence.confident.sourceUrl,
      evidence: evidence.confident.evidence,
    };
  } else if (apiKey) {
    // With the site's own pages in hand the model is extracting, not
    // researching, and a small model extracts. The web_search tool put 12 000
    // input tokens of search results into every call at gpt-5.2 prices, which
    // is where $0.068 per contact came from — 87% of what a Starter
    // subscription costs to serve. It survives only for a site that gave us
    // nothing at all to read.
    const hasPages = Boolean(evidence.text);
    const model = hasPages
      ? bindings.DISCOVERY_CLASSIFIER_MODEL || "openai/gpt-5-mini"
      : bindings.OPENROUTER_MODEL || "openai/gpt-5.2";
    const input = `Найди лучший публичный деловой контакт для этой возможности.
Продукт пользователя: ${prospect.productName} — ${prospect.productDescription}
Целевая аудитория: ${prospect.audience}
Площадка или компания: ${prospect.company}
Домен: ${prospect.domain}
Тип возможности: ${prospect.opportunityType}
Описание: ${prospect.description}
Текст официальных страниц: ${evidence.text || "недоступен"}
Email, найденные на официальных страницах: ${evidence.emails.join(", ") || "нет"}

Используй только публичные деловые данные. Не придумывай email по шаблону.
Для каталога или медиа ищи partnerships, advertising, editorial или submissions.
Для direct_buyer ищи должность человека, принимающего решение, но не подставляй
email, если он явно не опубликован. Верни только JSON:
{"contactName":"","role":"","email":"","telegram":"","linkedin":"",
"sourceUrl":"URL страницы, подтверждающей контакт","evidence":"короткий найденный факт",
"confidence":0}`;

    const ask = (maxOutputTokens: number) =>
      fetch("https://openrouter.ai/api/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://chanlyst.com",
          "X-OpenRouter-Title": "Chanlyst",
        },
        body: JSON.stringify({
          model,
          reasoning: { effort: "low" },
          // The tool is only for the case Serper could not cover — no key, a
          // refusal, a timeout. When candidates arrived, paying the model to
          // search again is paying twice for the same page.
          ...(hasPages
            ? {}
            : {
                tools: [
                  {
                    type: "openrouter:web_search",
                    parameters: {
                      max_results: budget.maxResults,
                      max_total_results: budget.maxTotalResults,
                    },
                  },
                ],
                // Without this the search tool could be called until the model
                // felt like stopping; each call injects page excerpts.
                max_tool_calls: budget.maxToolCalls,
              }),
          input,
          text: {
            verbosity: "low",
            format: {
              type: "json_schema",
              name: "chanlyst_contact",
              strict: true,
              schema: contactSchema,
            },
          },
          max_output_tokens: maxOutputTokens,
        }),
      });

    /**
     * One attempt: bill it, try to read it, and say whether the provider cut
     * the answer off. Only a truncation signal earns the single retry — an
     * unconditional one would double the bill on every malformed answer.
     */
    const attempt = async (
      maxOutputTokens: number,
      isRetry: boolean,
    ): Promise<
      | { kind: "credits" }
      | { kind: "failed"; truncated: boolean; reason: ModelError }
      | { kind: "ok"; parsed: ContactResult }
    > => {
      const response = await ask(maxOutputTokens);
      if (!response.ok) {
        const failure = await reportOpenRouterFailure({
          response,
          operation: "contact_enrichment",
          workspaceId: ctx.workspaceId,
          productId: prospect.productId,
          model,
        });
        if (failure.creditsExhausted) return { kind: "credits" };
        return { kind: "failed", truncated: false, reason: "provider_error" };
      }
      const raw = (await response.json()) as OpenRouterResponse;
      const text = collectOutputText(raw);
      let parsed: ContactResult | null = null;
      let error: unknown;
      try {
        parsed = parseJson(text);
      } catch (thrown) {
        parsed = null;
        error = thrown;
      }
      const truncated = isTruncatedResponse(raw);
      await recordAiUsage({
        workspaceId: ctx.workspaceId,
        productId: prospect.productId,
        operation: "contact_enrichment",
        model,
        usage: raw.usage,
        // A billed attempt that will be retried is "retry", not "error": the
        // spend report must tell the two apart.
        outcome: parsed ? "ok" : truncated && !isRetry ? "retry" : "error",
        statusCode: response.status,
        response: raw,
      });
      if (parsed) return { kind: "ok", parsed };
      // Status, stop reason, truncation flag, sizes and the head of the text.
      // No headers, no key, never the whole body.
      console.error(
        describeParseFailure({
          operation: isRetry ? "contact_enrichment retry" : "contact_enrichment",
          statusCode: response.status,
          response: raw,
          text,
          error,
        }),
      );
      return { kind: "failed", truncated, reason: "unparsable_response" };
    };

    let outcome = await attempt(budget.maxOutputTokens, false);
    if (shouldRetryForTruncation(outcome)) {
      outcome = await attempt(budget.retryOutputTokens, true);
    }
    if (outcome.kind === "credits") {
      return { ok: false, error: "ai_credits_exhausted", status: 402 };
    }
    if (outcome.kind === "ok") found = outcome.parsed;
    else modelError = outcome.reason;
  }

  const email = String(found.email || evidence.emails[0] || "")
    .trim()
    .toLowerCase();
  const isOfficialEmail = Boolean(email && evidence.emails.includes(email));
  const telegram = String(found.telegram || evidence.telegram || "").trim();
  const linkedin = String(found.linkedin || "").trim();
  const hasContact = Boolean(email || telegram || linkedin || found.contactName);
  // A billed-but-unreadable answer is NOT "no public contact found": nothing
  // was checked. It gets its own status so the card can say so and offer a
  // retry instead of quietly closing the lead.
  const contactStatus = isOfficialEmail
    ? "verified_public"
    : hasContact
      ? "found_unverified"
      : modelError
        ? "check_failed"
        : "not_found";
  const confidence = Math.max(
    0,
    Math.min(
      isOfficialEmail ? 100 : 70,
      Math.round(Number(found.confidence) || (isOfficialEmail ? 90 : hasContact ? 55 : 0)),
    ),
  );
  const sourceUrl =
    safePublicUrl(String(found.sourceUrl || ""))?.toString() ||
    evidence.pages[0] ||
    prospect.url;
  const contact = [found.contactName, found.role].filter(Boolean).join(", ");
  const checkedAt = new Date().toISOString();

  // Dead end turned into a lead: no contact, but the outbound links run
  // through an affiliate network, so the route to this publisher is to
  // register as an advertiser there. next_action is only filled when empty —
  // anything the user wrote stays untouched.
  const affiliateHint = planAffiliateHint({
    hasContact,
    hint: evidence.affiliate,
    currentNextAction: prospect.nextAction || "",
  });
  const evidenceText = affiliateHint
    ? affiliateHint.contactEvidence
    : String(found.evidence || "").slice(0, 1000);

  await db
    .prepare(
      `UPDATE prospects SET contact=?, email=?, telegram=?, contact_role=?,
       linkedin=?, contact_status=?, contact_source_url=?, contact_evidence=?,
       contact_confidence=?, contact_checked_at=?, updated_at=?${
         affiliateHint?.nextAction ? ", next_action=?" : ""
       }
       WHERE id=? AND workspace_id=?`,
    )
    .bind(
      contact,
      email,
      telegram,
      String(found.role || "").slice(0, 300),
      linkedin,
      contactStatus,
      sourceUrl,
      evidenceText,
      confidence,
      checkedAt,
      checkedAt,
      ...(affiliateHint?.nextAction ? [affiliateHint.nextAction] : []),
      prospect.id,
      ctx.workspaceId,
    )
    .run();

  return {
    ok: true,
    contact,
    role: found.role || "",
    email,
    telegram,
    linkedin,
    contactStatus,
    contactSourceUrl: sourceUrl,
    contactEvidence: evidenceText,
    nextAction: affiliateHint?.nextAction || prospect.nextAction || "",
    contactConfidence: confidence,
    contactCheckedAt: checkedAt,
    ...(modelError ? { modelError } : {}),
  };
}
