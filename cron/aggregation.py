"""Pure aggregation logic for the historical-averages cron.

Takes a pandas DataFrame of wait_times rows, returns one row per
(parkId, rideId, bucket, dayType) with mean wait + sample count.

Filtering rules (per the v1 spec):
- status != "OPERATING" rows are skipped.
- wait_minutes null rows are skipped.

Output schema:
    parkId       str
    rideId       str
    rideName     str    (a representative ride name from the group)
    bucket       str    e.g. "10:30-11:00"
    dayType      str    "weekday" | "weekend" | "holiday"
    mean         int    rounded
    sampleCount  int
"""
from __future__ import annotations

import pandas as pd

from bucketing import bucket_of
from day_type import classify_day_type


def aggregate(df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate raw wait_times into per-bucket averages.

    Input columns required:
        park_id, ride_id, ride_name, wait_minutes, status, timestamp_utc

    `timestamp_utc` may be either a datetime, a pd.Timestamp, or a Firestore
    Timestamp; pandas handles all three.
    """
    if df.empty:
        return _empty_result()

    # Filter once, vectorized. Beats per-row Python loops.
    filtered = df[(df["status"] == "OPERATING") & df["wait_minutes"].notna()].copy()
    if filtered.empty:
        return _empty_result()

    # Vectorized bucket + dayType labels. pandas .apply() is slower than a
    # vectorized op but the labels are timezone-sensitive — easier to keep one
    # code path than to special-case the vectorization.
    filtered["bucket"] = filtered["timestamp_utc"].apply(bucket_of)
    filtered["dayType"] = filtered["timestamp_utc"].apply(classify_day_type)

    grouped = (
        filtered.groupby(["park_id", "ride_id", "bucket", "dayType"], sort=False)
        .agg(
            ride_name=("ride_name", "first"),
            mean=("wait_minutes", "mean"),
            sampleCount=("wait_minutes", "count"),
        )
        .reset_index()
    )
    grouped["mean"] = grouped["mean"].round().astype(int)
    grouped["sampleCount"] = grouped["sampleCount"].astype(int)

    return grouped.rename(columns={
        "park_id": "parkId",
        "ride_id": "rideId",
        "ride_name": "rideName",
    })


def doc_id(park_id: str, ride_id: str, bucket: str, day_type: str) -> str:
    """Composite document id matching what the TS handler expects."""
    return f"{park_id}__{ride_id}__{bucket}__{day_type}"


def _empty_result() -> pd.DataFrame:
    return pd.DataFrame(
        columns=["parkId", "rideId", "rideName", "bucket", "dayType", "mean", "sampleCount"]
    )
