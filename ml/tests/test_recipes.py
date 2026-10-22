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


# ── Direction classifiers and the trend word (Session 5) ────────────────────

import pandas as pd  # noqa: E402

from ml.recipes import (  # noqa: E402
    BANDS,
    CLASSIFIER_NAMES,
    band_of,
    classifier_file,
    classifier_label,
    derive_trend,
    predict_classifier,
    train_classifier,
)

TINY_CLF = dict(n_estimators=5, num_leaves=7, learning_rate=0.1, verbose=-1)
FLAT5 = {"fall": ("flat", 5), "rise": ("flat", 5)}


def _clf_recipe(labels=FLAT5):
    return with_(RECIPE_B, name="Bc", classifier_params=TINY_CLF, classifier_labels=labels)


class TestLabels:
    def _frame(self):
        # current, target -> d = target - current
        return pd.DataFrame({
            "wait_minutes": [5.0, 10.0, 15.0, 20.0, 30.0, 30.0, 50.0, None],
            "target_t30":   [10.0, 5.0, 21.0, 10.0, 35.0, 18.0, 50.0, 40.0],
        })

    def test_flat5(self):
        f = self._frame()
        assert classifier_label(f, 30, "rise", ("flat", 5)).tolist() == [True, False, True, False, True, False, False, False]
        assert classifier_label(f, 30, "fall", ("flat", 5)).tolist() == [False, True, False, True, False, True, False, False]

    def test_flat10(self):
        f = self._frame()
        assert classifier_label(f, 30, "rise", ("flat", 10)).tolist() == [False] * 8
        assert classifier_label(f, 30, "fall", ("flat", 10)).tolist() == [False, False, False, True, False, True, False, False]

    def test_pct_has_a_floor(self):
        f = self._frame()
        # 5 -> 10 is +100% but current < 15; 15 -> 21 is +40%; 20 -> 10 is -50%; 30 -> 18 is -40%.
        assert classifier_label(f, 30, "rise", ("pct", 0.40, 15)).tolist() == [False, False, True, False, False, False, False, False]
        assert classifier_label(f, 30, "fall", ("pct", 0.40, 15)).tolist() == [False, False, False, True, False, True, False, False]

    def test_bad_direction(self):
        with pytest.raises(ValueError):
            classifier_label(self._frame(), 30, "up", ("flat", 5))


class TestClassifiers:
    def test_recipe_flags(self):
        assert not RECIPE_A.has_classifiers and RECIPE_A.classifier_names == []
        r = _clf_recipe()
        assert r.has_classifiers and r.classifier_features == r.trajectory_features
        assert r.classifier_names == CLASSIFIER_NAMES
        assert [classifier_file(n) for n in CLASSIFIER_NAMES] == [
            "clf_fall_30.txt", "clf_fall_60.txt", "clf_rise_30.txt", "clf_rise_60.txt"]

    def test_labels_normalized_to_tuples(self):
        r = with_(RECIPE_B, classifier_labels={"fall": ["pct", 0.4, 15], "rise": ["flat", 5]})
        assert r.classifier_labels == {"fall": ("pct", 0.4, 15), "rise": ("flat", 5)}

    def test_round_trip_probabilities(self, frame, cats):
        train, _ = forward_split(frame, weeks=2)
        r = _clf_recipe()
        for direction in ("fall", "rise"):
            model = train_classifier(frame, train, 30, direction, *cats, r)
            assert model.recipe_ == r and model.direction_ == direction and model.horizon_ == 30
            assert model.booster_.feature_name() == list(r.trajectory_features)
            p = predict_classifier(model, frame, 30)
            valid = frame["training_valid_t30"]
            assert p.index.equals(frame.index)
            assert p[valid].between(0, 1).all()
            assert p[~valid].isna().all()

    def test_no_labels_refuses(self, frame, cats):
        train, _ = forward_split(frame, weeks=2)
        with pytest.raises(ValueError):
            train_classifier(frame, train, 30, "rise", *cats, RECIPE_A)


class TestDeriveTrend:
    def test_bands(self):
        assert [band_of(c) for c in (0, 5, 10, 15, 25, 30, 60, 65, 120)] == [
            "<=10", "<=10", "<=10", "15-25", "15-25", "30-60", "30-60", ">60", ">60"]
        assert BANDS == ["<=10", "15-25", "30-60", ">60"]

    def test_table(self):
        from test_predict_serving import TREND_GRID, TREND_THRESHOLDS

        for args, expected in TREND_GRID:
            assert derive_trend(*args, TREND_THRESHOLDS) == expected, args

    def test_missing_thresholds_are_none(self):
        from test_predict_serving import TREND_THRESHOLDS

        assert derive_trend(20.0, 20.0, 0.9, 0.1, None) is None
        assert derive_trend(20.0, 20.0, None, 0.1, TREND_THRESHOLDS) is None
        assert derive_trend(float("nan"), 20.0, 0.9, 0.1, TREND_THRESHOLDS) is None
        assert derive_trend(20.0, 20.0, 0.9, 0.1, {">60": TREND_THRESHOLDS[">60"]}) is None

    def test_missing_lag_means_no_peak_or_trough(self):
        from test_predict_serving import TREND_THRESHOLDS

        assert derive_trend(20.0, None, 0.9, 0.1, TREND_THRESHOLDS) == ("rising", "high")
        assert derive_trend(20.0, float("nan"), 0.1, 0.9, TREND_THRESHOLDS) == ("falling", "high")

    def test_parity_with_predict(self):
        """ml.recipes.derive_trend and cron/predict.py's mirror agree everywhere on a dense grid."""
        import itertools

        import predict
        from test_predict_serving import TREND_GRID, TREND_THRESHOLDS

        currents = [0.0, 5.0, 10.0, 15.0, 25.0, 30.0, 45.0, 60.0, 65.0, 120.0, float("nan")]
        lags = [None, float("nan"), 0.0, 5.0, 10.0, 20.0, 40.0, 70.0]
        ps = [None, 0.0, 0.1, 0.149, 0.15, 0.29, 0.3, 0.4, 0.45, 0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.99]
        tables = [TREND_THRESHOLDS, None, {"15-25": TREND_THRESHOLDS["15-25"]}]
        n = 0
        for c, lag, pr, pf, t in itertools.product(currents, lags, ps, ps, tables):
            assert derive_trend(c, lag, pr, pf, t) == predict._derive_trend_from_probs(c, lag, pr, pf, t), (c, lag, pr, pf)
            n += 1
        for args, _ in TREND_GRID:
            assert derive_trend(*args, TREND_THRESHOLDS) == predict._derive_trend_from_probs(*args, TREND_THRESHOLDS)
        assert predict.STABLE_HIGH == 0.15 and predict.STABLE_MEDIUM == 0.30
        assert [predict._band_of(c) for c in currents[:-1]] == [band_of(c) for c in currents[:-1]]
        assert n > 10_000


class TestRecipeBSession5:
    def test_has_classifiers_and_thresholds_for_every_band(self):
        assert RECIPE_B.has_classifiers and RECIPE_B.classifier_names == CLASSIFIER_NAMES
        assert set(RECIPE_B.trend_thresholds) == set(BANDS)
        for band in RECIPE_B.trend_thresholds.values():
            assert set(band) == {"call", "high"}
            assert all(set(side) == {"rise", "fall"} for side in band.values())

    def test_alert_matches_backend_constant(self):
        import re
        from pathlib import Path

        ts = (Path(__file__).resolve().parents[2] / "app" / "backend" / "src" / "mlPredictions.ts").read_text()
        threshold = float(re.search(r"P_RISE_ALERT_THRESHOLD = ([0-9.]+);", ts).group(1))
        minimum = int(re.search(r"ALERT_MIN_CURRENT_WAIT = (\d+);", ts).group(1))
        assert RECIPE_B.alert == {"field": "p_rise_30", "threshold": threshold, "min_current_wait": minimum}
