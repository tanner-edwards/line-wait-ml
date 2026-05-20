"""Cloud Run Job entry point — recompute historical_averages from wait_times.

Reads the last 30 days of `wait_times`, aggregates by
(parkId, rideId, bucket, dayType), and overwrites the `historical_averages`
collection with the result. Runs weekly via Cloud Scheduler.
"""
from __future__ import annotations

import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import firebase_admin
import pandas as pd
from firebase_admin import credentials, firestore

# Allow imports both when run as a module (pytest from repo root) and when
# the container's working dir is /app.
sys.path.insert(0, str(Path(__file__).parent))

from aggregation import aggregate, compute_ride_stats, doc_id, doc_id_stats  # noqa: E402

LOOKBACK_DAYS = 30
BATCH_SIZE = 500  # Firestore batched-write limit

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("cron")


def _init_firestore() -> firestore.Client:
    """Init firebase-admin with the service account.

    Locally: GOOGLE_APPLICATION_CREDENTIALS points at firebase-key.json.
    On Cloud Run: the job runs as a service account with native Firestore
    access — no explicit credentials needed.
    """
    if not firebase_admin._apps:
        cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if cred_path:
            firebase_admin.initialize_app(credentials.Certificate(cred_path))
        else:
            firebase_admin.initialize_app()
    return firestore.client()


def _read_wait_times(db: firestore.Client, cutoff: datetime) -> pd.DataFrame:
    log.info("Reading wait_times since %s", cutoff.isoformat())
    rows = []
    # .select() limits per-row payload to the 6 fields we use.
    query = (
        db.collection("wait_times")
        .where(field_path="timestamp_utc", op_string=">=", value=cutoff)
        .select(["park_id", "ride_id", "ride_name", "wait_minutes", "status", "timestamp_utc"])
    )
    # .stream() processes documents lazily as they arrive — keeps memory flat
    # even at 100k+ rows. The python firestore client doesn't have the same
    # gRPC-buffer-bloat issue we hit on the Node Lambda side.
    for doc in query.stream():
        d = doc.to_dict()
        if not d:
            continue
        rows.append(d)
    df = pd.DataFrame(rows)
    log.info("Read %d rows", len(df))
    return df


def _write_averages(db: firestore.Client, averages: pd.DataFrame) -> int:
    """Overwrite historical_averages with the new aggregates.

    Returns the number of docs written.
    """
    if averages.empty:
        log.warning("No averages to write")
        return 0

    coll = db.collection("historical_averages")
    written = 0

    for chunk_start in range(0, len(averages), BATCH_SIZE):
        chunk = averages.iloc[chunk_start : chunk_start + BATCH_SIZE]
        batch = db.batch()
        for _, row in chunk.iterrows():
            doc_ref = coll.document(
                doc_id(row["parkId"], row["rideId"], row["bucket"], row["dayType"])
            )
            batch.set(
                doc_ref,
                {
                    "parkId": row["parkId"],
                    "rideId": row["rideId"],
                    "rideName": row["rideName"],
                    "bucket": row["bucket"],
                    "dayType": row["dayType"],
                    "mean": int(row["mean"]),
                    "sampleCount": int(row["sampleCount"]),
                },
            )
        batch.commit()
        written += len(chunk)
        log.info("Wrote %d / %d", written, len(averages))

    return written


def _write_ride_stats(db: firestore.Client, stats: pd.DataFrame) -> int:
    """Overwrite ride_stats with the new p10/p90 data.

    Returns the number of docs written.
    """
    if stats.empty:
        log.warning("No ride_stats to write")
        return 0

    coll = db.collection("ride_stats")
    written = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for chunk_start in range(0, len(stats), BATCH_SIZE):
        chunk = stats.iloc[chunk_start : chunk_start + BATCH_SIZE]
        batch = db.batch()
        for _, row in chunk.iterrows():
            doc_ref = coll.document(
                doc_id_stats(row["parkId"], row["rideId"], row["dayType"])
            )
            batch.set(
                doc_ref,
                {
                    "parkId": row["parkId"],
                    "rideId": row["rideId"],
                    "dayType": row["dayType"],
                    "p10": int(row["p10"]),
                    "p90": int(row["p90"]),
                    "sampleCount": int(row["sampleCount"]),
                    "updatedAt": now_iso,
                },
            )
        batch.commit()
        written += len(chunk)
        log.info("ride_stats: wrote %d / %d", written, len(stats))

    return written


def main() -> int:
    start = time.monotonic()
    db = _init_firestore()

    cutoff = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    df = _read_wait_times(db, cutoff)

    averages = aggregate(df)
    log.info("Aggregated into %d buckets", len(averages))
    written = _write_averages(db, averages)

    stats = compute_ride_stats(df)
    log.info("Computed ride_stats for %d (ride, dayType) pairs", len(stats))
    stats_written = _write_ride_stats(db, stats)

    elapsed = time.monotonic() - start
    log.info(
        "Done in %.1fs — wrote %d historical_averages + %d ride_stats docs",
        elapsed, written, stats_written,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
