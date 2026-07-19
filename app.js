import {
  estimateSleepNeed, sleepDebt, energySchedule, sleepSeries,
  durationHours, isoDaysAgo,
} from "./sleep-model.js";
import { makeStore, newSession, localIsoDate, exportData, importData } from "./store.js";
import { parseHealthText } from "./health-import.js";
import { generateSampleData } from "./sample-data.js";

const store = makeStore(localStorage);
let sessions = store.loadSessions();
let settings = store.loadSettings();

// Progress tab view state: which range is shown and how many whole periods
// back we've scrubbed (0 = the period ending today).
let progressRange = "week";
let progressOffset = 0;

const $ = (sel) => document.querySelector(sel);

const ZONE_COLORS = {
  groggy: "#6b7690", morningPeak: "#4cc38a", dip: "#f6a13c",
  eveningPeak: "#4cc38a", windDown: "#5a9cf8", melatonin: "#a97df5",
};

const todayIso = () => localIsoDate(new Date());
const hmToMin = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };

function fmtHours(h) {
  const abs = Math.abs(h);
  let hh = Math.floor(abs);
  let mm = Math.round((abs - hh) * 60);
  if (mm === 60) { hh += 1; mm = 0; }
  return `${hh}h ${mm}m`;
}

function fmtMin(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function fmtClock(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function compute() {
  const t = todayIso();
  const est = estimateSleepNeed(sessions, t);
  const need = settings.needOverride ?? est.hours;
  const debt = sleepDebt(sessions, need, t);
  const todayNight = sessions
    .filter((s) => s.date === t && s.type === "sleep")
    .sort((a, b) => new Date(b.end) - new Date(a.end))[0];
  const wakeMin = todayNight
    ? new Date(todayNight.end).getHours() * 60 + new Date(todayNight.end).getMinutes()
    : hmToMin(settings.wakeGoal);
  const schedule = energySchedule({
    wakeMin, needHours: need, debtHours: debt.hours, wakeGoalMin: hmToMin(settings.wakeGoal),
  });
  return { t, est, need, debt, wakeMin, schedule };
}

/* ---------- Sleep tab ---------- */

const DEBT_NOTES = {
  low: "Nice, you're inside the healthy range (under 5h). Keep bedtimes steady.",
  moderate: "You owe your body some sleep. Aim for the suggested bedtime this week to pay it down.",
  high: "High debt. Expect lower peaks and rougher dips. Prioritize early nights; naps help too.",
};

function renderSleep(c) {
  $("#empty-card").classList.toggle("hidden", sessions.length > 0);

  $("#debt-value").textContent = fmtHours(c.debt.hours);
  const pill = $("#debt-status");
  pill.textContent = { low: "Low", moderate: "Moderate", high: "High" }[c.debt.status];
  pill.className = `pill ${c.debt.status}`;
  $("#debt-note").textContent = DEBT_NOTES[c.debt.status]
    + (c.debt.covered < c.debt.window
      ? ` Based on ${c.debt.covered} of ${c.debt.window} nights with data. Import more history for the full picture.`
      : "");

  $("#need-value").textContent = fmtHours(c.need);
  $("#need-source").textContent = settings.needOverride != null
    ? "Manual override."
    : c.est.estimated
      ? "Estimated from your recent nights (75th percentile)."
      : "Default. Log 7+ nights and RISE Local estimates your real need.";

  const lastNight = sessions
    .filter((s) => s.type === "sleep")
    .sort((a, b) => new Date(b.end) - new Date(a.end))[0];
  $("#lastnight").textContent = lastNight
    ? `${fmtHours(durationHours(lastNight))} · ${fmtClock(lastNight.start)} → ${fmtClock(lastNight.end)} (woke ${lastNight.date})`
    : "No sleep logged yet.";

  const list = $("#sessions-list");
  const recent = [...sessions].sort((a, b) => new Date(b.end) - new Date(a.end)).slice(0, 10);
  list.innerHTML = recent.length
    ? recent.map((s) => `
      <li>
        <span class="session-date">${s.date}</span>
        <span class="badge ${s.type}">${s.type === "nap" ? "nap" : "night"}</span>
        <span>${fmtClock(s.start)} → ${fmtClock(s.end)}</span>
        <span class="session-dur">${fmtHours(durationHours(s))}</span>
        <button class="btn-del" data-id="${s.id}" title="Delete">✕</button>
      </li>`).join("")
    : `<li class="muted">Nothing logged yet.</li>`;
}

/* ---------- Energy tab ---------- */

function renderEnergy(c) {
  const { schedule, wakeMin } = c;
  const mel = schedule.zones.find((z) => z.key === "melatonin");
  $("#energy-meta").textContent =
    `Woke ${fmtMin(wakeMin)} · Suggested bedtime ${fmtMin(schedule.bedtimeMin)} · ` +
    `Melatonin window ${fmtMin(mel.start)}–${fmtMin(mel.end)}` +
    (c.debt.hours >= 5 ? " · Peaks are flattened by your sleep debt" : "");

  const W = 760, H = 260, L = 42, R = 16, T = 16, B = 38;
  const tMin = schedule.curve[0].t, tMax = schedule.curve.at(-1).t;
  const x = (t) => L + ((t - tMin) / (tMax - tMin)) * (W - L - R);
  const y = (e) => T + (1 - e / 100) * (H - T - B);

  const bands = schedule.zones.map((z) => {
    const s = Math.max(z.start, tMin), e = Math.min(z.end, tMax);
    if (e <= s) return "";
    return `<rect x="${x(s)}" y="${T}" width="${x(e) - x(s)}" height="${H - T - B}"
      fill="${ZONE_COLORS[z.key]}" opacity="0.14"/>`;
  }).join("");

  const pts = schedule.curve.map((p) => `${x(p.t).toFixed(1)},${y(p.energy).toFixed(1)}`).join(" ");

  let ticks = "";
  for (let t = Math.ceil(tMin / 180) * 180; t <= tMax; t += 180) {
    ticks += `<line x1="${x(t)}" y1="${H - B}" x2="${x(t)}" y2="${H - B + 5}" stroke="#8b97af"/>
      <text x="${x(t)}" y="${H - B + 20}" fill="#8b97af" font-size="11" text-anchor="middle">${fmtMin(t)}</text>`;
  }

  const now = new Date();
  let nowT = now.getHours() * 60 + now.getMinutes();
  if (nowT < tMin && nowT + 1440 <= tMax) nowT += 1440;
  const nowLine = nowT >= tMin && nowT <= tMax
    ? `<line x1="${x(nowT)}" y1="${T}" x2="${x(nowT)}" y2="${H - B}" stroke="#f0564a" stroke-dasharray="4 3"/>
       <text x="${x(nowT)}" y="${T - 3}" fill="#f0564a" font-size="11" text-anchor="middle">now</text>`
    : "";

  $("#energy-chart").innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Energy curve for today">
      ${bands}
      <text x="${L - 8}" y="${y(100) + 4}" fill="#8b97af" font-size="11" text-anchor="end">100</text>
      <text x="${L - 8}" y="${y(0) + 4}" fill="#8b97af" font-size="11" text-anchor="end">0</text>
      <polyline points="${pts}" fill="none" stroke="#e8edf7" stroke-width="2.5"/>
      ${ticks}
      ${nowLine}
    </svg>`;

  $("#zones-list").innerHTML = schedule.zones.map((z) => `
    <li>
      <span class="zone-dot" style="background:${ZONE_COLORS[z.key]}"></span>
      <span>${z.label}</span>
      <span class="zone-time">${fmtMin(z.start)} – ${fmtMin(z.end)}</span>
    </li>`).join("");
}

/* ---------- Progress tab ---------- */

function renderProgress(c) {
  const series = sleepSeries(sessions, c.need, c.t, progressRange, progressOffset);
  const buckets = series.buckets;
  const n = buckets.length;
  const perMonth = series.bucket === "month";
  const unit = perMonth ? "month" : "night";

  document.querySelectorAll("#range-tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.range === progressRange));
  $("#range-period").textContent = series.periodLabel;
  $("#range-next").disabled = progressOffset === 0;
  $("#progress-title").textContent = perMonth
    ? "Avg sleep per month vs your need" : "Sleep vs your need";

  const W = 760, H = 240, L = 42, R = 16, T = 16, B = 34;
  const innerW = W - L - R, innerH = H - T - B;
  const slot = innerW / n, barW = Math.min(28, slot * 0.62);
  const labelEvery = Math.ceil(n / 14); // thin the axis when bars get dense
  const axisLabel = (i, xMid) =>
    (i % labelEvery === 0 || i === n - 1)
      ? `<text x="${xMid.toFixed(1)}" y="${H - B + 16}" fill="#8b97af" font-size="10" text-anchor="middle">${buckets[i].label}</text>`
      : "";

  const yMax = Math.max(10, c.need + 1, ...buckets.map((d) => d.hours)) + 0.5;
  const y = (h) => T + (1 - h / yMax) * innerH;

  const bars = buckets.map((d, i) => {
    const bx = L + i * slot + (slot - barW) / 2;
    const color = !d.covered ? "#232e47" : d.met ? "#4cc38a" : "#f6a13c";
    const bh = d.covered ? y(0) - y(d.hours) : 2;
    return `<rect x="${bx.toFixed(1)}" y="${(d.covered ? y(d.hours) : y(0) - 2).toFixed(1)}"
        width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${color}"/>
      ${axisLabel(i, bx + barW / 2)}`;
  }).join("");

  $("#progress-chart").innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sleep per ${unit} for ${series.periodLabel}">
      ${bars}
      <line x1="${L}" y1="${y(c.need)}" x2="${W - R}" y2="${y(c.need)}"
        stroke="#e8edf7" stroke-dasharray="6 4" opacity="0.7"/>
      <text x="${W - R}" y="${y(c.need) - 5}" fill="#e8edf7" font-size="11" text-anchor="end"
        opacity="0.8">need ${fmtHours(c.need)}</text>
      <text x="${L - 8}" y="${y(0) + 4}" fill="#8b97af" font-size="11" text-anchor="end">0h</text>
      <text x="${L - 8}" y="${y(8) + 4}" fill="#8b97af" font-size="11" text-anchor="end">8h</text>
    </svg>`;

  const s = series.summary;
  $("#progress-summary").textContent = s.coveredCount
    ? `Avg ${fmtHours(s.avgHours)} a ${unit} · hit your ${fmtHours(c.need)} need ${s.metCount} of ${s.coveredCount} ${unit}s with data.`
    : "No sleep data in this period.";

  const dMax = Math.max(6, ...buckets.map((d) => d.debt)) + 0.5;
  const dy = (h) => T + (1 - h / dMax) * innerH;
  const dx = (i) => L + i * slot + slot / 2;
  const pts = buckets.map((d, i) => `${dx(i).toFixed(1)},${dy(d.debt).toFixed(1)}`).join(" ");

  $("#debt-trend-chart").innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sleep debt trend for ${series.periodLabel}">
      <line x1="${L}" y1="${dy(5)}" x2="${W - R}" y2="${dy(5)}"
        stroke="#f6a13c" stroke-dasharray="6 4" opacity="0.6"/>
      <text x="${W - R}" y="${dy(5) - 5}" fill="#f6a13c" font-size="11" text-anchor="end"
        opacity="0.8">5h, keep debt below this</text>
      <polyline points="${pts}" fill="none" stroke="#a97df5" stroke-width="2.5"/>
      ${buckets.map((d, i) => `<circle cx="${dx(i).toFixed(1)}" cy="${dy(d.debt).toFixed(1)}" r="3" fill="#a97df5"/>
        ${axisLabel(i, dx(i))}`).join("")}
      <text x="${L - 8}" y="${dy(0) + 4}" fill="#8b97af" font-size="11" text-anchor="end">0h</text>
    </svg>`;

  $("#progress-note").textContent = perMonth
    ? `Each point is that month's average debt. Green months mostly met your ${fmtHours(c.need)} need, orange fell short, grey has no data.`
    : `Green bars met your ${fmtHours(c.need)} need, orange fell short, grey has no data.`;
}

/* ---------- Wiring ---------- */

function renderAll() {
  const c = compute();
  renderSleep(c);
  renderEnergy(c);
  renderProgress(c);
}

function persist() {
  store.saveSessions(sessions);
  store.saveSettings(settings);
}

document.querySelectorAll("nav#tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav#tabs button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".pane").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(`#tab-${btn.dataset.tab}`).classList.add("active");
  });
});

document.querySelectorAll("#range-tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.range === progressRange) return;
    progressRange = btn.dataset.range;
    progressOffset = 0; // jump back to the present when switching range
    renderProgress(compute());
  });
});

$("#range-prev").addEventListener("click", () => {
  progressOffset += 1;
  renderProgress(compute());
});

$("#range-next").addEventListener("click", () => {
  if (progressOffset === 0) return;
  progressOffset -= 1;
  renderProgress(compute());
});

$("#log-form").addEventListener("submit", (e) => {
  e.preventDefault();
  $("#log-error").textContent = "";
  try {
    sessions.push(newSession({
      start: $("#log-start").value, end: $("#log-end").value, type: $("#log-type").value,
    }));
    persist();
    setDefaultFormTimes();
    renderAll();
  } catch (err) {
    $("#log-error").textContent = err.message;
  }
});

$("#sessions-list").addEventListener("click", (e) => {
  const id = e.target.dataset?.id;
  if (!id) return;
  sessions = sessions.filter((s) => s.id !== id);
  persist();
  renderAll();
});

const loadSample = () => { sessions = generateSampleData(todayIso()); persist(); renderAll(); };
$("#btn-sample").addEventListener("click", loadSample);
$("#btn-sample-2").addEventListener("click", loadSample);

$("#btn-clear").addEventListener("click", () => {
  if (!confirm("Delete all logged sleep data?")) return;
  sessions = [];
  persist();
  renderAll();
});

$("#wake-goal").addEventListener("change", (e) => {
  if (!/^\d{2}:\d{2}$/.test(e.target.value)) return;
  settings.wakeGoal = e.target.value;
  persist();
  renderAll();
});

$("#need-override").addEventListener("change", (e) => {
  const v = parseFloat(e.target.value);
  settings.needOverride = Number.isFinite(v) ? Math.min(12, Math.max(4, v)) : null;
  persist();
  renderAll();
});

$("#btn-export").addEventListener("click", () => {
  const blob = new Blob([exportData(sessions, settings)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `rise-local-backup-${todayIso()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  $("#backup-msg").textContent = "Backup exported.";
});

$("#btn-import").addEventListener("click", () => $("#import-file").click());

$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = importData(await file.text());
    sessions = data.sessions;
    settings = data.settings;
    persist();
    $("#wake-goal").value = settings.wakeGoal;
    $("#need-override").value = settings.needOverride ?? "";
    renderAll();
    $("#backup-msg").textContent = `Imported ${sessions.length} sessions.`;
  } catch (err) {
    $("#backup-msg").textContent = err.message;
  }
  e.target.value = "";
});

function runHealthImport(text) {
  const r = parseHealthText(text, sessions);
  if (r.imported.length) {
    sessions = sessions.concat(r.imported);
    persist();
    renderAll();
  }
  const n = r.imported.length;
  const bits = [`Imported ${n} sleep session${n === 1 ? "" : "s"}`];
  if (r.duplicates) bits.push(`${r.duplicates} already logged`);
  if (r.ignored) bits.push(`${r.ignored} lines skipped`);
  $("#health-msg").textContent = r.imported.length || r.duplicates
    ? bits.join(", ") + "."
    : "No sleep data found in that text. Run the shortcut first, then import.";
}

$("#btn-health").addEventListener("click", async () => {
  try {
    runHealthImport(await navigator.clipboard.readText());
  } catch {
    $("#health-manual").classList.remove("hidden");
    $("#health-msg").textContent =
      "Couldn't read the clipboard. Paste the copied text below instead.";
  }
});

$("#btn-health-paste").addEventListener("click", () => {
  runHealthImport($("#health-text").value);
  $("#health-text").value = "";
});

function maybeImportFromHash() {
  if (!location.hash.startsWith("#health=")) return;
  try {
    runHealthImport(decodeURIComponent(location.hash.slice("#health=".length)));
  } catch {
    $("#health-msg").textContent = "Couldn't read the shared sleep data.";
  }
  history.replaceState(null, "", location.pathname + location.search);
}
window.addEventListener("hashchange", maybeImportFromHash);
maybeImportFromHash();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((err) =>
    console.warn("rise-local: service worker not registered", err));
}

function setDefaultFormTimes() {
  const yesterday = isoDaysAgo(todayIso(), 1);
  $("#log-start").value = `${yesterday}T23:00`;
  $("#log-end").value = `${todayIso()}T07:00`;
}

$("#wake-goal").value = settings.wakeGoal;
if (settings.needOverride != null) $("#need-override").value = settings.needOverride;
setDefaultFormTimes();
renderAll();
