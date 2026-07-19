export const DEFAULT_NEED_HOURS = 8;
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

// RISE-style sleep debt: the straight sum of (need - slept) over the last 14
// nights, floored at zero. No decay, every night in the window counts fully.
// Missing nights are genuinely unknown, so they are skipped rather than counted
// as met; `covered` reports how many of the 14 nights actually had data.
export function sleepDebt(sessions, needHours, todayIso) {
  const totals = nightlyTotals(sessions);
  let debt = 0;
  let covered = 0;
  for (let age = 0; age < DEBT_WINDOW_DAYS; age++) {
    const d = isoDaysAgo(todayIso, age);
    if (!totals.has(d)) continue; // no data for this night: can't score it
    covered += 1;
    debt += needHours - totals.get(d);
  }
  const hours = Math.max(0, debt);
  const status = hours < 5 ? "low" : hours <= 10 ? "moderate" : "high";
  return { hours, status, covered, window: DEBT_WINDOW_DAYS };
}

// Named windows the Progress tab can browse. Day-bucketed ranges plot one point
// per night; the year plots one point per calendar month.
export const RANGE_SPECS = {
  week: { label: "Week", days: 7, bucket: "day" },
  month: { label: "Month", days: 30, bucket: "day" },
  year: { label: "Year", days: 365, bucket: "month" },
};

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ymMonthsAgo(todayIso, n) {
  const d = new Date(todayIso + "T12:00:00");
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return { year: d.getFullYear(), month: d.getMonth() }; // month is 0-11
}

function shortDate(iso) {
  const [, m, d] = iso.split("-");
  return `${MONTH_ABBR[Number(m) - 1]} ${Number(d)}`;
}

function monthLabel(ym) {
  const [y, m] = ym.split("-");
  return `${MONTH_ABBR[Number(m) - 1]} ${y}`;
}

// A browsable slice of sleep history. `offset` scrubs whole periods into the
// past (0 = the period ending today, 1 = the one before it). Returns uniform
// buckets so the same chart renders week, month or year. Reads straight from
// stored sessions, so switching ranges needs no re-import.
export function sleepSeries(sessions, needHours, todayIso, rangeKey = "week", offset = 0) {
  const spec = RANGE_SPECS[rangeKey] ?? RANGE_SPECS.week;
  const totals = nightlyTotals(sessions);
  const buckets = [];

  if (spec.bucket === "day") {
    for (let i = spec.days - 1; i >= 0; i--) {
      const date = isoDaysAgo(todayIso, offset * spec.days + i);
      const covered = totals.has(date);
      const hours = covered ? totals.get(date) : 0;
      buckets.push({
        key: date,
        label: date.slice(8),
        hours,
        debt: sleepDebt(sessions, needHours, date).hours,
        covered,
        met: covered && hours >= needHours,
      });
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const { year, month } = ymMonthsAgo(todayIso, offset * 12 + i);
      const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
      let sum = 0, days = 0, metDays = 0, debtSum = 0;
      for (const [date, h] of totals) {
        if (!date.startsWith(prefix)) continue;
        sum += h;
        days += 1;
        if (h >= needHours) metDays += 1;
        debtSum += sleepDebt(sessions, needHours, date).hours;
      }
      buckets.push({
        key: prefix,
        label: MONTH_ABBR[month],
        hours: days ? sum / days : 0,
        debt: days ? debtSum / days : 0,
        covered: days > 0,
        met: days > 0 && metDays >= days / 2,
      });
    }
  }

  const withData = buckets.filter((b) => b.covered);
  const first = buckets[0], last = buckets.at(-1);
  return {
    range: rangeKey,
    bucket: spec.bucket,
    offset,
    buckets,
    periodLabel: spec.bucket === "day"
      ? `${shortDate(first.key)} – ${shortDate(last.key)}`
      : `${monthLabel(first.key)} – ${monthLabel(last.key)}`,
    summary: {
      avgHours: withData.length ? withData.reduce((a, b) => a + b.hours, 0) / withData.length : 0,
      metCount: buckets.filter((b) => b.met).length,
      coveredCount: withData.length,
      bucketCount: buckets.length,
      latestDebt: last.debt,
    },
  };
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
