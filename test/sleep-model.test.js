import { test } from "node:test";
import assert from "node:assert/strict";
import {
  durationHours, nightlyTotals, isoDaysAgo, estimateSleepNeed,
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
