from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from bucketing import bucket_of


def _la(hour: int, minute: int, day: int = 15) -> datetime:
    """2026-06-15 was a Monday, mid-summer (PDT, UTC-7). Easy to reason about."""
    return datetime(2026, 6, day, hour, minute, tzinfo=ZoneInfo("America/Los_Angeles"))


class TestBucketOf:
    def test_top_of_hour_floors_to_zero(self):
        assert bucket_of(_la(10, 0)) == "10:00-10:30"

    def test_quarter_past_floors_to_zero(self):
        assert bucket_of(_la(10, 14)) == "10:00-10:30"

    def test_just_before_half_floors_to_zero(self):
        assert bucket_of(_la(10, 29)) == "10:00-10:30"

    def test_half_past_floors_to_thirty(self):
        assert bucket_of(_la(10, 30)) == "10:30-11:00"

    def test_three_quarters_floors_to_thirty(self):
        assert bucket_of(_la(10, 42)) == "10:30-11:00"

    def test_just_before_top_floors_to_thirty(self):
        assert bucket_of(_la(10, 59)) == "10:30-11:00"

    def test_midnight_wraparound(self):
        assert bucket_of(_la(23, 45)) == "23:30-00:00"

    def test_midnight_zero(self):
        assert bucket_of(_la(0, 0)) == "00:00-00:30"

    def test_naive_datetime_treated_as_utc(self):
        # 2026-06-15 16:00 naive == 16:00 UTC == 09:00 PT
        d = datetime(2026, 6, 15, 16, 0)
        assert bucket_of(d) == "09:00-09:30"

    def test_explicit_timezone_arg(self):
        # 2026-06-15 16:00 UTC = 09:00 PT vs 12:00 NYC (EDT)
        d = datetime(2026, 6, 15, 16, 0, tzinfo=timezone.utc)
        assert bucket_of(d, ZoneInfo("America/Los_Angeles")) == "09:00-09:30"
        assert bucket_of(d, ZoneInfo("America/New_York")) == "12:00-12:30"
