# RISE Local 🌅

A local rebuild of the core of [RISE: Sleep Tracker](https://www.risescience.com/). Everything runs on your machine. No accounts, no cloud, your data stays in your browser's local storage.

## Run it

```bash
./run.sh
```

That starts a tiny local server and opens http://localhost:8713 in your browser. It also prints the address to open on your phone. Stop it with Ctrl+C.

## Install on iPhone

The app is a PWA (installable web app). Two ways to get it on your phone:

**Option A, hosted (best experience)**: put the static files on any HTTPS host (GitHub Pages works great and is free). Open the URL in Safari on the iPhone, tap Share, then "Add to Home Screen". After the first load it works fully offline and your data stays on the phone, never on the server.

**Option B, from your Mac**: run `./run.sh`, open the printed `http://192.168.x.x:8713` address in Safari on the iPhone (same Wi-Fi), tap Share, then "Add to Home Screen". You get the icon and fullscreen app feel, but iOS only allows offline caching over HTTPS, so this version needs the Mac server running whenever you open it.

Either way, use "Export backup" now and then. iOS can clear web app storage if the app goes unused for a long time and the backup file makes that a non-event.

## Sync sleep from your Apple Watch

Apple only lets native apps read Health data directly, so RISE Local uses a small iOS Shortcut as a bridge: the Shortcut reads your sleep from the Health app and copies it, then the app imports it from the clipboard (merging stages, splitting nights at awakenings, deduping anything already logged).

Build the Shortcut once, about 5 minutes in the Shortcuts app:

1. New shortcut, name it **Sync Sleep to RISE**
2. Add **Find Health Samples**. Set type to **Sleep**, add filter **Start Date, is in the last, 7 days**. The first run asks for Health access, allow reading Sleep
3. Add **Repeat with Each** using the Health Samples as input. Inside the repeat:
   - **Format Date** on the Repeat Item's **Start Date**, date format **Custom**: `yyyy-MM-dd'T'HH:mm:ss`
   - **Format Date** on the Repeat Item's **End Date**, same custom format
   - **Text** containing exactly: `FormattedStartDate|FormattedEndDate|Value` (pick the two Formatted Date magic variables and the Repeat Item's Value detail, with the `|` pipes between them)
   - **Add to Variable**, variable name **Lines**
4. After the repeat: **Combine Text**, combine **Lines** with **New Lines**
5. Add **Copy to Clipboard**

Daily use: run the shortcut (Siri, widget or its icon), open RISE Local, tap **Import from Apple Health**, tap Allow Paste. Done, debt updates from your real watch data.

## What it does

- **Sleep tab**: log nights and naps, see your sleep debt (how much sleep you owe your body over the last 14 nights) and your learned sleep need
- **Energy tab**: your predicted day, from the grogginess zone after waking through the morning peak, afternoon dip, evening peak, wind-down and melatonin window, plus a suggested bedtime
- **Progress tab**: last 14 nights vs your need and your sleep debt trend

Click "Load sample data" to explore with two weeks of realistic data.

## How the math works (simplified from RISE's published model)

- **Sleep need** starts at 8h and once you've logged 7+ nights it's estimated as the 75th percentile of your recent nightly totals (people undersleep their need, so the high end of what you actually sleep approximates it). You can override it manually.
- **Sleep debt** is the weighted sum of nightly shortfall (need minus slept) over the last 14 nights, recent nights weighted more. Surplus nights and naps pay it down. Keep it under 5 hours.
- **Energy schedule** is a simplified two-process circadian curve anchored to your wake time: peaks mid-morning and early evening, a dip in between, sleep inertia for the first 90 minutes. Higher debt flattens your peaks. The suggested bedtime is your wake goal minus your need plus a bit extra to pay down debt.

## Tests

```bash
npm test
```

19 unit tests cover the sleep model and storage layer.
