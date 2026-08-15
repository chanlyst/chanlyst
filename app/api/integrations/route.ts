import { env } from "cloudflare:workers";
import { encryptSecret } from "../../lib/secret";
import { isAuthResponse, requireApiSession } from "../../lib/auth";

type IntegrationPayload = {
  provider?: "openrouter" | "gmail_config";
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
};

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const bindings = env as unknown as Record<string, string | undefined>;
  const database = (env as unknown as { DB?: D1Database }).DB;
  const saved = database
    ? await database
        .prepare(
          `SELECT provider, status, account_label as accountLabel, metadata,
           updated_at as updatedAt FROM workspace_integrations
           WHERE workspace_id=?`,
        )
        .bind(auth.workspaceId)
        .all()
    : { results: [] };
  const integrations = Object.fromEntries(
    saved.results.map((item: Record<string, unknown>) => [
      item.provider,
      {
        ...item,
        metadata: JSON.parse(String(item.metadata || "{}")),
      },
    ]),
  );
  return Response.json({
    integrations,
    configuration: {
      openrouter: Boolean(bindings.OPENROUTER_API_KEY || integrations.openrouter),
      gmail: Boolean(
        (bindings.GOOGLE_CLIENT_ID && bindings.GOOGLE_CLIENT_SECRET) ||
          integrations.gmail_config,
      ),
      secureStorage: Boolean(bindings.INTEGRATION_ENCRYPTION_KEY),
      telegram: true,
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const payload = (await request.json()) as IntegrationPayload;
  const database = (env as unknown as { DB?: D1Database }).DB;
  if (!database || !payload.provider) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (payload.provider === "gmail_config") {
    if (!payload.clientId || !payload.clientSecret) {
      return Response.json({ error: "google_credentials_required" }, { status: 400 });
    }
    const now = new Date().toISOString();
    await database
      .prepare(
        `INSERT INTO workspace_integrations
         (workspace_id, provider, status, account_label, access_token, refresh_token, expires_at, metadata, updated_at)
         VALUES (?, 'gmail_config', 'connected', 'Google OAuth app', ?, ?, NULL, '{}', ?)
         ON CONFLICT(workspace_id, provider) DO UPDATE SET status='connected',
           account_label='Google OAuth app', access_token=excluded.access_token,
           refresh_token=excluded.refresh_token, updated_at=excluded.updated_at`,
      )
      .bind(
        auth.workspaceId,
        await encryptSecret(payload.clientId),
        await encryptSecret(payload.clientSecret),
        now,
      )
      .run();
    return Response.json({ connected: true });
  }
  if (!payload.apiKey) {
    return Response.json({ error: "api_key_required" }, { status: 400 });
  }
  // OpenRouter normally runs on the system key from the environment, so the
  // dashboard no longer offers this; the branch stays for self-hosted setups
  // that store their own key.
  if (payload.provider === "openrouter") {
    const check = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${payload.apiKey}` },
    });
    if (!check.ok) {
      return Response.json({ error: "openrouter_key_invalid" }, { status: 400 });
    }
    const now = new Date().toISOString();
    await database
      .prepare(
        `INSERT INTO workspace_integrations
         (workspace_id, provider, status, account_label, access_token, refresh_token, expires_at, metadata, updated_at)
         VALUES (?, 'openrouter', 'connected', 'OpenRouter API', ?, '', NULL, '{}', ?)
         ON CONFLICT(workspace_id, provider) DO UPDATE SET status='connected',
           account_label='OpenRouter API', access_token=excluded.access_token,
           updated_at=excluded.updated_at`,
      )
      .bind(auth.workspaceId, await encryptSecret(payload.apiKey), now)
      .run();
    return Response.json({ connected: true });
  }
  return Response.json({ error: "invalid_request" }, { status: 400 });
}

export async function DELETE(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const database = (env as unknown as { DB?: D1Database }).DB;
  const provider = new URL(request.url).searchParams.get("provider");
  if (!database || !["gmail", "gmail_config", "openrouter"].includes(provider || "")) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  await database
    .prepare(
      "DELETE FROM workspace_integrations WHERE provider = ? AND workspace_id=?",
    )
    .bind(provider, auth.workspaceId)
    .run();
  return Response.json({ disconnected: true });
}
