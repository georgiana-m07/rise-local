import { newSession, localIsoDate } from "./store.js";

// Input: one sample per line, "ISO_start|ISO_end|stage", as produced by the
// companion iOS Shortcut from Apple Health sleep samples.

const NOT_ASLEEP = /awake|in ?bed/i;
const ASLEEP = /core|deep|rem|asleep/i;
const MERGE_GAP_MS = 60_000;

function attributionDate(end) {
  // A block ending before 18:00 belongs to that day's night (or is a nap);
  // a block ending in the evening belongs to the next morning's night.
  if (end.getHours() < 18) return localIsoDate(end);
  const next = new Date(end);
  next.setDate(next.getDate() + 1);
  return localIsoDate(next);
}

function isNap(start, end) {
  const hours = (end - start) / 3_600_000;
  return hours < 3 && start.getHours() >= 9 && end.getHours() >= 10 && end.getHours() < 21;
}

export function parseHealthText(text, existing = []) {
  const samples = [];
  let ignored = 0;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("|");
    if (parts.length < 3) { ignored++; continue; }
    const [startRaw, endRaw, stage] = parts;
    const start = new Date(startRaw.trim());
    const end = new Date(endRaw.trim());
    if (isNaN(start) || isNaN(end) || end <= start) { ignored++; continue; }
    if (NOT_ASLEEP.test(stage) || !ASLEEP.test(stage)) continue;
    samples.push({ start, end });
  }

  samples.sort((a, b) => a.start - b.start);
  const blocks = [];
  for (const s of samples) {
    const last = blocks.at(-1);
    if (last && s.start - last.end <= MERGE_GAP_MS) {
      if (s.end > last.end) last.end = s.end;
    } else {
      blocks.push({ start: new Date(s.start), end: new Date(s.end) });
    }
  }

  const seen = new Set(existing.map((s) => `${s.start}|${s.end}`));
  const imported = [];
  let duplicates = 0;
  for (const b of blocks) {
    const session = newSession({
      start: b.start,
      end: b.end,
      type: isNap(b.start, b.end) ? "nap" : "sleep",
      date: attributionDate(b.end),
    });
    if (seen.has(`${session.start}|${session.end}`)) { duplicates++; continue; }
    seen.add(`${session.start}|${session.end}`);
    imported.push(session);
  }
  return { imported, duplicates, ignored };
}
