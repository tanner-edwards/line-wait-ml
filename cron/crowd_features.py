"""Crowd feature engineering — one implementation for training and serving.

Three resort-level signals the models use, plus the lookup tables that turn
raw sums into ratios:

  crowd_level_ratio    float — 12-poll (2h) rolling sum of OPERATING waits /
                               the typical rolling sum for the same key.
                               NaN before 10am or when < 8 rides report.
  morning_crowd_index  float — a statistic of OPERATING waits in the first
                               120 min after the park opened / the typical
                               value for the same key.
  regime thresholds    dict  — per-ride P25/P75 of OPERATING waits, keyed by
                               ride_name so seasonal overlays (Haunted
                               Mansion Holiday, Hyperspace Mountain) that share
                               a ride_id with their base ride get their own.

Why one module: the training code used to live in notebook cells and was
re-implemented by hand in predict.py with no parity test, and the baseline
JSONs were keyed by calendar month, so a new month looked up a missing key and
fed the model None. The exported tables now carry `_meta` (keyed_by, version,
parks) and serving builds its keys from `_meta`, never from a hard-coded
format. A table with no `_meta` is read as the legacy v1 format
(`{day_type}_{hour}_{month}` / `{day_type}_{month}`) so new code works with
old JSONs while deploys are half done.

keyed_by is a tuple drawn from ("park", "day_type", "hour", "month") for the
ratio and ("park", "day_type", "month") for the morning index. With "park" the
sums, open times and statistics are computed per park_id; without it they are
resort-wide (the v1 behavior). ("day_type", "hour", "month") reproduces the v1
notebook values exactly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRAINING TIME (notebook / ml/):

    import sys; sys.path.insert(0, 'cron')
    from crowd_features import crowd_level_ratio_frame, crowd_expected_table
    all_rows = pd.Series(True, index=df_sorted.index)
    df_sorted['crowd_level_ratio'] = crowd_level_ratio_frame(df_sorted, all_rows, ("day_type", "hour"))
    crowd_level_baselines = crowd_expected_table(df_sorted, all_rows, ("day_type", "hour"))

  Experiments pass the forward-split train mask as fit_mask so the expected
  tables never see a test day.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INFERENCE TIME (predict.py):

    crowd_by_park = crowd_level_ratio_live(df, now_la, hol, crowd_baselines)
    feat_row["crowd_level_ratio"] = crowd_by_park.get(park_id)
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

log = logging.getLogger("crowd_features")

KEY_VERSION = 2
DL_PARK_ID = "7340550b-c14d-4def-80bb-acdb51d49a66"
DCA_PARK_ID = "832fcd51-ea19-4e77-85c7-75d5843b127c"
PARK_LABELS = {DL_PARK_ID: "dl", DCA_PARK_ID: "dca"}  # unknown id → first 8 chars

LEGACY_CROWD_KEYED_BY = ("day_type", "hour", "month")
LEGACY_MORNING_KEYED_BY = ("day_type", "month")

ROLLING_POLLS = 12          # 2h of 10-min polls
ROLLING_MIN_PERIODS = 6
MIN_RIDES = 8
COLD_START_HOUR = 10
MORNING_WINDOW_MIN = 120


# ── Keys ──────────────────────────────────────────────────────────────────────

def day_type(is_holiday: bool, js_dow: int) -> str:
    """'holiday' > 'weekend' (JS dow 0 or 6) > 'weekday'."""
    if bool(is_holiday):
        return "holiday"
    return "weekend" if int(js_dow) in (0, 6) else "weekday"


def _day_types(df: pd.DataFrame) -> pd.Series:
    values = np.select(
        [df["is_holiday"].astype(bool), df["day_of_week"].isin([0, 6])],
        ["holiday", "weekend"], default="weekday",
    )
    return pd.Series(values, index=df.index)


def park_label(park_id: str | None, parks_meta: dict | None = None) -> str:
    """Short label for a park id: from parks_meta when it has the id, else
    PARK_LABELS, else the id's first 8 characters."""
    if parks_meta and park_id in parks_meta:
        return parks_meta[park_id]
    if park_id in PARK_LABELS:
        return PARK_LABELS[park_id]
    return str(park_id)[:8]


def _key(parts: dict, keyed_by, parks_meta: dict | None = None) -> str:
    out = []
    for k in keyed_by:
        if k == "park":
            out.append(park_label(parts["park"], parks_meta))
        elif k == "day_type":
            out.append(str(parts["day_type"]))
        else:
            out.append(str(int(parts[k])))
    return "|".join(out)


def crowd_key(
    day_type: str, hour: int, park_id: str | None = None,
    keyed_by=("day_type", "hour"), month: int | None = None, parks_meta: dict | None = None,
) -> str:
    """'|'-joined key in keyed_by order, e.g. 'dca|weekend|14' or 'weekend|14'."""
    return _key({"park": park_id, "day_type": day_type, "hour": hour, "month": month}, keyed_by, parks_meta)


def morning_key(
    day_type: str, park_id: str | None = None, keyed_by=("day_type",),
    month: int | None = None, parks_meta: dict | None = None,
) -> str:
    """'|'-joined key in keyed_by order, e.g. 'dl|weekday' or 'weekday'."""
    return _key({"park": park_id, "day_type": day_type, "month": month}, keyed_by, parks_meta)


def legacy_crowd_key(day_type: str, hour: int, month: int) -> str:
    return f"{day_type}_{int(hour)}_{int(month)}"


def legacy_morning_key(day_type: str, month: int) -> str:
    return f"{day_type}_{int(month)}"


def _parks_meta(df: pd.DataFrame) -> dict:
    return {pid: park_label(pid) for pid in sorted(df["park_id"].dropna().unique())}


def _meta(df: pd.DataFrame, keyed_by, **extra) -> dict:
    return {"keyed_by": list(keyed_by), "version": KEY_VERSION, "parks": _parks_meta(df), **extra}


def _stat(values: pd.Series | pd.core.groupby.SeriesGroupBy, stat: str):
    """'median' or 'pNN' (e.g. 'p75') of a Series or a grouped Series."""
    if stat == "median":
        return values.median()
    if stat.startswith("p"):
        return values.quantile(int(stat[1:]) / 100)
    raise ValueError(f"unknown stat {stat!r}")


# ── crowd_level_ratio: training time ─────────────────────────────────────────

def _poll_sums(df: pd.DataFrame, fit_mask: pd.Series, keyed_by) -> tuple[pd.DataFrame, list[str]]:
    """One row per poll (per park when keyed by park): rolling sum, rolling
    min ride count, key parts, and whether the poll is a fit poll."""
    group = ["park_id"] if "park" in keyed_by else []
    op = df[(df["status"] == "OPERATING") & df["wait_minutes"].notna()]
    op = op.assign(_day_type=_day_types(op), _fit=fit_mask.reindex(op.index).fillna(False).astype(bool))
    polls = (
        op.groupby(group + ["timestamp_utc"])
        .agg(
            park_sum=("wait_minutes", "sum"),
            n_rides=("ride_id", "nunique"),
            hour_of_day=("hour_of_day", "first"),
            day_type=("_day_type", "first"),
            month=("month", "first"),
            fit=("_fit", "max"),
        )
        .reset_index()
        .sort_values(group + ["timestamp_utc"])
    )
    if group:
        g = polls.groupby(group, sort=False)
        polls["rolling_sum"] = g["park_sum"].transform(lambda s: s.rolling(ROLLING_POLLS, min_periods=ROLLING_MIN_PERIODS).sum())
        polls["rolling_n_rides"] = g["n_rides"].transform(lambda s: s.rolling(ROLLING_POLLS, min_periods=1).min())
    else:
        polls["rolling_sum"] = polls["park_sum"].rolling(ROLLING_POLLS, min_periods=ROLLING_MIN_PERIODS).sum()
        polls["rolling_n_rides"] = polls["n_rides"].rolling(ROLLING_POLLS, min_periods=1).min()
    return polls, group


def _key_cols(keyed_by) -> list[str]:
    return [{"park": "park_id", "day_type": "day_type", "hour": "hour_of_day", "month": "month"}[k] for k in keyed_by]


def crowd_level_ratio_frame(df: pd.DataFrame, fit_mask: pd.Series, keyed_by=("day_type", "hour")) -> pd.Series:
    """crowd_level_ratio for every row of df (aligned to df.index).

    Expected = median rolling sum by key over fit polls only. NaN when
    hour_of_day < 10, when the window's minimum ride count is < 8, or when the
    key has no fit polls.
    """
    polls, group = _poll_sums(df, fit_mask, keyed_by)
    cols = _key_cols(keyed_by)
    expected = polls[polls["fit"]].groupby(cols)["rolling_sum"].median().rename("expected_sum").reset_index()
    polls = polls.merge(expected, on=cols, how="left")
    ratio = polls["rolling_sum"] / polls["expected_sum"]
    ratio[(polls["hour_of_day"] < COLD_START_HOUR) | (polls["rolling_n_rides"] < MIN_RIDES)] = np.nan
    polls["crowd_level_ratio"] = ratio
    on = group + ["timestamp_utc"]
    out = df[on].merge(polls[on + ["crowd_level_ratio"]], on=on, how="left")["crowd_level_ratio"]
    out.index = df.index
    return out.rename("crowd_level_ratio")


def crowd_expected_table(df: pd.DataFrame, fit_mask: pd.Series, keyed_by=("day_type", "hour")) -> dict:
    """Export dict for crowd_level_baselines.json: {"_meta": ..., key: expected_sum (1 dp)}."""
    polls, _ = _poll_sums(df, fit_mask, keyed_by)
    cols = _key_cols(keyed_by)
    expected = polls[polls["fit"]].groupby(cols)["rolling_sum"].median()
    meta = _meta(df, keyed_by)
    table: dict = {"_meta": meta}
    for idx, value in expected.items():
        if pd.isna(value):
            continue
        parts = dict(zip(keyed_by, idx if isinstance(idx, tuple) else (idx,)))
        table[_key(parts, keyed_by, meta["parks"])] = round(float(value), 1)
    return table


# ── morning_crowd_index: training time ───────────────────────────────────────

def _morning_actuals(
    df: pd.DataFrame, fit_mask: pd.Series, keyed_by, ride_filter, stat: str,
) -> tuple[pd.DataFrame, list[str]]:
    """One row per date (per park when keyed by park): actual statistic, key
    parts, and whether every window row is a fit row."""
    group = (["park_id"] if "park" in keyed_by else []) + ["date_la"]
    operating = df[df["status"] == "OPERATING"]
    opens = operating.groupby(group)["timestamp_utc"].min().rename("_open").reset_index()
    rows = df[(df["status"] == "OPERATING") & df["wait_minutes"].notna()]
    if ride_filter is not None:
        rows = rows[rows["ride_id"].isin(set(ride_filter))]
    rows = rows[group + ["timestamp_utc", "wait_minutes"]].assign(
        _fit=fit_mask.reindex(rows.index).fillna(False).astype(bool)
    ).merge(opens, on=group, how="left")
    in_window = (rows["timestamp_utc"] >= rows["_open"]) & (
        rows["timestamp_utc"] <= rows["_open"] + pd.Timedelta(minutes=MORNING_WINDOW_MIN))
    window = rows[in_window]
    g = window.groupby(group)
    actual = pd.DataFrame({"actual": _stat(g["wait_minutes"], stat), "fit": g["_fit"].all()}).reset_index()

    date_meta = df[["date_la", "day_of_week", "is_holiday"]].drop_duplicates("date_la")
    date_meta = date_meta.assign(
        day_type=_day_types(date_meta),
        month=pd.to_datetime(date_meta["date_la"].astype(str)).dt.month,
    )[["date_la", "day_type", "month"]]
    return actual.merge(date_meta, on="date_la", how="left"), group


def _morning_cols(keyed_by) -> list[str]:
    return [{"park": "park_id", "day_type": "day_type", "month": "month"}[k] for k in keyed_by]


def morning_crowd_index_frame(
    df: pd.DataFrame, fit_mask: pd.Series, keyed_by=("day_type",), ride_filter=None, stat: str = "median",
) -> pd.Series:
    """morning_crowd_index for every row of df (aligned to df.index), joined by date (and park).

    Window: OPERATING rows with a wait in [open, open + 120 min], where open is
    the first OPERATING snapshot of the date (per park when keyed by park).
    ride_filter restricts the statistic, not the open time. Expected = median
    of the daily statistic by key over dates whose window is all fit rows.
    """
    actual, group = _morning_actuals(df, fit_mask, keyed_by, ride_filter, stat)
    cols = _morning_cols(keyed_by)
    expected = actual[actual["fit"]].groupby(cols)["actual"].median().rename("expected").reset_index()
    actual = actual.merge(expected, on=cols, how="left")
    actual["morning_crowd_index"] = actual["actual"] / actual["expected"]
    out = df[group].merge(actual[group + ["morning_crowd_index"]], on=group, how="left")["morning_crowd_index"]
    out.index = df.index
    return out.rename("morning_crowd_index")


def morning_expected_table(
    df: pd.DataFrame, fit_mask: pd.Series, keyed_by=("day_type",), ride_filter=None, stat: str = "median",
) -> dict:
    """Export dict for morning_baselines.json: {"_meta": ..., key: expected}.

    _meta carries stat and, when a filter is used, headliner_ride_ids, so
    serving computes the same statistic over the same rides.
    """
    actual, _ = _morning_actuals(df, fit_mask, keyed_by, ride_filter, stat)
    cols = _morning_cols(keyed_by)
    expected = actual[actual["fit"]].groupby(cols)["actual"].median()
    extra = {"stat": stat}
    if ride_filter is not None:
        extra["headliner_ride_ids"] = sorted(ride_filter)
    meta = _meta(df, keyed_by, **extra)
    table: dict = {"_meta": meta}
    for idx, value in expected.items():
        if pd.isna(value):
            continue
        parts = dict(zip(keyed_by, idx if isinstance(idx, tuple) else (idx,)))
        table[_key(parts, keyed_by, meta["parks"])] = float(value)
    return table


def headliner_ride_ids(df: pd.DataFrame, fit_mask: pd.Series, min_median: float = 20) -> list[str]:
    """Rides whose median OPERATING wait over fit rows is >= min_median."""
    op = df[fit_mask.reindex(df.index).fillna(False).astype(bool)
            & (df["status"] == "OPERATING") & df["wait_minutes"].notna()]
    med = op.groupby("ride_id")["wait_minutes"].median()
    return sorted(med[med >= min_median].index.tolist())


# ── Regime thresholds ─────────────────────────────────────────────────────────

def regime_thresholds(df: pd.DataFrame, fit_mask: pd.Series | None = None) -> dict:
    """P25/P75 of OPERATING waits keyed by ride_name, plus every ride_id as a
    fallback key holding the thresholds of that id's most common name."""
    op = df[(df["status"] == "OPERATING") & df["wait_minutes"].notna()]
    if fit_mask is not None:
        op = op[fit_mask.reindex(op.index).fillna(False).astype(bool)]
    percs = op.groupby("ride_name")["wait_minutes"].quantile([0.25, 0.75]).unstack()
    percs.columns = ["p25", "p75"]
    by_name = percs.round(2).to_dict(orient="index")
    out: dict = {"_meta": {"keyed_by": ["ride_name"], "version": KEY_VERSION}}
    out.update(by_name)
    top_name = op.groupby("ride_id")["ride_name"].agg(lambda s: s.value_counts().index[0])
    for ride_id, name in top_name.items():
        out[str(ride_id)] = dict(by_name[name])
    return out


def regime_for(thresholds: dict, ride_name: str | None, ride_id: str) -> dict:
    """Thresholds for a ride: by name first, then by id, else {}."""
    if isinstance(ride_name, str) and ride_name and ride_name != "_meta":
        hit = thresholds.get(ride_name)
        if hit:
            return hit
    return thresholds.get(str(ride_id)) or {}


# ── Serving ───────────────────────────────────────────────────────────────────

def _js_dow(now_la: datetime) -> int:
    return (now_la.weekday() + 1) % 7


def _park_ids(frame: pd.DataFrame) -> list:
    if frame.empty or "park_id" not in frame.columns:
        return []
    return list(frame["park_id"].dropna().unique())


def _lookup(baselines: dict, key: str, warned: set):
    expected = baselines.get(key)
    if not expected:
        if key not in warned:
            log.warning("crowd baseline miss: %s", key)
            warned.add(key)
        return None
    return float(expected)


def crowd_level_ratio_live(window_df: pd.DataFrame, now_la: datetime, hol: dict, baselines: dict) -> dict:
    """{park_id: crowd_level_ratio or None} for every park_id in window_df.

    Mirrors crowd_level_ratio_frame at the latest poll: the sum over the last
    12 polls in the 2h before now (at least 6), None when any of those polls
    has < 8 OPERATING rides or before 10am. With a resort-wide baseline every
    park gets the same value.
    """
    parks = _park_ids(window_df)
    if not parks:
        return {}
    meta = baselines.get("_meta")
    keyed_by = tuple(meta["keyed_by"]) if meta else LEGACY_CROWD_KEYED_BY
    parks_meta = (meta or {}).get("parks")
    if now_la.hour < COLD_START_HOUR:
        return {pid: None for pid in parks}

    cutoff = now_la.astimezone(timezone.utc) - timedelta(hours=2)
    op = window_df[
        (window_df["timestamp_utc"] >= cutoff)
        & (window_df["status"] == "OPERATING")
        & window_df["wait_minutes"].notna()
    ]
    dt = day_type(hol["is_holiday"], _js_dow(now_la))
    warned: set = set()

    def ratio_for(rows: pd.DataFrame, park_id) -> float | None:
        polls = rows.groupby("timestamp_utc").agg(
            park_sum=("wait_minutes", "sum"), n_rides=("ride_id", "nunique")
        ).sort_index().tail(ROLLING_POLLS)
        if len(polls) < ROLLING_MIN_PERIODS or polls["n_rides"].min() < MIN_RIDES:
            return None
        if meta:
            key = crowd_key(dt, now_la.hour, park_id, keyed_by, month=now_la.month, parks_meta=parks_meta)
        else:
            key = legacy_crowd_key(dt, now_la.hour, now_la.month)
        expected = _lookup(baselines, key, warned)
        return None if expected is None else round(float(polls["park_sum"].sum()) / expected, 3)

    if "park" in keyed_by:
        return {pid: ratio_for(op[op["park_id"] == pid], pid) for pid in parks}
    value = ratio_for(op, None)
    return {pid: value for pid in parks}


def morning_crowd_index_live(morning_df: pd.DataFrame, now_la: datetime, hol: dict, baselines: dict) -> dict:
    """{park_id: morning_crowd_index or None} for every park_id in morning_df.

    None until 120 min have passed since the (park's) first OPERATING snapshot
    today. The statistic, ride filter and key come from baselines["_meta"];
    a table with no _meta is the v1 resort-wide median keyed by day_type+month.
    """
    parks = _park_ids(morning_df)
    if not parks:
        return {}
    meta = baselines.get("_meta")
    keyed_by = tuple(meta["keyed_by"]) if meta else LEGACY_MORNING_KEYED_BY
    parks_meta = (meta or {}).get("parks")
    stat = (meta or {}).get("stat", "median")
    ride_filter = (meta or {}).get("headliner_ride_ids")
    now_utc = now_la.astimezone(timezone.utc)
    dt = day_type(hol["is_holiday"], _js_dow(now_la))
    warned: set = set()

    def index_for(rows: pd.DataFrame, park_id) -> float | None:
        operating = rows[rows["status"] == "OPERATING"]
        if operating.empty:
            return None
        park_open = operating["timestamp_utc"].min()
        if (now_utc - park_open.to_pydatetime()).total_seconds() / 60 < MORNING_WINDOW_MIN:
            return None
        window = operating[
            operating["wait_minutes"].notna()
            & (operating["timestamp_utc"] >= park_open)
            & (operating["timestamp_utc"] <= park_open + pd.Timedelta(minutes=MORNING_WINDOW_MIN))
        ]
        if ride_filter is not None:
            window = window[window["ride_id"].isin(set(ride_filter))]
        if window.empty:
            return None
        actual = float(_stat(window["wait_minutes"], stat))
        if meta:
            key = morning_key(dt, park_id, keyed_by, month=now_la.month, parks_meta=parks_meta)
        else:
            key = legacy_morning_key(dt, now_la.month)
        expected = _lookup(baselines, key, warned)
        return None if expected is None else round(actual / expected, 3)

    if "park" in keyed_by:
        return {pid: index_for(morning_df[morning_df["park_id"] == pid], pid) for pid in parks}
    value = index_for(morning_df, None)
    return {pid: value for pid in parks}
