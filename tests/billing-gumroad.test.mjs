import assert from "node:assert/strict";
import test from "node:test";
import {
  constantTimeEquals,
  firstString,
  permalinkOf,
  planFromPermalink,
  resolvePlan,
  statusFromResource,
} from "../app/lib/billing-gumroad-core.mjs";

const urls = {
  starter: {
    monthly: "https://chanlyst.gumroad.com/l/starter-m",
    annual: "https://chanlyst.gumroad.com/l/starter-y",
  },
  pro: {
    monthly: "https://chanlyst.gumroad.com/l/pro-m?wanted=true",
    annual: "https://chanlyst.gumroad.com/l/pro-y",
  },
  scale: { monthly: "https://chanlyst.gumroad.com/l/scale-m", annual: undefined },
};

// --- permalinkOf ------------------------------------------------------------

test("permalinkOf извлекает permalink и игнорирует query и якорь", () => {
  assert.equal(permalinkOf("https://chanlyst.gumroad.com/l/pro-m"), "pro-m");
  assert.equal(permalinkOf("https://chanlyst.gumroad.com/l/pro-m?wanted=true"), "pro-m");
  assert.equal(permalinkOf("https://chanlyst.gumroad.com/l/pro-m#buy"), "pro-m");
});

test("permalinkOf не падает на пустых и посторонних значениях", () => {
  assert.equal(permalinkOf(undefined), "");
  assert.equal(permalinkOf(""), "");
  assert.equal(permalinkOf("https://chanlyst.gumroad.com/"), "");
  assert.equal(permalinkOf(42), "");
});

// --- planFromPermalink ------------------------------------------------------

test("planFromPermalink находит тариф и период по permalink", () => {
  assert.deepEqual(planFromPermalink("starter-y", urls), {
    plan: "starter",
    interval: "annual",
  });
  assert.deepEqual(planFromPermalink("pro-m", urls), {
    plan: "pro",
    interval: "monthly",
  });
});

test("planFromPermalink нечувствителен к регистру", () => {
  assert.deepEqual(planFromPermalink("PRO-Y", urls), {
    plan: "pro",
    interval: "annual",
  });
});

test("planFromPermalink возвращает null для неизвестного товара", () => {
  assert.equal(planFromPermalink("unknown", urls), null);
  assert.equal(planFromPermalink("", urls), null);
  assert.equal(planFromPermalink("pro-m", null), null);
});

// --- statusFromResource -----------------------------------------------------

test("покупка и возобновление дают активную подписку", () => {
  for (const resource of [
    "sale",
    "subscription_restarted",
    "subscription_updated",
    "dispute_won",
  ]) {
    assert.equal(statusFromResource(resource, null), "active", resource);
  }
});

test("отмена оставляет статус cancelled, а не expired", () => {
  // Доступ должен сохраняться до конца оплаченного периода.
  assert.equal(statusFromResource("cancellation", null), "cancelled");
});

test("возврат, спор и окончание подписки закрывают доступ", () => {
  for (const resource of ["refund", "dispute", "subscription_ended"]) {
    assert.equal(statusFromResource(resource, null), "expired", resource);
  }
});

test("возврат средств перекрывает тип события", () => {
  // Даже если Gumroad прислал sale, но продажа возвращена — доступа нет.
  assert.equal(statusFromResource("sale", { refunded: true }), "expired");
  assert.equal(statusFromResource("sale", { chargedback: true }), "expired");
  assert.equal(statusFromResource("sale", { access_revoked: true }), "expired");
});

test("неизвестное событие не меняет подписку", () => {
  assert.equal(statusFromResource("something_else", null), "");
});

// --- constantTimeEquals -----------------------------------------------------

test("constantTimeEquals сравнивает секреты корректно", () => {
  assert.equal(constantTimeEquals("secret", "secret"), true);
  assert.equal(constantTimeEquals("secret", "secreT"), false);
  assert.equal(constantTimeEquals("secret", "secret-longer"), false);
  assert.equal(constantTimeEquals("", ""), true);
  assert.equal(constantTimeEquals(null, ""), true);
  assert.equal(constantTimeEquals(undefined, "x"), false);
});

// --- firstString ------------------------------------------------------------

test("firstString берёт первое непустое строковое поле", () => {
  const source = { a: "", b: "   ", c: "value", d: "other" };
  assert.equal(firstString(source, ["a", "b", "c", "d"]), "value");
  assert.equal(firstString(source, ["missing"]), null);
  assert.equal(firstString(null, ["a"]), null);
});

test("firstString игнорирует нестроковые значения", () => {
  assert.equal(firstString({ a: 5, b: true, c: "ok" }, ["a", "b", "c"]), "ok");
});

// Отмена и часть уведомлений о подписке приходят с одним номером подписки,
// без ссылки на товар. Раньше такое событие подставляло "pro": клиент Starter
// бесплатно получал лимиты Pro, а клиент Scale их терял.
test("событие без данных о товаре не меняет тариф", () => {
  assert.equal(resolvePlan(null, "starter"), "starter");
  assert.equal(resolvePlan(undefined, "scale"), "scale");
  assert.equal(resolvePlan({ plan: undefined }, "starter"), "starter");
});

test("ссылка товара важнее записанного тарифа: это и есть смена тарифа", () => {
  assert.equal(resolvePlan({ plan: "scale" }, "starter"), "scale");
});

test("первая покупка без распознанной ссылки остаётся на pro", () => {
  assert.equal(resolvePlan(null, ""), "pro");
  assert.equal(resolvePlan(null), "pro");
});
