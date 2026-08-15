import { words, type Locale } from "../i18n";
import type { AgentData, BusyState, DigestData } from "../types";

export default function AgentSection({
  locale,
  agentData,
  busy,
  saveAgentSchedule,
  runAgentNow,
  digestData,
  saveDigestSettings,
  sendDigestNow,
}: {
  locale: Locale;
  agentData: AgentData;
  busy: BusyState;
  saveAgentSchedule: (
    enabled?: boolean,
    cadence?: "daily" | "weekly",
  ) => Promise<void>;
  runAgentNow: () => Promise<void>;
  digestData: DigestData;
  saveDigestSettings: (changes: {
    enabled?: boolean;
    cadence?: "daily" | "weekly";
    locale?: "ru" | "en";
  }) => Promise<void>;
  sendDigestNow: () => Promise<void>;
}) {
  const t = words[locale];
  const digest = digestData.settings || {};
  return (
        <section className="panel agent-panel" id="agent">
          <div className="section-head">
            <div>
              <div>
                <h2>{locale === "ru" ? "Фоновый агент" : "Background agent"}</h2>
                <p>
                  {locale === "ru"
                    ? "Сам ищет новые возможности по активным продуктам"
                    : "Automatically finds new opportunities for active products"}
                </p>
              </div>
            </div>
            <strong className={agentData.schedule?.enabled ? "agent-on" : ""}>
              {agentData.schedule?.enabled
                ? locale === "ru" ? "РАБОТАЕТ" : "ACTIVE"
                : locale === "ru" ? "ПАУЗА" : "PAUSED"}
            </strong>
          </div>
          <div className="agent-layout">
            <article className="agent-control">
              <div className="agent-state">
                <span className={agentData.schedule?.enabled ? "active" : ""}>✦</span>
                <div>
                  <h3>{locale === "ru" ? "Автопоиск возможностей" : "Automatic discovery"}</h3>
                  <p>
                    {locale === "ru"
                      ? "Найденные площадки и компании сохраняются в разделе «Каналы». Сообщения никогда не отправляются автоматически."
                      : "Found channels and companies are saved under Channels. Messages are never sent automatically."}
                  </p>
                </div>
              </div>
              <div className="agent-options">
                <label>
                  <span>{locale === "ru" ? "Расписание" : "Schedule"}</span>
                  <select
                    value={agentData.schedule?.cadence || "weekly"}
                    onChange={(event) =>
                      void saveAgentSchedule(
                        Boolean(agentData.schedule?.enabled),
                        event.target.value as "daily" | "weekly",
                      )
                    }
                    disabled={busy === "agent"}
                  >
                    <option value="weekly">{locale === "ru" ? "Раз в неделю" : "Weekly"}</option>
                    <option value="daily" disabled={!agentData.canRunDaily}>
                      {locale === "ru" ? "Каждый день — Pro / Scale" : "Daily — Pro / Scale"}
                    </option>
                  </select>
                </label>
                <button
                  className={agentData.schedule?.enabled ? "outline" : "lime"}
                  onClick={() => void saveAgentSchedule(!agentData.schedule?.enabled)}
                  disabled={busy === "agent"}
                >
                  {agentData.schedule?.enabled
                    ? locale === "ru" ? "Приостановить" : "Pause"
                    : locale === "ru" ? "Включить расписание" : "Enable schedule"}
                </button>
                <button className="dark" onClick={runAgentNow} disabled={busy === "agent"}>
                  {busy === "agent"
                    ? locale === "ru" ? "Агент работает…" : "Agent is working…"
                    : locale === "ru" ? "Запустить сейчас" : "Run now"}
                </button>
              </div>
              {!agentData.canSchedule && (
                <small className="agent-plan-note">
                  {locale === "ru"
                    ? "На бесплатном плане доступен ручной запуск. Расписание включается после активации подписки."
                    : "Manual runs are available on Free. Scheduling unlocks with a subscription."}
                </small>
              )}
              <small className="agent-plan-note">
                {t.agentMonitoringNote}{" "}
                <a className="agent-monitoring-link" href="/dashboard#products">
                  {t.agentMonitoringLink}
                </a>
              </small>
            </article>
            <article className="agent-report">
              <small>{locale === "ru" ? "ПОСЛЕДНИЙ ЗАПУСК" : "LAST RUN"}</small>
              {agentData.schedule?.lastRun ? (
                <>
                  <div className={`run-status ${agentData.schedule.lastRun.status || ""}`}>
                    <i />
                    <strong>
                      {agentData.schedule.lastRun.status === "completed"
                        ? locale === "ru" ? "Завершён" : "Completed"
                        : agentData.schedule.lastRun.status === "failed"
                          ? locale === "ru" ? "Ошибка" : "Failed"
                          : locale === "ru" ? "Выполняется" : "Running"}
                    </strong>
                  </div>
                  <dl>
                    <div><dt>{locale === "ru" ? "Продуктов" : "Products"}</dt><dd>{agentData.schedule.lastRun.productsProcessed || 0}</dd></div>
                    <div><dt>{locale === "ru" ? "Возможностей" : "Opportunities"}</dt><dd>{agentData.schedule.lastRun.opportunitiesFound || 0}</dd></div>
                    <div><dt>{locale === "ru" ? "Завершён" : "Finished"}</dt><dd>{agentData.schedule.lastRun.finishedAt ? new Date(agentData.schedule.lastRun.finishedAt).toLocaleString(locale === "ru" ? "ru-RU" : "en-US") : "—"}</dd></div>
                  </dl>
                  {agentData.schedule.lastRun.error && <p>{agentData.schedule.lastRun.error}</p>}
                </>
              ) : (
                <div className="agent-empty">
                  <span>◎</span>
                  <p>{locale === "ru" ? "Запусков пока не было" : "No runs yet"}</p>
                </div>
              )}
              {agentData.schedule?.nextRunAt && (
                <footer>
                  {locale === "ru" ? "Следующий запуск: " : "Next run: "}
                  <b>{new Date(agentData.schedule.nextRunAt).toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}</b>
                </footer>
              )}
            </article>
          </div>
          <article className="agent-control digest-block">
            <div className="agent-state">
              <span className={digest.enabled ? "active" : ""}>✉</span>
              <div>
                <h3>{t.digestTitle}</h3>
                <p>{t.digestHint}</p>
              </div>
            </div>
            <div className="agent-options">
              <label>
                <span>{t.digestCadence}</span>
                <select
                  value={digest.cadence || "weekly"}
                  onChange={(event) =>
                    void saveDigestSettings({
                      cadence: event.target.value as "daily" | "weekly",
                    })
                  }
                  disabled={busy === "digest"}
                >
                  <option value="weekly">{t.digestWeekly}</option>
                  <option value="daily">{t.digestDaily}</option>
                </select>
              </label>
              <label>
                <span>{t.digestLanguage}</span>
                <select
                  value={digest.locale || "ru"}
                  onChange={(event) =>
                    void saveDigestSettings({
                      locale: event.target.value as "ru" | "en",
                    })
                  }
                  disabled={busy === "digest"}
                >
                  <option value="ru">Русский</option>
                  <option value="en">English</option>
                </select>
              </label>
              <button
                className={digest.enabled ? "outline" : "lime"}
                onClick={() =>
                  void saveDigestSettings({ enabled: !digest.enabled })
                }
                disabled={busy === "digest"}
              >
                {digest.enabled ? t.digestDisable : t.digestEnable}
              </button>
              <button
                className="dark"
                onClick={() => void sendDigestNow()}
                disabled={busy === "digest"}
              >
                {busy === "digest" ? t.digestSending : t.digestSendNow}
              </button>
            </div>
            {digest.lastSentAt && (
              <small className="agent-plan-note">
                {t.digestLastSent}:{" "}
                {new Date(digest.lastSentAt).toLocaleString(
                  locale === "ru" ? "ru-RU" : "en-US",
                )}
              </small>
            )}
          </article>
        </section>
  );
}
