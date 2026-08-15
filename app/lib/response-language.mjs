// Which language the model writes its user-visible text in.
//
// Product analysis already did this — it turns the interface locale into
// "Язык текстовых полей ответа: English." — but channel discovery never
// received the locale at all, and the relevance check had Russian hardcoded
// into its prompt. Both prompts are written in Russian, so with nothing
// pinning the answer the model drifted: on an English interface a channel
// card read "Your audience (SaaS/product teams/owners) actively сравнивает и
// выбирает sales/prospecting/outreach инструменты" — two languages in one
// sentence.
//
// Every prompt that produces text a user reads takes its language from here,
// so there is one answer to "which language?" instead of three.

/**
 * The locales the interface offers. Anything else falls back to English,
 * matching the public site, the interface default and the outreach drafts —
 * a missing locale used to mean Russian, which is how an English account
 * ended up with Russian channel descriptions.
 */
export const SUPPORTED_LOCALES = ["ru", "en"];

const LANGUAGE_NAMES = { ru: "Russian", en: "English" };

/**
 * @param {unknown} locale
 * @returns {"ru" | "en"}
 */
export function normaliseLocale(locale) {
  const value = String(locale || "").toLowerCase().slice(0, 2);
  return SUPPORTED_LOCALES.includes(value) ? /** @type {"ru"|"en"} */ (value) : "en";
}

/**
 * The language name to name inside a prompt.
 *
 * @param {unknown} locale
 * @returns {string}
 */
export function responseLanguage(locale) {
  return LANGUAGE_NAMES[normaliseLocale(locale)];
}

/**
 * The instruction itself. Stated as one line the model cannot read as advice:
 * the fields listed are the ones a user actually sees on a channel card, and
 * mixing languages inside a field is called out because that is the failure
 * that was observed, not a hypothetical one.
 *
 * @param {unknown} locale
 * @returns {string}
 */
export function languageRule(locale) {
  return `Язык всех текстовых полей ответа: ${responseLanguage(locale)}. Это относится к описанию, объяснению, следующему шагу, условиям и любым другим полям, которые читает пользователь. Не смешивай языки внутри одного поля. Названия площадок, домены и ссылки оставляй как есть.`;
}
