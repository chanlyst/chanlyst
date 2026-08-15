import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Acceptable use",
  description:
    "What Chanlyst may and may not be used for, including the rules around outreach and the platforms it opens.",
  alternates: { canonical: "/acceptable-use" },
};

import LegalDocument from "../components/legal-document";

export default function AcceptableUsePage() {
  return <LegalDocument
    title={{ ru: "Правила допустимого использования", en: "Acceptable Use Policy" }}
    description={{
      ru: "Chanlyst предназначен для законного исследования рынка и адресного делового взаимодействия с контролем пользователя.",
      en: "Chanlyst is intended for lawful market research and relevant business communication under user control.",
    }}
    sections={{
      ru: [
        { title: "Разрешённые сценарии", paragraphs: ["Вы можете анализировать собственные продукты, изучать публично доступные компании и площадки, готовить персонализированные предложения и отправлять их после ручной проверки при наличии законного основания."], items: ["Партнёрские предложения и affiliate outreach", "Связь с редакциями, авторами и отраслевыми сообществами", "B2B-продажи релевантным организациям", "Исследование каналов привлечения и конкурентов"] },
        { title: "Запрещённые действия", paragraphs: ["Запрещено использовать Chanlyst для незаконной, вводящей в заблуждение или вредоносной деятельности."], items: ["Спам, скрытая массовая рассылка и обход ограничений платформ", "Покупка, загрузка или эксплуатация незаконно полученных баз данных", "Фишинг, мошенничество, вредоносное ПО или выдача себя за другое лицо", "Контактирование несовершеннолетних с коммерческими предложениями для взрослых", "Дискриминация, угрозы, преследование или эксплуатация уязвимых лиц", "Сбор закрытых данных, обход авторизации, CAPTCHA или технических запретов", "Нарушение санкций, экспортных ограничений, прав интеллектуальной собственности или правил платформ"] },
        { title: "Обязанности пользователя", paragraphs: ["До отправки сообщения пользователь обязан проверить источник контакта, релевантность адресата, требования применимого законодательства и правила выбранного канала, обеспечить возможность отказа от дальнейших сообщений, когда это требуется.", "AI-рейтинг является теоретической оценкой и не заменяет человеческую проверку."] },
        { title: "Меры реагирования", paragraphs: ["Мы можем временно остановить отправку, запросить объяснение, ограничить интеграцию или закрыть аккаунт при признаках злоупотребления. Серьёзные нарушения могут быть переданы компетентным органам в установленном законом порядке."] },
      ],
      en: [
        { title: "Permitted uses", paragraphs: ["You may analyze your own products, research publicly accessible organizations and channels, prepare personalized proposals and send them after human review where a lawful basis exists."], items: ["Partnership and affiliate proposals", "Outreach to editors, creators and professional communities", "Relevant B2B sales communication", "Acquisition-channel and competitor research"] },
        { title: "Prohibited conduct", paragraphs: ["Chanlyst must not be used for unlawful, deceptive or harmful activity."], items: ["Spam, concealed bulk messaging or circumvention of platform limits", "Buying, uploading or exploiting unlawfully obtained contact databases", "Phishing, fraud, malware or impersonation", "Targeting minors with adult commercial offers", "Discrimination, threats, harassment or exploitation of vulnerable people", "Collecting private data or bypassing authentication, CAPTCHAs or technical restrictions", "Violating sanctions, export controls, intellectual-property rights or platform policies"] },
        { title: "User responsibilities", paragraphs: ["Before sending, users must verify the source and relevance of a contact, applicable legal requirements and channel rules, and provide opt-out mechanisms where required.", "AI rankings are theoretical assessments and do not replace human review."] },
        { title: "Enforcement", paragraphs: ["We may pause sending, request an explanation, restrict an integration or close an account where abuse is suspected. Serious violations may be reported to competent authorities as permitted or required by law."] },
      ],
    }}
  />;
}
