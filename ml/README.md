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

## Session 3 cells

**Winners** (`reports/eval/2026-10-16_session3-variants.md`, forward split, expected tables fit on train days only):

- `crowd_level_ratio` → **V1, keyed `(day_type, hour)`**, resort-wide. Day-profile serving-style MAE 6.45 (V0 month-keyed: 7.09). Per park (V2) came in at 6.34, but the paired gap vs V1 (−0.10 ± 0.14) is inside the noise.
- `morning_crowd_index` → **M2, dropped** from `DAY_PROFILE_FEATURE_COLS` (`cron/predict.py` and `ml/recipes.py`). Headliner P75 per park (M1) came in at 6.37 vs 6.41 with it dropped, paired −0.04 ± 0.09, also noise. The current all-rides median (M0) is worse than dropping it (+0.04 ± 0.03).
- Regime thresholds → keyed by `ride_name`, with `ride_id` as the fallback (not scored. The fix is for correctness on overlays).

All training-time expected tables below are fit on **all rows**. Production should see every day. The experiment used the train mask instead. Both go through the same functions. Paste each body over the cell with the same tag.

Also edit the day-profile training cell (`16b64138`): delete `'morning_crowd_index',` from its feature list so it matches `DAY_PROFILE_FEATURE_COLS`.

### `FEATURES: morning-crowd-index` (`m1n2o3p4`)

Replace the whole cell body with:

```python
# ── FEATURES: morning-crowd-index ── dropped in Session 3 (no keying beat leaving it out).
# See reports/eval/2026-10-16_session3-variants.md; the functions remain in cron/crowd_features.py.
```

### `FEATURES: minutes-at-current-level` (`feat-minutes-at-level`): threshold lines only

Replace the four lines from `# Per-ride P25 / P75 thresholds across all operating data` through `df_sorted = df_sorted.merge(_percs, on='ride_id', how='left')` with:

```python
# Per-ride P25 / P75 thresholds, keyed by ride_name (seasonal overlays share a
# ride_id with their base ride) with ride_id as fallback. Same dict is exported
# by the save cell, so training and serving classify regimes identically.
import sys; sys.path.insert(0, 'cron')
from crowd_features import regime_thresholds
ride_regime_thresholds = regime_thresholds(df_sorted)
_thr = pd.DataFrame({k: v for k, v in ride_regime_thresholds.items() if k != '_meta'}).T
df_sorted['_p25'] = df_sorted['ride_name'].map(_thr['p25']).fillna(df_sorted['ride_id'].map(_thr['p25']))
df_sorted['_p75'] = df_sorted['ride_name'].map(_thr['p75']).fillna(df_sorted['ride_id'].map(_thr['p75']))
```

The rest of the cell is unchanged. Thresholds are now rounded to 2 dp at training time too, matching what serving has always used.

### `FEATURE: crowd-level-ratio` (`crowd-level-ratio-feature`)

```python
# ── FEATURE: crowd-level-ratio ──────────────────────────────────────────────
# Real-time park busyness: 2h (12-poll) rolling sum of operating waits /
# expected sum for (day_type, hour). Session 3: month dropped from the key so
# a new month never misses; logic lives in cron/crowd_features.py and is
# shared with predict.py (parity-tested in cron/test_crowd_features.py).
# Null before hour 10 and when any poll in the window has < 8 rides.
import sys; sys.path.insert(0, 'cron')
from crowd_features import crowd_expected_table, crowd_level_ratio_frame

CROWD_KEYED_BY = ('day_type', 'hour')
_all_rows = pd.Series(True, index=df_sorted.index)
df_sorted['crowd_level_ratio'] = crowd_level_ratio_frame(df_sorted, _all_rows, CROWD_KEYED_BY)
crowd_level_baselines = crowd_expected_table(df_sorted, _all_rows, CROWD_KEYED_BY)

non_null = df_sorted['crowd_level_ratio'].notna().sum()
print(f"crowd_level_ratio: {non_null:,} non-null of {len(df_sorted):,} rows ({100*non_null/len(df_sorted):.1f}%), "
      f"{len(crowd_level_baselines) - 1} baseline keys")
```

### `SAVE: save-all-models` (`0e095970`): JSON exports

`ride_regime_thresholds` (minutes-at-level cell) and `crowd_level_baselines` (crowd-ratio cell) are now built upstream, so in the save cell:

1. Delete the three `baselines_path` lines that write `morning_baselines.json` and change the `print(f"\n{len(models) + 1} models + category map + morning baselines saved ...")` text to drop "+ morning baselines". `predict.py` no longer downloads that file. The copy already in GCS is harmless and stays.
2. Replace the block from `# Ride regime thresholds (P25/P75 per ride ...` through `print("Saved ride_regime_thresholds.json")` with:

```python
    # Ride regime thresholds: by ride_name with ride_id fallback, _meta included
    Path("models/ride_regime_thresholds.json").write_text(json.dumps(ride_regime_thresholds, indent=2))
    print("Saved ride_regime_thresholds.json")
```

3. Replace the block from `# Crowd level baselines: expected park sum per (day_type, hour, month)` through `print(f'Saved crowd_level_baselines.json ...')` with:

```python
    # Crowd level baselines: expected 2h park sum per CROWD_KEYED_BY, _meta included
    Path('models/crowd_level_baselines.json').write_text(json.dumps(crowd_level_baselines, indent=2))
    print(f'Saved crowd_level_baselines.json ({len(crowd_level_baselines) - 1} buckets)')
```

**Deploy order:** run `deploy:cron` first, then `deploy:models`. From this code on, `_build_full_day` takes the day-profile columns from `day_profile_model.feature_name()` and feeds NaN for any feature the row lacks. That means the new code runs with the deployed 18-feature model (which has `morning_crowd_index`) and with a retrained 17-feature model. The cron code in production today still hard-selects 18 columns, and LightGBM raises on a feature-count mismatch, so shipping the retrained models before this code would break Full Day. Once this code is live, either order is safe for future model changes. The JSONs are safe in both orders: a missing `_meta` is read as the legacy format, and old code given v2 keys misses and returns None, as it does today. `DAY_PROFILE_FEATURE_COLS` is still the training-time list, and the parity test still enforces it.

Re-run the variant experiment: `.venv/bin/python -m ml.experiments.session3_crowd_variants`. It needs a fresh `df_features_cache.pkl`.
