import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What Chanlyst stores about you and the channels it finds, who it is shared with, and how to have it removed.",
  alternates: { canonical: "/privacy" },
};

import LegalDocument from "../components/legal-document";

export default function PrivacyPage() {
  return <LegalDocument
    title={{ ru: "Политика конфиденциальности", en: "Privacy Policy" }}
    description={{
      ru: "Политика объясняет, какие данные Chanlyst получает, зачем они нужны и какие возможности контроля доступны пользователю.",
      en: "This Policy explains which data Chanlyst receives, why it is needed and which controls are available to users.",
    }}
    sections={{
      ru: [
        { title: "1. Какие данные мы обрабатываем", paragraphs: ["Мы можем обрабатывать данные аккаунта (имя и email), описание добавленных продуктов, выбранные площадки, созданные сообщения, настройки интеграций, сведения о подписке, обращения в поддержку и технические журналы безопасности.", "Токены и ключи подключённых сервисов хранятся на сервере в зашифрованном виде, когда соответствующая защищённая конфигурация включена. Мы не показываем сохранённые секреты в браузере."] },
        { title: "2. Цели и основания", paragraphs: ["Данные используются для предоставления функций Chanlyst, выполнения запрошенных интеграций, поддержки, предотвращения злоупотреблений, расчёта лимитов и исполнения договорных или юридических обязанностей.", "Мы не продаём персональные данные и не используем содержимое проектов для рекламного профилирования."] },
        { title: "3. Поставщики", paragraphs: ["Для работы сервиса могут использоваться Cloudflare (инфраструктура и хранение), OpenRouter и выбранные AI-провайдеры (анализ), Google/Gmail (отправка писем из подключённого вами ящика), а также Merchant of Record (оплата и налоги). Переходы в Telegram и LinkedIn выполняются вручную и подчиняются политикам этих платформ.", "Каждому поставщику передаётся только объём данных, необходимый для запрошенной функции."] },
        { title: "4. Хранение", paragraphs: ["Данные аккаунта и проектов хранятся, пока аккаунт активен или пока это необходимо для работы сервиса. Обращения поддержки и записи о согласиях могут храниться дольше для безопасности и исполнения закона. Платёжные документы хранятся в сроки, установленные налоговыми правилами.", "После подтверждённого запроса на удаление данные удаляются или обезличиваются, кроме сведений, которые мы обязаны сохранить."] },
        { title: "5. Ваши права", paragraphs: ["В зависимости от вашей юрисдикции вы можете запросить доступ, исправление, экспорт, ограничение обработки или удаление данных, а также отозвать согласие. Отключить интеграцию можно в интерфейсе или через поддержку.", "Для запроса используйте форму на странице «Контакты». Мы можем запросить подтверждение личности перед выполнением запроса."] },
        { title: "6. Cookies и аналитика", paragraphs: ["Chanlyst считает посещения публичных страниц собственными средствами: без cookie, без сторонних сервисов и без данных, по которым можно узнать человека. Отказаться от этого нельзя, потому что отказываться не от чего — мы не знаем, кто вы.", "Отдельно мы записываем поведение на публичных страницах через Microsoft Clarity: движения мыши, клики и прокрутку. Вводимый текст Clarity маскирует. Если вы находитесь в Великобритании или Европе, мы сначала спрашиваем: скрипт не загружается, пока вы не нажали «Можно», а отказ или закрытие баннера означает, что записи нет. За их пределами запись начинается без баннера. Ваш отказ, однажды данный, действует везде и не спрашивается повторно. Внутри рабочего пространства запись не ведётся никогда.", "Решение хранится в localStorage вашего браузера и меняется очисткой данных сайта. Для авторизации, безопасности и языка используются только необходимые технологии."] },
        { title: "7. Международная обработка и безопасность", paragraphs: ["Поставщики могут обрабатывать данные в других странах. Мы выбираем поставщиков с договорными и техническими мерами защиты и используем шифрование при передаче.", "Ни одна система не гарантирует абсолютную безопасность. При существенном инциденте мы уведомим затронутых пользователей и органы, если этого требует закон."] },
        { title: "8. Контакты", paragraphs: ["Вопросы о конфиденциальности и запросы субъектов данных принимаются через официальную контактную форму Chanlyst."] },
      ],
      en: [
        { title: "1. Data we process", paragraphs: ["We may process account data (name and email), submitted product descriptions, selected prospects, drafted messages, integration settings, subscription information, support requests and security logs.", "Connected-service tokens and keys are stored server-side in encrypted form when the required secure configuration is enabled. Saved secrets are never displayed back in the browser."] },
        { title: "2. Purposes and legal bases", paragraphs: ["We use data to provide Chanlyst, perform requested integrations, support users, prevent abuse, apply plan limits and meet contractual or legal obligations.", "We do not sell personal data or use project content for advertising profiles."] },
        { title: "3. Service providers", paragraphs: ["The service may use Cloudflare for infrastructure and storage; OpenRouter and selected AI providers for analysis; Google/Gmail to send email from the mailbox you connect; and a Merchant of Record for payments and taxes. Telegram and LinkedIn hand-offs are manual and governed by those platforms.", "Each provider receives only the information required for the requested function."] },
        { title: "4. Retention", paragraphs: ["Account and project data is retained while the account remains active or as needed to operate the service. Support, consent and security records may be kept longer for legitimate compliance needs. Payment records are retained for legally required tax periods.", "Following a verified deletion request, data is deleted or de-identified unless retention is legally required."] },
        { title: "5. Your rights", paragraphs: ["Depending on your jurisdiction, you may request access, correction, export, restriction or deletion and may withdraw consent. Integrations can be disconnected in the interface or through support.", "Submit requests through the Contact page. We may verify your identity before acting on a request."] },
        { title: "6. Cookies and analytics", paragraphs: ["Chanlyst counts visits to public pages itself: no cookie, no third party, and nothing that identifies a person. There is no opt-out because there is nothing to opt out of — we do not know who you are.", "Separately, behaviour on public pages is recorded through Microsoft Clarity: mouse movement, clicks and scrolling. Text you type is masked by Clarity. In the UK and Europe we ask first: the script does not load until you press Allow, and declining or ignoring the banner means no recording happens. Outside those regions recording starts without a banner. A refusal, once given, applies everywhere and is not asked again. Inside the workspace nothing is ever recorded.", "The choice is stored in your browser localStorage and can be changed by clearing site data. Authentication, security and language use only strictly necessary technologies."] },
        { title: "7. International processing and security", paragraphs: ["Providers may process data in other countries. We select providers with contractual and technical safeguards and use encryption in transit.", "No system can guarantee absolute security. We will notify affected users and authorities of a material incident where legally required."] },
        { title: "8. Contact", paragraphs: ["Privacy questions and data-subject requests can be submitted through the official Chanlyst contact form."] },
      ],
    }}
  />;
}
