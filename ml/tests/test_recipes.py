import numpy as np

import pytest

from ml.recipes import (
    DAY_PROFILE_FEATURE_COLS,
    RECIPE_A,
    RECIPE_B,
    Recipe,
    TRAJECTORY_FEATURE_COLS,
    predict_day_profile,
    predict_feature_cols,
    predict_trajectory,
    train_day_profile,
    train_trajectory,
    with_,
)
from ml.splits import forward_split

TINY = dict(n_estimators=5, learning_rate=0.05, objective="regression_l1", verbose=-1)


class TestFeatureParity:
    """predict.py's lists document the row dict serving can build. Whatever is
    deployed (models/manifest.json, else A) and the next candidate (B) must be
    buildable from it."""

    def test_recipe_a_matches_predict_exactly(self):
        # predict.py's trajectory row also carries minutes_until_close for Recipe B;
        # everything else is Recipe A's list, in order.
        traj, day = predict_feature_cols()
        assert TRAJECTORY_FEATURE_COLS == list(RECIPE_A.trajectory_features)
        assert traj == TRAJECTORY_FEATURE_COLS + ["minutes_until_close"]
        assert DAY_PROFILE_FEATURE_COLS == day == list(RECIPE_A.day_profile_features)

    def test_deployed_recipe_is_buildable(self):
        from ml.manifest import REPO_ROOT, read_manifest, recipe_from_manifest

        manifest = read_manifest(REPO_ROOT / "models" / "manifest.json")
        deployed = recipe_from_manifest(manifest) if manifest else RECIPE_A
        traj, day = predict_feature_cols()
        assert set(deployed.trajectory_features) <= set(traj)
        assert set(deployed.day_profile_features) <= set(day)

    def test_recipe_b_is_buildable(self):
        traj, day = predict_feature_cols()
        assert set(RECIPE_B.trajectory_features) <= set(traj)
        assert set(RECIPE_B.day_profile_features) <= set(day)


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


class TestRecipe:
    def test_recipe_a_is_the_session3_recipe(self):
        assert RECIPE_A.trajectory_target == "level"
        assert list(RECIPE_A.trajectory_features) == TRAJECTORY_FEATURE_COLS
        assert list(RECIPE_A.day_profile_features) == DAY_PROFILE_FEATURE_COLS
        assert RECIPE_A.trajectory_params["n_estimators"] == 200

    def test_recipe_b_is_delta_b3_trajectory_and_d1_day_profile(self):
        # Trajectory = B3: delta, A's list minus week_of_year plus minutes_until_close (21).
        assert RECIPE_B.trajectory_target == "delta"
        assert "week_of_year" not in RECIPE_B.trajectory_features
        assert RECIPE_B.trajectory_features[-1] == "minutes_until_close"
        assert len(RECIPE_B.trajectory_features) == 21
        # Day-profile = D1: A's 17 features (week_of_year kept), 600 x 63.
        assert RECIPE_B.day_profile_features == RECIPE_A.day_profile_features
        assert RECIPE_B.day_profile_params["n_estimators"] == 600
        assert RECIPE_B.day_profile_params["num_leaves"] == 63

    def test_with_round_trip(self):
        arm = with_(RECIPE_A, name="B0", trajectory_target="delta")
        assert arm.name == "B0" and arm.trajectory_target == "delta"
        assert with_(arm, name="A", trajectory_target="level") == RECIPE_A
        assert RECIPE_A.trajectory_target == "level"  # original untouched

    def test_lists_become_tuples_and_bad_target_rejected(self):
        r = Recipe("X", {}, {}, "level", ["a"], ["b"])
        assert r.trajectory_features == ("a",) and r.day_profile_features == ("b",)
        with pytest.raises(ValueError):
            with_(RECIPE_A, trajectory_target="ratio")


class TestDeltaTarget:
    @pytest.fixture(scope="class")
    def models(self, frame):
        from ml.tests.conftest import RIDE_CATS, STATUS_CATS

        train, _ = forward_split(frame, weeks=2)
        level = with_(RECIPE_A, trajectory_params=TINY)
        delta = with_(RECIPE_B, trajectory_params=TINY)
        return (train_trajectory(frame, train, 30, RIDE_CATS, STATUS_CATS, recipe=level),
                train_trajectory(frame, train, 30, RIDE_CATS, STATUS_CATS, recipe=delta))

    def test_delta_returns_levels_clipped_at_zero(self, frame, models):
        _, delta = models
        pred = predict_trajectory(delta, frame, 30)
        valid = frame["training_valid_t30"]
        assert (pred[valid] >= 0).all()
        # A 5-tree delta model barely moves off the current wait; a level model would be far off it.
        assert (pred[valid] - frame.loc[valid, "wait_minutes"]).abs().median() < 5
        assert pred[~valid].isna().all()

    def test_delta_model_uses_recipe_features(self, models):
        _, delta = models
        assert delta.booster_.feature_name() == list(RECIPE_B.trajectory_features)
        assert delta.recipe_.trajectory_target == "delta"

    def test_delta_clips_negative_predictions(self, frame, models):
        _, delta = models
        low = frame.copy()
        low["wait_minutes"] = 0.0
        low["wait_lag_1"] = low["wait_lag_2"] = low["wait_lag_3"] = 60.0
        assert (predict_trajectory(delta, low, 30).dropna() >= 0).all()

    def test_params_path_is_recipe_a_with_those_params(self, frame, cats):
        train, _ = forward_split(frame, weeks=2)
        model = train_trajectory(frame, train, 30, *cats, params=TINY)
        assert model.recipe_.trajectory_target == "level"
        assert model.recipe_.trajectory_params == TINY
