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

# Closures longer than this are overnight park-close-to-open spans, not
# real breakdowns. Filtering them out before computing profiles prevents
# a ride that happened to go down at 9 PM from looking like it was broken
# for 11 hours.
OVERNIGHT_CUTOFF_MIN = 360

# Candidate split points (minutes) to try when finding the natural blip/break
# seam for each ride.
SPLIT_THRESHOLDS = [15, 20, 25, 30, 40, 45, 60]

# Minimum events required in each bucket for a split to be considered.
MIN_SPLIT_EVENTS = 5

# When break MAE exceeds this, the prediction is too unreliable to surface.
# The backend will return null for predictedReopenAt rather than show a
# misleading estimate.
BREAK_MAE_SUPPRESS_THRESHOLD = 80


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


def mae(actuals, prediction):
    return float(np.mean(np.abs(actuals - prediction)))


def find_best_split(durations):
    """Try each threshold; return the one with the lowest weighted MAE.

    Returns a dict with split details, or None if no threshold produces
    enough events in both buckets.
    """
    best = None
    for t in SPLIT_THRESHOLDS:
        blips = durations[durations <= t]
        breaks = durations[durations > t]
        if len(blips) < MIN_SPLIT_EVENTS or len(breaks) < MIN_SPLIT_EVENTS:
            continue
        blip_pred = float(np.median(blips))
        break_pred = float(np.median(breaks))
        blip_mae = mae(blips, blip_pred)
        break_mae = mae(breaks, break_pred)
        n = len(durations)
        combined = (len(blips) / n * blip_mae) + (len(breaks) / n * break_mae)
        if best is None or combined < best["combined_mae"]:
            best = {
                "threshold": t,
                "blip_n": len(blips),
                "blip_p50": round(blip_pred, 1),
                "blip_mae": round(blip_mae, 1),
                "break_n": len(breaks),
                "break_p50": round(break_pred, 1),
                "break_p75": round(float(np.percentile(breaks, 75)), 1),
                "break_mae": round(break_mae, 1),
                "combined_mae": round(combined, 1),
            }
    return best


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

    if "delta" not in df.columns:
        df["delta"] = df["wait_at_close"] - df["wait_at_reopen"]

    df = df[df["duration_min"].notna() & (df["duration_min"] > 0)]

    # Drop overnight spans before computing anything
    before = len(df)
    df = df[df["duration_min"] <= OVERNIGHT_CUTOFF_MIN]
    dropped = before - len(df)
    if dropped > 0:
        print(f"Filtered {dropped} overnight spans (>{OVERNIGHT_CUTOFF_MIN} min)")

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

        split = find_best_split(durations)

        if split:
            # Use the data-driven optimal split threshold
            threshold = float(split["threshold"])
            blip_p50 = split["blip_p50"]
            break_p50 = split["break_p50"]
            break_p75 = split["break_p75"]
            break_mae = split["break_mae"]
            ext_n = split["break_n"]
        else:
            # Not enough data for a split — fall back to 70th-percentile threshold
            threshold = float(np.clip(np.percentile(durations, 70), 15.0, 120.0))
            blip_p50 = round(float(np.percentile(durations, 50)), 1)
            ext = durations[durations > threshold]
            ext_n = len(ext)
            break_p50 = round(float(np.percentile(ext, 50)), 1) if ext_n >= 3 else None
            break_p75 = round(float(np.percentile(ext, 75)), 1) if ext_n >= 3 else None
            break_mae = None

        ext_rows = grp[grp["duration_min"] > threshold]
        ext_deltas = ext_rows["delta"].dropna().values
        ext_median_delta = round(float(np.median(ext_deltas)), 1) if len(ext_deltas) >= 3 else None

        doc = {
            "rideId": ride_id,
            "rideName": ride_name,
            "sampleCount": int(n),
            # Split threshold: the point at which a closure has moved from
            # "quick reset" to "real breakdown" for this specific ride.
            "shortResetThresholdMin": round(threshold, 1),
            # p50Min is the blip median — what to predict while the closure
            # is still in the short-reset window.
            "p50Min": blip_p50,
            # p75/p90 across all closures (for context/display).
            "p75Min": round(float(np.percentile(durations, 75)), 1),
            "p90Min": round(float(np.percentile(durations, 90)), 1),
            # Extended (break) bucket
            "extendedSampleCount": int(ext_n),
            "extendedP50Min": break_p50,
            "extendedP75Min": break_p75,
            "extendedMedianDelta": ext_median_delta,
            # MAE of break predictions. When null (not enough split data) or
            # above BREAK_MAE_SUPPRESS_THRESHOLD, the backend suppresses
            # predictedReopenAt for extended closures rather than show a
            # misleading estimate.
            "breakMaeMin": round(break_mae, 1) if break_mae is not None else None,
            "updatedAt": now_iso,
        }

        db.collection("closure_profiles").document(ride_id).set(doc)
        written += 1
        mae_str = f"breakMAE={break_mae:5.1f}m" if break_mae is not None else "breakMAE=     —"
        print(f"  {ride_name[:45]:<45}  split={threshold:3.0f}m  n={n:4d}  {mae_str}")

    print(f"\nWrote {written} profiles, skipped {skipped} rides (< 5 events)")


if __name__ == "__main__":
    main()
