"""Refit a recipe on every row and write the deployable models/ directory.

Replaces the notebook's training and save cells. The refit has no holdout, so
it cannot be scored: the forward scoreboard's recipe comparison is the deploy
gate, run before this.

    from ml.recipes import RECIPE_B
    from ml.export import train_all, export
    models = train_all(df_sorted, RECIPE_B, RIDE_ID_CATEGORIES, STATUS_CATEGORIES)
    manifest = export(models, df_sorted, RECIPE_B, RIDE_ID_CATEGORIES, STATUS_CATEGORIES,
                      reversion_model=reversion_model, ride_percentile_buckets=ride_percentile_buckets,
                      crowd_keyed_by=CROWD_KEYED_BY)

export writes every file into a temporary directory first and only then moves
them over out_dir, so a failure part-way leaves models/ exactly as it was.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path

import pandas as pd

from . import recipes
from .manifest import manifest_for, write_manifest
from .recipes import Recipe

import crowd_features  # noqa: E402  (cron/ is on sys.path via ml.recipes)

log = logging.getLogger("ml.export")

HORIZONS = [10, 20, 30, 40, 50, 60, 90, 120, 150, 180, 210, 240]
GATE_REMINDER = "The forward scoreboard, not this refit, is the deploy gate."


def train_all(df: pd.DataFrame, recipe: Recipe, ride_cats: list, status_cats: list, horizons=HORIZONS) -> dict:
    """{'trajectory': {h: model}, 'day_profile': model, 'rows': {name: n}} fit on every row
    (training_valid_tN per horizon; wait_minutes present for day-profile)."""
    every_row = pd.Series(True, index=df.index)
    out: dict = {"trajectory": {}, "rows": {}}
    for h in horizons:
        t0 = time.time()
        out["trajectory"][h] = recipes.train_trajectory(df, every_row, h, ride_cats, status_cats, recipe=recipe)
        n = int(df[f"training_valid_t{h}"].sum())
        out["rows"][f"trajectory_t{h}"] = n
        log.info("trajectory_t%d: %d rows in %.1fs", h, n, time.time() - t0)
        print(f"trajectory_t{h}: {n:,} rows in {time.time() - t0:.1f}s")
    t0 = time.time()
    out["day_profile"] = recipes.train_day_profile(df, every_row, ride_cats, recipe=recipe)
    n = int(df["wait_minutes"].notna().sum())
    out["rows"]["day_profile"] = n
    log.info("day_profile: %d rows in %.1fs", n, time.time() - t0)
    print(f"day_profile: {n:,} rows in {time.time() - t0:.1f}s")
    return out


def _save_booster(model, path: Path) -> None:
    booster = getattr(model, "booster_", model)  # sklearn wrapper or a bare lgb.Booster
    booster.save_model(str(path))


def _check_recipe(models: dict, recipe: Recipe) -> None:
    """Refuse to write a manifest that disagrees with the models it describes."""
    for name, model in [(f"trajectory_t{h}", m) for h, m in models["trajectory"].items()]:
        fitted = getattr(model, "recipe_", None)
        if fitted is not None and fitted != recipe:
            raise ValueError(f"{name} was trained with recipe {fitted.name!r}, not {recipe.name!r}")
    cols = getattr(models["day_profile"], "day_profile_cols_", None)
    if cols is not None and list(cols) != list(recipe.day_profile_features):
        raise ValueError("day_profile was trained on a different feature list than the recipe's")


def export(
    models: dict, df: pd.DataFrame, recipe: Recipe, ride_cats: list, status_cats: list,
    reversion_model=None, ride_percentile_buckets: dict | None = None,
    out_dir: str | os.PathLike = "models", crowd_keyed_by=("day_type", "hour"),
) -> dict:
    """Write every artifact for `models` into out_dir atomically; return the manifest.

    reversion_model / ride_percentile_buckets are optional: when None the
    existing files in out_dir are left untouched and the manifest says so.
    """
    _check_recipe(models, recipe)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    horizons = sorted(models["trajectory"])
    every_row = pd.Series(True, index=df.index)
    # Same filesystem as out_dir, so os.replace is a rename.
    tmp = Path(tempfile.mkdtemp(prefix=".export-", dir=out.parent))
    try:
        for h in horizons:
            _save_booster(models["trajectory"][h], tmp / f"trajectory_t{h}.txt")
        _save_booster(models["day_profile"], tmp / "day_profile.txt")
        _write_json(tmp / "feature_categories.json",
                    {"ride_id_categories": list(ride_cats), "status_categories": list(status_cats)})
        _write_json(tmp / "ride_regime_thresholds.json", crowd_features.regime_thresholds(df))
        _write_json(tmp / "crowd_level_baselines.json",
                    crowd_features.crowd_expected_table(df, every_row, crowd_keyed_by))
        reversion_exported = reversion_model is not None and ride_percentile_buckets is not None
        if reversion_model is not None:
            _save_booster(reversion_model, tmp / "reversion_model.txt")
        if ride_percentile_buckets is not None:
            _write_json(tmp / "ride_percentile_buckets.json", ride_percentile_buckets)
        extra = manifest_for(recipe, df, horizons)
        trained_through = extra.pop("trained_through")
        extra.pop("recipe")
        extra["crowd_keyed_by"] = list(crowd_keyed_by)
        extra["reversion_exported"] = reversion_exported
        manifest_path = write_manifest(trained_through, recipe=recipe.name, path=tmp / "manifest.json", **extra)
        manifest = json.loads(manifest_path.read_text())

        written = sorted(p.name for p in tmp.iterdir())
        for name in written:
            os.replace(tmp / name, out / name)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    _summary(manifest, out, written, models.get("rows", {}))
    return manifest


def _write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n")


def _summary(manifest: dict, out: Path, written: list[str], rows: dict) -> None:
    lines = [
        f"Exported recipe {manifest['recipe']} ({manifest['trajectory_target']} trajectory) "
        f"trained through {manifest['trained_through']} to {out}/",
        f"Frame: {manifest['frame_rows']:,} rows, {manifest['frame_range'][0]} to {manifest['frame_range'][1]}",
    ]
    if rows:
        lines.append("Rows per model: " + ", ".join(f"{k} {v:,}" for k, v in rows.items()))
    for name in written:
        lines.append(f"  {name:32s} {(out / name).stat().st_size:>12,} bytes")
    if not manifest.get("reversion_exported"):
        lines.append("  reversion_model.txt / ride_percentile_buckets.json not both given; existing files left as they were.")
    lines.append(GATE_REMINDER)
    print("\n".join(lines))
