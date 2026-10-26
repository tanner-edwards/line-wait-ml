"""Session 6 candidate features on the notebook's feature frame.

Derived in-process from columns the frame already has (`raw`, `status`,
`timestamp_utc`, `park_id`, the lags, `temp_high_f`) and ride_metadata.json,
with the shared derivations in cron/ride_features.py so serving computes the
same values.

    from ml.features import add_session6_features, fit_sidecars
    df_sorted = add_session6_features(df_sorted)            # notebook: sidecars fit on every row
    heads, tiers = fit_sidecars(df_sorted, train_mask)     # experiments: train rows only
    df_sorted = add_session6_features(df_sorted, heads, tiers)

Recipe C (Session 6) reads only ll_offset_min / ll_state_cat, which need
nothing but `raw` and `timestamp_utc`; the other columns are added anyway.

Columns added:
  n_operating_rides_park, n_headliners_down     F1, per (park_id, timestamp_utc) poll
  last_updated_age_min, posting_tier_cat        F2
  ll_offset_min, ll_state_cat                   F3
  wait_lag_{1,2,3}_f, wait_delta_1_f,           F4: lags filled with the current wait on
  lags_missing, training_valid_tN_f             OPERATING rows with a null lag; the _f
                                                mask adds those rows (with a target)
  water_ride, water_ride_x_temp,                F5 (day-profile)
  soak_ride, soak_ride_x_temp

The original lag and training_valid_tN columns are left untouched so the
headline comparison stays on the same rows as every earlier report.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from . import recipes  # noqa: F401  (puts cron/ on sys.path)

import ride_features as rf  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
METADATA = REPO / "ride_metadata.json"
SOAK_RIDE_NAMES = ("Grizzly River Run", "Tiana's Bayou Adventure", "Pirates of the Caribbean")
F4_SUFFIX = "_f"

NEW_COLUMNS = [
    "n_operating_rides_park", "n_headliners_down",
    "last_updated_age_min", "posting_tier_cat",
    "ll_offset_min", "ll_state_cat",
    "lags_missing",
    "water_ride", "water_ride_x_temp", "soak_ride", "soak_ride_x_temp",
]


def _horizons(df: pd.DataFrame) -> list[int]:
    return sorted(int(c.rsplit("_t", 1)[1]) for c in df.columns
                  if c.startswith("training_valid_t") and c[len("training_valid_t"):].isdigit())


def last_updated(df: pd.DataFrame) -> pd.Series:
    return df["raw"].map(lambda r: r.get("lastUpdated") if isinstance(r, dict) else None)


def ages(df: pd.DataFrame) -> pd.Series:
    """last_updated_age_min for every row (NaN when missing)."""
    if "last_updated_age_min" in df.columns:
        return df["last_updated_age_min"]
    return rf.last_updated_age_frame(last_updated(df), df["timestamp_utc"])


def fit_sidecars(df: pd.DataFrame, mask: pd.Series | None = None) -> tuple[list[str], dict]:
    """(headliners, posting_tiers) fit on the rows of `mask` (every row when None)."""
    sub = df if mask is None else df.loc[mask.astype(bool)]
    data = rf.sidecar_data(sub.assign(last_updated_age_min=ages(sub)))
    return data[rf.HEADLINERS_FILE], data[rf.POSTING_TIERS_FILE]


def ride_flags(metadata_path=METADATA) -> tuple[set[str], set[str]]:
    """(water ride_ids, soak ride_ids) from ride_metadata.json (ride_id = themeparks_id)."""
    meta = json.loads(Path(metadata_path).read_text())
    water = {str(v["themeparks_id"]) for v in meta.values() if v.get("water_ride") and v.get("themeparks_id")}
    soak = {str(v["themeparks_id"]) for v in meta.values() if v.get("name") in SOAK_RIDE_NAMES}
    return water, soak


def add_session6_features(df: pd.DataFrame, headliners: list[str] | None = None, tiers: dict | None = None,
                          metadata_path=METADATA) -> pd.DataFrame:
    """Shallow copy of df with the Session 6 columns (see module docstring).

    headliners / tiers default to fit_sidecars on every row of df (what an
    export would ship); experiments pass the train-row fit to avoid leakage."""
    out = df.copy(deep=False)
    if headliners is None or tiers is None:
        fit_heads, fit_tiers = fit_sidecars(out)
        headliners = fit_heads if headliners is None else headliners
        tiers = fit_tiers if tiers is None else tiers

    counts = rf.operating_counts_frame(out, headliners)
    out["n_operating_rides_park"] = counts["n_operating_rides_park"].astype(float)
    out["n_headliners_down"] = counts["n_headliners_down"].astype(float)

    out["last_updated_age_min"] = ages(out).to_numpy()
    out["posting_tier_cat"] = pd.Categorical(out["ride_id"].map(tiers), categories=rf.POSTING_TIERS)

    queues = out["raw"].map(lambda r: r.get("queue") if isinstance(r, dict) else None)
    ll = [rf.ll_fields(q, t) for q, t in zip(queues, out["timestamp_utc"])]
    out["ll_offset_min"] = np.array([np.nan if o is None else o for o, _ in ll], dtype=float)
    out["ll_state_cat"] = pd.Categorical([s for _, s in ll], categories=rf.LL_STATES)

    lag_cols = rf.LAG_COLS + ["wait_delta_1"]
    filled = rf.fill_missing_lags(out[["status", "wait_minutes"] + lag_cols])
    for c in lag_cols:
        out[f"{c}{F4_SUFFIX}"] = filled[c].to_numpy()
    out["lags_missing"] = filled["lags_missing"].to_numpy()
    reopen = out["lags_missing"].astype(bool)
    for h in _horizons(out):
        target_ok = out[f"valid_t{h}"].astype(bool) if f"valid_t{h}" in out.columns else out[f"target_t{h}"].notna()
        out[f"training_valid_t{h}{F4_SUFFIX}"] = (
            out[f"training_valid_t{h}"].astype(bool) | (reopen & target_ok & out[f"target_t{h}"].notna()))

    water, soak = ride_flags(metadata_path)
    temp = out["temp_high_f"].astype(float)
    out["water_ride"] = out["ride_id"].isin(water).astype(int)
    out["water_ride_x_temp"] = out["water_ride"] * temp
    out["soak_ride"] = out["ride_id"].isin(soak).astype(int)
    out["soak_ride_x_temp"] = out["soak_ride"] * temp
    return out


def coverage(df: pd.DataFrame, rows: pd.Series) -> pd.DataFrame:
    """Per new column on `rows`: non-null share, share != 0 / != NONE, and a
    one-line distribution (the 2026-09-26 method note: coverage before results)."""
    sub = df.loc[rows.astype(bool)]
    out = []
    for c in NEW_COLUMNS:
        s = sub[c]
        if isinstance(s.dtype, pd.CategoricalDtype):
            vc = s.value_counts(normalize=True, dropna=False)
            dist = ", ".join(f"{k}: {v:.1%}" for k, v in vc.items())
            informative = float((s.notna() & (s.astype(object) != "NONE")).mean())
        else:
            x = s.astype(float)
            dist = (f"p10 {x.quantile(.1):.1f}, median {x.median():.1f}, p90 {x.quantile(.9):.1f}"
                    if x.notna().any() else "")
            informative = float((x.notna() & (x != 0)).mean())
        out.append({"column": c, "n_rows": int(len(s)), "non_null": float(s.notna().mean()),
                     "informative": informative, "distribution": dist})
    return pd.DataFrame(out).set_index("column")
