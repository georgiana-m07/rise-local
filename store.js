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

const isValidSession = (s) => s && s.id && s.date && s.start && s.end;

export function exportData(sessions, settings) {
  return JSON.stringify({ app: "rise-local", version: 1, sessions, settings }, null, 2);
}

export function importData(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("That file isn't a valid backup.");
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.sessions))
    throw new Error("That file isn't a valid backup.");
  return {
    sessions: raw.sessions.filter(isValidSession),
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
  };
}

export function makeStore(storage) {
  return {
    loadSessions() {
      try {
        const raw = JSON.parse(storage.getItem(SESSIONS_KEY) ?? "[]");
        return Array.isArray(raw) ? raw.filter(isValidSession) : [];
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
