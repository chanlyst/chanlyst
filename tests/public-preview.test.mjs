import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("the anonymous response crosses the server boundary with five rows only", () => {
  const core = read("app/lib/public-preview.ts");

  assert.match(core, /PUBLIC_PREVIEW_VISIBLE_RESULTS = 5/);
  assert.match(
    core,
    /results: results\.slice\(0, PUBLIC_PREVIEW_VISIBLE_RESULTS\)\.map/,
  );
  assert.ok(core.includes("results_json=?"), "the full result still has to be retained server-side");

  const route = read("app/api/public-preview/route.ts");
  assert.doesNotMatch(route, /resultsJson|results_json/);
  assert.match(route, /JSON\.stringify\(outcome\.payload\)/);
});

test("the public endpoint is bounded and accepts JSON only", () => {
  const route = read("app/api/public-preview/route.ts");

  assert.match(route, /MAX_REQUEST_BYTES = 8_000/);
  assert.match(route, /startsWith\("application\/json"\)/);
  assert.match(route, /TextEncoder\(\)\.encode\(raw\)\.byteLength/);
  assert.match(route, /Cache-Control": "private, no-store"/);
});

test("paid runs count against the public budget even when no channels survive", () => {
  const core = read("app/lib/public-preview.ts");

  assert.match(core, /const runCostMicrousd = usageCostMicrousd\(outcome\.providerUsage\)/);
  assert.match(
    core,
    /error_code='no_channels_found', cost_microusd=\? WHERE id=\?/,
  );
  assert.match(core, /\.bind\(runCostMicrousd, id\)/);
});

test("anonymous preview tokens and client addresses are never stored raw", () => {
  const core = read("app/lib/public-preview.ts");
  const migration = read("drizzle/0037_public_previews.sql");

  assert.match(core, /HttpOnly/);
  assert.match(core, /x-forwarded-proto/);
  assert.match(core, /forwardedProtocol === "https"/);
  assert.match(core, /token_hash/);
  assert.match(core, /ip_hash/);
  assert.doesNotMatch(migration, /`token` text/);
  assert.doesNotMatch(migration, /`ip` text/);
  assert.match(migration, /public_previews_token_hash_unique/);
  assert.match(migration, /public_previews_ip_created_idx/);
});

test("registration claims the same browser's full result into its workspace", () => {
  const layout = read("app/dashboard/layout.tsx");
  const core = read("app/lib/public-preview.ts");

  assert.match(layout, /claimPublicPreview\(cookie, session\.workspaceId\)/);
  assert.match(layout, /initialProductId=\{preview\.productId \|\| ""\}/);
  assert.match(core, /saveProspects\([\s\S]*results\.slice\(0, channelRemaining\)/);
  assert.match(core, /status='claimed'/);
});

test("the landing runs live analysis instead of a simulated timer", () => {
  const component = read("app/components/acquisition-preview.tsx");

  assert.match(component, /fetch\("\/api\/public-preview"/);
  assert.doesNotMatch(component, /setTimeout\(/);
  for (const answerId of [
    "founders",
    "growth_teams",
    "mid_market",
    "early_users",
    "qualified_leads",
    "partnerships",
    "worldwide",
    "north_america",
    "europe",
  ]) {
    assert.ok(component.includes(`id: "${answerId}"`), `missing ${answerId}`);
  }
});

test("the public preview uses the broad multi-pass discovery pipeline", () => {
  const core = read("app/lib/public-preview.ts");

  assert.match(core, /runBroadDiscovery\(/);
  assert.doesNotMatch(core, /runDiscovery\(/);
  assert.match(core, /DEFAULT_CONCURRENT_LIMIT = 2/);
});
