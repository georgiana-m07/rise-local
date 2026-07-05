import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHealthText } from "../health-import.js";

const L = (lines) => lines.join("\n");

test("keeps asleep stages, drops awake and in-bed, merges contiguous blocks", () => {
  const r = parseHealthText(L([
    "2026-07-05T23:10:00|2026-07-06T00:40:00|Core",
    "2026-07-06T00:40:00|2026-07-06T01:20:00|Deep",
    "2026-07-06T01:20:00|2026-07-06T01:35:00|Awake",
    "2026-07-06T01:35:00|2026-07-06T05:50:00|Core",
    "2026-07-06T05:50:00|2026-07-06T06:30:00|REM",
    "2026-07-05T22:50:00|2026-07-06T06:30:00|In Bed",
  ]));
  assert.equal(r.imported.length, 2); // awake gap splits the night into two blocks
  const [a, b] = r.imported;
  assert.equal(a.start, new Date("2026-07-05T23:10:00").toISOString());
  assert.equal(a.end, new Date("2026-07-06T01:20:00").toISOString());
  assert.equal(b.start, new Date("2026-07-06T01:35:00").toISOString());
  assert.equal(b.end, new Date("2026-07-06T06:30:00").toISOString());
  assert.ok(r.imported.every((s) => s.type === "sleep" && s.date === "2026-07-06"));
});

test("overlapping samples from two sources union into one block", () => {
  const r = parseHealthText(L([
    "2026-07-06T00:00:00|2026-07-06T03:00:00|Asleep",
    "2026-07-06T02:30:00|2026-07-06T06:00:00|Asleep (Unspecified)",
  ]));
  assert.equal(r.imported.length, 1);
  assert.equal(r.imported[0].start, new Date("2026-07-06T00:00:00").toISOString());
  assert.equal(r.imported[0].end, new Date("2026-07-06T06:00:00").toISOString());
});

test("evening block before midnight is attributed to the next morning", () => {
  const r = parseHealthText("2026-07-05T22:45:00|2026-07-05T23:59:00|Core");
  assert.equal(r.imported[0].date, "2026-07-06");
});

test("short daytime block becomes a nap on the same day", () => {
  const r = parseHealthText("2026-07-06T14:00:00|2026-07-06T14:45:00|Asleep");
  assert.equal(r.imported[0].type, "nap");
  assert.equal(r.imported[0].date, "2026-07-06");
});

test("dedupes against existing sessions by start and end", () => {
  const first = parseHealthText("2026-07-06T00:00:00|2026-07-06T06:00:00|Asleep");
  const again = parseHealthText(
    "2026-07-06T00:00:00|2026-07-06T06:00:00|Asleep", first.imported);
  assert.equal(again.imported.length, 0);
  assert.equal(again.duplicates, 1);
});

test("garbage lines are counted and skipped, empty input is fine", () => {
  const r = parseHealthText(L([
    "not a line at all",
    "2026-07-06T00:00:00|banana|Core",
    "",
    "2026-07-06T01:00:00|2026-07-06T02:00:00|Core",
  ]));
  assert.equal(r.imported.length, 1);
  assert.equal(r.ignored, 2);
  assert.deepEqual(parseHealthText("").imported, []);
});
