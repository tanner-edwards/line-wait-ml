"""Recipe A: today's notebook training, reproduced exactly.

Same feature lists as cron/predict.py (a test enforces parity), same
categorical handling, same LGBMRegressor parameters. A later session passes a
different `params` dict to compare recipes; nothing else is configurable here
on purpose.

    from ml.recipes import train_trajectory, predict_trajectory
    model = train_trajectory(df, train_mask, 60, RIDE_ID_CATEGORIES, STATUS_CATEGORIES)
    pred = predict_trajectory(model, df, 60)
"""

from __future__ import annotations

import sys
from pathlib import Path

import lightgbm as lgb
import pandas as pd

CRON_DIR = Path(__file__).resolve().parents[1] / "cron"
if str(CRON_DIR) not in sys.path:
    sys.path.insert(0, str(CRON_DIR))
from closure_features import CLOSURE_FEATURE_COLS  # noqa: E402

TRAJECTORY_FEATURE_COLS = [
    "wait_minutes", "wait_lag_1", "wait_lag_2", "wait_lag_3", "wait_delta_1",
    "park_crowd_median",
    "hour_of_day", "day_of_week", "week_of_year", "month",
    "is_holiday", "is_holiday_weekend",
    "days_until_next_holiday", "days_since_last_holiday",
    "minutes_since_last_status_change", "closure_duration_minutes",
    "minutes_at_current_level", "wait_regime_danger_zone",
    "crowd_level_ratio",
    "ride_id_cat", "status_cat",
]

DAY_PROFILE_FEATURE_COLS = [
    "ride_id_cat",
    "hour_of_day", "day_of_week", "week_of_year", "month",
    "temp_high_f", "morning_crowd_index", "crowd_level_ratio",
    "is_holiday", "is_holiday_weekend",
    "days_until_next_holiday", "days_since_last_holiday",
    "minutes_until_close", "total_operating_hours",
] + CLOSURE_FEATURE_COLS

RECIPE_A = dict(
    trajectory=dict(n_estimators=200, learning_rate=0.05, objective="regression_l1", verbose=-1),
    day_profile=dict(n_estimators=300, learning_rate=0.05, objective="regression_l1", verbose=-1),
)

CAT_COLS = {"ride_id_cat": "ride_id", "status_cat": "status"}


def predict_feature_cols() -> tuple[list[str], list[str]]:
    """(TRAJECTORY_FEATURE_COLS, DAY_PROFILE_FEATURE_COLS) as cron/predict.py declares them."""
    import predict  # cron/ is on sys.path; importing does not touch Firestore

    return predict.TRAJECTORY_FEATURE_COLS, predict.DAY_PROFILE_FEATURE_COLS


def add_categoricals(df: pd.DataFrame, ride_cats: list, status_cats: list) -> pd.DataFrame:
    """Copy of df with ride_id_cat / status_cat built the way the notebook builds them.

    Values outside the category list (e.g. a ride newer than the categories)
    become NaN, which is what pd.Categorical does today; nulling them first
    avoids the pandas 4 deprecation of that implicit behavior.
    """
    out = df.copy()
    out["ride_id_cat"] = _categorical(out["ride_id"], ride_cats)
    if "status" in out.columns:
        out["status_cat"] = _categorical(out["status"], status_cats)
    return out


def _categorical(values: pd.Series, categories: list) -> pd.Categorical:
    return pd.Categorical(values.where(values.isin(categories)), categories=categories)


def _features(df: pd.DataFrame, rows: pd.Series | None, cols: list[str], ride_cats: list, status_cats: list) -> pd.DataFrame:
    """Feature matrix for `rows` only (avoids copying the whole frame)."""
    raw = [c for c in cols if c not in CAT_COLS] + [src for c, src in CAT_COLS.items() if c in cols]
    sub = df.loc[rows, raw] if rows is not None else df[raw]
    return add_categoricals(sub, ride_cats, status_cats)[cols]


def train_trajectory(
    df: pd.DataFrame, train_mask: pd.Series, horizon: int,
    ride_cats: list, status_cats: list, params: dict | None = None,
) -> lgb.LGBMRegressor:
    """Fit on train_mask & training_valid_tN, target target_tN."""
    rows = train_mask & df[f"training_valid_t{horizon}"]
    X = _features(df, rows, TRAJECTORY_FEATURE_COLS, ride_cats, status_cats)
    model = lgb.LGBMRegressor(**(params or RECIPE_A["trajectory"]))
    model.fit(X, df.loc[rows, f"target_t{horizon}"], categorical_feature=["ride_id_cat", "status_cat"])
    model.ride_cats_, model.status_cats_ = list(ride_cats), list(status_cats)
    return model


def train_day_profile(
    df: pd.DataFrame, train_mask: pd.Series, ride_cats: list, params: dict | None = None,
) -> lgb.LGBMRegressor:
    """Fit on train_mask & wait_minutes.notna(), target wait_minutes."""
    rows = train_mask & df["wait_minutes"].notna()
    X = _features(df, rows, DAY_PROFILE_FEATURE_COLS, ride_cats, [])
    model = lgb.LGBMRegressor(**(params or RECIPE_A["day_profile"]))
    model.fit(X, df.loc[rows, "wait_minutes"], categorical_feature=["ride_id_cat"])
    model.ride_cats_, model.status_cats_ = list(ride_cats), []
    return model


def predict_trajectory(model: lgb.LGBMRegressor, df: pd.DataFrame, horizon: int) -> pd.Series:
    """Predictions aligned to df.index; NaN outside training_valid_tN."""
    rows = df[f"training_valid_t{horizon}"].astype(bool)
    out = pd.Series(float("nan"), index=df.index, name=f"recipe_t{horizon}")
    if rows.any():
        X = _features(df, rows, TRAJECTORY_FEATURE_COLS, model.ride_cats_, model.status_cats_)
        out[rows] = model.predict(X)
    return out


def predict_day_profile(model: lgb.LGBMRegressor, df: pd.DataFrame) -> pd.Series:
    """Predictions for every row of df."""
    X = _features(df, None, DAY_PROFILE_FEATURE_COLS, model.ride_cats_, [])
    return pd.Series(model.predict(X), index=df.index, name="recipe_day_profile")
