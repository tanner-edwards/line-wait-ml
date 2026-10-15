"""Render EvalResults as a dated markdown report under reports/eval/.

    from ml import report
    print(report.render(res))
    report.write(res, label='baseline')   # reports/eval/2026-10-15_baseline.md
"""

from __future__ import annotations

import math
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING

import pandas as pd

if TYPE_CHECKING:
    from .evaluate import EvalResults


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return "" if math.isnan(value) else f"{value:.2f}"
    return str(value)


def _pipe_table(df: pd.DataFrame) -> str:
    """Minimal markdown table writer used when `tabulate` is not installed."""
    headers = [str(df.index.name or "")] + [str(c) for c in df.columns]
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]
    for row in df.itertuples(name=None):  # itertuples keeps per-column types (iterrows upcasts ints)
        lines.append("| " + " | ".join(_cell(v) for v in row) + " |")
    return "\n".join(lines)


def _table(df: pd.DataFrame) -> str:
    try:
        return df.to_markdown(floatfmt=".2f")
    except ImportError:
        return _pipe_table(df)


def _contaminated_tag(flag) -> str:
    return "CONTAMINATED" if flag else ("clean" if flag is not None else "n/a")


def _header(res: "EvalResults") -> list[str]:
    m = res.meta
    start, end = m["frame_range"]
    days = m["test_days"]
    lines = [
        f"# Forward-holdout evaluation — {m['label'] or 'run'}",
        "",
        f"- Frame: {start} to {end} ({m['frame_rows']:,} rows)",
        f"- Cutoff: {m['cutoff']} (train = {m['train_days']} days on or before; test = {m['weeks']} weeks after)",
        f"- Test days ({len(days)}): {', '.join(str(d) for d in days)}",
        f"- Git: `{m['git_sha']}`",
        f"- Recipe A trajectory: `{m['recipe']['trajectory']}`",
        f"- Recipe A day-profile: `{m['recipe']['day_profile']}`",
        f"- Deployed models: {m['deployed_source']}, trained through "
        f"{m['deployed_trained_through'] or 'unknown'} -> **{_contaminated_tag(m['deployed_contaminated'])}**",
    ]
    if m["deployed_contaminated"]:
        lines.append("  - CONTAMINATED: the deployed models saw some test days; their numbers are shown "
                     "for reference and excluded from any verdict.")
    lines.append(f"- Unseen rides in test window: {', '.join(m['unseen_rides']) or 'none'}")
    for note in m["notes"]:
        lines.append(f"- Note: {note}")
    return lines


def _trend_section(res: "EvalResults") -> list[str]:
    lines = ["## Trend word (Recipe A)", "",
             "Serving thresholds: pred - wait >= +5 rising, <= -5 falling, else stable.", ""]
    for h, t in res.trend.items():
        lines += [
            f"### T+{h}", "",
            f"Accuracy {t['accuracy']:.3f} vs always-stable {t['always_stable_accuracy']:.3f}", "",
            "Rows = actual, columns = predicted.", "",
            _table(t["matrix"]), "",
            _table(t["per_class"]), "",
        ]
    return lines


def _paired_table(paired: dict) -> pd.DataFrame:
    table = pd.DataFrame.from_dict(paired, orient="index")
    table.index.name = "comparison (a vs b; mean < 0 = a better)"
    return table


def _paired_section(res: "EvalResults") -> list[str]:
    lines = ["## Paired daily tests", "",
             "Per-day MAE(a) - MAE(b) over test days. Sign test is two-sided on daily wins, ties excluded.", ""]
    for h, paired in res.paired.items():
        lines += [f"### T+{h}", "", _table(_paired_table(paired)), ""]
    return lines


def _breakdown_section(res: "EvalResults") -> list[str]:
    lines = ["## Breakdowns", ""]
    for title, tables in (("current-wait band", res.by_band), ("park", res.by_park),
                          ("hour of day", res.by_hour), ("ride", res.by_ride)):
        for h, table in tables.items():
            lines += [f"### By {title}, T+{h}", ""]
            if title == "ride":
                worse = table.index[table["worse_than_persistence"]].tolist()
                lines += [f"Rides where Recipe A loses to persistence: {', '.join(map(str, worse)) or 'none'}", ""]
            lines += [_table(table), ""]
    return lines


def _day_profile_section(res: "EvalResults") -> list[str]:
    dp = res.day_profile
    lines = [
        "## Day-profile", "",
        f"Scoring rows: {dp['n_rows']:,} (test days, wait present). `recipe_A_serving` replaces "
        "crowd_level_ratio / morning_crowd_index with each day's 13:00 value, as `_build_full_day` does — "
        "this is the production-equivalent number.",
        f"Deployed day-profile: **{_contaminated_tag(dp['deployed_contaminated'])}**", "",
        _table(dp["mae"]), "",
        "### Paired daily tests", "", _table(_paired_table(dp["paired"])), "",
    ]
    for title, key in (("park", "by_park"), ("hour of day", "by_hour"), ("ride", "by_ride")):
        lines += [f"### By {title} (lift vs lookup)", "", _table(dp[key]), ""]
    return lines


def render(res: "EvalResults") -> str:
    """Full markdown report."""
    lines = _header(res) + [
        "", "## Headline (MAE, minutes; lift in %)", "",
        "Every column is scored on the identical rows (training_valid_tN on test days).", "",
        _table(res.headline), "",
        "## Big-move MAE (|target - wait| >= 10)", "", _table(res.big_move), "",
    ]
    lines += _trend_section(res) + _paired_section(res) + _breakdown_section(res) + _day_profile_section(res)
    if res.staleness is not None:
        lines += ["## Staleness", "",
                  "Recipe A trained through the cutoff (fresh) vs four weeks earlier (stale), both scored on "
                  "the test window. lift_gain is in percentage points.", "",
                  _table(res.staleness), ""]
    if res.interleaved is not None:
        lines += ["## Interleaved split (comparison only — never gates a deploy)", "",
                  _table(res.interleaved), ""]
    lines += ["## Known issues in the data this run measured", ""]
    lines += [f"- {issue}" for issue in res.meta["known_issues"]]
    return "\n".join(lines) + "\n"


def write(res: "EvalResults", report_dir: str = "reports/eval", label: str = "") -> Path:
    """Write render(res) to <report_dir>/<today>_<label>.md, adding -2, -3 on collision."""
    folder = Path(report_dir)
    folder.mkdir(parents=True, exist_ok=True)
    stem = f"{date.today():%Y-%m-%d}_{label or 'run'}"
    path = folder / f"{stem}.md"
    n = 2
    while path.exists():
        path = folder / f"{stem}-{n}.md"
        n += 1
    path.write_text(render(res))
    return path
