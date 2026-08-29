"""One-time backfill: historical DLR park schedules into Firestore.

Pulls themeparks.wiki's /entity/{parkId}/schedule/{yyyy}/{mm} month-range
endpoint across historical months and writes park_schedules/{parkId}_{date}
docs — the same collection/doc-ID scheme collect.js writes going forward
(see ~/.claude/specs/line-wait-ml/park-hours-integration.md). Idempotent:
deterministic doc IDs, blind set(), safe to re-run or resume.

Research confirmed the endpoint returns genuine historical data (not an
echo of today), correctly labels TICKETED_EVENT early-close days, and needs
no auth. DLR's real coverage boundary sits somewhere around its April 2021
COVID reopening — START_YEAR_MONTH below is set well before that on purpose;
months with no data are logged and skipped, so there's no need to pin the
exact boundary.

Run locally:
    GOOGLE_APPLICATION_CREDENTIALS=../firebase-key.json python backfill_park_schedules.py
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date

import firebase_admin
from firebase_admin import credentials, firestore

API_BASE = "https://api.themeparks.wiki/v1"
BATCH_SIZE = 500  # Firestore batched-write limit
REQUEST_DELAY_SECONDS = 0.25
START_YEAR_MONTH = (2018, 1)  # deliberately early; empty months are skipped

# DLR only — matches predict.py's current scope (see park-hours-integration spec).
PARKS = [
    {"id": "7340550b-c14d-4def-80bb-acdb51d49a66", "name": "Disneyland Park"},
    {"id": "832fcd51-ea19-4e77-85c7-75d5843b127c", "name": "Disney California Adventure Park"},
]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("backfill_park_schedules")


def _init_firestore() -> firestore.Client:
    if not firebase_admin._apps:
        cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if cred_path:
            firebase_admin.initialize_app(credentials.Certificate(cred_path))
        else:
            firebase_admin.initialize_app()
    return firestore.client()


def _months_through(start_year: int, start_month: int, end: date):
    y, m = start_year, start_month
    while (y, m) <= (end.year, end.month):
        yield y, m
        m += 1
        if m > 12:
            m = 1
            y += 1


def _fetch_month(park_id: str, year: int, month: int) -> dict | None:
    url = f"{API_BASE}/entity/{park_id}/schedule/{year}/{month:02d}"
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        log.warning("HTTP %s for %s %d-%02d", e.code, park_id, year, month)
        return None
    except Exception as e:
        log.warning("Fetch failed for %s %d-%02d: %s", park_id, year, month, e)
        return None


def _group_by_date(schedule: list[dict]) -> dict[str, list[dict]]:
    by_date: dict[str, list[dict]] = {}
    for entry in schedule:
        d = entry.get("date")
        if not d:
            continue
        by_date.setdefault(d, []).append({
            "type": entry.get("type"),
            "openingTime": entry.get("openingTime"),
            "closingTime": entry.get("closingTime"),
        })
    return by_date


def _flush(db: firestore.Client, pending: list[tuple[str, dict]]) -> int:
    if not pending:
        return 0
    coll = db.collection("park_schedules")
    batch = db.batch()
    for doc_id, data in pending:
        batch.set(coll.document(doc_id), data)
    batch.commit()
    return len(pending)


def backfill_park(db: firestore.Client, park: dict, end: date) -> int:
    written = 0
    pending: list[tuple[str, dict]] = []
    months_with_data = 0
    months_empty = 0

    for year, month in _months_through(*START_YEAR_MONTH, end):
        data = _fetch_month(park["id"], year, month)
        time.sleep(REQUEST_DELAY_SECONDS)
        schedule = (data or {}).get("schedule", [])
        if not schedule:
            months_empty += 1
            continue
        months_with_data += 1
        by_date = _group_by_date(schedule)
        for d, entries in by_date.items():
            pending.append((f"{park['id']}_{d}", {
                "parkId": park["id"], "parkName": park["name"], "date": d, "entries": entries,
            }))
        log.info("%s %d-%02d: %d dates", park["name"], year, month, len(by_date))

        if len(pending) >= BATCH_SIZE:
            written += _flush(db, pending[:BATCH_SIZE])
            pending = pending[BATCH_SIZE:]

    written += _flush(db, pending)
    log.info(
        "%s: %d months with data, %d empty, %d date-docs written",
        park["name"], months_with_data, months_empty, written,
    )
    return written


def main() -> int:
    start = time.monotonic()
    db = _init_firestore()
    today = date.today()
    total = 0
    for park in PARKS:
        log.info(
            "Backfilling %s (%s) from %d-%02d through %d-%02d",
            park["name"], park["id"], START_YEAR_MONTH[0], START_YEAR_MONTH[1], today.year, today.month,
        )
        total += backfill_park(db, park, today)
    elapsed = time.monotonic() - start
    log.info("Done. Wrote %d park_schedules docs across %d parks in %.1fs", total, len(PARKS), elapsed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
