"""Session 3 variant experiment: how should the crowd features be keyed?

Recomputes crowd_level_ratio and morning_crowd_index with cron/crowd_features.py,
expected tables fit on the forward split's train days only, swaps them into the
notebook's cleaned feature frame, and scores each variant with the scoreboard.

  V0  ratio as in the frame (day_type, hour, month; fit on all days) — reference
  V1  ratio keyed (day_type, hour)
  V2  ratio keyed (park, day_type, hour)
  M0  winning ratio, morning index as in the frame
  M1  winning ratio, morning = P75 of headliners (median >= 20), per park, (park, day_type)
  M1b same with headliners median >= 30
  M2  winning ratio, morning index dropped from the day-profile features

Decision rules (spec R4, plan step 4):
  ratio   -> V2 if its day-profile serving-style MAE beats V1 by more than the
             paired half-width AND its DCA day-profile MAE beats V1; else V1.
  morning -> the better of M1/M1b if it beats M2 by more than the paired
             half-width; else M2.

    .venv/bin/python -m ml.experiments.session3_crowd_variants

Reads df_features_cache.pkl at the repo root (refuses if it is missing or
older than df_cache.pkl), writes reports/eval/<today>_session3-variants.md.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parents[2]
for p in (REPO, REPO / "cron"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from crowd_features import (  # noqa: E402
    crowd_level_ratio_frame,
    headliner_ride_ids,
    morning_crowd_index_frame,
)
from ml import evaluate, metrics, recipes  # noqa: E402
from ml.report import _table  # noqa: E402
from ml.splits import forward_split  # noqa: E402

FRAME = REPO / "df_features_cache.pkl"
RAW_CACHE = REPO / "df_cache.pkl"
CLEAN_REPORT = "reports/eval/2026-10-16_clean.md"
CLEAN_SERVING_MAE = 7.09   # recipe_A_serving in CLEAN_REPORT
CLEAN_FRAME_MAE = 6.77     # recipe_A in CLEAN_REPORT
V0_TOLERANCE = 0.05
DCA, DL = "Disney California Adventure Park", "Disneyland Park"
HORIZONS = [30, 60, 120]


def _load() -> pd.DataFrame:
    if not FRAME.exists():
        print(f"{FRAME.name} not found at the repo root; run the notebook's DUMP cell first.")
        sys.exit(2)
    if RAW_CACHE.exists() and FRAME.stat().st_mtime < RAW_CACHE.stat().st_mtime:
        print(f"{FRAME.name} is older than {RAW_CACHE.name}; re-run the notebook through the DUMP cell first.")
        sys.exit(2)
    t0 = time.time()
    df = pd.read_pickle(FRAME)
    print(f"Loaded {FRAME.name}: {df.shape} in {time.time() - t0:.1f}s")
    return df


def _run(df, cats, name, horizons, day_cols=None):
    t0 = time.time()
    res = evaluate.run(
        df, *cats, weeks=4, horizons=horizons, also_interleaved=False, run_staleness=False,
        write_report=False, label=name, model_dir="does-not-exist", day_profile_feature_cols=day_cols,
    )
    print(f"  {name}: {time.time() - t0:.0f}s")
    return res


def _summary(res, horizons) -> dict:
    mae = res.day_profile["mae"]["mae"]
    by_park = res.day_profile["by_park"]["recipe_A_serving"]
    row = {
        "dp_mae_frame": mae["recipe_A"],
        "dp_mae_serving": mae["recipe_A_serving"],
        "dca_dp_mae": by_park.get(DCA, np.nan),
        "dl_dp_mae": by_park.get(DL, np.nan),
    }
    for h in HORIZONS:
        row[f"T+{h}_mae"] = res.headline.loc[h, "recipe_A"] if h in horizons else np.nan
    return row


def _paired(df, rows, y, a: pd.Series, b: pd.Series, mask=None) -> dict:
    r = rows if mask is None else (rows & mask)
    return metrics.paired_daily(df, r, y, a.reindex(df.index), b.reindex(df.index))


def _fmt_paired(p: dict) -> str:
    return f"{p['mean']:+.3f} ± {p['half_width_95']:.3f}"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--morning-horizons", default="30,60,120",
                    help="trajectory horizons for the morning variants ('' = day-profile only)")
    args = ap.parse_args(argv)
    morning_horizons = [int(h) for h in args.morning_horizons.split(",") if h]

    started = time.time()
    df = _load()
    cats = (df.attrs["RIDE_ID_CATEGORIES"], df.attrs["STATUS_CATEGORIES"])
    train, test = forward_split(df, weeks=4)
    rows = (test & df["wait_minutes"].notna()).astype(bool)
    y = df["wait_minutes"]
    dca_mask = df["park_name"] == DCA
    orig_ratio = df["crowd_level_ratio"].copy()
    orig_morning = df["morning_crowd_index"].copy()

    results, preds, paired = {}, {}, {}
    by_hour = {}

    print("Ratio variants")
    # Columns are swapped in place (and restored) rather than copying the
    # 1 GB frame per variant; evaluate.run does not mutate df.
    variants = {
        "V0": orig_ratio,
        "V1": crowd_level_ratio_frame(df, train, ("day_type", "hour")),
        "V2": crowd_level_ratio_frame(df, train, ("park", "day_type", "hour")),
    }
    for name, ratio in variants.items():
        df["crowd_level_ratio"] = ratio
        res = _run(df, cats, name, HORIZONS)
        results[name] = _summary(res, HORIZONS)
        preds[name] = res.day_profile["preds"]["recipe_A_serving"]
        by_hour[name] = res.day_profile["by_hour"]["recipe_A_serving"]
        del res

    v0_serving = results["V0"]["dp_mae_serving"]
    v0_match = abs(v0_serving - CLEAN_SERVING_MAE) <= V0_TOLERANCE
    for name in ("V0", "V2"):
        paired[name] = _paired(df, rows, y, preds[name], preds["V1"])
    v2_dca_paired = _paired(df, rows, y, preds["V2"], preds["V1"], dca_mask)
    v2_overall_ok = paired["V2"]["mean"] < -paired["V2"]["half_width_95"]
    v2_dca_ok = results["V2"]["dca_dp_mae"] < results["V1"]["dca_dp_mae"]
    ratio_winner = "V2" if (v2_overall_ok and v2_dca_ok) else "V1"
    spec_strict_v2 = v2_overall_ok and v2_dca_paired["mean"] < -v2_dca_paired["half_width_95"]
    df["crowd_level_ratio"] = variants[ratio_winner]

    print(f"Morning variants (ratio = {ratio_winner})")
    heads20 = headliner_ride_ids(df, train, 20)
    heads30 = headliner_ride_ids(df, train, 30)
    results["M0"] = dict(results[ratio_winner])
    preds["M0"] = preds[ratio_winner]
    morning = {
        "M1": morning_crowd_index_frame(df, train, ("park", "day_type"), ride_filter=heads20, stat="p75"),
        "M1b": morning_crowd_index_frame(df, train, ("park", "day_type"), ride_filter=heads30, stat="p75"),
        "M2": pd.Series(np.nan, index=df.index),
    }
    no_morning = [c for c in recipes.DAY_PROFILE_FEATURE_COLS if c != "morning_crowd_index"]
    for name, col in morning.items():
        df["morning_crowd_index"] = col
        res = _run(df, cats, name, morning_horizons, day_cols=no_morning if name == "M2" else None)
        results[name] = _summary(res, morning_horizons)
        preds[name] = res.day_profile["preds"]["recipe_A_serving"]
        del res
    df["crowd_level_ratio"], df["morning_crowd_index"] = orig_ratio, orig_morning

    for name in ("M0", "M1", "M1b"):
        paired[name] = _paired(df, rows, y, preds[name], preds["M2"])
    best_m1 = "M1b" if results["M1b"]["dp_mae_serving"] < results["M1"]["dp_mae_serving"] else "M1"
    morning_winner = best_m1 if paired[best_m1]["mean"] < -paired[best_m1]["half_width_95"] else "M2"

    # ── Tables ────────────────────────────────────────────────────────────────
    table = pd.DataFrame.from_dict(results, orient="index")
    table.index.name = "variant"
    table["paired_vs"] = ["V1" if n.startswith("V") else "M2" for n in table.index]
    table.loc["V1", "paired_vs"] = table.loc["M2", "paired_vs"] = "—"
    table["paired_mean"] = [paired[n]["mean"] if n in paired else np.nan for n in table.index]
    table["half_width_95"] = [paired[n]["half_width_95"] if n in paired else np.nan for n in table.index]
    table["sign_test_p"] = [paired[n]["sign_test_p"] if n in paired else np.nan for n in table.index]

    hour_frame = pd.DataFrame({"hour_of_day": df.loc[rows, "hour_of_day"], "dca": dca_mask[rows]})
    hours = pd.DataFrame({"V1_all": by_hour["V1"], "V2_all": by_hour["V2"]})
    for name in ("V1", "V2"):
        err = (y[rows] - preds[name]).abs()
        hours[f"{name}_dca"] = err[hour_frame["dca"]].groupby(hour_frame.loc[hour_frame["dca"], "hour_of_day"]).mean()
        hours[f"{name}_dl"] = err[~hour_frame["dca"]].groupby(hour_frame.loc[~hour_frame["dca"], "hour_of_day"]).mean()
    hours["V2_minus_V1_dca"] = hours["V2_dca"] - hours["V1_dca"]
    hours.index.name = "hour_of_day"

    names = df[["ride_id", "ride_name", "park_name"]].drop_duplicates("ride_id").set_index("ride_id")
    def heads_table(ids):
        t = names.loc[ids].sort_values(["park_name", "ride_name"]).reset_index()
        return t.set_index("ride_name")[["park_name", "ride_id"]]

    lines = [
        f"# Session 3 crowd-feature variants — {date.today().isoformat()}",
        "",
        f"- Frame: `{FRAME.name}` {df.shape[0]:,} rows, {df['date_la'].min()} to {df['date_la'].max()}",
        f"- Forward split, 4 weeks: train {int(df.loc[train, 'date_la'].nunique())} days, "
        f"test {int(df.loc[test, 'date_la'].nunique())} days; expected tables fit on train days only (V0 excepted).",
        "- Day-profile MAE columns are Recipe A; 'serving' replaces the crowd features with each day's (and park's) "
        "13:00 value, as `_build_full_day` does. DCA / DL are serving-style MAE by park.",
        "- Paired: mean of daily MAE(variant) − MAE(reference) on serving-style day-profile, ± 95% half-width; "
        "negative = variant better. p = sign test on daily wins.",
        f"- Morning variants: trajectory horizons {morning_horizons or 'none'} (trajectory does not read morning_crowd_index).",
        "",
        "## Variants",
        "",
        _table(table),
        "",
        "## Decisions",
        "",
        f"**V0 reference:** serving-style {v0_serving:.3f} vs {CLEAN_SERVING_MAE} in `{CLEAN_REPORT}` "
        f"({'match' if v0_match else 'MISMATCH'}, tolerance {V0_TOLERANCE}); frame-features "
        f"{results['V0']['dp_mae_frame']:.3f} vs {CLEAN_FRAME_MAE}.",
        "",
        f"**Ratio → {ratio_winner}.** V2 vs V1 serving-style paired {_fmt_paired(paired['V2'])} "
        f"(beats half-width: {v2_overall_ok}); DCA MAE V2 {results['V2']['dca_dp_mae']:.3f} vs V1 "
        f"{results['V1']['dca_dp_mae']:.3f} (improves: {v2_dca_ok}); DCA-only paired {_fmt_paired(v2_dca_paired)}. "
        f"Spec's stricter reading (DCA also beyond its half-width) would pick {'V2' if spec_strict_v2 else 'V1'}.",
        "",
        f"**Morning → {morning_winner}.** Better of M1/M1b by serving MAE: {best_m1} "
        f"({results[best_m1]['dp_mae_serving']:.3f}); vs M2 paired {_fmt_paired(paired[best_m1])} "
        f"(beats half-width: {paired[best_m1]['mean'] < -paired[best_m1]['half_width_95']}). "
        f"M0 vs M2 paired {_fmt_paired(paired['M0'])}.",
        "",
        "## Day-profile serving-style MAE by hour, V1 vs V2",
        "",
        _table(hours),
        "",
        f"## Headliners (median OPERATING wait over train days ≥ 20: {len(heads20)}; ≥ 30: {len(heads30)})",
        "",
        _table(heads_table(heads20).assign(ge_30=lambda t: t["ride_id"].isin(heads30))),
        "",
    ]
    out = REPO / "reports" / "eval" / f"{date.today().isoformat()}_session3-variants.md"
    out.write_text("\n".join(lines))

    with pd.option_context("display.width", 250, "display.max_columns", 30, "display.float_format", "{:.3f}".format):
        print(table)
        print(hours)
    print("\n".join(lines[lines.index("## Decisions") + 2: lines.index("## Day-profile serving-style MAE by hour, V1 vs V2")]))
    print(f"Wrote {out.relative_to(REPO)} in {time.time() - started:.0f}s total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
