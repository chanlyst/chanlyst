import type { Dictionary, Locale } from "../i18n";
import type {
  BusyState,
  IntegrationData,
  Message,
  OutreachSequence,
  Product,
} from "../types";
import {
  deliveryFailureMessage,
  deliveryFailureNeedsReconnect,
} from "../gmail-failure";

export default function QueueSection({
  t,
  locale,
  activeProduct,
  activeMessages,
  connected,
  sendEmail,
  openManual,
  copyMessage,
  removeMessage,
  outreachSequences,
  updateOutreachSequence,
  checkReplies,
  busy,
}: {
  t: Dictionary;
  locale: Locale;
  activeProduct: Product;
  activeMessages: Message[];
  connected: NonNullable<IntegrationData["integrations"]>;
  sendEmail: (message: Message) => Promise<void>;
  openManual: (message: Message, type: "linkedin") => Promise<void>;
  copyMessage: (message: Message) => Promise<void>;
  removeMessage: (id: string) => Promise<void>;
  outreachSequences: OutreachSequence[];
  updateOutreachSequence: (
    id: string,
    action: "activate" | "pause" | "resume" | "cancel",
  ) => Promise<void>;
  checkReplies: () => Promise<void>;
  busy: BusyState;
}) {
  return (
    <>
        <section className="panel queue" id="queue">
          <div className="section-head"><div><div><h2>{t.queue}</h2><p>{activeProduct.name}</p></div></div><strong>{activeMessages.length}</strong></div>
          {!activeMessages.length ? <div className="empty horizontal"><span aria-hidden="true">✉</span><p>{t.queueEmpty}</p></div> : <div className="queue-list">{activeMessages.map((message) => (
            <article key={message.id}>
              <span className={`queue-icon ${message.status}`}>{message.channel === "email" ? "@" : message.channel === "telegram" ? "TG" : "in"}</span>
              <div className="queue-copy"><div><strong>{message.company}</strong><small>{message.subject || message.channel}</small></div><p>{message.body}</p></div>
              <div className={`state ${message.status}`}><i />{message.status === "sent" ? t.sent : message.status === "sending" ? locale === "ru" ? "Отправляется…" : "Sending…" : message.status === "failed" ? `${t.failed}: ${deliveryFailureMessage(message.sendUncertain ? "gmail_delivery_unconfirmed" : message.error, locale)}${message.errorStatusCode ? ` (Google HTTP ${message.errorStatusCode})` : ""}` : t.waiting}</div>
              <div className="queue-actions">
                {message.status === "failed" && deliveryFailureNeedsReconnect(message.error) && <a className="dark" href="/dashboard/integrations">{locale === "ru" ? "Переподключить Gmail" : "Reconnect Gmail"}</a>}
                {["queued", "failed"].includes(message.status) && message.channel === "email" && connected.gmail && <button className="dark" onClick={() => sendEmail(message)}>{t.sendGmail}</button>}
                {message.channel === "linkedin" && <button className="dark" onClick={() => openManual(message, "linkedin")}>{t.openLinkedin}</button>}
                <button onClick={() => copyMessage(message)}>{t.copy}</button><button className="remove" onClick={() => removeMessage(message.id)}>×</button>
              </div>
            </article>
          ))}</div>}
        </section>

        <section className="panel outreach-sequences" id="sequences-list">
          <div className="section-head"><div><small>↻</small><div><h2>{locale === "ru" ? "Email-цепочки" : "Email sequences"}</h2><p>{locale === "ru" ? "Собственный движок Chanlyst · Gmail" : "Chanlyst native engine · Gmail"}</p></div></div><div className="queue-actions"><button disabled={busy === "replies"} onClick={() => checkReplies()}>{busy === "replies" ? t.checkingReplies : t.checkReplies}</button><strong>{outreachSequences.length}</strong></div></div>
          {!outreachSequences.length ? (
            <div className="empty horizontal"><span>✉</span><p>{locale === "ru" ? "Создайте цепочку из подготовленного письма. Она появится здесь как черновик." : "Build a sequence from a prepared email. It will appear here as a draft."}</p></div>
          ) : (
            <div className="native-sequence-list">
              {outreachSequences.map((item) => (
                <article key={item.id} className={item.status}>
                  <span>{item.company.slice(0, 2).toUpperCase()}</span>
                  <div><strong>{item.name}</strong><small>{item.recipientEmail}</small><p>{item.nextStep} / {item.steps.length} · {item.sendInProgress ? locale === "ru" ? "Отправляется…" : "Sending…" : item.nextRunAt ? new Date(item.nextRunAt).toLocaleString(locale === "ru" ? "ru-RU" : "en-US") : item.stoppedReason?.startsWith("gmail_") ? deliveryFailureMessage(item.stoppedReason, locale) : item.stoppedReason || item.status}</p></div>
                  <b>{locale === "ru" ? { draft: "Черновик", active: "Активна", paused: "Пауза", completed: "Завершена", stopped_reply: "Получен ответ", cancelled: "Отменена" }[item.status] : item.status.replaceAll("_", " ")}</b>
                  <div className="native-sequence-controls">
                    {deliveryFailureNeedsReconnect(item.stoppedReason) && <a className="dark" href="/dashboard/integrations">{locale === "ru" ? "Переподключить Gmail" : "Reconnect Gmail"}</a>}
                    {item.status === "draft" && <button className="dark" onClick={() => updateOutreachSequence(item.id, "activate")}>{locale === "ru" ? "Запустить" : "Start"}</button>}
                    {item.status === "active" && <button onClick={() => updateOutreachSequence(item.id, "pause")}>{locale === "ru" ? "Пауза" : "Pause"}</button>}
                    {item.status === "paused" && <button className="dark" onClick={() => updateOutreachSequence(item.id, "resume")}>{locale === "ru" ? "Продолжить" : "Resume"}</button>}
                    {["draft", "active", "paused"].includes(item.status) && <button className="remove" onClick={() => updateOutreachSequence(item.id, "cancel")}>{locale === "ru" ? "Отменить" : "Cancel"}</button>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
    </>
  );
}
