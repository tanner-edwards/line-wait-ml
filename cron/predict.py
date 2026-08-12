"""ML inference script — runs every 10 min via Cloud Run Jobs.

For each ride with enough recent data:
  - Computes trajectory predictions (T+10 → T+240 minutes)
  - Derives trend / confidence from the forecast curve
  - Computes a 34-slot full-day forecast (7:00 AM – 11:30 PM PT)
  - Writes to predictions/{ride_id} in Firestore

Environment variables:
  MODEL_BUCKET                   GCS bucket containing model .txt files +
                                 feature_categories.json
  GOOGLE_APPLICATION_CREDENTIALS path to service-account key (local dev only)
"""
from __future__ import annotations

import json
import logging
import os
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import firebase_admin
import lightgbm as lgb
import pandas as pd
from firebase_admin import credentials, firestore
from google.cloud import storage

sys.path.insert(0, str(Path(__file__).parent))
from day_type import holiday_features  # noqa: E402
from closure_features import CLOSURE_FEATURE_COLS, slot_closure_context, empty_closure_context  # noqa: E402

LA_TZ = ZoneInfo("America/Los_Angeles")

HORIZONS = [10, 20, 30, 40, 50, 60, 90, 120, 150, 180, 210, 240]
LOOKBACK_MINUTES = 120
BATCH_SIZE = 400

DAY_PROFILE_FEATURE_COLS = [
    "ride_id_cat",
    "hour_of_day", "day_of_week", "week_of_year", "month",
    "temp_high_f", "morning_crowd_index",
    "is_holiday", "is_holiday_weekend",
    "days_until_next_holiday", "days_since_last_holiday",
] + CLOSURE_FEATURE_COLS

# 34 half-hour slots: 7:00 AM (420 min) to 11:30 PM (1410 min)
FULL_DAY_SLOTS = [
    (
        start,
        f"{start // 60:02d}:{start % 60:02d}-"
        f"{(start + 30) // 60:02d}:{(start + 30) % 60:02d}",
    )
    for start in range(420, 1440, 30)
]

TRAJECTORY_FEATURE_COLS = [
    "wait_minutes", "wait_lag_1", "wait_lag_2", "wait_lag_3",
    "park_crowd_median",
    "hour_of_day", "day_of_week", "week_of_year", "month",
    "is_holiday", "is_holiday_weekend",
    "days_until_next_holiday", "days_since_last_holiday",
    "minutes_since_last_status_change", "closure_duration_minutes",
    "ride_id_cat", "status_cat",
]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("predict")


# ── Setup ─────────────────────────────────────────────────────────────────────

def _init_firestore() -> firestore.Client:
    if not firebase_admin._apps:
        cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if cred_path:
            firebase_admin.initialize_app(credentials.Certificate(cred_path))
        else:
            firebase_admin.initialize_app()
    return firestore.client()


def _download_models(bucket_name: str, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    files = (
        [f"trajectory_t{h}.txt" for h in HORIZONS]
        + ["day_profile.txt", "feature_categories.json", "morning_baselines.json",
           "reversion_model.txt", "ride_percentile_buckets.json"]
    )
    for name in files:
        bucket.blob(name).download_to_filename(str(dest / name))
        log.info("Downloaded %s", name)


def _load_models(model_dir: Path):
    traj = {h: lgb.Booster(model_file=str(model_dir / f"trajectory_t{h}.txt")) for h in HORIZONS}
    day_profile = lgb.Booster(model_file=str(model_dir / "day_profile.txt"))
    cats = json.loads((model_dir / "feature_categories.json").read_text())
    baselines = json.loads((model_dir / "morning_baselines.json").read_text())
    reversion = lgb.Booster(model_file=str(model_dir / "reversion_model.txt"))
    pct_buckets = json.loads((model_dir / "ride_percentile_buckets.json").read_text())
    return traj, day_profile, cats["ride_id_categories"], cats["status_categories"], baselines, reversion, pct_buckets


# ── Data loading ──────────────────────────────────────────────────────────────

def _read_morning_waits(db: firestore.Client, now_la: datetime) -> pd.DataFrame:
    """Read all wait_times from midnight LA-local today through now.

    Used exclusively for morning_crowd_index — the main df only looks back
    LOOKBACK_MINUTES, which falls short of the morning window after ~10am.
    """
    midnight_utc = now_la.replace(
        hour=0, minute=0, second=0, microsecond=0
    ).astimezone(timezone.utc)
    rows = []
    query = (
        db.collection("wait_times")
        .where("timestamp_utc", ">=", midnight_utc)
        .select(["ride_id", "wait_minutes", "status", "timestamp_utc"])
    )
    for doc in query.stream():
        d = doc.to_dict()
        if d:
            rows.append(d)
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["timestamp_utc"] = pd.to_datetime(df["timestamp_utc"], utc=True)
    return df


def _compute_morning_crowd_index(
    morning_df: pd.DataFrame,
    now_la: datetime,
    morning_baselines: dict,
    hol: dict,
) -> float | None:
    """Compute today's morning crowd index.

    Returns None when fewer than 120 minutes of park data exist for today
    (cold start — LightGBM will handle the null and fall back to day-type patterns).
    """
    if morning_df.empty:
        return None

    operating = morning_df[
        (morning_df["status"] == "OPERATING") & morning_df["wait_minutes"].notna()
    ]
    if operating.empty:
        return None

    park_open = operating["timestamp_utc"].min()
    now_utc = now_la.astimezone(timezone.utc)
    elapsed = (now_utc - park_open.to_pydatetime()).total_seconds() / 60
    if elapsed < 120:
        return None

    morning_cutoff = park_open + pd.Timedelta(minutes=120)
    window = operating[
        (operating["timestamp_utc"] >= park_open) &
        (operating["timestamp_utc"] <= morning_cutoff)
    ]
    if window.empty:
        return None

    actual_median = float(window["wait_minutes"].median())

    js_dow = (now_la.weekday() + 1) % 7
    if hol["is_holiday"]:
        day_type = "holiday"
    elif js_dow in (0, 6):
        day_type = "weekend"
    else:
        day_type = "weekday"

    key = f"{day_type}_{now_la.month}"
    expected = morning_baselines.get(key)
    if not expected:
        return None

    return round(actual_median / float(expected), 3)


def _read_current_weather(db: firestore.Client) -> dict:
    """Return current weather features from the most recent weather_snapshots doc.

    Falls back to neutral values (mild, dry) if no doc is found.
    """
    docs = list(
        db.collection("weather_snapshots")
        .order_by("timestamp_utc", direction=firestore.Query.DESCENDING)
        .limit(1)
        .stream()
    )
    if docs:
        d = docs[0].to_dict()
        precip = d.get("precipitation_mm") or 0.0
        code = d.get("weather_code") or 0
        return {
            "temp_current_f": float(d.get("temperature_f") or 65.0),
            "is_raining_now": float(precip > 0 or code >= 61),
        }
    return {"temp_current_f": 65.0, "is_raining_now": 0.0}


def _fetch_daily_weather_forecast(lat: float, lon: float, tz: str) -> dict:
    """Fetch today's high temp and rain flag from Open-Meteo daily forecast.

    Falls back to neutral values if the API call fails.
    """
    import urllib.request
    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        f"&daily=temperature_2m_max,precipitation_sum"
        f"&temperature_unit=fahrenheit"
        f"&timezone={tz.replace('/', '%2F')}"
        f"&forecast_days=1"
    )
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read())
        temp_high = data["daily"]["temperature_2m_max"][0]
        precip = data["daily"]["precipitation_sum"][0] or 0.0
        return {
            "temp_high_f": float(temp_high) if temp_high is not None else 75.0,
            "will_rain": float(precip > 0),
        }
    except Exception as exc:
        log.warning("Weather forecast fetch failed: %s — using defaults", exc)
        return {"temp_high_f": 75.0, "will_rain": 0.0}


def _read_recent(db: firestore.Client, cutoff: datetime) -> pd.DataFrame:
    log.info("Reading wait_times since %s", cutoff.isoformat())
    rows = []
    query = (
        db.collection("wait_times")
        .where("timestamp_utc", ">=", cutoff)
        .select([
            "ride_id", "park_id", "wait_minutes", "status", "timestamp_utc",
            "hour_of_day", "day_of_week", "month",
            "is_holiday", "is_holiday_weekend",
            "days_until_next_holiday", "days_since_last_holiday",
        ])
    )
    for doc in query.stream():
        d = doc.to_dict()
        if d:
            rows.append(d)
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["timestamp_utc"] = pd.to_datetime(df["timestamp_utc"], utc=True)
    return df.sort_values(["ride_id", "timestamp_utc"]).reset_index(drop=True)


# ── Feature engineering ───────────────────────────────────────────────────────

def _build_trajectory_row(
    ride_df: pd.DataFrame,
    ride_id_cats: list[str],
    status_cats: list[str],
) -> dict | None:
    """Return a single trajectory feature dict for the most recent snapshot.

    Returns None when the ride's recent history is too sparse or gappy for
    reliable lag features (e.g. just opened, or gap > 13 min in last 3 snaps).
    """
    if len(ride_df) < 4:
        return None

    r = ride_df.tail(10).reset_index(drop=True)
    last = r.iloc[-1]

    if pd.isna(last["wait_minutes"]):
        return None

    # Validate backward time gaps are within expected 10-min poll windows
    def mins_back(n: int) -> float | None:
        if len(r) <= n:
            return None
        return (r.iloc[-1]["timestamp_utc"] - r.iloc[-1 - n]["timestamp_utc"]).total_seconds() / 60

    m1, m2, m3 = mins_back(1), mins_back(2), mins_back(3)
    if m1 is None or not (8 <= m1 <= 13):
        return None
    if m2 is None or not (17 <= m2 <= 25):
        return None
    if m3 is None or not (26 <= m3 <= 37):
        return None

    lag1 = r.iloc[-2]["wait_minutes"]
    lag2 = r.iloc[-3]["wait_minutes"]
    lag3 = r.iloc[-4]["wait_minutes"]
    if any(pd.isna(v) for v in (lag1, lag2, lag3)):
        return None

    # minutes_since_last_status_change — how long has the ride been in its
    # current status? Discounts post-reopen inflation in the first few snapshots.
    current_status = last["status"]
    streak_start = len(r) - 1
    for i in range(len(r) - 2, -1, -1):
        if r.iloc[i]["status"] == current_status:
            streak_start = i
        else:
            break
    mins_since_change = max(
        0.0,
        (last["timestamp_utc"] - r.iloc[streak_start]["timestamp_utc"]).total_seconds() / 60,
    )

    # closure_duration_minutes — how long was the ride down before the most
    # recent reopen event in the lookback window?
    closure_duration = 0.0
    for i in range(len(r) - 1, 0, -1):
        if r.iloc[i - 1]["status"] == "DOWN" and r.iloc[i]["status"] == "OPERATING":
            down_count = 0
            for j in range(i - 1, -1, -1):
                if r.iloc[j]["status"] == "DOWN":
                    down_count += 1
                else:
                    break
            closure_duration = down_count * 10.0
            break
        if r.iloc[i]["status"] != "OPERATING":
            break  # not currently in a post-reopen window

    return {
        "wait_minutes":                    float(last["wait_minutes"]),
        "wait_lag_1":                      float(lag1),
        "wait_lag_2":                      float(lag2),
        "wait_lag_3":                      float(lag3),
        "hour_of_day":                     int(last["hour_of_day"]),
        "day_of_week":                     int(last["day_of_week"]),
        "week_of_year":                    int(last["timestamp_utc"].isocalendar().week),
        "month":                           int(last["month"]),
        "is_holiday":                      bool(last["is_holiday"]),
        "is_holiday_weekend":              bool(last["is_holiday_weekend"]),
        "days_until_next_holiday":         int(last["days_until_next_holiday"]),
        "days_since_last_holiday":         int(last["days_since_last_holiday"]),
        "minutes_since_last_status_change": float(mins_since_change),
        "closure_duration_minutes":        float(closure_duration),
        # Keep as strings — converted to pd.Categorical in main() so LightGBM
        # sees the same dtype as during training.
        "ride_id_cat":                     last["ride_id"],
        "status_cat":                      last["status"],
    }


# ── Prediction helpers ────────────────────────────────────────────────────────

def _derive_trend(
    current_wait: float,
    lag1: float,
    preds: dict[int, float],
) -> tuple[str, float, str]:
    """Return (trend, trend_delta_30, confidence) from the trajectory predictions."""
    t10   = preds[10]
    t30   = preds[30]
    delta30 = round(t30 - current_wait, 1)

    # Base direction from T+30 delta
    if delta30 >= 5:
        # Wait is rising — check if we're emerging from a trough
        trend = "trough" if (current_wait - lag1) >= 5 else "rising"
    elif delta30 <= -5:
        # Wait is falling — check if we're coming off a peak
        trend = "peak" if (lag1 - current_wait) >= 5 else "falling"
    else:
        trend = "stable"

    # Confidence: how many of the 9 horizons agree on the direction of delta30?
    if abs(delta30) < 2:
        confidence = "low"
    else:
        deltas = [preds[h] - current_wait for h in HORIZONS]
        same_dir = sum(1 for d in deltas if (d >= 0) == (delta30 >= 0))
        confidence = "high" if same_dir >= 7 else ("medium" if same_dir >= 5 else "low")

    return trend, delta30, confidence


def _read_today_closures(
    db: firestore.Client,
    now_la: datetime,
) -> dict[str, list[dict]]:
    """Read completed closures from today from closure_events Firestore collection.

    Returns dict of ride_id -> list of closure dicts:
        { closed_at_min: int, reopened_at_min: int, duration_min: float }
    where times are minutes since midnight PT.

    Using closure_events (written by scanner.js) rather than expanding LOOKBACK_MINUTES
    so we see closures from early in the day even when running at 8 PM.
    """
    today_start = now_la.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = today_start.astimezone(timezone.utc).isoformat()

    result: dict[str, list[dict]] = {}
    try:
        query = db.collection("closure_events").where("reopenedAt", ">=", today_start_utc)
        for doc in query.stream():
            d = doc.to_dict()
            if not d or not d.get("rideId") or not d.get("closedAt") or not d.get("reopenedAt"):
                continue
            try:
                closed_la = datetime.fromisoformat(d["closedAt"]).astimezone(LA_TZ)
                reopened_la = datetime.fromisoformat(d["reopenedAt"]).astimezone(LA_TZ)
            except (ValueError, TypeError):
                continue
            duration = d.get("durationMin")
            if not duration:
                continue
            # Match training-time closure detection exactly (add_closure_features):
            #  - drop overnight spans (> 360 min)
            #  - drop cross-midnight closures; training groups by PT calendar day,
            #    so a closure that starts one day and reopens the next is never a
            #    detected closure there. Keeping it here would be train/infer skew.
            if float(duration) > 360 or float(duration) <= 0:
                continue
            if closed_la.date() != reopened_la.date():
                continue
            ride_id = d["rideId"]
            if ride_id not in result:
                result[ride_id] = []
            result[ride_id].append({
                "closed_at_min": closed_la.hour * 60 + closed_la.minute,
                "reopened_at_min": reopened_la.hour * 60 + reopened_la.minute,
                "duration_min": float(duration),
            })
    except Exception as e:
        log.warning("_read_today_closures failed — proceeding without closure context: %s", e)
    return result


def _build_full_day(
    ride_id: str,
    now_la: datetime,
    day_profile_model: lgb.Booster,
    ride_id_cats: list[str],
    hol: dict,
    closures_today: list[dict] | None = None,
    traj_preds: dict[int, float] | None = None,
    daily_weather: dict | None = None,
    morning_crowd_index: float | None = None,
) -> list[dict]:
    """Run the day-profile model for all 34 half-hour slots.

    closures_today: completed closures for this ride today, from _read_today_closures.
                    Each entry: { closed_at_min, reopened_at_min, duration_min }.
                    When None or empty, closure features default to "no closure today."

    traj_preds: trajectory predictions keyed by horizon in minutes. When provided,
                the slots that fall within the T+30–T+240 window are overridden with
                trajectory values so the full-day curve doesn't jump at the seam where
                the trajectory model hands off to the day-profile model.
    """
    # collect.js stores day_of_week in JS convention (Sun=0); convert from Python (Mon=0)
    js_dow = (now_la.weekday() + 1) % 7
    ride_closures = closures_today or []

    rows = []
    for start_min, _ in FULL_DAY_SLOTS:
        closure_ctx = slot_closure_context(ride_closures, start_min) if ride_closures else empty_closure_context()
        rows.append({
            "ride_id_cat":                      ride_id,
            "hour_of_day":                      start_min // 60,
            "day_of_week":                      js_dow,
            "week_of_year":                     now_la.isocalendar().week,
            "month":                            now_la.month,
            "temp_high_f":                      (daily_weather or {}).get("temp_high_f", 75.0),
            "morning_crowd_index":              morning_crowd_index,
            "is_holiday":                       hol["is_holiday"],
            "is_holiday_weekend":               hol["is_holiday_weekend"],
            "days_until_next_holiday":          hol["days_until_next_holiday"],
            "days_since_last_holiday":          hol["days_since_last_holiday"],
            **closure_ctx,
        })

    X_profile = pd.DataFrame(rows)[DAY_PROFILE_FEATURE_COLS]
    X_profile["morning_crowd_index"] = X_profile["morning_crowd_index"].astype(float)
    X_profile["ride_id_cat"] = pd.Categorical(X_profile["ride_id_cat"], categories=ride_id_cats)
    preds = day_profile_model.predict(X_profile)
    slots = [
        {
            "time_slot":     time_slot,
            "start_minutes": start_min,
            "wait":          max(0, round(float(p))),
        }
        for (start_min, time_slot), p in zip(FULL_DAY_SLOTS, preds)
    ]

    # Override near-future slots with trajectory predictions to smooth the seam.
    # For each trajectory horizon, find the 30-min slot it falls into and replace
    # the day-profile value with the trajectory value.
    if traj_preds:
        now_min = now_la.hour * 60 + now_la.minute
        slot_index = {s["start_minutes"]: i for i, s in enumerate(slots)}
        for h in [30, 60, 90, 120, 150, 180, 210, 240]:
            if h not in traj_preds:
                continue
            target_min = ((now_min + h) // 30) * 30
            if target_min in slot_index:
                slots[slot_index[target_min]]["wait"] = max(0, round(float(traj_preds[h])))

    return slots


# ── Reversion inference ───────────────────────────────────────────────────────

_REVERSION_BREAKPOINTS = [0.05, 0.10, 0.15, 0.25, 0.50, 0.75, 0.85, 0.90, 0.95]
_REVERSION_PCT_KEYS    = ["p5", "p10", "p15", "p25", "p50", "p75", "p85", "p90", "p95"]


def _compute_pct_rank(
    wait: float,
    ride_id: str,
    hour: int,
    day_type: str,
    buckets: dict,
) -> float:
    """Interpolate current wait into [0,1] percentile rank using pre-computed bucket breakpoints.
    Falls back to 0.5 (neutral) when the bucket is absent or has no breakpoints."""
    key = f"{ride_id}__{hour}_{day_type}"
    b = buckets.get(key)
    if not b:
        return 0.5
    breakpoints = list(zip(_REVERSION_BREAKPOINTS, [b.get(k, 0) for k in _REVERSION_PCT_KEYS]))
    if wait <= breakpoints[0][1]:
        return breakpoints[0][0]
    if wait >= breakpoints[-1][1]:
        return breakpoints[-1][0]
    for i in range(len(breakpoints) - 1):
        pct_lo, val_lo = breakpoints[i]
        pct_hi, val_hi = breakpoints[i + 1]
        if val_lo <= wait <= val_hi:
            t = (wait - val_lo) / (val_hi - val_lo) if val_hi > val_lo else 0.5
            return round(pct_lo + t * (pct_hi - pct_lo), 3)
    return 0.5


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    t0 = time.monotonic()

    bucket_name = os.environ.get("MODEL_BUCKET")
    if not bucket_name:
        log.error("MODEL_BUCKET env var not set")
        return 1

    with tempfile.TemporaryDirectory() as tmpdir:
        model_dir = Path(tmpdir)
        _download_models(bucket_name, model_dir)
        traj_models, day_profile_model, ride_id_cats, status_cats, morning_baselines, reversion_model, percentile_buckets = _load_models(model_dir)

        db = _init_firestore()
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=LOOKBACK_MINUTES)
        df = _read_recent(db, cutoff)

        if df.empty:
            log.warning("No recent wait_times rows — parks likely closed")
            return 0

        log.info("Read %d rows across %d rides", len(df), df["ride_id"].nunique())

        now = datetime.now(timezone.utc)
        now_la = now.astimezone(LA_TZ)
        hol = holiday_features(now)

        # Read today's completed closures once — passed per-ride to _build_full_day
        # so the day-profile model knows what kind of day it is for each ride.
        today_closures = _read_today_closures(db, now_la)
        log.info("Read today's closures for %d rides", len(today_closures))

        # Current weather (trajectory features) + daily forecast (day-profile features).
        current_weather = _read_current_weather(db)
        daily_weather = _fetch_daily_weather_forecast(33.8121, -117.9190, "America/Los_Angeles")
        log.info("Weather — current: %.1f°F rain=%s | forecast high: %.1f°F will_rain=%s",
                 current_weather["temp_current_f"], bool(current_weather["is_raining_now"]),
                 daily_weather["temp_high_f"], bool(daily_weather["will_rain"]))

        # Park-wide crowd proxy — median operating wait at the most recent poll.
        # Matches the training-time computation in the notebook.
        latest_ts = df["timestamp_utc"].max()
        _operating_at_latest = df.loc[
            (df["timestamp_utc"] == latest_ts) & (df["status"] == "OPERATING"),
            "wait_minutes",
        ]
        park_crowd_median = float(
            _operating_at_latest.median() if not _operating_at_latest.empty
            else df["wait_minutes"].median()
        )
        log.info("park_crowd_median: %.1f min", park_crowd_median)

        # Morning crowd index — requires a full 120-min morning window; null during cold start.
        morning_df = _read_morning_waits(db, now_la)
        morning_crowd_index = _compute_morning_crowd_index(morning_df, now_la, morning_baselines, hol)
        log.info("morning_crowd_index: %s", morning_crowd_index)

        prediction_docs = []
        for ride_id, ride_df in df.groupby("ride_id"):
            feat_row = _build_trajectory_row(ride_df, ride_id_cats, status_cats)
            if feat_row is None:
                continue
            feat_row["park_crowd_median"] = park_crowd_median

            X = pd.DataFrame([feat_row])[TRAJECTORY_FEATURE_COLS]
            X["ride_id_cat"] = pd.Categorical(X["ride_id_cat"], categories=ride_id_cats)
            X["status_cat"]  = pd.Categorical(X["status_cat"],  categories=status_cats)
            traj_preds = {
                h: max(0.0, round(float(m.predict(X)[0]), 1))
                for h, m in traj_models.items()
            }

            trend, trend_delta_30, confidence = _derive_trend(
                feat_row["wait_minutes"], feat_row["wait_lag_1"], traj_preds
            )

            full_day = _build_full_day(
                ride_id, now_la, day_profile_model, ride_id_cats, hol,
                closures_today=today_closures.get(ride_id),
                traj_preds=traj_preds,
                daily_weather=daily_weather,
                morning_crowd_index=morning_crowd_index,
            )

            # Reversion probability — day_type must match training-time classify_day_type
            feat_dow = int(feat_row["day_of_week"])  # JS convention: Sun=0, Sat=6
            if hol["is_holiday"]:          rev_day_type = "holiday"
            elif feat_dow in (0, 6):       rev_day_type = "weekend"
            else:                          rev_day_type = "weekday"

            pct_rank = _compute_pct_rank(
                float(feat_row["wait_minutes"]),
                ride_id,
                int(feat_row["hour_of_day"]),
                rev_day_type,
                percentile_buckets,
            )
            wait_delta_1 = float(feat_row["wait_minutes"]) - float(feat_row["wait_lag_1"])

            X_rev = pd.DataFrame([{
                "pct_rank":           pct_rank,
                "wait_delta_1":       wait_delta_1,
                "hour_of_day":        feat_row["hour_of_day"],
                "day_of_week":        feat_row["day_of_week"],
                "week_of_year":       feat_row["week_of_year"],
                "park_crowd_median":  park_crowd_median,
                "is_holiday":         feat_row["is_holiday"],
                "is_holiday_weekend": feat_row["is_holiday_weekend"],
                "ride_id_cat":        ride_id,
            }])
            X_rev["ride_id_cat"] = pd.Categorical(X_rev["ride_id_cat"], categories=ride_id_cats)
            reversion_prob = round(float(reversion_model.predict(X_rev)[0]), 3)

            prediction_docs.append({
                "ride_id":        ride_id,
                "updated_at":     now.isoformat(),
                "t10":            traj_preds[10],
                "t20":            traj_preds[20],
                "t30":            traj_preds[30],
                "t40":            traj_preds[40],
                "t50":            traj_preds[50],
                "t60":            traj_preds[60],
                "t90":            traj_preds[90],
                "t120":           traj_preds[120],
                "t150":           traj_preds[150],
                "t180":           traj_preds[180],
                "t210":           traj_preds[210],
                "t240":           traj_preds[240],
                "trend":          trend,
                "trend_delta_30": trend_delta_30,
                "confidence":     confidence,
                "full_day":       full_day,
                "reversion_prob": reversion_prob,
                "pct_rank":       pct_rank,
            })

        log.info("Built predictions for %d rides", len(prediction_docs))

        coll = db.collection("predictions")
        written = 0
        for chunk_start in range(0, len(prediction_docs), BATCH_SIZE):
            chunk = prediction_docs[chunk_start : chunk_start + BATCH_SIZE]
            batch = db.batch()
            for doc in chunk:
                batch.set(coll.document(doc["ride_id"]), doc)
            batch.commit()
            written += len(chunk)

    log.info("Done in %.1fs — predictions for %d rides", time.monotonic() - t0, written)
    return 0


if __name__ == "__main__":
    sys.exit(main())
