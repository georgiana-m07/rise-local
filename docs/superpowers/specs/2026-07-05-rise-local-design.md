# RISE Local — Design Doc

**Date:** 2026-07-05
**Goal:** Rebuild the core features of RISE: Sleep Tracker as a local app that runs entirely on Georgiana's machine. No accounts, no cloud, no wearables — manual sleep logging plus the two things that make RISE what it is: **sleep debt** and the **energy schedule**.

## How the real RISE works (research summary)

- **Sleep need**: a per-user baseline (most adults 7–9h), learned from sleep history.
- **Sleep debt**: rolling total of (need − actual sleep) over the last ~14 nights, weighted toward recent nights. Naps pay debt down. RISE's guidance: keep debt low (under ~5h).
- **Energy schedule**: derived from the SAFTE model (sleep + circadian rhythm → predicted alertness). From wake time and habitual sleep timing it predicts: grogginess zone (~90 min post-wake), morning peak, afternoon dip, evening peak, wind-down, and a ~1h melatonin window before suggested bedtime. Higher sleep debt lowers peaks and deepens dips.
- **UI**: Sleep tab (debt number, last night, naps), Energy tab (day timeline curve with labeled zones), Progress tab (history + debt trend), Learn tab (content — out of scope).

Sources: risescience.com, Rise Science help center, App Store listing, MoveWell and Bustle reviews.

## Decisions (made autonomously — session is non-interactive)

- **Stack:** vanilla HTML/CSS/JS single-page app, ES modules, zero dependencies. Persistence via `localStorage`. Served locally with `python3 -m http.server` via a `run.sh` (ES modules require http, and it keeps testing honest).
- **Tests:** pure-function sleep model in `sleep-model.js`, unit-tested with Node's built-in `node --test`. The model file has no DOM/browser imports so Node and the browser share it.
- **Scope (core only):** log/delete sleep sessions and naps (edit = delete + re-log), learned sleep need with manual override, 14-night weighted sleep debt, today's energy schedule with labeled zones + curve, 14-night progress chart, sample-data seeding for instant demo. Nothing else (no habits, alarms, sounds, calendar sync, accounts).

## Architecture

```
rise-local/
  index.html        app shell: 3 tabs (Sleep, Energy, Progress) + log form
  style.css         styling, dark theme
  sleep-model.js    PURE model: sleep need, sleep debt, energy schedule
  store.js          localStorage persistence (sessions CRUD, settings)
  app.js            UI wiring: renders tabs from store + model, SVG charts
  run.sh            starts python3 -m http.server and opens the browser
  test/
    sleep-model.test.js   node --test unit tests
```

## Model math (simplified but science-shaped)

- **Sleep need** — default 8h, user-adjustable. Once ≥7 nights exist, estimate = 75th percentile of nightly totals (night sleep + that day's naps) over the last 60 days, clamped to 6.5–10h. Rationale: people undersleep their need, so a high percentile of observed sleep approximates it.
- **Sleep debt** — over the last 14 nights: `debt = max(0, Σ decay^age × (need − slept_night))`, decay = 0.9 per day of age. Surplus nights offset debt; naps count into their night's total. Status bands: **Low** < 5h, **Moderate** 5–10h, **High** > 10h.
- **Energy schedule** — anchored on today's wake time (last logged session, else 7:30 default) and wake goal:
  - Curve: two-harmonic circadian approximation `E(t) = A·[cos(2π(t−φ)/24) + 0.4·cos(4π(t−φ)/24)]` phased so peaks land mid-morning and early evening, plus a homeostatic decline across the waking day and a sleep-inertia penalty in the first 90 min. Sleep debt scales amplitude down (higher debt → flatter peaks, deeper dips). Rendered 0–100.
  - Zones: grogginess (wake → +90m), morning peak, afternoon dip, evening peak (local extrema of the curve), wind-down (1h before melatonin window), melatonin window (1h wide, ending at suggested bedtime).
  - Suggested bedtime: `wake goal − (need + debt paydown)` where paydown = min(1h, debt × 0.2), so the app nudges earlier bedtimes when debt is high.

## Data

```js
// localStorage "rise.sessions": [{id, date: "YYYY-MM-DD" (night attributed to wake date),
//   start: ISO, end: ISO, type: "sleep" | "nap"}]
// localStorage "rise.settings": {needOverride: hours|null, wakeGoal: "HH:MM"}
```

## Error handling

- Invalid log input (end ≤ start, absurd durations > 16h) rejected with inline message.
- Empty state: no sessions → dashboard shows onboarding card with "Load sample data" and the log form.
- Corrupt localStorage → reset to empty with a console warning, app still boots.

## Testing

1. Unit tests (`node --test`): need estimation, debt math (weighting, naps, surplus, clamping), schedule zone ordering and bounds, bedtime suggestion, curve range.
2. End-to-end: serve the app, drive it in a headless browser — seed sample data, log a night, verify debt number changes, zones render, data survives reload.

## Success criteria ("basics work end to end")

- `./run.sh` opens the app; logging a night persists across reload.
- Debt number matches the model for known inputs.
- Energy tab shows a plausible day: groggy → peak → dip → peak → wind-down → melatonin window.
- Progress tab charts the last 14 nights vs need.
- All unit tests green; e2e pass in a real browser.
