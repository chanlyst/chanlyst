import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  authBindings,
  consumeOauthState,
  cookieValue,
  createSession,
  publicUrl,
  sessionCookie,
  upsertOauthUser,
} from "../../../../lib/auth";

const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (
    !state ||
    !code ||
    state !== cookieValue(request.headers.get("cookie"), "chanlyst_oauth_state")
  ) {
    return Response.redirect(publicUrl(request, "/login?error=oauth_state"));
  }
  const saved = await consumeOauthState("google", state);
  const bindings = authBindings();
  if (
    !saved ||
    !bindings.GOOGLE_AUTH_CLIENT_ID ||
    !bindings.GOOGLE_AUTH_CLIENT_SECRET
  ) {
    return Response.redirect(publicUrl(request, "/login?error=oauth_expired"));
  }
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: bindings.GOOGLE_AUTH_CLIENT_ID,
      client_secret: bindings.GOOGLE_AUTH_CLIENT_SECRET,
      redirect_uri: publicUrl(request, "/api/auth/google/callback").toString(),
      grant_type: "authorization_code",
      code_verifier: saved.verifier,
    }),
  });
  if (!tokenResponse.ok) {
    return Response.redirect(publicUrl(request, "/login?error=google_exchange"));
  }
  const tokens = (await tokenResponse.json()) as { id_token?: string };
  if (!tokens.id_token) {
    return Response.redirect(publicUrl(request, "/login?error=google_identity"));
  }
  try {
    const verified = await jwtVerify(tokens.id_token, googleKeys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: bindings.GOOGLE_AUTH_CLIENT_ID,
    });
    if (
      verified.payload.nonce !== saved.nonce ||
      verified.payload.email_verified !== true ||
      !verified.payload.sub ||
      !verified.payload.email
    ) {
      throw new Error("invalid_identity");
    }
    const account = await upsertOauthUser({
      provider: "google",
      providerAccountId: verified.payload.sub,
      email: String(verified.payload.email),
      name: String(verified.payload.name || ""),
      avatarUrl: String(verified.payload.picture || ""),
    });
    const token = await createSession(account.userId, account.workspaceId);
    const headers = new Headers({
      Location: publicUrl(request, "/dashboard").toString(),
    });
    headers.append("Set-Cookie", sessionCookie(token));
    headers.append(
      "Set-Cookie",
      "chanlyst_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    );
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error(
      "[auth/google] identity validation failed",
      error instanceof Error ? error.message : "unknown",
    );
    return Response.redirect(publicUrl(request, "/login?error=google_identity"));
  }
}
