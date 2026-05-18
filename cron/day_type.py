"""Day-type classifier for the historical-averages cron.

Mirrors the rules in `holidays.js` at the repo root (and the TypeScript port at
`app/backend/src/dayType.ts`). The three implementations should stay in lockstep
— if the holiday list or weekday/weekend cut changes, update all three.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

DayType = Literal["weekday", "weekend", "holiday"]
DEFAULT_TZ = ZoneInfo("America/Los_Angeles")


def _easter(year: int) -> datetime:
    """Anonymous Gregorian computus — Easter Sunday for a given year."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    el = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * el) // 451
    month = (h + el - 7 * m + 114) // 31
    day = ((h + el - 7 * m + 114) % 31) + 1
    return datetime(year, month, day, tzinfo=DEFAULT_TZ).date()


def _nth_weekday_of_month(year: int, month: int, weekday_sun0: int, n: int):
    """Returns the date of the nth occurrence of weekday in month.

    weekday_sun0: 0 = Sunday, 1 = Monday, ..., 6 = Saturday (JS convention).
    """
    first = datetime(year, month, 1, tzinfo=DEFAULT_TZ).date()
    first_dow = (first.weekday() + 1) % 7  # python: Mon=0; convert to Sun=0
    offset = (weekday_sun0 - first_dow + 7) % 7
    day = 1 + offset + (n - 1) * 7
    return datetime(year, month, day, tzinfo=DEFAULT_TZ).date()


def _last_weekday_of_month(year: int, month: int, weekday_sun0: int):
    """Returns the date of the last occurrence of weekday in month."""
    if month == 12:
        first_of_next = datetime(year + 1, 1, 1, tzinfo=DEFAULT_TZ).date()
    else:
        first_of_next = datetime(year, month + 1, 1, tzinfo=DEFAULT_TZ).date()
    last_day = first_of_next - timedelta(days=1)
    last_dow = (last_day.weekday() + 1) % 7
    offset = (last_dow - weekday_sun0 + 7) % 7
    return last_day - timedelta(days=offset)


def _holidays_for_year(year: int):
    thanksgiving = _nth_weekday_of_month(year, 11, 4, 4)  # 4th Thu of Nov
    return [
        datetime(year, 1, 1, tzinfo=DEFAULT_TZ).date(),
        _nth_weekday_of_month(year, 1, 1, 3),       # MLK Jr. Day (3rd Mon Jan)
        _nth_weekday_of_month(year, 2, 1, 3),       # Presidents Day (3rd Mon Feb)
        _easter(year),
        _nth_weekday_of_month(year, 5, 0, 2),       # Mother's Day (2nd Sun May)
        _last_weekday_of_month(year, 5, 1),         # Memorial Day (last Mon May)
        _nth_weekday_of_month(year, 6, 0, 3),       # Father's Day (3rd Sun Jun)
        datetime(year, 6, 19, tzinfo=DEFAULT_TZ).date(),  # Juneteenth
        datetime(year, 7, 4, tzinfo=DEFAULT_TZ).date(),   # Independence Day
        _nth_weekday_of_month(year, 9, 1, 1),       # Labor Day (1st Mon Sep)
        _nth_weekday_of_month(year, 10, 1, 2),      # Columbus Day (2nd Mon Oct)
        datetime(year, 11, 11, tzinfo=DEFAULT_TZ).date(),  # Veterans Day
        thanksgiving,
        thanksgiving + timedelta(days=1),           # Black Friday
        datetime(year, 12, 24, tzinfo=DEFAULT_TZ).date(),
        datetime(year, 12, 25, tzinfo=DEFAULT_TZ).date(),
        datetime(year, 12, 26, tzinfo=DEFAULT_TZ).date(),
        datetime(year, 12, 31, tzinfo=DEFAULT_TZ).date(),
    ]


def is_holiday(when: datetime, tz: ZoneInfo = DEFAULT_TZ) -> bool:
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    local = when.astimezone(tz).date()
    year = local.year
    candidates = (
        _holidays_for_year(year - 1)
        + _holidays_for_year(year)
        + _holidays_for_year(year + 1)
    )
    return local in candidates


def classify_day_type(when: datetime, tz: ZoneInfo = DEFAULT_TZ) -> DayType:
    if is_holiday(when, tz):
        return "holiday"
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    local = when.astimezone(tz)
    # python weekday(): Mon=0 ... Sun=6.  Mon–Thu = weekday, Fri–Sun = weekend.
    dow = local.weekday()
    return "weekday" if dow <= 3 else "weekend"
