import {
  authBindings,
  publicUrl,
  randomToken,
  saveOauthState,
} from "../../../../lib/auth";

export async function GET(request: Request) {
  const bindings = authBindings();
  if (
    !bindings.APPLE_CLIENT_ID ||
    !bindings.APPLE_TEAM_ID ||
    !bindings.APPLE_KEY_ID ||
    !bindings.APPLE_PRIVATE_KEY
  ) {
    return Response.redirect(publicUrl(request, "/login?error=apple_not_configured"));
  }
  const state = randomToken();
  const nonce = randomToken();
  await saveOauthState("apple", state, "", nonce);
  const authorize = new URL("https://appleid.apple.com/auth/authorize");
  authorize.searchParams.set("client_id", bindings.APPLE_CLIENT_ID);
  authorize.searchParams.set(
    "redirect_uri",
    publicUrl(request, "/api/auth/apple/callback").toString(),
  );
  authorize.searchParams.set("response_type", "code id_token");
  authorize.searchParams.set("response_mode", "form_post");
  authorize.searchParams.set("scope", "name email");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      "Set-Cookie": `chanlyst_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=600`,
    },
  });
}
