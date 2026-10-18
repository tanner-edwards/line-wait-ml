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
Upload retrained models after the notebook's save cell writes them to `models/`. From the repo root:
```bash
gsutil -m cp gs://club32-models/* gs://club32-models/backup-$(date +%F)/   # optional backup
npm run deploy:models
```

**How it works:** copies every `models/*.txt` and `models/*.json` to `gs://club32-models/`. `predict.py` downloads models from the bucket on every run, so the next 10-min run picks them up — no image rebuild needed. Use `npm run deploy:all` only when `cron/` code also changed (it runs `deploy:models` then rebuilds the cron image).

Before deploying, confirm the new models beat the deployed ones in the notebook's `deployed-vs-new-compare` and `deployed-vs-new-day-profile` cells. After deploying, bump `DEPLOYED_TRAINED_THROUGH` in the compare cell to the deploy date.

The save cell also writes `models/manifest.json` (via `ml.manifest.write_manifest`), and `deploy:models` uploads it with the models. `predict.py` stamps `model_version` (the manifest's `trained_through`) on every prediction doc, and writes a tombstone doc (`degraded: true`) for rides it cannot forecast so the backend never serves a stale forecast as live.

Any new field in a prediction doc must be additive. Tombstones carry the full doc shape so an older backend can still read them.

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
