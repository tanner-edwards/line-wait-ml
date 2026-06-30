"""Closure feature engineering — identical logic at training time and inference time.

Four new features tell the day-profile model what kind of day it is for this ride:

  had_closure_today            bool   — did this ride close earlier today (before this slot)?
  max_closure_duration_today_min float — longest closure today so far (0.0 if none)
  hours_since_reopen           float  — hours since most recent closure ended (0.0 if none)
  closure_start_hour           float  — PT hour the most recent closure started (-1.0 if none)

All features are computed "as of" a specific time slot — earlier slots see fewer closures
than later ones on the same day, which is what the model needs to learn.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRAINING TIME (in the notebook):

    import sys; sys.path.insert(0, 'cron')
    from closure_features import CLOSURE_FEATURE_COLS, add_closure_features

    # After loading your wait_times DataFrame:
    df = add_closure_features(df)

    # Then include CLOSURE_FEATURE_COLS in your day-profile feature set:
    DAY_PROFILE_COLS = [
        "ride_id_cat",
        "hour_of_day", "day_of_week", "month",
        "is_holiday", "is_holiday_weekend",
        "days_until_next_holiday", "days_since_last_holiday",
    ] + CLOSURE_FEATURE_COLS

    # Train day_profile model using DAY_PROFILE_COLS, then export as usual.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INFERENCE TIME (predict.py):

    from closure_features import slot_closure_context

    # Build per-slot context from today's completed closures for a ride:
    context = slot_closure_context(closures_for_ride, slot_start_min)
    # context is a dict ready to merge into the feature row for that slot.
"""

from __future__ import annotations

import pandas as pd
import numpy as np
from zoneinfo import ZoneInfo

LA_TZ = ZoneInfo("America/Los_Angeles")

CLOSURE_FEATURE_COLS = [
    "had_closure_today",
    "max_closure_duration_today_min",
    "hours_since_reopen",
    "closure_start_hour",
]


def empty_closure_context() -> dict:
    """Feature values for a ride/slot with no closure earlier today."""
    return {
        "had_closure_today": False,
        "max_closure_duration_today_min": 0.0,
        "hours_since_reopen": 0.0,
        "closure_start_hour": -1.0,
    }


def slot_closure_context(closures: list[dict], slot_start_min: int) -> dict:
    """Compute closure features for one time slot at inference time.

    Args:
        closures: list of completed closures today for this ride, each a dict:
                  { closed_at_min: int,    # minutes since midnight PT
                    reopened_at_min: int,  # minutes since midnight PT
                    duration_min: float }
        slot_start_min: start of this time slot in minutes since midnight PT
                        (e.g. 14 * 60 = 840 for 2:00 PM)

    Returns dict of the 4 closure feature values as of this slot's start time.
    """
    # Only closures that fully completed before this slot started
    prior = [c for c in closures if c["reopened_at_min"] <= slot_start_min]

    if not prior:
        return empty_closure_context()

    max_duration = max(c["duration_min"] for c in prior)
    most_recent = max(prior, key=lambda c: c["reopened_at_min"])
    hours_since = (slot_start_min - most_recent["reopened_at_min"]) / 60.0
    start_hour = most_recent["closed_at_min"] / 60.0  # fractional hour

    return {
        "had_closure_today": True,
        "max_closure_duration_today_min": float(max_duration),
        "hours_since_reopen": float(hours_since),
        "closure_start_hour": float(start_hour),
    }


# ── Training-time feature engineering ────────────────────────────────────────

def add_closure_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add the four closure feature columns to a wait_times DataFrame.

    For each row, computes closure context as of that row's timestamp — i.e.,
    only closures that ENDED before that row's time count toward the features.

    Input df must have:
        ride_id         (str)
        timestamp_utc   (datetime64[ns, UTC] or timezone-aware)
        status          (str: 'OPERATING', 'DOWN', etc.)

    Adds columns: had_closure_today, max_closure_duration_today_min,
                  hours_since_reopen, closure_start_hour
    """
    # Build a minimal work frame — never copy the full df (it's large by training time).
    ts = pd.to_datetime(df["timestamp_utc"], utc=True)
    ts_pt = ts.dt.tz_convert("America/Los_Angeles")   # string tz → fast C-level path

    # dt.floor("D") stays as native pandas Timestamp — no Python object allocation.
    work = pd.DataFrame(
        {"ride_id": df["ride_id"].values,
         "status": df["status"].values,
         "_ts": ts.values,
         "_date_pt": ts_pt.dt.floor("D").values,
         "_min_of_day": (ts_pt.dt.hour * 60 + ts_pt.dt.minute).astype("float64").values},
        index=df.index,
    ).sort_values(["ride_id", "_date_pt", "_ts"])

    # Group key as int64 codes — avoids per-row string allocation.
    ride_codes = pd.Categorical(work["ride_id"]).codes.astype("int64")
    date_codes = pd.Categorical(work["_date_pt"]).codes.astype("int64")
    grp_code = pd.Series(ride_codes * 100_000 + date_codes, index=work.index)

    status_change = (work["status"] != work["status"].shift(1)) | (grp_code != grp_code.shift(1))
    work["_run_id"] = status_change.cumsum()

    runs = work.groupby("_run_id", sort=False).agg(
        ride_id=("ride_id", "first"),
        _date_pt=("_date_pt", "first"),
        status=("status", "first"),
        start_min=("_min_of_day", "first"),
    )

    prev = runs.shift(1)
    mask = (
        (runs["status"] == "OPERATING")
        & (prev["status"] == "DOWN")
        & (runs["ride_id"] == prev["ride_id"])
        & (runs["_date_pt"] == prev["_date_pt"])
    )
    raw = runs[mask].copy()
    raw["closed_at_min"] = prev.loc[mask, "start_min"].values
    raw["reopened_at_min"] = raw["start_min"]
    raw["duration_min"] = raw["reopened_at_min"] - raw["closed_at_min"]

    # Default output columns on the original df.
    df = df.copy()
    df["had_closure_today"] = False
    df["max_closure_duration_today_min"] = 0.0
    df["hours_since_reopen"] = 0.0
    df["closure_start_hour"] = -1.0

    # Keep 0 < duration <= 360; drop overnight spans (> 360). Matches the
    # canonical rule in build_closure_profiles.py and slot_closure_context callers.
    valid = raw[raw["duration_min"].between(0, 360, inclusive="right")]
    if valid.empty:
        return df

    # Step 2: broadcast each closure onto its rows, then propagate within the day.
    #
    # `valid` is indexed by the OPERATING run that follows a DOWN run. Map its
    # closure values onto every row in that reopen-run (they all sit at/after the
    # reopen, so the values apply directly). Rows of any later run in the same day
    # inherit the most-recent closure via a within-day forward-fill; the longest
    # closure so far comes from a within-day cumulative max. No merge_asof — its
    # global-sort requirement breaks here because `_min_of_day` resets each day.
    work["_reopen_min"] = work["_run_id"].map(valid["reopened_at_min"])
    work["_closed_min"] = work["_run_id"].map(valid["closed_at_min"])
    work["_dur"] = work["_run_id"].map(valid["duration_min"])

    g = work.groupby([work["ride_id"], work["_date_pt"]], sort=False)
    work["_reopen_ff"] = g["_reopen_min"].ffill()
    work["_closed_ff"] = g["_closed_min"].ffill()
    # cummax leaves NaN where _dur is NaN (e.g. during a later DOWN run), so it
    # would lose the running max through gaps — ffill carries it forward.
    work["_dur_cummax"] = g["_dur"].cummax()
    work["_dur_cummax"] = work.groupby(
        [work["ride_id"], work["_date_pt"]], sort=False
    )["_dur_cummax"].ffill()

    had = work["_reopen_ff"].notna()
    if had.any():
        idx = work.index[had]
        df.loc[idx, "had_closure_today"] = True
        df.loc[idx, "max_closure_duration_today_min"] = work.loc[had, "_dur_cummax"].values
        df.loc[idx, "hours_since_reopen"] = (
            (work.loc[had, "_min_of_day"] - work.loc[had, "_reopen_ff"]) / 60.0
        ).values
        df.loc[idx, "closure_start_hour"] = (work.loc[had, "_closed_ff"] / 60.0).values

    return df
