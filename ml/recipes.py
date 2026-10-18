"""Training recipes. A `Recipe` is everything that decides how the models are fit:
LightGBM params, trajectory target ('level' or 'delta'), and both feature lists.

RECIPE_A is the notebook's training through Session 3, reproduced exactly (a
test pins its feature lists to cron/predict.py's). RECIPE_B is the Session 4
winner by the revised decision rules (reports/eval/2026-10-18_session4-recipes.md):
trajectory = arm B3 (delta target, no week_of_year, + minutes_until_close,
600 trees x 63 leaves; keeping week_of_year, arm B4, lost at T+30 and was
noise elsewhere); day-profile = arm D1 (600 x 63, A's 17 features incl.
week_of_year, which beat dropping it by 0.20 MAE on 26 of 28 days).

    from ml.recipes import RECIPE_B, train_trajectory, predict_trajectory
    model = train_trajectory(df, train_mask, 60, RIDE_ID_CATEGORIES, STATUS_CATEGORIES, recipe=RECIPE_B)
    pred = predict_trajectory(model, df, 60)   # always a level in minutes, delta or not
"""

from __future__ import annotations

import dataclasses
import sys
from dataclasses import dataclass
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
    "temp_high_f", "crowd_level_ratio",
    "is_holiday", "is_holiday_weekend",
    "days_until_next_holiday", "days_since_last_holiday",
    "minutes_until_close", "total_operating_hours",
] + CLOSURE_FEATURE_COLS



@dataclass(frozen=True)
class Recipe:
    """How the trajectory and day-profile models are trained.

    trajectory_target 'delta' fits target_tN - wait_minutes; predict_trajectory
    adds wait_minutes back (clipped at 0), so callers always see a level.
    """

    name: str
    trajectory_params: dict
    day_profile_params: dict
    trajectory_target: str  # 'level' | 'delta'
    trajectory_features: tuple[str, ...]
    day_profile_features: tuple[str, ...]

    def __post_init__(self):
        if self.trajectory_target not in ("level", "delta"):
            raise ValueError(f"trajectory_target must be 'level' or 'delta', got {self.trajectory_target!r}")
        object.__setattr__(self, "trajectory_features", tuple(self.trajectory_features))
        object.__setattr__(self, "day_profile_features", tuple(self.day_profile_features))


def with_(recipe: Recipe, **changes) -> Recipe:
    """Copy of `recipe` with fields replaced (experiment arms)."""
    return dataclasses.replace(recipe, **changes)


RECIPE_A = Recipe(
    "A",
    dict(n_estimators=200, learning_rate=0.05, objective="regression_l1", verbose=-1),
    dict(n_estimators=300, learning_rate=0.05, objective="regression_l1", verbose=-1),
    "level",
    tuple(TRAJECTORY_FEATURE_COLS),
    tuple(DAY_PROFILE_FEATURE_COLS),
)

RECIPE_B = Recipe(
    "B",
    dict(n_estimators=600, num_leaves=63, learning_rate=0.05, objective="regression_l1", verbose=-1),
    dict(n_estimators=600, num_leaves=63, learning_rate=0.05, objective="regression_l1", verbose=-1),
    "delta",
    tuple(c for c in TRAJECTORY_FEATURE_COLS if c != "week_of_year") + ("minutes_until_close",),
    tuple(DAY_PROFILE_FEATURE_COLS),
)

RECIPES = {"A": RECIPE_A, "B": RECIPE_B}

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
    ride_cats: list, status_cats: list, params: dict | None = None, recipe: Recipe | None = None,
) -> lgb.LGBMRegressor:
    """Fit on train_mask & training_valid_tN.

    Target is target_tN ('level') or target_tN - wait_minutes ('delta').
    `recipe` wins over `params`; `params` alone means Recipe A with those params.
    """
    if recipe is None:
        recipe = RECIPE_A if params is None else with_(RECIPE_A, trajectory_params=dict(params))
    cols = list(recipe.trajectory_features)
    rows = train_mask & df[f"training_valid_t{horizon}"]
    X = _features(df, rows, cols, ride_cats, status_cats)
    y = df.loc[rows, f"target_t{horizon}"]
    if recipe.trajectory_target == "delta":
        y = y - df.loc[rows, "wait_minutes"]
    cat_features = [c for c in ("ride_id_cat", "status_cat") if c in cols]
    model = lgb.LGBMRegressor(**recipe.trajectory_params)
    model.fit(X, y, categorical_feature=cat_features)
    model.ride_cats_, model.status_cats_ = list(ride_cats), list(status_cats)
    model.recipe_, model.trajectory_cols_ = recipe, cols
    return model


def train_day_profile(
    df: pd.DataFrame, train_mask: pd.Series, ride_cats: list, params: dict | None = None,
    feature_cols: list[str] | None = None, recipe: Recipe | None = None,
) -> lgb.LGBMRegressor:
    """Fit on train_mask & wait_minutes.notna(), target wait_minutes.

    `recipe` supplies params and features and wins over the kwargs. Without it,
    params / feature_cols override Recipe A's (experiment knobs, e.g. a feature
    dropped); predict_day_profile uses whatever the model was fit on.
    """
    if recipe is not None:
        params, feature_cols = recipe.day_profile_params, recipe.day_profile_features
    cols = list(feature_cols or DAY_PROFILE_FEATURE_COLS)
    rows = train_mask & df["wait_minutes"].notna()
    X = _features(df, rows, cols, ride_cats, [])
    model = lgb.LGBMRegressor(**(params or RECIPE_A.day_profile_params))
    model.fit(X, df.loc[rows, "wait_minutes"], categorical_feature=["ride_id_cat"])
    model.ride_cats_, model.status_cats_ = list(ride_cats), []
    model.day_profile_cols_ = cols
    return model


def predict_trajectory(model: lgb.LGBMRegressor, df: pd.DataFrame, horizon: int) -> pd.Series:
    """Level predictions aligned to df.index; NaN outside training_valid_tN.

    A delta model's output is added to wait_minutes and clipped at 0.
    """
    rows = df[f"training_valid_t{horizon}"].astype(bool)
    out = pd.Series(float("nan"), index=df.index, name=f"recipe_t{horizon}")
    if rows.any():
        cols = getattr(model, "trajectory_cols_", TRAJECTORY_FEATURE_COLS)
        X = _features(df, rows, cols, model.ride_cats_, model.status_cats_)
        raw = model.predict(X)
        recipe = getattr(model, "recipe_", RECIPE_A)
        if recipe.trajectory_target == "delta":
            raw = (df.loc[rows, "wait_minutes"].to_numpy(dtype=float) + raw).clip(min=0)
        out[rows] = raw
    return out


def predict_day_profile(model: lgb.LGBMRegressor, df: pd.DataFrame) -> pd.Series:
    """Predictions for every row of df."""
    cols = getattr(model, "day_profile_cols_", DAY_PROFILE_FEATURE_COLS)
    X = _features(df, None, cols, model.ride_cats_, [])
    return pd.Series(model.predict(X), index=df.index, name="recipe_day_profile")
