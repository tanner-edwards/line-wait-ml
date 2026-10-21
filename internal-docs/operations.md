# Club 32 — Operations Runbook

Operational tasks that aren't obvious from the code.

---

## Adding a promo code

Promo codes are stored in the `promoCodes` Firestore collection. Each document ID is the code itself (uppercase).

1. Open the [Firebase Console](https://console.firebase.google.com) → **llm-wait-times** → Firestore → `promoCodes` collection.
2. Click **Add document**.
3. Set the **Document ID** to the code you want (e.g. `SUMMER25`). Use uppercase — the app normalizes input before validating.
4. Add these fields:

| Field | Type | Value |
|---|---|---|
| `type` | string | `free_trip` |
| `maxUses` | number | How many times the code can be used (e.g. `50`) |
| `timesUsed` | number | `0` |
| `expiresAt` | string | ISO expiry date — e.g. `2026-12-31T23:59:59Z` |
| `active` | boolean | `true` |

5. Click **Save**.

The code is live immediately — no deploy needed.

**To disable a code:** set `active` to `false`.  
**To extend expiry:** update `expiresAt`.  
**To check usage:** read the `timesUsed` field.

---

## Granting developer / beta access (bypass flag)

To give a user full paid access without a trip or payment:

1. Firestore → `users` collection → find the user's document (doc ID = Firebase UID).
2. Set the `bypass` field to `true`.

Revoke by setting it back to `false`. Takes effect on the user's next app launch.

---

## Toggling a feature flag

All flags live in one Firestore doc: **`config/featureFlags`**. Each top-level field is a flag:

| Field | Type | Value |
|---|---|---|
| `<flagName>.enabled` | boolean | `true` / `false` |
| `<flagName>.minAppVersion` | string (optional) | e.g. `1.1.0`. Builds below this version get the flag off |

Current flags: `freeTrip` (the "first trip free" claim screen and `/v1/users/trip/claim-free`).

Example:
```
freeTrip: { enabled: true, minAppVersion: "1.1.0" }
```

How the backend decides (`app/backend/src/featureFlags.ts`):
- The app sends its version in the `x-app-version` header. With the header, a flag is on when `enabled` is `true` AND the version is at least `minAppVersion`.
- **No header** (builds released before 1.1.0): only `enabled` counts and `minAppVersion` is ignored, so old App Store builds keep working.
- If the doc or flag is missing, or a version is malformed, the flag is **off**. The doc must exist before any backend deploy, or the free trip turns off for everyone.

Changes take effect within ~60s (backend cache) and on the app's next launch or foreground. No deploy needed.

---

## Deploying changes

### Backend (Lambda)

Before deploying the backend:
1. `git status -sb` must NOT say "ahead" — the Deploy Club 32 workflow builds origin/main, not your laptop. Push first.
2. Deploy the backend (workflow or `./deploy.sh`).
3. Verify live: `curl -s -o /dev/null -w '%{http_code}' -H "x-api-key: $API_KEY" "$API/v0/waits"` must print 200 (the combined endpoint — both parks; without the key it prints 401).
4. Only then deploy the cron image / models. The cron is the producer; the backend is the consumer. Consumer first, always.

```bash
cd app/backend && ./deploy.sh
```

### Cloud Run Job (cron image)
Used by: ML predictions (`predict.py`), closure profile rebuild (`build_closure_profiles.py`).

Rebuild and push the image whenever any file in `cron/` changes (Dockerfile, predict.py, build_closure_profiles.py, etc.):
```bash
cd cron
gcloud builds submit --tag gcr.io/llm-wait-times/club32-predict-cron .
gcloud run jobs update club32-predict-cron \
  --image gcr.io/llm-wait-times/club32-predict-cron \
  --region us-west1 \
  --project llm-wait-times
```

**How it works:** `gcloud builds submit` uploads the `cron/` directory to Cloud Build, which builds the Docker image remotely and pushes it to `gcr.io/llm-wait-times/club32-predict-cron`. The `run jobs update` command then points the job at the new image. Both steps are required — build alone doesn't update the running job.

The job itself is triggered two ways:
- Every 10 min by `collect.yml` (runs `predict.py`)
- Every Sunday by `rebuild_profiles.yml` (runs `build_closure_profiles.py` via `--args`)

### ML models

**Superseded by "Retrain and deploy models (biweekly)" below.** Models are now trained and written by the notebook's `EXPORT` cell (`ml/export.py`), not the old save cell, and deployed with that section's checklist. Reference only:

```bash
npm run deploy:models
```

**How it works:** copies every `models/*.txt` and `models/*.json` to `gs://club32-models/`. `predict.py` downloads models from the bucket on every run, so the next 10-min run picks them up. No image rebuild needed. Use `npm run deploy:all` only when `cron/` code also changed (it runs `deploy:models` then rebuilds the cron image).

`models/manifest.json` (written by `ml.export.export`) goes up with the models. `predict.py` stamps `model_version` (the manifest's `trained_through`) on every prediction doc and reads `trajectory_target` to turn delta-trained outputs back into levels. It writes a tombstone doc (`degraded: true`) for rides it cannot forecast, so the backend never serves a stale forecast as live.

Any new field in a prediction doc must be additive. Tombstones carry the full doc shape so an older backend can still read them.

### Retrain and deploy models (biweekly)

Cadence is manual for now (every two weeks); a later session automates it. The forward scoreboard's recipe comparison is the deploy gate. The export refits on every row, so its output cannot be scored.

**Biweekly retrain:**
1. Pull the latest data in the notebook and run it top to bottom. The scoreboard cell runs automatically (`recipe=RECIPE_A, compare=RECIPE_B`) and writes `reports/eval/<date>_recipeB.md`.
2. Read the "Recipe comparison" table in that report.
3. Export and deploy with steps 1–6 below.
4. Record the report and the manifest's `trained_through` in `ml_training_history.md`.

**Deploy checklist.** Do the steps in order. Each step has a check, and you don't go on until it passes.

0. **Gate.** The scoreboard report with the recipe comparison exists, and Tanner has read the table and said go. B ships only if it beats A on the paired test at T+30, T+60 and T+120 and the Full Day row is not worse. If B lost, export A (refit on all data) instead.
1. **Nothing unpushed.**
   ```bash
   git status -sb
   ```
   Check: the first line does not say "ahead". Push if it does.
2. **Deploy the cron image first. Always before the models.** Old cron code can't read a delta model. It would add no current wait back, and it hard-selects Recipe A's 21 trajectory columns. Recipe B also has 21 columns (no `week_of_year`, plus `minutes_until_close`), so LightGBM would **not** reject them. It would silently forecast nonsense.
   ```bash
   npm run deploy:cron
   gcloud run jobs executions list --job club32-predict-cron --region us-west1 --project llm-wait-times --limit 3
   ```
   Check: the next execution after the deploy is `SUCCEEDED`. In the Firebase console (`predictions` collection), docs have `updated_at` under 15 minutes old and `model_version` is still the **old** date. This is new code with old models, and it has to work.
3. **Back up the bucket (mandatory).**
   ```bash
   gcloud storage cp "gs://club32-models/*" "gs://club32-models/backup-$(date +%F)/"   # not gsutil -m: it crashes Python on this Mac; quote the URLs so zsh leaves * alone
   ```
   Check: `gcloud storage ls "gs://club32-models/backup-$(date +%F)/"` lists 20 files: the 12 `trajectory_t*.txt`, `day_profile.txt`, the JSONs and `manifest.json`.
4. **Export.** In the notebook, set `EXPORT_MODELS = True` and run the `EXPORT` cell (body in `ml/README.md`, "Session 4 cells").
   ```bash
   cat models/manifest.json
   ```
   Check: `trained_through` is the latest data date, and `recipe` / `trajectory_target` are the winning recipe's. Commit `models/`.
5. **Deploy the models.**
   ```bash
   npm run deploy:models
   gcloud run jobs executions list --job club32-predict-cron --region us-west1 --project llm-wait-times --limit 3
   ```
   Check within one cycle (10 minutes): the execution is `SUCCEEDED`; the `predictions` docs carry the **new** `model_version`; the endpoint returns 200 (`curl -s -o /dev/null -w '%{http_code}' -H "x-api-key: $API_KEY" "$API/v0/waits"`); a spot-check ride (Space Mountain) has `t60` within a plausible range of its current wait and a non-empty `full_day`.
6. **Rollback if anything fails.**
   ```bash
   gcloud storage cp "gs://club32-models/backup-<date>/*" gs://club32-models/
   ```
   The next cycle picks it up. No code rollback is needed, because the new code reads old models.

### Frontend (Expo web)
```bash
cd app/frontend && ./deploy-web.sh
```

---

## Adding a new Disney ride

When a new ride opens, it won't appear in the app until it's in the metadata allowlist:

1. Add an entry to `ride_metadata.json` at the repo root with `themeparks_id`, `lat`, `lng`, `name`, and `tracks_wait_time: true`.
2. Re-run the seeder:
   ```
   cd cron && GOOGLE_APPLICATION_CREDENTIALS=../firebase-key.json python populate_ride_metadata.py
   ```

See `CLAUDE.md` for the full field list.
