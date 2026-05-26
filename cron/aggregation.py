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


def doc_id_stats(park_id: str, ride_id: str, day_type: str) -> str:
    """Composite document id for the ride_stats collection (no bucket dimension)."""
    return f"{park_id}__{ride_id}__{day_type}"


def compute_ride_stats(df: pd.DataFrame) -> pd.DataFrame:
    """Compute p10/p90 per (parkId, rideId, dayType) from raw observations.

    Groups across ALL time buckets — gives the overall floor/ceiling for a
    ride on a given day type, not a per-hour view. Used by the frontend to
    contextualise how the current wait compares to the ride's historic range.

    Output schema:
        parkId       str
        rideId       str
        dayType      str   "weekday" | "weekend" | "holiday"
        p10          int   10th percentile of raw wait_minutes
        p50          int   50th percentile (median) of raw wait_minutes
        p90          int   90th percentile of raw wait_minutes
        sampleCount  int   number of raw observations used
    """
    if df.empty:
        return pd.DataFrame(columns=["parkId", "rideId", "dayType", "p10", "p50", "p90", "sampleCount"])

    filtered = df[(df["status"] == "OPERATING") & df["wait_minutes"].notna()].copy()
    if filtered.empty:
        return pd.DataFrame(columns=["parkId", "rideId", "dayType", "p10", "p50", "p90", "sampleCount"])

    filtered["dayType"] = filtered["timestamp_utc"].apply(classify_day_type)

    grouped = (
        filtered.groupby(["park_id", "ride_id", "dayType"], sort=False)
        .agg(
            p10=("wait_minutes", lambda x: x.quantile(0.1)),
            p50=("wait_minutes", lambda x: x.quantile(0.5)),
            p90=("wait_minutes", lambda x: x.quantile(0.9)),
            sampleCount=("wait_minutes", "count"),
        )
        .reset_index()
    )
    grouped["p10"] = grouped["p10"].round().astype(int)
    grouped["p50"] = grouped["p50"].round().astype(int)
    grouped["p90"] = grouped["p90"].round().astype(int)
    grouped["sampleCount"] = grouped["sampleCount"].astype(int)

    return grouped.rename(columns={"park_id": "parkId", "ride_id": "rideId"})


def _empty_result() -> pd.DataFrame:
    return pd.DataFrame(
        columns=["parkId", "rideId", "rideName", "bucket", "dayType", "mean", "sampleCount"]
    )
