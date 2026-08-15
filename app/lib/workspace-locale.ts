import { env } from "cloudflare:workers";
import { normaliseLocale } from "./response-language.mjs";

/**
 * The language a workspace's generated text is written in.
 *
 * It used to be a browser cookie and nothing else. Whichever way the RU/EN
 * switch happened to be pointing when a run started decided the language of
 * everything that run wrote, no record was kept, and a second browser could
 * hold a different answer for the same workspace. That is how one channel list
 * came to hold July's English rows beside August's Russian ones.
 *
 * A cron run has no browser at all, which used to mean it silently fell back
 * to the default — the nightly agent could write in a language the owner had
 * never chosen.
 *
 * The workspace owns the choice now. The cookie still paints the interface
 * before the first pixel, which is what it was always good at; it no longer
 * decides what gets written into the database.
 */
export async function workspaceContentLocale(
  workspaceId: string,
): Promise<"ru" | "en"> {
  const bindings = env as unknown as { DB: D1Database };
  const row = await bindings.DB.prepare(
    "SELECT content_locale AS locale FROM workspaces WHERE id=?",
  )
    .bind(workspaceId)
    .first<{ locale?: string }>();
  return normaliseLocale(row?.locale);
}

/**
 * Records the choice. Returns the language actually stored, so a caller never
 * has to guess how an unsupported value was resolved.
 */
export async function setWorkspaceContentLocale(
  workspaceId: string,
  locale: unknown,
): Promise<"ru" | "en"> {
  const value = normaliseLocale(locale);
  const bindings = env as unknown as { DB: D1Database };
  await bindings.DB.prepare("UPDATE workspaces SET content_locale=? WHERE id=?")
    .bind(value, workspaceId)
    .run();
  return value;
}

/**
 * How much stored text is in a language the workspace no longer uses.
 *
 * Switching the language cannot retroactively rewrite what was already
 * generated, so the honest thing is to be able to say how much is stale and
 * offer to fix it — rather than let the user discover it one card at a time.
 */
export async function staleContentCount(
  workspaceId: string,
  locale: "ru" | "en",
): Promise<number> {
  const bindings = env as unknown as { DB: D1Database };
  const row = await bindings.DB.prepare(
    `SELECT COUNT(*) AS n FROM prospects
     WHERE workspace_id=? AND content_locale<>'' AND content_locale<>?`,
  )
    .bind(workspaceId, locale)
    .first<{ n?: number }>();
  return Number(row?.n) || 0;
}
