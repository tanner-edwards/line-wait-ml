from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest
from scipy.stats import binomtest

from ml.metrics import big_move_mae, breakdown, mae, paired_daily, trend_class, trend_confusion


def test_mae():
    assert mae(pd.Series([10, 20]), pd.Series([12, 16])) == 3


def test_big_move_mae_only_scores_big_moves():
    df = pd.DataFrame({"wait_minutes": [20, 20, 20], "target_t30": [20, 35, 5]})
    p = pd.Series([0.0, 30.0, 10.0])
    # Row 0 moved 0 (excluded); rows 1 and 2 moved 15 -> errors 5 and 5.
    assert big_move_mae(df, None, p, 30) == 5


class TestTrendClass:
    def test_thresholds(self):
        got = trend_class(pd.Series([5, -5, 4, -4, 0]))
        assert got.tolist() == ["rising", "falling", "stable", "stable", "stable"]


class TestTrendConfusion:
    @pytest.fixture
    def result(self):
        # actual:    rising rising stable stable falling falling
        # predicted: rising stable stable rising falling stable
        df = pd.DataFrame({
            "wait_minutes": [20] * 6,
            "target_t30": [30, 30, 20, 20, 10, 10],
        })
        p = pd.Series([30.0, 20.0, 20.0, 30.0, 10.0, 20.0])
        return trend_confusion(df, None, p, 30)

    def test_matrix(self, result):
        m = result["matrix"]
        assert m.loc["rising", "rising"] == 1 and m.loc["rising", "stable"] == 1
        assert m.loc["stable", "rising"] == 1 and m.loc["falling", "stable"] == 1
        assert m.to_numpy().sum() == 6

    def test_recall_precision(self, result):
        pc = result["per_class"]
        assert pc.loc["rising", "recall"] == 0.5
        assert pc.loc["rising", "precision"] == 0.5
        assert pc.loc["stable", "recall"] == 0.5
        assert pc.loc["stable", "precision"] == pytest.approx(1 / 3)
        assert pc.loc["falling", "recall"] == 0.5
        assert pc.loc["falling", "precision"] == 1.0

    def test_accuracy_and_always_stable(self, result):
        assert result["accuracy"] == 0.5
        assert result["always_stable_accuracy"] == pytest.approx(2 / 6)


class TestPairedDaily:
    def test_sign_test_on_known_sequence(self):
        days = [date(2026, 9, 1) + timedelta(days=i) for i in range(10)]
        # a beats b on the first 8 days, loses on the last 2.
        df = pd.DataFrame({"date_la": days, "y": [10.0] * 10})
        p_a = pd.Series([11.0] * 8 + [14.0] * 2)
        p_b = pd.Series([13.0] * 8 + [12.0] * 2)
        rows = pd.Series(True, index=df.index)
        res = paired_daily(df, rows, df["y"], p_a, p_b)
        assert res["wins_a"] == 8 and res["wins_b"] == 2 and res["n_days"] == 10
        assert res["sign_test_p"] == pytest.approx(binomtest(8, 10).pvalue)
        diffs = np.array([-2.0] * 8 + [2.0] * 2)
        assert res["mean"] == pytest.approx(diffs.mean())
        assert res["half_width_95"] == pytest.approx(1.96 * diffs.std(ddof=1) / np.sqrt(10))

    def test_ties_excluded(self):
        df = pd.DataFrame({"date_la": [date(2026, 9, 1), date(2026, 9, 2)], "y": [10.0, 10.0]})
        p = pd.Series([12.0, 12.0])
        res = paired_daily(df, pd.Series([True, True]), df["y"], p, p)
        assert res["wins_a"] == res["wins_b"] == 0 and np.isnan(res["sign_test_p"])


class TestBreakdown:
    def test_one_row_per_ride_and_flags_the_worse_one(self):
        df = pd.DataFrame({
            "ride_name": ["A", "A", "B", "B"],
            "wait_minutes": [20.0, 20.0, 20.0, 20.0],
        })
        y = pd.Series([30.0, 30.0, 30.0, 30.0])
        preds = {
            "persistence": df["wait_minutes"],
            "recipe_A": pd.Series([28.0, 28.0, 5.0, 5.0]),  # A better than persistence, B worse
        }
        rows = pd.Series(True, index=df.index)
        out = breakdown(df, rows, y, preds, "ride_name")
        assert len(out) == 2
        assert out.loc["B", "worse_than_persistence"] and not out.loc["A", "worse_than_persistence"]
        assert out.index[0] == "B"  # worst lift listed first
        assert out.loc["A", "lift_recipe_A"] == pytest.approx(80.0)

    def test_wait_band(self):
        df = pd.DataFrame({"wait_minutes": [5.0, 40.0]})
        y = pd.Series([5.0, 40.0])
        out = breakdown(df, pd.Series([True, True]), y, {"persistence": df["wait_minutes"]}, "wait_band")
        assert out.index.astype(str).tolist() == ["<=10", "26-60"]


def test_breakdown_lift_is_nan_when_baseline_mae_is_zero():
    df = pd.DataFrame({"ride_name": ["A", "A"], "wait_minutes": [0.0, 0.0]})
    y = pd.Series([0.0, 0.0])
    preds = {"persistence": df["wait_minutes"], "recipe_A": pd.Series([1.0, 1.0])}
    out = breakdown(df, pd.Series([True, True]), y, preds, "ride_name")
    assert np.isnan(out.loc["A", "lift_recipe_A"]) and out.loc["A", "worse_than_persistence"]
