import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStore, newSession, localIsoDate, exportData, importData } from "../store.js";

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

test("exportData/importData round-trip sessions and settings", () => {
  const s = newSession({ start: "2026-07-04T23:00", end: "2026-07-05T07:00", type: "sleep" });
  const json = exportData([s], { needOverride: 7.5, wakeGoal: "06:45" });
  const back = importData(json);
  assert.deepEqual(back.sessions, [s]);
  assert.deepEqual(back.settings, { needOverride: 7.5, wakeGoal: "06:45" });
});

test("importData rejects garbage and strips invalid entries", () => {
  assert.throws(() => importData("{nope"), /valid backup/i);
  assert.throws(() => importData('"just a string"'), /valid backup/i);
  const mixed = importData(JSON.stringify({
    sessions: [
      { id: "a", date: "2026-07-05", start: "2026-07-04T23:00:00Z", end: "2026-07-05T07:00:00Z", type: "sleep" },
      { bogus: true },
    ],
    settings: { wakeGoal: "08:00" },
  }));
  assert.equal(mixed.sessions.length, 1);
  assert.equal(mixed.settings.wakeGoal, "08:00");
  assert.equal(mixed.settings.needOverride, null);
});
