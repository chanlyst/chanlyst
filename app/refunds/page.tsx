import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refunds and cancellation",
  description:
    "How to cancel a Chanlyst subscription, what happens to access you have already paid for, and when a refund applies.",
  alternates: { canonical: "/refunds" },
};

import LegalDocument from "../components/legal-document";

export default function RefundsPage() {
  return <LegalDocument
    title={{ ru: "Политика возвратов", en: "Refund Policy" }}
    description={{
      ru: "Мы хотим, чтобы условия покупки Chanlyst были понятны до оплаты.",
      en: "We want the terms of purchasing Chanlyst to be clear before payment.",
    }}
    sections={{
      ru: [
        { title: "1. Пробный период и первая покупка", paragraphs: ["Если на странице оплаты указан бесплатный пробный период, списание происходит после его окончания, если подписка не отменена заранее.", "Для первой оплаты нового аккаунта можно запросить возврат в течение 7 календарных дней после списания, если за этот период не было существенного использования оплаченных лимитов."] },
        { title: "2. Продления", paragraphs: ["Платежи за автоматическое продление обычно не возвращаются. Подписку можно отменить до следующей даты оплаты, сохранив доступ до конца оплаченного периода.", "Если списание произошло после своевременной отмены или дважды по ошибке, мы вернём ошибочную сумму после проверки."] },
        { title: "3. Техническая недоступность", paragraphs: ["При подтверждённой длительной недоступности платных функций по нашей вине мы можем предоставить пропорциональный возврат или продлить подписку. Плановое обслуживание и сбои сторонних интеграций оцениваются отдельно."] },
        { title: "4. Как запросить возврат", paragraphs: ["Отправьте запрос через страницу «Контакты», указав email аккаунта, дату и идентификатор платежа и краткую причину. Не отправляйте полные данные банковской карты.", "Решение обычно принимается в течение 5 рабочих дней. Одобренный возврат направляется на исходный способ оплаты; срок зачисления зависит от платёжного провайдера и банка."] },
        { title: "5. Злоупотребления", paragraphs: ["Мы можем отказать в возврате при мошенничестве, существенном использовании лимитов, нарушении правил допустимого использования или повторяющихся необоснованных запросах, если закон не требует иного. Права потребителя, установленные обязательным законодательством, сохраняются."] },
      ],
      en: [
        { title: "1. Trials and first purchase", paragraphs: ["If a free trial is shown at checkout, billing begins after the trial unless cancelled in advance.", "A new account may request a refund of its first charge within 7 calendar days, provided the paid usage allowance has not been materially consumed."] },
        { title: "2. Renewals", paragraphs: ["Automatic renewal charges are generally non-refundable. You may cancel before the next billing date and retain access through the paid period.", "If a charge occurs after a timely cancellation or is duplicated in error, we will refund the erroneous charge after verification."] },
        { title: "3. Service unavailability", paragraphs: ["For confirmed extended unavailability of paid functionality caused by us, we may provide a proportional refund or extend the subscription. Scheduled maintenance and third-party integration outages are assessed separately."] },
        { title: "4. Requesting a refund", paragraphs: ["Submit a request through the Contact page with the account email, payment date, transaction identifier and a short reason. Never send full payment-card details.", "We normally decide within 5 business days. Approved refunds return to the original payment method; settlement timing depends on the payment provider and bank."] },
        { title: "5. Abuse", paragraphs: ["We may decline refunds involving fraud, material consumption of plan limits, acceptable-use violations or repeated abusive requests unless applicable law requires otherwise. Mandatory consumer rights remain unaffected."] },
      ],
    }}
  />;
}
