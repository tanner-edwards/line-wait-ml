"""Rebuild per-ride closure duration + delta profiles in Firestore.

Reads from closure_events/ (written by scanner.js on each reopen) and
writes one doc per ride to closure_profiles/{ride_id}.

Runs weekly via the club32-predict-cron Cloud Run Job (triggered by
.github/workflows/rebuild_profiles.yml).
"""
import os
import sys
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials, firestore
import pandas as pd
import numpy as np


def get_db():
    blob = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if blob:
        import json
        cred = credentials.Certificate(json.loads(blob))
    else:
        key = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if not key:
            print("Set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS")
            sys.exit(1)
        cred = credentials.Certificate(key)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def main():
    db = get_db()

    print("Reading closure_events from Firestore...")
    rows = []
    for doc in db.collection("closure_events").stream():
        d = doc.to_dict()
        if d:
            rows.append(d)
    print(f"Read {len(rows)} closure events")

    if not rows:
        print("No closure events found — nothing to build.")
        return

    df = pd.DataFrame(rows)

    # Normalise field names written by scanner.js (camelCase) to snake_case
    df = df.rename(columns={
        "rideId": "ride_id",
        "rideName": "ride_name",
        "durationMin": "duration_min",
        "waitAtClose": "wait_at_close",
        "waitAtReopen": "wait_at_reopen",
    })

    # Recompute delta in case older docs are missing it
    if "delta" not in df.columns:
        df["delta"] = df["wait_at_close"] - df["wait_at_reopen"]

    now_iso = datetime.now(timezone.utc).isoformat()
    written = 0
    skipped = 0

    for ride_id, grp in df.groupby("ride_id"):
        ride_name = grp["ride_name"].iloc[0]
        durations = grp["duration_min"].dropna().values
        n = len(durations)

        if n < 5:
            skipped += 1
            continue

        # Short reset threshold: 70th percentile, clamped to [15, 120] min.
        # Rides still down past this are in the extended-closure regime.
        threshold = float(np.clip(np.percentile(durations, 70), 15.0, 120.0))

        ext = grp[grp["duration_min"] > threshold]
        ext_durations = ext["duration_min"].dropna().values
        ext_n = len(ext_durations)

        ext_p50 = round(float(np.percentile(ext_durations, 50)), 1) if ext_n >= 3 else None
        ext_p75 = round(float(np.percentile(ext_durations, 75)), 1) if ext_n >= 3 else None

        ext_deltas = ext["delta"].dropna().values
        ext_median_delta = round(float(np.median(ext_deltas)), 1) if len(ext_deltas) >= 3 else None

        doc = {
            "rideId": ride_id,
            "rideName": ride_name,
            "sampleCount": int(n),
            "shortResetThresholdMin": round(threshold, 1),
            "p50Min": round(float(np.percentile(durations, 50)), 1),
            "p75Min": round(float(np.percentile(durations, 75)), 1),
            "p90Min": round(float(np.percentile(durations, 90)), 1),
            "extendedSampleCount": int(ext_n),
            "extendedP50Min": ext_p50,
            "extendedP75Min": ext_p75,
            "extendedMedianDelta": ext_median_delta,
            "updatedAt": now_iso,
        }

        db.collection("closure_profiles").document(ride_id).set(doc)
        written += 1
        print(f"  {ride_name[:45]:<45}  threshold={threshold:5.0f}m  n={n:4d}  ext_n={ext_n:3d}")

    print(f"\nWrote {written} profiles, skipped {skipped} rides (< 5 events)")


if __name__ == "__main__":
    main()
