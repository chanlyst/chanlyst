"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  GlobeHemisphereWest,
  LinkSimple,
  LockKey,
  PencilSimple,
  Sparkle,
  SpinnerGap,
  Target,
  UsersThree,
} from "@phosphor-icons/react";
import type { PublicLocale } from "./public-header";

type FlowState = "preview" | "questions" | "analyzing" | "results" | "error";

type Answer = {
  id: string;
  label: string;
  detail: string;
};

type Question = {
  key: "audience" | "goal" | "geography";
  title: string;
  prompt: string;
  options: Answer[];
};

type PreviewChannel = {
  name: string;
  domain: string;
  reason: string;
  action: string;
  actionUrl?: string;
  score: number;
  engagementMode?: "free_listing" | "paid_placement" | "outreach" | "unknown";
  mark?: string;
  color?: string;
  rating?: string;
};

type LivePreview = {
  mode: "live";
  analysis: {
    audience: string;
    goal: string;
    geography: string;
    summary: string;
  };
  results: PreviewChannel[];
  total: number;
};

const sampleChannels: PreviewChannel[] = [
  {
    mark: "IH",
    color: "green",
    name: "Indie Hackers",
    domain: "indiehackers.com",
    reason: "Active founder community; product launches and feedback.",
    action: "Submit free",
    score: 98,
    rating: "Excellent",
  },
  {
    mark: "PH",
    color: "blue",
    name: "Product Hunt",
    domain: "producthunt.com",
    reason: "High-intent audience for new tools; strong early visibility.",
    action: "Submit free",
    score: 94,
    rating: "Excellent",
  },
  {
    mark: "FA",
    color: "green",
    name: "Futurepedia",
    domain: "futurepedia.io",
    reason: "AI tools directory with engaged early adopters.",
    action: "Submit free",
    score: 91,
    rating: "Excellent",
  },
  {
    mark: "SA",
    color: "purple",
    name: "Startup Stash",
    domain: "startupstash.com",
    reason: "Curated directory for startups and SaaS tools.",
    action: "Submit free",
    score: 87,
    rating: "Excellent",
  },
  {
    mark: "LN",
    color: "orange",
    name: "Lenny’s Newsletter",
    domain: "lennysnewsletter.com",
    reason: "Weekly SaaS audience; ideal for announcements and learning.",
    action: "Contact editor",
    score: 84,
    rating: "Great",
  },
];

const lockedChannels = [
  ["GB", "Growth Bench", "growthbench.co", "Founder community and curated resources", "86"],
  ["SO", "SaaS Open", "saasopen.com", "Focused events for operators and founders", "82"],
  ["BS", "Bootstrapper Stack", "bootstrapperstack.com", "Directory for practical SaaS tools", "79"],
] as const;

const copy = {
  en: {
    title: "You built the product. Now find the customers.",
    subtitle:
      "Chanlyst finds the channels, ranks them by fit, and writes the outreach. You just approve.",
    placeholder: "Paste your website",
    submit: "Find my channels",
    trust: "Free preview · no card",
    invalid: "Enter a website such as yourproduct.com",
    example: "Example preview",
    exampleNote: "Add your website to get a ranking built around your product.",
    questionsTitle: "Three quick answers make the ranking specific",
    questionsNote: "Choose the closest answer. You can edit everything later.",
    previous: "Back",
    continue: "Continue",
    analyze: "Analyze my project",
    analyzing: "Reading your product and ranking channels",
    analyzingNote: "We are matching your audience, goal and geography with public sources.",
    analysisError: "We could not finish this analysis right now.",
    analysisErrorNote: "Try again in a moment or adjust one of your answers.",
    limitError: "You have used today’s free previews.",
    limitErrorNote: "Create an account to continue researching channels in the dashboard.",
    retry: "Try again",
    analysis: "Your analysis",
    analysisText: "We used your website and answers to find the best places to reach your audience.",
    edit: "Edit",
    completed: "3 of 3 answers completed",
    unlocked: (visible: number, total: number) => `${visible} of ${total} channels unlocked`,
    ranked: "Ranked by fit for your goals",
    lockedTitle: (total: number) => `Create free account to see all ${total} channels`,
    saveTitle: "Create a free account to save this analysis and keep exploring",
    create: "Create free account",
    sourceNote: "Results are based on public sources and AI analysis.",
    learn: "Learn more",
    questions: [
      {
        key: "audience",
        title: "Who are you trying to reach?",
        prompt: "This keeps the list focused on places your buyers already use.",
        options: [
          { id: "founders", label: "Founders and small teams", detail: "Bootstrapped companies and SMB buyers" },
          { id: "growth_teams", label: "Marketing and growth teams", detail: "Specialists responsible for acquisition" },
          { id: "mid_market", label: "Mid-market companies", detail: "Larger teams with structured buying" },
        ],
      },
      {
        key: "goal",
        title: "What do you need first?",
        prompt: "We will rank channels by the outcome that matters now.",
        options: [
          { id: "early_users", label: "Get early users", detail: "Launch, feedback and first conversations" },
          { id: "qualified_leads", label: "Generate qualified leads", detail: "Repeatable demand from a defined audience" },
          { id: "partnerships", label: "Build partnerships", detail: "Affiliates, communities and co-marketing" },
        ],
      },
      {
        key: "geography",
        title: "Where do you sell?",
        prompt: "We will avoid channels that cannot reach your market.",
        options: [
          { id: "worldwide", label: "Worldwide", detail: "English-speaking markets" },
          { id: "north_america", label: "United States and Canada", detail: "North American buyers" },
          { id: "europe", label: "Europe", detail: "UK and EU markets" },
        ],
      },
    ] satisfies Question[],
  },
  ru: {
    title: "Продукт готов. Теперь найдите клиентов.",
    subtitle:
      "Chanlyst находит каналы, ранжирует по соответствию и пишет сообщение. Вам остаётся одобрить.",
    placeholder: "Вставьте адрес вашего сайта",
    submit: "Найти мои каналы",
    trust: "Бесплатный результат · без карты",
    invalid: "Введите адрес сайта, например yourproduct.com",
    example: "Пример результата",
    exampleNote: "Добавьте сайт — и получите список, рассчитанный для вашего продукта.",
    questionsTitle: "Три коротких ответа сделают рейтинг точнее",
    questionsNote: "Выберите ближайший вариант. Позже всё можно изменить.",
    previous: "Назад",
    continue: "Продолжить",
    analyze: "Проанализировать проект",
    analyzing: "Изучаем продукт и ранжируем каналы",
    analyzingNote: "Сопоставляем аудиторию, цель и географию с открытыми источниками.",
    analysisError: "Сейчас не удалось завершить анализ.",
    analysisErrorNote: "Попробуйте ещё раз через минуту или измените один из ответов.",
    limitError: "Бесплатные анализы на сегодня закончились.",
    limitErrorNote: "Создайте аккаунт, чтобы продолжить поиск каналов в дашборде.",
    retry: "Попробовать снова",
    analysis: "Ваш анализ",
    analysisText: "Мы использовали ваш сайт и ответы, чтобы найти лучшие места с нужной аудиторией.",
    edit: "Изменить",
    completed: "3 из 3 ответов заполнены",
    unlocked: (visible: number, total: number) => `Открыто ${visible} из ${total} каналов`,
    ranked: "Рейтинг по соответствию вашим целям",
    lockedTitle: (total: number) => `Создайте бесплатный аккаунт, чтобы увидеть все ${total} каналов`,
    saveTitle: "Создайте бесплатный аккаунт, чтобы сохранить анализ и продолжить поиск",
    create: "Создать бесплатный аккаунт",
    sourceNote: "Результаты основаны на открытых источниках и AI-анализе.",
    learn: "Подробнее",
    questions: [
      {
        key: "audience",
        title: "Кого вы хотите привлечь?",
        prompt: "Так список будет состоять из мест, которыми уже пользуются ваши покупатели.",
        options: [
          { id: "founders", label: "Основатели и небольшие команды", detail: "Bootstrap-компании и малый бизнес" },
          { id: "growth_teams", label: "Команды маркетинга и роста", detail: "Специалисты, отвечающие за привлечение" },
          { id: "mid_market", label: "Средний бизнес", detail: "Более крупные команды с формальным выбором" },
        ],
      },
      {
        key: "goal",
        title: "Что вам нужно в первую очередь?",
        prompt: "Каналы будут ранжированы по результату, который важен сейчас.",
        options: [
          { id: "early_users", label: "Получить первых пользователей", detail: "Запуск, обратная связь и первые разговоры" },
          { id: "qualified_leads", label: "Получать целевые лиды", detail: "Системный спрос от заданной аудитории" },
          { id: "partnerships", label: "Найти партнёров", detail: "Партнёрки, сообщества и совместный маркетинг" },
        ],
      },
      {
        key: "geography",
        title: "Где вы продаёте?",
        prompt: "Мы исключим каналы, которые не могут охватить ваш рынок.",
        options: [
          { id: "worldwide", label: "По всему миру", detail: "Англоязычные рынки" },
          { id: "north_america", label: "США и Канада", detail: "Покупатели из Северной Америки" },
          { id: "europe", label: "Европа", detail: "Рынки Великобритании и ЕС" },
        ],
      },
    ] satisfies Question[],
  },
} as const;

const summaryIcons = [UsersThree, Target, GlobeHemisphereWest] as const;

function registrationHref(loginHref: string) {
  return `${loginHref}${loginHref.includes("?") ? "&" : "?"}mode=register`;
}

function normalizeWebsite(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function channelMark(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function channelColor(channel: PreviewChannel, index: number) {
  if (channel.color) return channel.color;
  if (channel.engagementMode === "free_listing") return "green";
  if (channel.engagementMode === "paid_placement") return "orange";
  if (channel.engagementMode === "outreach") return "purple";
  return index % 2 ? "blue" : "green";
}

function scoreRating(score: number, locale: PublicLocale) {
  if (score >= 90) return locale === "ru" ? "Отлично" : "Excellent";
  if (score >= 80) return locale === "ru" ? "Высоко" : "Great";
  return locale === "ru" ? "Хорошо" : "Good";
}

export default function AcquisitionPreview({
  locale,
  loginHref,
}: {
  locale: PublicLocale;
  loginHref: string;
}) {
  const t = copy[locale];
  const [website, setWebsite] = useState("");
  const [projectDomain, setProjectDomain] = useState("yourproduct.com");
  const [flow, setFlow] = useState<FlowState>("preview");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([0, 0, 0]);
  const [urlError, setUrlError] = useState("");
  const [analysisError, setAnalysisError] = useState<"limit" | "generic" | "">("");
  const [livePreview, setLivePreview] = useState<LivePreview | null>(null);

  const question = t.questions[questionIndex];
  const selectedAnswer = answers[questionIndex];
  const answersForSummary = useMemo(
    () => t.questions.map((item, index) => item.options[answers[index]]),
    [answers, t.questions],
  );

  useEffect(() => {
    if (flow !== "analyzing") return;
    const controller = new AbortController();
    const selections = t.questions.map(
      (item, index) => item.options[answers[index]].id,
    );
    fetch("/api/public-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        website,
        locale,
        audience: selections[0],
        goal: selections[1],
        geography: selections[2],
      }),
      signal: controller.signal,
    })
      .then(async (response) => ({
        ok: response.ok,
        status: response.status,
        data: (await response.json().catch(() => ({}))) as LivePreview & {
          error?: string;
        },
      }))
      .then(({ ok, status, data }) => {
        if (controller.signal.aborted) return;
        if (ok && data.mode === "live" && data.results?.length) {
          setLivePreview(data);
          setAnalysisError("");
          setFlow("results");
          return;
        }
        setAnalysisError(
          status === 429 || data.error === "preview_limit_reached"
            ? "limit"
            : "generic",
        );
        setFlow("error");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAnalysisError("generic");
          setFlow("error");
        }
      });
    return () => controller.abort();
  }, [answers, flow, locale, t.questions, website]);

  function startQuestions(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const domain = normalizeWebsite(website);
    if (!domain || !domain.includes(".")) {
      setUrlError(t.invalid);
      return;
    }
    setUrlError("");
    setAnalysisError("");
    setLivePreview(null);
    setProjectDomain(domain);
    setQuestionIndex(0);
    setFlow("questions");
  }

  function updateAnswer(next: number) {
    setAnswers((current) => current.map((value, index) => (index === questionIndex ? next : value)));
  }

  function advance() {
    if (questionIndex < t.questions.length - 1) {
      setQuestionIndex((current) => current + 1);
      return;
    }
    setFlow("analyzing");
  }

  function editQuestion(index: number) {
    setQuestionIndex(index);
    setFlow("questions");
  }

  const displayChannels = livePreview?.results || sampleChannels;
  const totalChannels = livePreview?.total || 23;
  const visibleChannels = displayChannels.length;
  const hiddenChannels = Math.max(0, totalChannels - visibleChannels);
  const lockedRowCount = Math.min(lockedChannels.length, hiddenChannels);

  return (
    <section className="acquisition-hero" aria-labelledby="acquisition-title">
      <div className="acquisition-heading">
        <h1 id="acquisition-title">
          {/* Each sentence is its own inline-block, so a two-sentence headline
              breaks at the full stop rather than in the middle of the second
              clause — "Продукт готов. Теперь / найдите клиентов" read as one
              broken thought. A sentence still wraps inside itself when the
              viewport leaves it no choice, which a non-breaking space would
              not allow. */}
          {t.title.split(/(?<=\.)\s+/).map((sentence) => (
            <span key={sentence}>{sentence}</span>
          ))}
        </h1>
        <p className="acquisition-subtitle">{t.subtitle}</p>
        <form className="website-entry" onSubmit={startQuestions} noValidate>
          <div className={`website-field ${urlError ? "invalid" : ""}`}>
            <LinkSimple size={22} weight="bold" aria-hidden="true" />
            <input
              value={website}
              onChange={(event) => {
                setWebsite(event.target.value);
                if (urlError) setUrlError("");
              }}
              placeholder={t.placeholder}
              aria-label={t.placeholder}
              aria-invalid={Boolean(urlError)}
              aria-describedby={urlError ? "website-error" : undefined}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
            />
            <button type="submit">
              {t.submit}
              <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </button>
          </div>
          {urlError && <p className="website-error" id="website-error">{urlError}</p>}
        </form>
        <p className="preview-trust"><CheckCircle size={18} weight="fill" aria-hidden="true" />{t.trust}</p>
      </div>

      {flow === "questions" && (
        <div className="question-surface" aria-live="polite">
          <div className="question-progress" aria-label={`${questionIndex + 1} / ${t.questions.length}`}>
            {t.questions.map((item, index) => (
              <span className={index <= questionIndex ? "active" : ""} key={item.key} />
            ))}
          </div>
          <div className="question-copy">
            <p>{t.questionsTitle}</p>
            <small>{t.questionsNote}</small>
          </div>
          <div className="question-body">
            <span className="question-count">{String(questionIndex + 1).padStart(2, "0")}</span>
            <h2>{question.title}</h2>
            <p>{question.prompt}</p>
            <div className="answer-options" role="radiogroup" aria-label={question.title}>
              {question.options.map((option, index) => (
                <button
                  className={selectedAnswer === index ? "selected" : ""}
                  type="button"
                  role="radio"
                  aria-checked={selectedAnswer === index}
                  onClick={() => updateAnswer(index)}
                  key={option.label}
                >
                  <span>{selectedAnswer === index && <Check size={15} weight="bold" aria-hidden="true" />}</span>
                  <div><b>{option.label}</b><small>{option.detail}</small></div>
                </button>
              ))}
            </div>
          </div>
          <div className="question-actions">
            <button
              type="button"
              className="question-back"
              onClick={() => {
                if (questionIndex === 0) setFlow("preview");
                else setQuestionIndex((current) => current - 1);
              }}
            >
              <ArrowLeft size={17} weight="bold" aria-hidden="true" />{t.previous}
            </button>
            <button type="button" className="question-next" onClick={advance}>
              {questionIndex === t.questions.length - 1 ? t.analyze : t.continue}
              {questionIndex === t.questions.length - 1
                ? <Sparkle size={18} weight="fill" aria-hidden="true" />
                : <ArrowRight size={18} weight="bold" aria-hidden="true" />}
            </button>
          </div>
        </div>
      )}

      {flow === "analyzing" && (
        <div className="analysis-loading" role="status" aria-live="polite">
          <SpinnerGap size={32} weight="bold" aria-hidden="true" />
          <div><h2>{t.analyzing}</h2><p>{t.analyzingNote}</p></div>
          <span>{projectDomain}</span>
        </div>
      )}

      {flow === "error" && (
        <div className="analysis-error" role="alert">
          <span><Sparkle size={24} weight="duotone" aria-hidden="true" /></span>
          <div>
            <h2>{analysisError === "limit" ? t.limitError : t.analysisError}</h2>
            <p>{analysisError === "limit" ? t.limitErrorNote : t.analysisErrorNote}</p>
          </div>
          {analysisError === "limit" ? (
            <Link href={registrationHref(loginHref)}>{t.create}</Link>
          ) : (
            <button type="button" onClick={() => setFlow("analyzing")}>{t.retry}</button>
          )}
        </div>
      )}

      {(flow === "preview" || flow === "results") && (
        <div className={`preview-shell ${flow === "preview" ? "sample" : "personalized"}`}>
          <aside className="analysis-summary">
            <div className="analysis-summary-head">
              <div>
                <span>{flow === "preview" ? t.example : t.analysis}</span>
                <p>{flow === "preview" ? t.exampleNote : t.analysisText}</p>
              </div>
              {flow === "results" && (
                <button type="button" onClick={() => editQuestion(0)}>{t.edit}<PencilSimple size={15} weight="bold" aria-hidden="true" /></button>
              )}
            </div>
            <div className="summary-answers">
              {t.questions.map((item, index) => {
                const Icon = summaryIcons[index];
                const answer = answersForSummary[index];
                return (
                  <div className="summary-answer" key={item.key}>
                    <span><Icon size={22} weight="duotone" aria-hidden="true" /></span>
                    <div><b>{item.key === "audience" ? (locale === "ru" ? "Аудитория" : "Audience") : item.key === "goal" ? (locale === "ru" ? "Цель" : "Goal") : (locale === "ru" ? "География" : "Geography")}</b><p>{answer.label}</p></div>
                    {flow === "results" && <button type="button" onClick={() => editQuestion(index)} aria-label={`${t.edit}: ${item.title}`}><PencilSimple size={14} weight="bold" aria-hidden="true" /></button>}
                  </div>
                );
              })}
            </div>
            <div className="summary-complete"><span>{t.completed}</span><i><b /></i></div>
          </aside>

          <div className="channel-preview">
            <header><b>{t.unlocked(visibleChannels, totalChannels)}</b><span>{t.ranked}</span></header>
            <div className="channel-list">
              {displayChannels.map((channel, index) => (
                <article className="channel-row" key={channel.domain}>
                  <span className="channel-rank">{index + 1}</span>
                  <span className={`channel-logo ${channelColor(channel, index)}`}>
                    {channel.mark || channelMark(channel.name)}
                  </span>
                  <div className="channel-name"><b>{channel.name}</b><small>{channel.domain}</small></div>
                  <p>{channel.reason}</p>
                  {channel.actionUrl ? (
                    <a href={channel.actionUrl} target="_blank" rel="noreferrer">{channel.action}</a>
                  ) : (
                    <button type="button">{channel.action}</button>
                  )}
                  <div className="channel-score"><b>{channel.score}</b><small>{channel.rating || scoreRating(channel.score, locale)}</small></div>
                </article>
              ))}
            </div>
            <div className={`locked-results ${hiddenChannels ? "" : "no-hidden"}`}>
              {hiddenChannels > 0 && (
                <div className="locked-rows" aria-hidden="true">
                  {lockedChannels.slice(0, lockedRowCount).map((channel, index) => (
                    <article className="channel-row" key={channel[2]}>
                      <span className="channel-rank">{visibleChannels + index + 1}</span>
                      <span className="channel-logo blue">{channel[0]}</span>
                      <div className="channel-name"><b>{channel[1]}</b><small>{channel[2]}</small></div>
                      <p>{channel[3]}</p>
                      <button type="button">Submit free</button>
                      <div className="channel-score"><b>{channel[4]}</b><small>Great</small></div>
                    </article>
                  ))}
                </div>
              )}
              <div className="locked-cta">
                <span><LockKey size={22} weight="bold" aria-hidden="true" /></span>
                <h3>{hiddenChannels ? t.lockedTitle(totalChannels) : t.saveTitle}</h3>
                <Link href={registrationHref(loginHref)} data-track="preview_create_account">{t.create}</Link>
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="preview-source-note">{t.sourceNote} <Link href="/#process">{t.learn}</Link></p>
    </section>
  );
}
