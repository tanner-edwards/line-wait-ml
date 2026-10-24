"""Build ml/dashboard/baselines.json from the local caches (read-only on Firestore: none).

    .venv/bin/python ml/dashboard/build_baselines.py

Three tables, all from the cleaned, walk-on-normalized collector cache:
- crowd:   per-park expected 2h rolling sum, keyed park|day_type|hour
           (crowd_features.crowd_expected_table, same as the model's table
           but split by park). Feeds crowd_level_ratio_live.
- morning: per-park expected first-2h median over headliners (median wait
           >= 20), keyed park|day_type (crowd_features.morning_expected_table).
           Feeds morning_crowd_index_live, which reads the ride filter from _meta.
- hour_bands: P10/P90 of OPERATING waits per ride_name|day_type|hour, for the
           "unusual vs typical" anomaly.

The model never reads this file. Re-run whenever the caches are refreshed.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "cron"))

import crowd_features  # noqa: E402
from ml.clean import clean_frame  # noqa: E402
from predict import _normalize_walk_on  # noqa: E402

DLR_PARKS = (crowd_features.DL_PARK_ID, crowd_features.DCA_PARK_ID)
HERE = Path(__file__).resolve().parent


def load_frame(cache: Path, schedules: Path, metadata: Path) -> pd.DataFrame:
    df = pd.read_pickle(cache)
    df = df[df["park_id"].isin(DLR_PARKS)].copy()
    df["wait_minutes"] = _normalize_walk_on(df["wait_minutes"])
    sched = pd.read_pickle(schedules)
    last_sched = pd.to_datetime(sched["date"]).max().date()
    last_wait = df["timestamp_utc"].max().tz_convert("America/Los_Angeles").date()
    if last_sched < last_wait:
        print(f"WARNING: schedules end {last_sched}, waits end {last_wait}; "
              "party nights after that date are not dropped (see ml/README.md)")
    df, _ = clean_frame(df, sched, json.loads(metadata.read_text()))
    df["date_la"] = df["timestamp_utc"].dt.tz_convert("America/Los_Angeles").dt.date
    return df


def hour_bands(df: pd.DataFrame, min_samples: int) -> dict:
    op = df[(df["status"] == "OPERATING") & df["wait_minutes"].notna()]
    op = op.assign(_day_type=crowd_features._day_types(op))
    g = op.groupby(["ride_name", "_day_type", "hour_of_day"])["wait_minutes"]
    stats = pd.DataFrame({
        "p10": g.quantile(0.10), "p90": g.quantile(0.90), "n": g.size(),
    })
    stats = stats[stats["n"] >= min_samples]
    return {
        f"{name}|{dt}|{int(hour)}": {"p10": float(r.p10), "p90": float(r.p90), "n": int(r.n)}
        for (name, dt, hour), r in stats.iterrows()
    }


def build(df: pd.DataFrame, config: dict) -> dict:
    every_row = pd.Series(True, index=df.index)
    return {
        "_meta": {
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "rows": len(df),
            "range": [str(df["date_la"].min()), str(df["date_la"].max())],
        },
        "crowd": crowd_features.crowd_expected_table(df, every_row, ("park", "day_type", "hour")),
        # Headliners only: an all-ride first-2h median is ~5 every day (small
        # rides dominate), which makes the index useless.
        "morning": crowd_features.morning_expected_table(
            df, every_row, ("park", "day_type"),
            ride_filter=crowd_features.headliner_ride_ids(df, every_row),
        ),
        "hour_bands": hour_bands(df, config["hour_band_min_samples"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cache", default=str(ROOT / "df_cache.pkl"))
    parser.add_argument("--schedules", default=str(ROOT / "park_schedules_cache.pkl"))
    parser.add_argument("--metadata", default=str(ROOT / "ride_metadata.json"))
    parser.add_argument("--out", default=str(HERE / "baselines.json"))
    args = parser.parse_args()

    config = json.loads((HERE / "config.json").read_text())
    df = load_frame(Path(args.cache), Path(args.schedules), Path(args.metadata))
    out = build(df, config)
    Path(args.out).write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    print(f"wrote {args.out}: {len(out['crowd']) - 1} crowd keys, {len(out['morning']) - 1} morning keys, "
          f"{len(out['hour_bands'])} hour bands, range {out['_meta']['range']}")


if __name__ == "__main__":
    main()
