import { env } from "cloudflare:workers";
import {
  countWebSearchCalls,
  isCreditsExhausted,
  truncateErrorBody,
} from "./ai-cost.mjs";

export type OpenRouterUsage = {
  input_tokens?: number;
  prompt_tokens?: number;
  output_tokens?: number;
  completion_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
  server_tool_use_details?: { web_search_requests?: number };
  cost?: number;
};

export type AiOperation =
  | "analyze"
  | "analyze_retry"
  | "discover"
  // The relevance pass that follows a discovery run: no web search, small
  // output, billed separately so its cost is visible next to the search it
  // checks rather than hidden inside it.
  | "relevance"
  | "outreach"
  | "contact_enrichment"
  | "prefill";

/**
 * "ok"    — the call returned a usable answer.
 * "error" — the provider refused or the answer could not be used at all.
 * "retry" — the call was billed but its answer was discarded and retried.
 */
export type AiOutcome = "ok" | "error" | "retry";

export async function recordAiUsage({
  productId,
  workspaceId,
  operation,
  model,
  usage,
  outcome = "ok",
  statusCode = 0,
  response,
}: {
  productId?: string;
  workspaceId: string;
  operation: AiOperation;
  model: string;
  usage?: OpenRouterUsage;
  outcome?: AiOutcome;
  statusCode?: number;
  /** Raw provider response, used only to cross-check the search count. */
  response?: unknown;
}) {
  const database = (env as unknown as { DB?: D1Database }).DB;
  // Failures carry no usage object, yet they are exactly what used to be
  // invisible in spend reports — record them with zeroed counters.
  if (!database || (!usage && outcome === "ok")) return;
  try {
    // The provider under-reports searches when server_tool_use_details is
    // missing, so take whichever of the two counts is larger.
    const webSearchRequests = Math.max(
      usage?.server_tool_use_details?.web_search_requests || 0,
      countWebSearchCalls(response),
    );
    await database
      .prepare(
        `INSERT INTO ai_usage
         (id, product_id, operation, provider, model, input_tokens,
          output_tokens, reasoning_tokens, web_search_requests,
          cost_microusd, outcome, status_code, created_at, workspace_id)
         VALUES (?, ?, ?, 'openrouter', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        productId || "",
        operation,
        model,
        usage?.input_tokens || usage?.prompt_tokens || 0,
        usage?.output_tokens || usage?.completion_tokens || 0,
        usage?.output_tokens_details?.reasoning_tokens ||
          usage?.completion_tokens_details?.reasoning_tokens ||
          0,
        webSearchRequests,
        Math.max(0, Math.round((usage?.cost || 0) * 1_000_000)),
        outcome,
        Math.max(0, Math.round(Number(statusCode) || 0)),
        new Date().toISOString(),
        workspaceId,
      )
      .run();
  } catch {
    // Usage metering must never block the user's workflow.
  }
}

/** Longest provider error body ever read into memory. */
const MAX_ERROR_BODY_BYTES = 8_000;

async function readErrorBody(response: Response) {
  try {
    const reader = response.body?.getReader();
    if (!reader) return (await response.text()).slice(0, MAX_ERROR_BODY_BYTES);
    const decoder = new TextDecoder();
    let text = "";
    // Read incrementally so a huge or streaming error body cannot be pulled
    // into the worker's memory in full.
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length >= MAX_ERROR_BODY_BYTES) {
        await reader.cancel();
        break;
      }
    }
    return text.slice(0, MAX_ERROR_BODY_BYTES);
  } catch {
    return "";
  }
}

/**
 * Handles a non-2xx OpenRouter response: reads a bounded slice of the body,
 * logs the status with a truncated message (never the API key, never the whole
 * body) and records an ai_usage row so the failure shows up in spend reports.
 */
export async function reportOpenRouterFailure({
  response,
  operation,
  workspaceId,
  productId,
  model,
}: {
  response: Response;
  operation: AiOperation;
  workspaceId: string;
  productId?: string;
  model: string;
}): Promise<{ status: number; creditsExhausted: boolean }> {
  const body = await readErrorBody(response);
  console.error(
    `openrouter ${operation} failed: status=${response.status} body=${truncateErrorBody(body)}`,
  );
  await recordAiUsage({
    workspaceId,
    productId,
    operation,
    model,
    outcome: "error",
    statusCode: response.status,
  });
  return {
    status: response.status,
    creditsExhausted: isCreditsExhausted(response.status, body),
  };
}

/** The response returned to the client when the provider is out of credits. */
export function creditsExhaustedResponse() {
  return Response.json({ error: "ai_credits_exhausted" }, { status: 402 });
}
