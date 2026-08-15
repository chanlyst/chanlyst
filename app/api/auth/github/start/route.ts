import {
  authBindings,
  publicUrl,
  randomToken,
  saveOauthState,
} from "../../../../lib/auth";

export async function GET(request: Request) {
  const bindings = authBindings();
  if (!bindings.GITHUB_CLIENT_ID || !bindings.GITHUB_CLIENT_SECRET) {
    return Response.redirect(publicUrl(request, "/login?error=github_not_configured"));
  }
  const state = randomToken();
  const nonce = randomToken();
  // GitHub has no PKCE and no id_token; the nonce only keeps the stored state
  // row shaped like the other providers so consumeOauthState can validate it.
  await saveOauthState("github", state, "", nonce);
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", bindings.GITHUB_CLIENT_ID);
  authorize.searchParams.set(
    "redirect_uri",
    publicUrl(request, "/api/auth/github/callback").toString(),
  );
  authorize.searchParams.set("scope", "read:user user:email");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("allow_signup", "true");
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      "Set-Cookie": `chanlyst_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
