import { env } from "cloudflare:workers";
import {
  recordAiUsage,
  reportOpenRouterFailure,
  type OpenRouterUsage,
} from "./ai-usage";
import { resolveOutreachLocale } from "./outreach-language";
import { getIntegrationSecret } from "./secret";

// Outreach copy generation, extracted out of app/api/outreach/route.ts so the
// composer and the "prepare everything" pipeline draft messages with exactly
// the same prompt and the same usage accounting.

export type OutreachProduct = {
  id?: string;
  name?: string;
  description?: string;
  audience?: string;
  languages?: string;
  geography?: string;
  paidOffer?: string;
  conversionEvent?: string;
  partnerTerms?: string;
  analysis?: { summary?: string; offer?: string };
};

export type OutreachLead = {
  company?: string;
  description?: string;
  channelType?: string;
  reason?: string;
  contact?: string;
  url?: string;
};

export type OutreachOutcome =
  | { ok: true; subject: string; body: string; locale: "ru" | "en" }
  | {
      ok: false;
      error:
        | "outreach_not_configured"
        | "ai_credits_exhausted"
        | "outreach_generation_failed"
        | "outreach_format_invalid";
      status: 400 | 402 | 502;
    };

type OpenRouterResponse = {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: OpenRouterUsage;
};

function outputText(response: OpenRouterResponse) {
  if (response.output_text) return response.output_text;
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text || "")
    .join("");
}

function parseJson(text: string) {
  return JSON.parse(
    text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim(),
  ) as { subject?: string; body?: string };
}

const outreachSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
  required: ["subject", "body"],
} as const;

export async function draftOutreach(
  {
    product,
    lead,
    channel,
    locale,
  }: {
    product?: OutreachProduct;
    lead?: OutreachLead;
    channel?: "email" | "telegram" | "linkedin";
    locale?: "ru" | "en";
  },
  ctx: { workspaceId: string },
): Promise<OutreachOutcome> {
  const bindings = env as unknown as {
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;
  };
  const apiKey =
    bindings.OPENROUTER_API_KEY ||
    (await getIntegrationSecret("openrouter", ctx.workspaceId));
  if (!apiKey || !product || !lead) {
    return { ok: false, error: "outreach_not_configured", status: 400 };
  }

  const model = bindings.OPENROUTER_MODEL || "openai/gpt-5.2";
  const outreachLocale = resolveOutreachLocale(product, locale || "en");
  const language = outreachLocale === "en" ? "English" : "Russian";
  const prompt = `Ты — senior partnership manager Chanlyst.
Напиши персонализированное первое сообщение для канала ${channel || "email"}.
Язык получателя: ${language}. Весь текст темы и сообщения должен быть написан
только на ${language}, независимо от языка интерфейса и исходных данных.
При необходимости переведи исходные факты и не оставляй фрагменты на другом языке.

Продукт: ${product.name || ""}
Описание: ${product.analysis?.summary || product.description || ""}
Платное предложение: ${product.paidOffer || ""}
Целевая конверсия: ${product.conversionEvent || ""}
Условия партнёру: ${product.partnerTerms || product.analysis?.offer || ""}

Площадка: ${lead.company || ""}
Тип: ${lead.channelType || ""}
Что известно: ${lead.description || ""}
Почему подходит: ${lead.reason || ""}
Контакт: ${lead.contact || ""}
URL: ${lead.url || ""}

Используй только перечисленные факты. Не выдумывай охват, имя, прошлые публикации
или результаты. Покажи конкретную пользу площадке и предложи небольшой тест с
измеримым результатом. Без лести и канцелярита. До 120 слов для email и до
70 слов для Telegram/LinkedIn. Верни только JSON:
{"subject":"тема только для email, иначе пустая строка","body":"сообщение"}`;

  const response = await fetch("https://openrouter.ai/api/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        "https://chanlyst.com",
      "X-OpenRouter-Title": "Chanlyst",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      reasoning: { effort: "low" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "chanlyst_outreach_message",
          strict: true,
          schema: outreachSchema,
        },
      },
      max_output_tokens: 1800,
    }),
  });
  if (!response.ok) {
    const failure = await reportOpenRouterFailure({
      response,
      operation: "outreach",
      workspaceId: ctx.workspaceId,
      productId: product.id,
      model,
    });
    if (failure.creditsExhausted) {
      return { ok: false, error: "ai_credits_exhausted", status: 402 };
    }
    return { ok: false, error: "outreach_generation_failed", status: 502 };
  }

  const raw = (await response.json()) as OpenRouterResponse;
  let message: { subject?: string; body?: string } | null = null;
  try {
    const parsed = parseJson(outputText(raw));
    message = parsed.body ? parsed : null;
  } catch {
    message = null;
  }
  await recordAiUsage({
    workspaceId: ctx.workspaceId,
    productId: product.id,
    operation: "outreach",
    model,
    usage: raw.usage,
    outcome: message ? "ok" : "error",
    statusCode: response.status,
    response: raw,
  });
  if (!message) {
    return { ok: false, error: "outreach_format_invalid", status: 502 };
  }
  return {
    ok: true,
    subject: channel === "email" ? message.subject || "" : "",
    body: message.body || "",
    locale: outreachLocale,
  };
}
