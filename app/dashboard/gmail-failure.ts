import type { Locale } from "./i18n";

export function deliveryFailureMessage(code: string | undefined, locale: Locale) {
  const ru = locale === "ru";
  switch (code) {
    case "send_in_progress":
      return ru
        ? "Это письмо уже отправляется. Дождитесь завершения текущей попытки."
        : "This message is already being sent. Wait for the current attempt to finish.";
    case "gmail_delivery_unconfirmed":
      return ru
        ? "Gmail мог принять письмо, но подтверждение не получено. Подождите две минуты: при повторе Chanlyst сначала проверит папку «Отправленные»."
        : "Gmail may have accepted the message, but delivery was not confirmed. Wait two minutes; on retry, Chanlyst will check Sent first.";
    case "message_already_sent":
      return ru ? "Письмо уже отправлено." : "The message has already been sent.";
    case "gmail_reconnect_required":
    case "gmail_not_connected":
    case "provider_not_connected":
      return ru
        ? "Gmail нужно подключить заново — доступ истёк."
        : "Reconnect Gmail — its access has expired.";
    case "gmail_permission_required":
      return ru
        ? "Gmail не разрешает отправку. Переподключите аккаунт и подтвердите доступ к отправке писем."
        : "Gmail does not allow sending. Reconnect it and grant email sending access.";
    case "gmail_rate_limited":
      return ru
        ? "Gmail временно ограничил частоту отправки. Подождите и повторите позже."
        : "Gmail temporarily rate-limited sending. Wait and try again later.";
    case "gmail_service_unavailable":
      return ru
        ? "Gmail временно недоступен. Письмо не отправлено — повторите позже."
        : "Gmail is temporarily unavailable. The message was not sent; try again later.";
    case "gmail_request_rejected":
      return ru
        ? "Gmail отклонил запрос. Проверьте адрес, тему и текст письма."
        : "Gmail rejected the request. Check the address, subject, and message.";
    case "gmail_send_failed":
    case "gmail_refresh_failed":
    case "gmail_read_failed":
      return ru
        ? "Не удалось связаться с Gmail. Письмо не отправлено — попробуйте ещё раз."
        : "Could not reach Gmail. The message was not sent; try again.";
    case "lead_approval_required":
      return ru
        ? "Сначала одобрите контакт в списке выше."
        : "Approve the contact in the list above first.";
    case "verified_email_required":
    case "lead_not_qualified":
    case "no_recipient":
      return ru
        ? "У контакта нет подтверждённого email. Сначала уточните адрес."
        : "This contact has no verified email. Confirm it first.";
    case "recipient_suppressed":
      return ru
        ? "Этот получатель отказался от писем. Отправка заблокирована."
        : "This recipient opted out. Sending is blocked.";
    default:
      return ru ? "Не удалось выполнить действие." : "The action failed.";
  }
}

export function deliveryFailureNeedsReconnect(code: string | undefined) {
  return [
    "gmail_reconnect_required",
    "gmail_not_connected",
    "provider_not_connected",
    "gmail_permission_required",
  ].includes(code || "");
}
