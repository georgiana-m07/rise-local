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
