"""
Evaluates the accuracy of median-based closure duration predictions.

For each ride with enough data:
  - Overall: median, std dev, MAE
  - Split at several thresholds to find the natural blip/break seam
  - Whether splitting improves prediction accuracy

Run from repo root:
  python scripts/closure_prediction_eval.py
"""

import pandas as pd
import numpy as np
from pathlib import Path

CSV_PATH = Path(__file__).parent / "closure_events.csv"
MIN_SAMPLES = 10       # minimum closures to include a ride
MIN_SPLIT_SAMPLES = 5  # minimum events per bucket to evaluate split

THRESHOLDS = [15, 20, 25, 30, 40, 45, 60]


def mae(actuals, prediction):
    return np.mean(np.abs(actuals - prediction))


def eval_split(durations, threshold):
    blips = durations[durations <= threshold]
    breaks = durations[durations > threshold]
    if len(blips) < MIN_SPLIT_SAMPLES or len(breaks) < MIN_SPLIT_SAMPLES:
        return None
    blip_pred = blips.median()
    break_pred = breaks.median()
    blip_mae = mae(blips, blip_pred)
    break_mae = mae(breaks, break_pred)
    # Weighted average MAE across both buckets
    n = len(durations)
    combined_mae = (len(blips) / n * blip_mae) + (len(breaks) / n * break_mae)
    return {
        "threshold": threshold,
        "blip_n": len(blips),
        "blip_median": round(blip_pred, 1),
        "blip_mae": round(blip_mae, 1),
        "break_n": len(breaks),
        "break_median": round(break_pred, 1),
        "break_mae": round(break_mae, 1),
        "combined_mae": round(combined_mae, 1),
    }


def main():
    if not CSV_PATH.exists():
        print(f"closure_events.csv not found at {CSV_PATH}")
        print("Run scripts/closure_analysis.py first.")
        return

    df = pd.read_csv(CSV_PATH)
    df = df[df["duration_min"].notna() & (df["duration_min"] > 0)]

    rides = df.groupby(["ride_id", "ride_name"])
    results = []

    for (ride_id, ride_name), group in rides:
        durations = group["duration_min"]
        n = len(durations)
        if n < MIN_SAMPLES:
            continue

        median = durations.median()
        std = durations.std()
        overall_mae = mae(durations, median)

        # Find best split threshold
        best_split = None
        for t in THRESHOLDS:
            result = eval_split(durations, t)
            if result is None:
                continue
            if best_split is None or result["combined_mae"] < best_split["combined_mae"]:
                best_split = result

        improvement = None
        if best_split:
            improvement = round(overall_mae - best_split["combined_mae"], 1)

        results.append({
            "ride": ride_name,
            "n": n,
            "median_min": round(median, 1),
            "std_min": round(std, 1),
            "overall_mae": round(overall_mae, 1),
            "best_threshold": best_split["threshold"] if best_split else None,
            "blip_n": best_split["blip_n"] if best_split else None,
            "blip_median": best_split["blip_median"] if best_split else None,
            "blip_mae": best_split["blip_mae"] if best_split else None,
            "break_n": best_split["break_n"] if best_split else None,
            "break_median": best_split["break_median"] if best_split else None,
            "break_mae": best_split["break_mae"] if best_split else None,
            "split_mae": best_split["combined_mae"] if best_split else None,
            "mae_improvement": improvement,
        })

    if not results:
        print("No rides with enough data.")
        return

    results_df = pd.DataFrame(results).sort_values("overall_mae", ascending=False)

    print("\n── OVERALL PREDICTION ACCURACY ─────────────────────────────────────")
    print(f"{'Ride':<40} {'N':>5}  {'Median':>7}  {'Std':>6}  {'MAE':>6}")
    print("─" * 70)
    for _, r in results_df.iterrows():
        print(f"{r['ride']:<40} {r['n']:>5}  {r['median_min']:>6}m  {r['std_min']:>5}m  {r['overall_mae']:>5}m")

    print("\n── BLIP vs BREAK SPLIT ──────────────────────────────────────────────")
    print(f"{'Ride':<40} {'Split':>6}  {'Blip(n/med/mae)':>18}  {'Break(n/med/mae)':>19}  {'Δ MAE':>7}")
    print("─" * 95)
    for _, r in results_df.iterrows():
        if r["best_threshold"] is None:
            print(f"{r['ride']:<40}  (not enough data for split)")
            continue
        blip_str = f"{r['blip_n']}n / {r['blip_median']}m / {r['blip_mae']}m"
        break_str = f"{r['break_n']}n / {r['break_median']}m / {r['break_mae']}m"
        delta = f"+{r['mae_improvement']}m" if r["mae_improvement"] > 0 else f"{r['mae_improvement']}m"
        print(f"{r['ride']:<40} {r['best_threshold']:>5}m  {blip_str:>18}  {break_str:>19}  {delta:>7}")

    # Summary
    improvable = results_df[results_df["mae_improvement"].notna() & (results_df["mae_improvement"] > 1)]
    print(f"\n{len(improvable)} of {len(results_df)} rides improve MAE by >1 min when split into blip/break buckets.")

    if len(improvable) > 0:
        avg_improvement = improvable["mae_improvement"].mean()
        print(f"Average improvement on those rides: {avg_improvement:.1f} min")


if __name__ == "__main__":
    main()
