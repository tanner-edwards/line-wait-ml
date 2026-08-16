# Club 32 — Architecture

## Stack

```
React Native / Expo (PWA today, full native later)
        ↓ HTTPS + API key
AWS API Gateway → AWS Lambda (Node.js / TypeScript)
        ├─ Themeparks.wiki public API  (live wait times)
        ├─ Firebase Firestore          (historical averages, ride metadata, devices)
        └─ AWS Bedrock (Claude)        (LLM recommendations)

Data collection (separate, always running):
cron-job.org → GitHub repository_dispatch → GitHub Actions
        └─ collect.js (Node.js) → Firestore wait_times / wait_times_wdw

Historical averages cron:
GCP Cloud Scheduler (weekly, Sunday ~3 AM PT)
        └─ GCP Cloud Run Job (Python + pandas) → Firestore historical_averages
```

## Hard rules — never break these

**1. The app never calls Firebase directly.**
All data flows through Lambda. An exposed Firebase client = billing disaster (Bedrock calls are expensive) and a security hole. This holds even after native transition.

**2. API key auth from day one on every endpoint.**
No open endpoints, ever. The Lambda checks the `x-api-key` header on every request. The key is stored in the app bundle (acceptable — rotate if compromised, never exposed in source control).

**3. The Lambda response shape is stable across versions.**
Per-ride shape: `{ id, name, land, status, currentWait, historicalAverage, score, recentHistory, rideStats, prediction }`. `historicalAverage` is the averages layer; `prediction` is always `null` until the ML model is ready. Swapping in ML predictions is a backend-only change — the app shape is already future-proofed.

**4. The live collector (`collect.js`) only writes to Firestore.**
Never add reads to it. Keeping it write-only keeps it fast and cheap.

**5. Disney data quirks are handled at training time, not collection time.**
The raw posted wait value is the right thing to store. See `docs/disney-data-quirks.md`.

## Firestore collections

| Collection | Written by | Read by | Contents |
|---|---|---|---|
| `wait_times` / `wait_times_wdw` | `collect.js` (GitHub Actions) | GCP Cloud Run Job (averages cron) | Raw ride snapshots, every 10 min |
| `historical_averages` | GCP Cloud Run Job (Python) | Lambda | Pre-computed `(rideId, bucket, dayType)` mean waits, refreshed weekly |
| `ride_metadata` | `cron/populate_ride_metadata.py` (manual) | Lambda | Ride coordinates, allowlist flag, walk penalty — see below |
| `devices` | Lambda `/v0/devices` endpoint | Lambda notifications scanner | Push tokens, mustDoRideIds, armedDate |
| `notification_log` | Lambda notifications scanner | Lambda (dedup) | Last notification per `(deviceId, rideId, type)` |

## Ride metadata allowlist

`handler.ts` filters all rides through the `ride_metadata` Firestore collection. Any ride absent from that collection is silently excluded — this is intentional, to keep walk-throughs, exhibits, and transportation (Main Street Cinema, Minnie's House, etc.) off the list.

**Adding a new ride:**
1. Add an entry to `ride_metadata.json` (repo root) with `themeparks_id`, `lat`, `lng`, `tracks_wait_time: true`.
2. Re-run: `cd cron && GOOGLE_APPLICATION_CREDENTIALS=../firebase-key.json python populate_ride_metadata.py`
3. No Lambda deploy needed — next cold start picks up the new Firestore doc.

Special case: `walkPenaltyMinutes` can be added to rides at choke-point park entrances (currently Jungle Cruise and Indiana Jones = +2 min each).

## PWA → Native transition

The app currently runs as an Expo PWA (web). This was deliberate: faster iteration, no App Store friction during early development. The architecture is designed so the native transition is a swap, not a rewrite:

- Replace the hand-rolled `Sheet` component with `@gorhom/bottom-sheet`
- Replace web push with Expo Notifications (APNs/FCM)
- GPS and background tasks work better natively — location-triggered notifications (deferred) require native

Nothing in the Lambda, data pipeline, or Firestore schema changes at native transition.

## Key files

| File | What it does |
|---|---|
| `collect.js` | GitHub Actions cron — polls Themeparks.wiki, writes to Firestore |
| `holidays.js` | Rule-based holiday math (no external deps) |
| `ride_metadata.json` | Ride allowlist seed file |
| `cron/compute_averages.py` | GCP Cloud Run Job — computes historical averages from raw data |
| `cron/populate_ride_metadata.py` | Seeds `ride_metadata` Firestore collection from the JSON file |
| `app/backend/src/handler.ts` | Lambda entry point — assembles full ride response |
| `app/backend/src/recommendations/` | LLM prompt building + Bedrock call |
| `app/backend/src/scoring/` | Deterministic scoring (go/skip/star badges) |
| `notification-copy.js` | Shared notification copy strings (used by scanner AND frontend history view) |
