// Чистая логика интеграции с Gumroad: разбор ссылок, сопоставление тарифов и
// перевод событий Gumroad во внутренние статусы подписки. Без обращений к сети
// и окружению — чтобы это можно было прогонять тестами.

/** Товар в Gumroad опознаётся по permalink в конце ссылки: .../l/<permalink>. */
export function permalinkOf(url) {
  if (!url || typeof url !== "string") return "";
  const match = url.match(/\/l\/([^/?#]+)/);
  return match ? match[1].toLowerCase() : "";
}

/**
 * Обратная карта permalink → тариф, построенная из тех же ссылок на оплату:
 * один источник правды, без второго списка идентификаторов товаров.
 */
export function planFromPermalink(permalink, urls) {
  const wanted = String(permalink || "").toLowerCase();
  if (!wanted || !urls) return null;
  for (const plan of Object.keys(urls)) {
    for (const interval of ["monthly", "annual"]) {
      if (permalinkOf(urls[plan]?.[interval]) === wanted) return { plan, interval };
    }
  }
  return null;
}

/**
 * Сопоставление события Gumroad с внутренним статусом подписки.
 * hasActiveAccess() трактует active/on_trial как доступ, а cancelled — как
 * доступ до даты endsAt, поэтому отмена не отключает оплату мгновенно.
 * Возврат и чарджбэк important: они перекрывают тип события.
 */
export function statusFromResource(resource, sale) {
  if (sale && (sale.refunded || sale.chargedback || sale.access_revoked)) {
    return "expired";
  }
  switch (resource) {
    case "sale":
    case "subscription_restarted":
    case "subscription_updated":
    case "dispute_won":
      return "active";
    case "cancellation":
      return "cancelled";
    case "refund":
    case "dispute":
    case "subscription_ended":
      return "expired";
    default:
      return "";
  }
}

/** Сравнение секретов без утечки длины совпадения по времени выполнения. */
export function constantTimeEquals(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/** Первое непустое строковое значение из списка возможных ключей. */
export function firstString(source, keys) {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/**
 * Какой тариф записать по событию Gumroad.
 *
 * Событие может ничего не знать о тарифе: отмена и часть уведомлений о
 * подписке приходят с одним номером подписки, без ссылки на товар. Раньше
 * такой случай подставлял "pro" — клиент Starter молча получал лимиты Pro,
 * а клиент Scale их терял. Событие, которое о тарифе не сообщает, менять
 * тариф не должно.
 *
 * @param {{plan?: string} | null} mapped тариф, распознанный по ссылке товара
 * @param {string} [storedPlan] тариф, уже записанный у этого пространства
 * @returns {string}
 */
export function resolvePlan(mapped, storedPlan = "") {
  return mapped?.plan || String(storedPlan || "") || "pro";
}
