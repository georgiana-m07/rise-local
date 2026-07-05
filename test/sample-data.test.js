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
