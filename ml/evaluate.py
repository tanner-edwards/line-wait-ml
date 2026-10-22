"""One-call forward-holdout evaluation ("the scoreboard").

    import sys; sys.path.insert(0, '.')
    from ml import evaluate
    res = evaluate.run(df_sorted, RIDE_ID_CATEGORIES, STATUS_CATEGORIES,
                       weeks=4, also_interleaved=True,
                       deployed_trained_through=date(2026, 10, 4), label='baseline')
    res.headline

For each horizon N the scoring rows are training_valid_tN & test. Persistence,
lookup_delta, the recipe (A by default), the `compare` recipe when given, and
the deployed model are all scored on exactly those rows.

    res = evaluate.run(df_sorted, ..., recipe=RECIPE_A, compare=RECIPE_B, label='recipeB')
    res.recipe_comparison     # per horizon + day_profile: paired test and verdict

A recipe with classifiers (RECIPE_B since Session 5) also trains p_fall_30,
p_fall_60, p_rise_30, p_rise_60 on the train half and scores them on the same
test rows (res.classifiers), and derives the probability-based trend word on
the T+30 rows with recipes.derive_trend (res.trend_clf[30]) next to the
regression-derived one (res.trend[30]).

The forward split gates deploys; the interleaved split is shown only for
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
from .manifest import read_manifest
from .recipes import RECIPE_A, Recipe
from .splits import forward_split, interleaved_split

log = logging.getLogger("ml.evaluate")

HORIZONS = [10, 20, 30, 40, 50, 60, 90, 120, 150, 180, 210, 240]
LA_TZ = "America/Los_Angeles"
SERVING_MINUTE = 13 * 60  # _build_full_day uses the crowd values current at serve time

KNOWN_ISSUES = [
    "Midnight close is encoded as 0 in minutes_until_close / total_operating_hours (data bug, Session 2).",
    "Ticketed-event rows (Oogie Boogie Bash, Grad Nite) are present after public close.",
    "crowd_level_ratio baselines are keyed (day_type, hour) resort-wide since Session 3; per-park keying measured as noise overall but helps DCA 18:00-21:00 (reports/eval/2026-10-16_session3-variants.md).",
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
    recipe_comparison: pd.DataFrame | None = None
    preds: dict = field(default_factory=dict, repr=False)
    classifiers: dict = field(default_factory=dict)
    trend_clf: dict = field(default_factory=dict)

    @property
    def trend_summary(self) -> pd.DataFrame:
        """Recall / precision per trend class, one block per (source, horizon);
        source 'regression' (pred - wait thresholds) or 'classifier' (derive_trend)."""
        blocks = {("regression", h): t["per_class"] for h, t in self.trend.items()}
        blocks.update({("classifier", h): t["per_class"] for h, t in self.trend_clf.items() if isinstance(h, int)})
        if not blocks:
            return pd.DataFrame()
        return pd.concat(blocks, names=["source", "horizon", "class"])


def _lift(base: float, model: float) -> float:
    """Percent improvement of model over base MAE (positive = better)."""
    return (base - model) / base * 100 if base else float("nan")


def _col(recipe: Recipe) -> str:
    """Prediction column name for a recipe: recipe_A, recipe_B, recipe_B2, ..."""
    return f"recipe_{recipe.name}"


def _same_trajectory(a: Recipe, b: Recipe) -> bool:
    return (a.trajectory_params, a.trajectory_target, a.trajectory_features) == \
        (b.trajectory_params, b.trajectory_target, b.trajectory_features)


def _same_day_profile(a: Recipe, b: Recipe) -> bool:
    return (a.day_profile_params, a.day_profile_features) == (b.day_profile_params, b.day_profile_features)


def verdict(paired: dict) -> str:
    """'B wins' / 'A wins' / 'noise' for a paired_daily(B, A) result.

    A side wins when the mean daily difference favors it and either clears the
    95% half-width or the sign test has p < 0.05.
    """
    mean, hw, p = paired["mean"], paired["half_width_95"], paired["sign_test_p"]
    significant = abs(mean) > hw or p < 0.05  # NaN compares False
    if mean < 0 and significant:
        return "B wins"
    if mean > 0 and significant:
        return "A wins"
    return "noise"


def _comparison_row(name, a_mae: float, b_mae: float, paired: dict) -> dict:
    """paired is paired_daily(B, A): wins_a there are B's winning days."""
    return {
        "horizon": name, "A_mae": a_mae, "B_mae": b_mae,
        "paired_mean": paired["mean"], "half_width_95": paired["half_width_95"],
        "wins_B": paired["wins_a"], "wins_A": paired["wins_b"],
        "sign_test_p": paired["sign_test_p"], "verdict": verdict(paired),
    }


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
    model_dir: str, git_ref: str | None, recipe: Recipe = RECIPE_A, compare: Recipe | None = None,
) -> tuple[pd.Series, dict[str, pd.Series], pd.Series]:
    """(scoring rows, {name: preds aligned to df.index}, y) for one horizon."""
    rows = (df[f"training_valid_t{horizon}"] & test).astype(bool)
    y = df[f"target_t{horizon}"]
    preds = {
        "persistence": baselines.persistence(df, horizon),
        "lookup_delta": baselines.lookup_delta(df, train, horizon),
    }
    for r in (recipe, compare) if compare is not None else (recipe,):
        if r is compare and _same_trajectory(recipe, compare):
            # Identical fit (LightGBM is deterministic here); skip the retrain.
            preds[_col(r)] = preds[_col(recipe)].copy()
            continue
        model = recipes.train_trajectory(df, train, horizon, ride_cats, status_cats, recipe=r)
        preds[_col(r)] = recipes.predict_trajectory(model, df[rows], horizon).reindex(df.index)
        del model
    if deployed_cats is not None:
        dep = score_deployed(df, rows, horizon, *deployed_cats, model_dir=model_dir, git_ref=git_ref)
        if dep is not None:
            preds["deployed"] = dep
    return rows, preds, y


def _classifier_block(
    df: pd.DataFrame, train: pd.Series, test: pd.Series, ride_cats: list, status_cats: list,
    recipe: Recipe, prefix: str = "",
) -> tuple[dict, dict]:
    """({prefix + name: classifier_scores + horizon/direction/label}, {name: probs on its rows})."""
    scores, probs = {}, {}
    thresholds = recipe.trend_thresholds or {}
    for name in recipe.classifier_names:
        t0 = time.time()
        _, direction, h = name.split("_")
        h = int(h)
        rows = (df[f"training_valid_t{h}"] & test).astype(bool)
        spec = recipe.classifier_labels[direction]
        model = recipes.train_classifier(df, train, h, direction, ride_cats, status_cats, recipe)
        p = recipes.predict_classifier(model, df[rows], h)
        del model
        y = recipes.classifier_label(df, h, direction, spec)[rows]
        band = df.loc[rows, "wait_minutes"].map(recipes.band_of)
        taus = ({b: (t.get("call") or {}).get(direction) for b, t in thresholds.items()}
                if h == 30 and thresholds else None)
        sc = metrics.classifier_scores(y, p, band, taus)
        sc["bands"] = sc["bands"].reindex([b for b in recipes.BANDS if b in sc["bands"].index])
        sc.update({"horizon": h, "direction": direction, "label": tuple(spec), "recipe": recipe.name})
        scores[prefix + name] = sc
        probs[name] = p
        log.info("%s%s: AUC %.3f, done in %.1fs", prefix, name, sc["auc"], time.time() - t0)
    return scores, probs


def _trend_from_classifiers(df: pd.DataFrame, test: pd.Series, probs: dict, thresholds: dict,
                            reg_pred: pd.Series, recipe: Recipe) -> dict:
    """The probability-derived word on the T+30 test rows next to the regression's.

    trend_confusion_from_words + confidence shares, the share of rows where each
    word is called, and the arrow (word not stable and confidence not low)."""
    rows = (df["training_valid_t30"] & test).astype(bool)
    sub = df.loc[rows, ["wait_minutes", "wait_lag_1", "target_t30"]]
    pr, pf = probs["p_rise_30"].reindex(sub.index), probs["p_fall_30"].reindex(sub.index)
    derived = [recipes.derive_trend(c, lag, r, f, thresholds)
               for c, lag, r, f in zip(sub["wait_minutes"], sub["wait_lag_1"], pr, pf)]
    word = pd.Series([d[0] if d else "stable" for d in derived], index=sub.index)
    conf = pd.Series([d[1] if d else "low" for d in derived], index=sub.index)
    actual = metrics.trend_class(sub["target_t30"] - sub["wait_minutes"])
    out = metrics.trend_confusion_from_words(actual, word)
    direction = word.replace({"trough": "rising", "peak": "falling"})
    called = direction != "stable"
    shown = called & (conf != "low")
    reg_word = metrics.trend_class(reg_pred.reindex(sub.index) - sub["wait_minutes"])
    reg_called = reg_word != "stable"
    out.update({
        "recipe": recipe.name,
        "n": int(len(sub)),
        "confidence_share": {c: float((conf == c).mean()) for c in ("high", "medium", "low")},
        "called_share": float(called.mean()),
        "called_precision": float((direction == actual)[called].mean()) if called.any() else float("nan"),
        "arrow_shown": float(shown.mean()),
        "arrow_precision": float((direction == actual)[shown].mean()) if shown.any() else float("nan"),
        "regression_called_share": float(reg_called.mean()),
        "regression_called_precision": float((reg_word == actual)[reg_called].mean()) if reg_called.any() else float("nan"),
    })
    return out


def _deployed_classifiers(df, test, ride_cats, status_cats, model_dir, git_ref) -> dict:
    """Scores of the deployed classifier files the deployed manifest lists, with
    their own labels; {} when the deployed models have none."""
    manifest = read_manifest(Path(model_dir) / "manifest.json") if git_ref is None else None
    out = {}
    for name, spec in ((manifest or {}).get("classifiers") or {}).items():
        booster = deployed.load_booster(Path(spec["file"]).stem, model_dir, git_ref)
        if booster is None:
            continue
        h, direction = int(spec["horizon"]), spec["direction"]
        rows = (df[f"training_valid_t{h}"] & test).astype(bool)
        p = deployed.predict_with_booster(booster, df, rows, ride_cats, status_cats)
        y = recipes.classifier_label(df, h, direction, tuple(spec["label"]))[rows]
        sc = metrics.classifier_scores(y, p, df.loc[rows, "wait_minutes"].map(recipes.band_of))
        sc["bands"] = sc["bands"].reindex([b for b in recipes.BANDS if b in sc["bands"].index])
        sc.update({"horizon": h, "direction": direction, "label": tuple(spec["label"]), "recipe": "deployed"})
        out[f"deployed:{name}"] = sc
    return out


def _serving_style(scored: pd.DataFrame, day_rows: pd.DataFrame) -> pd.DataFrame:
    """Copy of `scored` with crowd_level_ratio / morning_crowd_index replaced, per
    date_la (and per park_id when both frames have it), by the value on the poll
    (any row of `day_rows`) closest to 13:00 local — the single value
    _build_full_day feeds to every slot of the day for that ride's park."""
    cols = [c for c in ("crowd_level_ratio", "morning_crowd_index") if c in day_rows.columns]
    keys = ["date_la"] + (["park_id"] if "park_id" in day_rows.columns and "park_id" in scored.columns else [])
    local = day_rows["timestamp_utc"].dt.tz_convert(LA_TZ)
    distance = (local.dt.hour * 60 + local.dt.minute - SERVING_MINUTE).abs()
    pick = distance.groupby([day_rows[k] for k in keys]).idxmin()
    at_13 = day_rows.loc[pick.to_numpy(), keys + cols]
    merged = scored[keys].merge(at_13, on=keys, how="left")
    out = scored.copy()
    for col in cols:
        out[col] = merged[col].to_numpy().astype(float)
    return out


def _day_profile_block(
    df: pd.DataFrame, train: pd.Series, test: pd.Series, ride_cats: list,
    deployed_cats: tuple[list, list] | None, model_dir: str, git_ref: str | None,
    is_contaminated: bool, recipe: Recipe = RECIPE_A, compare: Recipe | None = None,
) -> dict:
    rows = (test & df["wait_minutes"].notna()).astype(bool)
    y = df["wait_minutes"]
    scored = df.loc[rows]
    day_cols = ["timestamp_utc", "date_la"] + (["park_id"] if "park_id" in df.columns else [])
    crowd_cols = [c for c in ("crowd_level_ratio", "morning_crowd_index") if c in df.columns]
    serving = _serving_style(scored, df.loc[test, day_cols + crowd_cols])
    preds = {
        "lookup": baselines.lookup_level(df, train),
        "ride_mean": baselines.ride_mean(df, train),
    }
    for r in (recipe, compare) if compare is not None else (recipe,):
        if r is compare and _same_day_profile(recipe, compare):
            preds[_col(r)] = preds[_col(recipe)].copy()
            preds[f"{_col(r)}_serving"] = preds[f"{_col(recipe)}_serving"].copy()
            continue
        model = recipes.train_day_profile(df, train, ride_cats, recipe=r)
        preds[_col(r)] = recipes.predict_day_profile(model, scored).reindex(df.index)
        preds[f"{_col(r)}_serving"] = recipes.predict_day_profile(model, serving).reindex(df.index)
        del model
    primary = f"{_col(recipe)}_serving"
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
        col: metrics.breakdown(df, rows, y, preds, col, baseline="lookup", primary=primary)
        for col in ("ride_name", "hour_of_day", "park_name")
    }
    paired = {
        f"{primary}_vs_{other}": metrics.paired_daily(df, rows, y, preds[primary], preds[other])
        for other in ("lookup", "ride_mean", "deployed_serving") if other in preds
    }
    comparison = None
    if compare is not None:
        b = f"{_col(compare)}_serving"
        pair = metrics.paired_daily(df, rows, y, preds[b], preds[primary])
        paired[f"{b}_vs_{primary}"] = pair
        comparison = _comparison_row("day_profile", mae[primary], mae[b], pair)
    return {
        "n_rows": n,
        "mae": table,
        "deployed_contaminated": is_contaminated if "deployed" in preds else None,
        "by_ride": by["ride_name"],
        "by_hour": by["hour_of_day"],
        "by_park": by["park_name"],
        "paired": paired,
        "comparison": comparison,
        "preds": {k: v[rows] for k, v in preds.items()},
    }


def _headline_row(rows, preds, y, horizon, is_contaminated, recipe: Recipe = RECIPE_A,
                  compare: Recipe | None = None) -> dict:
    n = _require_same_rows(rows, preds, horizon)
    m = {name: metrics.mae(y[rows], p[rows]) for name, p in preds.items()}
    a = _col(recipe)
    row = {
        "n_rows": n,
        "persistence": m["persistence"],
        "lookup_delta": m["lookup_delta"],
        a: m[a],
    }
    if compare is not None:
        b = _col(compare)
        row[b] = m[b]
        row[f"lift_{compare.name}_vs_{recipe.name}"] = _lift(m[a], m[b])
    row.update({
        "deployed": m.get("deployed", float("nan")),
        "lift_recipe_vs_persistence": _lift(m["persistence"], m[a]),
        "lift_recipe_vs_lookup": _lift(m["lookup_delta"], m[a]),
        "lift_deployed_vs_persistence": _lift(m["persistence"], m["deployed"]) if "deployed" in m else float("nan"),
        "deployed_contaminated": is_contaminated if "deployed" in m else None,
    })
    return row


def staleness(
    df: pd.DataFrame, ride_cats: list, status_cats: list, weeks: int = 4,
    stale_by_weeks: int = 4, horizons=(30, 60, 120), recipe: Recipe = RECIPE_A,
) -> pd.DataFrame:
    """`recipe` trained through cutoff vs through cutoff - stale_by_weeks, both scored
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
        fresh = recipes.predict_trajectory(
            recipes.train_trajectory(df, fresh_train, h, ride_cats, status_cats, recipe=recipe), df[rows], h)
        stale = recipes.predict_trajectory(
            recipes.train_trajectory(df, stale_train, h, ride_cats, status_cats, recipe=recipe), df[rows], h)
        out.append({"horizon": f"T+{h}", "baseline": "persistence", "baseline_mae": base,
                    "stale_mae": metrics.mae(y, stale), "fresh_mae": metrics.mae(y, fresh)})
        log.info("staleness T+%d done in %.1fs", h, time.time() - t0)
    t0 = time.time()
    rows = (test & df["wait_minutes"].notna()).astype(bool)
    y = df.loc[rows, "wait_minutes"]
    base = metrics.mae(y, baselines.lookup_level(df, fresh_train)[rows])
    fresh = recipes.predict_day_profile(recipes.train_day_profile(df, fresh_train, ride_cats, recipe=recipe), df[rows])
    stale = recipes.predict_day_profile(recipes.train_day_profile(df, stale_train, ride_cats, recipe=recipe), df[rows])
    out.append({"horizon": "day_profile", "baseline": "lookup", "baseline_mae": base,
                "stale_mae": metrics.mae(y, stale), "fresh_mae": metrics.mae(y, fresh)})
    log.info("staleness day_profile done in %.1fs", time.time() - t0)
    table = pd.DataFrame(out).set_index("horizon")
    table["stale_lift"] = [_lift(b, s) for b, s in zip(table["baseline_mae"], table["stale_mae"])]
    table["fresh_lift"] = [_lift(b, f) for b, f in zip(table["baseline_mae"], table["fresh_mae"])]
    table["lift_gain"] = table["fresh_lift"] - table["stale_lift"]
    return table


def _interleaved(df, ride_cats, status_cats, horizons, forward_headline, recipe: Recipe = RECIPE_A) -> pd.DataFrame:
    """Headline columns on the every-5th-day split, no deployed model, primary recipe only."""
    train, test = interleaved_split(df)
    out = {}
    for h in horizons:
        t0 = time.time()
        rows, preds, y = _trajectory_block(df, train, test, h, ride_cats, status_cats, None, "", None, recipe=recipe)
        row = _headline_row(rows, preds, y, h, None, recipe=recipe)
        out[h] = {k: row[k] for k in ("n_rows", "persistence", "lookup_delta", _col(recipe),
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
    model_dir: str = "models", day_profile_feature_cols: list[str] | None = None,
    recipe: Recipe = RECIPE_A, compare: Recipe | None = None,
) -> EvalResults:
    """Forward-holdout evaluation of `recipe`, both baselines, and the deployed models.

    compare: a second Recipe scored on the identical rows; adds recipe_<name>
    and lift_<B>_vs_<A> columns, recipe_<B>_vs_recipe_<A> paired tests, and
    EvalResults.recipe_comparison (one row per horizon plus day_profile).
    day_profile_feature_cols overrides the primary recipe's day-profile feature
    list (an experiment knob; the deployed model is scored with its own features)."""
    started = time.time()
    horizons = list(horizons)
    if day_profile_feature_cols is not None:
        recipe = recipes.with_(recipe, day_profile_features=tuple(day_profile_feature_cols))
    if compare is not None and compare.name == recipe.name:
        raise ValueError(f"compare recipe needs a different name than the primary ({recipe.name!r})")
    train, test = forward_split(df, weeks=weeks, cutoff=cutoff)
    test_days = sorted(set(df.loc[test, "date_la"]))
    if not test_days:
        raise ValueError("Forward split produced no test days")
    manifest = {}
    if deployed_trained_through is None and deployed_git_ref is None:
        manifest = read_manifest(Path(model_dir) / "manifest.json") or {}
        try:
            deployed_trained_through = date.fromisoformat(str(manifest["trained_through"]))
        except (KeyError, ValueError):
            pass  # unknown stays None -> contaminated
    elif deployed_trained_through is None:
        # The working-tree manifest describes models/, not the git ref's models.
        log.info("deployed_git_ref=%s given without deployed_trained_through; working-tree "
                 "manifest not used, deployed models treated as contaminated", deployed_git_ref)
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
        "recipe": recipe,
        "compare": compare,
        "deployed_recipe": manifest.get("recipe"),
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
    comparison: list[dict] = []
    by_ride, by_hour, by_park, by_band = {}, {}, {}, {}
    for h in horizons:
        t0 = time.time()
        rows, preds, y = _trajectory_block(
            df, train, test, h, ride_cats, status_cats, deployed_cats, model_dir, deployed_git_ref,
            recipe=recipe, compare=compare)
        if "deployed" not in preds:
            _deployed_note(meta, f"trajectory_t{h}", meta["deployed_source"])
        headline[h] = _headline_row(rows, preds, y, h, is_contaminated, recipe=recipe, compare=compare)
        big_move[h] = {"n_rows": int((rows & ((y - df["wait_minutes"]).abs() >= 10)).sum())}
        big_move[h].update({name: metrics.big_move_mae(df, y[rows], p[rows], h) for name, p in preds.items()})
        a = _col(recipe)
        trend[h] = metrics.trend_confusion(df, y[rows], preds[a][rows], h)
        by_ride[h] = metrics.breakdown(df, rows, y, preds, "ride_name", primary=a)
        by_hour[h] = metrics.breakdown(df, rows, y, preds, "hour_of_day", primary=a)
        by_park[h] = metrics.breakdown(df, rows, y, preds, "park_name", primary=a)
        by_band[h] = metrics.breakdown(df, rows, y, preds, "wait_band", primary=a)
        paired[h] = {
            f"{a}_vs_{other}": metrics.paired_daily(df, rows, y, preds[a], preds[other])
            for other in ("persistence", "lookup_delta", "deployed") if other in preds
        }
        if compare is not None:
            b = _col(compare)
            pair = metrics.paired_daily(df, rows, y, preds[b], preds[a])
            paired[h][f"{b}_vs_{a}"] = pair
            comparison.append(_comparison_row(h, headline[h][a], headline[h][b], pair))
        all_preds[h] = {name: p[rows] for name, p in preds.items()}
        log.info("T+%d: %d rows, done in %.1fs", h, headline[h]["n_rows"], time.time() - t0)

    t0 = time.time()
    day_profile = _day_profile_block(
        df, train, test, ride_cats, deployed_cats, model_dir, deployed_git_ref, is_contaminated,
        recipe=recipe, compare=compare)
    if day_profile["deployed_contaminated"] is None:
        _deployed_note(meta, "day_profile", meta["deployed_source"])
    log.info("day_profile done in %.1fs", time.time() - t0)

    headline_df = pd.DataFrame.from_dict(headline, orient="index")
    headline_df.index.name = "horizon"
    big_move_df = pd.DataFrame.from_dict(big_move, orient="index")
    big_move_df.index.name = "horizon"

    stale = None
    if run_staleness:
        stale = staleness(df, ride_cats, status_cats, weeks=weeks, horizons=staleness_horizons, recipe=recipe)
    inter = None
    if also_interleaved:
        inter = _interleaved(df, ride_cats, status_cats, horizons, headline_df, recipe=recipe)
    recipe_comparison = None
    if compare is not None:
        recipe_comparison = pd.DataFrame(comparison + [day_profile["comparison"]]).set_index("horizon")

    classifiers, trend_clf = {}, {}
    with_clf = [r for r in ((recipe, compare) if compare is not None else (recipe,)) if r.has_classifiers]
    for i, r in enumerate(with_clf):
        prefix = "" if i == 0 else f"{r.name}:"
        scores, probs = _classifier_block(df, train, test, ride_cats, status_cats, r, prefix)
        classifiers.update(scores)
        if r.trend_thresholds and {"p_rise_30", "p_fall_30"} <= set(probs) and 30 in all_preds:
            key = 30 if i == 0 else f"{r.name}:30"
            trend_clf[key] = _trend_from_classifiers(df, test, probs, r.trend_thresholds,
                                                     all_preds[30][_col(r)].reindex(df.index), r)
    if with_clf and deployed_cats is not None:
        dep = _deployed_classifiers(df, test, *deployed_cats, model_dir, deployed_git_ref)
        if not dep:
            meta["notes"].append(f"Deployed models in {meta['deployed_source']} have no classifiers; skipped.")
        classifiers.update(dep)

    meta["elapsed_seconds"] = round(time.time() - started, 1)
    results = EvalResults(
        meta=meta, headline=headline_df, big_move=big_move_df, trend=trend,
        by_ride=by_ride, by_hour=by_hour, by_park=by_park, by_band=by_band, paired=paired,
        day_profile=day_profile, staleness=stale, interleaved=inter, preds=all_preds,
        recipe_comparison=recipe_comparison, classifiers=classifiers, trend_clf=trend_clf,
    )
    if write_report:
        from . import report

        path = report.write(results, report_dir=report_dir, label=label)
        meta["report_path"] = str(path)
        log.info("report written to %s", path)
    log.info("evaluation finished in %.1fs", time.time() - started)
    return results
