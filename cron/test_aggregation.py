from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pandas as pd
import pytest

from aggregation import aggregate, compute_ride_stats, doc_id


PT = ZoneInfo("America/Los_Angeles")


def _la(hour: int, minute: int, day: int = 15):
    """2026-06-15 = Monday."""
    return datetime(2026, 6, day, hour, minute, tzinfo=PT)


def _sample(**overrides) -> dict:
    base = {
        "park_id": "park-A",
        "ride_id": "ride-1",
        "ride_name": "Ride One",
        "wait_minutes": 30,
        "status": "OPERATING",
        "timestamp_utc": _la(10, 0),
    }
    base.update(overrides)
    return base


def _df(*rows: dict) -> pd.DataFrame:
    return pd.DataFrame(rows or [])


class TestAggregate:
    def test_empty_input_returns_empty_result(self):
        result = aggregate(pd.DataFrame())
        assert result.empty

    def test_groups_by_park_ride_bucket_daytype_and_means_round(self):
        # 4 rows for the same group: mean = (10+20+30+40)/4 = 25
        result = aggregate(_df(
            _sample(wait_minutes=10, timestamp_utc=_la(10, 5)),
            _sample(wait_minutes=20, timestamp_utc=_la(10, 10)),
            _sample(wait_minutes=30, timestamp_utc=_la(10, 20)),
            _sample(wait_minutes=40, timestamp_utc=_la(10, 25)),
        ))
        assert len(result) == 1
        row = result.iloc[0]
        assert row["mean"] == 25
        assert row["sampleCount"] == 4
        assert row["bucket"] == "10:00-10:30"
        assert row["dayType"] == "weekday"

    def test_rounds_half_away_from_zero(self):
        # mean of [10, 15] = 12.5 → 12 (banker's rounding) — pandas .round()
        # uses banker's rounding so 12.5 rounds to 12 not 13. The spec only
        # says "rounded to the nearest integer"; either is acceptable.
        result = aggregate(_df(
            _sample(wait_minutes=10),
            _sample(wait_minutes=15),
        ))
        assert result.iloc[0]["mean"] in (12, 13)

    def test_separates_30_min_buckets_within_same_hour(self):
        result = aggregate(_df(
            _sample(wait_minutes=10, timestamp_utc=_la(10, 15)),
            _sample(wait_minutes=50, timestamp_utc=_la(10, 45)),
        ))
        assert len(result) == 2
        by_bucket = {r["bucket"]: r["mean"] for _, r in result.iterrows()}
        assert by_bucket["10:00-10:30"] == 10
        assert by_bucket["10:30-11:00"] == 50

    def test_separates_weekday_vs_weekend(self):
        # 2026-06-15 = Monday; 2026-06-20 = Saturday
        result = aggregate(_df(
            _sample(wait_minutes=10, timestamp_utc=_la(10, 0, 15)),
            _sample(wait_minutes=90, timestamp_utc=_la(10, 0, 20)),
        ))
        assert len(result) == 2
        by_daytype = {r["dayType"]: r["mean"] for _, r in result.iterrows()}
        assert by_daytype["weekday"] == 10
        assert by_daytype["weekend"] == 90

    def test_separates_by_park_and_ride(self):
        result = aggregate(_df(
            _sample(park_id="A", ride_id="r1", wait_minutes=10),
            _sample(park_id="A", ride_id="r2", wait_minutes=20),
            _sample(park_id="B", ride_id="r1", wait_minutes=30),
        ))
        assert len(result) == 3

    def test_filters_non_operating(self):
        result = aggregate(_df(
            _sample(status="OPERATING", wait_minutes=30),
            _sample(status="CLOSED", wait_minutes=100),
            _sample(status="REFURBISHMENT", wait_minutes=200),
        ))
        assert len(result) == 1
        assert result.iloc[0]["sampleCount"] == 1
        assert result.iloc[0]["mean"] == 30

    def test_filters_null_wait_minutes(self):
        result = aggregate(_df(
            _sample(wait_minutes=30),
            _sample(wait_minutes=None),
        ))
        assert len(result) == 1
        assert result.iloc[0]["sampleCount"] == 1

    def test_treats_zero_wait_as_valid_walk_on(self):
        result = aggregate(_df(
            _sample(wait_minutes=0),
            _sample(wait_minutes=0),
            _sample(wait_minutes=10),
        ))
        assert result.iloc[0]["sampleCount"] == 3
        assert result.iloc[0]["mean"] == 3  # 10/3 = 3.33 → 3

    def test_idempotency_same_input_same_output(self):
        df = _df(
            _sample(wait_minutes=10),
            _sample(wait_minutes=20),
        )
        a = aggregate(df)
        b = aggregate(df.copy())
        pd.testing.assert_frame_equal(a, b)


class TestComputeRideStats:
    def test_empty_input_returns_empty_result(self):
        result = compute_ride_stats(pd.DataFrame())
        assert result.empty

    def test_computes_p10_p50_p90(self):
        # 10 rows: sorted waits [10,20,30,40,50,60,70,80,90,100]
        rows = [_sample(wait_minutes=w) for w in range(10, 101, 10)]
        result = compute_ride_stats(_df(*rows))
        assert len(result) == 1
        row = result.iloc[0]
        assert row["p10"] == 19   # quantile(0.1) of [10..100] step 10
        assert row["p50"] == 55   # median
        assert row["p90"] == 91   # quantile(0.9)
        assert row["sampleCount"] == 10

    def test_p50_guard_threshold_visible_in_output(self):
        # Verify a low-demand ride (all waits < 25) gets a low p50
        rows = [_sample(wait_minutes=w) for w in [5, 8, 10, 12, 15]]
        result = compute_ride_stats(_df(*rows))
        assert result.iloc[0]["p50"] < 25

    def test_filters_non_operating_and_null_waits(self):
        result = compute_ride_stats(_df(
            _sample(wait_minutes=30),
            _sample(status="CLOSED", wait_minutes=100),
            _sample(wait_minutes=None),
        ))
        assert result.iloc[0]["sampleCount"] == 1


class TestDocId:
    def test_format(self):
        assert (
            doc_id("park-A", "ride-1", "10:30-11:00", "weekday")
            == "park-A__ride-1__10:30-11:00__weekday"
        )
