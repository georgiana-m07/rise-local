# RISE Local Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A zero-dependency local web app that rebuilds RISE's core: manual sleep logging, learned sleep need, 14-night weighted sleep debt, and a daily energy schedule with labeled circadian zones.

**Architecture:** Pure sleep-science model in `sleep-model.js` (no DOM), localStorage persistence in `store.js`, UI wiring + SVG charts in `app.js`, static shell in `index.html`/`style.css`. Served by `python3 -m http.server` via `run.sh`. Unit tests run with Node's built-in `node --test`.

**Tech Stack:** Vanilla ES modules, localStorage, SVG. Node 25 for tests, Python 3 for the static server. No packages.

---

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `run.sh`, `.gitignore`

- [ ] **Step 1: Write `package.json`** (only exists so Node treats `.js` as ESM and to hold the test script)

```json
{
  "name": "rise-local",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test test/" }
}
```

- [ ] **Step 2: Write `run.sh`** and `chmod +x run.sh`

```bash
#!/bin/bash
cd "$(dirname "$0")"
PORT=8713
(sleep 1; open "http://localhost:$PORT") &
exec python3 -m http.server "$PORT"
```

- [ ] **Step 3: Write `.gitignore`**

```
.DS_Store
```

- [ ] **Step 4: Commit** — `git add -A && git commit -m "Scaffold rise-local"`

---

### Task 2: Model — durations, nightly totals, date helpers

**Files:**
- Create: `sleep-model.js`
- Test: `test/sleep-model.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  durationHours, nightlyTotals, isoDaysAgo,
} from "../sleep-model.js";

const night = (date, start, end, type = "sleep") => ({ id: date + type, date, start, end, type });

test("durationHours computes hours from ISO timestamps", () => {
  const s = night("2026-07-05", "2026-07-04T23:00:00", "2026-07-05T07:30:00");
  assert.equal(durationHours(s), 8.5);
});

test("nightlyTotals sums sleep and naps attributed to the same wake date", () => {
  const totals = nightlyTotals([
    night("2026-07-05", "2026-07-04T23:00:00", "2026-07-05T06:00:00"),
    night("2026-07-05", "2026-07-05T14:00:00", "2026-07-05T15:00:00", "nap"),
    night("2026-07-04", "2026-07-03T23:00:00", "2026-07-04T07:00:00"),
  ]);
  assert.equal(totals.get("2026-07-05"), 8);
  assert.equal(totals.get("2026-07-04"), 8);
});

test("isoDaysAgo walks back across month boundaries", () => {
  assert.equal(isoDaysAgo("2026-07-05", 0), "2026-07-05");
  assert.equal(isoDaysAgo("2026-07-05", 6), "2026-06-29");
});
```

- [ ] **Step 2: Run `npm test`** — expect FAIL (module not found)
- [ ] **Step 3: Implement in `sleep-model.js`**

```js
export const DEFAULT_NEED_HOURS = 8;
export const DEBT_DECAY = 0.9;
export const DEBT_WINDOW_DAYS = 14;

export function durationHours(session) {
  return (new Date(session.end) - new Date(session.start)) / 3_600_000;
}

export function nightlyTotals(sessions) {
  const totals = new Map();
  for (const s of sessions) {
    totals.set(s.date, (totals.get(s.date) ?? 0) + durationHours(s));
  }
  return totals;
}

export function isoDaysAgo(todayIso, n) {
  const d = new Date(todayIso + "T12:00:00");
  d.setDate(d.getDate() - n);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
```

- [ ] **Step 4: Run `npm test`** — expect PASS
- [ ] **Step 5: Commit** — `git commit -m "Add nightly totals and date helpers"`

---

### Task 3: Model — sleep need estimation

**Files:**
- Modify: `sleep-model.js`
- Test: `test/sleep-model.test.js`

- [ ] **Step 1: Write failing tests**

```js
test("estimateSleepNeed falls back to 8h default under 7 nights of data", () => {
  const r = estimateSleepNeed([], "2026-07-05");
  assert.equal(r.hours, 8);
  assert.equal(r.estimated, false);
});

test("estimateSleepNeed uses 75th percentile of recent nightly totals, clamped", () => {
  const sessions = [];
  for (let age = 0; age < 10; age++) {
    const date = isoDaysAgo("2026-07-05", age);
    const prev = isoDaysAgo("2026-07-05", age + 1);
    // durations 6.0, 6.25, ... 8.25h
    const mins = 360 + age * 15;
    sessions.push({ id: date, date, type: "sleep",
      start: `${prev}T22:00:00`,
      end: new Date(new Date(`${prev}T22:00:00`).getTime() + mins * 60000).toISOString() });
  }
  const r = estimateSleepNeed(sessions, "2026-07-05");
  assert.equal(r.estimated, true);
  assert.ok(r.hours > 7.5 && r.hours < 8.3, `p75 in range, got ${r.hours}`);
});
```

(The `end` computed from start + minutes is fine even though `date` doesn't match the end timestamp — `nightlyTotals` groups by the `date` field.)

- [ ] **Step 2: Run `npm test`** — expect FAIL (`estimateSleepNeed` not exported)
- [ ] **Step 3: Implement**

```js
function percentile(sortedAsc, p) {
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

export function estimateSleepNeed(sessions, todayIso) {
  const totals = nightlyTotals(sessions);
  const values = [];
  for (let age = 0; age < 60; age++) {
    const d = isoDaysAgo(todayIso, age);
    if (totals.has(d)) values.push(totals.get(d));
  }
  if (values.length < 7) return { hours: DEFAULT_NEED_HOURS, estimated: false };
  values.sort((a, b) => a - b);
  const hours = Math.min(10, Math.max(6.5, percentile(values, 0.75)));
  return { hours, estimated: true };
}
```

- [ ] **Step 4: Run `npm test`** — expect PASS
- [ ] **Step 5: Commit** — `git commit -m "Add sleep need estimation"`

---

### Task 4: Model — sleep debt

**Files:**
- Modify: `sleep-model.js`
- Test: `test/sleep-model.test.js`

- [ ] **Step 1: Write failing tests**

```js
const mkNight = (todayIso, age, hours) => {
  const date = isoDaysAgo(todayIso, age);
  const start = `${isoDaysAgo(todayIso, age + 1)}T23:00:00`;
  return { id: date, date, type: "sleep", start,
    end: new Date(new Date(start).getTime() + hours * 3_600_000).toISOString() };
};

test("sleepDebt weights recent shortfall more than old shortfall", () => {
  const recent = sleepDebt([mkNight("2026-07-05", 0, 6)], 8, "2026-07-05");
  const old = sleepDebt([mkNight("2026-07-05", 10, 6)], 8, "2026-07-05");
  assert.ok(recent.hours > old.hours);
  assert.ok(Math.abs(recent.hours - 2) < 1e-9); // decay^0 * (8-6)
});

test("sleepDebt ignores nights outside the 14-night window", () => {
  const r = sleepDebt([mkNight("2026-07-05", 20, 4)], 8, "2026-07-05");
  assert.equal(r.hours, 0);
});

test("surplus nights offset deficits; debt never negative", () => {
  const d = sleepDebt([mkNight("2026-07-05", 0, 10)], 8, "2026-07-05");
  assert.equal(d.hours, 0);
  const mixed = sleepDebt(
    [mkNight("2026-07-05", 0, 6), mkNight("2026-07-05", 1, 9.5)], 8, "2026-07-05");
  assert.ok(mixed.hours < 2 && mixed.hours > 0);
});

test("status bands: low < 5, moderate 5-10, high > 10", () => {
  assert.equal(sleepDebt([mkNight("2026-07-05", 0, 6)], 8, "2026-07-05").status, "low");
  const nights = [0, 1, 2, 3].map((a) => mkNight("2026-07-05", a, 6));
  assert.equal(sleepDebt(nights, 8, "2026-07-05").status, "moderate");
  const bad = [0, 1, 2, 3, 4, 5, 6].map((a) => mkNight("2026-07-05", a, 5.5));
  assert.equal(sleepDebt(bad, 8, "2026-07-05").status, "high");
});
```

- [ ] **Step 2: Run `npm test`** — expect FAIL
- [ ] **Step 3: Implement**

```js
export function sleepDebt(sessions, needHours, todayIso) {
  const totals = nightlyTotals(sessions);
  let debt = 0;
  for (let age = 0; age < DEBT_WINDOW_DAYS; age++) {
    const d = isoDaysAgo(todayIso, age);
    if (!totals.has(d)) continue; // no data: assume need was met
    debt += Math.pow(DEBT_DECAY, age) * (needHours - totals.get(d));
  }
  const hours = Math.max(0, debt);
  const status = hours < 5 ? "low" : hours <= 10 ? "moderate" : "high";
  return { hours, status };
}
```

- [ ] **Step 4: Run `npm test`** — expect PASS
- [ ] **Step 5: Commit** — `git commit -m "Add weighted 14-night sleep debt"`

---

### Task 5: Model — suggested bedtime + energy schedule

**Files:**
- Modify: `sleep-model.js`
- Test: `test/sleep-model.test.js`

- [ ] **Step 1: Write failing tests**

```js
test("suggestedBedtime = wake goal minus (need + paydown), wrapped to a day", () => {
  // wake 7:30 = 450min, need 8h, no debt -> 23:30 = 1410
  assert.equal(suggestedBedtime(450, 8, 0), 1410);
  // 10h debt -> paydown capped at 1h -> 22:30
  assert.equal(suggestedBedtime(450, 8, 10), 1350);
});

test("energySchedule zones are ordered and melatonin window is 60min ending at bedtime", () => {
  const s = energySchedule({ wakeMin: 450, needHours: 8, debtHours: 2, wakeGoalMin: 450 });
  const keys = s.zones.map((z) => z.key);
  assert.deepEqual(keys,
    ["groggy", "morningPeak", "dip", "eveningPeak", "windDown", "melatonin"]);
  for (let i = 1; i < s.zones.length; i++)
    assert.ok(s.zones[i].start >= s.zones[i - 1].start, "zones sorted");
  const mel = s.zones.at(-1);
  assert.equal(mel.end - mel.start, 60);
  assert.equal(mel.end % 1440, s.bedtimeMin);
});

test("energy curve stays in 0..100 and peaks beat the afternoon dip", () => {
  const s = energySchedule({ wakeMin: 450, needHours: 8, debtHours: 0, wakeGoalMin: 450 });
  for (const p of s.curve) assert.ok(p.energy >= 0 && p.energy <= 100);
  const at = (t) => s.curve.find((p) => p.t === t)?.energy;
  assert.ok(at(450 + 210) > at(450 + 420), "morning peak > dip");
  assert.ok(at(450 + 600) > at(450 + 420), "evening peak > dip");
});

test("higher sleep debt flattens the morning peak", () => {
  const rested = energySchedule({ wakeMin: 450, needHours: 8, debtHours: 0, wakeGoalMin: 450 });
  const tired = energySchedule({ wakeMin: 450, needHours: 8, debtHours: 15, wakeGoalMin: 450 });
  const peak = (s) => s.curve.find((p) => p.t === 450 + 210).energy;
  assert.ok(peak(tired) < peak(rested));
});
```

- [ ] **Step 2: Run `npm test`** — expect FAIL
- [ ] **Step 3: Implement**

```js
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function suggestedBedtime(wakeGoalMin, needHours, debtHours) {
  const paydown = Math.min(1, debtHours * 0.2);
  const sleepMin = (needHours + paydown) * 60;
  return (((wakeGoalMin - sleepMin) % 1440) + 1440) % 1440;
}

export function energySchedule({ wakeMin, needHours, debtHours, wakeGoalMin }) {
  let bed = suggestedBedtime(wakeGoalMin ?? wakeMin, needHours, debtHours);
  while (bed <= wakeMin + 240) bed += 1440; // bedtime sits on a same-day axis after wake

  const morningPeakCenter = wakeMin + 210;
  const dipCenter = wakeMin + 420;
  const eveningPeakCenter = wakeMin + 600;
  const debtFactor = clamp(1 - debtHours / 20, 0.5, 1);

  const energyAt = (t) => {
    if (t < wakeMin || t > bed) return 0;
    let e = 55;
    e += 30 * debtFactor * Math.exp(-(((t - morningPeakCenter) / 90) ** 2));
    e += 28 * debtFactor * Math.exp(-(((t - eveningPeakCenter) / 100) ** 2));
    e -= (15 + 10 * (1 - debtFactor)) * Math.exp(-(((t - dipCenter) / 75) ** 2));
    if (t - wakeMin < 90) e -= 35 * (1 - (t - wakeMin) / 90);
    if (t > eveningPeakCenter)
      e -= 30 * ((t - eveningPeakCenter) / Math.max(1, bed - eveningPeakCenter));
    return clamp(e, 5, 100);
  };

  const curve = [];
  for (let t = wakeMin; t <= bed; t += 10) curve.push({ t, energy: energyAt(t) });

  const melStart = bed - 60;
  const zones = [
    { key: "groggy", label: "Grogginess", start: wakeMin, end: wakeMin + 90 },
    { key: "morningPeak", label: "Morning peak", start: wakeMin + 150, end: wakeMin + 300 },
    { key: "dip", label: "Afternoon dip", start: wakeMin + 390, end: wakeMin + 510 },
    { key: "eveningPeak", label: "Evening peak", start: wakeMin + 540, end: wakeMin + 690 },
    { key: "windDown", label: "Wind-down", start: melStart - 60, end: melStart },
    { key: "melatonin", label: "Melatonin window", start: melStart, end: bed },
  ];
  return { zones, curve, bedtimeMin: bed % 1440, energyAt };
}
```

- [ ] **Step 4: Run `npm test`** — expect PASS
- [ ] **Step 5: Commit** — `git commit -m "Add energy schedule and bedtime suggestion"`

---

### Task 6: Store — persistence + validation

**Files:**
- Create: `store.js`
- Test: `test/store.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStore, newSession, localIsoDate } from "../store.js";

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

test("sessions round-trip through storage", () => {
  const store = makeStore(fakeStorage());
  const s = newSession({ start: "2026-07-04T23:00", end: "2026-07-05T07:00", type: "sleep" });
  store.saveSessions([s]);
  assert.deepEqual(store.loadSessions(), [s]);
});

test("corrupt storage resets to empty instead of crashing", () => {
  const storage = fakeStorage();
  storage.setItem("rise.sessions", "{nope");
  assert.deepEqual(makeStore(storage).loadSessions(), []);
});

test("newSession rejects bad input", () => {
  assert.throws(() => newSession({ start: "x", end: "y", type: "sleep" }), /valid/i);
  assert.throws(() =>
    newSession({ start: "2026-07-05T08:00", end: "2026-07-05T07:00", type: "sleep" }), /after/i);
  assert.throws(() =>
    newSession({ start: "2026-07-04T07:00", end: "2026-07-05T07:00", type: "sleep" }), /16 hours/);
});

test("night is attributed to the wake date", () => {
  const s = newSession({ start: "2026-07-04T23:30", end: "2026-07-05T06:45", type: "sleep" });
  assert.equal(s.date, "2026-07-05");
  assert.equal(localIsoDate(new Date(2026, 6, 5)), "2026-07-05");
});

test("settings default and round-trip", () => {
  const store = makeStore(fakeStorage());
  assert.deepEqual(store.loadSettings(), { needOverride: null, wakeGoal: "07:30" });
  store.saveSettings({ needOverride: 7.5, wakeGoal: "06:45" });
  assert.deepEqual(store.loadSettings(), { needOverride: 7.5, wakeGoal: "06:45" });
});
```

- [ ] **Step 2: Run `npm test`** — expect FAIL
- [ ] **Step 3: Implement `store.js`**

```js
const SESSIONS_KEY = "rise.sessions";
const SETTINGS_KEY = "rise.settings";
const DEFAULT_SETTINGS = { needOverride: null, wakeGoal: "07:30" };

export function localIsoDate(d) {
  const dt = new Date(d);
  const p = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export function newSession({ start, end, type }) {
  const s = new Date(start), e = new Date(end);
  if (isNaN(s) || isNaN(e)) throw new Error("Enter valid start and end times.");
  if (e <= s) throw new Error("End time must be after start time.");
  if ((e - s) / 3_600_000 > 16)
    throw new Error("That session is longer than 16 hours. Double-check the dates.");
  return {
    id: crypto.randomUUID(),
    date: localIsoDate(e),
    start: s.toISOString(),
    end: e.toISOString(),
    type: type === "nap" ? "nap" : "sleep",
  };
}

export function makeStore(storage) {
  return {
    loadSessions() {
      try {
        const raw = JSON.parse(storage.getItem(SESSIONS_KEY) ?? "[]");
        return Array.isArray(raw)
          ? raw.filter((s) => s && s.id && s.date && s.start && s.end)
          : [];
      } catch {
        console.warn("rise-local: sessions storage was corrupt, starting empty");
        return [];
      }
    },
    saveSessions(sessions) { storage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); },
    loadSettings() {
      try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(storage.getItem(SETTINGS_KEY) ?? "{}") };
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    },
    saveSettings(settings) { storage.setItem(SETTINGS_KEY, JSON.stringify(settings)); },
  };
}
```

- [ ] **Step 4: Run `npm test`** — expect PASS
- [ ] **Step 5: Commit** — `git commit -m "Add localStorage store with validation"`

---

### Task 7: Sample data

**Files:**
- Create: `sample-data.js`
- Test: `test/sample-data.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSampleData } from "../sample-data.js";
import { nightlyTotals, estimateSleepNeed } from "../sleep-model.js";

test("sample data covers the full 14-night debt window", () => {
  const sessions = generateSampleData("2026-07-05");
  const totals = nightlyTotals(sessions);
  assert.equal(totals.size, 14);
  for (const h of totals.values()) assert.ok(h > 4 && h < 11);
  assert.ok(sessions.some((s) => s.type === "nap"), "includes a nap");
  assert.equal(estimateSleepNeed(sessions, "2026-07-05").estimated, true);
});
```

- [ ] **Step 2: Run `npm test`** — expect FAIL
- [ ] **Step 3: Implement `sample-data.js`**

```js
import { newSession } from "./store.js";
import { isoDaysAgo } from "./sleep-model.js";

// [bedtime on the previous day, wake time on the night's date]
const PATTERN = [
  ["23:40", "07:10"], ["00:15", "07:30"], ["23:05", "06:55"], ["01:10", "07:20"],
  ["23:30", "07:00"], ["23:55", "06:40"], ["22:45", "06:50"], ["23:20", "07:05"],
  ["00:40", "07:15"], ["23:10", "06:45"], ["23:35", "07:25"], ["01:30", "07:10"],
  ["23:00", "07:00"], ["23:25", "06:55"],
];

export function generateSampleData(todayIso) {
  const sessions = [];
  PATTERN.forEach(([bed, wake], age) => {
    const wakeDate = isoDaysAgo(todayIso, age);
    const bedDate = bed.startsWith("0") && bed < "12:00"
      ? wakeDate                       // fell asleep after midnight
      : isoDaysAgo(todayIso, age + 1); // fell asleep before midnight
    sessions.push(newSession({ start: `${bedDate}T${bed}`, end: `${wakeDate}T${wake}`, type: "sleep" }));
  });
  // one afternoon nap 3 days ago
  const napDay = isoDaysAgo(todayIso, 3);
  sessions.push(newSession({ start: `${napDay}T14:30`, end: `${napDay}T15:10`, type: "nap" }));
  return sessions;
}
```

- [ ] **Step 4: Run `npm test`** — expect PASS
- [ ] **Step 5: Commit** — `git commit -m "Add sample data generator"`

---

### Task 8: HTML shell + styles

**Files:**
- Create: `index.html`, `style.css`

- [ ] **Step 1: Write `index.html`** — three tab panes with the element IDs `app.js` will target: nav buttons `[data-tab]`; Sleep pane: `#debt-value`, `#debt-status`, `#debt-note`, `#need-value`, `#need-source`, `#lastnight`, `#sessions-list`, log form `#log-form` with `#log-start`, `#log-end`, `#log-type`, `#log-error`, buttons `#btn-sample`, `#btn-clear`; settings inputs `#wake-goal`, `#need-override`; Energy pane: `#energy-meta`, `#energy-chart`, `#zones-list`; Progress pane: `#progress-chart`, `#progress-note`. (Full markup is written at implementation time; structure above is the contract.)
- [ ] **Step 2: Write `style.css`** — dark theme, card layout, zone color coding (groggy gray, peaks green, dip orange, wind-down blue, melatonin purple).
- [ ] **Step 3: Verify** — `python3 -m http.server 8713` then GET `http://localhost:8713/` returns the shell with all IDs above present.
- [ ] **Step 4: Commit** — `git commit -m "Add app shell and styles"`

---

### Task 9: App wiring (render + interactions)

**Files:**
- Create: `app.js`

- [ ] **Step 1: Implement `app.js`**: load store, compute `need = settings.needOverride ?? estimateSleepNeed(...)`, `debt = sleepDebt(...)`, `schedule = energySchedule({wakeMin: today's wake or 7:30, ...})`; render Sleep tab (debt number + status pill + need + last night + recent sessions with delete), Energy tab (SVG curve + now-line + zone chips), Progress tab (SVG bars of last 14 nights vs need line + debt trend). Wire: tab switching, log form (uses `newSession`, shows thrown message in `#log-error`), sample/clear buttons, settings inputs.
- [ ] **Step 2: Verify by serving and loading in a browser** — no console errors; all three tabs render with sample data.
- [ ] **Step 3: Commit** — `git commit -m "Wire up UI"`

---

### Task 10: End-to-end test and fix loop

- [ ] **Step 1: Run `npm test`** — all unit tests PASS.
- [ ] **Step 2: Serve app, drive it in a headless browser:** load page → empty state visible → click "Load sample data" → debt number and status appear → log a new short night (e.g. 02:00–06:00) → debt increases → Energy tab shows zones in order with melatonin window → Progress tab renders 14 bars → reload page → data persists → delete the logged session → debt returns to prior value.
- [ ] **Step 3: Fix anything that fails, re-run, repeat until green.**
- [ ] **Step 4: Commit** — `git commit -m "E2E verified"`
