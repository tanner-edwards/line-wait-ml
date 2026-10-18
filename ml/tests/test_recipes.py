import numpy as np

from ml.recipes import (
    DAY_PROFILE_FEATURE_COLS,
    TRAJECTORY_FEATURE_COLS,
    predict_day_profile,
    predict_feature_cols,
    predict_trajectory,
    train_day_profile,
    train_trajectory,
)
from ml.splits import forward_split

TINY = dict(n_estimators=5, learning_rate=0.05, objective="regression_l1", verbose=-1)


class TestFeatureParity:
    def test_trajectory_cols_match_predict(self):
        traj, _ = predict_feature_cols()
        assert TRAJECTORY_FEATURE_COLS == traj

    def test_day_profile_cols_match_predict(self):
        _, day = predict_feature_cols()
        assert DAY_PROFILE_FEATURE_COLS == day


class TestTrajectory:
    def test_predictions_nan_outside_valid_and_finite_inside(self, frame, cats):
        train, _ = forward_split(frame, weeks=2)
        model = train_trajectory(frame, train, 30, *cats, params=TINY)
        pred = predict_trajectory(model, frame, 30)
        valid = frame["training_valid_t30"]
        assert pred.index.equals(frame.index)
        assert np.isfinite(pred[valid]).all()
        assert pred[~valid].isna().all()

    def test_model_uses_feature_list_in_order(self, frame, cats):
        train, _ = forward_split(frame, weeks=2)
        model = train_trajectory(frame, train, 30, *cats, params=TINY)
        assert model.booster_.feature_name() == TRAJECTORY_FEATURE_COLS


class TestDayProfile:
    def test_predicts_every_row(self, frame, cats):
        train, _ = forward_split(frame, weeks=2)
        model = train_day_profile(frame, train, cats[0], params=TINY)
        pred = predict_day_profile(model, frame)
        assert np.isfinite(pred).all() and len(pred) == len(frame)

    def test_feature_cols_override(self, frame, cats):
        train, _ = forward_split(frame, weeks=2)
        cols = [c for c in DAY_PROFILE_FEATURE_COLS if c != "temp_high_f"]
        model = train_day_profile(frame, train, cats[0], params=TINY, feature_cols=cols)
        assert model.booster_.feature_name() == cols
        no_column = frame.drop(columns=["temp_high_f"])
        assert np.isfinite(predict_day_profile(model, no_column)).all()
