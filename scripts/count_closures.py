"""Count DOWN → OPERATING transitions per ride from wait_times.

Run from the repo root:
  GOOGLE_APPLICATION_CREDENTIALS=firebase-key.json .venv/bin/python scripts/count_closures.py
"""
import os
import sys
from collections import defaultdict
from datetime import timezone

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
    ["ride_id", "ride_name", "status", "timestamp_utc"]
).stream():
    d = doc.to_dict()
    if d:
        rows.append(d)

print(f"Read {len(rows)} rows")
df = pd.DataFrame(rows)
df["timestamp_utc"] = pd.to_datetime(df["timestamp_utc"], utc=True)
df = df.sort_values(["ride_id", "timestamp_utc"]).reset_index(drop=True)

# Find DOWN → OPERATING transitions and measure closure duration
closures = []
for ride_id, grp in df.groupby("ride_id"):
    grp = grp.reset_index(drop=True)
    ride_name = grp["ride_name"].iloc[0]
    prev_status = None
    down_at = None
    for _, row in grp.iterrows():
        status = row["status"]
        ts = row["timestamp_utc"]
        if status == "DOWN" and prev_status != "DOWN":
            down_at = ts
        elif status == "OPERATING" and prev_status == "DOWN" and down_at is not None:
            duration_min = (ts - down_at).total_seconds() / 60
            closures.append({
                "ride_id": ride_id,
                "ride_name": ride_name,
                "down_at": down_at,
                "back_at": ts,
                "duration_min": duration_min,
            })
            down_at = None
        prev_status = status

cdf = pd.DataFrame(closures)
if cdf.empty:
    print("No closures found.")
    sys.exit(0)

summary = (
    cdf.groupby("ride_name")["duration_min"]
    .agg(count="count", median="median", mean="mean", min="min", max="max")
    .sort_values("count", ascending=False)
    .round(1)
)

print(f"\nTotal closure events: {len(cdf)}")
print(f"Rides with at least 1 closure: {cdf['ride_id'].nunique()}\n")
print(summary.to_string())
print(f"\nOverall median closure duration: {cdf['duration_min'].median():.1f} min")
print(f"Overall mean closure duration:   {cdf['duration_min'].mean():.1f} min")
