import { useState, type Dispatch, type SetStateAction } from "react";
import type { Dictionary, Locale } from "../i18n";
import type {
  BusyState,
  EngagementMode,
  Lead,
  OutreachTemplate,
  SequenceStep,
} from "../types";

// Reply rate as a display string; "—" until the template has any sends.
function replyRateLabel(template: OutreachTemplate) {
  if (!template.sentCount) return "—";
  return `${Math.round((template.replyCount / template.sentCount) * 100)}%`;
}

const bestTemplateMinSent = 5;

export default function Composer({
  t,
  locale,
  selectedLead,
  selectedLeadMode,
  busy,
  channel,
  chooseChannel,
  subject,
  setSubject,
  body,
  setBody,
  queueMessage,
  gmailConnected = false,
  templates,
  appliedTemplateId,
  applyTemplate,
  saveComposerAsTemplate,
  saveTemplateEdits,
  setTemplateArchived,
  deleteTemplate,
  buildSequence,
  sequenceSteps,
  setSequenceSteps,
  createOutreachSequence,
  savedSequence,
  startSavedSequence,
  dismissSavedSequence,
}: {
  t: Dictionary;
  locale: Locale;
  selectedLead?: Lead;
  selectedLeadMode?: Exclude<EngagementMode, "unknown">;
  busy: BusyState;
  channel: "email" | "telegram" | "linkedin";
  chooseChannel: (nextChannel: "email" | "telegram" | "linkedin") => void;
  subject: string;
  setSubject: (subject: string) => void;
  body: string;
  setBody: (body: string) => void;
  queueMessage: (sendNow?: boolean) => Promise<void>;
  /** Whether the workspace has a Gmail to send from. */
  gmailConnected?: boolean;
  templates: OutreachTemplate[];
  appliedTemplateId: string;
  applyTemplate: (templateId: string) => void;
  saveComposerAsTemplate: (name: string) => Promise<boolean>;
  saveTemplateEdits: (payload: {
    id: string;
    name: string;
    subject: string;
    body: string;
  }) => Promise<boolean>;
  setTemplateArchived: (id: string, archived: boolean) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  buildSequence: () => void;
  sequenceSteps: SequenceStep[];
  setSequenceSteps: Dispatch<SetStateAction<SequenceStep[]>>;
  createOutreachSequence: () => Promise<void>;
  /** The draft just saved from this composer, if any. */
  savedSequence: { id: string; company: string } | null;
  startSavedSequence: () => Promise<void>;
  dismissSavedSequence: () => void;
}) {
  const [saveFormOpen, setSaveFormOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editDraft, setEditDraft] = useState({ name: "", subject: "", body: "" });

  const activeTemplates = templates.filter((item) => !item.archived);
  // Picker options: templates for the current channel; when the lead has an
  // engagement mode, prefer templates targeting it (or untargeted ones) and
  // fall back to every channel match when that filter leaves nothing.
  const channelTemplates = activeTemplates.filter(
    (item) => item.channel === channel,
  );
  const modeTemplates = selectedLeadMode
    ? channelTemplates.filter(
        (item) => !item.engagementMode || item.engagementMode === selectedLeadMode,
      )
    : channelTemplates;
  const pickerTemplates = modeTemplates.length ? modeTemplates : channelTemplates;

  const visibleTemplates = showArchived
    ? templates
    : activeTemplates;
  // Best performer: highest reply rate among templates with enough sends.
  const bestTemplateId = activeTemplates.reduce<{ id: string; rate: number }>(
    (best, item) => {
      if (item.sentCount < bestTemplateMinSent) return best;
      const rate = item.replyCount / item.sentCount;
      return rate > best.rate ? { id: item.id, rate } : best;
    },
    { id: "", rate: 0 },
  ).id;

  const busyTemplates = busy === "template";

  async function submitSaveForm() {
    const saved = await saveComposerAsTemplate(saveName);
    if (saved) {
      setSaveName("");
      setSaveFormOpen(false);
    }
  }

  function startEdit(template: OutreachTemplate) {
    setEditingId(template.id);
    setEditDraft({
      name: template.name,
      subject: template.subject,
      body: template.body,
    });
  }

  async function submitEdit() {
    const saved = await saveTemplateEdits({ id: editingId, ...editDraft });
    if (saved) setEditingId("");
  }

  return (
    <>
        {selectedLead && selectedLeadMode === "outreach" && <section className="panel composer" id="composer">
          <div className="section-head"><div><div><h2>{t.message}</h2><p>{busy === "outreach" ? t.generatingOutreach : selectedLead.company}</p></div></div></div>
          <div className="composer-grid">
            <div className="channel-tabs">{/* No Telegram tab: nothing here sends to Telegram. The tab opened a
                t.me link and copied the text to the clipboard, which is the user
                writing the message themselves in another window. It stays out
                until sending is real. Finding Telegram channels is unaffected —
                that is the site:t.me source on Channels, and it works. */}
            {(["email", "linkedin"] as const).map((item) => <button key={item} className={channel === item ? "active" : ""} onClick={() => chooseChannel(item)}>{item === "email" ? "Email" : "LinkedIn"}</button>)}</div>
            <div className="editor">
              {pickerTemplates.length > 0 && (
                <label>
                  <span>{t.templatePicker}</span>
                  <select
                    value={
                      pickerTemplates.some((item) => item.id === appliedTemplateId)
                        ? appliedTemplateId
                        : ""
                    }
                    onChange={(event) => applyTemplate(event.target.value)}
                  >
                    <option value="">{t.templatePickerNone}</option>
                    {pickerTemplates.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {channel === "email" && <label><span>{t.subject}</span><input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>}
              <label><span>{t.message}</span><textarea value={body} onChange={(event) => setBody(event.target.value)} /></label>
              {!saveFormOpen ? (
                <button onClick={() => setSaveFormOpen(true)}>{t.templateSaveAs}</button>
              ) : (
                <div className="template-save-form">
                  <label>
                    <span>{t.templateName}</span>
                    <input
                      value={saveName}
                      autoFocus
                      onChange={(event) => setSaveName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void submitSaveForm();
                      }}
                    />
                  </label>
                  <div className="queue-actions">
                    <button className="dark" disabled={busyTemplates} onClick={() => void submitSaveForm()}>{t.save}</button>
                    <button onClick={() => setSaveFormOpen(false)}>{t.close}</button>
                  </div>
                </div>
              )}
            </div>
            <div className="preview">
              <small>{t.preview} · {selectedLead.company}</small>
              {channel === "email" && <strong>{subject}</strong>}
              <p>{body}</p>
              <div><span>✓ {t.previewFacts}</span><span>✓ {t.previewApproval}</span></div>
              {/* The series is a first-class outcome, not a footnote under the
                  preview: both actions carry the same visual weight. */}
              <div className="preview-actions">
                {channel === "email" && gmailConnected && (
                  <button
                    className="lime"
                    title={t.sendNowHint}
                    onClick={() => queueMessage(true)}
                  >
                    {t.sendNow}
                  </button>
                )}
                <button
                  className={channel === "email" && gmailConnected ? "outline" : "lime"}
                  onClick={() => queueMessage(false)}
                >
                  {t.addQueue}
                </button>
                {channel === "email" && (
                  <button className="dark" onClick={buildSequence}>{t.sequenceBuild}</button>
                )}
              </div>
            </div>
          </div>
        </section>}

        <section className="panel templates" id="templates">
          <div className="section-head">
            <div><small>✎</small><div><h2>{t.templatesTitle}</h2><p>{t.templatesHint}</p></div></div>
            <div className="queue-actions">
              {templates.some((item) => item.archived) && (
                <button onClick={() => setShowArchived((current) => !current)}>
                  {showArchived ? t.templateHideArchived : t.templateShowArchived}
                </button>
              )}
              <strong>{activeTemplates.length}</strong>
            </div>
          </div>
          {!visibleTemplates.length ? (
            <div className="empty horizontal"><span>✎</span><p>{t.templatesEmpty}</p></div>
          ) : (
            <div className="queue-list template-list">
              {visibleTemplates.map((template) => (
                <article
                  key={template.id}
                  className={template.id === bestTemplateId ? "best-template" : ""}
                >
                  <span className="queue-icon">
                    {template.channel === "email" ? "@" : template.channel === "telegram" ? "TG" : "in"}
                  </span>
                  {editingId === template.id ? (
                    <div className="queue-copy template-edit">
                      <label><small>{t.templateName}</small><input value={editDraft.name} onChange={(event) => setEditDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                      {template.channel === "email" && <label><small>{t.subject}</small><input value={editDraft.subject} onChange={(event) => setEditDraft((current) => ({ ...current, subject: event.target.value }))} /></label>}
                      <label><small>{t.message}</small><textarea value={editDraft.body} onChange={(event) => setEditDraft((current) => ({ ...current, body: event.target.value }))} /></label>
                      <small>{t.templateVariablesHint}</small>
                      <div className="queue-actions">
                        <button className="dark" disabled={busyTemplates} onClick={() => void submitEdit()}>{t.save}</button>
                        <button onClick={() => setEditingId("")}>{t.close}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="queue-copy">
                      <div>
                        <strong>{template.name}</strong>
                        <small>
                          {template.channel}
                          {template.engagementMode
                            ? ` · ${
                                template.engagementMode === "outreach"
                                  ? t.modeOutreach
                                  : template.engagementMode === "free_listing"
                                    ? t.modeFreeListing
                                    : t.modePaidPlacement
                              }`
                            : ""}
                          {template.id === bestTemplateId ? ` · ★ ${t.templateBest}` : ""}
                          {template.archived ? ` · ${t.templateArchivedBadge}` : ""}
                        </small>
                      </div>
                      <p>{template.subject ? `${template.subject} — ` : ""}{template.body}</p>
                      <small>
                        {t.templateSentCol}: {template.sentCount} · {t.templateRepliesCol}: {template.replyCount} · {t.templateReplyRate}: {replyRateLabel(template)}
                      </small>
                    </div>
                  )}
                  {editingId !== template.id && (
                    <div className="queue-actions">
                      {!template.archived && (
                        <button disabled={busyTemplates} onClick={() => startEdit(template)}>{t.templateEdit}</button>
                      )}
                      <button
                        disabled={busyTemplates}
                        onClick={() => void setTemplateArchived(template.id, !template.archived)}
                      >
                        {template.archived ? t.templateUnarchive : t.templateArchive}
                      </button>
                      <button className="remove" disabled={busyTemplates} onClick={() => void deleteTemplate(template.id)}>×</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        {selectedLead && selectedLeadMode === "outreach" && sequenceSteps.length > 0 && (
          <section className="panel native-sequence-editor" id="sequences">
            <div className="section-head">
              <div><small>✦</small><div><h2>{locale === "ru" ? "Цепочка Chanlyst" : "Chanlyst sequence"}</h2><p>{selectedLead.company} · Gmail</p></div></div>
              <strong>{sequenceSteps.length}</strong>
            </div>
            <div className="sequence-steps">
              {sequenceSteps.map((step, index) => (
                <article key={`native-${index}`}>
                  <span>{index + 1}</span>
                  <div>
                    <label><small>{locale === "ru" ? "Тема" : "Subject"}</small><input value={step.subject} onChange={(event) => setSequenceSteps((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, subject: event.target.value } : item))} /></label>
                    <label><small>{locale === "ru" ? "Текст" : "Body"}</small><textarea value={step.body} onChange={(event) => setSequenceSteps((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, body: event.target.value } : item))} /></label>
                  </div>
                  <label className="sequence-delay"><small>{locale === "ru" ? "Пауза, дней" : "Delay, days"}</small><input type="number" min={index === 0 ? 0 : 1} max="30" value={step.delayDays} disabled={index === 0} onChange={(event) => setSequenceSteps((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, delayDays: Math.max(index === 0 ? 0 : 1, Number(event.target.value) || 0) } : item))} /></label>
                </article>
              ))}
            </div>
            {savedSequence ? (
              // The draft is saved; starting it must be possible right here
              // instead of sending the user off to another page to find it.
              <div className="sequence-saved">
                <p>{t.sequenceSavedConfirm}</p>
                <div className="queue-actions">
                  <button
                    className="lime"
                    disabled={busy === "sequence"}
                    onClick={() => void startSavedSequence()}
                  >
                    {t.sequenceStartNow}
                  </button>
                  <button onClick={dismissSavedSequence}>{t.sequenceKeepDraft}</button>
                </div>
              </div>
            ) : (
              <div className="native-sequence-actions">
                <p>{locale === "ru" ? "После создания это будет черновик. Отправка начнётся только после отдельного подтверждения «Запустить»." : "This will be saved as a draft. Sending starts only after a separate Start confirmation."}</p>
                <button className="dark" onClick={createOutreachSequence} disabled={busy === "sequence"}>{locale === "ru" ? "Сохранить черновик" : "Save draft"}</button>
              </div>
            )}
          </section>
        )}
    </>
  );
}
