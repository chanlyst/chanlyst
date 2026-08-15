import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of service",
  description:
    "The agreement between you and Chanlyst: what the service does, what a subscription includes, and how either side can end it.",
  alternates: { canonical: "/terms" },
};

import LegalDocument from "../components/legal-document";

export default function TermsPage() {
  return <LegalDocument
    title={{ ru: "Условия использования", en: "Terms of Service" }}
    description={{
      ru: "Настоящие Условия регулируют использование Chanlyst — программного сервиса для исследования публичных каналов привлечения, оценки потенциальных партнёров и подготовки аутрич-сообщений.",
      en: "These Terms govern the use of Chanlyst, a software service for researching public acquisition channels, evaluating potential partners and preparing outreach drafts.",
    }}
    sections={{
      ru: [
        { title: "1. Сервис и оператор", paragraphs: ["Chanlyst предоставляется независимым разработчиком программного обеспечения под торговым наименованием Chanlyst (далее — «мы»). Официальные реквизиты оператора указываются в платёжных документах и предоставляются по законному запросу через форму обратной связи.", "Chanlyst помогает пользователю анализировать продукты, находить информацию в публичных источниках, ранжировать потенциальные каналы и создавать черновики сообщений. Результаты являются рекомендациями и требуют проверки пользователем."] },
        { title: "2. Право использования", paragraphs: ["Пользоваться сервисом могут лица старше 18 лет, способные заключить юридически обязательное соглашение. Вы обязуетесь предоставлять достоверную регистрационную и платёжную информацию и обеспечивать безопасность своего аккаунта."] },
        { title: "3. Подписка и оплата", paragraphs: ["Платные планы оплачиваются авансом за выбранный расчётный период. Итоговая цена, валюта, применимые налоги и период продления показываются до подтверждения покупки. Обработка платежей и налогов может выполняться уполномоченным Merchant of Record.", "Подписка продлевается автоматически, если иное не указано при покупке. Её можно отменить до следующей даты списания; доступ сохраняется до конца уже оплаченного периода."] },
        { title: "4. Интеграции", paragraphs: ["Подключая Gmail или другой внешний сервис, вы разрешаете Chanlyst выполнять только показанные в интерфейсе действия. Аутрич уходит через подключённый вами ящик Gmail; переходы в Telegram и LinkedIn остаются ручными. Использование сторонних сервисов также регулируется их собственными условиями.", "Chanlyst не отправляет аутрич без действия пользователя: одиночное письмо уходит по клику «Отправить», а серия писем — только после того, как пользователь её запустит, после чего она идёт по расписанию и автоматически останавливается при получении ответа. Вы несёте ответственность за адресата, законное основание, содержание и момент отправки."] },
        { title: "5. Данные и результаты", paragraphs: ["Информация о площадках может поступать из публичных источников и меняться без уведомления. Мы не гарантируем точность сторонних контактных данных, ответы получателей или коммерческий результат кампании.", "Вы сохраняете права на введённые материалы. Вы предоставляете нам ограниченное право обрабатывать их только для работы сервиса, безопасности и поддержки."] },
        { title: "6. Ограничение ответственности", paragraphs: ["Сервис предоставляется «как есть» в пределах, допускаемых законом. Chanlyst не является юридической консультацией и не гарантирует соответствие конкретной рассылки законодательству вашей страны или страны получателя.", "Совокупная ответственность Chanlyst по требованиям, связанным с платным сервисом, ограничивается суммой, уплаченной пользователем за последние три месяца, если применимое законодательство не требует иного."] },
        { title: "7. Приостановка и прекращение", paragraphs: ["Мы можем ограничить доступ при нарушении правил допустимого использования, угрозе безопасности, мошенничестве или требовании закона. Пользователь может прекратить использование сервиса и запросить удаление данных через страницу контактов."] },
        { title: "8. Изменения и связь", paragraphs: ["Существенные изменения условий публикуются на этой странице с новой датой вступления в силу. По вопросам условий используйте официальную форму на странице «Контакты»."] },
      ],
      en: [
        { title: "1. Service and operator", paragraphs: ["Chanlyst is provided by an independent software developer trading as Chanlyst (“we”, “us”). The operator’s formal details are shown in payment documents and are available in response to a lawful request submitted through our contact form.", "Chanlyst helps users analyze products, research public sources, rank potential channels and prepare outreach drafts. Outputs are recommendations that require user review."] },
        { title: "2. Eligibility", paragraphs: ["You must be at least 18 years old and able to enter into a binding agreement. You agree to provide accurate registration and payment information and to protect access to your account."] },
        { title: "3. Subscriptions and payment", paragraphs: ["Paid plans are billed in advance for the selected period. The final price, currency, applicable taxes and renewal period are shown before purchase. Payments and taxes may be handled by an authorized Merchant of Record.", "Subscriptions renew automatically unless stated otherwise at checkout. You may cancel before the next billing date and retain access through the paid period."] },
        { title: "4. Integrations", paragraphs: ["By connecting Gmail or another third-party service, you authorize only the actions shown in the interface. Outreach is sent through the Gmail account you connect; Telegram and LinkedIn hand-offs stay manual. Third-party services remain subject to their own terms.", "Chanlyst does not send outreach without a user action: a single email is sent when you click send, and an email series is sent only after you start it, after which it follows its schedule and stops automatically when a reply arrives. You are responsible for the recipient, lawful basis, content and timing of each communication."] },
        { title: "5. Data and outputs", paragraphs: ["Prospect information may originate from public sources and change without notice. We do not guarantee third-party contact accuracy, recipient responses or campaign performance.", "You retain rights to your submitted materials and grant us a limited right to process them solely to operate, secure and support the service."] },
        { title: "6. Liability", paragraphs: ["The service is provided “as is” to the extent permitted by law. Chanlyst is not legal advice and does not guarantee that a particular campaign complies with the laws applicable to you or the recipient.", "Our aggregate liability relating to a paid service is limited to the amount paid during the preceding three months unless applicable law requires otherwise."] },
        { title: "7. Suspension and termination", paragraphs: ["We may restrict access for acceptable-use violations, security threats, fraud or legal requirements. You may stop using the service and request data deletion through the contact page."] },
        { title: "8. Changes and contact", paragraphs: ["Material changes will be published here with a revised effective date. Questions about these Terms should be submitted through the official contact form."] },
      ],
    }}
  />;
}
