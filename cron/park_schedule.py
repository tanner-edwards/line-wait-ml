"""Reads today's park open/close window for full-day-forecast masking.

Data source: the `park_schedules` Firestore collection, written once/day per
park by collect.js from the themeparks.wiki `/schedule` response it already
fetches every run. predict.py never calls that endpoint itself — see
~/.claude/specs/line-wait-ml/park-hours-integration.md.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from firebase_admin import firestore

LA_TZ = ZoneInfo("America/Los_Angeles")

log = logging.getLogger("park_schedule")


def _la_date_string(when: datetime, tz: ZoneInfo = LA_TZ) -> str:
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when.astimezone(tz).strftime("%Y-%m-%d")


def _minutes_from_midnight(iso_time: str, tz: ZoneInfo = LA_TZ) -> int | None:
    try:
        dt = datetime.fromisoformat(iso_time)
    except (TypeError, ValueError):
        return None
    local = dt.astimezone(tz)
    return local.hour * 60 + local.minute


def get_todays_close_minutes(
    db: firestore.Client, park_id: str, now_la: datetime
) -> int | None:
    """LA-local minutes-from-midnight of today's public OPERATING close.

    Returns None — "don't mask" — when the doc is missing (write gap, or
    before this collection existed), or there's no OPERATING entry for today
    (e.g. a ticketed-event-only day). Ticketed-event closingTimes are
    deliberately ignored: a regular guest isn't in the park during that
    window, so the forecast isn't for them anyway.
    """
    doc_id = f"{park_id}_{_la_date_string(now_la)}"
    try:
        snap = db.collection("park_schedules").document(doc_id).get()
    except Exception as e:
        log.warning("park_schedules read failed for %s: %s", doc_id, e)
        return None
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    for entry in data.get("entries", []):
        if entry.get("type") == "OPERATING" and entry.get("closingTime"):
            return _minutes_from_midnight(entry["closingTime"])
    return None
