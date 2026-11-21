"""Disney's day forecast vs ours vs actual, for one past LA date.

Disney's forecast is the collector's `ride_forecasts` doc (the hourly plan
Disney publishes, first snapshot of the day = taken at park open). Ours is
not stored anywhere (`predictions.full_day` is overwritten every run), so it
is rebuilt here: the deployed day-profile model run through
predict._build_full_day as of park open, with no crowd ratio, closures or
trajectory override. Actual is the mean raw posted wait over OPERATING polls
in the hour, since Disney forecasts posted values.

Owner rule (2026-11-07): this is for observing who is closer over a few weeks,
not for acting on Disney's forecast.
"""

from __future__ import annotations

import json
import logging
import math
import urllib.request
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

log = logging.getLogger(__name__)

LA = ZoneInfo("America/Los_Angeles")
ROOT = Path(__file__).resolve().parents[2]
MODEL_BUCKET = "club32-models"
DEFAULT_TEMP_HIGH_F = 75.0  # predict.py's fallback
ANAHEIM = (33.8121, -117.9190)
# (label, first hour, last hour) in LA local time; the comparison's time-of-day blocks.
BLOCKS = [("Open–11am", 0, 11), ("12–4pm", 12, 16), ("5–7pm", 17, 19), ("8pm–close", 20, 23)]


def _r(v, nd=1):
    if v is None:
        return None
    v = float(v)
    return None if math.isnan(v) else round(v, nd)


# ── Inputs ────────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def load_day_profile() -> tuple:
    """(booster, ride_id_categories, model_version) of the deployed day-profile
    model, from GCS like _load_manifest; the repo models/ copy if that fails.
    Cached for the life of the process."""
    import tempfile

    import lightgbm as lgb

    names = ("day_profile.txt", "feature_categories.json", "manifest.json")
    src = ROOT / "models"
    try:
        from google.cloud import storage
        bucket = storage.Client().bucket(MODEL_BUCKET)
        src = Path(tempfile.mkdtemp(prefix="day_profile_"))
        for n in names:
            bucket.blob(n).download_to_filename(str(src / n))
    except Exception as e:
        log.warning("GCS day-profile read failed (%s); using models/", e)
        src = ROOT / "models"
    booster = lgb.Booster(model_file=str(src / "day_profile.txt"))
    cats = json.loads((src / "feature_categories.json").read_text())["ride_id_categories"]
    manifest = json.loads((src / "manifest.json").read_text())
    return booster, cats, str(manifest.get("trained_through", "unknown"))


def fetch_temp_high(day: date) -> tuple[float, bool]:
    """(Anaheim daily high °F, fell_back). Open-Meteo, same source as predict.py."""
    url = (f"https://api.open-meteo.com/v1/forecast?latitude={ANAHEIM[0]}&longitude={ANAHEIM[1]}"
           f"&daily=temperature_2m_max&temperature_unit=fahrenheit&timezone=America%2FLos_Angeles"
           f"&start_date={day.isoformat()}&end_date={day.isoformat()}")
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            high = json.loads(resp.read())["daily"]["temperature_2m_max"][0]
        if high is not None:
            return float(high), False
    except Exception as e:
        log.warning("Weather high fetch failed for %s: %s; using %.0fF", day, e, DEFAULT_TEMP_HIGH_F)
    return DEFAULT_TEMP_HIGH_F, True


# ── Hourly frames (pure) ──────────────────────────────────────────────────────

def disney_hourly(docs: list[dict]) -> tuple[dict, dict]:
    """({ride_id: {hour: wait}}, {ride_id: snapshot hour}) from ride_forecasts
    docs, using each ride's earliest snapshot of the day."""
    out, snap = {}, {}
    for d in docs:
        by_hour = d.get("byHour") or {}
        if not by_hour:
            continue
        first = min(by_hour)
        fc = by_hour[first] or {}
        out[d["rideId"]] = {int(h): float(w) for h, w in fc.items() if w is not None}
        snap[d["rideId"]] = first
    return out, snap


def actual_hourly(df: pd.DataFrame) -> dict:
    """{ride_id: {hour: mean raw posted wait}} over OPERATING polls."""
    if df.empty:
        return {}
    op = df[df["status"] == "OPERATING"].copy()
    raw = op["wait_minutes_raw"] if "wait_minutes_raw" in op.columns else op["wait_minutes"]
    op["posted"] = pd.to_numeric(raw, errors="coerce").fillna(pd.to_numeric(op["wait_minutes"], errors="coerce"))
    op = op[op["posted"].notna()]
    if op.empty:
        return {}
    op["hour"] = op["timestamp_utc"].dt.tz_convert(LA).dt.hour
    g = op.groupby(["ride_id", "hour"])["posted"].mean()
    out: dict = {}
    for (rid, h), v in g.items():
        out.setdefault(rid, {})[int(h)] = float(v)
    return out


def slots_to_hours(full_day: list[dict], open_minutes: float, close_minutes: float) -> dict:
    """{hour: mean of that hour's half-hour slots}, only hours inside the
    OPERATING window. Masked (None) slots are skipped."""
    by: dict = {}
    for s in full_day:
        if s.get("wait") is None:
            continue
        by.setdefault(s["start_minutes"] // 60, []).append(s["wait"])
    first, last = int(open_minutes) // 60, math.ceil(close_minutes / 60) - 1
    return {h: sum(v) / len(v) for h, v in by.items() if first <= h <= last}


def ours_hourly(ride_ids, day: date, open_minutes, close_minutes, model: tuple, temp_high_f: float) -> dict:
    """{ride_id: {hour: wait}}: our day forecast as it stood at park open."""
    import predict  # cron/ is on sys.path via grading.py

    from day_type import holiday_features

    booster, cats, _ = model
    if open_minutes is None or close_minutes is None or pd.isna(open_minutes) or pd.isna(close_minutes):
        return {}
    now_la = datetime.combine(day, datetime.min.time(), tzinfo=LA) + timedelta(minutes=float(open_minutes))
    hol = holiday_features(now_la)
    out = {}
    for rid in ride_ids:
        if rid not in cats:
            continue
        fd = predict._build_full_day(
            rid, now_la, booster, cats, hol, daily_weather={"temp_high_f": temp_high_f},
            crowd_level_ratio=None, open_minutes=int(open_minutes), close_minutes=int(close_minutes),
        )
        out[rid] = slots_to_hours(fd, open_minutes, close_minutes)
    return out


# ── Comparison (pure) ─────────────────────────────────────────────────────────

def _score(rows: pd.DataFrame) -> dict:
    if rows.empty:
        return {"rides": 0, "n": 0, "mae_disney": None, "mae_ours": None,
                "bias_disney": None, "bias_ours": None, "ours_closer_pct": None}
    e_d = rows["disney"] - rows["actual"]
    e_o = rows["ours"] - rows["actual"]
    return {
        "rides": int(rows["ride_id"].nunique()), "n": int(len(rows)),
        "mae_disney": _r(e_d.abs().mean()), "mae_ours": _r(e_o.abs().mean()),
        "bias_disney": _r(e_d.mean()), "bias_ours": _r(e_o.mean()),
        "ours_closer_pct": _r(100 * (e_o.abs() < e_d.abs()).mean(), 0),
    }


def compare(disney: dict, ours: dict, actual: dict, bellwether_ids, names: dict) -> dict:
    """Scorecard over every ride with all three values in an hour, plus hourly
    rows for each bellwether (charted even when Disney has no forecast)."""
    rows = []
    for rid, fc in disney.items():
        for h, dw in fc.items():
            o, a = ours.get(rid, {}).get(h), actual.get(rid, {}).get(h)
            if o is not None and a is not None:
                rows.append({"ride_id": rid, "hour": h, "disney": dw, "ours": o, "actual": a})
    df = pd.DataFrame(rows, columns=["ride_id", "hour", "disney", "ours", "actual"])
    blocks = []
    for label, lo, hi in BLOCKS:
        blocks.append({"block": label, **_score(df[(df["hour"] >= lo) & (df["hour"] <= hi)])})

    rides = []
    for rid in bellwether_ids:
        hours = sorted(set(ours.get(rid, {})) | set(actual.get(rid, {})) | set(disney.get(rid, {})))
        o_hours = set(ours.get(rid, {}))
        if o_hours:  # inside the OPERATING window only
            hours = [h for h in hours if min(o_hours) <= h <= max(o_hours)]
        rides.append({
            "ride_id": rid, "ride_name": names.get(rid), "has_disney": rid in disney,
            "hours": [{"hour": h, "disney": _r(disney.get(rid, {}).get(h)), "ours": _r(ours.get(rid, {}).get(h)),
                       "actual": _r(actual.get(rid, {}).get(h))} for h in hours],
        })
    return {"scorecard": {"all": _score(df), "blocks": blocks}, "rides": rides}
