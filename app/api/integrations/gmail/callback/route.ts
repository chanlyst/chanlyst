import { env } from "cloudflare:workers";
import {
  encryptSecret,
  getIntegrationCredentials,
} from "../../../../lib/secret";
import {
  getSession,
  publicUrl,
} from "../../../../lib/auth";

function cookie(request: Request, name: string) {
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));
  return value?.slice(name.length + 1);
}

export async function GET(request: Request) {
  const auth = await getSession(request);
  if (!auth) return Response.redirect(publicUrl(request, "/login"));
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || state !== cookie(request, "signalist_google_state") || !code) {
    return Response.redirect(publicUrl(request, "/dashboard?integration_error=gmail_state#integrations"));
  }
  const bindings = env as unknown as {
    DB?: D1Database;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
  };
  const saved = await getIntegrationCredentials(
    "gmail_config",
    auth.workspaceId,
  );
  const clientId = bindings.GOOGLE_CLIENT_ID || saved.accessToken;
  const clientSecret = bindings.GOOGLE_CLIENT_SECRET || saved.refreshToken;
  if (!bindings.DB || !clientId || !clientSecret) {
    return Response.redirect(publicUrl(request, "/dashboard?integration_error=gmail_config#integrations"));
  }
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: publicUrl(request, "/api/integrations/gmail/callback").toString(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) {
    return Response.redirect(publicUrl(request, "/dashboard?integration_error=gmail_exchange#integrations"));
  }
  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = profileResponse.ok
    ? ((await profileResponse.json()) as { email?: string })
    : {};
  const now = new Date();
  await bindings.DB
    .prepare(
      `INSERT INTO workspace_integrations
       (workspace_id, provider, status, account_label, access_token, refresh_token, expires_at, metadata, updated_at)
       VALUES (?, 'gmail', 'connected', ?, ?, ?, ?, '{}', ?)
       ON CONFLICT(workspace_id, provider) DO UPDATE SET status='connected',
         account_label=excluded.account_label, access_token=excluded.access_token,
         refresh_token=CASE WHEN excluded.refresh_token='' THEN workspace_integrations.refresh_token ELSE excluded.refresh_token END,
         expires_at=excluded.expires_at, updated_at=excluded.updated_at`,
    )
    .bind(
      auth.workspaceId,
      profile.email || "Gmail",
      await encryptSecret(tokens.access_token),
      await encryptSecret(tokens.refresh_token || ""),
      new Date(now.getTime() + (tokens.expires_in || 3600) * 1000).toISOString(),
      now.toISOString(),
    )
    .run();
  return new Response(null, {
    status: 302,
    headers: {
      Location: publicUrl(
        request,
        "/dashboard?integration=gmail_connected#integrations",
      ).toString(),
      "Set-Cookie":
        "signalist_google_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    },
  });
}
