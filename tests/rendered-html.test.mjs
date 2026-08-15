import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("build contains the complete Chanlyst workflow", async () => {
  // home-screen.tsx holds the marketing markup; page.tsx is only the server
  // wrapper that records the visit before rendering it.
  const marketing = await readFile(
    new URL("../app/home-screen.tsx", import.meta.url),
    "utf8",
  );
  // The dashboard is split into modules; combine them so the workflow
  // assertions below keep covering the whole dashboard surface.
  const page = (
    await Promise.all(
      [
        "../app/dashboard/signalist-dashboard.tsx",
        "../app/dashboard/page.tsx",
        "../app/dashboard/products/page.tsx",
        "../app/dashboard/i18n.ts",
        "../app/dashboard/types.ts",
        "../app/dashboard/api-client.ts",
        "../app/dashboard/workspace-state.ts",
        "../app/dashboard/sections/product-panel.tsx",
        "../app/dashboard/sections/sources-section.tsx",
        "../app/dashboard/sections/overview-metrics.tsx",
        "../app/dashboard/sections/launch-checklist.tsx",
        "../app/dashboard/sections/today-section.tsx",
        "../app/dashboard/sections/leads-table.tsx",
        "../app/dashboard/sections/composer.tsx",
        "../app/dashboard/sections/queue-section.tsx",
        "../app/dashboard/sections/results-section.tsx",
        "../app/dashboard/sections/agent-section.tsx",
        "../app/dashboard/sections/integrations-section.tsx",
        "../app/dashboard/sections/billing-section.tsx",
        "../app/dashboard/sections/new-product-form.tsx",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    )
  ).join("\n");
  // The search itself was extracted into app/lib/discovery-core.ts so the
  // route, the background agent and the preparation pipeline share it; the
  // assertions below cover the route and that core together.
  const discover = (
    await Promise.all(
      [
        "../app/api/discover/route.ts",
        "../app/lib/discovery-core.ts",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    )
  ).join("\n");
  // The discovery prompt itself lives in its own module so its size can be
  // measured offline; the route only assembles the request around it.
  const discoveryPrompt = await readFile(
    new URL("../app/lib/discovery-prompt.mjs", import.meta.url),
    "utf8",
  );
  const messages = await readFile(
    new URL("../app/api/messages/route.ts", import.meta.url),
    "utf8",
  );
  // Likewise the product analysis lives in app/lib/analysis-core.ts.
  const analyze = (
    await Promise.all(
      [
        "../app/api/analyze/route.ts",
        "../app/lib/analysis-core.ts",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    )
  ).join("\n");
  const integrations = await readFile(
    new URL("../app/api/integrations/route.ts", import.meta.url),
    "utf8",
  );
  const sender = await readFile(
    new URL("../app/api/send/route.ts", import.meta.url),
    "utf8",
  );
  const prospects = await readFile(
    new URL("../app/api/prospects/route.ts", import.meta.url),
    "utf8",
  );
  const migration = await readFile(
    new URL("../drizzle/0007_previous_thunderbolt_ross.sql", import.meta.url),
    "utf8",
  );
  const login = await readFile(
    new URL("../app/login/login-screen.tsx", import.meta.url),
    "utf8",
  );
  const auth = await readFile(
    new URL("../app/lib/auth.ts", import.meta.url),
    "utf8",
  );
  const authMigration = await readFile(
    new URL("../drizzle/0008_far_marvel_boy.sql", import.meta.url),
    "utf8",
  );
  const googleCallback = await readFile(
    new URL("../app/api/auth/google/callback/route.ts", import.meta.url),
    "utf8",
  );
  const appleCallback = await readFile(
    new URL("../app/api/auth/apple/callback/route.ts", import.meta.url),
    "utf8",
  );
  const billing = await readFile(
    new URL("../app/lib/billing.ts", import.meta.url),
    "utf8",
  );
  const billingRoute = await readFile(
    new URL("../app/api/billing/route.ts", import.meta.url),
    "utf8",
  );
  const plans = await readFile(
    new URL("../app/lib/plans.ts", import.meta.url),
    "utf8",
  );
  const usageLimits = await readFile(
    new URL("../app/lib/usage-limits.ts", import.meta.url),
    "utf8",
  );
  const opportunityMigration = await readFile(
    new URL("../drizzle/0010_opportunity_actions.sql", import.meta.url),
    "utf8",
  );
  // Contact enrichment moved into app/lib/enrichment-core.ts for the same
  // reason: the pipeline enriches through the very same implementation.
  const contactEnrichment = (
    await Promise.all(
      [
        "../app/api/contacts/enrich/route.ts",
        "../app/lib/enrichment-core.ts",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    )
  ).join("\n");
  const contactMigration = await readFile(
    new URL("../drizzle/0011_contact_enrichment.sql", import.meta.url),
    "utf8",
  );
  const placementMigration = await readFile(
    new URL("../drizzle/0015_secret_epoch.sql", import.meta.url),
    "utf8",
  );

  assert.match(marketing, /Chanlyst/);
  assert.match(marketing, /Конфиденциальность/);
  assert.match(marketing, /human-approved outreach/);
  assert.match(page, /Chanlyst/);
  assert.match(page, /Добавить продукт/);
  assert.match(page, /Кто должен заплатить/);
  assert.match(page, /Только владельцы целевой аудитории/);
  // "Telegram safe" is gone with the rest of the Telegram sending surface: the
  // tab, the queue hand-off and an integration card that said «Подключено»
  // over nothing. All of it opened a t.me link and copied the text, which is
  // the user sending the message themselves. Finding Telegram channels is
  // untouched — that is the site:t.me source, and it works.
  assert.doesNotMatch(page, /Telegram safe/);
  assert.doesNotMatch(page, /"telegram", "linkedin"/);
  assert.match(page, /Gmail/);
  assert.doesNotMatch(page, /Smartlead/i);
  // The Products page carries both halves — the portfolio and the card — so
  // the panel no longer picks between them. The section that used to own the
  // portfolio, «Сегодня», is gone: its launch checklist reads on Products and
  // its task list on Results, and /dashboard lands on Products.
  assert.match(page, /dashboard\/products/);
  assert.match(page, /variant="card"/);
  assert.doesNotMatch(page, /view === "workspace"/);
  assert.match(page, /activeMessages/);
  assert.match(page, /Фактическая воронка/);
  assert.match(page, /updateOutcome/);
  assert.match(page, /revenueCents/);
  assert.match(discover, /OPENROUTER_API_KEY/);
  assert.match(discover, /openrouter:web_search/);
  assert.match(discover, /openrouter_agent_search/);
  assert.match(discover, /SERPER_API_KEY/);
  assert.match(analyze, /openai\/gpt-5\.2/);
  assert.match(analyze, /acquisitionMotions/);
  assert.match(analyze, /direct_sales/);
  assert.match(discoveryPrompt, /Приоритетные механики/);
  assert.match(page, /motion-plan/);
  assert.match(discover, /opportunityType/);
  assert.match(page, /channel-action-card/);
  assert.match(page, /lead-filters/);
  assert.match(page, /Подготовить рассылку/);
  assert.match(discover, /pricingSummary/);
  assert.match(discover, /registrationUrl/);
  assert.match(prospects, /engagement_mode as engagementMode/);
  assert.match(placementMigration, /placement_requirements/);
  assert.match(prospects, /opportunity_type as opportunityType/);
  assert.match(opportunityMigration, /action_url/);
  assert.match(contactEnrichment, /verified_public/);
  assert.match(contactEnrichment, /openrouter:web_search/);
  assert.match(contactEnrichment, /Не придумывай email/);
  assert.match(contactMigration, /contact_source_url/);
  assert.match(page, /contact-proof/);
  assert.match(page, /api\/outreach/);
  assert.match(integrations, /openrouter/);
  assert.match(integrations, /gmail_config/);
  assert.doesNotMatch(integrations, /smartlead/i);
  assert.match(sender, /gmail\.googleapis\.com/);
  assert.doesNotMatch(sender, /smartlead/i);
  assert.match(messages, /outbound_messages/);
  assert.match(messages, /DELETE/);
  assert.match(prospects, /converted_at as convertedAt/);
  assert.match(prospects, /ProspectStage/);
  assert.match(sender, /stage='contacted'/);
  assert.match(migration, /ADD `stage`/);
  assert.match(migration, /revenue_cents/);
  assert.match(login, /Продолжить с Google/);
  assert.match(login, /Продолжить с Apple/);
  assert.match(auth, /__Host-chanlyst_session/);
  assert.match(auth, /PBKDF2/);
  assert.match(authMigration, /workspace_members/);
  assert.match(authMigration, /workspace_integrations/);
  assert.match(googleCallback, /jwtVerify/);
  assert.match(googleCallback, /email_verified/);
  assert.match(appleCallback, /appleid\.apple\.com\/auth\/token/);
  assert.match(plans, /starter/);
  assert.match(plans, /scale/);
  assert.match(billing, /planFromVariantName/);
  assert.match(billing, /1945558/);
  assert.match(billingRoute, /checkoutBaseUrl\(plan, interval\)/);
  assert.match(usageLimits, /plan_limit_reached/);
  assert.match(usageLimits, /channelsPerMonth/);
  assert.match(page, /billing-usage/);
  assert.doesNotMatch(page, /Your site is taking shape/);
});
