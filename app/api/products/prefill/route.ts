import { env } from "cloudflare:workers";
import {
  creditsExhaustedResponse,
  recordAiUsage,
  reportOpenRouterFailure,
  type OpenRouterUsage,
} from "../../../lib/ai-usage";
import { isAuthResponse, requireApiSession } from "../../../lib/auth";
import { getIntegrationSecret } from "../../../lib/secret";
import { safePublicUrl } from "../../../lib/security-helpers.mjs";
import { enforceUsageLimit } from "../../../lib/usage-limits";
import { languageRule } from "../../../lib/response-language.mjs";

// The prefillable subset of the products schema. Every field is a plain
// string so the client can merge values into empty form inputs directly.
const prefillFieldNames = [
  "name",
  "description",
  "category",
  "audience",
  "negativeAudience",
  "geography",
  "languages",
  "monetizationModel",
  "paidOffer",
  "priceRange",
  "paymentPoint",
  "conversionEvent",
  "attributionMethod",
  "partnerTerms",
] as const;

type PrefillFieldName = (typeof prefillFieldNames)[number];
type PrefillFields = Record<PrefillFieldName, string>;

type OpenRouterResponse = {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: OpenRouterUsage;
};

const prefillSchema = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    prefillFieldNames.map((field) => [field, { type: "string" }]),
  ),
  required: [...prefillFieldNames],
} as const;

async function fetchPublicPage(initial: URL) {
  // Redirects are followed manually so every hop is re-validated against
  // safePublicUrl before the request leaves the worker.
  let current: URL | null = initial;
  for (let hop = 0; hop < 4 && current; hop += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": "Chanlyst Product Prefill/1.0" },
      signal: AbortSignal.timeout(12_000),
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = safePublicUrl(new URL(location, current).toString());
      continue;
    }
    return response.ok ? response : null;
  }
  return null;
}

function extractPageContext(html: string) {
  const capped = html.slice(0, 400_000);
  const title = (capped.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  const metaDescription = (
    capped.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
    )?.[1] ||
    capped.match(
      /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
    )?.[1] ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  const text = capped
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18_000);
  return { title, metaDescription, text };
}

function outputText(response: OpenRouterResponse) {
  if (response.output_text) return response.output_text;
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text || "")
    .join("");
}

function parseFields(text: string): PrefillFields {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  return Object.fromEntries(
    prefillFieldNames.map((field) => [
      field,
      String(parsed[field] || "").trim().slice(0, 2000),
    ]),
  ) as PrefillFields;
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const quota = await enforceUsageLimit(auth.workspaceId, "aiMessages");
  if (!quota.allowed) return quota.response!;
  // The interface language, so a prefill lands in the language the user is
// working in. It used to follow the language of the SITE being read, which is
// how an English interface ended up with a Russian product card.
  const payload = (await request.json().catch(() => ({}))) as {
    url?: string;
    locale?: string;
  };
  const url = safePublicUrl(String(payload.url || ""));
  if (!url) {
    return Response.json({ error: "invalid_url" }, { status: 400 });
  }

  let page: { title: string; metaDescription: string; text: string };
  try {
    const response = await fetchPublicPage(url);
    if (!response) {
      return Response.json({ error: "fetch_failed" }, { status: 502 });
    }
    page = extractPageContext(await response.text());
  } catch {
    return Response.json({ error: "fetch_failed" }, { status: 502 });
  }

  const bindings = env as unknown as {
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;
  };
  const openrouterKey =
    bindings.OPENROUTER_API_KEY ||
    (await getIntegrationSecret("openrouter", auth.workspaceId));
  if (!openrouterKey) {
    return Response.json({ error: "openrouter_request_failed" }, { status: 502 });
  }

  const prompt = `Ты помогаешь заполнить карточку продукта в Chanlyst по тексту его сайта.
URL: ${url.toString()}
Заголовок страницы: ${page.title || "не найден"}
Meta description: ${page.metaDescription || "не найдено"}
Текст страницы: ${page.text || "недоступен"}

Заполни поля формы продукта строго по фактам со страницы:
name — название продукта; description — что продаёт продукт;
category — категория; audience — кто должен заплатить;
negativeAudience — кого исключать; geography — география;
languages — языки; monetizationModel — модель монетизации;
paidOffer — что именно покупает клиент; priceRange — цена или средний чек;
paymentPoint — где происходит оплата; conversionEvent — событие конверсии;
attributionMethod — как определяется источник клиента;
partnerTerms — что получает партнёр.

Правила:
- Указывай только то, что явно подтверждается текстом страницы. Ничего не выдумывай.
- Если для поля нет подтверждённой информации, верни пустую строку "".
${languageRule(payload.locale)}
Верни только JSON по заданной схеме.`;

  const model = bindings.OPENROUTER_MODEL || "openai/gpt-5.2";
  const response = await fetch("https://openrouter.ai/api/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://chanlyst.com",
      "X-OpenRouter-Title": "Chanlyst",
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      input: prompt,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "chanlyst_product_prefill",
          strict: true,
          schema: prefillSchema,
        },
      },
      max_output_tokens: 2400,
    }),
  });

  if (!response.ok) {
    const failure = await reportOpenRouterFailure({
      response,
      operation: "prefill",
      workspaceId: auth.workspaceId,
      model,
    });
    if (failure.creditsExhausted) return creditsExhaustedResponse();
    return Response.json({ error: "openrouter_request_failed" }, { status: 502 });
  }

  const raw = (await response.json()) as OpenRouterResponse;
  let fields: PrefillFields | null = null;
  try {
    fields = parseFields(outputText(raw));
  } catch {
    fields = null;
  }
  await recordAiUsage({
    workspaceId: auth.workspaceId,
    operation: "prefill",
    model,
    usage: raw.usage,
    outcome: fields ? "ok" : "error",
    statusCode: response.status,
    response: raw,
  });

  if (!fields) {
    return Response.json({ error: "openrouter_request_failed" }, { status: 502 });
  }
  return Response.json({ fields });
}
