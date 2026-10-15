"""Training-data cleaning: keep only the public park, and only real waits.

Pure functions over the raw collector frame (df_cache.pkl as loaded by the
notebook). Run once, after walk-on normalization and before targets/lags are
built, so that a dropped row never feeds a lag or a target:

    from ml.clean import clean_frame
    df, clean_summary = clean_frame(df, schedules_df, ride_metadata)

Three rules, applied in this order:
1. drop_after_public_close: rows later in the LA day than that park's public
   OPERATING close (removes Oogie Boogie Bash, Grad Nite, After Dark nights in
   one rule). Dates with no schedule are kept: unknown is not a party.
2. drop_party_entities: pseudo-attractions that only exist during a party.
3. zero_to_missing: an OPERATING 0-minute wait on a ride that really posts
   waits is a single-poll glitch, so wait_minutes becomes NaN.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

CRON_DIR = Path(__file__).resolve().parents[1] / "cron"
if str(CRON_DIR) not in sys.path:
    sys.path.insert(0, str(CRON_DIR))
from park_schedule import _minutes_from_midnight, pick_operating_window  # noqa: E402

LA = "America/Los_Angeles"

# Substring match on ride_name. New party-only pseudo-attractions are one line.
PARTY_ENTITY_PATTERNS = ["Oogie Boogie Bash"]

HOURS_COLS = ["park_id", "date_la", "open_minutes", "close_minutes", "has_ticketed_after_close"]


def _schedule_row(date_str: str, entries: list[dict]) -> tuple:
    anchor = pd.Timestamp(date_str).date()
    opening_iso, closing_iso = pick_operating_window(entries)
    open_min = _minutes_from_midnight(opening_iso, anchor_date=anchor) if opening_iso else None
    close_min = _minutes_from_midnight(closing_iso, anchor_date=anchor) if closing_iso else None
    ticketed_after = False
    if close_min is not None:
        for entry in entries or []:
            if entry.get("type") != "TICKETED_EVENT" or not entry.get("openingTime"):
                continue
            start = _minutes_from_midnight(entry["openingTime"], anchor_date=anchor)
            if start is not None and start >= close_min:
                ticketed_after = True
                break
    return anchor, open_min, close_min, ticketed_after


def public_hours(schedules_df: pd.DataFrame) -> pd.DataFrame:
    """One row per (park_id, date_la): the public OPERATING window in LA-local
    minutes from midnight of the schedule date (a 12:00 AM close is 1440).

    open/close are NaN when the day has no OPERATING entry. All times are LA
    local, which is what drop_after_public_close compares against.
    """
    if schedules_df is None or len(schedules_df) == 0:
        return pd.DataFrame(columns=HOURS_COLS)
    rows = [
        _schedule_row(d, e)
        for d, e in zip(schedules_df["date"].to_numpy(), schedules_df["entries"].to_numpy())
    ]
    out = pd.DataFrame(rows, columns=["date_la", "open_minutes", "close_minutes", "has_ticketed_after_close"])
    out.insert(0, "park_id", schedules_df["parkId"].to_numpy())
    out["open_minutes"] = pd.to_numeric(out["open_minutes"], errors="coerce").astype(float)
    out["close_minutes"] = pd.to_numeric(out["close_minutes"], errors="coerce").astype(float)
    out["has_ticketed_after_close"] = out["has_ticketed_after_close"].astype(bool)
    return out.drop_duplicates(["park_id", "date_la"], keep="last").reset_index(drop=True)[HOURS_COLS]


def _local_parts(ts: pd.Series) -> tuple[pd.Series, np.ndarray]:
    """(LA-local midnight as naive datetime64, LA-local minutes from midnight)."""
    local = ts.dt.tz_convert(LA).dt.tz_localize(None)
    day = local.dt.normalize()
    minutes = (local.dt.hour * 60 + local.dt.minute).to_numpy()
    return day, minutes


def _after_close_mask(df: pd.DataFrame, hours: pd.DataFrame) -> tuple[np.ndarray, pd.Series]:
    day, minutes = _local_parts(df["timestamp_utc"])
    keys = pd.DataFrame({"park_id": df["park_id"].to_numpy(), "day": day.to_numpy()})
    h = hours[["park_id", "date_la", "close_minutes"]].copy()
    h["day"] = pd.to_datetime(h["date_la"].astype(str)).astype(keys["day"].dtype)
    close = keys.merge(h[["park_id", "day", "close_minutes"]], on=["park_id", "day"], how="left")["close_minutes"]
    mask = (minutes > close.to_numpy()) & close.notna().to_numpy()
    return mask, day


def drop_after_public_close(df: pd.DataFrame, hours: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Drop rows whose LA-local minutes exceed that (park_id, LA date)'s public
    close. Rows with no matching schedule row, or a day with no OPERATING
    window, are kept."""
    mask, day = _after_close_mask(df, hours)
    label = df["park_name"] if "park_name" in df.columns else df["park_id"]
    dropped = pd.DataFrame({"date": day[mask].dt.date.to_numpy(), "park": label[mask].to_numpy()})
    by_date = dropped.groupby(["date", "park"]).size().sort_index()
    info = {
        "after_public_close": int(mask.sum()),
        "dates_affected": [(d.isoformat(), p, int(n)) for (d, p), n in by_date.items()],
    }
    return df.loc[~mask], info


def drop_party_entities(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Drop rows whose ride_name contains any PARTY_ENTITY_PATTERNS entry."""
    mask = np.zeros(len(df), dtype=bool)
    for pattern in PARTY_ENTITY_PATTERNS:
        mask |= df["ride_name"].astype(str).str.contains(pattern, regex=False).to_numpy()
    return df.loc[~mask], {"party_entities": int(mask.sum())}


def zero_to_missing(df: pd.DataFrame, ride_metadata: dict) -> tuple[pd.DataFrame, dict]:
    """OPERATING rows with wait 0 on a tracks_wait_time ride -> wait_minutes NaN.

    Rides are matched on metadata themeparks_id == df.ride_id; rides absent
    from metadata are untouched. wait_minutes_raw (if present) is left as is.
    """
    tracked = {
        str(v["themeparks_id"])
        for v in (ride_metadata or {}).values()
        if isinstance(v, dict) and v.get("themeparks_id") and v.get("tracks_wait_time") is True
    }
    mask = (
        df["ride_id"].astype(str).isin(tracked).to_numpy()
        & (df["status"] == "OPERATING").to_numpy()
        & (df["wait_minutes"] == 0).to_numpy()
    )
    out = df.copy()
    out.loc[mask, "wait_minutes"] = np.nan
    return out, {"zero_to_missing": int(mask.sum())}


def clean_frame(df: pd.DataFrame, schedules_df: pd.DataFrame, ride_metadata: dict) -> tuple[pd.DataFrame, dict]:
    """Apply drop_after_public_close, drop_party_entities, zero_to_missing in
    that order. Returns (cleaned frame with the same columns, summary)."""
    hours = public_hours(schedules_df)
    n_in = len(df)
    out, s1 = drop_after_public_close(df, hours)
    out, s2 = drop_party_entities(out)
    out, s3 = zero_to_missing(out, ride_metadata)

    parks = set(df["park_id"].astype(str).unique())
    names = dict(zip(schedules_df["parkId"], schedules_df["parkName"])) if len(hours) else {}
    # Limit to the frame's own parks and LA date range, so the list is eyeballable.
    local_day = df["timestamp_utc"].dt.tz_convert(LA)
    first, last = local_day.min().date(), local_day.max().date()
    party = hours[
        hours["has_ticketed_after_close"] & hours["park_id"].isin(parks)
        & (hours["date_la"] >= first) & (hours["date_la"] <= last)
    ]
    party_dates = sorted((d.isoformat(), names.get(p, p)) for p, d in zip(party["park_id"], party["date_la"]))

    summary = {
        "rows_in": n_in,
        "after_public_close": s1["after_public_close"],
        "party_entities": s2["party_entities"],
        "zero_to_missing": s3["zero_to_missing"],
        "rows_out": len(out),
        "dates_affected": s1["dates_affected"],
        "party_dates": party_dates,
    }
    n_dates = len({d for d, _, _ in summary["dates_affected"]})
    print(f"clean: {n_in:,} rows in, {len(out):,} out")
    print(f"  after public close: {summary['after_public_close']:,} rows dropped on {n_dates} dates")
    print(f"  party entities ({', '.join(PARTY_ENTITY_PATTERNS)}): {summary['party_entities']:,} rows dropped")
    print(f"  zero -> NaN on tracked rides: {summary['zero_to_missing']:,} rows; "
          f"{len(party_dates)} ticketed-after-close (park, date) pairs in schedules")
    return out, summary
