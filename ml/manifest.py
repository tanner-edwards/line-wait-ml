"""models/manifest.json — which training run produced the files in models/.

Written by the notebook's save cell, uploaded by `npm run deploy:models`, and
read by cron/predict.py, which stamps `trained_through` on every prediction doc
as `model_version`. evaluate.run reads it for `deployed_trained_through` when
the caller doesn't pass one.

    from ml.manifest import write_manifest
    write_manifest(trained_through=df_sorted['date_la'].max())
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


def write_manifest(trained_through: date, recipe: str = "A", path="models/manifest.json") -> Path:
    """Write the manifest. `trained_through` may be a date, datetime/Timestamp, or ISO string."""
    if isinstance(trained_through, datetime):
        trained_through = trained_through.date()
    elif isinstance(trained_through, str):
        trained_through = date.fromisoformat(trained_through)
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "trained_through": trained_through.isoformat(),
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "git_sha": _git_sha(),
        "recipe": recipe,
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
