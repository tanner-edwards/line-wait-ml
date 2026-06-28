"""One-time backfill: load closure_events.csv into Firestore closure_events/.

The weekly rebuild_profiles workflow reads from Firestore, not the CSV.
Run this once so the rebuild has the full historical dataset to work from.

Uses deterministic document IDs (rideId + closedAt) so re-running is safe —
duplicate writes just overwrite identical data.

Run from repo root:
  GOOGLE_APPLICATION_CREDENTIALS=firebase-key.json python scripts/backfill_closure_events.py
"""

import json
import math
import os
import sys
from pathlib import Path

import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore

CSV_PATH = Path(__file__).parent / "closure_events.csv"
BATCH_SIZE = 400  # Firestore max is 500; stay under for safety


def get_db():
    blob = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if blob:
        cred = credentials.Certificate(json.loads(blob))
    else:
        key = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if not key:
            print("Set GOOGLE_APPLICATION_CREDENTIALS=firebase-key.json")
            sys.exit(1)
        cred = credentials.Certificate(key)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def day_type(row):
    if str(row.get("is_holiday", "")).lower() == "true":
        return "holiday"
    dow = row.get("day_of_week")
    if dow in (5, 6):
        return "weekend"
    return "weekday"


def safe_float(val):
    try:
        f = float(val)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def safe_int(val):
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None


def main():
    if not CSV_PATH.exists():
        print(f"Not found: {CSV_PATH}")
        print("Run scripts/closure_analysis.py first to generate the CSV.")
        sys.exit(1)

    df = pd.read_csv(CSV_PATH)
    print(f"Loaded {len(df)} rows from CSV")

    db = get_db()
    col = db.collection("closure_events")

    # Check how many docs already exist
    existing = col.count().get()[0][0].value
    if existing > 0:
        print(f"closure_events already has {existing} docs — backfill will add alongside them.")

    batch = db.batch()
    batch_count = 0
    total_written = 0
    skipped = 0

    for _, row in df.iterrows():
        ride_id = str(row.get("ride_id", "")).strip()
        closed_at = str(row.get("down_at", "")).strip()

        if not ride_id or not closed_at or closed_at == "nan":
            skipped += 1
            continue

        # Deterministic ID — safe to re-run
        doc_id = f"backfill_{ride_id}_{closed_at}".replace(" ", "T").replace("+", "Z")[:150]
        doc_ref = col.document(doc_id)

        doc = {
            "rideId": ride_id,
            "rideName": str(row.get("ride_name", "")),
            "parkId": None,
            "closedAt": closed_at,
            "reopenedAt": str(row.get("back_at", "")),
            "durationMin": safe_float(row.get("duration_min")),
            "waitAtClose": safe_float(row.get("wait_at_close")),
            "waitAtReopen": safe_float(row.get("wait_at_reopen")),
            "delta": safe_float(row.get("delta")),
            "dayType": day_type(row),
            "hourAtReopen": safe_int(row.get("hour_at_reopen")),
            "dayOfWeek": safe_int(row.get("day_of_week")),
            "source": "historical_csv",
        }

        batch.set(doc_ref, doc)
        batch_count += 1
        total_written += 1

        if batch_count >= BATCH_SIZE:
            batch.commit()
            print(f"  Wrote {total_written} docs...")
            batch = db.batch()
            batch_count = 0

    if batch_count > 0:
        batch.commit()

    print(f"\nDone. Wrote {total_written} docs, skipped {skipped} invalid rows.")
    print("Run the 'Rebuild closure profiles' workflow (or Actions → Run workflow) to rebuild profiles.")


if __name__ == "__main__":
    main()
