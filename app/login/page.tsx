import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to Chanlyst with Google, GitHub, e-mail or a password.",
  alternates: { canonical: "/login" },
  // Nothing here is worth a search result: it is an auth step, not content.
  // Indexed, it competes with the page that actually explains the product.
  robots: { index: false, follow: true },
};

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authBindings, getSessionFromCookieHeader } from "../lib/auth";
import VisitBeacon from "../components/visit-beacon";
import LoginScreen from "./login-screen";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const requestHeaders = await headers();
  const session = await getSessionFromCookieHeader(requestHeaders.get("cookie"));
  if (session) redirect("/dashboard");
  const query = await searchParams;
  const bindings = authBindings();
  return (
    <>
      {/* Rendered after the redirect above, so a returning customer landing on
          their dashboard is never counted as reaching the sign-in step. */}
      <VisitBeacon path="/login" params={query || {}} />
      <LoginScreen
        initialError={query?.error || ""}
        googleAvailable={Boolean(
          bindings.GOOGLE_AUTH_CLIENT_ID && bindings.GOOGLE_AUTH_CLIENT_SECRET,
        )}
        appleAvailable={Boolean(
          bindings.APPLE_CLIENT_ID &&
            bindings.APPLE_TEAM_ID &&
            bindings.APPLE_KEY_ID &&
            bindings.APPLE_PRIVATE_KEY,
        )}
        githubAvailable={Boolean(
          bindings.GITHUB_CLIENT_ID && bindings.GITHUB_CLIENT_SECRET,
        )}
        emailLoginAvailable={Boolean(
          bindings.RESEND_API_KEY && bindings.MAIL_FROM,
        )}
      />
    </>
  );
}
