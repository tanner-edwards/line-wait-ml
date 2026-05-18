"""30-minute time-of-day bucketing. Mirrors `app/backend/src/bucketing.ts`.

The cron uses this to label each wait_times sample by its LA-local 30-min
window. Bucket label format: "HH:MM-HH:MM" using LA-local wall-clock time.
"""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

DEFAULT_TZ = ZoneInfo("America/Los_Angeles")


def bucket_of(when: datetime, tz: ZoneInfo = DEFAULT_TZ) -> str:
    """Returns the 30-min bucket label for the given moment.

    Examples:
        10:00 PT -> "10:00-10:30"
        10:42 PT -> "10:30-11:00"
        23:55 PT -> "23:30-00:00"

    Buckets wrap at midnight for cosmetic clarity; the cron treats them as
    opaque string keys so the wraparound is irrelevant to the math.
    """
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    local = when.astimezone(tz)
    h, m = local.hour, local.minute
    start_min = 0 if m < 30 else 30
    end_min = 30 if start_min == 0 else 0
    end_hour = h if start_min == 0 else (h + 1) % 24
    return f"{h:02d}:{start_min:02d}-{end_hour:02d}:{end_min:02d}"
