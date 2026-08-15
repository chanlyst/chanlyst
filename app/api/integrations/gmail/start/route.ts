import { env } from "cloudflare:workers";
import { getIntegrationCredentials } from "../../../../lib/secret";
import {
  isAuthResponse,
  publicUrl,
  requireApiSession,
} from "../../../../lib/auth";

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) {
    return Response.redirect(publicUrl(request, "/login"));
  }
  const bindings = env as unknown as {
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    INTEGRATION_ENCRYPTION_KEY?: string;
  };
  const saved = await getIntegrationCredentials(
    "gmail_config",
    auth.workspaceId,
  );
  const clientId = bindings.GOOGLE_CLIENT_ID || saved.accessToken;
  const clientSecret = bindings.GOOGLE_CLIENT_SECRET || saved.refreshToken;
  if (
    !clientId ||
    !clientSecret ||
    !bindings.INTEGRATION_ENCRYPTION_KEY
  ) {
    return Response.redirect(publicUrl(request, "/dashboard?integration_error=gmail_not_configured#integrations"));
  }
  const state = crypto.randomUUID();
  const callback = publicUrl(request, "/api/integrations/gmail/callback").toString();
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", callback);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set(
    "scope",
    "openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
  );
  authorize.searchParams.set("access_type", "offline");
  authorize.searchParams.set("prompt", "consent");
  authorize.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      "Set-Cookie": `signalist_google_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
