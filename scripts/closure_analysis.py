"""Enrich closure events with pre-close and post-reopen wait times.

Outputs scripts/closure_events.csv for notebook/model analysis.

Run from repo root:
  GOOGLE_APPLICATION_CREDENTIALS=firebase-key.json \\
    /Users/tannere/Projects/line-wait-ml/.venv/bin/python scripts/closure_analysis.py
"""
import os
import sys

import firebase_admin
from firebase_admin import credentials, firestore
import pandas as pd

cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
if not cred_path:
    print("Set GOOGLE_APPLICATION_CREDENTIALS=firebase-key.json")
    sys.exit(1)

firebase_admin.initialize_app(credentials.Certificate(cred_path))
db = firestore.client()

print("Reading wait_times (this may take a moment)...")
rows = []
for doc in db.collection("wait_times").select(
    ["ride_id", "ride_name", "status", "wait_minutes", "timestamp_utc",
     "hour_of_day", "day_of_week", "is_holiday"]
).stream():
    d = doc.to_dict()
    if d:
        rows.append(d)

print(f"Read {len(rows)} rows")
df = pd.DataFrame(rows)
df["timestamp_utc"] = pd.to_datetime(df["timestamp_utc"], utc=True)
df = df.sort_values(["ride_id", "timestamp_utc"]).reset_index(drop=True)

closures = []
for ride_id, grp in df.groupby("ride_id"):
    grp = grp.reset_index(drop=True)
    ride_name = grp["ride_name"].iloc[0]

    last_op_wait = None   # most recent OPERATING wait seen
    down_at = None
    wait_at_close = None

    for _, row in grp.iterrows():
        status = row["status"]
        ts = row["timestamp_utc"]
        wait = row.get("wait_minutes")

        if status == "DOWN" and down_at is None:
            # Ride just went down — snapshot the last known OPERATING wait
            down_at = ts
            wait_at_close = last_op_wait

        elif status == "OPERATING" and down_at is not None:
            # Ride just came back up
            duration_min = (ts - down_at).total_seconds() / 60
            delta = (
                (wait_at_close - wait) if wait_at_close is not None and wait is not None
                else None
            )
            closures.append({
                "ride_id": ride_id,
                "ride_name": ride_name,
                "down_at": down_at,
                "back_at": ts,
                "duration_min": round(duration_min, 1),
                "wait_at_close": wait_at_close,
                "wait_at_reopen": wait,
                "delta": delta,           # positive = wait dropped (opportunity)
                "hour_at_reopen": row.get("hour_of_day"),
                "day_of_week": row.get("day_of_week"),
                "is_holiday": row.get("is_holiday", False),
            })
            down_at = None
            wait_at_close = None

        if status == "OPERATING" and wait is not None:
            last_op_wait = wait

cdf = pd.DataFrame(closures)

if cdf.empty:
    print("No closures found.")
    sys.exit(0)

out_path = os.path.join(os.path.dirname(__file__), "closure_events.csv")
cdf.to_csv(out_path, index=False)
print(f"\nWrote {len(cdf)} events to {out_path}")

# --- Summary by closure duration bucket ---
def bucket(d):
    if d < 20:   return "0–20 min"
    if d < 45:   return "20–45 min"
    if d < 90:   return "45–90 min"
    return "90+ min"

cdf["bucket"] = cdf["duration_min"].apply(bucket)
order = ["0–20 min", "20–45 min", "45–90 min", "90+ min"]

print("\n--- Wait delta by closure duration (positive = wait dropped at reopen) ---")
summary = (
    cdf.dropna(subset=["delta"])
    .groupby("bucket")["delta"]
    .agg(count="count", median="median", mean="mean")
    .reindex(order)
    .round(1)
)
print(summary.to_string())

print("\n--- Events with known wait_at_close and wait_at_reopen ---")
known = cdf.dropna(subset=["wait_at_close", "wait_at_reopen"])
print(f"  Total closure events:           {len(cdf)}")
print(f"  Events with both wait values:   {len(known)}")
print(f"  Events missing wait_at_close:   {cdf['wait_at_close'].isna().sum()}")
print(f"  Events missing wait_at_reopen:  {cdf['wait_at_reopen'].isna().sum()}")

# --- Per-ride summary for rides with 10+ events that have delta data ---
print("\n--- Per-ride median delta (rides with 10+ events) ---")
ride_summary = (
    cdf.dropna(subset=["delta"])
    .groupby("ride_name")
    .filter(lambda x: len(x) >= 10)
    .groupby("ride_name")["delta"]
    .agg(count="count", median_delta="median", mean_delta="mean")
    .sort_values("median_delta", ascending=False)
    .round(1)
)
print(ride_summary.to_string())
