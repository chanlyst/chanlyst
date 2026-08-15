import VisitBeacon from "./components/visit-beacon";
import StructuredData from "./components/structured-data";
import { forwardedCampaign } from "./lib/visit-source.mjs";
import HomeScreen from "./home-screen";

// The marketing page itself is a client component — it has a language switch
// and a monthly/annual toggle. This thin server wrapper exists so the visit can
// be counted with the campaign tags and the referrer the request arrived with.
export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = (await searchParams) || {};
  // The campaign rides along to the sign-in page. Without this the second step
  // of the funnel is credited to our own domain — every campaign would show a
  // visit that landed and nobody who went on, which is worse than no number.
  const carried = forwardedCampaign(query);
  const tags = new URLSearchParams(carried);

  return (
    <>
      <StructuredData />
      <HomeScreen
        loginHref={carried ? `/login?${carried}` : "/login"}
        source={tags.get("utm_source") || ""}
        campaign={tags.get("utm_campaign") || ""}
      />
      <VisitBeacon path="/" params={query} />
    </>
  );
}
