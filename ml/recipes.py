"""Training recipes. A `Recipe` is everything that decides how the models are fit:
LightGBM params, trajectory target ('level' or 'delta'), and both feature lists.

RECIPE_A is the notebook's training through Session 3, reproduced exactly (a
test pins its feature lists to cron/predict.py's). RECIPE_B is the Session 4
winner by the revised decision rules (reports/eval/2026-10-18_session4-recipes.md):
trajectory = arm B3 (delta target, no week_of_year, + minutes_until_close,
600 trees x 63 leaves; keeping week_of_year, arm B4, lost at T+30 and was
noise elsewhere); day-profile = arm D1 (600 x 63, A's 17 features incl.
week_of_year, which beat dropping it by 0.20 MAE on 26 of 28 days).

Session 5 adds four direction classifiers to RECIPE_B (p_fall_30, p_fall_60,
p_rise_30, p_rise_60) and the per-band thresholds that turn p_rise_30 /
p_fall_30 into the trend word (derive_trend; cron/predict.py mirrors it).
Labels, thresholds and the alert threshold come from
reports/eval/2026-10-21_session5-classifiers.md.

    from ml.recipes import RECIPE_B, train_trajectory, predict_trajectory
    model = train_trajectory(df, train_mask, 60, RIDE_ID_CATEGORIES, STATUS_CATEGORIES, recipe=RECIPE_B)
    pred = predict_trajectory(model, df, 60)   # always a level in minutes, delta or not
"""

from __future__ import annotations

import dataclasses
import math
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
    """How the trajectory, day-profile and (optionally) direction classifiers are trained.

    trajectory_target 'delta' fits target_tN - wait_minutes; predict_trajectory
    adds wait_minutes back (clipped at 0), so callers always see a level.

    classifier_labels: {"fall": spec, "rise": spec}, spec ("flat", minutes) or
    ("pct", fraction, min_current_wait); None means no classifiers (the trend
    word comes from the regression, as before Session 5). trend_thresholds:
    {band: {"call": {"rise": tau, "fall": tau}, "high": {"rise": tau, "fall": tau}}}
    for derive_trend (a None tau never fires). alert: {"field", "threshold",
    "min_current_wait"} for the backend's far-away downgrade.
    """

    name: str
    trajectory_params: dict
    day_profile_params: dict
    trajectory_target: str  # 'level' | 'delta'
    trajectory_features: tuple[str, ...]
    day_profile_features: tuple[str, ...]
    classifier_params: dict | None = None
    classifier_labels: dict | None = None
    classifier_horizons: tuple = (30, 60)
    trend_thresholds: dict | None = None
    alert: dict | None = None

    def __post_init__(self):
        if self.trajectory_target not in ("level", "delta"):
            raise ValueError(f"trajectory_target must be 'level' or 'delta', got {self.trajectory_target!r}")
        object.__setattr__(self, "trajectory_features", tuple(self.trajectory_features))
        object.__setattr__(self, "day_profile_features", tuple(self.day_profile_features))
        object.__setattr__(self, "classifier_horizons", tuple(int(h) for h in self.classifier_horizons))
        if self.classifier_labels is not None:
            # Tuples, so a manifest round-trip (JSON lists) compares equal.
            object.__setattr__(self, "classifier_labels",
                               {d: tuple(spec) for d, spec in self.classifier_labels.items()})

    @property
    def classifier_features(self) -> tuple[str, ...]:
        return self.trajectory_features

    @property
    def has_classifiers(self) -> bool:
        return bool(self.classifier_labels)

    @property
    def classifier_names(self) -> list[str]:
        if not self.has_classifiers:
            return []
        return [f"p_{d}_{h}" for d in ("fall", "rise") for h in self.classifier_horizons]


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
    # Session 5 (reports/eval/2026-10-21_session5-classifiers.md, "Decisions"):
    # flat >=5 labels (the floored percentage lost in every band it was tested);
    # call = the probability matching today's regression call rate per band,
    # high = precision 0.75 (None never fires); alert = flat5 p_rise_30 at 0.5,
    # the highest call rate with precision >= 0.60 on 15-25 and 30-60 waits.
    classifier_params=dict(n_estimators=300, num_leaves=63, learning_rate=0.05, verbose=-1),
    classifier_labels={"fall": ("flat", 5), "rise": ("flat", 5)},
    trend_thresholds={
        "<=10":  {"call": {"rise": 0.793, "fall": None},  "high": {"rise": 0.641, "fall": None}},
        "15-25": {"call": {"rise": 0.698, "fall": 0.744}, "high": {"rise": 0.592, "fall": 0.762}},
        "30-60": {"call": {"rise": 0.667, "fall": 0.605}, "high": {"rise": 0.612, "fall": 0.678}},
        ">60":   {"call": {"rise": None,  "fall": 0.594}, "high": {"rise": None,  "fall": 0.75}},
    },
    alert={"field": "p_rise_30", "threshold": 0.5, "min_current_wait": 10},
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


# ── Direction classifiers and the trend word (Session 5) ────────────────────

CLASSIFIER_NAMES = ["p_fall_30", "p_fall_60", "p_rise_30", "p_rise_60"]
DEFAULT_CLASSIFIER_PARAMS = dict(n_estimators=300, num_leaves=63, learning_rate=0.05, verbose=-1)

# Current-wait bands for the trend thresholds. Edges (-1, 10], (10, 25],
# (25, 60], (60, inf) on the walk-on-normalized wait; posted waits are
# multiples of 5, hence the names. cron/predict.py mirrors band_of.
BANDS = ["<=10", "15-25", "30-60", ">60"]
BAND_EDGES = [-1, 10, 25, 60, float("inf")]
STABLE_HIGH = 0.15    # stable + both probabilities below this -> confidence high
STABLE_MEDIUM = 0.30  # stable + both below this -> medium, else low
PEAK_TROUGH_LAG = 5   # same as the regression-derived word


def classifier_file(name: str) -> str:
    """'p_fall_30' -> 'clf_fall_30.txt'."""
    _, direction, h = name.split("_")
    return f"clf_{direction}_{h}.txt"


def band_of(current: float) -> str:
    """'<=10' | '15-25' | '30-60' | '>60' for a current wait in minutes."""
    c = float(current)
    if c <= 10:
        return "<=10"
    if c <= 25:
        return "15-25"
    if c <= 60:
        return "30-60"
    return ">60"


def change_label(change: pd.Series, current: pd.Series, direction: str, spec) -> pd.Series:
    """True where `change` (minutes, target - current) counts as a `direction` move under `spec`.

    ("flat", m): rise change >= m, fall change <= -m.
    ("pct", f, floor): current >= floor and the move in that direction >= f * current.
    NaN anywhere -> False.
    """
    if direction not in ("rise", "fall"):
        raise ValueError(f"direction must be 'rise' or 'fall', got {direction!r}")
    move = change if direction == "rise" else -change
    kind = spec[0]
    if kind == "flat":
        out = move >= float(spec[1])
    elif kind == "pct":
        frac, floor = float(spec[1]), float(spec[2])
        out = (current >= floor) & (move >= frac * current)
    else:
        raise ValueError(f"unknown label kind {kind!r}")
    return out.fillna(False).astype(bool)


def classifier_label(df: pd.DataFrame, horizon: int, direction: str, spec) -> pd.Series:
    """The classifier target on every row of df: change_label(target_tN - wait_minutes)."""
    wait = df["wait_minutes"]
    return change_label(df[f"target_t{horizon}"] - wait, wait, direction, spec)


def train_classifier(
    df: pd.DataFrame, train_mask: pd.Series, horizon: int, direction: str,
    ride_cats: list, status_cats: list, recipe: Recipe,
) -> lgb.LGBMClassifier:
    """Fit P(direction move by T+horizon) on train_mask & training_valid_tN with the
    recipe's label for that direction and its classifier features."""
    if not recipe.has_classifiers:
        raise ValueError(f"recipe {recipe.name!r} has no classifier_labels")
    spec = recipe.classifier_labels[direction]
    cols = list(recipe.classifier_features)
    rows = (train_mask & df[f"training_valid_t{horizon}"]).astype(bool)
    X = _features(df, rows, cols, ride_cats, status_cats)
    y = classifier_label(df, horizon, direction, spec)[rows].astype(int)
    cat_features = [c for c in ("ride_id_cat", "status_cat") if c in cols]
    model = lgb.LGBMClassifier(**(recipe.classifier_params or DEFAULT_CLASSIFIER_PARAMS))
    model.fit(X, y, categorical_feature=cat_features)
    model.ride_cats_, model.status_cats_ = list(ride_cats), list(status_cats)
    model.recipe_, model.classifier_cols_ = recipe, cols
    model.direction_, model.horizon_ = direction, int(horizon)
    return model


def predict_classifier(model: lgb.LGBMClassifier, df: pd.DataFrame, horizon: int) -> pd.Series:
    """P(move) aligned to df.index; NaN outside training_valid_tN."""
    rows = df[f"training_valid_t{horizon}"].astype(bool)
    out = pd.Series(float("nan"), index=df.index, name=f"p_{getattr(model, 'direction_', 'x')}_{horizon}")
    if rows.any():
        X = _features(df, rows, model.classifier_cols_, model.ride_cats_, model.status_cats_)
        out[rows] = model.predict_proba(X)[:, 1]
    return out


def _missing(v) -> bool:
    return v is None or (isinstance(v, float) and math.isnan(v))


def derive_trend(current, lag1, p_rise_30, p_fall_30, thresholds) -> tuple[str, str] | None:
    """(trend, confidence) from the T+30 probabilities, or None when anything
    needed is missing (callers then fall back to the regression-derived word).

    Band = band_of(current). Rising when p_rise_30 >= call[rise] and
    p_rise_30 > p_fall_30; falling symmetric; otherwise stable (a tie is
    stable). Rising becomes 'trough' when current - lag1 >= 5, falling becomes
    'peak' when lag1 - current >= 5, as in the regression-derived word.
    Confidence: rising/falling high when the winning probability >= high[dir],
    else medium; stable high when both < 0.15, medium when both < 0.30, else low.
    A None tau never fires. cron/predict.py's _derive_trend_from_probs mirrors this.
    """
    if thresholds is None or _missing(current) or _missing(p_rise_30) or _missing(p_fall_30):
        return None
    band = thresholds.get(band_of(current))
    if not band:
        return None
    call, high = band.get("call") or {}, band.get("high") or {}

    def reaches(p, tau):
        return tau is not None and p >= tau

    lag_ok = not _missing(lag1)
    if reaches(p_rise_30, call.get("rise")) and p_rise_30 > p_fall_30:
        trend = "trough" if lag_ok and current - lag1 >= PEAK_TROUGH_LAG else "rising"
        confidence = "high" if reaches(p_rise_30, high.get("rise")) else "medium"
    elif reaches(p_fall_30, call.get("fall")) and p_fall_30 > p_rise_30:
        trend = "peak" if lag_ok and lag1 - current >= PEAK_TROUGH_LAG else "falling"
        confidence = "high" if reaches(p_fall_30, high.get("fall")) else "medium"
    else:
        trend = "stable"
        top = max(p_rise_30, p_fall_30)
        confidence = "high" if top < STABLE_HIGH else ("medium" if top < STABLE_MEDIUM else "low")
    return trend, confidence
