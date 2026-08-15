// The FAQ, in one place because two things read it: the page renders it, and
// the structured data on the homepage repeats it for machines. Kept as data
// rather than markup so a question can never say one thing to a reader and
// another to a crawler.
//
// Both locales live here, and both are shaped identically — the page picks one
// by locale and the schema always takes the English one, because English is
// what the server renders and therefore what gets indexed.

/** @type {{ ru: string[][], en: string[][] }} */
export const FAQ = {
  ru: [
    ["Chanlyst сам отправляет сообщения?", "Ничего не уходит, пока вы не решите. Одиночное письмо отправляется по вашему клику. Серию писем вы запускаете отдельной кнопкой, после чего она идёт по расписанию и сама останавливается, как только адресат ответит. Вы видите адресата, канал и полный текст до отправки."],
    ["Можно добавить продукт из другой сферы?", "Да. Стратегия и поиск строятся отдельно для каждого продукта, его географии, цены и целевой аудитории."],
    ["Откуда берутся результаты?", "Из публично доступных страниц и подключённых пользователем сервисов. Chanlyst показывает ссылку на источник и не гарантирует актуальность сторонних данных."],
    ["Какие интеграции доступны?", "Одна — Gmail, для отправки писем из вашего собственного ящика. Telegram и LinkedIn интеграциями не являются: Chanlyst копирует готовый текст и открывает нужный диалог, дальше вы действуете сами."],
    ["Могут ли заблокировать мой аккаунт из-за Chanlyst?", "Chanlyst не подключается к Telegram и LinkedIn и ничего в них не отправляет: мы готовим текст и открываем диалог, а отправляете вы сами из своего браузера. Площадки блокируют инструменты, которые водят чужие аккаунты со своих серверов, — мы к ним не относимся. При этом правила площадок о нежелательных сообщениях распространяются на вас как на отправителя, поэтому пишите только тем, кому ваше предложение действительно уместно."],
  ],
  en: [
    ["Does Chanlyst send messages automatically?", "Nothing goes out until you decide. A single email is sent on your click. An email series is started by a separate button, after which it runs on its schedule and stops itself as soon as the recipient replies. You see the recipient, channel and full text before sending."],
    ["Can I add a product from another industry?", "Yes. Strategy and discovery are generated separately for each product, geography, price point and target audience."],
    ["Where do results come from?", "Publicly accessible pages and services connected by the user. Chanlyst links to the source and cannot guarantee third-party data remains current."],
    ["Which integrations are available?", "One — Gmail, to send email from your own mailbox. Telegram and LinkedIn are not integrations: Chanlyst copies the finished draft and opens the right conversation, and you take it from there."],
    ["Can my account get banned for using Chanlyst?", "Chanlyst does not connect to Telegram or LinkedIn and sends nothing on them: we prepare the text and open the conversation, you send it yourself from your own browser. Platforms ban tools that drive other people's accounts from their servers — that is not how this works. Their rules on unsolicited messages still apply to you as the sender, so write only to people your offer is genuinely relevant to."],
  ],
};
