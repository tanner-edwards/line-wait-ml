"""Load and score the deployed LightGBM model files.

Models come from the working tree (`models/`) or, with `git_ref`, from
`git show <ref>:models/...` — the notebook's existing approach. A missing file
or git object returns None so the caller can note it and move on.

CONTAMINATED: a deployed model trained through a date inside the test window
has seen those days. Its numbers are printed but never used for a verdict.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from datetime import date
from pathlib import Path

import lightgbm as lgb
import pandas as pd

from .recipes import CAT_COLS, add_categoricals

REPO_ROOT = Path(__file__).resolve().parents[1]


def _model_filename(horizon_or_name: int | str) -> str:
    if isinstance(horizon_or_name, int):
        return f"trajectory_t{horizon_or_name}.txt"
    return f"{horizon_or_name}.txt"


def _read_text(filename: str, model_dir: str, git_ref: str | None) -> str | None:
    """File contents from the working tree or a git ref; None if absent."""
    if git_ref is None:
        path = Path(model_dir)
        if not path.is_absolute():
            path = REPO_ROOT / path
        path = path / filename
        return path.read_text() if path.is_file() else None
    result = subprocess.run(
        ["git", "show", f"{git_ref}:{Path(model_dir).as_posix()}/{filename}"],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    return result.stdout if result.returncode == 0 else None


def load_booster(horizon_or_name: int | str, model_dir: str = "models", git_ref: str | None = None) -> lgb.Booster | None:
    """trajectory_t{N}.txt for an int, '{name}.txt' for a str (e.g. 'day_profile'); None if missing."""
    text = _read_text(_model_filename(horizon_or_name), model_dir, git_ref)
    if text is None:
        return None
    if git_ref is None:
        return lgb.Booster(model_str=text)
    # Written to a temp file to mirror the notebook's git-show approach.
    fd, tmp = tempfile.mkstemp(suffix=".txt")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(text)
        return lgb.Booster(model_file=tmp)
    finally:
        os.unlink(tmp)


def load_categories(model_dir: str = "models", git_ref: str | None = None) -> tuple[list, list] | None:
    """(ride_id_categories, status_categories) from feature_categories.json; None if missing."""
    text = _read_text("feature_categories.json", model_dir, git_ref)
    if text is None:
        return None
    cats = json.loads(text)
    return cats["ride_id_categories"], cats["status_categories"]


def predict_with_booster(
    booster: lgb.Booster, df: pd.DataFrame, rows: pd.Series, ride_cats: list, status_cats: list,
) -> pd.Series:
    """Booster predictions on `rows`, in the column order the booster was trained with."""
    cols = booster.feature_name()
    sources = {CAT_COLS.get(c, c) for c in cols}
    missing = sorted(sources - set(df.columns))
    if missing:
        raise ValueError(f"Frame is missing columns the deployed model needs: {missing}")
    X = add_categoricals(df.loc[rows, sorted(sources)], ride_cats, status_cats)[cols]
    return pd.Series(booster.predict(X), index=X.index)


def contaminated(trained_through: date | None, test_days: list[date]) -> bool:
    """True when any test day is on or before trained_through.

    An unknown trained_through counts as contaminated: a model of unknown
    provenance must not drive a verdict.
    """
    if trained_through is None:
        return True
    return any(d <= trained_through for d in test_days)
