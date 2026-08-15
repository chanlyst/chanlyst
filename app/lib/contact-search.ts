import { env } from "cloudflare:workers";
import { getIntegrationSecret } from "./secret";
import {
  buildContactPageQuery,
  contactPageUrls,
} from "./contact-search-core.mjs";
import { normaliseSourceCandidates } from "./discovery-source-core.mjs";

const SERPER_TIMEOUT_MS = 8_000;

/**
 * The prospect's own contact pages, as Google has them indexed.
 *
 * One credit per prospect, and it only ever adds URLs for the crawler that
 * already runs — so a failure here (no key, a refusal, a domain too small to
 * be indexed) costs nothing but the guessed paths we had before.
 */
export async function findContactPages({
  workspaceId,
  domain,
  locale = "en",
}: {
  workspaceId: string;
  domain: string;
  locale?: string;
}): Promise<string[]> {
  const query = buildContactPageQuery({ domain }) as string;
  if (!query) return [];
  const bindings = env as unknown as { SERPER_API_KEY?: string };
  const apiKey =
    bindings.SERPER_API_KEY ||
    (await getIntegrationSecret("serper", workspaceId).catch(() => ""));
  if (!apiKey) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERPER_TIMEOUT_MS);
  let payload: unknown = {};
  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({
        q: query,
        num: 10,
        hl: locale === "ru" ? "ru" : "en",
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.info(`contact-pages domain=${domain} failed=http_${response.status}`);
      return [];
    }
    payload = await response.json();
  } catch {
    console.info(`contact-pages domain=${domain} failed=timeout_or_network`);
    return [];
  } finally {
    clearTimeout(timer);
  }

  const candidates = normaliseSourceCandidates(
    [{ query, page: 1, response: payload }],
    "contact",
  ) as Array<{ url: string }>;
  const urls = contactPageUrls(candidates, domain) as string[];
  console.info(
    `contact-pages domain=${domain} results=${candidates.length} desks=${urls.length}`,
  );
  return urls;
}
