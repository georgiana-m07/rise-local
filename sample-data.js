import { newSession } from "./store.js";
import { isoDaysAgo } from "./sleep-model.js";

// [bedtime, wake time] per night; index = nights ago (0 = last night).
// Bedtimes before noon mean the person fell asleep after midnight.
const PATTERN = [
  ["23:40", "07:10"], ["00:15", "07:30"], ["23:05", "06:55"], ["01:10", "07:20"],
  ["23:30", "07:00"], ["23:55", "06:40"], ["22:45", "06:50"], ["23:20", "07:05"],
  ["00:40", "07:15"], ["23:10", "06:45"], ["23:35", "07:25"], ["01:30", "07:10"],
  ["23:00", "07:00"], ["23:25", "06:55"],
];

export function generateSampleData(todayIso) {
  const sessions = [];
  PATTERN.forEach(([bed, wake], age) => {
    const wakeDate = isoDaysAgo(todayIso, age);
    const bedDate = bed < "12:00" ? wakeDate : isoDaysAgo(todayIso, age + 1);
    sessions.push(newSession({ start: `${bedDate}T${bed}`, end: `${wakeDate}T${wake}`, type: "sleep" }));
  });
  const napDay = isoDaysAgo(todayIso, 3);
  sessions.push(newSession({ start: `${napDay}T14:30`, end: `${napDay}T15:10`, type: "nap" }));
  return sessions;
}
