"""One-call forward-holdout evaluation ("the scoreboard").

    import sys; sys.path.insert(0, '.')
    from ml import evaluate
    res = evaluate.run(df_sorted, RIDE_ID_CATEGORIES, STATUS_CATEGORIES,
                       weeks=4, also_interleaved=True,
                       deployed_trained_through=date(2026, 10, 4), label='baseline')
    res.headline

For each horizon N the scoring rows are training_valid_tN & test. Persistence,
lookup_delta, Recipe A, and the deployed model are all scored on exactly those
rows. The forward split gates deploys; the interleaved split is shown only for
comparison with the notebook's old numbers.
"""

from __future__ import annotations

import logging
import subprocess
import time
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from . import baselines, deployed, metrics, recipes
from .splits import forward_split, interleaved_split

log = logging.getLogger("ml.evaluate")

HORIZONS = [10, 20, 30, 40, 50, 60, 90, 120, 150, 180, 210, 240]
LA_TZ = "America/Los_Angeles"
SERVING_MINUTE = 13 * 60  # _build_full_day uses the crowd values current at serve time

KNOWN_ISSUES = [
    "Midnight close is encoded as 0 in minutes_until_close / total_operating_hours (data bug, Session 2).",
    "Ticketed-event rows (Oogie Boogie Bash, Grad Nite) are present after public close.",
    "crowd_level_ratio and morning_crowd_index baselines are keyed by month.",
    "OPERATING rows with a posted wait of 0 on walkthrough rides are included as-is.",
]


@dataclass
class EvalResults:
    meta: dict
    headline: pd.DataFrame
    big_move: pd.DataFrame
    trend: dict[int, dict]
    by_ride: dict[int, pd.DataFrame]
    by_hour: dict[int, pd.DataFrame]
    by_park: dict[int, pd.DataFrame]
    by_band: dict[int, pd.DataFrame]
    paired: dict[int, dict]
    day_profile: dict
    staleness: pd.DataFrame | None = None
    interleaved: pd.DataFrame | None = None
    preds: dict = field(default_factory=dict, repr=False)

    @property
    def trend_summary(self) -> pd.DataFrame:
        """Recall / precision per trend class, one block per horizon."""
        if not self.trend:
            return pd.DataFrame()
        return pd.concat({h: t["per_class"] for h, t in self.trend.items()}, names=["horizon", "class"])


def _lift(base: float, model: float) -> float:
    """Percent improvement of model over base MAE (positive = better)."""
    return (base - model) / base * 100 if base else float("nan")


def _git_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=deployed.REPO_ROOT, capture_output=True, text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else "unknown"


def _require_same_rows(rows: pd.Series, preds: dict[str, pd.Series], horizon) -> int:
    """Every prediction must be present on every scoring row (R5)."""
    n = int(rows.sum())
    for name, p in preds.items():
        missing = int(p[rows].isna().sum())
        if missing:
            raise ValueError(f"{name} has {missing} NaN predictions on the T+{horizon} scoring rows")
    return n


def _deployed_note(meta: dict, what: str, where: str) -> None:
    meta["notes"].append(f"Deployed {what} not found in {where}; skipped.")


def score_deployed(
    df: pd.DataFrame, rows: pd.Series, horizon_or_name: int | str,
    ride_cats: list, status_cats: list, model_dir: str = "models", git_ref: str | None = None,
) -> pd.Series | None:
    """Deployed model predictions on `rows` (aligned to df.index), or None if the file is missing."""
    booster = deployed.load_booster(horizon_or_name, model_dir, git_ref)
    if booster is None:
        return None
    out = pd.Series(float("nan"), index=df.index)
    out[rows] = deployed.predict_with_booster(booster, df, rows, ride_cats, status_cats)
    return out


def _trajectory_block(
    df: pd.DataFrame, train: pd.Series, test: pd.Series, horizon: int,
    ride_cats: list, status_cats: list, deployed_cats: tuple[list, list] | None,
    model_dir: str, git_ref: str | None,
) -> tuple[pd.Series, dict[str, pd.Series], pd.Series]:
    """(scoring rows, {name: preds aligned to df.index}, y) for one horizon."""
    rows = (df[f"training_valid_t{horizon}"] & test).astype(bool)
    y = df[f"target_t{horizon}"]
    model = recipes.train_trajectory(df, train, horizon, ride_cats, status_cats)
    preds = {
        "persistence": baselines.persistence(df, horizon),
        "lookup_delta": baselines.lookup_delta(df, train, horizon),
        "recipe_A": recipes.predict_trajectory(model, df[rows], horizon).reindex(df.index),
    }
    if deployed_cats is not None:
        dep = score_deployed(df, rows, horizon, *deployed_cats, model_dir=model_dir, git_ref=git_ref)
        if dep is not None:
            preds["deployed"] = dep
    return rows, preds, y


def _serving_style(scored: pd.DataFrame, day_rows: pd.DataFrame) -> pd.DataFrame:
    """Copy of `scored` with crowd_level_ratio / morning_crowd_index replaced, per
    date_la, by the value on the poll (any row of `day_rows`) closest to 13:00
    local — the single value _build_full_day feeds to every slot of the day."""
    local = day_rows["timestamp_utc"].dt.tz_convert(LA_TZ)
    distance = (local.dt.hour * 60 + local.dt.minute - SERVING_MINUTE).abs()
    pick = distance.groupby(day_rows["date_la"]).idxmin()
    at_13 = day_rows.loc[pick.to_numpy(), ["date_la", "crowd_level_ratio", "morning_crowd_index"]].set_index("date_la")
    out = scored.copy()
    for col in ("crowd_level_ratio", "morning_crowd_index"):
        out[col] = scored["date_la"].map(at_13[col]).astype(float)
    return out


def _day_profile_block(
    df: pd.DataFrame, train: pd.Series, test: pd.Series, ride_cats: list,
    deployed_cats: tuple[list, list] | None, model_dir: str, git_ref: str | None,
    is_contaminated: bool,
) -> dict:
    rows = (test & df["wait_minutes"].notna()).astype(bool)
    y = df["wait_minutes"]
    model = recipes.train_day_profile(df, train, ride_cats)
    scored = df.loc[rows]
    serving = _serving_style(scored, df.loc[test, ["timestamp_utc", "date_la", "crowd_level_ratio", "morning_crowd_index"]])
    preds = {
        "lookup": baselines.lookup_level(df, train),
        "ride_mean": baselines.ride_mean(df, train),
        "recipe_A": recipes.predict_day_profile(model, scored).reindex(df.index),
        "recipe_A_serving": recipes.predict_day_profile(model, serving).reindex(df.index),
    }
    if deployed_cats is not None:
        booster = deployed.load_booster("day_profile", model_dir, git_ref)
        if booster is not None:
            all_rows = pd.Series(True, index=scored.index)
            preds["deployed"] = deployed.predict_with_booster(booster, scored, all_rows, *deployed_cats).reindex(df.index)
            preds["deployed_serving"] = deployed.predict_with_booster(booster, serving, all_rows, *deployed_cats).reindex(df.index)
    n = _require_same_rows(rows, preds, "day_profile")
    mae = pd.Series({name: metrics.mae(y[rows], p[rows]) for name, p in preds.items()}, name="mae")
    lift_vs_lookup = mae.map(lambda m: _lift(mae["lookup"], m)).rename("lift_vs_lookup")
    table = pd.concat([mae, lift_vs_lookup], axis=1)
    table.index.name = "model"
    by = {
        col: metrics.breakdown(df, rows, y, preds, col, baseline="lookup", primary="recipe_A_serving")
        for col in ("ride_name", "hour_of_day", "park_name")
    }
    paired = {
        "recipe_A_serving_vs_lookup": metrics.paired_daily(df, rows, y, preds["recipe_A_serving"], preds["lookup"]),
        "recipe_A_serving_vs_ride_mean": metrics.paired_daily(df, rows, y, preds["recipe_A_serving"], preds["ride_mean"]),
    }
    if "deployed_serving" in preds:
        paired["recipe_A_serving_vs_deployed_serving"] = metrics.paired_daily(
            df, rows, y, preds["recipe_A_serving"], preds["deployed_serving"])
    return {
        "n_rows": n,
        "mae": table,
        "deployed_contaminated": is_contaminated if "deployed" in preds else None,
        "by_ride": by["ride_name"],
        "by_hour": by["hour_of_day"],
        "by_park": by["park_name"],
        "paired": paired,
        "preds": {k: v[rows] for k, v in preds.items()},
    }


def _headline_row(rows, preds, y, horizon, is_contaminated) -> dict:
    n = _require_same_rows(rows, preds, horizon)
    m = {name: metrics.mae(y[rows], p[rows]) for name, p in preds.items()}
    row = {
        "n_rows": n,
        "persistence": m["persistence"],
        "lookup_delta": m["lookup_delta"],
        "recipe_A": m["recipe_A"],
        "deployed": m.get("deployed", float("nan")),
        "lift_recipe_vs_persistence": _lift(m["persistence"], m["recipe_A"]),
        "lift_recipe_vs_lookup": _lift(m["lookup_delta"], m["recipe_A"]),
        "lift_deployed_vs_persistence": _lift(m["persistence"], m["deployed"]) if "deployed" in m else float("nan"),
        "deployed_contaminated": is_contaminated if "deployed" in m else None,
    }
    return row


def staleness(
    df: pd.DataFrame, ride_cats: list, status_cats: list, weeks: int = 4,
    stale_by_weeks: int = 4, horizons=(30, 60, 120),
) -> pd.DataFrame:
    """Recipe A trained through cutoff vs through cutoff - stale_by_weeks, both scored
    on the window after cutoff. lift_gain = fresh_lift - stale_lift (percentage points)."""
    cutoff = df["date_la"].max() - timedelta(weeks=weeks)
    old_cutoff = cutoff - timedelta(weeks=stale_by_weeks)
    fresh_train, test = forward_split(df, weeks=weeks, cutoff=cutoff)
    stale_train = (df["date_la"] <= old_cutoff).astype(bool)
    out = []
    for h in horizons:
        t0 = time.time()
        rows = (df[f"training_valid_t{h}"] & test).astype(bool)
        y = df.loc[rows, f"target_t{h}"]
        base = metrics.mae(y, df.loc[rows, "wait_minutes"])
        fresh = recipes.predict_trajectory(recipes.train_trajectory(df, fresh_train, h, ride_cats, status_cats), df[rows], h)
        stale = recipes.predict_trajectory(recipes.train_trajectory(df, stale_train, h, ride_cats, status_cats), df[rows], h)
        out.append({"horizon": f"T+{h}", "baseline": "persistence", "baseline_mae": base,
                    "stale_mae": metrics.mae(y, stale), "fresh_mae": metrics.mae(y, fresh)})
        log.info("staleness T+%d done in %.1fs", h, time.time() - t0)
    t0 = time.time()
    rows = (test & df["wait_minutes"].notna()).astype(bool)
    y = df.loc[rows, "wait_minutes"]
    base = metrics.mae(y, baselines.lookup_level(df, fresh_train)[rows])
    fresh = recipes.predict_day_profile(recipes.train_day_profile(df, fresh_train, ride_cats), df[rows])
    stale = recipes.predict_day_profile(recipes.train_day_profile(df, stale_train, ride_cats), df[rows])
    out.append({"horizon": "day_profile", "baseline": "lookup", "baseline_mae": base,
                "stale_mae": metrics.mae(y, stale), "fresh_mae": metrics.mae(y, fresh)})
    log.info("staleness day_profile done in %.1fs", time.time() - t0)
    table = pd.DataFrame(out).set_index("horizon")
    table["stale_lift"] = [_lift(b, s) for b, s in zip(table["baseline_mae"], table["stale_mae"])]
    table["fresh_lift"] = [_lift(b, f) for b, f in zip(table["baseline_mae"], table["fresh_mae"])]
    table["lift_gain"] = table["fresh_lift"] - table["stale_lift"]
    return table


def _interleaved(df, ride_cats, status_cats, horizons, forward_headline) -> pd.DataFrame:
    """Headline columns on the every-5th-day split, no deployed model."""
    train, test = interleaved_split(df)
    out = {}
    for h in horizons:
        t0 = time.time()
        rows, preds, y = _trajectory_block(df, train, test, h, ride_cats, status_cats, None, "", None)
        row = _headline_row(rows, preds, y, h, None)
        out[h] = {k: row[k] for k in ("n_rows", "persistence", "lookup_delta", "recipe_A",
                                       "lift_recipe_vs_persistence", "lift_recipe_vs_lookup")}
        log.info("interleaved T+%d done in %.1fs", h, time.time() - t0)
    table = pd.DataFrame.from_dict(out, orient="index")
    table.index.name = "horizon"
    table["forward_lift_recipe_vs_persistence"] = forward_headline["lift_recipe_vs_persistence"]
    return table


def run(
    df: pd.DataFrame, ride_cats: list, status_cats: list, weeks: int = 4, cutoff: date | None = None,
    horizons=HORIZONS, also_interleaved: bool = False, deployed_trained_through: date | None = None,
    deployed_git_ref: str | None = None, staleness_horizons=(30, 60, 120), run_staleness: bool = True,
    label: str = "", write_report: bool = True, report_dir: str = "reports/eval",
    model_dir: str = "models",
) -> EvalResults:
    """Forward-holdout evaluation of Recipe A, both baselines, and the deployed models."""
    started = time.time()
    horizons = list(horizons)
    train, test = forward_split(df, weeks=weeks, cutoff=cutoff)
    test_days = sorted(set(df.loc[test, "date_la"]))
    if not test_days:
        raise ValueError("Forward split produced no test days")
    is_contaminated = deployed.contaminated(deployed_trained_through, test_days)

    meta = {
        "label": label,
        "frame_range": (df["date_la"].min(), df["date_la"].max()),
        "frame_rows": len(df),
        "cutoff": df["date_la"].max() - timedelta(weeks=weeks) if cutoff is None else cutoff,
        "weeks": weeks,
        "test_days": test_days,
        "train_days": int(df.loc[train, "date_la"].nunique()),
        "git_sha": _git_sha(),
        "recipe": recipes.RECIPE_A,
        "deployed_source": f"git {deployed_git_ref}" if deployed_git_ref else f"working tree {model_dir}/",
        "deployed_trained_through": deployed_trained_through,
        "deployed_contaminated": is_contaminated,
        "notes": [],
        "known_issues": list(KNOWN_ISSUES),
    }
    seen = set(ride_cats)
    unseen = df.loc[test & ~df["ride_id"].isin(seen), ["ride_id", "ride_name"]].drop_duplicates()
    meta["unseen_rides"] = [f"{r.ride_name} ({r.ride_id})" for r in unseen.itertuples()]

    deployed_cats = deployed.load_categories(model_dir, deployed_git_ref)
    if deployed_cats is None:
        meta["notes"].append("Deployed feature_categories.json not found; using the caller's categories.")
        deployed_cats = (ride_cats, status_cats)

    headline, big_move, trend, paired, all_preds = {}, {}, {}, {}, {}
    by_ride, by_hour, by_park, by_band = {}, {}, {}, {}
    for h in horizons:
        t0 = time.time()
        rows, preds, y = _trajectory_block(
            df, train, test, h, ride_cats, status_cats, deployed_cats, model_dir, deployed_git_ref)
        if "deployed" not in preds:
            _deployed_note(meta, f"trajectory_t{h}", meta["deployed_source"])
        headline[h] = _headline_row(rows, preds, y, h, is_contaminated)
        big_move[h] = {"n_rows": int((rows & ((y - df["wait_minutes"]).abs() >= 10)).sum())}
        big_move[h].update({name: metrics.big_move_mae(df, y[rows], p[rows], h) for name, p in preds.items()})
        trend[h] = metrics.trend_confusion(df, y[rows], preds["recipe_A"][rows], h)
        by_ride[h] = metrics.breakdown(df, rows, y, preds, "ride_name")
        by_hour[h] = metrics.breakdown(df, rows, y, preds, "hour_of_day")
        by_park[h] = metrics.breakdown(df, rows, y, preds, "park_name")
        by_band[h] = metrics.breakdown(df, rows, y, preds, "wait_band")
        paired[h] = {
            f"recipe_A_vs_{other}": metrics.paired_daily(df, rows, y, preds["recipe_A"], preds[other])
            for other in ("persistence", "lookup_delta", "deployed") if other in preds
        }
        all_preds[h] = {name: p[rows] for name, p in preds.items()}
        log.info("T+%d: %d rows, done in %.1fs", h, headline[h]["n_rows"], time.time() - t0)

    t0 = time.time()
    day_profile = _day_profile_block(
        df, train, test, ride_cats, deployed_cats, model_dir, deployed_git_ref, is_contaminated)
    if day_profile["deployed_contaminated"] is None:
        _deployed_note(meta, "day_profile", meta["deployed_source"])
    log.info("day_profile done in %.1fs", time.time() - t0)

    headline_df = pd.DataFrame.from_dict(headline, orient="index")
    headline_df.index.name = "horizon"
    big_move_df = pd.DataFrame.from_dict(big_move, orient="index")
    big_move_df.index.name = "horizon"

    stale = None
    if run_staleness:
        stale = staleness(df, ride_cats, status_cats, weeks=weeks, horizons=staleness_horizons)
    inter = None
    if also_interleaved:
        inter = _interleaved(df, ride_cats, status_cats, horizons, headline_df)

    meta["elapsed_seconds"] = round(time.time() - started, 1)
    results = EvalResults(
        meta=meta, headline=headline_df, big_move=big_move_df, trend=trend,
        by_ride=by_ride, by_hour=by_hour, by_park=by_park, by_band=by_band, paired=paired,
        day_profile=day_profile, staleness=stale, interleaved=inter, preds=all_preds,
    )
    if write_report:
        from . import report

        path = report.write(results, report_dir=report_dir, label=label)
        meta["report_path"] = str(path)
        log.info("report written to %s", path)
    log.info("evaluation finished in %.1fs", time.time() - started)
    return results
