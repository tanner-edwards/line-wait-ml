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
