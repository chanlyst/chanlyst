import {
  createRemoteJWKSet,
  importPKCS8,
  jwtVerify,
  SignJWT,
} from "jose";
import {
  authBindings,
  consumeOauthState,
  cookieValue,
  createSession,
  publicUrl,
  sessionCookie,
  upsertOauthUser,
} from "../../../../lib/auth";

const appleKeys = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys"),
);

async function appleClientSecret() {
  const bindings = authBindings();
  const privateKey = await importPKCS8(
    String(bindings.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    "ES256",
  );
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: bindings.APPLE_KEY_ID })
    .setIssuer(bindings.APPLE_TEAM_ID!)
    .setSubject(bindings.APPLE_CLIENT_ID!)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 60 * 24 * 30)
    .sign(privateKey);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const state = String(form.get("state") || "");
  const code = String(form.get("code") || "");
  if (
    !state ||
    !code ||
    state !== cookieValue(request.headers.get("cookie"), "chanlyst_oauth_state")
  ) {
    return Response.redirect(publicUrl(request, "/login?error=oauth_state"), 303);
  }
  const saved = await consumeOauthState("apple", state);
  const bindings = authBindings();
  if (!saved || !bindings.APPLE_CLIENT_ID) {
    return Response.redirect(publicUrl(request, "/login?error=oauth_expired"), 303);
  }
  try {
    const tokenResponse = await fetch("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: bindings.APPLE_CLIENT_ID,
        client_secret: await appleClientSecret(),
        code,
        grant_type: "authorization_code",
        redirect_uri: publicUrl(request, "/api/auth/apple/callback").toString(),
      }),
    });
    if (!tokenResponse.ok) throw new Error("apple_exchange");
    const tokens = (await tokenResponse.json()) as { id_token?: string };
    if (!tokens.id_token) throw new Error("apple_identity");
    const verified = await jwtVerify(tokens.id_token, appleKeys, {
      issuer: "https://appleid.apple.com",
      audience: bindings.APPLE_CLIENT_ID,
    });
    if (
      verified.payload.nonce !== saved.nonce ||
      !verified.payload.sub ||
      !verified.payload.email ||
      ![true, "true"].includes(
        verified.payload.email_verified as boolean | string,
      )
    ) {
      throw new Error("invalid_identity");
    }
    let name = "";
    const rawUser = String(form.get("user") || "");
    if (rawUser) {
      const user = JSON.parse(rawUser) as {
        name?: { firstName?: string; lastName?: string };
      };
      name = [user.name?.firstName, user.name?.lastName].filter(Boolean).join(" ");
    }
    const account = await upsertOauthUser({
      provider: "apple",
      providerAccountId: verified.payload.sub,
      email: String(verified.payload.email),
      name,
    });
    const token = await createSession(account.userId, account.workspaceId);
    const headers = new Headers({
      Location: publicUrl(request, "/dashboard").toString(),
    });
    headers.append("Set-Cookie", sessionCookie(token));
    headers.append(
      "Set-Cookie",
      "chanlyst_oauth_state=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0",
    );
    return new Response(null, { status: 303, headers });
  } catch {
    return Response.redirect(publicUrl(request, "/login?error=apple_identity"), 303);
  }
}
