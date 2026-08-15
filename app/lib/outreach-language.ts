export type OutreachLocale = "ru" | "en";

type ProductLanguageContext = {
  languages?: string;
  geography?: string;
  audience?: string;
};

const englishLanguageSignals =
  /(^|[\s,;/])(english|eng|en)(?=$|[\s,;/])/i;
const russianLanguageSignals =
  /(^|[\s,;/])(russian|ru|русский|русскоязычный|русскоязычная)(?=$|[\s,;/])/i;
const englishMarketSignals =
  /(usa|u\.s\.|united states|uk|u\.k\.|united kingdom|canada|australia|new zealand|europe|global|worldwide)/i;
const russianMarketSignals =
  /(russia|belarus|kazakhstan|россия|россии|беларусь|казахстан|снг)/i;

export function resolveOutreachLocale(
  product: ProductLanguageContext,
  fallback: OutreachLocale = "en",
): OutreachLocale {
  const languages = String(product.languages || "").trim();
  const geography = String(product.geography || "").trim();
  const audience = String(product.audience || "").trim();

  if (englishLanguageSignals.test(languages)) return "en";
  if (russianLanguageSignals.test(languages)) return "ru";
  if (englishMarketSignals.test(geography)) return "en";
  if (russianMarketSignals.test(geography)) return "ru";
  if (englishMarketSignals.test(audience)) return "en";
  if (russianMarketSignals.test(audience)) return "ru";
  return fallback;
}
