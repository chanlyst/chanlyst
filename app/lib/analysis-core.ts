import { env } from "cloudflare:workers";
import { getIntegrationSecret } from "./secret";
import {
  recordAiUsage,
  reportOpenRouterFailure,
  type OpenRouterUsage,
} from "./ai-usage";

// The product-analysis step, extracted out of app/api/analyze/route.ts so the
// interactive route and the "prepare everything" pipeline share exactly one
// implementation. The route keeps auth, the plan-quota check and the HTTP
// mapping; everything below is the model call itself.

export type AnalyzeInput = {
  locale?: "ru" | "en";
  id?: string;
  name?: string;
  website?: string;
  description?: string;
  geography?: string;
  category?: string;
  audience?: string;
  negativeAudience?: string;
  monetizationModel?: string;
  paidOffer?: string;
  priceRange?: string;
  paymentPoint?: string;
  conversionEvent?: string;
  attributionMethod?: string;
  partnerTerms?: string;
};

const acquisitionMotionIds = [
  "direct_sales",
  "partnerships",
  "affiliates",
  "directories",
  "creators",
  "communities",
  "content_seo",
  "paid_placements",
] as const;

type AcquisitionMotionId = (typeof acquisitionMotionIds)[number];

type RawAnalysis = {
  summary?: string;
  category?: string;
  audience?: string;
  negativeAudience?: string;
  offer?: string;
  channelTypes?: string[];
  searchQueries?: string[];
  competitors?: Array<{ name?: string; domain?: string }>;
  acquisitionMotions?: Array<{
    id?: string;
    score?: number;
    rationale?: string;
    firstAction?: string;
    timeToSignal?: string;
    budgetLevel?: string;
    kpi?: string;
  }>;
};

type OpenRouterResponse = {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: OpenRouterUsage;
};

export type ProductAnalysisResult = ReturnType<typeof parseAnalysis>;

/** What the analyze route turns into a Response, unchanged. */
export type AnalysisOutcome =
  | { ok: true; mode: "setup" | "live"; analysis: unknown }
  | {
      ok: false;
      error: "ai_credits_exhausted" | "openrouter_request_failed" | "analysis_format_invalid";
      status: 402 | 502;
    };

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    category: { type: "string" },
    audience: { type: "string" },
    negativeAudience: { type: "string" },
    offer: { type: "string" },
    channelTypes: {
      type: "array",
      items: { type: "string" },
      minItems: 4,
      maxItems: 8,
    },
    searchQueries: {
      type: "array",
      items: { type: "string" },
      minItems: 4,
      maxItems: 8,
    },
    /**
     * Named so the distribution gap has something to compare against: the
     * places a rival already occupies and this product does not. The model
     * proposes; the user confirms, because a wrong competitor sends a whole
     * analysis after the wrong audience.
     */
    competitors: {
      type: "array",
      minItems: 0,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          domain: { type: "string" },
        },
        required: ["name", "domain"],
      },
    },
    acquisitionMotions: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", enum: acquisitionMotionIds },
          score: { type: "integer", minimum: 0, maximum: 100 },
          rationale: { type: "string" },
          firstAction: { type: "string" },
          timeToSignal: { type: "string" },
          budgetLevel: {
            type: "string",
            enum: ["low", "medium", "high"],
          },
          kpi: { type: "string" },
        },
        required: [
          "id",
          "score",
          "rationale",
          "firstAction",
          "timeToSignal",
          "budgetLevel",
          "kpi",
        ],
      },
    },
  },
  required: [
    "summary",
    "category",
    "audience",
    "negativeAudience",
    "offer",
    "channelTypes",
    "searchQueries",
    "competitors",
    "acquisitionMotions",
  ],
} as const;

function outputText(response: OpenRouterResponse) {
  if (response.output_text) return response.output_text;
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text || "")
    .join("");
}

function parseAnalysis(text: string) {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed = JSON.parse(cleaned) as RawAnalysis;
  const ids = new Set<string>(acquisitionMotionIds);
  return {
    ...parsed,
    channelTypes: Array.isArray(parsed.channelTypes)
      ? parsed.channelTypes.slice(0, 8)
      : [],
    searchQueries: Array.isArray(parsed.searchQueries)
      ? parsed.searchQueries.slice(0, 8)
      : [],
    // Unconfirmed until the user says so: a suggestion is not a fact, and
    // this one decides where an entire gap analysis looks.
    competitors: (Array.isArray(parsed.competitors) ? parsed.competitors : [])
      .map((item) => ({
        name: String(item?.name || "").slice(0, 80).trim(),
        domain: String(item?.domain || "")
          .replace(/^https?:\/\//i, "")
          .replace(/^www\./i, "")
          .split("/")[0]
          .slice(0, 120)
          .trim()
          .toLowerCase(),
        confirmed: false,
      }))
      .filter((item) => item.name && item.domain)
      .slice(0, 5),
    acquisitionMotions: (parsed.acquisitionMotions || [])
      .filter((motion) => motion.id && ids.has(motion.id))
      .map((motion) => ({
        id: motion.id as AcquisitionMotionId,
        score: Math.max(0, Math.min(100, Math.round(Number(motion.score) || 0))),
        rationale: String(motion.rationale || "").slice(0, 500),
        firstAction: String(motion.firstAction || "").slice(0, 300),
        timeToSignal: String(motion.timeToSignal || "").slice(0, 100),
        budgetLevel: ["low", "medium", "high"].includes(
          String(motion.budgetLevel),
        )
          ? motion.budgetLevel
          : "low",
        kpi: String(motion.kpi || "").slice(0, 150),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5),
  };
}

function safeWebsite(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (
      url.hostname === "localhost" ||
      /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
        url.hostname,
      )
    ) return null;
    return url;
  } catch {
    return null;
  }
}

export async function runAnalysis(
  payload: AnalyzeInput,
  ctx: { workspaceId: string },
): Promise<AnalysisOutcome> {
  const bindings = env as unknown as {
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;
  };
  const openrouterKey =
    bindings.OPENROUTER_API_KEY ||
    (await getIntegrationSecret("openrouter", ctx.workspaceId));
  let pageText = "";
  const url = safeWebsite(payload.website);

  if (url) {
    try {
      const page = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": "Chanlyst Product Analyzer/1.0" },
      });
      if (page.ok) {
        pageText = (await page.text())
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .slice(0, 14000);
      }
    } catch {
      pageText = "";
    }
  }

  if (!openrouterKey) {
    return {
      ok: true,
      mode: "setup",
      analysis: {
        summary: payload.description || "Добавьте ключ OpenRouter, чтобы Chanlyst проанализировал продукт.",
        category: payload.category || "Не определена",
        audience: payload.audience || "",
        negativeAudience:
          payload.negativeAudience ||
          "Конкуренты и площадки без подтверждённого покупательского намерения",
        offer:
          payload.partnerTerms ||
          "Тестовое размещение с измеримым целевым действием",
        channelTypes: ["Обзорные сайты", "Авторы и сообщества", "Тематические каталоги"],
        searchQueries: [],
        acquisitionMotions: [
          {
            id: "partnerships",
            score: 82,
            rationale: "Партнёры уже владеют релевантной аудиторией и могут передавать измеримые конверсии.",
            firstAction: "Собрать 20 владельцев целевой аудитории и предложить небольшой тест.",
            timeToSignal: "1–3 недели",
            budgetLevel: "low",
            kpi: "Ответы и первые оплаты",
          },
        ],
      },
    };
  }

  // Russian only when it was asked for; anything else, including a missing
  // locale, answers in English like the rest of the product.
  const responseLanguage = payload.locale === "ru" ? "Russian" : "English";
  const prompt = `Ты — senior GTM-стратег Chanlyst. Проанализируй продукт независимо от сферы.
Название: ${payload.name || "не указано"}
Сайт: ${payload.website || "не указан"}
Описание пользователя: ${payload.description || "не указано"}
География: ${payload.geography || "не указана"}
Модель монетизации: ${payload.monetizationModel || "не указана"}
Платный продукт: ${payload.paidOffer || "не указан"}
Цена или средний чек: ${payload.priceRange || "не указаны"}
Где происходит оплата: ${payload.paymentPoint || "не указано"}
Целевая конверсия: ${payload.conversionEvent || "не указана"}
Атрибуция источника: ${payload.attributionMethod || "не указана"}
Условия партнёру: ${payload.partnerTerms || "не указаны"}
Текст сайта: ${pageText || "недоступен"}

Язык текстовых полей ответа: ${responseLanguage}.
Сначала выбери подходящую механику выхода на рынок, а уже затем каналы.
Сравни восемь механик: direct_sales, partnerships, affiliates, directories,
creators, communities, content_seo, paid_placements.
Оцени каждую по 0–100 с учётом покупательского поведения, среднего чека,
длины сделки, географии, доступного оффера, измеримости результата и вероятного
бюджета. Не ставь высокий балл прямым продажам для импульсного массового B2C и
не ставь высокий балл инфлюенсерам для узкого enterprise-продукта без причины.
Верни только 3–5 механик с баллом от 55, отсортированных по убыванию.
Первое действие должно быть конкретным и выполнимым, KPI — ранним измеримым
сигналом, а не общей целью вроде «рост продаж».

Определи не похожие продукты, а реальные источники, способные привести ПЛАТЯЩИХ клиентов.
Данные коммерческого брифа пользователя приоритетнее публичного текста сайта.
Верни полный ответ по заданной JSON-схеме. Не сокращай конкретные рекомендации.`;

  const model =
    bindings.OPENROUTER_MODEL || "openai/gpt-5.2";
  const attempts = [
    { maxOutputTokens: 3200, retryNote: "" },
    {
      maxOutputTokens: 4800,
      retryNote:
        "\nПредыдущий ответ не был завершён. Верни полный объект, заполнив все поля схемы.",
    },
  ];

  for (const [attemptIndex, attempt] of attempts.entries()) {
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
        reasoning: { effort: "medium" },
        input: `${prompt}${attempt.retryNote}`,
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "chanlyst_product_analysis",
            strict: true,
            schema: analysisSchema,
          },
        },
        max_output_tokens: attempt.maxOutputTokens,
      }),
    });

    const operation = attemptIndex === 0 ? "analyze" : "analyze_retry";
    if (!response.ok) {
      const failure = await reportOpenRouterFailure({
        response,
        operation,
        workspaceId: ctx.workspaceId,
        productId: payload.id,
        model,
      });
      if (failure.creditsExhausted) {
        return { ok: false, error: "ai_credits_exhausted", status: 402 };
      }
      return { ok: false, error: "openrouter_request_failed", status: 502 };
    }

    const raw = (await response.json()) as OpenRouterResponse;
    let analysis: ProductAnalysisResult | null = null;
    try {
      analysis = parseAnalysis(outputText(raw));
    } catch {
      analysis = null;
    }
    const isLastAttempt = attemptIndex === attempts.length - 1;
    // A discarded answer is billed exactly like a used one: record it as
    // "retry" (another attempt follows) or "error" (nothing usable came out).
    await recordAiUsage({
      workspaceId: ctx.workspaceId,
      productId: payload.id,
      operation,
      model,
      usage: raw.usage,
      outcome: analysis ? "ok" : isLastAttempt ? "error" : "retry",
      statusCode: response.status,
      response: raw,
    });

    if (analysis) return { ok: true, mode: "live", analysis };
    if (isLastAttempt) break;
  }

  return { ok: false, error: "analysis_format_invalid", status: 502 };
}
