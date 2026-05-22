"""One-shot Cloud Run Job: seed the ride_metadata Firestore collection.

Reads ride_metadata.json at the repo root, iterates entries with a non-null
themeparks_id, and upserts each into the `ride_metadata` collection. Doc id =
themeparks_id (the ride UUID). Idempotent — safe to re-run.

Run locally:
    GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-key.json python populate_ride_metadata.py

Run on Cloud Run: deploy as a Cloud Run Job and trigger manually. No service
account env var needed; native Cloud Run identity has Firestore access.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

REPO_ROOT = Path(__file__).resolve().parent.parent
METADATA_PATH = REPO_ROOT / "ride_metadata.json"
BATCH_SIZE = 500  # Firestore batched-write limit

# Slug prefix → themeparks parkId (matches collect.js + the existing
# wait_times / historical_averages convention).
PARK_ID_BY_PREFIX = {
    "dl_": "7340550b-c14d-4def-80bb-acdb51d49a66",   # Disneyland Park
    "dca_": "832fcd51-ea19-4e77-85c7-75d5843b127c",  # Disney California Adventure
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("populate_ride_metadata")


def _init_firestore() -> firestore.Client:
    if not firebase_admin._apps:
        cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if cred_path:
            firebase_admin.initialize_app(credentials.Certificate(cred_path))
        else:
            firebase_admin.initialize_app()
    return firestore.client()


def _park_id_for(slug: str) -> str | None:
    for prefix, park_uuid in PARK_ID_BY_PREFIX.items():
        if slug.startswith(prefix):
            return park_uuid
    return None


def build_records(metadata: dict) -> list[dict]:
    """Filter and shape ride_metadata.json entries into Firestore docs.

    Skips entries where themeparks_id is null (untracked rides like
    walkthroughs and shows). Skips entries with an unknown slug prefix.
    """
    records = []
    skipped_no_id = 0
    skipped_unknown_park = 0
    for slug, entry in metadata.items():
        ride_id = entry.get("themeparks_id")
        if not ride_id:
            skipped_no_id += 1
            continue
        park_id = _park_id_for(slug)
        if not park_id:
            log.warning("Unknown park prefix for slug %r — skipping", slug)
            skipped_unknown_park += 1
            continue
        records.append({
            "rideId": ride_id,
            "parkId": park_id,
            "name": entry["name"],
            "lat": entry.get("lat"),
            "lng": entry.get("lng"),
            "source": "manual",
        })
    log.info(
        "Built %d records; skipped %d (no themeparks_id), %d (unknown park)",
        len(records), skipped_no_id, skipped_unknown_park,
    )
    return records


def write_records(db: firestore.Client, records: list[dict]) -> int:
    if not records:
        log.warning("No records to write")
        return 0

    coll = db.collection("ride_metadata")
    written = 0
    for chunk_start in range(0, len(records), BATCH_SIZE):
        chunk = records[chunk_start : chunk_start + BATCH_SIZE]
        batch = db.batch()
        for rec in chunk:
            doc_ref = coll.document(rec["rideId"])
            batch.set(doc_ref, rec)
        batch.commit()
        written += len(chunk)
        log.info("Wrote %d / %d", written, len(records))
    return written


def main() -> int:
    start = time.monotonic()
    log.info("Reading %s", METADATA_PATH)
    with METADATA_PATH.open() as f:
        metadata = json.load(f)
    records = build_records(metadata)
    db = _init_firestore()
    written = write_records(db, records)
    elapsed = time.monotonic() - start
    log.info("Done. Wrote %d ride_metadata docs in %.2fs", written, elapsed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
