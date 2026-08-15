import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionFromCookieHeader } from "../lib/auth";
import { localeFromCookieHeader } from "../lib/locale-cookie.mjs";
import { claimPublicPreview } from "../lib/public-preview";
import DashboardRouter from "./dashboard-router";

// Still dynamic: the session is read per request. What changed is how often
// that happens — once per visit rather than once per section, because this
// layout survives navigation between the sections underneath it.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie");
  const session = await getSessionFromCookieHeader(cookie);
  if (!session) redirect("/login");
  // The anonymous result never travelled through the sign-in URL. Its
  // HttpOnly cookie is claimed here, after authentication, and imported once
  // into the new workspace before the dashboard asks for products.
  const preview = await claimPublicPreview(cookie, session.workspaceId);

  return (
    <>
      <DashboardRouter
        initialLocale={localeFromCookieHeader(cookie, "en")}
        initialProductId={preview.productId || ""}
      />
      {/* The section pages render nothing: they exist so the router above has
          a segment to read, and so a direct link to a section still works. */}
      {children}
    </>
  );
}
