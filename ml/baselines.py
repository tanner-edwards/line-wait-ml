"""Honest baselines every model is scored against, on the same rows.

Trajectory (predicting the wait N minutes from now):
  persistence   — "the wait will be what it is now."
  lookup_delta  — current wait + the typical N-minute change for this ride,
                  hour, and day type, learned from train days only.

Day-profile (predicting the wait at a time of day):
  ride_mean     — the ride's average train wait (the notebook's old baseline).
  lookup_level  — the ride's median train wait for this hour and day type.

Group medians fall back (ride, hour, day_type) -> (ride, hour) -> (ride) ->
global, so every row with a wait gets a prediction.
"""

from __future__ import annotations

import pandas as pd

from .splits import day_type

FALLBACK_KEYS = [
    ["ride_id", "hour_of_day", "day_type"],
    ["ride_id", "hour_of_day"],
    ["ride_id"],
]


def _keys_frame(df: pd.DataFrame) -> pd.DataFrame:
    keys = df[["ride_id", "hour_of_day"]].copy()
    keys["day_type"] = day_type(df)
    return keys


def _fallback_median(df: pd.DataFrame, fit_rows: pd.Series, value: pd.Series, global_value: float) -> pd.Series:
    """Median of `value` over fit_rows per group, joined back onto every row of df,
    walking FALLBACK_KEYS until a group has data, then `global_value`."""
    keys = _keys_frame(df)
    fit = keys[fit_rows].assign(_v=value[fit_rows])
    out = pd.Series(float("nan"), index=df.index)
    for cols in FALLBACK_KEYS:
        med = fit.groupby(cols, observed=True)["_v"].median().rename("_m").reset_index()
        joined = keys[cols].merge(med, on=cols, how="left")["_m"]
        out = out.combine_first(pd.Series(joined.to_numpy(), index=df.index))
    return out.fillna(global_value)


def persistence(df: pd.DataFrame, horizon: int) -> pd.Series:
    """Prediction = current wait, for any horizon."""
    return df["wait_minutes"].rename(f"persistence_t{horizon}")


def lookup_delta(df: pd.DataFrame, train_mask: pd.Series, horizon: int) -> pd.Series:
    """Current wait + median (target - wait) by (ride, hour, day_type) on train rows."""
    fit_rows = train_mask & df[f"training_valid_t{horizon}"]
    delta = df[f"target_t{horizon}"] - df["wait_minutes"]
    typical = _fallback_median(df, fit_rows, delta, global_value=0.0)
    return (df["wait_minutes"] + typical).rename(f"lookup_delta_t{horizon}")


def ride_mean(df: pd.DataFrame, train_mask: pd.Series) -> pd.Series:
    """Per-ride mean train wait; global train mean for rides with no train rows."""
    fit_rows = train_mask & df["wait_minutes"].notna()
    means = df.loc[fit_rows].groupby("ride_id")["wait_minutes"].mean()
    global_mean = df.loc[fit_rows, "wait_minutes"].mean()
    return df["ride_id"].map(means).astype(float).fillna(global_mean).rename("ride_mean")


def lookup_level(df: pd.DataFrame, train_mask: pd.Series) -> pd.Series:
    """Median train wait by (ride, hour, day_type) with fallbacks; global median last."""
    fit_rows = train_mask & df["wait_minutes"].notna()
    global_median = df.loc[fit_rows, "wait_minutes"].median()
    return _fallback_median(df, fit_rows, df["wait_minutes"], global_median).rename("lookup_level")
