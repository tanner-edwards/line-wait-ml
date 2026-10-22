"""Scoring functions. Every function scores exactly the rows it is handed.

Callers build the scoring mask once (training_valid_tN & test) and pass it in;
nothing here recomputes masks, so all models and baselines are compared on the
identical row set.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import binomtest

from .splits import wait_band

TREND_CLASSES = ["rising", "stable", "falling"]


def mae(y: pd.Series, p: pd.Series) -> float:
    """Mean absolute error."""
    return float(np.mean(np.abs(np.asarray(y, dtype=float) - np.asarray(p, dtype=float))))


def big_move_mae(
    df: pd.DataFrame, y: pd.Series | None, p: pd.Series, horizon: int, threshold: float = 10,
) -> float:
    """MAE on rows where the actual move |target - wait| >= threshold.

    `p` is indexed on the scoring rows; `y` defaults to target_t{horizon} on those rows.
    """
    if y is None:
        y = df.loc[p.index, f"target_t{horizon}"]
    move = (y - df.loc[y.index, "wait_minutes"]).abs()
    big = move >= threshold
    return mae(y[big], p[big]) if big.any() else float("nan")


def trend_class(delta: pd.Series, thr: float = 5) -> pd.Series:
    """Serving thresholds: delta >= thr rising, <= -thr falling, else stable."""
    values = np.select([delta >= thr, delta <= -thr], ["rising", "falling"], default="stable")
    return pd.Series(values, index=delta.index)


def trend_confusion(
    df: pd.DataFrame, y: pd.Series | None, p: pd.Series, horizon: int, thr: float = 5,
) -> dict:
    """3x3 actual-vs-predicted trend matrix with recall/precision per class.

    Returns {matrix, per_class (recall, precision, support), accuracy, always_stable_accuracy}.
    """
    if y is None:
        y = df.loc[p.index, f"target_t{horizon}"]
    wait = df.loc[y.index, "wait_minutes"]
    return trend_confusion_from_words(trend_class(y - wait, thr), trend_class(p - wait, thr))


def trend_confusion_from_words(actual: pd.Series, predicted: pd.Series) -> dict:
    """trend_confusion for words already derived (e.g. by recipes.derive_trend).

    'trough' counts as rising and 'peak' as falling, the direction the arrow shows.
    """
    collapse = {"trough": "rising", "peak": "falling"}
    actual = pd.Series(actual).replace(collapse)
    predicted = pd.Series(predicted, index=actual.index).replace(collapse)
    matrix = (
        pd.crosstab(actual.rename("actual"), predicted.rename("predicted"))
        .reindex(index=TREND_CLASSES, columns=TREND_CLASSES, fill_value=0)
    )
    diag = pd.Series(np.diag(matrix), index=TREND_CLASSES)
    support = matrix.sum(axis=1)
    called = matrix.sum(axis=0)
    per_class = pd.DataFrame({
        "recall": diag / support.replace(0, np.nan),
        "precision": diag / called.replace(0, np.nan),
        "support": support,
    })
    n = len(actual)
    return {
        "matrix": matrix,
        "per_class": per_class,
        "accuracy": float(diag.sum() / n) if n else float("nan"),
        "always_stable_accuracy": float((actual == "stable").mean()) if n else float("nan"),
    }


def breakdown(
    df: pd.DataFrame, rows: pd.Series, y: pd.Series, preds: dict[str, pd.Series], by: str,
    baseline: str = "persistence", primary: str = "recipe_A",
) -> pd.DataFrame:
    """MAE per group for each prediction, plus lift% of each vs `baseline`.

    `by` is a column of df or 'wait_band' (from current wait). Rows where the
    `primary` prediction (or the first non-baseline one) loses to the baseline
    are flagged in `worse_than_<baseline>`. Ride breakdowns sort worst lift first.
    """
    key = wait_band(df.loc[rows, "wait_minutes"]) if by == "wait_band" else df.loc[rows, by]
    errs = pd.DataFrame({name: (y[rows] - p[rows]).abs() for name, p in preds.items()})
    grouped = errs.groupby(key, observed=True)
    out = grouped.mean()
    out.insert(0, "n", grouped.size())
    others = [name for name in preds if name != baseline]
    for name in others:
        # A group whose baseline MAE is 0 (e.g. a constant posted wait) has no defined lift.
        base = out[baseline].replace(0, np.nan)
        out[f"lift_{name}"] = (base - out[name]) / base * 100
    flag_on = primary if primary in others else (others[0] if others else None)
    if flag_on is not None:
        out[f"worse_than_{baseline}"] = out[flag_on] > out[baseline]
        if by == "ride_name":
            out = out.sort_values(f"lift_{flag_on}")
    out.index.name = by
    return out


def paired_daily(
    df: pd.DataFrame, rows: pd.Series, y: pd.Series, p_a: pd.Series, p_b: pd.Series,
) -> dict:
    """Per-day MAE(a) - MAE(b) across test days, with a sign test on daily wins.

    Negative mean = a is better. Ties are excluded from the sign test.
    """
    frame = pd.DataFrame({
        "day": df.loc[rows, "date_la"],
        "a": (y[rows] - p_a[rows]).abs(),
        "b": (y[rows] - p_b[rows]).abs(),
    }).dropna()
    daily = frame.groupby("day")[["a", "b"]].mean()
    diff = daily["a"] - daily["b"]
    n = len(diff)
    std = float(diff.std(ddof=1)) if n > 1 else float("nan")
    wins_a, wins_b = int((diff < 0).sum()), int((diff > 0).sum())
    decided = wins_a + wins_b
    return {
        "mean": float(diff.mean()) if n else float("nan"),
        "std": std,
        "n_days": n,
        "half_width_95": 1.96 * std / np.sqrt(n) if n > 1 else float("nan"),
        "wins_a": wins_a,
        "wins_b": wins_b,
        "sign_test_p": float(binomtest(wins_a, decided).pvalue) if decided else float("nan"),
    }


def reliability(p, y, bins: int = 10) -> pd.DataFrame:
    """Mean predicted probability vs observed rate per quantile bin of p (ties merge bins)."""
    p, y = np.asarray(p, dtype=float), np.asarray(y, dtype=float)
    q = pd.qcut(p, bins, labels=False, duplicates="drop")
    out = pd.DataFrame({"bin": q, "p": p, "y": y}).groupby("bin").agg(
        n=("y", "size"), mean_p=("p", "mean"), observed=("y", "mean"))
    return out


def classifier_scores(y, p, bands, taus: dict | None = None, top: float = 0.10) -> dict:
    """AUC, average precision, top-decile precision, reliability and a per-band table.

    y: bool labels, p: probabilities, bands: band name per row (same length).
    taus: {band: tau} -> the band table adds call_rate / precision at p >= tau
    (a None tau never calls). AUC is NaN when y has a single class.
    """
    from sklearn.metrics import average_precision_score, roc_auc_score

    y = np.asarray(y, dtype=bool)
    p = np.asarray(p, dtype=float)
    bands = np.asarray(bands)
    two_classes = 0 < y.sum() < len(y)
    k = max(1, int(top * len(p)))
    out = {
        "n": int(len(y)),
        "base_rate": float(y.mean()) if len(y) else float("nan"),
        "auc": float(roc_auc_score(y, p)) if two_classes else float("nan"),
        "ap": float(average_precision_score(y, p)) if y.any() else float("nan"),
        "top_decile_precision": float(y[np.argsort(-p, kind="stable")[:k]].mean()) if len(y) else float("nan"),
        "reliability": reliability(p, y) if len(y) else pd.DataFrame(),
    }
    rows = []
    for b in pd.unique(bands):
        m = bands == b
        row = {"band": b, "n": int(m.sum()), "base_rate": float(y[m].mean())}
        if taus is not None:
            tau = taus.get(b)
            call = (p >= tau) & m if tau is not None else np.zeros(len(p), bool)
            row.update({"tau": tau, "call_rate": float(call.sum() / m.sum()),
                        "precision": float(y[call].mean()) if call.any() else float("nan")})
        rows.append(row)
    out["bands"] = pd.DataFrame(rows).set_index("band") if rows else pd.DataFrame()
    return out
