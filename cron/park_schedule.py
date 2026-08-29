"""Reads park open/close windows and derives close-time-relative features.

Data source: the `park_schedules` Firestore collection, written once/day per
park by collect.js from the themeparks.wiki `/schedule` response it already
fetches every run (and separately backfilled historically — see
cron/backfill_park_schedules.py). predict.py never calls that endpoint
itself — see ~/.claude/specs/line-wait-ml/park-hours-integration.md.

pick_operating_window() is the single "which entry counts as operating"
implementation, shared between predict.py's single-doc live reads and the
training notebook's bulk historical join — same pattern as day_type.py /
closure_features.py being shared between the notebook and predict.py.
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


def pick_operating_window(entries: list[dict]) -> tuple[str | None, str | None]:
    """(openingTime, closingTime) ISO strings from the OPERATING entry.

    Ticketed-event entries are deliberately ignored: a regular guest isn't in
    the park during a ticketed-only window, so it isn't "operating" for their
    purposes. Returns (None, None) when there's no OPERATING entry with both
    times present (e.g. a ticketed-event-only day, or a malformed entry).
    """
    for entry in entries or []:
        if entry.get("type") == "OPERATING" and entry.get("openingTime") and entry.get("closingTime"):
            return entry["openingTime"], entry["closingTime"]
    return None, None


def get_todays_hours(
    db: firestore.Client, park_id: str, now_la: datetime
) -> tuple[int | None, int | None]:
    """(open_minutes, close_minutes) — LA-local minutes-from-midnight of
    today's public OPERATING window, or (None, None) when unknown (missing
    doc, write gap, or no OPERATING entry today). Callers should treat None
    as "unknown" and skip whatever they were going to do with it.
    """
    doc_id = f"{park_id}_{_la_date_string(now_la)}"
    try:
        snap = db.collection("park_schedules").document(doc_id).get()
    except Exception as e:
        log.warning("park_schedules read failed for %s: %s", doc_id, e)
        return None, None
    if not snap.exists:
        return None, None
    data = snap.to_dict() or {}
    opening_iso, closing_iso = pick_operating_window(data.get("entries", []))
    if not opening_iso or not closing_iso:
        return None, None
    return _minutes_from_midnight(opening_iso), _minutes_from_midnight(closing_iso)


def minutes_until_close(current_minutes: int, close_minutes: int) -> int:
    """How many minutes from `current_minutes` until `close_minutes`.

    Can go negative (a moment after today's recorded close) — callers decide
    how to treat that; this function just does the subtraction.
    """
    return close_minutes - current_minutes


def operating_hours(open_minutes: int, close_minutes: int) -> float:
    """Total public operating hours for the day, e.g. 8am-11pm -> 15.0."""
    return (close_minutes - open_minutes) / 60
