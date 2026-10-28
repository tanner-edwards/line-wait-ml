"""Grade a day of served predictions for the admin dashboard.

    payload = grade_day(db, date(2026, 10, 24))          # Firestore -> dict
    payload = grade(runs, schedules_df, closures, ...)    # pure, used by tests

Input is admin_prediction_runs (written by cron/predict.py, one doc per park
per run). Every metric reuses the forward-holdout scoreboard's functions so
the dashboard and reports/eval/ agree:
- ml.clean.clean_frame for actuals prep (after public close, party entities, zeros)
- ml.metrics.mae / trend_class / trend_confusion_from_words / reliability
- ml.recipes.band_of + manifest trend_thresholds for the fall-call anomaly
- cron/crowd_features.py *_live for the crowd readouts, against baselines.json

The only new logic is matching a forecast made at poll T for horizon h to the
same ride's actual at the poll nearest T+h (within config match_slack_min).
"""

from __future__ import annotations

import json
import logging
import math
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
for p in (ROOT, ROOT / "cron"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from crowd_features import crowd_level_ratio_live, morning_crowd_index_live  # noqa: E402
from day_type import holiday_features  # noqa: E402
from ml.clean import clean_frame, public_hours  # noqa: E402
from ml.metrics import mae, reliability, trend_class, trend_confusion_from_words  # noqa: E402
from ml.recipes import band_of  # noqa: E402

log = logging.getLogger(__name__)

LA = ZoneInfo("America/Los_Angeles")
HERE = Path(__file__).resolve().parent
RUNS_COLLECTION = "admin_prediction_runs"
STALE_POLL_MIN = 15  # a ride whose latest row is older than this at run time has no fresh actual
PROB_FIELDS = ("p_rise_30", "p_rise_60", "p_fall_30", "p_fall_60")


def load_config() -> dict:
    return json.loads((HERE / "config.json").read_text())


def load_baselines() -> dict:
    path = HERE / "baselines.json"
    return json.loads(path.read_text()) if path.exists() else {}


# ── Frames ────────────────────────────────────────────────────────────────────

def runs_frame(run_docs: list[dict]) -> pd.DataFrame:
    """One row per (ride, poll): the run docs flattened. A poll recorded by two
    runs keeps the later run. Rows whose poll is stale at run time are dropped."""
    rows = []
    for doc in run_docs:
        run_at = pd.Timestamp(doc["run_at"])
        for ride_id, r in (doc.get("rides") or {}).items():
            row = {
                "run_at": run_at, "park_id": doc["park_id"], "model_version": doc.get("model_version"),
                "ride_id": ride_id, "ride_name": r.get("name"), "status": r.get("status"),
                "wait_minutes": r.get("wait"), "wait_minutes_raw": r.get("wait_raw"),
                "timestamp_utc": pd.Timestamp(r.get("seen_at") or run_at),
                "tombstone": bool(r.get("tombstone")),
                "trend": r.get("trend"), "trend_source": r.get("trend_source"),
            }
            for k, v in r.items():
                if (k.startswith("t") and k[1:].isdigit()) or k in PROB_FIELDS:
                    row[k] = v
            rows.append(row)
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    for col in ("run_at", "timestamp_utc"):
        df[col] = pd.to_datetime(df[col], utc=True)
    df["wait_minutes"] = pd.to_numeric(df["wait_minutes"], errors="coerce")
    fresh = (df["run_at"] - df["timestamp_utc"]) <= pd.Timedelta(minutes=STALE_POLL_MIN)
    df = df[fresh].sort_values(["ride_id", "timestamp_utc", "run_at"])
    return df.drop_duplicates(["ride_id", "timestamp_utc"], keep="last").reset_index(drop=True)


def match_forecasts(df: pd.DataFrame, horizons, slack_min: int) -> pd.DataFrame:
    """Long frame: one row per (forecast, horizon) made while OPERATING, paired
    with the same ride's OPERATING actual nearest T+h within slack. Unmatched
    forecasts (ride closed, day ended, poll gap) are dropped."""
    actuals = df.loc[(df["status"] == "OPERATING") & df["wait_minutes"].notna(),
                     ["ride_id", "timestamp_utc", "wait_minutes"]]
    actuals = actuals.rename(columns={"timestamp_utc": "target_at", "wait_minutes": "actual"})
    actuals = actuals.sort_values("target_at")
    base = df[(df["status"] == "OPERATING") & df["wait_minutes"].notna() & ~df["tombstone"]]
    out = []
    for h in horizons:
        col = f"t{h}"
        if col not in base.columns:
            continue
        f = base[base[col].notna()].copy()
        if f.empty:
            continue
        f["horizon"] = h
        f["forecast"] = f[col].astype(float)
        f["target_at"] = f["timestamp_utc"] + pd.Timedelta(minutes=h)
        f = f.sort_values("target_at")
        m = pd.merge_asof(f, actuals, on="target_at", by="ride_id", direction="nearest",
                          tolerance=pd.Timedelta(minutes=slack_min), suffixes=("", "_a"))
        out.append(m[m["actual"].notna()])
    if not out:
        return pd.DataFrame()
    m = pd.concat(out, ignore_index=True)
    m["persistence"] = m["wait_minutes"]
    m["err"] = m["forecast"] - m["actual"]
    m["abs_err"] = m["err"].abs()
    m["abs_err_persist"] = (m["persistence"] - m["actual"]).abs()
    m["origin_hour"] = m["timestamp_utc"].dt.tz_convert(LA).dt.hour
    return m


# ── Scores ────────────────────────────────────────────────────────────────────

def _f(v):
    if v is None:
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(v) else round(v, 3)


def _iso(ts) -> str | None:
    return None if ts is None or pd.isna(ts) else pd.Timestamp(ts).isoformat()


def headline(m: pd.DataFrame, horizons, tolerance: dict) -> list[dict]:
    """Per horizon: n, model vs persistence MAE on the same rows, lift, tolerance hit rates."""
    out = []
    for h in horizons:
        g = m[m["horizon"] == h] if not m.empty else m
        tol = float(tolerance[str(h)])
        if g.empty:
            out.append({"horizon": h, "n": 0, "tolerance": tol})
            continue
        model, persist = mae(g["actual"], g["forecast"]), mae(g["actual"], g["persistence"])
        out.append({
            "horizon": h, "n": int(len(g)), "tolerance": tol,
            "mae": _f(model), "mae_persistence": _f(persist),
            "lift_pct": _f(100 * (persist - model) / persist) if persist else None,
            "hit_rate": _f((g["abs_err"] <= tol).mean()),
            "hit_rate_persistence": _f((g["abs_err_persist"] <= tol).mean()),
        })
    return out


def trend_scorecard(m: pd.DataFrame) -> dict | None:
    """Did the trend word come true 30 min later? Split by trend_source."""
    g = m[(m["horizon"] == 30) & m["trend"].notna()] if not m.empty else m
    if g.empty:
        return None
    out = {}
    for source, s in [("all", g)] + list(g.groupby("trend_source")):
        actual = trend_class(s["actual"] - s["wait_minutes"])
        c = trend_confusion_from_words(actual, s["trend"])
        out[str(source)] = {
            "n": int(len(s)),
            "accuracy": _f(c["accuracy"]),
            "always_stable_accuracy": _f(c["always_stable_accuracy"]),
            "per_class": {k: {kk: _f(vv) for kk, vv in row.items()} for k, row in c["per_class"].iterrows()},
            "matrix": {k: {kk: int(vv) for kk, vv in row.items()} for k, row in c["matrix"].iterrows()},
        }
    return out


def probability_honesty(m: pd.DataFrame, bins: int = 5) -> dict:
    """Reliability of p_fall_30 / p_rise_30 against what happened by T+30."""
    g = m[m["horizon"] == 30] if not m.empty else m
    out = {}
    for field, sign in (("p_fall_30", -1), ("p_rise_30", 1)):
        if g.empty or field not in g.columns:
            continue
        s = g[g[field].notna()]
        if len(s) < bins * 3:
            continue
        moved = (sign * (s["actual"] - s["wait_minutes"]) >= 5).astype(float)
        r = reliability(s[field], moved, bins=bins)
        out[field] = [{"n": int(x.n), "mean_p": _f(x.mean_p), "observed": _f(x.observed)} for x in r.itertuples()]
    return out


def error_by_hour(m: pd.DataFrame, horizons) -> list[dict]:
    if m.empty:
        return []
    g = m.groupby(["origin_hour", "horizon"]).agg(mae=("abs_err", "mean"), mae_persistence=("abs_err_persist", "mean"),
                                                  n=("abs_err", "size")).reset_index()
    return [{"hour": int(r.origin_hour), "horizon": int(r.horizon), "mae": _f(r.mae),
             "mae_persistence": _f(r.mae_persistence), "n": int(r.n)} for r in g.itertuples()]


def deploy_markers(df: pd.DataFrame) -> list[dict]:
    if df.empty or df["model_version"].nunique() < 2:
        return []
    first = df.groupby("model_version")["timestamp_utc"].min().sort_values()
    return [{"model_version": str(v), "at": _iso(t)} for v, t in first.iloc[1:].items()]


def slices(m: pd.DataFrame, closes: dict, reopens: pd.DataFrame, config: dict) -> dict:
    """Headline numbers on the closing window and the post-reopen window."""
    horizons, tol = config["horizons"], config["tolerance_min"]
    if m.empty:
        return {"closing": headline(m, horizons, tol), "post_reopen": headline(m, horizons, tol)}
    close_at = m["park_id"].map(closes)
    closing = m[close_at.notna() & (m["target_at"] <= close_at)
                & (m["target_at"] > close_at - pd.Timedelta(minutes=config["closing_window_min"]))]
    win = pd.Timedelta(minutes=config["post_reopen_window_min"])
    mask = pd.Series(False, index=m.index)
    for r in reopens.itertuples():
        mask |= (m["ride_id"] == r.ride_id) & (m["target_at"] >= r.reopened_at) & (m["target_at"] < r.reopened_at + win)
    return {"closing": headline(closing, horizons, tol), "post_reopen": headline(m[mask], horizons, tol)}


def by_model_version(m: pd.DataFrame, config: dict) -> list[dict]:
    if m.empty or m["model_version"].nunique() < 2:
        return []
    return [{"model_version": str(v), "headline": headline(g, config["horizons"], config["tolerance_min"])}
            for v, g in m.groupby("model_version")]


# ── Anomalies ─────────────────────────────────────────────────────────────────

def _episodes(df: pd.DataFrame, flag: pd.Series) -> list[pd.DataFrame]:
    """Consecutive flagged polls per ride, as one frame per episode."""
    out = []
    f = df.assign(_flag=flag.values)
    for _, g in f.groupby("ride_id"):
        g = g.sort_values("timestamp_utc")
        run_id = (g["_flag"] != g["_flag"].shift()).cumsum()
        out += [e for _, e in g[g["_flag"]].groupby(run_id[g["_flag"]])]
    return out


def big_misses(m: pd.DataFrame, config: dict) -> list[dict]:
    if m.empty:
        return []
    h, thr = config["big_miss_horizon"], config["big_miss_min"]
    g = m[(m["horizon"] == h) & (m["abs_err"] >= thr)]
    return [{"type": "big_miss", "ride_id": r.ride_id, "ride_name": r.ride_name, "at": _iso(r.timestamp_utc),
             "target_at": _iso(r.target_at), "horizon": h, "wait": _f(r.wait_minutes),
             "forecast": _f(r.forecast), "actual": _f(r.actual), "err": _f(r.err)}
            for r in g.sort_values("abs_err", ascending=False).itertuples()]


def fall_calls(df: pd.DataFrame, m: pd.DataFrame, thresholds: dict | None) -> list[dict]:
    """p_fall_30 at/above its band's high fall threshold; one entry per episode,
    graded at its first poll (did the wait fall >= 5 by T+30?)."""
    if not thresholds or df.empty or "p_fall_30" not in df.columns:
        return []
    op = df[(df["status"] == "OPERATING") & df["wait_minutes"].notna() & df["p_fall_30"].notna()]

    def cutoff(w):
        return ((thresholds.get(band_of(w)) or {}).get("high") or {}).get("fall")

    cut = op["wait_minutes"].map(cutoff)
    flag = cut.notna() & (op["p_fall_30"] >= cut.fillna(np.inf))
    outcome = {}
    if not m.empty:
        t30 = m[m["horizon"] == 30]
        outcome = dict(zip(zip(t30["ride_id"], t30["timestamp_utc"]), t30["actual"]))
    out = []
    for e in _episodes(op, flag):
        first = e.iloc[0]
        actual = outcome.get((first["ride_id"], first["timestamp_utc"]))
        fell = None if actual is None else bool(actual - first["wait_minutes"] <= -5)
        out.append({"type": "fall_call", "ride_id": first["ride_id"], "ride_name": first["ride_name"],
                    "at": _iso(first["timestamp_utc"]), "until": _iso(e["timestamp_utc"].iloc[-1]),
                    "wait": _f(first["wait_minutes"]), "p_fall_30": _f(first["p_fall_30"]),
                    "threshold": _f(cutoff(first["wait_minutes"])), "actual_t30": _f(actual), "fell": fell})
    return out


def unusual_waits(df: pd.DataFrame, bands: dict, day_type: str, margin: float = 0, min_polls: int = 1) -> list[dict]:
    """OPERATING waits at least `margin` min outside the ride's P10-P90 for
    (ride_name, day_type, hour), held for at least `min_polls` polls. The margin
    keeps flat bands (P10 == P90, e.g. 5-5 on a kiddie ride) from flagging every
    posting change."""
    if not bands or df.empty:
        return []
    op = df[(df["status"] == "OPERATING") & df["wait_minutes"].notna()].copy()
    hours = op["timestamp_utc"].dt.tz_convert(LA).dt.hour
    band = [bands.get(f"{n}|{day_type}|{h}") for n, h in zip(op["ride_name"], hours)]
    op["p10"] = [b["p10"] if b else np.nan for b in band]
    op["p90"] = [b["p90"] if b else np.nan for b in band]
    out = []
    high = op["wait_minutes"] >= op["p90"] + max(margin, 1e-9)
    low = op["wait_minutes"] <= op["p10"] - max(margin, 1e-9)
    for side, flag in (("high", high), ("low", low)):
        for e in _episodes(op, flag):
            if len(e) < min_polls:
                continue
            peak = e.loc[e["wait_minutes"].idxmax() if side == "high" else e["wait_minutes"].idxmin()]
            out.append({"type": "unusual", "side": side, "ride_id": peak["ride_id"], "ride_name": peak["ride_name"],
                        "at": _iso(e["timestamp_utc"].iloc[0]), "until": _iso(e["timestamp_utc"].iloc[-1]),
                        "polls": int(len(e)), "peak": _f(peak["wait_minutes"]),
                        "p10": _f(peak["p10"]), "p90": _f(peak["p90"])})
    return out


# ── Crowd, closures, bellwethers ──────────────────────────────────────────────

def crowd_series(df: pd.DataFrame, baselines: dict, park_id: str) -> dict:
    crowd_b, morning_b = baselines.get("crowd"), baselines.get("morning")
    if df.empty or not crowd_b:
        return {"ratio": [], "morning_index": None}
    frame = df[["timestamp_utc", "status", "wait_minutes", "ride_id", "park_id"]]
    series, morning = [], None
    hol = holiday_features(frame["timestamp_utc"].iloc[0].to_pydatetime())  # one LA date per call
    for ts in sorted(frame["timestamp_utc"].unique()):
        ts = pd.Timestamp(ts)
        now_la = ts.tz_convert(LA).to_pydatetime()
        window = frame[frame["timestamp_utc"] <= ts]
        ratio = crowd_level_ratio_live(window, now_la, hol, crowd_b).get(park_id)
        series.append({"at": _iso(ts), "ratio": _f(ratio)})
        if morning is None and morning_b:
            morning = morning_crowd_index_live(window, now_la, hol, morning_b).get(park_id)
    return {"ratio": series, "morning_index": _f(morning)}


def closures_payload(df: pd.DataFrame, closures: list[dict], open_closures: list[dict], window_min: int) -> list[dict]:
    out = []
    for c in closures:
        reopened = pd.Timestamp(c["reopenedAt"]).tz_convert("UTC")
        after = df if df.empty else df[(df["ride_id"] == c["rideId"]) & (df["timestamp_utc"] >= reopened)
                   & (df["timestamp_utc"] < reopened + pd.Timedelta(minutes=window_min))
                   & (df["status"] == "OPERATING")]
        out.append({
            "ride_id": c["rideId"], "ride_name": c.get("rideName"), "closed_at": c.get("closedAt"),
            "reopened_at": c["reopenedAt"], "duration_min": _f(c.get("durationMin")),
            "wait_at_close": _f(c.get("waitAtClose")), "wait_at_reopen": _f(c.get("waitAtReopen")),
            "recovery": [] if after.empty else [
                {"min_after": round((t - reopened).total_seconds() / 60), "wait": _f(w)}
                for t, w in zip(after["timestamp_utc"], after["wait_minutes"])],
        })
    for c in open_closures:
        out.append({"ride_id": c.get("rideId"), "ride_name": c.get("rideName"), "closed_at": c.get("closedAt"),
                    "reopened_at": None, "duration_min": None, "wait_at_close": _f(c.get("waitAtClose")),
                    "recovery": [], "open": True})
    return sorted(out, key=lambda c: c.get("closed_at") or "")


def bellwether_series(df: pd.DataFrame, m: pd.DataFrame, ride_ids, horizons) -> list[dict]:
    out = []
    for rid in ride_ids:
        r = df[df["ride_id"] == rid] if not df.empty else df
        if r.empty:
            out.append({"ride_id": rid, "ride_name": None, "actual": [], "forecasts": {}})
            continue
        fc = {}
        for h in horizons:
            col = f"t{h}"
            if col in r.columns:
                f = r[r[col].notna() & ~r["tombstone"] & (r["status"] == "OPERATING")]
                fc[str(h)] = [{"at": _iso(t + pd.Timedelta(minutes=h)), "value": _f(v)}
                              for t, v in zip(f["timestamp_utc"], f[col])]
        mr = m[m["ride_id"] == rid] if not m.empty else m
        out.append({
            "ride_id": rid, "ride_name": r["ride_name"].dropna().iloc[-1] if r["ride_name"].notna().any() else None,
            "actual": [{"at": _iso(t), "wait": _f(w), "status": s}
                       for t, w, s in zip(r["timestamp_utc"], r["wait_minutes"], r["status"])],
            "forecasts": fc,
            "mae": {str(h): _f(g["abs_err"].mean()) for h, g in mr.groupby("horizon")} if not mr.empty else {},
        })
    return out


def ride_averages(df: pd.DataFrame) -> list[dict]:
    if df.empty:
        return []
    op = df[(df["status"] == "OPERATING") & df["wait_minutes"].notna()]
    if op.empty:
        return []
    g = op.groupby(["ride_id", "ride_name"])["wait_minutes"].agg(["mean", "max", "min", "size"]).reset_index()
    return [{"ride_id": r.ride_id, "ride_name": r.ride_name, "avg": _f(r.mean), "max": _f(r.max),
             "min": _f(r.min), "polls": int(r.size)} for r in g.sort_values("mean", ascending=False).itertuples()]


# ── Entry points ──────────────────────────────────────────────────────────────

def grade(
    run_docs: list[dict], schedules_df: pd.DataFrame, closures: list[dict], open_closures: list[dict],
    manifest: dict, baselines: dict, ride_metadata: dict, date_la: date, config: dict | None = None,
) -> dict:
    """Pure: everything the dashboard shows for one LA date, per park."""
    config = config or load_config()
    horizons = config["horizons"]
    raw = runs_frame(run_docs)
    hours = public_hours(schedules_df)
    if raw.empty:
        df = raw
    else:
        df, _ = clean_frame(raw, schedules_df, ride_metadata)
    m = match_forecasts(df, horizons, config["match_slack_min"]) if not df.empty else pd.DataFrame()

    hol = holiday_features(datetime.combine(date_la, time(12), tzinfo=LA))
    js_dow = (date_la.weekday() + 1) % 7
    day_type = "holiday" if hol["is_holiday"] else ("weekend" if js_dow in (0, 6) else "weekday")

    closes = {}
    for r in hours[hours["date_la"] == date_la].itertuples():
        if not pd.isna(r.close_minutes):
            closes[r.park_id] = pd.Timestamp(datetime.combine(date_la, time(0), tzinfo=LA)
                                             + timedelta(minutes=float(r.close_minutes))).tz_convert("UTC")
    reopens = pd.DataFrame([{"ride_id": c["rideId"], "reopened_at": pd.Timestamp(c["reopenedAt"]).tz_convert("UTC")}
                            for c in closures if c.get("reopenedAt")], columns=["ride_id", "reopened_at"])

    parks = {}
    for park_id, park_name in config["park_names"].items():
        pdf = df[df["park_id"] == park_id] if not df.empty else df
        pm = m[m["park_id"] == park_id] if not m.empty else m
        p_closures = [c for c in closures if c.get("parkId") == park_id]
        p_open = [c for c in open_closures if c.get("parkId") == park_id]
        anomalies = (big_misses(pm, config)
                     + fall_calls(pdf, pm, manifest.get("trend_thresholds"))
                     + unusual_waits(pdf, baselines.get("hour_bands"), day_type,
                                     config.get("unusual_margin_min", 0), config.get("unusual_min_polls", 1)))
        parks[park_id] = {
            "park_id": park_id,
            "park_name": park_name,
            "runs": int(pdf["run_at"].nunique()) if not pdf.empty else 0,
            "first_poll": _iso(pdf["timestamp_utc"].min()) if not pdf.empty else None,
            "last_poll": _iso(pdf["timestamp_utc"].max()) if not pdf.empty else None,
            "model_versions": sorted(pdf["model_version"].dropna().unique().tolist()) if not pdf.empty else [],
            "deploy_markers": deploy_markers(pdf),
            "headline": headline(pm, horizons, config["tolerance_min"]),
            "by_model_version": by_model_version(pm, config),
            "slices": slices(pm, closes, reopens, config),
            "trend": trend_scorecard(pm),
            "probability_honesty": probability_honesty(pm),
            "error_by_hour": error_by_hour(pm, horizons),
            "worst_misses": (pm.nlargest(5, "abs_err")[["ride_id", "ride_name", "timestamp_utc", "horizon",
                                                        "forecast", "actual", "err"]]
                             .assign(timestamp_utc=lambda x: x["timestamp_utc"].map(_iso))
                             .rename(columns={"timestamp_utc": "at"})
                             .map(lambda v: _f(v) if isinstance(v, float) else v)
                             .to_dict("records")) if not pm.empty else [],
            "crowd": crowd_series(pdf, baselines, park_id),
            "anomalies": sorted(anomalies, key=lambda a: a["at"] or ""),
            "closures": closures_payload(pdf, p_closures, p_open, config["post_reopen_window_min"]),
            "bellwethers": bellwether_series(pdf, pm, config["bellwethers"].get(park_id, []), horizons),
            "ride_averages": ride_averages(pdf),
        }
    return {
        "date": date_la.isoformat(),
        "day_type": day_type,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "baselines_range": (baselines.get("_meta") or {}).get("range"),
        "parks": parks,
    }


def _schedules_frame(db, date_la: date, park_ids) -> pd.DataFrame:
    rows = []
    for pid in park_ids:
        snap = db.collection("park_schedules").document(f"{pid}_{date_la.isoformat()}").get()
        if snap.exists:
            d = snap.to_dict()
            rows.append({"entries": d.get("entries") or [], "parkName": d.get("parkName"),
                         "parkId": pid, "date": date_la.isoformat()})
    return pd.DataFrame(rows, columns=["entries", "parkName", "parkId", "date"])


def _load_manifest() -> dict:
    """The deployed manifest from GCS; the repo copy if that read fails."""
    try:
        from google.cloud import storage
        blob = storage.Client().bucket("club32-models").blob("manifest.json")
        return json.loads(blob.download_as_text())
    except Exception as e:
        log.warning("GCS manifest read failed (%s); using models/manifest.json", e)
        path = ROOT / "models" / "manifest.json"
        return json.loads(path.read_text()) if path.exists() else {}


def grade_day(db, date_la: date, manifest: dict | None = None) -> dict:
    """Load one LA date from Firestore and grade it."""
    config = load_config()
    from google.cloud.firestore_v1.base_query import FieldFilter

    runs = db.collection(RUNS_COLLECTION).where(filter=FieldFilter("date_la", "==", date_la.isoformat()))
    run_docs = [s.to_dict() for s in runs.stream()]
    start = datetime.combine(date_la, time(0), tzinfo=LA).astimezone(timezone.utc)
    end = start + timedelta(days=1)
    closures = [
        s.to_dict() for s in db.collection("closure_events")
        .where(filter=FieldFilter("reopenedAt", ">=", start.isoformat()))
        .where(filter=FieldFilter("reopenedAt", "<", end.isoformat())).stream()
    ]
    today = datetime.now(LA).date()
    open_closures = [s.to_dict() for s in db.collection("current_closures").stream()] if date_la == today else []
    ride_metadata = json.loads((ROOT / "ride_metadata.json").read_text())
    return grade(
        run_docs, _schedules_frame(db, date_la, config["park_names"]), closures, open_closures,
        manifest if manifest is not None else _load_manifest(), load_baselines(), ride_metadata, date_la, config,
    )


def main() -> None:
    """Dry run against prod (reads only): python ml/dashboard/grading.py --date 2026-10-24"""
    import argparse

    import firebase_admin
    from firebase_admin import credentials, firestore

    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=datetime.now(LA).date().isoformat())
    parser.add_argument("--key", default=str(ROOT / "firebase-key.json"))
    args = parser.parse_args()
    firebase_admin.initialize_app(credentials.Certificate(args.key))
    payload = grade_day(firestore.client(), date.fromisoformat(args.date))
    for p in payload["parks"].values():
        print(f"\n{p['park_name']}: {p['runs']} runs, versions {p['model_versions']}")
        for h in p["headline"]:
            print(f"  t{h['horizon']}: n={h['n']} mae={h.get('mae')} persist={h.get('mae_persistence')} "
                  f"lift={h.get('lift_pct')}% hit={h.get('hit_rate')}")
        print(f"  crowd morning={p['crowd']['morning_index']} last ratio="
              f"{next((c['ratio'] for c in reversed(p['crowd']['ratio']) if c['ratio'] is not None), None)}")
        print(f"  anomalies={len(p['anomalies'])} closures={len(p['closures'])}")


if __name__ == "__main__":
    main()
