from datetime import datetime
from zoneinfo import ZoneInfo

from park_schedule import (
    _la_date_string,
    _minutes_from_midnight,
    get_todays_hours,
    minutes_until_close,
    operating_hours,
    pick_operating_window,
)

LA = ZoneInfo("America/Los_Angeles")


class _FakeSnapshot:
    def __init__(self, data):
        self.exists = data is not None
        self._data = data

    def to_dict(self):
        return self._data


class _FakeDocRef:
    def __init__(self, data):
        self._data = data

    def get(self):
        return _FakeSnapshot(self._data)


class _FakeCollection:
    def __init__(self, docs):
        self._docs = docs

    def document(self, doc_id):
        return _FakeDocRef(self._docs.get(doc_id))


class _FakeDb:
    def __init__(self, docs):
        self._docs = docs

    def collection(self, name):
        assert name == "park_schedules"
        return _FakeCollection(self._docs)


class TestLaDateString:
    def test_formats_naive_datetime_as_utc_then_localizes(self):
        # 2026-08-24 07:00 UTC = 2026-08-24 00:00 LA (PDT, UTC-7)
        assert _la_date_string(datetime(2026, 8, 24, 7, 0)) == "2026-08-24"

    def test_utc_evening_rolls_to_next_la_day_boundary(self):
        # 2026-08-24 06:59 UTC is still 2026-08-23 23:59 LA
        assert _la_date_string(datetime(2026, 8, 24, 6, 59)) == "2026-08-23"


class TestMinutesFromMidnight:
    def test_parses_iso_with_offset(self):
        assert _minutes_from_midnight("2026-08-24T20:00:00-07:00") == 20 * 60

    def test_converts_across_timezones(self):
        # 23:00 UTC-4 (EDT) == 20:00 PDT (UTC-7)
        assert _minutes_from_midnight("2026-08-24T23:00:00-04:00") == 20 * 60

    def test_returns_none_for_missing_or_invalid(self):
        assert _minutes_from_midnight(None) is None
        assert _minutes_from_midnight("not-a-time") is None


class TestPickOperatingWindow:
    def test_returns_operating_entry_times(self):
        entries = [
            {"type": "OPERATING", "openingTime": "2026-08-24T08:00:00-07:00", "closingTime": "2026-08-24T20:00:00-07:00"},
        ]
        assert pick_operating_window(entries) == ("2026-08-24T08:00:00-07:00", "2026-08-24T20:00:00-07:00")

    def test_ignores_ticketed_event_when_operating_present(self):
        entries = [
            {"type": "OPERATING", "openingTime": "2026-08-24T09:00:00-07:00", "closingTime": "2026-08-24T18:00:00-07:00"},
            {"type": "TICKETED_EVENT", "openingTime": "2026-08-24T19:00:00-07:00", "closingTime": "2026-08-25T00:00:00-07:00"},
        ]
        assert pick_operating_window(entries) == ("2026-08-24T09:00:00-07:00", "2026-08-24T18:00:00-07:00")

    def test_returns_none_none_when_no_operating_entry(self):
        entries = [
            {"type": "TICKETED_EVENT", "openingTime": "2026-08-24T19:00:00-07:00", "closingTime": "2026-08-25T00:00:00-07:00"},
        ]
        assert pick_operating_window(entries) == (None, None)

    def test_returns_none_none_for_empty_or_missing_entries(self):
        assert pick_operating_window([]) == (None, None)
        assert pick_operating_window(None) == (None, None)

    def test_skips_operating_entry_missing_a_time(self):
        entries = [{"type": "OPERATING", "openingTime": None, "closingTime": "2026-08-24T18:00:00-07:00"}]
        assert pick_operating_window(entries) == (None, None)


class TestGetTodaysHours:
    NOW_LA = datetime(2026, 8, 24, 12, 0, tzinfo=LA)
    PARK_ID = "park-1"

    def test_returns_operating_open_and_close_minutes(self):
        db = _FakeDb({
            f"{self.PARK_ID}_2026-08-24": {
                "entries": [
                    {"type": "OPERATING", "openingTime": "2026-08-24T08:00:00-07:00", "closingTime": "2026-08-24T20:00:00-07:00"},
                ]
            }
        })
        assert get_todays_hours(db, self.PARK_ID, self.NOW_LA) == (8 * 60, 20 * 60)

    def test_ignores_ticketed_event_when_operating_present(self):
        db = _FakeDb({
            f"{self.PARK_ID}_2026-08-24": {
                "entries": [
                    {"type": "OPERATING", "openingTime": "2026-08-24T09:00:00-07:00", "closingTime": "2026-08-24T18:00:00-07:00"},
                    {"type": "TICKETED_EVENT", "openingTime": "2026-08-24T19:00:00-07:00", "closingTime": "2026-08-25T00:00:00-07:00"},
                ]
            }
        })
        assert get_todays_hours(db, self.PARK_ID, self.NOW_LA) == (9 * 60, 18 * 60)

    def test_returns_none_none_when_doc_missing(self):
        db = _FakeDb({})
        assert get_todays_hours(db, self.PARK_ID, self.NOW_LA) == (None, None)

    def test_returns_none_none_when_no_operating_entry(self):
        db = _FakeDb({
            f"{self.PARK_ID}_2026-08-24": {
                "entries": [
                    {"type": "TICKETED_EVENT", "openingTime": "2026-08-24T19:00:00-07:00", "closingTime": "2026-08-25T00:00:00-07:00"},
                ]
            }
        })
        assert get_todays_hours(db, self.PARK_ID, self.NOW_LA) == (None, None)


class TestMinutesUntilClose:
    def test_positive_when_before_close(self):
        assert minutes_until_close(current_minutes=16 * 60, close_minutes=20 * 60) == 4 * 60

    def test_negative_when_after_close(self):
        assert minutes_until_close(current_minutes=21 * 60, close_minutes=20 * 60) == -60


class TestOperatingHours:
    def test_computes_hours_between_open_and_close(self):
        assert operating_hours(open_minutes=8 * 60, close_minutes=23 * 60) == 15.0

    def test_short_day(self):
        assert operating_hours(open_minutes=9 * 60, close_minutes=14 * 60) == 5.0
