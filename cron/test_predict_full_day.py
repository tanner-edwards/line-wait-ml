from datetime import datetime
from zoneinfo import ZoneInfo

from day_type import holiday_features
from predict import FULL_DAY_SLOTS, _build_full_day

LA = ZoneInfo("America/Los_Angeles")


class _FakeBooster:
    """Stands in for the LightGBM day_profile model — returns a fixed wait
    for every slot so masking behavior can be tested without a real model."""

    def predict(self, X):
        return [42.0] * len(X)


def _call(close_minutes):
    now_la = datetime(2026, 8, 24, 12, 0, tzinfo=LA)
    hol = holiday_features(now_la)
    return _build_full_day(
        "test-ride", now_la, _FakeBooster(), ["test-ride"], hol,
        close_minutes=close_minutes,
    )


class TestFullDayCloseMasking:
    def test_no_close_minutes_leaves_all_slots_unmasked(self):
        slots = _call(close_minutes=None)
        assert all(s["wait"] == 42 for s in slots)

    def test_slots_at_and_after_close_are_nulled(self):
        # Close at 18:00 (1080 min) — a shortened day well before the 23:30 grid end.
        slots = _call(close_minutes=18 * 60)
        before_close = [s for s in slots if s["start_minutes"] < 18 * 60]
        at_or_after_close = [s for s in slots if s["start_minutes"] >= 18 * 60]
        assert before_close and at_or_after_close  # sanity: both groups non-empty
        assert all(s["wait"] == 42 for s in before_close)
        assert all(s["wait"] is None for s in at_or_after_close)

    def test_close_at_last_slot_only_nulls_that_slot(self):
        last_start = FULL_DAY_SLOTS[-1][0]
        slots = _call(close_minutes=last_start)
        assert slots[-1]["wait"] is None
        assert all(s["wait"] == 42 for s in slots[:-1])
