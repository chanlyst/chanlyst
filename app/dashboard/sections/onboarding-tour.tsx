import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { planCatalog, type PlanId } from "../../lib/plans";
import type { Locale } from "../i18n";

const storagePrefix = "chanlyst.tour.";

// The narrative lives here rather than in i18n.ts on purpose: these strings are
// one story told in order, and a slide's words and its picture are edited
// together. Split across a 1000-line dictionary they drift apart within a week.

/**
 * Both screenshots are the real interface at 1760x1100, the same two the
 * README shows. A slide points at a rectangle inside one of them, given in
 * fractions of the image so the maths survives any display size.
 */
const SHOTS = {
  products: "/tour/products.png",
  channels: "/tour/channels.png",
  outreach: "/tour/outreach.png",
  results: "/tour/results.png",
  agent: "/tour/agent.png",
} as const;

type Focus = { x: number; y: number; w: number; h: number };

type Slide = {
  key: string;
  shot: keyof typeof SHOTS;
  /** Absent on the two establishing slides, which show the screen whole. */
  focus?: Focus;
  /** How much bigger than life the lens shows it. Small targets need more. */
  zoom?: number;
  step: { ru: string; en: string };
  title: { ru: string; en: string };
  body: { ru: string; en: string };
  /** The instruction chip pinned under the lens: what to actually press. */
  action?: { ru: string; en: string };
};

const SLIDES: Slide[] = [
  {
    key: "products-screen",
    shot: "products",
    step: { ru: "Экран «Продукты»", en: "The Products screen" },
    title: { ru: "Вот всё приложение", en: "This is the whole app" },
    body: {
      ru: "Слева пять разделов, справа выбранный продукт. Дальше мы пройдём по этому экрану и по «Каналам» — по шагу за раз.",
      en: "Five sections on the left, the selected product on the right. We will walk this screen and then Channels, one step at a time.",
    },
  },
  {
    key: "add-product",
    shot: "products",
    focus: { x: 0.9063, y: 0.0291, w: 0.0778, h: 0.0382 },
    zoom: 3.0,
    step: { ru: "Шаг 1", en: "Step 1" },
    title: { ru: "Добавьте продукт", en: "Add a product" },
    body: {
      ru: "Достаточно вставить адрес сайта: Chanlyst прочитает его сам и заполнит название, описание, географию и модель денег.",
      en: "Pasting the site address is enough: Chanlyst reads it and fills in the name, description, geography and how the money works.",
    },
    action: { ru: "Нажмите «+ Add product»", en: "Press “+ Add product”" },
  },
  {
    key: "passport",
    shot: "products",
    focus: { x: 0.2267, y: 0.4327, w: 0.3977, h: 0.0552 },
    zoom: 1.9,
    step: { ru: "Шаг 2", en: "Step 2" },
    title: { ru: "Паспорт продукта", en: "The product passport" },
    body: {
      ru: "Модель денег, период оплаты, где происходит оплата и что считается конверсией. От этих четырёх ответов зависит, что вообще искать.",
      en: "How the money works, the billing period, where payment happens and what counts as a conversion. These four answers decide what gets searched for.",
    },
  },
  {
    key: "prepare",
    shot: "products",
    focus: { x: 0.7825, y: 0.4412, w: 0.1011, h: 0.0382 },
    zoom: 3.0,
    step: { ru: "Шаг 2", en: "Step 2" },
    title: { ru: "Одна кнопка на весь прогон", en: "One button for the whole run" },
    body: {
      ru: "Анализ, поиск каналов, сбор контактов и черновики писем — пять этапов подряд. Каждый виден, каждый можно продолжить с места остановки.",
      en: "Analysis, channel discovery, contact collection and drafts — five stages in a row. Each one is visible and each can resume where it stopped.",
    },
    action: { ru: "Нажмите «Prepare everything»", en: "Press “Prepare everything”" },
  },
  {
    key: "strategy",
    shot: "products",
    focus: { x: 0.1812, y: 0.6644, w: 0.2475, h: 0.2091 },
    zoom: 1.7,
    step: { ru: "Шаг 2", en: "Step 2" },
    title: { ru: "Стратегия, а не список ключевых слов", en: "A strategy, not a keyword list" },
    body: {
      ru: "Как привлекать, что предлагать первым и какие типы каналов подходят именно этому продукту. Дальше поиск идёт под это.",
      en: "How to acquire, what to offer first, and which kinds of channel suit this product. The search that follows is built for that.",
    },
  },
  {
    key: "channels-screen",
    shot: "channels",
    step: { ru: "Экран «Каналы»", en: "The Channels screen" },
    title: { ru: "Второй экран — каналы", en: "The second screen: channels" },
    body: {
      ru: "Здесь настраивается поиск, лежат найденные площадки и открывается карточка каждой. Разберём его по частям.",
      en: "This is where the search is set up, where the found places live, and where each one opens. Let us take it apart.",
    },
  },
  {
    key: "lanes",
    shot: "channels",
    focus: { x: 0.1693, y: 0.2355, w: 0.8148, h: 0.2155 },
    zoom: 1.3,
    step: { ru: "Шаг 3", en: "Step 3" },
    title: { ru: "Шесть направлений поиска", en: "Six directions to search in" },
    body: {
      ru: "Открытый веб, отзовики, авторы, сообщества, каталоги и локальный поиск. Каждое ищет по-своему; один общий запрос вернул бы один общий список.",
      en: "Open web, reviews, creators, communities, directories and local search. Each looks its own way; one general query would return one general list.",
    },
    action: { ru: "Включите нужные направления", en: "Switch on the ones you need" },
  },
  {
    key: "find",
    shot: "channels",
    focus: { x: 0.8834, y: 0.2555, w: 0.0761, h: 0.0382 },
    zoom: 3.0,
    step: { ru: "Шаг 3", en: "Step 3" },
    title: { ru: "Запуск поиска", en: "Start the search" },
    body: {
      ru: "Дорожки идут параллельно и на две страницы выдачи вглубь. Кнопка называется «Search deeper», потому что каждый следующий прогон задаёт другие вопросы и стартует ниже — первая десятка результатов вам и так известна.",
      en: "The lanes run in parallel and two SERP pages deep. The button says “Search deeper” because each run asks different questions and starts lower down: the first ten results are ones you already know.",
    },
    action: { ru: "Нажмите «Search deeper»", en: "Press “Search deeper”" },
  },
  {
    key: "filters",
    shot: "channels",
    focus: { x: 0.2108, y: 0.6455, w: 0.468,  h: 0.0645 },
    zoom: 1.9,
    step: { ru: "Шаг 4", en: "Step 4" },
    title: { ru: "Разложено по способу входа", en: "Sorted by the way in" },
    body: {
      ru: "Куда можно подать самому, что стоит денег, где нужен живой человек. И отдельная группа «сомнительные» — площадки живые, но метящие в другую аудиторию: они не удаляются, а откладываются.",
      en: "Where you can submit yourself, what costs money, where a human is needed. Plus a doubtful group: sites that are real but aimed elsewhere, set aside rather than deleted.",
    },
    action: { ru: "Начните с «Self-service»", en: "Start with “Self-service”" },
  },
  {
    key: "row",
    shot: "channels",
    focus: { x: 0.1699, y: 0.6318, w: 0.5657, h: 0.0927 },
    zoom: 1.6,
    step: { ru: "Шаг 4", en: "Step 4" },
    title: { ru: "Каждая находка — с источником", en: "Every find carries its source" },
    body: {
      ru: "Домен, откуда она взялась в выдаче, тип входа и прогноз. Никаких безымянных строк: всё открывается и проверяется.",
      en: "The domain, where it came up in the results, the type of entry and a forecast. No anonymous rows: everything opens and can be checked.",
    },
    action: { ru: "Кликните по строке канала", en: "Click a channel row" },
  },
  {
    key: "why",
    shot: "channels",
    focus: { x: 0.7583, y: 0.5555, w: 0.2138, h: 0.1049 },
    zoom: 2.2,
    step: { ru: "Шаг 4", en: "Step 4" },
    title: { ru: "И причину, по которой оставлена", en: "And the reason it was kept" },
    body: {
      ru: "Почему эта площадка может привести клиентов и что с ней делать дальше. Причина взята с её собственной страницы, а не придумана.",
      en: "Why this place can bring customers and what to do about it next. The reason is taken from its own page rather than invented.",
    },
  },
  {
    key: "safe",
    shot: "channels",
    focus: { x: 0.008,  y: 0.7945, w: 0.1375, h: 0.1118 },
    zoom: 2.4,
    step: { ru: "Шаг 5", en: "Step 5" },
    title: { ru: "Ничего не уходит без вас", en: "Nothing leaves without you" },
    body: {
      ru: "Письмо отправляется по вашему нажатию, из вашей же почты. Серия начинается отдельной кнопкой и сама останавливается, как только пришёл ответ.",
      en: "A message goes out on your click, from your own mailbox. A series starts with a separate button and stops itself the moment a reply arrives.",
    },
  },
  {
    key: "outreach-screen",
    shot: "outreach",
    step: { ru: "Экран «Outreach»", en: "The Outreach screen" },
    title: { ru: "Кому писать руками", en: "Who needs a personal message" },
    body: {
      ru: "Отдельно от каналов: компании и живые люди, которым имеет смысл написать напрямую. Здесь же составляется само письмо.",
      en: "Kept apart from channels: companies and people worth writing to directly. This is also where the message itself is written.",
    },
  },
  {
    key: "contact",
    shot: "outreach",
    focus: { x: 0.6945, y: 0.2813, w: 0.2788, h: 0.0295 },
    zoom: 2.6,
    step: { ru: "Шаг 4", en: "Step 4" },
    title: { ru: "Контакт найден и проверен", en: "The contact, found and checked" },
    body: {
      ru: "Адрес взят со страниц самого сайта и проверен там же — отсюда пометка PUBLIC · VERIFIED. Где адреса нет, так и написано: email not found. Ничего не угадывается по схеме «имя точка фамилия».",
      en: "The address comes from the site's own pages and was checked there, hence PUBLIC · VERIFIED. Where there is none it says so — email not found. Nothing is guessed from a first-initial pattern.",
    },
    action: { ru: "Одобрите контакт", en: "Approve the contact" },
  },
  {
    key: "draft",
    shot: "outreach",
    focus: { x: 0.657,  y: 0.5349, w: 0.3152, h: 0.3844 },
    zoom: 1.5,
    step: { ru: "Шаг 4", en: "Step 4" },
    title: { ru: "Письмо написано, но не отправлено", en: "The message is written, not sent" },
    body: {
      ru: "Текст собран под конкретного адресата: чем он занят, что предлагаете вы, почему это ему подходит. Справа предпросмотр с пометками «только проверенные факты» и «ручное подтверждение».",
      en: "Each draft is written for that one recipient: what they do, what you offer, why the two fit. On the right, a preview marked “verified facts only” and “manual approval”.",
    },
    action: { ru: "«Add to queue» — в очередь, не в отправку", en: "“Add to queue” means queued, not sent" },
  },
  {
    key: "results-screen",
    shot: "results",
    step: { ru: "Экран «Результаты»", en: "The Results screen" },
    title: { ru: "Что из этого вышло", en: "What came of it" },
    body: {
      ru: "Задачи на сегодня, воронка по стадиям и месячный отчёт. Канал перестаёт быть строкой в списке.",
      en: "Today's tasks, the funnel by stage, and a monthly report. A channel stops being a row in a list.",
    },
  },
  {
    key: "funnel",
    shot: "results",
    focus: { x: 0.1812, y: 0.37,   w: 0.7909, h: 0.1082 },
    zoom: 1.5,
    step: { ru: "Шаг 5", en: "Step 5" },
    title: { ru: "Воронка целиком", en: "The funnel end to end" },
    body: {
      ru: "Найдено, одобрено, написано, ответили, встречи, клиенты, выручка. Проценты считаются от найденного, поэтому сразу видно, где именно всё останавливается.",
      en: "Discovered, approved, contacted, replies, meetings, customers, revenue. The percentages are of what was discovered, so it is obvious where things stop.",
    },
  },
  {
    key: "stages",
    shot: "results",
    focus: { x: 0.3914, y: 0.5482, w: 0.3305, h: 0.0273 },
    zoom: 2.4,
    step: { ru: "Шаг 5", en: "Step 5" },
    title: { ru: "Отмечаете вы, а не алгоритм", en: "You mark it, not an algorithm" },
    body: {
      ru: "Ответили, назначена встреча, стал клиентом, не сработало — плюс сумма и короткая заметка. Сервис не угадывает исход, он спрашивает.",
      en: "Got a reply, meeting booked, paying customer, did not work — plus the amount and a short note. The service does not guess the outcome, it asks.",
    },
    action: { ru: "Отметьте, чем закончилось", en: "Mark how it ended" },
  },
  {
    key: "agent-auto",
    shot: "agent",
    focus: { x: 0.1812, y: 0.1755, w: 0.5685, h: 0.1939 },
    zoom: 1.5,
    step: { ru: "Шаг 6", en: "Step 6" },
    title: { ru: "Дальше он работает сам", en: "After that it runs on its own" },
    body: {
      ru: "Фоновый агент по расписанию ищет новое и складывает в «Каналы». На самом экране написано главное: письма он не отправляет никогда.",
      en: "The background agent looks for new things on a schedule and files them under Channels. The screen states the important part: it never sends messages.",
    },
    action: { ru: "«Enable schedule» — или «Run now» разово", en: "“Enable schedule”, or “Run now” once" },
  },
  {
    key: "digest",
    shot: "agent",
    focus: { x: 0.1812, y: 0.3693, w: 0.7909, h: 0.2136 },
    zoom: 1.4,
    step: { ru: "Шаг 6", en: "Step 6" },
    title: { ru: "И присылает сводку", en: "And it sends you a summary" },
    body: {
      ru: "Периодическое письмо о том, что нашлось и что сдвинулось, на выбранном языке. Чтобы не заходить в сервис каждый день.",
      en: "A periodic letter about what turned up and what moved, in the language you pick. So you do not have to open the service every day.",
    },
  },
];

function plural(count: number, ru: boolean, forms: [string, string, string]) {
  if (!ru) return count === 1 ? forms[0] : forms[1];
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  const mod10 = count % 10;
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readSeen(key: string) {
  try {
    return window.localStorage.getItem(key) === "done";
  } catch {
    // Private mode: better to show the tour twice than never.
    return false;
  }
}

function writeSeen(key: string) {
  try {
    window.localStorage.setItem(key, "done");
  } catch {
    // Nothing to do — the tour still stays closed for this session.
  }
}

export default function OnboardingTour({
  locale,
  workspaceId,
  ready,
  billingConfigured,
  hasSubscription,
  startCheckout,
}: {
  locale: Locale;
  workspaceId: string;
  /** The session has loaded; before that we do not know whose workspace it is. */
  ready: boolean;
  /** No payment provider configured (self-hosted): the paywall is pointless. */
  billingConfigured: boolean;
  /** Somebody already paying should never meet a paywall. */
  hasSubscription: boolean;
  startCheckout: (plan: PlanId, interval: "monthly" | "annual") => void;
}) {
  const storageKey = `${storagePrefix}${workspaceId || "default"}`;
  const storedSeen = useSyncExternalStore(
    subscribeToStorage,
    useCallback(() => readSeen(storageKey), [storageKey]),
    () => true,
  );
  const [closed, setClosed] = useState(false);
  const [index, setIndex] = useState(0);

  // The paywall is the last slide rather than a separate screen: a tour that
  // ends and then produces a second modal reads as a bait, and the person has
  // to dismiss two things instead of one.
  const showPaywall = billingConfigured && !hasSubscription;
  const total = SLIDES.length + (showPaywall ? 1 : 0);
  const onPaywall = showPaywall && index === SLIDES.length;
  const slide = SLIDES[Math.min(index, SLIDES.length - 1)];

  const open = ready && !storedSeen && !closed;

  const dismiss = useCallback(() => {
    writeSeen(storageKey);
    setClosed(true);
  }, [storageKey]);

  // Escape closes it. A tour you cannot leave is a hostage situation, and the
  // person who wants to skip it is exactly the person who will resent it most.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
      if (event.key === "ArrowRight") setIndex((i) => Math.min(i + 1, total - 1));
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss, total]);

  // The page behind must not scroll while a full-screen modal is up.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  const ru = locale === "ru";
  const last = index === total - 1;

  return (
    <div className="tour-layer" role="dialog" aria-modal="true" aria-label={ru ? "Знакомство с Chanlyst" : "Chanlyst tour"}>
      <div className="tour-backdrop" onClick={dismiss} />
      <div className="tour-window">
        <button className="tour-skip" type="button" onClick={dismiss}>
          {ru ? "Пропустить" : "Skip"}
        </button>

        <div className="tour-body">
          {onPaywall ? (
            <Paywall ru={ru} startCheckout={startCheckout} />
          ) : (
            <>
              <div className="tour-copy">
                <small>{ru ? slide.step.ru : slide.step.en}</small>
                <h2>{ru ? slide.title.ru : slide.title.en}</h2>
                <p>{ru ? slide.body.ru : slide.body.en}</p>
              </div>
              <div className="tour-stage" key={slide.key}>
                <Shot slide={slide} ru={ru} />
              </div>
            </>
          )}
        </div>

        <footer className="tour-foot">
          <div className="tour-dots" aria-hidden="true">
            {Array.from({ length: total }, (_, dot) => (
              <i key={dot} className={dot === index ? "on" : dot < index ? "past" : ""} />
            ))}
          </div>
          <div className="tour-controls">
            <span className="tour-count">
              {index + 1} / {total}
            </span>
            <button
              className="outline"
              type="button"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(i - 1, 0))}
            >
              {ru ? "Назад" : "Back"}
            </button>
            {last ? (
              <button className="lime" type="button" onClick={dismiss}>
                {ru ? "Перейти в приложение" : "Go to the app"}
              </button>
            ) : (
              <button
                className="lime"
                type="button"
                onClick={() => setIndex((i) => Math.min(i + 1, total - 1))}
              >
                {ru ? "Далее" : "Next"}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function Paywall({
  ru,
  startCheckout,
}: {
  ru: boolean;
  startCheckout: (plan: PlanId, interval: "monthly" | "annual") => void;
}) {
  const plans = Object.values(planCatalog).filter((plan) => plan.available);
  const [chosen, setChosen] = useState<PlanId>("starter");

  return (
    <div className="tour-paywall">
      <div className="tour-copy">
        <small>{ru ? "Три дня бесплатно" : "Three days free"}</small>
        <h2>{ru ? "Попробуйте на своём продукте" : "Try it on your own product"}</h2>
        <p>
          {ru
            ? "Три дня полного доступа, карта не списывается до конца триала, отмена в один клик. Бесплатный тариф остаётся доступен всегда."
            : "Three days of full access. Nothing is charged until the trial ends, and cancelling takes one click. The free plan stays available either way."}
        </p>
      </div>
      <div className="tour-plans">
        {plans.map((plan) => (
          <button
            key={plan.id}
            type="button"
            className={`tour-plan${chosen === plan.id ? " on" : ""}`}
            onClick={() => setChosen(plan.id as PlanId)}
          >
            <strong>{plan.name}</strong>
            <em>
              ${plan.monthlyUsd}
              <span>{ru ? "/мес" : "/mo"}</span>
            </em>
            <ul>
              <li>
                {plan.limits.channelsPerMonth}{" "}
                {ru
                  ? `${plural(plan.limits.channelsPerMonth, ru, ["канал", "канала", "каналов"])} в месяц`
                  : "channels a month"}
              </li>
              <li>
                {plan.limits.contactChecksPerMonth}{" "}
                {ru
                  ? plural(plan.limits.contactChecksPerMonth, ru, [
                      "проверка контакта",
                      "проверки контактов",
                      "проверок контактов",
                    ])
                  : "contact checks"}
              </li>
              <li>
                {plan.limits.products}{" "}
                {ru
                  ? plural(plan.limits.products, ru, ["продукт", "продукта", "продуктов"])
                  : plural(plan.limits.products, ru, ["product", "products", "products"])}
              </li>
            </ul>
          </button>
        ))}
      </div>
      <button className="lime tour-trial" type="button" onClick={() => startCheckout(chosen, "monthly")}>
        {ru ? "Начать триал на 3 дня" : "Start the 3-day trial"}
      </button>
    </div>
  );
}

/**
 * One slide's picture: the real screen, blurred and dimmed, with the part
 * being talked about lifted out of it, sharp and enlarged, where it actually
 * sits. Showing a control in isolation teaches nothing about where to find it.
 *
 * The maths is all in fractions of the image, so nothing here depends on the
 * screenshot's pixel size or on how wide the modal happens to be. The lens is
 * clamped inside the frame, because a focus rectangle near an edge would
 * otherwise hang off it.
 */
function Shot({ slide, ru }: { slide: Slide; ru: boolean }) {
  const src = SHOTS[slide.shot];
  const focus = slide.focus;
  const alt = ru ? "Экран Chanlyst" : "The Chanlyst interface";

  if (!focus) {
    return (
      <figure className="tour-shot">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="tour-shot-base whole" src={src} alt={alt} />
      </figure>
    );
  }

  // The element rises where it already is. Cutting a rectangle out and parking
  // it somewhere else showed the control but hid the one thing worth learning:
  // where on the screen to look for it.
  //
  // So the scale is bounded by how much room the element has around itself
  // rather than by a clamp that would move it. An element near an edge simply
  // grows less.
  const cx = focus.x + focus.w / 2;
  const cy = focus.y + focus.h / 2;
  // It is allowed to hang over the edge of the screenshot, which is the whole
  // point: an element pinned in a corner cannot grow inside the frame, and a
  // thing that floats above the interface is not bounded by it.
  const lift = Math.max(1.06, Math.min(slide.zoom ?? 1.35, 2.4));
  const liftW = focus.w * lift;
  const liftH = focus.h * lift;
  const left = cx - liftW / 2;
  const top = cy - liftH / 2;
  // The copy inside is the whole screenshot again, scaled so the element lands
  // exactly inside its own box. One factor for both axes: capping them apart
  // stretched the contents into an interface nobody has.
  // Percentages inside the box are relative to the box, not to the frame:
  // the whole screenshot is 1/focus.w box-widths across, and it has to slide
  // left by focus.x of those widths for the element to land inside.
  const inner = {
    width: `${(100 / focus.w).toFixed(3)}%`,
    height: `${(100 / focus.h).toFixed(3)}%`,
    left: `${((-focus.x / focus.w) * 100).toFixed(3)}%`,
    top: `${((-focus.y / focus.h) * 100).toFixed(3)}%`,
  };

  return (
    <figure className="tour-shot">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="tour-shot-base" src={src} alt={alt} />
      <span className="tour-shot-veil" />
      <span
        className="tour-shot-lift"
        style={{
          left: `${left * 100}%`,
          top: `${top * 100}%`,
          width: `${liftW * 100}%`,
          height: `${liftH * 100}%`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" style={inner} />
      </span>
      {slide.action && (
        <span
          className="tour-shot-hint"
          style={{
            left: `${Math.min(left, 0.62) * 100}%`,
            top: `${Math.min(top + liftH, 0.9) * 100}%`,
          }}
        >
          {ru ? slide.action.ru : slide.action.en}
        </span>
      )}
    </figure>
  );
}
