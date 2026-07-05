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

function percentile(sortedAsc, p) {
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

// People tend to undersleep their need, so a high percentile of what they
// actually slept approximates what their body asks for when it can.
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
