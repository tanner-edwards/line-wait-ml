"""Per-ride and per-poll features from fields collect.js already writes — one
implementation for training and serving (Session 6, the crowd_features.py pattern).

  n_operating_rides_park  int   — rows in this poll and park with status OPERATING
  n_headliners_down       int   — headliners in this poll and park not OPERATING
  last_updated_age_min    float — minutes from raw.lastUpdated to the poll, clipped 0..360
  posting_tier            str   — 'automated' (per-ride median age <= 5) | 'hand'
  ll_offset_min           float — minutes from the poll to the Lightning Lane
                                  return-window start (AVAILABLE only), clipped -60..600
  ll_state                str   — 'NONE' | 'AVAILABLE' | 'FINISHED'
  lags_missing            int   — 1 when an OPERATING row's lags were filled with
                                  the current wait (first polls after a reopen)

Headliners and posting tiers are fit once (at export) and shipped as JSON
sidecars (headliners.json, posting_tiers.json); serving reads them and never
recomputes them.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRAINING TIME (ml/features.py):

    from ml.features import add_session6_features
    df = add_session6_features(df, headliners=..., tiers=...)

INFERENCE TIME (predict.py):

    sidecars = load_sidecars(model_dir)
    counts = operating_counts(latest_poll_rows, sidecars["headliners"])
    feat_row.update(counts.get(park_id, {}))
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

HEADLINER_MIN_MEDIAN = 30
AGE_CLIP_MIN = 360.0
AUTOMATED_MAX_AGE = 5.0
LL_CLIP = (-60.0, 600.0)
LL_QUEUES = ("RETURN_TIME", "PAID_RETURN_TIME")  # paid is treated the same (two rides)
LL_STATES = ["NONE", "AVAILABLE", "FINISHED"]
POSTING_TIERS = ["automated", "hand"]
LAG_COLS = ["wait_lag_1", "wait_lag_2", "wait_lag_3"]

HEADLINERS_FILE = "headliners.json"
POSTING_TIERS_FILE = "posting_tiers.json"
SIDECAR_FILES = [HEADLINERS_FILE, POSTING_TIERS_FILE]


# ── Headliners and per-poll operating counts (F1) ───────────────────────────

def headliners(df: pd.DataFrame, min_median: float = HEADLINER_MIN_MEDIAN) -> list[str]:
    """ride_ids whose median OPERATING wait_minutes is >= min_median, sorted."""
    op = df.loc[df["status"] == "OPERATING", ["ride_id", "wait_minutes"]].dropna()
    med = op.groupby("ride_id")["wait_minutes"].median()
    return sorted(str(r) for r in med.index[med >= min_median])


def operating_counts(poll_df: pd.DataFrame, headliner_ids) -> dict:
    """{park_id: {"n_operating_rides_park": int, "n_headliners_down": int}} from
    the rows of one poll (ride_id, park_id, status). Tracked rides = the rows
    present in that poll; a headliner absent from the poll is not counted."""
    heads = set(headliner_ids or ())
    out = {}
    for park_id, g in poll_df.groupby("park_id", sort=False):
        operating = g["status"] == "OPERATING"
        out[park_id] = {
            "n_operating_rides_park": int(operating.sum()),
            "n_headliners_down": int((g["ride_id"].isin(heads) & ~operating).sum()),
        }
    return out


def operating_counts_frame(df: pd.DataFrame, headliner_ids) -> pd.DataFrame:
    """Vectorized operating_counts for every row of a frame: the two counts of
    the row's (park_id, timestamp_utc) poll, aligned to df.index."""
    heads = set(headliner_ids or ())
    operating = (df["status"] == "OPERATING").astype(int)
    head_down = (df["ride_id"].isin(heads) & (df["status"] != "OPERATING")).astype(int)
    keys = [df["park_id"], df["timestamp_utc"]]
    return pd.DataFrame({
        "n_operating_rides_park": operating.groupby(keys).transform("sum").astype(int),
        "n_headliners_down": head_down.groupby(keys).transform("sum").astype(int),
    }, index=df.index)


# ── Posting staleness (F2) ──────────────────────────────────────────────────

def _as_utc(ts) -> datetime | None:
    if ts is None:
        return None
    if isinstance(ts, pd.Timestamp):
        ts = ts.to_pydatetime()
    if isinstance(ts, str):
        try:
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(ts, datetime):
        return None
    return ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts.astimezone(timezone.utc)


def last_updated_age_min(last_updated_iso, poll_ts) -> float | None:
    """Minutes from raw.lastUpdated to the poll, clipped to 0..360; None when
    either is missing or unparseable."""
    lu, poll = _as_utc(last_updated_iso), _as_utc(poll_ts)
    if lu is None or poll is None:
        return None
    age = (poll - lu).total_seconds() / 60
    return float(min(AGE_CLIP_MIN, max(0.0, age)))


def last_updated_age_frame(last_updated: pd.Series, poll_ts: pd.Series) -> pd.Series:
    """Vectorized last_updated_age_min (NaN where missing)."""
    lu = pd.to_datetime(last_updated, utc=True, errors="coerce", format="ISO8601")
    age = (pd.to_datetime(poll_ts, utc=True) - lu).dt.total_seconds() / 60
    return age.clip(lower=0.0, upper=AGE_CLIP_MIN).astype(float)


def posting_tiers(ages: pd.DataFrame) -> dict:
    """{ride_id: 'automated' | 'hand'} from a frame of (ride_id, age): median age
    <= 5 minutes is automated. Callers pass OPERATING rows of the fit window."""
    med = ages.dropna(subset=["age"]).groupby("ride_id")["age"].median()
    return {str(r): ("automated" if m <= AUTOMATED_MAX_AGE else "hand") for r, m in med.sort_index().items()}


# ── Lightning Lane (F3) ─────────────────────────────────────────────────────

def ll_fields(queue: dict | None, poll_ts) -> tuple[float | None, str]:
    """(ll_offset_min, ll_state) from raw.queue. RETURN_TIME, else
    PAID_RETURN_TIME; no such queue -> (None, 'NONE'). Offset only when
    AVAILABLE with a parseable returnStart, clipped to [-60, 600]. A state
    other than AVAILABLE / FINISHED reads as NONE."""
    q = queue if isinstance(queue, dict) else {}
    spec = next((q[k] for k in LL_QUEUES if isinstance(q.get(k), dict)), None)
    if spec is None:
        return None, "NONE"
    state = spec.get("state")
    if state == "FINISHED":
        return None, "FINISHED"
    if state != "AVAILABLE":
        return None, "NONE"
    start, poll = _as_utc(spec.get("returnStart")), _as_utc(poll_ts)
    if start is None or poll is None:
        return None, "AVAILABLE"
    offset = (start - poll).total_seconds() / 60
    return float(min(LL_CLIP[1], max(LL_CLIP[0], offset))), "AVAILABLE"


# ── Reopen rows (F4) ────────────────────────────────────────────────────────

def fill_missing_lags(df: pd.DataFrame) -> pd.DataFrame:
    """Copy of df where OPERATING rows with a wait and any null wait_lag_1..3
    have each null lag filled with wait_minutes and lags_missing = 1 (else 0);
    wait_delta_1 is recomputed as wait - lag1 where lag1 was filled. Does not
    touch training_valid_* (the caller decides which rows become trainable)."""
    out = df.copy()
    lags = out[LAG_COLS]
    fill = (out["status"] == "OPERATING") & out["wait_minutes"].notna() & lags.isna().any(axis=1)
    for c in LAG_COLS:
        out[c] = out[c].where(~(fill & out[c].isna()), out["wait_minutes"])
    if "wait_delta_1" in out.columns:
        out["wait_delta_1"] = out["wait_delta_1"].where(~fill, out["wait_minutes"] - out["wait_lag_1"])
    out["lags_missing"] = fill.astype(int)
    return out


# ── Sidecars ────────────────────────────────────────────────────────────────

def sidecar_data(df: pd.DataFrame) -> dict:
    """{'headliners.json': [...], 'posting_tiers.json': {...}} fit on every row of df."""
    op = df["status"] == "OPERATING"
    if "last_updated_age_min" in df.columns:
        age = df["last_updated_age_min"]
    else:
        age = last_updated_age_frame(df["raw"].map(lambda r: r.get("lastUpdated") if isinstance(r, dict) else None),
                                     df["timestamp_utc"])
    ages = pd.DataFrame({"ride_id": df.loc[op, "ride_id"], "age": age[op]})
    return {HEADLINERS_FILE: headliners(df), POSTING_TIERS_FILE: posting_tiers(ages)}


def export_sidecars(df: pd.DataFrame, out_dir) -> list[str]:
    """Write headliners.json and posting_tiers.json into out_dir; return the file names."""
    out = Path(out_dir)
    for name, data in sidecar_data(df).items():
        (out / name).write_text(json.dumps(data, indent=2) + "\n")
    return list(SIDECAR_FILES)


def load_sidecars(model_dir) -> dict:
    """{'headliners': [...], 'posting_tiers': {...}}; a missing or unreadable
    file reads as empty (counts still compute, tier is None -> NaN)."""
    d = Path(model_dir)

    def read(name, default):
        try:
            data = json.loads((d / name).read_text())
            return data if isinstance(data, type(default)) else default
        except (OSError, ValueError):
            return default

    return {"headliners": read(HEADLINERS_FILE, []), "posting_tiers": read(POSTING_TIERS_FILE, {})}
