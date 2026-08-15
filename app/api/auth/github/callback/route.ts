import {
  authBindings,
  consumeOauthState,
  cookieValue,
  createSession,
  publicUrl,
  sessionCookie,
  upsertOauthUser,
} from "../../../../lib/auth";
import { pickGithubEmail } from "../../../../lib/auth-helpers.mjs";

// GitHub rejects API calls without a User-Agent header.
const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "Chanlyst",
};

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
  const saved = await consumeOauthState("github", state);
  const bindings = authBindings();
  if (!saved || !bindings.GITHUB_CLIENT_ID || !bindings.GITHUB_CLIENT_SECRET) {
    return Response.redirect(publicUrl(request, "/login?error=oauth_expired"));
  }
  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "Chanlyst",
      },
      body: new URLSearchParams({
        code,
        client_id: bindings.GITHUB_CLIENT_ID,
        client_secret: bindings.GITHUB_CLIENT_SECRET,
        redirect_uri: publicUrl(request, "/api/auth/github/callback").toString(),
      }),
    },
  );
  if (!tokenResponse.ok) {
    return Response.redirect(publicUrl(request, "/login?error=github_exchange"));
  }
  const tokens = (await tokenResponse.json()) as { access_token?: string };
  if (!tokens.access_token) {
    return Response.redirect(publicUrl(request, "/login?error=github_exchange"));
  }
  try {
    const authorized = {
      ...GITHUB_HEADERS,
      Authorization: `Bearer ${tokens.access_token}`,
    };
    const [userResponse, emailsResponse] = await Promise.all([
      fetch("https://api.github.com/user", { headers: authorized }),
      fetch("https://api.github.com/user/emails", { headers: authorized }),
    ]);
    if (!userResponse.ok || !emailsResponse.ok) {
      throw new Error("invalid_identity");
    }
    const profile = (await userResponse.json()) as {
      id?: number | string;
      login?: string;
      name?: string;
      avatar_url?: string;
    };
    const email = pickGithubEmail(await emailsResponse.json());
    if (!email) {
      return Response.redirect(
        publicUrl(request, "/login?error=github_email_unverified"),
      );
    }
    if (!profile.id) throw new Error("invalid_identity");
    const account = await upsertOauthUser({
      provider: "github",
      providerAccountId: String(profile.id),
      email,
      name: String(profile.name || profile.login || ""),
      avatarUrl: String(profile.avatar_url || ""),
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
      "[auth/github] identity validation failed",
      error instanceof Error ? error.message : "unknown",
    );
    return Response.redirect(publicUrl(request, "/login?error=github_identity"));
  }
}
