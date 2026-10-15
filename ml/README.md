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
