import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Dictionary } from "../i18n";

const storagePrefix = "chanlyst.checklist.";

type StepAction = { label: string; href?: string; onClick?: () => void };

// Another tab can retire the checklist too; nothing else writes the flag.
function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readDismissed(storageKey: string) {
  try {
    return window.localStorage.getItem(storageKey) === "done";
  } catch {
    // Storage unavailable (private mode): show the checklist.
    return false;
  }
}

function writeDismissed(storageKey: string) {
  try {
    window.localStorage.setItem(storageKey, "done");
  } catch {
    // Storage unavailable — the block still stays hidden for this session.
  }
}

/**
 * The five steps between an empty workspace and the first reply. The block is
 * onboarding, not a permanent widget: once every step is done it disappears
 * and the completion is written to localStorage per workspace, so a returning
 * user with a full funnel never sees it again. "Скрыть" writes the same flag.
 */
export default function LaunchChecklist({
  t,
  workspaceId,
  ready,
  productAdded,
  analysisDone,
  channelsFound,
  messageSent,
  replyReceived,
  addProduct,
  analysisHref,
  channelsHref,
}: {
  t: Dictionary;
  workspaceId: string;
  /** The lead request has settled; before that the steps are unknown. */
  ready: boolean;
  productAdded: boolean;
  analysisDone: boolean;
  channelsFound: boolean;
  messageSent: boolean;
  replyReceived: boolean;
  addProduct: () => void;
  /** The product card lives on its own page now, so this step navigates. */
  analysisHref: string;
  channelsHref: string;
}) {
  const storageKey = `${storagePrefix}${workspaceId || "default"}`;
  // localStorage is read through an external store so the value survives
  // hydration: a plain useState initializer would keep the server snapshot
  // (always false) and the block would come back for users who finished.
  // The server snapshot is false; nothing renders until `ready` anyway.
  const storedDismissed = useSyncExternalStore(
    subscribeToStorage,
    useCallback(() => readDismissed(storageKey), [storageKey]),
    () => false,
  );
  // "Скрыть" in this tab: the write below does not fire a storage event here.
  const [dismissedNow, setDismissedNow] = useState(false);
  const dismissed = dismissedNow || storedDismissed;

  const steps: Array<{
    key: string;
    title: string;
    hint: string;
    done: boolean;
    action?: StepAction;
  }> = [
    {
      key: "product",
      title: t.checklistProductTitle,
      hint: t.checklistProductHint,
      done: productAdded,
      action: { label: t.checklistProductAction, onClick: addProduct },
    },
    {
      key: "analysis",
      title: t.checklistAnalysisTitle,
      hint: t.checklistAnalysisHint,
      done: analysisDone,
      action: { label: t.checklistAnalysisAction, href: analysisHref },
    },
    {
      key: "channels",
      title: t.checklistChannelsTitle,
      hint: t.checklistChannelsHint,
      done: channelsFound,
      action: { label: t.checklistChannelsAction, href: channelsHref },
    },
    {
      key: "message",
      title: t.checklistMessageTitle,
      hint: t.checklistMessageHint,
      done: messageSent,
      action: { label: t.checklistMessageAction, href: channelsHref },
    },
    {
      key: "reply",
      title: t.checklistReplyTitle,
      hint: t.checklistReplyHint,
      done: replyReceived,
    },
  ];
  const doneCount = steps.filter((step) => step.done).length;
  const complete = doneCount === steps.length;

  // Finishing the last step retires the block for good: the completion is
  // written once, so the checklist never returns on a later visit.
  useEffect(() => {
    if (!ready || !complete) return;
    writeDismissed(storageKey);
  }, [ready, complete, storageKey]);

  if (!ready || dismissed || complete) return null;

  return (
    <section className="panel launch-checklist">
      <div className="section-head">
        <div>
          <small>✓</small>
          <div>
            <h2>{t.checklistTitle}</h2>
            <p>{t.checklistHint}</p>
          </div>
        </div>
        <div className="head-actions">
          <strong>
            {doneCount}/{steps.length}
          </strong>
          <button
            className="checklist-hide"
            type="button"
            onClick={() => {
              writeDismissed(storageKey);
              setDismissedNow(true);
            }}
          >
            {t.checklistDismiss}
          </button>
        </div>
      </div>
      <ol className="checklist-list">
        {steps.map((step, index) => (
          <li key={step.key} className={step.done ? "done" : ""}>
            <i>{step.done ? "✓" : String(index + 1).padStart(2, "0")}</i>
            <div>
              <strong>{step.title}</strong>
              {!step.done && <p>{step.hint}</p>}
            </div>
            {!step.done && step.action ? (
              step.action.href ? (
                <a className="checklist-action" href={step.action.href}>
                  {step.action.label}
                </a>
              ) : (
                <button
                  className="checklist-action"
                  type="button"
                  onClick={step.action.onClick}
                >
                  {step.action.label}
                </button>
              )
            ) : (
              <span />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
