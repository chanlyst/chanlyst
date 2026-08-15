import {
  authBindings,
  publicUrl,
  randomToken,
  saveOauthState,
  sha256,
} from "../../../../lib/auth";

function base64UrlFromHex(hex: string) {
  const bytes = Uint8Array.from(
    hex.match(/.{2}/g) || [],
    (value) => Number.parseInt(value, 16),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function GET(request: Request) {
  const bindings = authBindings();
  if (!bindings.GOOGLE_AUTH_CLIENT_ID || !bindings.GOOGLE_AUTH_CLIENT_SECRET) {
    return Response.redirect(publicUrl(request, "/login?error=google_not_configured"));
  }
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(48);
  await saveOauthState("google", state, verifier, nonce);
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.searchParams.set("client_id", bindings.GOOGLE_AUTH_CLIENT_ID);
  authorize.searchParams.set(
    "redirect_uri",
    publicUrl(request, "/api/auth/google/callback").toString(),
  );
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openid email profile");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  authorize.searchParams.set(
    "code_challenge",
    base64UrlFromHex(await sha256(verifier)),
  );
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("prompt", "select_account");
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      "Set-Cookie": `chanlyst_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
