from datetime import datetime
from zoneinfo import ZoneInfo

from day_type import holiday_features
from predict import FULL_DAY_SLOTS, _build_full_day

LA = ZoneInfo("America/Los_Angeles")


class _FakeBooster:
    """Stands in for the LightGBM day_profile model — returns a fixed wait
    for every slot so masking behavior can be tested without a real model.
    Captures the last X it was asked to predict on, so tests can inspect the
    feature values the model actually saw."""

    def __init__(self):
        self.last_X = None

    def predict(self, X):
        self.last_X = X
        return [42.0] * len(X)


def _call(close_minutes, open_minutes=None, booster=None):
    now_la = datetime(2026, 8, 24, 12, 0, tzinfo=LA)
    hol = holiday_features(now_la)
    booster = booster or _FakeBooster()
    return booster, _build_full_day(
        "test-ride", now_la, booster, ["test-ride"], hol,
        open_minutes=open_minutes, close_minutes=close_minutes,
    )


class TestFullDayCloseMasking:
    def test_no_close_minutes_leaves_all_slots_unmasked(self):
        _, slots = _call(close_minutes=None)
        assert all(s["wait"] == 42 for s in slots)

    def test_slots_at_and_after_close_are_nulled(self):
        # Close at 18:00 (1080 min) — a shortened day well before the 23:30 grid end.
        _, slots = _call(close_minutes=18 * 60)
        before_close = [s for s in slots if s["start_minutes"] < 18 * 60]
        at_or_after_close = [s for s in slots if s["start_minutes"] >= 18 * 60]
        assert before_close and at_or_after_close  # sanity: both groups non-empty
        assert all(s["wait"] == 42 for s in before_close)
        assert all(s["wait"] is None for s in at_or_after_close)

    def test_close_at_last_slot_only_nulls_that_slot(self):
        last_start = FULL_DAY_SLOTS[-1][0]
        _, slots = _call(close_minutes=last_start)
        assert slots[-1]["wait"] is None
        assert all(s["wait"] == 42 for s in slots[:-1])


class TestFullDayCloseFeatures:
    def test_minutes_until_close_per_slot(self):
        booster, _ = _call(open_minutes=8 * 60, close_minutes=20 * 60)
        X = booster.last_X
        expected = [20 * 60 - start for start, _ in FULL_DAY_SLOTS]
        assert X["minutes_until_close"].tolist() == expected

    def test_total_operating_hours_constant_across_slots(self):
        booster, _ = _call(open_minutes=8 * 60, close_minutes=20 * 60)
        X = booster.last_X
        assert (X["total_operating_hours"] == 12.0).all()

    def test_features_are_nan_when_close_unknown(self):
        booster, _ = _call(open_minutes=None, close_minutes=None)
        X = booster.last_X
        assert X["minutes_until_close"].isna().all()
        assert X["total_operating_hours"].isna().all()

    def test_total_operating_hours_nan_when_only_close_known(self):
        # Masking only needs close_minutes; total_operating_hours needs both.
        booster, _ = _call(open_minutes=None, close_minutes=20 * 60)
        X = booster.last_X
        assert not X["minutes_until_close"].isna().any()
        assert X["total_operating_hours"].isna().all()
