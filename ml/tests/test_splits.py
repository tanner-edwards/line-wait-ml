from datetime import date, timedelta

import pandas as pd

from ml.splits import day_type, forward_split, interleaved_split, wait_band


class TestForwardSplit:
    def test_masks_are_disjoint(self, frame):
        train, test = forward_split(frame, weeks=2)
        assert not (train & test).any()
        assert set(frame.loc[train, "date_la"]).isdisjoint(set(frame.loc[test, "date_la"]))

    def test_default_window_is_last_weeks_of_days(self, frame):
        _, test = forward_split(frame, weeks=2)
        test_days = sorted(set(frame.loc[test, "date_la"]))
        assert len(test_days) == 14
        assert test_days[-1] == frame["date_la"].max()

    def test_train_is_everything_before_test(self, frame):
        train, test = forward_split(frame, weeks=2)
        assert (train | test).all()
        assert max(frame.loc[train, "date_la"]) < min(frame.loc[test, "date_la"])

    def test_explicit_cutoff_respected(self, frame):
        cutoff = date(2026, 8, 10)
        train, test = forward_split(frame, weeks=1, cutoff=cutoff)
        assert max(frame.loc[train, "date_la"]) == cutoff
        test_days = sorted(set(frame.loc[test, "date_la"]))
        assert test_days == [cutoff + timedelta(days=i) for i in range(1, 8)]
        # Days past the window are in neither mask.
        assert not (train | test).all()

    def test_window_shorter_at_frame_end(self, frame):
        cutoff = frame["date_la"].max() - timedelta(days=3)
        _, test = forward_split(frame, weeks=1, cutoff=cutoff)
        assert frame.loc[test, "date_la"].nunique() == 3


class TestInterleavedSplit:
    def test_reproduces_ordinal_mod_5(self, frame):
        train, test = interleaved_split(frame)
        expected = frame["date_la"].map(lambda d: d.toordinal() % 5 == 0)
        assert (test == expected).all()
        assert (train == ~expected).all()


class TestDayType:
    def test_holiday_saturday_is_holiday(self):
        df = pd.DataFrame({"day_of_week": [6, 6, 0, 3], "is_holiday": [True, False, False, False]})
        assert day_type(df).tolist() == ["holiday", "weekend", "weekend", "weekday"]


class TestWaitBand:
    def test_boundaries(self):
        bands = wait_band(pd.Series([0, 10, 11, 25, 26, 60, 61]))
        assert bands.astype(str).tolist() == ["<=10", "<=10", "11-25", "11-25", "26-60", "26-60", ">60"]
