"""models/manifest.json — which training run produced the files in models/.

Written by ml.export.export (v2, Session 4), uploaded by `npm run deploy:models`,
and read by cron/predict.py, which stamps `trained_through` on every prediction
doc as `model_version` and reads `trajectory_target` to turn delta outputs back
into levels. evaluate.run reads it for `deployed_trained_through` when the
caller doesn't pass one.

v2 fields: trained_through, exported_at, git_sha, recipe, trajectory_target,
trajectory_features, day_profile_features, horizons, frame_rows, frame_range.
A v1 manifest (the first four only) reads as Recipe A: level target, A's lists.

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


def manifest_for(recipe, df, horizons) -> dict:
    """v2 manifest fields for `recipe` refit on every row of df (exported_at and
    git_sha are added by write_manifest)."""
    lo, hi = _as_date(df["date_la"].min()), _as_date(df["date_la"].max())
    return {
        "trained_through": hi.isoformat(),
        "recipe": recipe.name,
        "trajectory_target": recipe.trajectory_target,
        "trajectory_features": list(recipe.trajectory_features),
        "day_profile_features": list(recipe.day_profile_features),
        "horizons": [int(h) for h in horizons],
        "frame_rows": int(len(df)),
        "frame_range": [lo.isoformat(), hi.isoformat()],
    }


def recipe_from_manifest(manifest: dict | None):
    """The Recipe a manifest describes. Params are not stored: they come from
    the recipe of that name in ml.recipes (A's for an unknown name). Missing
    fields read as A-era defaults (level target, A's feature lists)."""
    from .recipes import RECIPE_A, RECIPES, with_

    manifest = manifest or {}
    name = str(manifest.get("recipe", "A"))
    base = RECIPES.get(name, RECIPE_A)
    return with_(
        base,
        name=name,
        trajectory_target=manifest.get("trajectory_target", "level"),
        trajectory_features=tuple(manifest.get("trajectory_features", RECIPE_A.trajectory_features)),
        day_profile_features=tuple(manifest.get("day_profile_features", RECIPE_A.day_profile_features)),
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
