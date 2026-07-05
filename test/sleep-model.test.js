import { test } from "node:test";
import assert from "node:assert/strict";
import {
  durationHours, nightlyTotals, isoDaysAgo, estimateSleepNeed, sleepDebt, suggestedBedtime, energySchedule,
} from "../sleep-model.js";

const mkNight = (todayIso, age, hours) => {
  const date = isoDaysAgo(todayIso, age);
  const start = `${isoDaysAgo(todayIso, age + 1)}T23:00:00`;
  return { id: date, date, type: "sleep", start,
    end: new Date(new Date(start).getTime() + hours * 3_600_000).toISOString() };
};

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
