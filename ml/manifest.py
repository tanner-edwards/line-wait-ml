"""models/manifest.json — which training run produced the files in models/.

Written by ml.export.export (v3, Session 5), uploaded by `npm run deploy:models`,
and read by cron/predict.py, which stamps `trained_through` on every prediction
doc as `model_version`, reads `trajectory_target` to turn delta outputs back
into levels, downloads the files `classifiers` lists, and derives the trend
word from them with `trend_thresholds`. evaluate.run reads it for
`deployed_trained_through` when the caller doesn't pass one.

v2 fields: trained_through, exported_at, git_sha, recipe, trajectory_target,
trajectory_features, day_profile_features, horizons, frame_rows, frame_range.
v3 adds, when the recipe has classifiers:
  classifiers       {name: {file, horizon, direction, label}}, e.g.
                    p_rise_30: {file: clf_rise_30.txt, horizon: 30, direction: rise, label: [flat, 5]}
  trend_thresholds  {band: {call: {rise, fall}, high: {rise, fall}}}; null never fires
  trend_bands       {band: [lo, hi]} current-wait edges (documentation; predict.py's _band_of decides)
  alert             {field: p_rise_30, threshold, min_current_wait}
A v1 manifest (the first four only) reads as Recipe A: level target, A's lists.
A manifest without `classifiers` reads as a recipe without classifiers.

    from ml.manifest import manifest_for, write_manifest
    write_manifest(**manifest_for(RECIPE_B, df_sorted, HORIZONS))
"""

from __future__ import annotations

import json
import subprocess
from datetime import date, datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _git_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else "unknown"


def _as_date(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        return date.fromisoformat(value)
    return value


TREND_BANDS = {"<=10": [0, 10], "15-25": [15, 25], "30-60": [30, 60], ">60": [61, None]}


def manifest_for(recipe, df, horizons) -> dict:
    """v3 manifest fields for `recipe` refit on every row of df (exported_at and
    git_sha are added by write_manifest)."""
    lo, hi = _as_date(df["date_la"].min()), _as_date(df["date_la"].max())
    out = {
        "trained_through": hi.isoformat(),
        "recipe": recipe.name,
        "trajectory_target": recipe.trajectory_target,
        "trajectory_features": list(recipe.trajectory_features),
        "day_profile_features": list(recipe.day_profile_features),
        "horizons": [int(h) for h in horizons],
        "frame_rows": int(len(df)),
        "frame_range": [lo.isoformat(), hi.isoformat()],
    }
    if recipe.has_classifiers:
        from .recipes import classifier_file

        out["classifiers"] = {
            name: {"file": classifier_file(name), "horizon": int(name.rsplit("_", 1)[1]),
                   "direction": name.split("_")[1], "label": list(recipe.classifier_labels[name.split("_")[1]])}
            for name in recipe.classifier_names
        }
        if recipe.trend_thresholds is not None:
            out["trend_thresholds"] = recipe.trend_thresholds
            out["trend_bands"] = TREND_BANDS
        if recipe.alert is not None:
            out["alert"] = recipe.alert
    return out


def recipe_from_manifest(manifest: dict | None):
    """The Recipe a manifest describes. Params are not stored: they come from
    the recipe of that name in ml.recipes (A's for an unknown name). Missing
    fields read as A-era defaults (level target, A's feature lists), and a
    manifest without `classifiers` as a recipe without them (no thresholds, no alert)."""
    from .recipes import RECIPE_A, RECIPES, with_

    manifest = manifest or {}
    name = str(manifest.get("recipe", "A"))
    base = RECIPES.get(name, RECIPE_A)
    classifiers = manifest.get("classifiers") or {}
    labels = {spec["direction"]: tuple(spec["label"]) for spec in classifiers.values()} or None
    horizons = tuple(sorted({int(spec["horizon"]) for spec in classifiers.values()})) or base.classifier_horizons
    return with_(
        base,
        name=name,
        trajectory_target=manifest.get("trajectory_target", "level"),
        trajectory_features=tuple(manifest.get("trajectory_features", RECIPE_A.trajectory_features)),
        day_profile_features=tuple(manifest.get("day_profile_features", RECIPE_A.day_profile_features)),
        classifier_labels=labels,
        classifier_horizons=horizons,
        trend_thresholds=manifest.get("trend_thresholds") if labels else None,
        alert=manifest.get("alert") if labels else None,
    )


def write_manifest(trained_through: date, recipe: str = "A", path="models/manifest.json", **extra) -> Path:
    """Write the manifest. `trained_through` may be a date, datetime/Timestamp, or ISO string.

    `extra` adds fields (the v2 ones from manifest_for)."""
    trained_through = _as_date(trained_through)
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "trained_through": trained_through.isoformat(),
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "git_sha": _git_sha(),
        "recipe": recipe,
        **extra,
    }
    out.write_text(json.dumps(manifest, indent=2) + "\n")
    return out


def read_manifest(path="models/manifest.json") -> dict | None:
    """The manifest dict, or None when the file is missing or not valid JSON."""
    try:
        data = json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None
