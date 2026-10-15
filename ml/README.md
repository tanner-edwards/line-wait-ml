# ml/ — model evaluation ("the scoreboard")

Forward-holdout evaluation of the trajectory and day-profile models. Lives outside `cron/` so it never ships in the Cloud Run image. No Firestore access; it reads `models/` and writes `reports/eval/` only.

## Run it from the notebook

```python
import sys; sys.path.insert(0, '.')
from datetime import date
from ml import evaluate
res = evaluate.run(df_sorted, RIDE_ID_CATEGORIES, STATUS_CATEGORIES,
                   weeks=4, also_interleaved=True,
                   deployed_trained_through=date(2026, 10, 4), label='baseline')
res.headline              # horizon x {persistence, lookup_delta, recipe_A, deployed, lift %}
res.trend_summary         # recall / precision per trend class, per horizon
res.by_ride[60].head(20)  # per-ride MAE and lift at T+60, worst first
```

That also writes `reports/eval/YYYY-MM-DD_baseline.md` (commit it). For quick iteration pass `horizons=[30, 60, 120]` and `run_staleness=False`. If you edit a module under `ml/`, restart the kernel or `importlib.reload` it.

## Save cell: write the manifest

Add this line to the notebook's save cell, after the model files are written to `models/`:

```python
from ml.manifest import write_manifest; write_manifest(trained_through=df_sorted['date_la'].max())
```

It writes `models/manifest.json` (`trained_through`, `exported_at`, `git_sha`, `recipe`). `deploy:models` uploads it, `predict.py` stamps `model_version` from it, and `evaluate.run` uses its date for `deployed_trained_through` when you don't pass one.

## Cleaning cell

New cell, pasted after `FEATURES: walk-on-normalization` and before `FEATURES: sort-and-targets` (targets and lags must be built on the cleaned frame):

```python
import sys, json; sys.path.insert(0, '.')
from ml.clean import clean_frame
ride_metadata = json.load(open('ride_metadata.json'))
df, clean_summary = clean_frame(df, schedules_df, ride_metadata)
```

It drops rows after the park's public OPERATING close (party nights: Oogie Boogie Bash, Grad Nite, After Dark), drops `Villains Grove at Oogie Boogie Bash`, and turns OPERATING zeros on real-queue rides into NaN (`wait_minutes_raw` keeps the 0). Dates with no schedule are kept. It prints a 4-line summary; `clean_summary['dates_affected']` and `clean_summary['party_dates']` list the dates.

`park_schedules_cache.pkl` is never topped up. If its date range (printed by `LOAD: park-schedules-cache`) ends before the wait data does, delete the file and re-run that cell first, or party nights after that date stay in training.

Edit `FEATURES: park-schedule-extract`: replace the two `_minutes_from_midnight` lines with

```python
schedules_df['open_minutes'] = schedules_df.apply(lambda r: _minutes_from_midnight(r['opening_iso'], anchor_date=pd.to_datetime(r['date']).date()), axis=1)
schedules_df['close_minutes'] = schedules_df.apply(lambda r: _minutes_from_midnight(r['closing_iso'], anchor_date=pd.to_datetime(r['date']).date()), axis=1)
```

so a 12:00 AM close is 1440, not 0. Then re-run the notebook from the cleaning cell onward (that covers the schedule cell too; `clean_frame` is safe to run twice), and run the scoreboard with `label='clean'`.

Smoke check on the raw cache (read-only): `.venv/bin/python ml/smoke_clean.py --cache df_cache.pkl --schedules park_schedules_cache.pkl --metadata ride_metadata.json`.

## Reading the headline table

- Train = every day on or before the cutoff; test = the 4 weeks after. The model has never seen a test day.
- For horizon N, every column is scored on the same rows: `training_valid_tN` on test days (`n_rows`).
- `persistence` = "the wait stays what it is now". `lookup_delta` = current wait + the typical N-minute change for that ride, hour, and day type.
- `lift_*` columns are percent MAE improvement; positive means Recipe A (or deployed) is better.
- Paired daily tests: a negative mean means the first model is better; check `half_width_95` and `sign_test_p` before believing a small gap.

## CONTAMINATED

`deployed_trained_through` is the last day the deployed model files were trained on. If any test day is on or before it, the deployed model has already seen those days and its numbers are flagged CONTAMINATED: shown for reference, never used for a verdict. An unknown date counts as contaminated.

## The rule

The forward split gates deploys. The interleaved split (every 5th day, the notebook's old method) is shown only for comparison; it overstates lift and never decides anything.

Tests: `.venv/bin/python -m pytest ml/tests -q`. Optional smoke run on a pickled frame: `.venv/bin/python ml/smoke_run.py --frame <path>`.
