import { useState } from "react";
import type { Dictionary } from "../i18n";
import type { BusyState, LeadTask, LeadTaskType } from "../types";

// How many tasks the block shows before "показать все". A short list is the
// point: the user should finish it, not scroll it.
const visibleTaskCount = 5;

// Full days elapsed since an ISO timestamp; null when the value is missing so
// the age line can be hidden instead of showing NaN.
function daysSince(value?: string) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
}

// Everything the row renders for a task type, in one place: why the task
// exists, how its age reads, and what the primary button says.
function taskCopy(type: LeadTaskType, t: Dictionary) {
  const copy = {
    follow_up: {
      title: t.taskFollowUpTitle,
      why: t.taskFollowUpWhy,
      action: t.taskFollowUpAction,
      age: t.taskFollowUpAge,
      today: t.taskFollowUpToday,
    },
    revive: {
      title: t.taskReviveTitle,
      why: t.taskReviveWhy,
      action: t.taskReviveAction,
      age: t.taskReviveAge,
      today: t.taskReviveToday,
    },
    placement_check: {
      title: t.taskPlacementCheckTitle,
      why: t.taskPlacementCheckWhy,
      action: t.taskPlacementCheckAction,
      age: t.taskPlacementCheckAge,
      today: t.taskPlacementCheckToday,
    },
    placement_verify: {
      title: t.taskPlacementVerifyTitle,
      why: t.taskPlacementVerifyWhy,
      action: t.taskPlacementVerifyAction,
      age: t.taskPlacementVerifyAge,
      today: t.taskPlacementVerifyToday,
    },
    advance_deal: {
      title: t.taskAdvanceDealTitle,
      why: t.taskAdvanceDealWhy,
      action: t.taskAdvanceDealAction,
      age: t.taskAdvanceDealAge,
      today: t.taskAdvanceDealToday,
    },
    listing_missing: {
      title: t.taskListingMissingTitle,
      why: t.taskListingMissingWhy,
      action: t.taskListingMissingAction,
      age: t.taskListingMissingAge,
      today: t.taskListingMissingToday,
    },
    terms_changed: {
      title: t.taskTermsChangedTitle,
      why: t.taskTermsChangedWhy,
      action: t.taskTermsChangedAction,
      age: t.taskTermsChangedAge,
      today: t.taskTermsChangedToday,
    },
    channel_unreachable: {
      title: t.taskChannelUnreachableTitle,
      why: t.taskChannelUnreachableWhy,
      action: t.taskChannelUnreachableAction,
      age: t.taskChannelUnreachableAge,
      today: t.taskChannelUnreachableToday,
    },
  };
  return copy[type];
}

/** Keep a price excerpt short enough to read inside a task row. */
function shortTerms(value?: string) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "—";
  return text.length > 70 ? `${text.slice(0, 70)}…` : text;
}

// The one line that names WHAT the monitor saw. Without it a "terms changed"
// row would send the user to the page to guess what moved.
function taskDetail(task: LeadTask, t: Dictionary) {
  if (task.type === "terms_changed") {
    return t.taskTermsChangedDetail
      .replace("{from}", shortTerms(task.payload.previousTerms))
      .replace("{to}", shortTerms(task.payload.currentTerms));
  }
  const code = Number(task.payload.statusCode) || 0;
  if (task.type === "listing_missing" && code >= 400) {
    return t.taskListingMissingGone.replace("{code}", String(code));
  }
  if (task.type === "channel_unreachable" && code > 0) {
    return t.taskChannelUnreachableCode.replace("{code}", String(code));
  }
  return "";
}

export default function TodaySection({
  t,
  tasks,
  busy,
  startTask,
  snoozeTask,
  dismissTask,
  refreshTasks,
}: {
  t: Dictionary;
  tasks: LeadTask[];
  busy: BusyState;
  startTask: (task: LeadTask) => void;
  snoozeTask: (task: LeadTask) => Promise<void>;
  dismissTask: (task: LeadTask) => Promise<void>;
  refreshTasks: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? tasks : tasks.slice(0, visibleTaskCount);
  const working = busy === "tasks";

  return (
    <section className="panel today" id="today">
      <div className="section-head">
        <div>
          <div>
            <h2>{t.today}</h2>
            <p>{t.todayHint}</p>
          </div>
        </div>
        <div className="head-actions">
          <button
            className="outline"
            disabled={working}
            onClick={() => void refreshTasks()}
          >
            {working ? t.todayRefreshing : t.todayRefresh}
          </button>
          <strong>{tasks.length}</strong>
        </div>
      </div>
      {!tasks.length ? (
        <div className="empty horizontal today-empty">
          <span>✓</span>
          <p>
            <b>{t.todayEmpty}</b>
            <br />
            {t.todayEmptyHint}
          </p>
        </div>
      ) : (
        <>
          <ul className="today-list">
            {visible.map((task) => {
              const copy = taskCopy(task.type, t);
              const days = daysSince(task.payload.sinceAt);
              const detail = taskDetail(task, t);
              return (
                <li key={task.id} className={`today-row ${task.type}`}>
                  <span className="avatar">
                    {task.lead.company.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="today-copy">
                    <div>
                      <strong>{task.lead.company}</strong>
                      <small>{copy.title}</small>
                    </div>
                    <p>{copy.why}</p>
                    {detail && <p className="today-detail">{detail}</p>}
                    <em>
                      {days === null
                        ? task.productName
                        : days === 0
                          ? copy.today
                          : copy.age.replace("{days}", String(days))}
                      {task.productName && days !== null
                        ? ` · ${task.productName}`
                        : ""}
                    </em>
                  </div>
                  <div className="today-actions">
                    <button className="dark" onClick={() => startTask(task)}>
                      {copy.action}
                    </button>
                    <button
                      disabled={working}
                      onClick={() => void snoozeTask(task)}
                    >
                      {t.todaySnooze}
                    </button>
                    <button
                      className="remove"
                      disabled={working}
                      onClick={() => void dismissTask(task)}
                    >
                      {t.todayDismiss}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {tasks.length > visibleTaskCount && (
            <button
              className="outline today-toggle"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded
                ? t.todayShowLess
                : `${t.todayShowAll} (${tasks.length})`}
            </button>
          )}
          <p className="today-safe">{t.todaySafeNote}</p>
        </>
      )}
    </section>
  );
}
