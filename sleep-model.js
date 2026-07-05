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

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function suggestedBedtime(wakeGoalMin, needHours, debtHours) {
  const paydown = Math.min(1, debtHours * 0.2);
  const sleepMin = (needHours + paydown) * 60;
  return (((wakeGoalMin - sleepMin) % 1440) + 1440) % 1440;
}

// Simplified two-process alertness curve: circadian peaks/dip as gaussian
// bumps anchored to wake time, sleep inertia for the first 90 minutes, and
// rising sleep pressure toward bedtime. Sleep debt scales the amplitude.
export function energySchedule({ wakeMin, needHours, debtHours, wakeGoalMin }) {
  let bed = suggestedBedtime(wakeGoalMin ?? wakeMin, needHours, debtHours);
  while (bed <= wakeMin + 240) bed += 1440; // bedtime sits on a same-day axis after wake

  const morningPeakCenter = wakeMin + 210;
  const dipCenter = wakeMin + 420;
  const eveningPeakCenter = wakeMin + 600;
  const debtFactor = clamp(1 - debtHours / 20, 0.5, 1);

  const energyAt = (t) => {
    if (t < wakeMin || t > bed) return 0;
    let e = 55;
    e += 30 * debtFactor * Math.exp(-(((t - morningPeakCenter) / 90) ** 2));
    e += 28 * debtFactor * Math.exp(-(((t - eveningPeakCenter) / 100) ** 2));
    e -= (15 + 10 * (1 - debtFactor)) * Math.exp(-(((t - dipCenter) / 75) ** 2));
    if (t - wakeMin < 90) e -= 35 * (1 - (t - wakeMin) / 90);
    if (t > eveningPeakCenter)
      e -= 30 * ((t - eveningPeakCenter) / Math.max(1, bed - eveningPeakCenter));
    return clamp(e, 5, 100);
  };

  const curve = [];
  for (let t = wakeMin; t <= bed; t += 10) curve.push({ t, energy: energyAt(t) });

  const melStart = bed - 60;
  const zones = [
    { key: "groggy", label: "Grogginess", start: wakeMin, end: wakeMin + 90 },
    { key: "morningPeak", label: "Morning peak", start: wakeMin + 150, end: wakeMin + 300 },
    { key: "dip", label: "Afternoon dip", start: wakeMin + 390, end: wakeMin + 510 },
    { key: "eveningPeak", label: "Evening peak", start: wakeMin + 540, end: wakeMin + 690 },
    { key: "windDown", label: "Wind-down", start: melStart - 60, end: melStart },
    { key: "melatonin", label: "Melatonin window", start: melStart, end: bed },
  ];
  return { zones, curve, bedtimeMin: bed % 1440, energyAt };
}
