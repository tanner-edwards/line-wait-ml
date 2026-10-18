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
        b = with_(RECIPE_B, trajectory_params=self.TINY, day_profile_params=self.TINY)
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
