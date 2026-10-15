"""Read-only smoke run of ml.clean.clean_frame on the raw collector cache.

    .venv/bin/python ml/smoke_clean.py --cache df_cache.pkl \
        --schedules park_schedules_cache.pkl --metadata ride_metadata.json

Loads the raw frame (not a feature frame), cleans it in memory, prints the
summary. Writes nothing.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ml.clean import clean_frame  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cache", default="df_cache.pkl")
    parser.add_argument("--schedules", default="park_schedules_cache.pkl")
    parser.add_argument("--metadata", default="ride_metadata.json")
    args = parser.parse_args()

    started = time.time()
    df = pd.read_pickle(args.cache)
    schedules_df = pd.read_pickle(args.schedules)
    ride_metadata = json.loads(Path(args.metadata).read_text())
    print(f"loaded {len(df):,} rows, {len(schedules_df):,} schedule docs in {time.time() - started:.1f}s")

    _, summary = clean_frame(df, schedules_df, ride_metadata)

    by_park: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for d, park, n in summary["dates_affected"]:
        by_park[park].append((d, n))
    print("\nrows dropped after public close, by park and date:")
    for park, items in sorted(by_park.items()):
        total = sum(n for _, n in items)
        print(f"  {park}: {total:,} rows on {len(items)} dates")
        print("    " + ", ".join(f"{d} ({n})" for d, n in items))

    party = defaultdict(list)
    for d, park in summary["party_dates"]:
        party[park].append(d)
    print("\nticketed-event-after-close dates in schedules:")
    for park, dates in sorted(party.items()):
        print(f"  {park}: {len(dates)} dates")
        print("    " + ", ".join(dates))
    print(f"\nwall time: {time.time() - started:.1f}s")


if __name__ == "__main__":
    main()
