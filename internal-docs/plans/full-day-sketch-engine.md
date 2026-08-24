# Full Day Sketch — Engine + Validation Harness (Implementation Plan)

**Status:** Drafted 2026-07-13, not yet implemented. Companion to the design spec at `~/.claude/specs/line-wait-ml/full-day-sketch.md` (kept local/out of source control per this project's spec-phase convention — see CLAUDE.md).

## Context

We're building the **Full Day Sketch**: a deterministic engine that produces a coarse "day shape" for a Disneyland guest — ~3–4 curve-driven time buckets, each filled with rides, optimizing preference-weighted value under per-bucket time capacity. It surfaces counterintuitive, opportunity-cost-driven moves and (later) hands a spine to the real-time recommendations engine.

The spec mandates **engine-first, validated on historical data before any UI**. This milestone builds the full deterministic engine (two passes + feasibility) and the validation harness. LLM narration and app integration are explicitly deferred.

**Locked decisions (from planning Q&A):** Python in `cron/`; exact ILP via OR-tools; forecasts are production-ready so build both validation experiments (A + B); scope = full engine + harness.

**Key enabler, verified against `cron/predict.py`:** the day-profile full-day model uses only calendar/holiday + closure features (`DAY_PROFILE_FEATURE_COLS`, predict.py:42) — **no recent-wait lags** (those are `TRAJECTORY_FEATURE_COLS`, unused here). `_build_full_day` (predict.py:308) uses `now_la` only for `day_of_week`/`month` and takes `closures_today` as a param. So a past-morning forecast reconstructs from a past date + closures-known-as-of-gen-time — no 120-min window rebuild needed.

## Scope & build order

Full engine (Pass 1 ILP → Pass 2 routing → feasibility) + harness (Experiments A & B). Deferred: LLM narration, closure-based capacity carve-outs, app/backend integration, `LiveForecastProvider` beyond a smoke test.

## Package layout

Create `cron/day_sketch/` (first real package in `cron/`; relies on `cron/` on `sys.path` as predict.py does) and `cron/harness/`. Tests stay at `cron/test_*.py` (class-based pytest, LA-local helpers — match existing conventions).

```
cron/day_sketch/
  __init__.py            # exports run_day_sketch(), core dataclasses
  types.py               # dataclasses/enums (no logic): RideMeta, WaitCurve, ValueTier,
                         #   CramLevel, PinnedBlock, SketchProfile, SketchRequest,
                         #   Bucket, RidePlacement, DayShape, Warning
  metadata.py            # load ride_metadata.json -> {ride_id: RideMeta}
  geography.py           # haversine pairwise WALK-TIME matrix (hub-and-spoke, not 1-D)
  profile.py             # cram->capacity mapping; derive_tiers() (pure, tunable constants)
  buckets.py             # aggregate_curve() + detect_buckets() (inflection detection)
  forecast/
    provider.py          # ForecastProvider ABC + WaitCurve contract
    inference.py         # PURE model core, shared with predict.py (see Forecast section)
    perfect.py           # PerfectForecastProvider  (actuals as curve — Experiment A)
    model.py             # ModelForecastProvider    (point-in-time inference — Experiment B)
    live.py              # LiveForecastProvider      (reads predictions/ — smoke test only)
  pass1_assign.py        # OR-tools CP-SAT joint assignment
  pass2_route.py         # open-path routing, free reversal, paid swaps, fatigue, re-pricing
  feasibility.py         # two-audience warnings (structured, no LLM)
  engine.py              # run_day_sketch(): orchestrates passes + feedback loop
  simulate.py            # walk-the-shape simulator vs actual waits (scoring primitive)
  baselines.py           # popular-early, greedy-shortest

cron/harness/
  data.py                # load df_cache.pkl; day_slice; slice_up_to(gen_time); actuals_curve; closures_up_to
  synthetic_profiles.py  # fixed cast of guest profiles (benchmark axis)
  benchmark_set.py       # pinned, versioned (day x park x profile x ride-set) roster
  run_experiment.py      # batch runner: Experiment A then B, scoring, robustness delta
  report.py              # scoreboard + auto-triage (worst / metric-vs-pathology disagreements)
```

All internal time is **PT-local minutes-from-midnight** (matches `full_day.start_minutes`, `slot_closure_context`, `js_dow=(weekday()+1)%7`). Convert df_cache `timestamp_utc` (UTC) once at slice time. Do not use the wrapping wall-clock bucket strings from `bucketing.py`.

## Key data structures (`types.py`)

Frozen dataclasses. Highlights: `WaitCurve` holds 34 `(start_minutes, wait)` slots + `confidence`, with `wait_at(minute)` (nearest-slot) and `avg_between(lo,hi)` (bucket rep-wait). `ValueTier(IntEnum)` = NOT_FOR_US/WOULD_ENJOY/REALLY_WANT. `SketchRequest` is day-scoped and **stateless** (spec: keep it so — multi-day is a future layer above the engine). `SketchProfile` carries `thrill_tolerance`, kid/stroller/mobility flags, `max_height_in`, `cram`, `swap_walk_threshold_min`, `fatigue_budget`, `meal_window`, `want_categories`.

## Forecast layer (`forecast/`) + Experiment B reconstruction

`ForecastProvider` ABC: `curve(ride_id) -> WaitCurve | None`, `available_rides() -> set[str]`. Every provider returns the same 34-slot grid so the engine never branches on source.

- **`PerfectForecastProvider` (Exp A):** from a `df_cache` day×park slice — filter to `status=="OPERATING"` & non-null wait, bin actuals into the 34 half-hour slots (`range(420,1440,30)`), mean per slot, fill sparse slots deterministically (drop the ride from that day's universe if coverage is too thin). Confidence `"high"`.
- **`ModelForecastProvider` (Exp B):** point-in-time inference via the pure core below. Confidence from historical slot coverage / day-type sample count (feeds the low-confidence warning + catastrophic-confidence block).
- **`LiveForecastProvider` (later):** maps Firestore `predictions/{ride_id}.full_day` → `WaitCurve`; reuses predict.py's `_init_firestore` pattern. Out of the backtest loop.

**Refactor `predict.py` → extract pure core into `forecast/inference.py`** (eliminates train/infer drift):
- Lift `_build_full_day` (generalize `now_la` → any `day_date_la`; it already takes `closures_today` and uses the date only for calendar features) into `full_day_curve(...)`.
- Add a disk-only model loader mirroring `_load_models` (skip GCS `_download_models`), pointing at repo `models/`.
- Import `holiday_features` (day_type.py), `slot_closure_context`/`empty_closure_context`/`CLOSURE_FEATURE_COLS` (closure_features.py), `FULL_DAY_SLOTS`, `DAY_PROFILE_FEATURE_COLS` — reuse as-is.
- **Then have `predict.py` import these from `inference.py`** instead of defining inline. Confirm no regression via a dry import/unit test (avoid Firestore reads).

**Experiment B leakage control:** the ONLY leak vector is closures — only closures completed `<= gen_time` may inform the curve. `harness/data.py:closures_up_to(slice, gen_time)` derives `closures_today` from a time-bounded df_cache slice. Everything else (calendar/holiday) is deterministic and leak-free. NOT reusable/needed: `_build_trajectory_row`, trajectory models, `_read_recent`, GCS download.

## Bucketing (`buckets.py`)

`aggregate_curve(curves, ride_ids)` → mean 34-slot curve. `detect_buckets(agg, open_min, close_min, pinned, max_buckets=4)`:
- Smooth the aggregate (small centered MA) to kill 5-min quantization jitter; find inflections as first-derivative sign changes (rise→plateau→fall); cap 3–4; short day → 3. Label from position vs. the day's peak.
- **Rope-drop guard (spec requirement):** first bucket ("before the rise") must stay tight (the flat walk-on window), not bleed into the ramp — enforce a max-slope threshold; harness checks morning-bucket variance. First-class unit test.
- **Pinned blocks carve capacity** (overlay, not new buckets): `capacity_min = window_len − overlap(pinned) − walk-to-pinned budget`.

## Pass 1 — joint ILP (`pass1_assign.py`, OR-tools CP-SAT)

One joint model over must-dos + want-to-dos (never phased).
- **Vars:** `x[r,b] ∈ {0,1}`, ride r in bucket b, ≤1 bucket per ride.
- **Cost[r][b]** (constant): `curve[r].avg_between(b.start,b.end)` + `duration_min[r]` + flat walk buffer.
- **Capacity:** `Σ_r cost[r][b]·x[r,b] ≤ b.capacity_min`; cram scales an effective-capacity multiplier (Heavy≈full, Light leaves slack) — **not** an objective term.
- **Must-dos:** `Σ_b x[r,b] == 1` (inclusion forced, placement free). Want-to-dos: `Σ_b x[r,b] ≤ 1`.
- **Eligibility (pre-solve prune):** `thrill_level ≤ profile.thrill_tolerance` (unless must-do); `height_min_in ≤ profile.max_height_in`; `tracks_wait_time == True`.
- **Objective:** `maximize Σ_{r∈wants,b} tier_value[r]·x[r,b]`. Must-dos contribute 0. Time-as-constraint → opportunity cost = capacity shadow price.
- **Infeasible must-do set** → hand to feasibility's cut-ranking; never silently drop.

`profile.py:derive_tiers(rides, want_categories, profile)` → `{ride_id: ValueTier}`, coarse 3-tier mapping from categorical prefs × metadata × profile. Pure + unit-tested with tunable constants (exact formula is a spec open-item; keep it out of the solver).

## Pass 2 — routing + feedback (`pass2_route.py`)

Single ordered open path; buckets = precedence groups (bucket order = time order).
- **Geography:** haversine → walk-time matrix (× walk-speed factor + optional `walk_penalty_min`, default 0).
- **Within-bucket order:** flat-within-bucket justifies geography-first; tiny open-path TSP per bucket (≤~10 rides → exact/brute).
- **Direction is free:** pick orientation that minimizes the seam to the next bucket's entry.
- **Boundary swaps are paid:** cross-boundary move re-reads wait at the new time; accept only if `walk_saved > wait_added`, profile-weighted via `swap_walk_threshold_min`; enforce `fatigue_budget` (no consecutive cross-park hauls).
- **Time-aware re-pricing:** re-read `curve.wait_at(arrival)` per ride (catches rope-drop poisoning — headliner-first burns the walk-on window).
- **Feedback loop (`engine.py`):** if re-pricing/real walk overflows a bucket, kick back to Pass 1 with tightened effective capacity and re-solve; cap iterations (~3) for termination.

## Feasibility & warnings (`feasibility.py`)

Structured output, two audiences, never mixed.
- **User (actionable):** must-do overflow + `rank_mustdo_cuts()` ("cut Rise → +3 rides", from drop-one re-solves); pinned-block fragmentation (computable walk cost); low forecast confidence.
- **Engine (fix-the-algorithm):** empty/overloaded buckets; cram-invariance (Light≈Heavy); backtracking-heavy routes; high within-bucket variance.
- **Block only on catastrophic forecast confidence**; otherwise emit best-effort shape + warnings.

## Validation harness (`cron/harness/`)

Runs offline against **`df_cache.pkl` only** (no Firestore reads — CLAUDE.md cost rule). Corpus: 53 PT days (2026-05-02→06-23), 2 DLR parks, ~66 rides.
- **`simulate.py`:** walk the `DayShape` against actual waits (cumulative wait+ride+walk arrival times), sum realized preference-weighted value. Single scorer for engine + baselines.
- **Experiment A:** `PerfectForecastProvider`, simulate vs same actuals → is packing/sequencing sound given perfect knowledge? Must beat baselines.
- **Experiment B:** `ModelForecastProvider` reconstructed at gen time (e.g. 8 AM), simulate vs actuals → gate #1 graceful degradation.
- **Robustness delta** = realized(plan-on-actuals) − realized(plan-on-forecast).
- **`benchmark_set.py`:** pinned, versioned roster so regression scores compare over time. **`report.py`:** scoreboard + auto-triage of worst/disagreement cases for human review.

## Unit tests (`cron/test_day_sketch_*.py`)

- **buckets:** inflection detection; rope-drop tightness (steep ramp → tight first bucket); short-day→3; pinned carve-out arithmetic.
- **pass1:** known-optimum tiny inputs; must-do always placed; higher tier beats lower under scarcity; capacity respected; infeasible must-do set → infeasible (no silent drop); cram changes selection.
- **pass2:** cost calc; swap rule (accept iff walk_saved>wait_added, profile-weighted); direction-free seam min; fatigue cap; re-pricing raises later waits.
- **geography:** haversine symmetry + known-distance sanity.
- **forecast:** slot alignment to 34-grid; `avg_between`/`wait_at`; ModelForecastProvider emits 34 slots for a known ride (uses repo `models/`).
- **feasibility:** overflow-ranking shape; audience separation; catastrophic confidence → block.

## Build & verification sequence

1. `types.py`, `metadata.py`, `geography.py` + tests (pure).
2. `forecast/inference.py` — extract pure core; refactor `predict.py` to import it; dry-import regression check.
3. `forecast/provider.py` + `perfect.py` + `model.py` + tests vs `df_cache.pkl`.
4. `buckets.py` + `profile.py` + tests.
5. `pass1_assign.py` (add `ortools` to `cron/requirements.txt` + `cron/Dockerfile`) + tests.
6. `pass2_route.py` + tests.
7. `engine.py` (feedback loop) + `feasibility.py` + tests.
8. `harness/*` — Experiment A end-to-end on a few days, confirm it beats baselines; then Experiment B + robustness delta.
9. Pin benchmark set; wire auto-triage.

**Whole-system verification:** `pytest cron/` for units; `PYTHONPATH=cron .venv/bin/python -m harness.run_experiment --experiment A` then `--experiment B` (reads only `df_cache.pkl`). Success = A beats naive baselines on realized value across benchmark days; B degrades gracefully (bounded robustness delta) rather than catastrophically.

## Risks & gotchas

- **OR-tools install on this corporate Mac** (Jamf/CrowdStrike/Zscaler): not in `.venv`; large wheels + Zscaler TLS interception can break pip. Fallback: `--trusted-host` / cert config, or `pywraplp` linear solver. Pin version in `requirements.txt` + Dockerfile for Cloud Run parity.
- **Stale-import trap:** `inference.py` is imported by both predict.py and (during EDA) the notebook — edit without kernel restart → phantom skew. Note in docstring; harness runs as a script, not notebook.
- **Ride-universe mismatch:** `feature_categories.json` has 66 ride cats; `ride_metadata.json` has 59; df_cache has 66. A ride outside the model's categories predicts as unknown-category — reconcile explicitly and warn.
- **Bucket-average validity:** rep-wait=avg holds only if buckets are low-variation; a failed variance check is a bucketing bug (Audience-2 warning), not a silent assumption.
- **Closures deferred from capacity (agreed):** closure profiles already inflate the forecast curve via closure features — carving capacity too would double-count. Defer; revisit only if the harness shows closure-day degradation.
- **Sparse Perfect curves:** thin-coverage days/rides must be filled deterministically or dropped, or Experiment A gets noisy.

## Files to create / modify + reuse anchors

- **Create:** everything under `cron/day_sketch/` and `cron/harness/`, plus `cron/test_day_sketch_*.py`.
- **Modify:** `cron/predict.py` (import pure core from `forecast/inference.py`); `cron/requirements.txt` + `cron/Dockerfile` (add `ortools`).
- **Reuse (do not reinvent):** `predict.py:_build_full_day` (extract), `_load_models` (pattern); `day_type.py:holiday_features`; `closure_features.py:{slot_closure_context, empty_closure_context, CLOSURE_FEATURE_COLS}`; `FULL_DAY_SLOTS`/`DAY_PROFILE_FEATURE_COLS`; `ride_metadata.json` (universe/coords/thrill/height/duration); `df_cache.pkl` (backtest corpus); existing `cron/test_*.py` conventions.
