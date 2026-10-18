"""Model evaluation package (not shipped in the Cloud Run image).

    import sys; sys.path.insert(0, '.')
    from ml import evaluate
    res = evaluate.run(df_sorted, RIDE_ID_CATEGORIES, STATUS_CATEGORIES, label='baseline')
"""

from .baselines import lookup_delta, lookup_level, persistence, ride_mean
from .deployed import contaminated, load_booster, load_categories, predict_with_booster
from .evaluate import HORIZONS, EvalResults, run, score_deployed, staleness
from .metrics import big_move_mae, breakdown, mae, paired_daily, trend_class, trend_confusion
from .recipes import (
    DAY_PROFILE_FEATURE_COLS,
    RECIPE_A,
    RECIPE_B,
    Recipe,
    TRAJECTORY_FEATURE_COLS,
    add_categoricals,
    predict_day_profile,
    predict_trajectory,
    train_day_profile,
    train_trajectory,
    with_,
)
from .report import render, write
from .splits import day_type, forward_split, interleaved_split, wait_band
