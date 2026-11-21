# Club 32 Monitor (admin dashboard)

Operator-only PWA that grades the predictions production actually served.
Spec: `~/.claude/specs/line-wait-ml/admin-dashboard.md`.

## How it fits together

```
cron/predict.py ──(each run, best-effort)──▶ Firestore admin_prediction_runs (30-day TTL)
                                                   │
dashboard/server/app.py (Cloud Run, scales to 0) ──┤ on each page load / Refresh:
  /api/live, /api/recap                            └─ ml/dashboard/grading.py grades the day
  /*  → dashboard/web/dist (React PWA)
```

- No scheduler. Grading happens when you load the page; past days are cached in memory.
- `ml/dashboard/` holds the Python (grading, config, baselines). It reuses `ml.metrics`,
  `ml.clean` and `cron/crowd_features.py` without changing them. Nothing in `app/` or
  `cron/` imports the dashboard.
- Thresholds (tolerances, big-miss, unusual margin, bellwethers) live in
  `ml/dashboard/config.json`. Edit and redeploy.

## Run locally

```bash
# terminal 1 — API + built site on :8080 (reads prod Firestore, writes nothing)
ADMIN_KEY=dev GOOGLE_APPLICATION_CREDENTIALS=firebase-key.json .venv/bin/python dashboard/server/app.py

# terminal 2 — hot-reloading site on :5173, /api proxied to :8080
npm --prefix dashboard/web run dev
```

Open http://localhost:5173 and enter `dev` as the key.

Grade a day in the terminal without the UI:

```bash
.venv/bin/python ml/dashboard/grading.py --date 2026-10-24
```

## Tests

```bash
.venv/bin/python -m pytest ml/dashboard/tests dashboard/server/tests
npm --prefix dashboard/web run typecheck
```

## First-time deploy

1. `gcloud auth login` and make sure `gcloud config get project` works.
2. `dashboard/deploy.sh --setup`. This enables the APIs, prompts for a new admin key
   (20+ characters; keep it in your password manager) and stores it in Secret Manager.
3. `dashboard/deploy.sh`. The last line it prints is the dashboard URL.
4. Open the URL on each device and enter the key once. On iPhone, use
   Share → Add to Home Screen.

TTL on history (once, already done): `gcloud firestore fields ttls update expireAt
--collection-group=admin_prediction_runs --enable-ttl --project llm-wait-times`

## Routine

- **Deploy a change:** `dashboard/deploy.sh`. It never touches `club32-backend`,
  `club32-predict-cron` or the app's site.
- **Rotate the key:** `printf '%s' 'NEW-KEY' | gcloud secrets versions add
  club32-dashboard-admin-key --data-file=- --project llm-wait-times`, then
  `dashboard/deploy.sh`. Each device will prompt for the new key.
- **Refresh baselines** (per-park crowd, hourly P10/P90, ride tiers) after refreshing the local
  caches: `.venv/bin/python ml/dashboard/build_baselines.py`, then redeploy.

## Cost

- Cloud Run scales to zero and only runs while you load a page, which stays
  inside the free tier for one user.
- Each page load reads about 200 history docs.
- History writes add 2 Firestore writes per predict run.
