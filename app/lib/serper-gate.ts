/**
 * One gate for every Serper request the worker makes.
 *
 * It used to live inside discovery-serper, which was enough while discovery
 * was the only caller. It is not enough now: a gap analysis running beside a
 * search would each keep their own count and together exceed the limit — the
 * exact failure the gate was added to prevent.
 *
 * Measured on 14 August: fifty requests in one second earned 25 refusals, and
 * one lane lost every request it made.
 */
const MAX_CONCURRENT = 8;

/** One retry, after a pause, for the one status a pause actually fixes. */
export const RETRY_AFTER_MS = 1_200;

let inFlight = 0;
const waiting: Array<() => void> = [];

export async function withSerperSlot<T>(work: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  inFlight += 1;
  try {
    return await work();
  } finally {
    inFlight -= 1;
    waiting.shift()?.();
  }
}

/**
 * A Serper search, queued and retried once on a refusal.
 *
 * Returns the parsed body, or null when the request failed — the caller
 * decides what an absent answer means, because "nothing matched" and "we never
 * asked" are worth different things and cost differently.
 */
export async function serperSearch(
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs = 8_000,
): Promise<{ ok: true; data: unknown } | { ok: false; reason: string }> {
  return withSerperSlot(async () => {
    const ask = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      let response = await ask();
      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
        response = await ask();
      }
      if (!response.ok) return { ok: false as const, reason: `http_${response.status}` };
      return { ok: true as const, data: await response.json() };
    } catch {
      return { ok: false as const, reason: "timeout_or_network" };
    }
  });
}
