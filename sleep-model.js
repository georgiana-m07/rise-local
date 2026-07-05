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
