# line-wait-ml

Polls Disneyland Park and Disney California Adventure ride wait times every 10 minutes via GitHub Actions and writes snapshots to Firebase Firestore. Data feeds a future ML model for predicting wait times and closure durations.

## How it works

1. GitHub Actions cron fires every 10 minutes (UTC).
2. `collect.js` checks each park's live schedule (`themeparks.wiki` API). If both parks are closed right now, it logs `skip_closed` and exits — no Firestore write.
3. For each open park, it fetches live wait times, filters to attractions with a standby queue, enriches each row with timestamp + holiday-proximity features (computed in `America/Los_Angeles`), and batch-writes to the `wait_times` collection.

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

Verify in the Firebase console: **Firestore Database → Data tab → `wait_times` collection** — about 100 docs should appear per run while parks are open.

## Local development

```bash
npm install

# Save your service-account JSON locally (gitignored):
# (download from Firebase Console → Project Settings → Service accounts)
mv ~/Downloads/your-firebase-key.json ./firebase-key.json

# Run the collector once:
FIREBASE_SERVICE_ACCOUNT=$(cat firebase-key.json) node collect.js
```

Expected output is a single JSON line — either:

- `{"event":"skip_closed","at":"..."}` if both parks are closed, or
- `{"event":"wrote","count":N,"parks":[...]}` on success.

### Verify the holiday math

```bash
# July 4 — should report is_holiday: true, days_until: 0, days_since: 0
node -e "import('./holidays.js').then(m => console.log(m.holidayFeatures(new Date('2026-07-04T12:00:00-07:00'))))"

# July 5 — should report is_holiday: false, days_since: 1, days_until: 64 (Labor Day Sep 7)
node -e "import('./holidays.js').then(m => console.log(m.holidayFeatures(new Date('2026-07-05T12:00:00-07:00'))))"
```

## Firestore document schema

Collection: `wait_times` (auto-generated document IDs).

| field | type | notes |
|---|---|---|
| `ride_id` | string | UUID from themeparks.wiki |
| `ride_name` | string | e.g. "Space Mountain" |
| `park_id` | string | DLR or DCA UUID |
| `park_name` | string | "Disneyland Park" / "Disney California Adventure Park" |
| `wait_minutes` | number \| null | `null` if not reported |
| `status` | string | `OPERATING`, `CLOSED`, `DOWN`, `REFURBISHMENT` |
| `timestamp_utc` | Timestamp | one timestamp shared by all rows from a single run |
| `schedule_type` | string | `OPERATING`, `TICKETED_EVENT`, or `UNKNOWN` (if schedule fetch failed) |
| `day_of_week` | number | 0=Sun … 6=Sat (Pacific time) |
| `hour_of_day` | number | 0–23 (Pacific time) |
| `month` | number | 1–12 (Pacific time) |
| `is_holiday` | boolean | one of the 16 holidays in `holidays.js` |
| `is_holiday_weekend` | boolean | Fri/Sat/Sun/Mon within 3 days of any holiday |
| `days_until_next_holiday` | number | 0 if today is a holiday |
| `days_since_last_holiday` | number | 0 if today is a holiday |
| `raw` | map | original API entity (with `forecast` removed) — insurance against schema regret |

## What's covered as a "holiday"

Sixteen dates per year, all rule-computed (no annual maintenance):

New Year's Day, MLK Jr. Day, Presidents Day, Easter Sunday, Memorial Day, Juneteenth, Independence Day, Labor Day, Columbus / Indigenous Peoples Day, Veterans Day, Thanksgiving, Black Friday, Christmas Eve, Christmas Day, Day after Christmas, New Year's Eve.

Spring break is intentionally **not** modeled — it's a fuzzy multi-week window with no clean rule and varies by school district. The model can pick up that pattern from raw `month` + `day_of_week` features.

## Known limitations

- GitHub Actions `schedule:` cron runs are best-effort; expect occasional 11–15 min gaps under load.
- `themeparks.wiki` is an unofficial wrapper around Disney's internal API. Disney could change the underlying API at any time; field shapes may shift without notice.
- Walk-through attractions and meet-and-greets without standby queues are excluded by design (they don't have wait times).
