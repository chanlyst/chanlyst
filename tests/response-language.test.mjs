import assert from "node:assert/strict";
import test from "node:test";
import {
  languageRule,
  normaliseLocale,
  responseLanguage,
} from "../app/lib/response-language.mjs";

test("the interface locale picks the language", () => {
  assert.equal(responseLanguage("en"), "English");
  assert.equal(responseLanguage("ru"), "Russian");
});

// The fallback used to be Russian, from when the product was Russian-first.
// It outlived that: the public site, the interface and the outreach drafts are
// all English by default, so a locale that fails to arrive should not be the
// one thing that answers in Russian.
test("an unusable locale falls back to English rather than to nothing", () => {
  for (const value of ["", null, undefined, "de", 42, {}]) {
    assert.equal(normaliseLocale(value), "en");
    assert.equal(responseLanguage(value), "English");
  }
  // Russian is still reachable — it just has to be asked for.
  assert.equal(normaliseLocale("ru-RU"), "ru");
  assert.equal(responseLanguage("RU"), "Russian");
  // Browser-style tags still resolve: "en-US" is English, not the fallback.
  assert.equal(normaliseLocale("en-US"), "en");
  assert.equal(responseLanguage("EN"), "English");
});

// The observed failure was not "answered in the wrong language" but "answered
// in both": a card read "Your audience … actively сравнивает и выбирает …
// инструменты". The rule has to forbid that explicitly.
test("the rule names the language and forbids mixing inside a field", () => {
  const rule = languageRule("en");

  assert.match(rule, /Язык всех текстовых полей ответа: English\./);
  assert.match(rule, /Не смешивай языки внутри одного поля/);
  // Renaming a channel or translating its domain would corrupt the data.
  assert.match(rule, /Названия площадок, домены и ссылки оставляй как есть/);
});
