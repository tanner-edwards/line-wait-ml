from datetime import date

import pytest

from ml import evaluate
from ml.deployed import contaminated


@pytest.fixture(scope="module")
def results(frame):
    from ml.tests.conftest import RIDE_CATS, STATUS_CATS

    return evaluate.run(frame, RIDE_CATS, STATUS_CATS, weeks=2, horizons=[30],
                        run_staleness=False, write_report=False, model_dir="does-not-exist")


class TestRun:
    def test_headline_has_one_row(self, results):
        assert results.headline.index.tolist() == [30]

    def test_same_rows_for_every_prediction(self, results, frame):
        expected = int((frame["training_valid_t30"] & frame["date_la"].isin(results.meta["test_days"])).sum())
        assert results.headline.loc[30, "n_rows"] == expected
        preds = results.preds[30]
        counts = {name: int(p.notna().sum()) for name, p in preds.items()}
        assert counts["persistence"] == counts["lookup_delta"] == counts["recipe_A"] == expected
        assert all(p.index.equals(preds["persistence"].index) for p in preds.values())

    def test_recipe_beats_persistence_on_learnable_frame(self, results):
        assert results.headline.loc[30, "lift_recipe_vs_persistence"] > 0

    def test_day_profile_and_trend_present(self, results):
        assert {"lookup", "ride_mean", "recipe_A", "recipe_A_serving"} <= set(results.day_profile["mae"].index)
        assert set(results.trend_summary.index.get_level_values("class")) == {"rising", "stable", "falling"}

    def test_deployed_skipped_cleanly_with_empty_model_dir(self, frame, tmp_path, cats):
        res = evaluate.run(frame, *cats, weeks=2, horizons=[30], run_staleness=False,
                           write_report=False, model_dir=str(tmp_path))
        assert "deployed" not in res.preds[30]
        assert res.headline.loc[30, "deployed_contaminated"] is None
        assert any("trajectory_t30" in n for n in res.meta["notes"])
        assert any("day_profile" in n for n in res.meta["notes"])

    def test_unseen_rides_listed(self, frame, cats):
        ride_cats = [r for r in cats[0] if r != "r6"]
        res = evaluate.run(frame, ride_cats, cats[1], weeks=2, horizons=[30], run_staleness=False,
                           write_report=False, model_dir="does-not-exist")
        assert res.meta["unseen_rides"] == ["Ride Six (r6)"]


class TestStalenessAndInterleaved:
    def test_staleness_table_shape(self, frame, cats):
        table = evaluate.staleness(frame, *cats, weeks=1, stale_by_weeks=2, horizons=(30,))
        assert table.index.tolist() == ["T+30", "day_profile"]
        assert (table["lift_gain"] == table["fresh_lift"] - table["stale_lift"]).all()

    def test_interleaved_table(self, frame, cats):
        res = evaluate.run(frame, *cats, weeks=2, horizons=[30], run_staleness=False,
                           also_interleaved=True, write_report=False, model_dir="does-not-exist")
        assert res.interleaved.index.tolist() == [30]
        assert "forward_lift_recipe_vs_persistence" in res.interleaved.columns


class TestContaminated:
    days = [date(2026, 9, 10), date(2026, 9, 11)]

    def test_trained_through_inside_window(self):
        assert contaminated(date(2026, 9, 10), self.days)

    def test_trained_through_before_window(self):
        assert not contaminated(date(2026, 9, 9), self.days)

    def test_unknown_counts_as_contaminated(self):
        assert contaminated(None, self.days)


class TestDeployedScoring:
    @pytest.fixture
    def model_dir(self, frame, cats, tmp_path):
        import json

        from ml import recipes
        from ml.splits import forward_split

        tiny = dict(n_estimators=5, learning_rate=0.05, objective="regression_l1", verbose=-1)
        train, _ = forward_split(frame, weeks=2)
        recipes.train_trajectory(frame, train, 30, *cats, params=tiny).booster_.save_model(tmp_path / "trajectory_t30.txt")
        recipes.train_day_profile(frame, train, cats[0], params=tiny).booster_.save_model(tmp_path / "day_profile.txt")
        (tmp_path / "feature_categories.json").write_text(
            json.dumps({"ride_id_categories": cats[0], "status_categories": cats[1]}))
        return tmp_path

    def test_deployed_scored_on_same_rows_and_flagged(self, frame, cats, model_dir):
        last = frame["date_la"].max()
        res = evaluate.run(frame, *cats, weeks=2, horizons=[30], run_staleness=False, write_report=False,
                           model_dir=str(model_dir), deployed_trained_through=last)
        assert int(res.preds[30]["deployed"].notna().sum()) == res.headline.loc[30, "n_rows"]
        assert bool(res.headline.loc[30, "deployed_contaminated"])
        assert res.day_profile["deployed_contaminated"] is True
        assert "recipe_A_vs_deployed" in res.paired[30]
        assert {"deployed", "deployed_serving"} <= set(res.day_profile["mae"].index)

    def test_missing_feature_column_is_fed_nan(self, frame, cats, model_dir, caplog):
        # A deployed model may want a feature the frame no longer carries
        # (morning_crowd_index after Session 3). Serving feeds NaN; the grader
        # must do the same rather than fail the whole run.
        from ml.deployed import load_booster, predict_with_booster

        booster = load_booster(30, model_dir=str(model_dir))
        rows = frame["training_valid_t30"]
        with caplog.at_level("WARNING", logger="ml.deployed"):
            preds = predict_with_booster(booster, frame.drop(columns=["wait_lag_1"]), rows, *cats)
        assert len(preds) == int(rows.sum()) and preds.notna().all()
        assert "wait_lag_1" in caplog.text


class TestServingStyle:
    def _frames(self):
        import pandas as pd

        ts = pd.to_datetime(["2026-09-01 12:50", "2026-09-01 13:00", "2026-09-01 15:00"]).tz_localize(
            "America/Los_Angeles").tz_convert("UTC")
        rows = []
        for park, base in (("p-dl", 1.0), ("p-dca", 2.0)):
            for i, t in enumerate(ts):
                rows.append({"timestamp_utc": t, "date_la": date(2026, 9, 1), "park_id": park,
                             "crowd_level_ratio": base + i, "morning_crowd_index": base * 10})
        return pd.DataFrame(rows)

    def test_value_at_13_per_park(self):
        day = self._frames()
        out = evaluate._serving_style(day, day)
        assert out.loc[day["park_id"] == "p-dl", "crowd_level_ratio"].tolist() == [2.0] * 3
        assert out.loc[day["park_id"] == "p-dca", "crowd_level_ratio"].tolist() == [3.0] * 3
        assert out.loc[day["park_id"] == "p-dca", "morning_crowd_index"].tolist() == [20.0] * 3

    def test_without_park_id_one_value_per_day(self):
        day = self._frames().drop(columns=["park_id"])
        out = evaluate._serving_style(day, day)
        assert out["crowd_level_ratio"].nunique() == 1


class TestRecipeComparison:
    TINY = dict(n_estimators=5, learning_rate=0.05, objective="regression_l1", verbose=-1)

    @pytest.fixture(scope="class")
    def compared(self, frame):
        from ml.recipes import RECIPE_A, RECIPE_B, with_
        from ml.tests.conftest import RIDE_CATS, STATUS_CATS

        a = with_(RECIPE_A, trajectory_params=self.TINY, day_profile_params=self.TINY)
        b = with_(RECIPE_B, trajectory_params=self.TINY, day_profile_params=self.TINY,
                  classifier_params=dict(n_estimators=5, num_leaves=7, verbose=-1))
        return evaluate.run(frame, RIDE_CATS, STATUS_CATS, weeks=2, horizons=[30, 60], run_staleness=False,
                            write_report=False, model_dir="does-not-exist", recipe=a, compare=b)

    def test_both_recipes_on_identical_rows(self, compared):
        for h in (30, 60):
            preds = compared.preds[h]
            assert int(preds["recipe_A"].notna().sum()) == int(preds["recipe_B"].notna().sum()) \
                == compared.headline.loc[h, "n_rows"]
            assert preds["recipe_A"].index.equals(preds["recipe_B"].index)
        dp = compared.day_profile["preds"]
        assert len(dp["recipe_A_serving"]) == len(dp["recipe_B_serving"]) == compared.day_profile["n_rows"]

    def test_headline_and_paired_columns(self, compared):
        assert {"recipe_A", "recipe_B", "lift_B_vs_A"} <= set(compared.headline.columns)
        assert "recipe_B_vs_recipe_A" in compared.paired[30]
        assert "recipe_B_serving_vs_recipe_A_serving" in compared.day_profile["paired"]

    def test_comparison_frame(self, compared):
        table = compared.recipe_comparison
        assert table.index.tolist() == [30, 60, "day_profile"]
        assert list(table.columns) == ["A_mae", "B_mae", "paired_mean", "half_width_95",
                                       "wins_B", "wins_A", "sign_test_p", "verdict"]
        assert set(table["verdict"]) <= {"B wins", "A wins", "noise"}
        assert table.loc[30, "A_mae"] == compared.headline.loc[30, "recipe_A"]

    def test_no_compare_means_no_comparison(self, results):
        assert results.recipe_comparison is None
        assert "recipe_B" not in results.headline.columns

    def test_same_name_rejected(self, frame, cats):
        from ml.recipes import RECIPE_A

        with pytest.raises(ValueError):
            evaluate.run(frame, *cats, weeks=2, horizons=[30], run_staleness=False, write_report=False,
                         model_dir="does-not-exist", compare=RECIPE_A)


class TestClassifiers:
    TINY = dict(n_estimators=5, learning_rate=0.05, objective="regression_l1", verbose=-1)
    TINY_CLF = dict(n_estimators=10, num_leaves=7, learning_rate=0.1, verbose=-1)
    THRESHOLDS = {b: {"call": {"rise": 0.3, "fall": 0.3}, "high": {"rise": 0.7, "fall": 0.7}}
                  for b in ("<=10", "15-25", "30-60", ">60")}

    @pytest.fixture(scope="class")
    def clf_results(self, frame):
        from ml.recipes import RECIPE_A, RECIPE_B, with_
        from ml.tests.conftest import RIDE_CATS, STATUS_CATS

        a = with_(RECIPE_A, trajectory_params=self.TINY, day_profile_params=self.TINY)
        b = with_(RECIPE_B, trajectory_params=self.TINY, day_profile_params=self.TINY,
                  classifier_params=self.TINY_CLF, classifier_labels={"fall": ("flat", 5), "rise": ("flat", 5)},
                  trend_thresholds=self.THRESHOLDS)
        return evaluate.run(frame, RIDE_CATS, STATUS_CATS, weeks=2, horizons=[30, 60], run_staleness=False,
                            write_report=False, model_dir="does-not-exist", recipe=a, compare=b)

    def test_four_classifiers_scored_on_trajectory_rows(self, clf_results):
        assert sorted(clf_results.classifiers) == ["p_fall_30", "p_fall_60", "p_rise_30", "p_rise_60"]
        for name, sc in clf_results.classifiers.items():
            assert sc["n"] == clf_results.headline.loc[sc["horizon"], "n_rows"]
            assert 0.5 < sc["auc"] <= 1.0 and 0 <= sc["top_decile_precision"] <= 1
            assert sc["recipe"] == "B" and sc["label"] == ("flat", 5)
            assert sc["bands"]["n"].sum() == sc["n"]
        assert "precision" in clf_results.classifiers["p_rise_30"]["bands"].columns  # tau_call at T+30
        assert "precision" not in clf_results.classifiers["p_rise_60"]["bands"].columns

    def test_probability_word_on_same_rows(self, clf_results):
        t = clf_results.trend_clf[30]
        assert t["n"] == clf_results.headline.loc[30, "n_rows"]
        assert int(t["matrix"].values.sum()) == int(clf_results.trend[30]["matrix"].values.sum())
        assert abs(sum(t["confidence_share"].values()) - 1) < 1e-9
        assert 0 <= t["arrow_shown"] <= t["called_share"] <= 1

    def test_trend_summary_has_source_level(self, clf_results):
        summary = clf_results.trend_summary
        assert summary.index.names == ["source", "horizon", "class"]
        assert set(summary.index.get_level_values("source")) == {"regression", "classifier"}

    def test_no_classifiers_means_empty(self, results):
        assert results.classifiers == {} and results.trend_clf == {}
        assert set(results.trend_summary.index.get_level_values("source")) == {"regression"}

    def test_deployed_without_classifiers_noted(self, clf_results):
        assert any("no classifiers" in n for n in clf_results.meta["notes"])


class TestVerdict:
    def _p(self, mean, hw, p):
        return {"mean": mean, "half_width_95": hw, "sign_test_p": p}

    def test_beyond_half_width(self):
        assert evaluate.verdict(self._p(-0.5, 0.2, 0.3)) == "B wins"
        assert evaluate.verdict(self._p(0.5, 0.2, 0.3)) == "A wins"

    def test_sign_test_alone_is_enough(self):
        assert evaluate.verdict(self._p(-0.1, 0.2, 0.01)) == "B wins"

    def test_noise_and_nan(self):
        assert evaluate.verdict(self._p(-0.1, 0.2, 0.3)) == "noise"
        assert evaluate.verdict(self._p(float("nan"), float("nan"), float("nan"))) == "noise"


class TestValidSuffix:
    """Session 6 F4: the compare recipe trains on the widened _f rows/lags; scoring rows are unchanged."""
    TINY = dict(n_estimators=5, learning_rate=0.05, objective="regression_l1", verbose=-1)
    TINY_CLF = dict(n_estimators=5, num_leaves=7, verbose=-1)

    @pytest.fixture(scope="class")
    def widened_frame(self, frame):
        import numpy as np

        df = frame.copy()
        reopen = df["wait_minutes"].notna() & df["wait_lag_1"].isna()  # r3 after its noon closure
        for c in ("wait_lag_1", "wait_lag_2", "wait_lag_3"):
            df[f"{c}_f"] = df[c].fillna(df["wait_minutes"])
        df["wait_delta_1_f"] = df["wait_minutes"] - df["wait_lag_1_f"]
        df["lags_missing"] = (df[["wait_lag_1", "wait_lag_2", "wait_lag_3"]].isna().any(axis=1)
                              & df["wait_minutes"].notna()).astype(int)
        for h in (10, 20, 30, 40, 50, 60, 90, 120, 150, 180, 210, 240):
            df[f"training_valid_t{h}"] = df[f"training_valid_t{h}"] & df["wait_lag_3"].notna()
            df[f"training_valid_t{h}_f"] = df[f"training_valid_t{h}"] | (
                (df["lags_missing"] == 1) & df[f"target_t{h}"].notna())
        assert reopen.any() and np.isfinite(df["wait_lag_1_f"][reopen]).all()
        return df

    def _recipes(self):
        from ml.recipes import RECIPE_B, with_

        b = with_(RECIPE_B, trajectory_params=self.TINY, day_profile_params=self.TINY,
                  classifier_params=self.TINY_CLF)
        return b, with_(b, name="F4", trajectory_features=b.trajectory_features + ("lags_missing",))

    def test_suffixed_frame_swaps_columns(self, widened_frame):
        b, f4 = self._recipes()
        sub = evaluate.suffixed_frame(widened_frame, f4, "_f")
        assert sub["wait_lag_1"].equals(widened_frame["wait_lag_1_f"])
        assert sub["training_valid_t30"].equals(widened_frame["training_valid_t30_f"])
        assert sub["wait_minutes"].equals(widened_frame["wait_minutes"])
        assert "lags_missing" in sub.columns and "ride_id" in sub.columns

    def test_rows_unchanged_and_widened_rows_reported(self, widened_frame, cats):
        b, f4 = self._recipes()
        res = evaluate.run(widened_frame, *cats, weeks=2, horizons=[30], run_staleness=False, write_report=False,
                           model_dir="does-not-exist", recipe=b, compare=f4, valid_suffix="_f")
        plain = evaluate.run(widened_frame, *cats, weeks=2, horizons=[30], run_staleness=False,
                             write_report=False, model_dir="does-not-exist", recipe=b, compare=f4)
        assert res.headline.loc[30, "n_rows"] == plain.headline.loc[30, "n_rows"]
        assert res.preds[30]["recipe_F4"].notna().all()
        w = res.widened[30]
        assert len(w) > 0 and list(w.columns) == ["y", "persistence", "recipe_F4"]
        assert w["recipe_F4"].notna().all()
        assert not widened_frame.loc[w.index, "training_valid_t30"].any()
        assert widened_frame.loc[w.index, "training_valid_t30_f"].all()
        assert plain.widened == {}
        assert {"F4:p_fall_30", "F4:p_rise_30"} <= set(res.classifiers)

    def test_needs_compare(self, widened_frame, cats):
        with pytest.raises(ValueError):
            evaluate.run(widened_frame, *cats, weeks=2, horizons=[30], run_staleness=False, write_report=False,
                         model_dir="does-not-exist", valid_suffix="_f")


class TestClassifierReuse:
    def test_identical_classifiers_reused_with_compare_name(self, frame, cats):
        from ml.recipes import RECIPE_B, with_

        tiny = dict(n_estimators=5, learning_rate=0.05, objective="regression_l1", verbose=-1)
        b = with_(RECIPE_B, trajectory_params=tiny, day_profile_params=tiny,
                  classifier_params=dict(n_estimators=5, num_leaves=7, verbose=-1))
        d = with_(b, name="D", day_profile_features=b.day_profile_features[:-1])
        res = evaluate.run(frame, *cats, weeks=2, horizons=[30, 60], run_staleness=False, write_report=False,
                           model_dir="does-not-exist", recipe=b, compare=d)
        for name in ("p_fall_30", "p_rise_60"):
            assert res.classifiers[f"D:{name}"]["auc"] == res.classifiers[name]["auc"]
            assert res.classifiers[f"D:{name}"]["recipe"] == "D" and res.classifiers[name]["recipe"] == "B"
