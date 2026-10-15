"""Optional smoke run of the evaluation on a pickled feature frame.

    .venv/bin/python ml/smoke_run.py --frame path/to/df_features.pkl

Expects `df_features_meta.json` beside the pickle (RIDE_ID_CATEGORIES,
STATUS_CATEGORIES). Runs three horizons with staleness and the interleaved
comparison, prints the key tables, and writes a report to reports/eval/.
The notebook cell in ml/README.md is the normal way to run an evaluation.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ml import evaluate  # noqa: E402

DEFAULT_FRAME = (
    "/private/tmp/claude-503/-Users-tannere-Projects-line-wait-ml/"
    "4217dd4e-6102-458d-b435-dda4963aa29e/scratchpad/brief/df_features.pkl"
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--frame", default=DEFAULT_FRAME)
    parser.add_argument("--label", default="smoke")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    started = time.time()
    frame_path = Path(args.frame)
    df = pd.read_pickle(frame_path)
    meta = json.loads((frame_path.parent / "df_features_meta.json").read_text())
    logging.info("loaded %s rows in %.1fs", f"{len(df):,}", time.time() - started)

    res = evaluate.run(
        df, meta["RIDE_ID_CATEGORIES"], meta["STATUS_CATEGORIES"],
        weeks=4, horizons=[30, 60, 120], also_interleaved=True,
        deployed_trained_through=date(2026, 10, 4), run_staleness=True, label=args.label,
    )
    with pd.option_context("display.width", 200, "display.max_columns", 20):
        print("\nHEADLINE\n", res.headline.to_string(float_format="{:.2f}".format))
        print("\nTREND T+60 (Recipe A)\n", res.trend[60]["per_class"].to_string(float_format="{:.3f}".format))
        print(f"accuracy {res.trend[60]['accuracy']:.3f} vs always-stable {res.trend[60]['always_stable_accuracy']:.3f}")
        print("\nDAY PROFILE\n", res.day_profile["mae"].to_string(float_format="{:.2f}".format))
        print("\nSTALENESS\n", res.staleness.to_string(float_format="{:.2f}".format))
        print("\nINTERLEAVED\n", res.interleaved.to_string(float_format="{:.2f}".format))
    print(f"\nreport: {res.meta.get('report_path')}")
    print(f"wall time: {time.time() - started:.1f}s")


if __name__ == "__main__":
    main()
