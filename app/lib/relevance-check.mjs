import { describeIdentity, isIdentityEmpty } from "./site-identity.mjs";
import { languageRule } from "./response-language.mjs";

// Does this channel actually fit the product?
//
// The question sounds like the one discovery already answers, but it is asked
// against different evidence. Discovery judges a candidate by what the model
// believes about it. This step judges it by what the site says about itself,
// fetched from the site. That is the gap the retirement forum walked through:
// the model's description of it ("adult lifestyle directory, accepts media
// kits") was plausible, and the page's own description ("resource for active
// adults 55+") settles it in one line.
//
// The verdict never deletes anything. A wrong "doubtful" costs the user one
// glance at a grouped-off card; a wrong drop costs a channel they will never
// know existed.

/** A fit we have no reason to doubt. */
export const RELEVANCE_OK = "ok";

/** Live, real, and aimed somewhere else. Grouped off, never deleted. */
export const RELEVANCE_DOUBTFUL = "doubtful";

/** The page told us nothing, so nobody judged it. Not a verdict. */
export const RELEVANCE_UNKNOWN = "unknown";

export const RELEVANCE_VALUES = [
  RELEVANCE_OK,
  RELEVANCE_DOUBTFUL,
  RELEVANCE_UNKNOWN,
];

/** Beyond this, a run costs more to check than the channels are worth. */
export const MAX_RELEVANCE_CANDIDATES = 12;

/** Reason text kept short: it goes on a card, not into a report. */
export const MAX_REASON_CHARS = 160;

export const relevanceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "verdict", "reason"],
        properties: {
          index: { type: "integer" },
          verdict: { type: "string", enum: [RELEVANCE_OK, RELEVANCE_DOUBTFUL] },
          reason: { type: "string" },
        },
      },
    },
  },
};

/**
 * The candidates worth asking about: those whose page we actually read. A
 * site we could not fetch is not sent to the judge, because the judge would
 * then be scoring the model's own description again — the very thing this
 * step exists to cross-check.
 *
 * @template {{url?: string, company?: string, identity?: object}} T
 * @param {readonly T[]} results
 * @returns {Array<{index: number, company: string, url: string, identity: object}>}
 */
export function relevanceCandidates(results) {
  const candidates = [];
  (results || []).forEach((item, index) => {
    if (!item || isIdentityEmpty(item.identity)) return;
    candidates.push({
      index,
      company: String(item.company || ""),
      url: String(item.url || ""),
      identity: item.identity,
    });
  });
  return candidates.slice(0, MAX_RELEVANCE_CANDIDATES);
}

/**
 * @param {{product: object, candidates: Array<{index: number, company: string, identity: object}>, locale?: string}} input
 * @returns {string}
 */
export function buildRelevancePrompt({ product, candidates, locale = "ru" }) {
  const profile = [
    `Продукт: ${product?.name || ""}`,
    `Что это: ${product?.description || product?.analysis?.summary || ""}`,
    `Категория: ${product?.category || ""}`,
    `Аудитория: ${product?.audience || ""}`,
    product?.negativeAudience ? `НЕ аудитория: ${product.negativeAudience}` : "",
    product?.geography ? `География: ${product.geography}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const list = (candidates || [])
    .map(
      (candidate) =>
        `${candidate.index}. ${candidate.company} — ${describeIdentity(
          candidate.identity,
        )}`,
    )
    .join("\n");

  return `Ты проверяешь список площадок, найденных для продвижения продукта.

${profile}

Ниже площадки. Описание каждой взято С САМОГО САЙТА (title и meta description), это не пересказ — доверяй ему больше, чем названию площадки.

${list}

Для каждой площадки ответь, подходит ли она как канал привлечения для этого продукта.

"${RELEVANCE_OK}" — площадка работает с этой аудиторией или тематикой, размещение там осмысленно. Рекламные сети, каталоги, сообщества и медиа в смежной нише — это ok, даже если сам сайт продукт не продаёт.

"${RELEVANCE_DOUBTFUL}" — площадка живая и настоящая, но аудитория или тематика другая. Частый случай: совпало ключевое слово, а смысл разный (например "adult" в значении "18+" против "adult" в значении "взрослые люди 55+").

Причина — одна короткая фраза по существу расхождения. Не пиши общих слов.
${languageRule(locale)}

Верни JSON: {"verdicts":[{"index":<номер из списка>,"verdict":"${RELEVANCE_OK}"|"${RELEVANCE_DOUBTFUL}","reason":"..."}]}. Каждая площадка ровно один раз.`;
}

/**
 * Merges verdicts back onto the results by index.
 *
 * Anything the judge did not answer for stays `unknown` and is treated as a
 * normal channel: silence from the judge is not evidence against a candidate.
 *
 * @template {object} T
 * @param {readonly T[]} results
 * @param {{verdicts?: Array<{index?: unknown, verdict?: unknown, reason?: unknown}>} | null | undefined} judgement
 * @returns {Array<T & {relevance: string, relevanceReason: string}>}
 */
export function applyRelevanceVerdicts(results, judgement) {
  const byIndex = new Map();
  for (const entry of judgement?.verdicts || []) {
    const index = Number(entry?.index);
    const verdict = String(entry?.verdict || "");
    if (!Number.isInteger(index)) continue;
    if (verdict !== RELEVANCE_OK && verdict !== RELEVANCE_DOUBTFUL) continue;
    // A repeated index keeps the first answer: re-answering the same
    // candidate differently is not a signal we can act on.
    if (byIndex.has(index)) continue;
    byIndex.set(index, {
      verdict,
      reason: String(entry?.reason || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_REASON_CHARS),
    });
  }

  return (results || []).map((item, index) => {
    const judged = byIndex.get(index);
    return {
      ...item,
      relevance: judged?.verdict || RELEVANCE_UNKNOWN,
      relevanceReason: judged?.verdict === RELEVANCE_DOUBTFUL ? judged.reason : "",
    };
  });
}

/**
 * Counts for the run log: how many were checked and how many were grouped off.
 *
 * @param {readonly {relevance?: string}[]} results
 * @returns {{ok: number, doubtful: number, unknown: number}}
 */
export function summariseRelevance(results) {
  const summary = { ok: 0, doubtful: 0, unknown: 0 };
  for (const item of results || []) {
    const verdict = String(item?.relevance || RELEVANCE_UNKNOWN);
    if (verdict in summary) summary[verdict] += 1;
    else summary.unknown += 1;
  }
  return summary;
}
