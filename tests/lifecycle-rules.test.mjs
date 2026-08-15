import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultLifecycleSettings,
  planLeadTasks,
} from "../app/lib/lifecycle-rules.mjs";

const now = "2026-07-27T09:00:00.000Z";
const nowMs = Date.parse(now);

/** An ISO timestamp `days` before the fixed "now" of these tests. */
function daysAgo(days) {
  return new Date(nowMs - days * 86_400_000).toISOString();
}

function lead(overrides = {}) {
  return {
    id: "lead-1",
    workspaceId: "ws-1",
    productId: "product-1",
    stage: "contacted",
    outcomeNote: "",
    contactedAt: null,
    repliedAt: null,
    meetingAt: null,
    convertedAt: null,
    placementStatus: "",
    placementSubmittedAt: null,
    placementCheckedAt: null,
    placementUrl: "",
    ...overrides,
  };
}

function plan({ leads, sequences = [], events = [], tasks = [], settings }) {
  return planLeadTasks({ now, leads, sequences, events, tasks, settings });
}

function types(created) {
  return created.map((task) => task.type).sort();
}

/** A finished sequence whose last message went out `days` ago. */
function finishedOutreach(days, overrides = {}) {
  return {
    sequences: [
      {
        id: "seq-1",
        leadId: "lead-1",
        name: "Первый заход",
        status: "completed",
        ...overrides,
      },
    ],
    events: [
      {
        leadId: "lead-1",
        sequenceId: "seq-1",
        stepNumber: 2,
        eventType: "sent",
        metadata: JSON.stringify({ templateId: "tpl-1" }),
        occurredAt: daysAgo(days),
      },
    ],
  };
}

test("defaults match the documented thresholds", () => {
  assert.deepEqual(defaultLifecycleSettings, {
    followUpDays: 21,
    reviveDays: 90,
    placementCheckDays: 7,
    placementVerifyDays: 30,
    advanceDealDays: 7,
    maxFollowUps: 3,
  });
});

test("follow_up fires exactly at the threshold and not before", () => {
  const before = plan({ leads: [lead()], ...finishedOutreach(20) });
  assert.deepEqual(before.create, []);

  const at = plan({ leads: [lead()], ...finishedOutreach(21) });
  assert.deepEqual(types(at.create), ["follow_up"]);
  assert.equal(at.create[0].leadId, "lead-1");
  assert.equal(at.create[0].productId, "product-1");
  // The payload names what was already tried so the UI can propose another
  // template instead of repeating the one that went unanswered.
  assert.equal(at.create[0].payload.lastSequenceId, "seq-1");
  assert.equal(at.create[0].payload.lastSequenceName, "Первый заход");
  assert.equal(at.create[0].payload.lastTemplateId, "tpl-1");
  assert.equal(at.create[0].payload.sinceAt, daysAgo(21));
});

test("follow_up ignores leads that replied and unfinished sequences", () => {
  const replied = plan({
    leads: [lead({ repliedAt: daysAgo(30), stage: "meeting" })],
    ...finishedOutreach(40),
  });
  assert.deepEqual(replied.create, []);

  const running = plan({
    leads: [lead()],
    ...finishedOutreach(40, { status: "active" }),
  });
  assert.deepEqual(running.create, []);
});

test("follow_up thresholds are configurable", () => {
  const custom = plan({
    leads: [lead()],
    ...finishedOutreach(10),
    settings: { followUpDays: 10 },
  });
  assert.deepEqual(types(custom.create), ["follow_up"]);
});

test("planning is idempotent: an open task is never duplicated", () => {
  const state = { leads: [lead()], ...finishedOutreach(30) };
  const first = plan(state);
  assert.equal(first.create.length, 1);

  const existing = [
    { id: "task-1", leadId: "lead-1", type: "follow_up", status: "open" },
  ];
  const second = plan({ ...state, tasks: existing });
  assert.deepEqual(second.create, []);
  assert.deepEqual(second.close, []);

  // A snoozed task holds the slot too, and a dismissed one is never revived.
  for (const status of ["snoozed", "dismissed"]) {
    const held = plan({
      ...state,
      tasks: [{ ...existing[0], status }],
    });
    assert.deepEqual(held.create, []);
  }
});

test("a follow_up closes automatically once the lead replies", () => {
  const tasks = [
    { id: "task-1", leadId: "lead-1", type: "follow_up", status: "open" },
  ];
  const answered = plan({
    leads: [lead({ repliedAt: daysAgo(1), stage: "replied" })],
    ...finishedOutreach(30),
    tasks,
  });
  assert.deepEqual(answered.close, [
    {
      id: "task-1",
      type: "follow_up",
      leadId: "lead-1",
      reason: "condition_cleared",
    },
  ]);
});

test("a task for a lead that no longer exists is closed", () => {
  const orphan = plan({
    leads: [],
    tasks: [
      { id: "task-9", leadId: "gone", type: "follow_up", status: "open" },
    ],
  });
  assert.deepEqual(orphan.close, [
    { id: "task-9", type: "follow_up", leadId: "gone", reason: "lead_missing" },
  ]);
});

test("finished and dismissed tasks are never auto-closed again", () => {
  const settled = plan({
    leads: [lead()],
    tasks: [
      { id: "task-1", leadId: "lead-1", type: "follow_up", status: "done" },
      { id: "task-2", leadId: "lead-1", type: "follow_up", status: "dismissed" },
    ],
  });
  assert.deepEqual(settled.close, []);
});

test("the follow-up cap stops at three per lead", () => {
  const state = { leads: [lead()], ...finishedOutreach(30) };
  const history = (count) =>
    Array.from({ length: count }, (_, index) => ({
      id: `task-${index}`,
      leadId: "lead-1",
      type: "follow_up",
      status: "done",
      completedAt: daysAgo(25),
    }));

  // Two historical follow-ups still leave room for the third.
  const third = plan({ ...state, tasks: history(2) });
  assert.deepEqual(types(third.create), ["follow_up"]);

  // The fourth is never prepared, however long the silence lasts.
  const fourth = plan({ ...state, tasks: history(3) });
  assert.equal(
    fourth.create.filter((task) => task.type === "follow_up").length,
    0,
  );
  // ...and the cap does not retroactively close the tasks already there.
  assert.deepEqual(fourth.close, []);
});

test("revive fires for a lost lead only after the long pause", () => {
  const lost = (days) =>
    plan({
      leads: [
        lead({
          stage: "lost",
          contactedAt: daysAgo(days),
          outcomeNote: "Отказали: нет бюджета",
        }),
      ],
    });

  assert.deepEqual(lost(89).create, []);
  const revived = lost(90);
  assert.deepEqual(types(revived.create), ["revive"]);
  assert.equal(revived.create[0].payload.lastOutcomeNote, "Отказали: нет бюджета");
  assert.equal(revived.create[0].payload.stage, "lost");
});

test("revive also fires after two unanswered follow-ups", () => {
  const tasks = [
    {
      id: "task-1",
      leadId: "lead-1",
      type: "follow_up",
      status: "done",
      completedAt: daysAgo(95),
    },
    {
      id: "task-2",
      leadId: "lead-1",
      type: "follow_up",
      status: "done",
      completedAt: daysAgo(92),
    },
  ];
  const cold = plan({
    leads: [lead({ contactedAt: daysAgo(120) })],
    ...finishedOutreach(100),
    tasks,
  });
  assert.ok(cold.create.some((task) => task.type === "revive"));

  // A single unanswered follow-up is not enough for a re-approach.
  const single = plan({
    leads: [lead({ contactedAt: daysAgo(120) })],
    ...finishedOutreach(100),
    tasks: [tasks[0]],
  });
  assert.equal(single.create.filter((task) => task.type === "revive").length, 0);
});

test("revive closes when the lead is worked on again", () => {
  const tasks = [
    { id: "task-r", leadId: "lead-1", type: "revive", status: "open" },
  ];
  const reopened = plan({
    leads: [lead({ stage: "lost", contactedAt: daysAgo(2) })],
    tasks,
  });
  assert.deepEqual(
    reopened.close.map((item) => item.id),
    ["task-r"],
  );
});

test("placement_check fires at seven days and stops once checked", () => {
  const submitted = (days, checkedAt = null) =>
    plan({
      leads: [
        lead({
          placementStatus: "submitted",
          placementSubmittedAt: daysAgo(days),
          placementCheckedAt: checkedAt,
        }),
      ],
    });

  assert.deepEqual(submitted(6).create, []);
  const due = submitted(7);
  assert.deepEqual(types(due.create), ["placement_check"]);
  assert.equal(due.create[0].payload.sinceAt, daysAgo(7));

  // A check recorded after the submission clears the task condition.
  const checked = submitted(30, daysAgo(1));
  assert.deepEqual(checked.create, []);
  // ...and a check recorded BEFORE the submission does not count.
  const stale = submitted(30, daysAgo(40));
  assert.deepEqual(types(stale.create), ["placement_check"]);
});

test("an open placement_check closes when the listing is published", () => {
  const published = plan({
    leads: [
      lead({
        placementStatus: "published",
        placementSubmittedAt: daysAgo(20),
        placementCheckedAt: daysAgo(1),
      }),
    ],
    tasks: [
      { id: "task-p", leadId: "lead-1", type: "placement_check", status: "open" },
    ],
  });
  assert.deepEqual(published.create, []);
  assert.deepEqual(
    published.close.map((item) => item.id),
    ["task-p"],
  );
});

test("placement_verify re-checks a live listing after thirty days", () => {
  const live = (days) =>
    plan({
      leads: [
        lead({
          placementStatus: "published",
          placementSubmittedAt: daysAgo(days + 5),
          placementCheckedAt: daysAgo(days),
          placementUrl: "https://example.com/chanlyst",
        }),
      ],
    });

  assert.deepEqual(live(29).create, []);
  const due = live(30);
  assert.deepEqual(types(due.create), ["placement_verify"]);
  assert.equal(due.create[0].payload.placementUrl, "https://example.com/chanlyst");

  // Without a check timestamp the submission date drives the cadence.
  const neverChecked = plan({
    leads: [
      lead({
        placementStatus: "published",
        placementSubmittedAt: daysAgo(45),
        placementCheckedAt: null,
      }),
    ],
  });
  assert.deepEqual(types(neverChecked.create), ["placement_verify"]);
});

test("advance_deal fires for a reply that sat untouched for a week", () => {
  const parked = (days, stage = "replied") =>
    plan({
      leads: [lead({ stage, repliedAt: daysAgo(days) })],
    });

  assert.deepEqual(parked(6).create, []);
  const due = parked(7);
  assert.deepEqual(types(due.create), ["advance_deal"]);
  assert.equal(due.create[0].payload.sinceAt, daysAgo(7));

  // Moving the deal forward is exactly what makes the task unnecessary.
  assert.deepEqual(parked(30, "meeting").create, []);
});

test("advance_deal closes once somebody moves the stage", () => {
  const moved = plan({
    leads: [lead({ stage: "won", repliedAt: daysAgo(30) })],
    tasks: [
      { id: "task-a", leadId: "lead-1", type: "advance_deal", status: "open" },
    ],
  });
  assert.deepEqual(
    moved.close.map((item) => item.id),
    ["task-a"],
  );
});

test("a snoozed task is closed too when its reason disappears", () => {
  const cleared = plan({
    leads: [lead({ stage: "won", repliedAt: daysAgo(30) })],
    tasks: [
      { id: "task-s", leadId: "lead-1", type: "advance_deal", status: "snoozed" },
    ],
  });
  assert.deepEqual(
    cleared.close.map((item) => item.id),
    ["task-s"],
  );
});

test("independent rules can fire together for one lead", () => {
  const combined = plan({
    leads: [
      lead({
        stage: "replied",
        repliedAt: daysAgo(14),
        placementStatus: "submitted",
        placementSubmittedAt: daysAgo(30),
      }),
    ],
  });
  assert.deepEqual(types(combined.create), ["advance_deal", "placement_check"]);
});

test("a second planning pass over the produced tasks creates nothing", () => {
  const leads = [
    lead({
      stage: "replied",
      repliedAt: daysAgo(14),
      placementStatus: "submitted",
      placementSubmittedAt: daysAgo(30),
    }),
  ];
  const first = planLeadTasks({ now, leads, sequences: [], events: [], tasks: [] });
  const stored = first.create.map((task, index) => ({
    id: `task-${index}`,
    leadId: task.leadId,
    type: task.type,
    status: "open",
  }));
  const second = planLeadTasks({
    now,
    leads,
    sequences: [],
    events: [],
    tasks: stored,
  });
  assert.deepEqual(second.create, []);
  assert.deepEqual(second.close, []);
});
