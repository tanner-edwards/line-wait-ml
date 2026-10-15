from datetime import date

import numpy as np
import pandas as pd

from ml.baselines import lookup_delta, lookup_level, persistence, ride_mean
from ml.splits import forward_split


def _tiny(rows: list[tuple]) -> pd.DataFrame:
    """rows: (ride_id, hour, day_of_week, wait, target_t10, is_train)."""
    df = pd.DataFrame(rows, columns=["ride_id", "hour_of_day", "day_of_week", "wait_minutes", "target_t10", "train"])
    df["is_holiday"] = False
    df["training_valid_t10"] = df["target_t10"].notna() & df["wait_minutes"].notna()
    df["date_la"] = date(2026, 9, 1)
    return df


class TestPersistence:
    def test_equals_current_wait(self, frame):
        p = persistence(frame, 60)
        assert p.equals(frame["wait_minutes"].rename(p.name))


class TestLookupDelta:
    def test_group_median_added_to_wait(self):
        # Three train rows for (r1, hour 10, weekday) with deltas +5, +10, +30 -> median +10.
        df = _tiny([
            ("r1", 10, 3, 20, 25, True),
            ("r1", 10, 3, 20, 30, True),
            ("r1", 10, 3, 20, 50, True),
            ("r1", 10, 3, 40, None, False),
        ])
        pred = lookup_delta(df, df["train"], 10)
        assert pred.iloc[3] == 50

    def test_falls_back_ride_hour_then_ride_then_zero(self):
        df = _tiny([
            ("r1", 10, 3, 20, 30, True),   # (r1, 10, weekday) delta +10
            ("r1", 11, 3, 20, 40, True),   # (r1, 11, weekday) delta +20
            ("r1", 10, 6, 50, None, False),  # weekend at hour 10: no exact group -> (r1, 10) = +10
            ("r1", 15, 3, 50, None, False),  # hour 15: no (r1, 15) -> (r1) median of +10,+20 = +15
            ("r9", 10, 3, 50, None, False),  # unknown ride -> 0
        ])
        pred = lookup_delta(df, df["train"], 10)
        assert pred.iloc[2:].tolist() == [60, 65, 50]

    def test_no_nan_where_wait_exists(self, frame):
        train, _ = forward_split(frame, weeks=2)
        pred = lookup_delta(frame, train, 60)
        has_wait = frame["wait_minutes"].notna()
        assert pred[has_wait].notna().all()
        assert pred[~has_wait].isna().all()


class TestDayProfileBaselines:
    def test_ride_mean_and_global_fallback(self):
        df = _tiny([
            ("r1", 10, 3, 10, None, True),
            ("r1", 11, 3, 30, None, True),
            ("r2", 10, 3, 60, None, True),
            ("r9", 10, 3, 5, None, False),
        ])
        pred = ride_mean(df, df["train"])
        assert pred.tolist()[:3] == [20, 20, 60]
        assert pred.iloc[3] == np.mean([10, 30, 60])

    def test_lookup_level_fallbacks(self):
        df = _tiny([
            ("r1", 10, 3, 10, None, True),
            ("r1", 10, 3, 20, None, True),
            ("r1", 12, 3, 40, None, True),
            ("r1", 10, 0, 99, None, False),  # weekend -> (r1, 10) median 15
            ("r1", 18, 3, 99, None, False),  # -> (r1) median 20
            ("r9", 10, 3, 99, None, False),  # -> global median 20
        ])
        pred = lookup_level(df, df["train"])
        assert pred.iloc[3:].tolist() == [15, 20, 20]
