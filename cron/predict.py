"""ML inference script — runs every 10 min via Cloud Run Jobs.

For each ride with enough recent data:
  - Computes trajectory predictions (T+10 → T+240 minutes)
  - Scores the direction classifiers (p_fall_30/60, p_rise_30/60) when the
    manifest lists them, and derives trend / confidence from p_rise_30 /
    p_fall_30 with the manifest's per-band thresholds (Session 5); without
    classifiers, from the forecast curve as before
  - Computes a 34-slot full-day forecast (7:00 AM – 11:30 PM PT)
  - Writes to predictions/{ride_id} in Firestore

Environment variables:
  MODEL_BUCKET                   GCS bucket containing model .txt files +
                                 feature_categories.json; manifest.json lists
                                 the classifier files to download
  GOOGLE_APPLICATION_CREDENTIALS path to service-account key (local dev only)
"""
from __future__ import annotations

import json
import logging
import math
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
from crowd_features import crowd_level_ratio_live, regime_for  # noqa: E402
from park_schedule import get_todays_hours, minutes_until_close, operating_hours  # noqa: E402

LA_TZ = ZoneInfo("America/Los_Angeles")

HORIZONS = [10, 20, 30, 40, 50, 60, 90, 120, 150, 180, 210, 240]
LOOKBACK_MINUTES = 120
BATCH_SIZE = 400

DAY_PROFILE_FEATURE_COLS = [
    "ride_id_cat",
    "hour_of_day", "day_of_week", "week_of_year", "month",
    # morning_crowd_index was dropped in Session 3: no keying of it beat
    # leaving it out (reports/eval/2026-10-16_session3-variants.md).
    "temp_high_f", "crowd_level_ratio",
    "is_holiday", "is_holiday_weekend",
    "days_until_next_holiday", "days_since_last_holiday",
    "minutes_until_close", "total_operating_hours",
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

# The row dict _build_trajectory_row + main() can build. Models pick their own
# columns from it by booster.feature_name() (Recipe B drops week_of_year);
# ml/tests/test_recipes.py asserts every deployed recipe's list is a subset.
TRAJECTORY_FEATURE_COLS = [
    "wait_minutes", "wait_lag_1", "wait_lag_2", "wait_lag_3", "wait_delta_1",
    "park_crowd_median",
    "hour_of_day", "day_of_week", "week_of_year", "month",
    "is_holiday", "is_holiday_weekend",
    "days_until_next_holiday", "days_since_last_holiday",
    "minutes_since_last_status_change", "closure_duration_minutes",
    "minutes_at_current_level", "wait_regime_danger_zone",
    "crowd_level_ratio",
    "ride_id_cat", "status_cat",
    # Recipe B only (Session 4, arm B3: helped at every horizon once the
    # midnight-close bug was fixed). Recipe A models don't ask for it; main()
    # adds it to the row from today's park close.
    "minutes_until_close",
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


def _model_files(manifest: dict) -> list[str]:
    """Files to download besides manifest.json: the fixed set plus every
    classifier file the manifest lists (none for a pre-Session-5 manifest)."""
    files = (
        [f"trajectory_t{h}.txt" for h in HORIZONS]
        + ["day_profile.txt", "feature_categories.json",
           "ride_regime_thresholds.json", "crowd_level_baselines.json"]
    )
    for spec in (manifest.get("classifiers") or {}).values():
        if isinstance(spec, dict) and spec.get("file"):
            files.append(spec["file"])
    return files


def _download_models(bucket_name: str, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    # manifest.json first: it names the classifier files. A missing one must
    # not fail the job (model_version 'unknown', no classifiers), unlike the
    # model files below.
    try:
        bucket.blob("manifest.json").download_to_filename(str(dest / "manifest.json"))
        log.info("Downloaded manifest.json")
    except Exception:
        log.warning("manifest.json missing from bucket; model_version will be 'unknown'")
    for name in _model_files(_read_manifest(dest)):
        bucket.blob(name).download_to_filename(str(dest / name))
        log.info("Downloaded %s", name)


def _read_manifest(model_dir: Path) -> dict:
    """models/manifest.json as a dict, or {} when it is missing or unparseable.

    Callers default the fields: model_version = trained_through or 'unknown';
    trajectory_target = 'level' (every pre-Session-4 model)."""
    try:
        manifest = json.loads((model_dir / "manifest.json").read_text())
        if not isinstance(manifest, dict):
            raise ValueError("not a JSON object")
        return manifest
    except Exception as e:
        log.warning("Could not read manifest.json (%s); model_version 'unknown', trajectory_target 'level'", e)
        return {}


def _tombstone_doc(
    ride_id: str, now: datetime, model_version: str, current_wait: float | None
) -> dict:
    """Replaces a ride's predictions doc when it can't be forecast this run,
    so the previous run's forecast is never served as live.

    Carries the full prediction-doc shape (flat t* at the current wait,
    stable/low, empty full_day) because older backends read fields like
    `full_day.length` unconditionally — a bare tombstone 502'd /v0/waits on
    2026-10-16. New backends skip it via `degraded`; old ones read a flat,
    harmless forecast. The classifier probabilities and trend_source are
    optional and left out."""
    wait = 0.0 if current_wait is None else float(current_wait)
    doc = {
        "ride_id":         ride_id,
        "updated_at":      now.isoformat(),
    }
    doc.update({f"t{h}": wait for h in HORIZONS})
    doc.update({
        "trend":           "stable",
        "trend_delta_30":  0.0,
        "confidence":      "low",
        "curve_confidence": "low",
        "full_day":        [],
        "degraded":        True,
        "degraded_reason": "insufficient_history",
        "model_version":   model_version,
    })
    return doc


def _load_models(model_dir: Path, manifest: dict | None = None):
    """(traj, day_profile, ride_id_cats, status_cats, classifiers, regime_thresholds,
    crowd_baselines). classifiers is {name: Booster} for every file the manifest
    lists that exists, {} when it lists none (old models -> regression word)."""
    if manifest is None:
        manifest = _read_manifest(model_dir)
    traj = {h: lgb.Booster(model_file=str(model_dir / f"trajectory_t{h}.txt")) for h in HORIZONS}
    day_profile = lgb.Booster(model_file=str(model_dir / "day_profile.txt"))
    cats = json.loads((model_dir / "feature_categories.json").read_text())
    classifiers = {}
    for name, spec in (manifest.get("classifiers") or {}).items():
        path = model_dir / str((spec or {}).get("file", ""))
        if path.is_file():
            classifiers[name] = lgb.Booster(model_file=str(path))
        else:
            log.warning("Classifier %s listed in manifest but %s is missing; skipped", name, path.name)
    regime_thresholds = json.loads((model_dir / "ride_regime_thresholds.json").read_text())
    crowd_baselines = json.loads((model_dir / "crowd_level_baselines.json").read_text())
    return traj, day_profile, cats["ride_id_categories"], cats["status_categories"], classifiers, regime_thresholds, crowd_baselines


# ── Data loading ──────────────────────────────────────────────────────────────

# Bounded to the walk-on regime on purpose. A marker means "essentially no
# wait", so it is always small — 13 is the only off-grid value in 744k rows of
# DLR data. An off-grid 36 or 62 is a real wait, and collapsing it to 5 would be
# a catastrophic misread, so the rule must never reach that far.
WALK_ON_MAX = 15


def _normalize_walk_on(waits: pd.Series) -> pd.Series:
    """Collapse Disney's walk-on signal to the posted-wait floor of 5.

    Disney posts waits in multiples of 5; any other value is a deliberate
    walk-on marker rather than a literal wait (Haunted Mansion's thematic 13
    is the main one, at 24% of its readings). Must match the notebook's
    walk-on-normalization cell — training and inference have to agree.

    Genuine zeros pass through untouched, since 0 % 5 == 0.
    """
    w = pd.to_numeric(waits, errors="coerce")
    return w.mask(w.notna() & (w % 5 != 0) & (w < WALK_ON_MAX), 5.0)


def _read_morning_waits(db: firestore.Client, now_la: datetime) -> pd.DataFrame:
    """Read all wait_times from midnight LA-local today through now.

    Feeds the Full Day past slots — the main df only looks back
    LOOKBACK_MINUTES, which falls short of the morning after ~10am. park_id is
    selected so a per-park morning statistic can be computed from it again.
    """
    midnight_utc = now_la.replace(
        hour=0, minute=0, second=0, microsecond=0
    ).astimezone(timezone.utc)
    rows = []
    query = (
        db.collection("wait_times")
        .where("timestamp_utc", ">=", midnight_utc)
        .select(["ride_id", "park_id", "wait_minutes", "status", "timestamp_utc"])
    )
    for doc in query.stream():
        d = doc.to_dict()
        if d:
            rows.append(d)
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["timestamp_utc"] = pd.to_datetime(df["timestamp_utc"], utc=True)
    # Full Day past slots display Disney's posted value (e.g. 13), so keep it.
    df["wait_minutes_raw"] = pd.to_numeric(df["wait_minutes"], errors="coerce")
    df["wait_minutes"] = _normalize_walk_on(df["wait_minutes"])
    return df


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
            "ride_id", "ride_name", "park_id", "wait_minutes", "status", "timestamp_utc",
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
    df["wait_minutes_raw"] = pd.to_numeric(df["wait_minutes"], errors="coerce")
    df["wait_minutes"] = _normalize_walk_on(df["wait_minutes"])
    return df.sort_values(["ride_id", "timestamp_utc"]).reset_index(drop=True)


# ── Feature engineering ───────────────────────────────────────────────────────

def _build_trajectory_row(
    ride_df: pd.DataFrame,
    ride_id_cats: list[str],
    status_cats: list[str],
    regime_thresholds: dict,
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

    # minutes_at_current_level / wait_regime_danger_zone
    # Classify each recent snapshot into low/mid/high regime using per-ride
    # P25/P75 thresholds pre-computed at training time, keyed by ride_name so
    # seasonal overlays get their own (ride_id is the fallback). Walk backward
    # to find when the current regime started, compute duration (capped at 300 min).
    thresh = regime_for(regime_thresholds, last.get("ride_name"), str(last["ride_id"]))
    p25 = thresh.get("p25")
    p75 = thresh.get("p75")
    classify_regime = lambda w: (  # noqa: E731
        "mid" if p25 is None or p75 is None or pd.isna(w) else
        "low" if float(w) <= p25 else
        "high" if float(w) >= p75 else "mid"
    )
    cur_regime = classify_regime(last["wait_minutes"])
    regime_start_ts = last["timestamp_utc"]
    for i in range(len(r) - 2, -1, -1):
        if classify_regime(r.iloc[i]["wait_minutes"]) == cur_regime:
            regime_start_ts = r.iloc[i]["timestamp_utc"]
        else:
            break
    minutes_at_level = min(
        300.0,
        (last["timestamp_utc"] - regime_start_ts).total_seconds() / 60,
    )

    return {
        "wait_minutes":                    float(last["wait_minutes"]),
        "wait_lag_1":                      float(lag1),
        "wait_lag_2":                      float(lag2),
        "wait_lag_3":                      float(lag3),
        "wait_delta_1":                    float(last["wait_minutes"]) - float(lag1),
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
        "minutes_at_current_level":        float(minutes_at_level),
        "wait_regime_danger_zone":         int(20 <= minutes_at_level <= 50),
        # Keep as strings — converted to pd.Categorical in main() so LightGBM
        # sees the same dtype as during training.
        "ride_id_cat":                     last["ride_id"],
        "status_cat":                      last["status"],
    }


# ── Prediction helpers ────────────────────────────────────────────────────────

def _feature_frame(feat_row: dict, model, ride_id_cats: list[str], status_cats: list[str],
                   frames: dict[tuple, pd.DataFrame]) -> pd.DataFrame:
    """One-row X in the model's own feature_name() order, cached per column list."""
    cols = tuple(model.feature_name())
    X = frames.get(cols)
    if X is None:
        # None (e.g. crowd_level_ratio before 10am) must reach LightGBM as a
        # float NaN; an object column makes predict() raise.
        row = {c: (float("nan") if feat_row.get(c) is None else feat_row[c]) for c in cols}
        X = pd.DataFrame([row], columns=list(cols))
        if "ride_id_cat" in X.columns:
            X["ride_id_cat"] = pd.Categorical(X["ride_id_cat"], categories=ride_id_cats)
        if "status_cat" in X.columns:
            X["status_cat"] = pd.Categorical(X["status_cat"], categories=status_cats)
        frames[cols] = X
    return X


def _predict_classifiers(
    feat_row: dict,
    clf_models: dict,
    ride_id_cats: list[str],
    status_cats: list[str],
) -> dict[str, float]:
    """{p_fall_30, p_fall_60, p_rise_30, p_rise_60: probability} for the classifiers
    loaded, rounded to 3 places; X built exactly as for the trajectory models."""
    frames: dict[tuple, pd.DataFrame] = {}
    return {
        name: round(float(m.predict(_feature_frame(feat_row, m, ride_id_cats, status_cats, frames))[0]), 3)
        for name, m in clf_models.items()
    }


def _predict_trajectory(
    feat_row: dict,
    traj_models: dict,
    ride_id_cats: list[str],
    status_cats: list[str],
    trajectory_target: str = "level",
) -> dict[int, float]:
    """Level forecast per horizon for one ride, plus t10 = current wait.

    Each model's columns come from its own feature_name(), so a model with or
    without week_of_year (or any feature the row lacks, fed as NaN) runs with
    the same code. A 'delta' model predicts the change from the
    walk-on-normalized current wait, which is added back. Clipped at 0.
    """
    current = float(feat_row["wait_minutes"])
    frames: dict[tuple, pd.DataFrame] = {}
    preds: dict[int, float] = {}
    for h, m in traj_models.items():
        X = _feature_frame(feat_row, m, ride_id_cats, status_cats, frames)
        raw = float(m.predict(X)[0])
        pred = current + raw if trajectory_target == "delta" else raw
        preds[h] = max(0.0, round(pred, 1))
    # The T+10 model loses to "wait stays the same", so t10 is the
    # (normalized) current wait. The model stays loaded/downloaded for
    # now so HORIZONS and the GCS file list are unchanged.
    preds[10] = current
    return preds


# ── Trend word from the classifiers (Session 5) ─────────────────────────────
# Mirrors ml/recipes.py derive_trend / band_of exactly (cron can't import ml/);
# ml/tests/test_recipes.py runs both on the same grid.

STABLE_HIGH = 0.15
STABLE_MEDIUM = 0.30
PEAK_TROUGH_LAG = 5


def _band_of(current: float) -> str:
    c = float(current)
    if c <= 10:
        return "<=10"
    if c <= 25:
        return "15-25"
    if c <= 60:
        return "30-60"
    return ">60"


def _missing(v) -> bool:
    return v is None or (isinstance(v, float) and math.isnan(v))


def _derive_trend_from_probs(current, lag1, p_rise_30, p_fall_30, thresholds) -> tuple[str, str] | None:
    """(trend, confidence), or None when a probability, the current wait, or the
    band's thresholds are missing. See ml/recipes.py derive_trend."""
    if thresholds is None or _missing(current) or _missing(p_rise_30) or _missing(p_fall_30):
        return None
    band = thresholds.get(_band_of(current))
    if not band:
        return None
    call, high = band.get("call") or {}, band.get("high") or {}

    def reaches(p, tau):
        return tau is not None and p >= tau

    lag_ok = not _missing(lag1)
    if reaches(p_rise_30, call.get("rise")) and p_rise_30 > p_fall_30:
        trend = "trough" if lag_ok and current - lag1 >= PEAK_TROUGH_LAG else "rising"
        confidence = "high" if reaches(p_rise_30, high.get("rise")) else "medium"
    elif reaches(p_fall_30, call.get("fall")) and p_fall_30 > p_rise_30:
        trend = "peak" if lag_ok and lag1 - current >= PEAK_TROUGH_LAG else "falling"
        confidence = "high" if reaches(p_fall_30, high.get("fall")) else "medium"
    else:
        trend = "stable"
        top = max(p_rise_30, p_fall_30)
        confidence = "high" if top < STABLE_HIGH else ("medium" if top < STABLE_MEDIUM else "low")
    return trend, confidence


def _curve_confidence(current_wait: float, preds: dict[int, float]) -> str:
    """Vote-count agreement of the trajectory curve: low when |t30 - current| < 2,
    else how many of the 9 horizons after T+30 (T+40 .. T+240) share the T+30
    direction: high >= 7 of 9, medium >= 5 of 9, else low. Gates the backend
    verdict engine's use of the curve; the pre-Session-5 `confidence` rule."""
    delta30 = round(preds[30] - current_wait, 1)
    # T+30 is excluded because delta30 comes from it (a guaranteed agreeing
    # vote); T+10/T+20 because t10 is just the current wait.
    if abs(delta30) < 2:
        return "low"
    deltas = [preds[h] - current_wait for h in HORIZONS if h > 30]
    same_dir = sum(1 for d in deltas if (d >= 0) == (delta30 >= 0))
    return "high" if same_dir >= 7 else ("medium" if same_dir >= 5 else "low")


def _derive_trend(
    current_wait: float,
    lag1: float,
    preds: dict[int, float],
    probs: dict[str, float] | None = None,
    thresholds: dict | None = None,
) -> tuple[str, float, str, str]:
    """Return (trend, trend_delta_30, confidence, trend_source).

    With p_rise_30 / p_fall_30 in `probs` and the manifest's trend_thresholds,
    the word and confidence come from the classifiers (trend_source
    'classifier'). Otherwise from the trajectory curve as before Session 5
    ('regression'): confidence counts how many of the 9 horizons after T+30
    (T+40 .. T+240) agree with delta30's direction: high >= 7 of 9, medium >= 5 of 9.

    trend_delta_30 is t30 - current either way; since Session 5 it is no longer
    the source of the word (delete once no supported app version reads it).
    """
    t30   = preds[30]
    delta30 = round(t30 - current_wait, 1)

    if probs:
        derived = _derive_trend_from_probs(
            current_wait, lag1, probs.get("p_rise_30"), probs.get("p_fall_30"), thresholds)
        if derived is not None:
            return derived[0], delta30, derived[1], "classifier"

    # Base direction from T+30 delta
    if delta30 >= 5:
        # Wait is rising — check if we're emerging from a trough
        trend = "trough" if (current_wait - lag1) >= 5 else "rising"
    elif delta30 <= -5:
        # Wait is falling — check if we're coming off a peak
        trend = "peak" if (lag1 - current_wait) >= 5 else "falling"
    else:
        trend = "stable"

    # Regression path: the word's confidence is the curve's vote count, as
    # before Session 5 (so curve_confidence == confidence for old models).
    return trend, delta30, _curve_confidence(current_wait, preds), "regression"


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
    crowd_level_ratio: float | None = None,
    open_minutes: int | None = None,
    close_minutes: int | None = None,
    morning_df: pd.DataFrame | None = None,
    now_minutes: int | None = None,
    current_raw_wait: float | None = None,
) -> list[dict]:
    """Run the day-profile model for all 34 half-hour slots.

    closures_today: completed closures for this ride today, from _read_today_closures.
                    Each entry: { closed_at_min, reopened_at_min, duration_min }.
                    When None or empty, closure features default to "no closure today."

    traj_preds: trajectory predictions keyed by horizon in minutes. When provided,
                the slots that fall within the T+30–T+240 window are overridden with
                trajectory values so the full-day curve doesn't jump at the seam where
                the trajectory model hands off to the day-profile model.

    open_minutes, close_minutes: today's LA-local park hours in minutes-from-
                   midnight (from park_schedule.get_todays_hours), or None when
                   unknown. Feed minutes_until_close / total_operating_hours to
                   the model (NaN when unknown) so it can learn the taper toward
                   close itself, on top of the hard mask below — slots at/after
                   close are nulled regardless of what the model predicted, since
                   the fixed 7am–11:30pm grid otherwise predicts straight through
                   a shortened day's actual close. The frontend already skips
                   wait: null slots.

    morning_df, now_minutes, current_raw_wait: when morning_df and now_minutes
                   are given, slots that have already ended show what actually
                   happened (median raw posted wait over this ride's OPERATING
                   snapshots in the window, or None when there are none), and
                   the slot containing now shows current_raw_wait (left as the
                   model value when None). Raw, not walk-on-normalized, because
                   full_day is a display value. Future slots are untouched.
    """
    # collect.js stores day_of_week in JS convention (Sun=0); convert from Python (Mon=0)
    js_dow = (now_la.weekday() + 1) % 7
    ride_closures = closures_today or []
    day_total_hours = (
        operating_hours(open_minutes, close_minutes)
        if open_minutes is not None and close_minutes is not None
        else None
    )

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
            "crowd_level_ratio":                crowd_level_ratio,
            "is_holiday":                       hol["is_holiday"],
            "is_holiday_weekend":               hol["is_holiday_weekend"],
            "days_until_next_holiday":          hol["days_until_next_holiday"],
            "days_since_last_holiday":          hol["days_since_last_holiday"],
            "minutes_until_close":              minutes_until_close(start_min, close_minutes) if close_minutes is not None else None,
            "total_operating_hours":            day_total_hours,
            **closure_ctx,
        })

    # Columns come from the model itself, not DAY_PROFILE_FEATURE_COLS, so a
    # model trained on a different feature list (e.g. the pre-Session-3 one
    # with morning_crowd_index) still runs: any feature the row dict lacks is
    # fed as NaN, which LightGBM treats as missing. Deploy order of cron code
    # vs. model files therefore doesn't matter.
    feature_name = getattr(day_profile_model, "feature_name", None)
    model_cols = list(feature_name()) if callable(feature_name) else DAY_PROFILE_FEATURE_COLS
    X_profile = pd.DataFrame(rows).reindex(columns=model_cols)
    for col in model_cols:
        if col != "ride_id_cat" and X_profile[col].isna().all():
            X_profile[col] = X_profile[col].astype(float)
    for col in ("crowd_level_ratio", "minutes_until_close", "total_operating_hours"):
        if col in X_profile.columns:
            X_profile[col] = X_profile[col].astype(float)
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

    if morning_df is not None and now_minutes is not None:
        ride_rows = pd.DataFrame()
        if not morning_df.empty and "wait_minutes_raw" in morning_df.columns:
            ride_rows = morning_df[
                (morning_df["ride_id"] == ride_id)
                & (morning_df["status"] == "OPERATING")
                & morning_df["wait_minutes_raw"].notna()
            ]
        if not ride_rows.empty:
            local_ts = ride_rows["timestamp_utc"].dt.tz_convert("America/Los_Angeles")
            row_minutes = (local_ts.dt.hour * 60 + local_ts.dt.minute).to_numpy()
            raw_waits = ride_rows["wait_minutes_raw"].to_numpy()
        for slot in slots:
            start_min = slot["start_minutes"]
            if start_min + 30 <= now_minutes:
                if ride_rows.empty:
                    slot["wait"] = None
                else:
                    in_window = raw_waits[(row_minutes >= start_min) & (row_minutes < start_min + 30)]
                    slot["wait"] = round(float(pd.Series(in_window).median())) if len(in_window) else None
            elif start_min <= now_minutes and current_raw_wait is not None:
                slot["wait"] = round(float(current_raw_wait))

    if close_minutes is not None:
        for slot in slots:
            if slot["start_minutes"] >= close_minutes:
                slot["wait"] = None

    return slots


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
        manifest = _read_manifest(model_dir)
        traj_models, day_profile_model, ride_id_cats, status_cats, clf_models, regime_thresholds, crowd_baselines = _load_models(model_dir, manifest)
        model_version = str(manifest.get("trained_through", "unknown"))
        trajectory_target = manifest.get("trajectory_target", "level")
        trend_thresholds = manifest.get("trend_thresholds")
        log.info("model_version: %s, trajectory_target: %s, recipe: %s, classifiers: %d",
                 model_version, trajectory_target, manifest.get("recipe", "unknown"), len(clf_models))

        db = _init_firestore()
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=LOOKBACK_MINUTES)
        df = _read_recent(db, cutoff)

        if df.empty:
            log.warning("No recent wait_times rows — parks likely closed")
            return 0

        log.info("Read %d rows across %d rides", len(df), df["ride_id"].nunique())

        now = datetime.now(timezone.utc)
        now_la = now.astimezone(LA_TZ)
        now_minutes = now_la.hour * 60 + now_la.minute
        hol = holiday_features(now)

        # Read today's completed closures once — passed per-ride to _build_full_day
        # so the day-profile model knows what kind of day it is for each ride.
        today_closures = _read_today_closures(db, now_la)
        log.info("Read today's closures for %d rides", len(today_closures))

        # Today's (open_minutes, close_minutes) per park — one read per park
        # (not per ride), (None, None) fail-open when the schedule doc is
        # missing or there's no OPERATING entry today. Feeds day_profile's
        # minutes_until_close / total_operating_hours (Recipe B trajectory
        # models also read minutes_until_close), and still masks full_day slots
        # past close regardless of what the model predicts.
        park_hours = {
            park_id: get_todays_hours(db, park_id, now_la)
            for park_id in df["park_id"].dropna().unique()
        }
        log.info("park_hours: %s", park_hours)

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

        # Today's waits since midnight — feeds the Full Day past slots.
        morning_df = _read_morning_waits(db, now_la)
        # {park_id: value or None}; per park when the baseline JSON is
        # park-keyed, the same resort-wide value under every park otherwise.
        crowd_by_park = crowd_level_ratio_live(df, now_la, hol, crowd_baselines)
        log.info("crowd_level_ratio by park: %s", crowd_by_park)

        prediction_docs = []
        tombstoned = 0
        for ride_id, ride_df in df.groupby("ride_id"):
            feat_row = _build_trajectory_row(ride_df, ride_id_cats, status_cats, regime_thresholds)
            current_raw_wait = (
                None if pd.isna(ride_df["wait_minutes_raw"].iloc[-1])
                else float(ride_df["wait_minutes_raw"].iloc[-1])
            )
            if feat_row is None:
                # Replace (never merge) the old doc so a stale forecast isn't
                # served as live. Rides with no rows in the window get no
                # tombstone; their old doc ages out via the backend's 20-min rule.
                prediction_docs.append(_tombstone_doc(ride_id, now, model_version, current_raw_wait))
                tombstoned += 1
                continue
            park_id = ride_df["park_id"].iloc[0]
            feat_row["park_crowd_median"] = park_crowd_median
            feat_row["crowd_level_ratio"] = crowd_by_park.get(park_id)
            open_minutes, close_minutes = park_hours.get(park_id, (None, None))
            feat_row["minutes_until_close"] = (
                minutes_until_close(now_minutes, close_minutes) if close_minutes is not None else None
            )

            traj_preds = _predict_trajectory(feat_row, traj_models, ride_id_cats, status_cats, trajectory_target)
            probs = _predict_classifiers(feat_row, clf_models, ride_id_cats, status_cats) if clf_models else {}

            trend, trend_delta_30, confidence, trend_source = _derive_trend(
                feat_row["wait_minutes"], feat_row["wait_lag_1"], traj_preds, probs, trend_thresholds
            )

            full_day = _build_full_day(
                ride_id, now_la, day_profile_model, ride_id_cats, hol,
                closures_today=today_closures.get(ride_id),
                traj_preds=traj_preds,
                daily_weather=daily_weather,
                crowd_level_ratio=crowd_by_park.get(park_id),
                open_minutes=open_minutes,
                close_minutes=close_minutes,
                morning_df=morning_df,
                now_minutes=now_minutes,
                current_raw_wait=current_raw_wait,
            )

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
                # t30 - current. No longer the source of `trend` (Session 5);
                # delete once no supported app version reads it.
                "trend_delta_30": trend_delta_30,
                "confidence":     confidence,
                # Vote-count agreement of the trajectory curve; gates the backend
                # verdict engine's use of t10..t240 (scoring/layer1.ts).
                # `confidence` now describes the trend word only.
                "curve_confidence": _curve_confidence(feat_row["wait_minutes"], traj_preds),
                "trend_source":   trend_source,
                "full_day":       full_day,
                "model_version":  model_version,
                **probs,
            })

        predicted = len(prediction_docs) - tombstoned
        log.info("Built predictions for %d rides, %d tombstones", predicted, tombstoned)

        coll = db.collection("predictions")
        written = 0
        for chunk_start in range(0, len(prediction_docs), BATCH_SIZE):
            chunk = prediction_docs[chunk_start : chunk_start + BATCH_SIZE]
            batch = db.batch()
            for doc in chunk:
                batch.set(coll.document(doc["ride_id"]), doc)
            batch.commit()
            written += len(chunk)

    log.info(
        "Done in %.1fs — predicted %d, tombstoned %d, model_version=%s",
        time.monotonic() - t0, predicted, tombstoned, model_version,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
