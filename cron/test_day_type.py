from datetime import datetime
from zoneinfo import ZoneInfo

from day_type import classify_day_type, is_holiday


def _la_noon(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, 12, 0, tzinfo=ZoneInfo("America/Los_Angeles"))


class TestClassifyDayTypeWeekdayVsWeekend:
    # 2026-05-18 is a Monday; week of Mon May 18 - Sun May 24 has no holidays.
    def test_monday_is_weekday(self):
        assert classify_day_type(_la_noon(2026, 5, 18)) == "weekday"

    def test_tuesday_is_weekday(self):
        assert classify_day_type(_la_noon(2026, 5, 19)) == "weekday"

    def test_wednesday_is_weekday(self):
        assert classify_day_type(_la_noon(2026, 5, 20)) == "weekday"

    def test_thursday_is_weekday(self):
        assert classify_day_type(_la_noon(2026, 5, 21)) == "weekday"

    def test_friday_is_weekend(self):
        assert classify_day_type(_la_noon(2026, 5, 22)) == "weekend"

    def test_saturday_is_weekend(self):
        assert classify_day_type(_la_noon(2026, 5, 23)) == "weekend"

    def test_sunday_is_weekend(self):
        assert classify_day_type(_la_noon(2026, 5, 24)) == "weekend"


class TestHolidayOverride:
    def test_new_years_day_is_holiday(self):
        # 2026-01-01 was a Thursday
        assert classify_day_type(_la_noon(2026, 1, 1)) == "holiday"

    def test_independence_day_is_holiday(self):
        # 2026-07-04 (Saturday — would otherwise be weekend)
        assert classify_day_type(_la_noon(2026, 7, 4)) == "holiday"

    def test_christmas_is_holiday(self):
        assert classify_day_type(_la_noon(2026, 12, 25)) == "holiday"

    def test_mothers_day_is_holiday(self):
        # 2nd Sunday of May 2026 = May 10
        assert classify_day_type(_la_noon(2026, 5, 10)) == "holiday"

    def test_black_friday_is_holiday(self):
        # Thanksgiving 2026 = Nov 26; Black Friday = Nov 27
        assert classify_day_type(_la_noon(2026, 11, 27)) == "holiday"

    def test_easter_2026_is_holiday(self):
        # Easter 2026 = April 5
        assert classify_day_type(_la_noon(2026, 4, 5)) == "holiday"


class TestIsHoliday:
    def test_christmas(self):
        assert is_holiday(_la_noon(2026, 12, 25)) is True

    def test_ordinary_tuesday(self):
        assert is_holiday(_la_noon(2026, 5, 19)) is False

    def test_memorial_day(self):
        # Last Monday of May 2026 = May 25
        assert is_holiday(_la_noon(2026, 5, 25)) is True

    def test_new_years_eve(self):
        assert is_holiday(_la_noon(2026, 12, 31)) is True


class TestTimezoneHandling:
    def test_classifies_by_la_local_day_not_utc(self):
        from datetime import timezone
        # 2026-05-25 03:00 UTC = 2026-05-24 20:00 PT (Sunday — non-holiday weekend)
        # 2026-05-25 PT is Memorial Day (holiday)
        early_utc = datetime(2026, 5, 25, 3, 0, tzinfo=timezone.utc)
        assert classify_day_type(early_utc) == "weekend"
