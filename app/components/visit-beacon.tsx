import { headers } from "next/headers";

/**
 * The invisible image whose fetch is how a page view gets counted.
 *
 * It carries the campaign tags and the referrer the *page* was loaded with,
 * because by the time the browser asks for this image its own referrer is our
 * own page and would say nothing about where the visitor came from.
 */
export default async function VisitBeacon({
  path,
  params = {},
}: {
  path: string;
  params?: Record<string, string | string[] | undefined>;
}) {
  const requestHeaders = await headers();
  const query = new URLSearchParams({ p: path });

  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
    const value = params[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (first) query.set(key, first);
  }
  const referer = requestHeaders.get("referer");
  if (referer) query.set("r", referer);

  return (
    // A 1x1 counting pixel, deliberately not next/image: it must be a plain
    // request the browser makes once, not an optimised asset.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/v?${query}`}
      alt=""
      width={1}
      height={1}
      aria-hidden="true"
      style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
    />
  );
}
