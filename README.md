# line-wait-ml

Polls Disneyland Resort (DLR) and Walt Disney World (WDW) ride wait times every 10 minutes and writes snapshots to Firebase Firestore. Data feeds a future ML model for short-horizon wait-time forecasting and peak/trough detection.

## How it works

1. GitHub Actions runs every 10 minutes (triggered by cron-job.org via `repository_dispatch`).
2. `collect.js` iterates over both resorts. For each, it checks every park's live schedule via the `themeparks.wiki` API. If all parks in a resort are closed right now, that resort logs `skip_closed` and is skipped — no Firestore write for that resort.
3. For open parks, it fetches live wait times + current weather (Open-Meteo), filters to attractions with a standby queue, enriches each row with the resort's timezone-aware temporal features + holiday + local-event proximity, and batch-writes to that resort's collections.

Each resort gets its own Firestore collections — no commingling. Resort-specific config (timezone, weather coords, target collections, events file) lives in the `RESORTS` array at the top of `collect.js`.

Data source: [`themeparks.wiki`](https://api.themeparks.wiki/docs/v1.html) — free, no auth, community-maintained.

## First-time setup

These steps must be done manually in cloud consoles — they can't be automated from here.

### 1. Create a Firebase project (~5 min)

1. Go to <https://console.firebase.google.com> → **Add project**.
2. Name it `line-wait-ml` (or anything). **Disable** Google Analytics — not needed.
3. Wait for provisioning to finish.

### 2. Enable Firestore (~2 min)

1. Left sidebar → **Build → Firestore Database** → **Create database**.
2. Mode: **Production mode** (locked-down by default; we write via service account).
3. Region: `us-west1` or `us-west2` (closest to Disneyland; lowest latency from US-West Actions runners).

### 3. Create a service account key (~3 min)

1. Project Settings (gear icon) → **Service accounts** tab → **Generate new private key** → confirm.
2. A JSON file downloads. **This is a secret. Never commit it.**
3. Open the JSON file in a text editor and copy the entire contents to your clipboard.

### 4. Add the secret to GitHub (~1 min)

1. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**.
2. Name: `FIREBASE_SERVICE_ACCOUNT`
3. Value: paste the entire JSON blob.
4. Click **Add secret**.

### 5. Make the repo public (~30 sec)

GitHub → repo **Settings → General → scroll to "Danger Zone" → Change repository visibility → Public**. This unlocks unlimited GitHub Actions minutes; on a private repo the 10-min cron risks busting the 2,000 min/month free-tier quota.

### 6. Trigger the first run

Either wait up to 10 minutes for the cron, or trigger manually: **Actions tab → Collect Disney wait times → Run workflow**.

Verify in the Firebase console: **Firestore Database → Data tab** — `wait_times` should populate while DLR is open (~100 docs/run), `wait_times_wdw` should populate while WDW is open (~125 docs/run).

## Local development

```bash
npm install

# Save your service-account JSON locally (gitignored):
# (download from Firebase Console → Project Settings → Service accounts)
mv ~/Downloads/your-firebase-key.json ./firebase-key.json

# Run the collector once:
FIREBASE_SERVICE_ACCOUNT=$(cat firebase-key.json) node collect.js
```

Expected output is one JSON line per resort — either:

- `{"event":"skip_closed","resort":"DLR","at":"..."}` if all parks in that resort are closed, or
- `{"event":"wrote","resort":"DLR","count":N,"parks":[...],"weather":"ok"}` on success.

You'll see the same shape for `"WDW"`. One resort failing (e.g., transient API error) doesn't take down the other — they're processed independently.

### Verify the holiday math

```bash
# July 4 — should report is_holiday: true, days_until: 0, days_since: 0
node -e "import('./holidays.js').then(m => console.log(m.holidayFeatures(new Date('2026-07-04T12:00:00-07:00'))))"

# July 5 — should report is_holiday: false, days_since: 1, days_until: 64 (Labor Day Sep 7)
node -e "import('./holidays.js').then(m => console.log(m.holidayFeatures(new Date('2026-07-05T12:00:00-07:00'))))"
```

## Firestore document schema

There are **two parallel sets of collections, one per resort.** DLR data lives in `wait_times` + `weather_snapshots`; WDW data lives in `wait_times_wdw` + `weather_snapshots_wdw`. Identical schemas; the only difference is which resort the rows came from.

### `wait_times` / `wait_times_wdw`

Auto-generated document IDs. ~100 DLR docs/run, ~125 WDW docs/run, only when at least one park in that resort is open.

| field | type | notes |
|---|---|---|
| `ride_id` | string | UUID from themeparks.wiki |
| `ride_name` | string | e.g. "Space Mountain" |
| `park_id` | string | UUID of the specific park within the resort |
| `park_name` | string | e.g. "Disneyland Park", "Magic Kingdom Park" |
| `wait_minutes` | number \| null | `null` if not reported |
| `status` | string | `OPERATING`, `CLOSED`, `DOWN`, `REFURBISHMENT` |
| `timestamp_utc` | Timestamp | one timestamp shared by all rows from a single run |
| `schedule_type` | string | `OPERATING`, `TICKETED_EVENT`, or `UNKNOWN` (if schedule fetch failed) |
| `day_of_week` | number | 0=Sun … 6=Sat, **in the resort's local timezone** (PT for DLR, ET for WDW) |
| `hour_of_day` | number | 0–23, in the resort's local timezone |
| `month` | number | 1–12, in the resort's local timezone |
| `is_holiday` | boolean | one of the 16 holidays in `holidays.js` |
| `is_holiday_weekend` | boolean | Fri/Sat/Sun/Mon within 3 days of any holiday |
| `days_until_next_holiday` | number | 0 if today is a holiday |
| `days_since_last_holiday` | number | 0 if today is a holiday |
| `local_event_today` | boolean | true if any entry in the resort's events file covers today |
| `local_event_types` | array of strings | event types active today, e.g. `["convention"]`. Empty if none. |
| `local_event_names` | array of strings | human-readable names of active events |
| `days_until_next_local_event` | number \| null | `null` if no future events on file |
| `days_since_last_local_event` | number \| null | `null` if no past events on file |
| `raw` | map | original API entity (with `forecast` removed) — insurance against schema regret |

### `weather_snapshots` / `weather_snapshots_wdw`

Auto-generated document IDs. One doc per run per resort (only when at least one park in the resort is open). Source: [Open-Meteo](https://open-meteo.com) free tier, no API key. DLR weather is fetched for Anaheim (33.81, -117.92); WDW for Orlando (28.39, -81.57).

| field | type | notes |
|---|---|---|
| `timestamp_utc` | Timestamp | matches the `timestamp_utc` of all `wait_times` docs from the same run — join on this |
| `temperature_f` | number | current air temperature, °F |
| `feels_like_f` | number | apparent temperature factoring humidity + wind, °F |
| `precipitation_mm` | number | current precipitation rate, mm/hr |
| `wind_mph` | number | current wind speed at 10m, mph |
| `weather_code` | number | [WMO code](https://open-meteo.com/en/docs#weathervariables): 0=clear, 1–3=cloudy, 45/48=fog, 51–67=rain, 71–77=snow, 80–86=showers, 95–99=thunderstorm |
| `raw` | map | full Open-Meteo response — insurance against schema regret |

If the Open-Meteo fetch fails, the run logs `weather_fetch_failed` and continues — `wait_times` still gets written, just no weather doc for that run.

## Maintaining the local-events lists

There are **two events files**, one per resort:
- `local_events.json` — DLR events (Anaheim Convention Center, runDisney DLR weekends, SoCal-area events).
- `local_events_wdw.json` — WDW events (Orange County Convention Center, runDisney WDW weekends, Orlando-area events). Currently empty — populate as you go.

Both files use the same format and are read on every collector run. Edit either directly and commit.

**Format:**

```json
[
  {
    "name": "NAMM Show 2027",
    "type": "convention",
    "start_date": "2027-01-21",
    "end_date": "2027-01-24"
  }
]
```

**Rules:**

- `type` must be one of `convention`, `race`, `sports`, `competition`. Entries with any other type are silently skipped.
- Dates are `YYYY-MM-DD`, **inclusive** on both ends. A single-day event uses the same date for both fields.
- `name` is for your own reference — surfaced into snapshot docs as `local_event_names` for debugging in the Firestore console.
- The collector reads this file on every run, so adding an event just means commit + push. No code change.
- If the file is missing or invalid, the collector logs a warning and continues with no event features set on that run (rather than failing).

**Don't include:**

- US federal holidays — already handled by `holidays.js`.
- Disney's own ticketed events (Halloween parties, Disneyland After Dark) — already captured via the `schedule_type` field on each snapshot.

## What's covered as a "holiday"

Sixteen US federal holidays + a few non-federal high-impact dates, all rule-computed (no annual maintenance):

New Year's Day, MLK Jr. Day, Presidents Day, Easter Sunday, Memorial Day, Juneteenth, Independence Day, Labor Day, Columbus / Indigenous Peoples Day, Veterans Day, Thanksgiving, Black Friday, Christmas Eve, Christmas Day, Day after Christmas, New Year's Eve.

The same list applies to both resorts — federal holidays are nationwide. The only resort-specific difference is the timezone used to determine "what day is it today" (PT for DLR, ET for WDW), which matters near the date-boundary at midnight.

Spring break is intentionally **not** modeled — it's a fuzzy multi-week window with no clean rule and varies by school district. The model can pick up that pattern from raw `month` + `day_of_week` features.

## Known limitations

- The cron is triggered externally via cron-job.org → `repository_dispatch`, which is dramatically more reliable than GitHub's native `schedule:` (used previously and abandoned for being too sparse). Expect runs to land within a minute of their scheduled time.
- `themeparks.wiki` is an unofficial wrapper around Disney's internal API. Disney could change the underlying API at any time; field shapes may shift without notice.
- Walk-through attractions and meet-and-greets without standby queues are excluded by design (they don't have wait times).
- WDW and DLR are processed independently within a single workflow run — one resort failing (e.g., transient API hiccup) doesn't take down the other. Failures log `resort_failed` and the run exits non-zero so the failure surfaces in the Actions UI.
- Daily Firestore writes run at ~85% of the 20k/day free-tier limit when both resorts are collecting normally. A bad data day or schema regression could blow the quota.
