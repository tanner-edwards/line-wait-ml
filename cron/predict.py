"""ML inference script — runs every 10 min via Cloud Run Jobs.

For each ride with enough recent data:
  - Computes trajectory predictions (T+10 → T+150 minutes)
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

LA_TZ = ZoneInfo("America/Los_Angeles")

HORIZONS = [10, 20, 30, 40, 50, 60, 90, 120, 150]
LOOKBACK_MINUTES = 120
BATCH_SIZE = 400

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
    "hour_of_day", "day_of_week", "month",
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
        + ["day_profile.txt", "feature_categories.json"]
    )
    for name in files:
        bucket.blob(name).download_to_filename(str(dest / name))
        log.info("Downloaded %s", name)


def _load_models(model_dir: Path):
    traj = {h: lgb.Booster(model_file=str(model_dir / f"trajectory_t{h}.txt")) for h in HORIZONS}
    day_profile = lgb.Booster(model_file=str(model_dir / "day_profile.txt"))
    cats = json.loads((model_dir / "feature_categories.json").read_text())
    return traj, day_profile, cats["ride_id_categories"], cats["status_categories"]


# ── Data loading ──────────────────────────────────────────────────────────────

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


def _build_full_day(
    ride_id: str,
    now_la: datetime,
    day_profile_model: lgb.Booster,
    ride_id_cats: list[str],
    hol: dict,
) -> list[dict]:
    """Run the day-profile model for all 34 half-hour slots."""
    # collect.js stores day_of_week in JS convention (Sun=0); convert from Python (Mon=0)
    js_dow = (now_la.weekday() + 1) % 7

    rows = [
        {
            "ride_id_cat":              ride_id,  # string; converted to Categorical below
            "hour_of_day":              start_min // 60,
            "day_of_week":              js_dow,
            "month":                    now_la.month,
            "is_holiday":               hol["is_holiday"],
            "is_holiday_weekend":       hol["is_holiday_weekend"],
            "days_until_next_holiday":  hol["days_until_next_holiday"],
            "days_since_last_holiday":  hol["days_since_last_holiday"],
        }
        for start_min, _ in FULL_DAY_SLOTS
    ]

    X_profile = pd.DataFrame(rows)
    X_profile["ride_id_cat"] = pd.Categorical(X_profile["ride_id_cat"], categories=ride_id_cats)
    preds = day_profile_model.predict(X_profile)
    return [
        {
            "time_slot":     time_slot,
            "start_minutes": start_min,
            "wait":          max(0, round(float(p))),
        }
        for (start_min, time_slot), p in zip(FULL_DAY_SLOTS, preds)
    ]


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
        traj_models, day_profile_model, ride_id_cats, status_cats = _load_models(model_dir)

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

        prediction_docs = []
        for ride_id, ride_df in df.groupby("ride_id"):
            feat_row = _build_trajectory_row(ride_df, ride_id_cats, status_cats)
            if feat_row is None:
                continue

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

            full_day = _build_full_day(ride_id, now_la, day_profile_model, ride_id_cats, hol)

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
                "trend":          trend,
                "trend_delta_30": trend_delta_30,
                "confidence":     confidence,
                "full_day":       full_day,
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
