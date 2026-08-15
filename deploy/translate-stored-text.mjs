// One-off: translates text that was written before the interface language
// reached the prompts.
//
// Four AI paths used to answer "which language?" differently — analysis
// followed the interface, discovery answered in whatever the Russian prompt
// pulled it toward, prefill followed the language of the site it read. All
// four agree now, but the rows written earlier keep the text they were saved
// with, because the text is stored rather than translated on display.
//
// This is deliberately narrow: only free-text fields a human reads, only rows
// that actually contain Cyrillic, and never a domain, URL, e-mail or enum.
// Run with --dry to see what would change and what it would cost.
//
//   node deploy/translate-stored-text.mjs <db-path> [--dry] [--limit N]

import { DatabaseSync } from "node:sqlite";

const API = "https://openrouter.ai/api/v1/responses";
const MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-5.2";
/** Rows per request: small enough that one bad batch costs little to redo. */
const BATCH = 8;

/** Columns holding model-written prose, per table. */
const CHANNEL_FIELDS = [
  "description",
  "reason",
  "next_action",
  "pricing_summary",
  "placement_requirements",
  "usage_terms",
  "relevance_reason",
];
const PRODUCT_FIELDS = [
  "description",
  "audience",
  "negative_audience",
  "monetization_model",
  "paid_offer",
  "price_range",
  "payment_point",
  "conversion_event",
  "attribution_method",
  "partner_terms",
];

const hasCyrillic = (value) => /[а-яё]/i.test(String(value || ""));

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
        },
      },
    },
  },
};

/**
 * @param {Array<{id: string, text: string}>} items
 * @param {string} token
 */
async function translate(items, token) {
  const list = items
    .map((item) => `${item.id}\t${item.text.replace(/\s+/g, " ")}`)
    .join("\n");
  const prompt = `Translate each line into natural English.

Each line is "<id>\\ttext". Return one item per id with the translation only.

Rules:
- Keep product names, company names, domains, URLs and prices exactly as they are.
- Keep the meaning and the length; do not embellish, do not add claims.
- Text already in English comes back unchanged.
- No quotes around the result, no explanations.

${list}`;

  const response = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://chanlyst.com",
      "X-OpenRouter-Title": "Chanlyst",
    },
    body: JSON.stringify({
      model: MODEL,
      input: prompt,
      reasoning: { effort: "low" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "chanlyst_translation",
          strict: true,
          schema,
        },
      },
      max_output_tokens: 4000,
    }),
  });
  const raw = await response.json();
  const text = (raw.output || [])
    .flatMap((item) => item.content || [])
    .map((part) => part.text || "")
    .join("");
  const cost = Number(raw.usage?.cost || 0);
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const slice = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    parsed = slice ? JSON.parse(slice) : null;
  }
  return { items: parsed?.items || [], cost, ok: response.ok };
}

async function main() {
  const dbPath = process.argv[2];
  const dry = process.argv.includes("--dry");
  const token = process.env.OPENROUTER_API_KEY;
  if (!dbPath) throw new Error("укажите путь к базе");
  if (!token && !dry) throw new Error("OPENROUTER_API_KEY не задан");

  const db = new DatabaseSync(dbPath, { readOnly: Boolean(dry) });

  /** @type {Array<{key: string, table: string, id: string, column: string, text: string}>} */
  const pending = [];
  const collect = (table, idColumn, fields, where = "") => {
    const rows = db
      .prepare(`SELECT ${idColumn} AS id, ${fields.join(", ")} FROM ${table} ${where}`)
      .all();
    for (const row of rows) {
      for (const column of fields) {
        if (hasCyrillic(row[column])) {
          pending.push({
            key: `${table}:${row.id}:${column}`,
            table,
            id: row.id,
            column,
            text: String(row[column]),
          });
        }
      }
    }
  };
  // Curated rows are the leftover demo data, not findings: paying to translate
  // channels that may be deleted tomorrow is money for nothing.
  collect("prospects", "id", CHANNEL_FIELDS, "WHERE origin <> 'curated'");
  collect("products", "id", PRODUCT_FIELDS);

  console.log(`полей с русским текстом: ${pending.length}`);
  const byTable = {};
  for (const item of pending) byTable[item.table] = (byTable[item.table] || 0) + 1;
  console.log("  по таблицам:", JSON.stringify(byTable));

  if (dry) {
    for (const item of pending.slice(0, 5)) {
      console.log(`  ${item.table}.${item.column}: ${item.text.slice(0, 70)}…`);
    }
    console.log("(--dry: ничего не изменено)");
    return;
  }

  let spent = 0;
  let updated = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    const slice = pending.slice(i, i + BATCH);
    const { items, cost, ok } = await translate(
      slice.map((item, index) => ({ id: String(index), text: item.text })),
      token,
    );
    spent += cost;
    if (!ok || !items.length) {
      console.log(`  партия ${i / BATCH + 1}: перевод не получен, строки оставлены как есть`);
      continue;
    }
    for (const result of items) {
      const source = slice[Number(result.id)];
      const value = String(result.text || "").trim();
      // An empty or still-Cyrillic answer is not an improvement: leave the row.
      if (!source || !value || hasCyrillic(value)) continue;
      db.prepare(`UPDATE ${source.table} SET ${source.column}=? WHERE id=?`).run(
        value,
        source.id,
      );
      updated += 1;
    }
    console.log(
      `  партия ${i / BATCH + 1}: обновлено ${updated} из ${i + slice.length}, потрачено $${spent.toFixed(4)}`,
    );
  }
  console.log(`\nготово: обновлено ${updated} полей, потрачено $${spent.toFixed(4)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
