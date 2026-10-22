"""Session 5 classifier experiment: what label should the trend word use, at
what per-band thresholds, and what replaces the reversion model's alert?

Spec: ~/.claude/specs/line-wait-ml/session5-classifiers.md, Part A.

Forward split (last 4 weeks), horizons 30 and 60, recipe B's 21 trajectory
features, LightGBM binary classifiers 300 trees x 63 leaves x 0.05. Train rows =
training_valid_tN & train, subsampled to 300k with seed 1; test rows =
training_valid_tN & test. The regression comparator is recipe B's trajectory
model fit on the same train rows; its score is +/-(pred - current).

Label arms on d = target_tN - wait_minutes, c = wait_minutes:
  flat5   rise d >= 5,  fall d <= -5      (today's arrow threshold)
  flat10  rise d >= 10, fall d <= -10     (reference only)
  pct     c >= 15 and the move >= 40% of c (the floored percentage)

Decision rules (spec A3):
  trend label  flat5, unless pct has higher precision than flat5 at the
               regression's call rate (each arm's band table) in BOTH the 30-60
               and >60 bands, for both directions at T+30 and T+60, and is not
               worse in 15-25. flat10 is a reference row only.
  tau_call     per band and direction: the probability at which the classifier
               calls as often as today's regression does in that band.
  tau_high     per band and direction: the lowest probability at which the
               classifier's precision reaches 0.75 ('n/a' if it never does).
  alert        the (arm, threshold) with own-label precision >= 0.60 in both the
               15-25 and 30-60 bands at the highest call rate over those rows
               (rise at T+30, rows with current > 10). The deployed reversion
               model is an arm; if it wins, it stays.

    .venv/bin/python -m ml.experiments.session5_classifiers

Reads df_features_cache.pkl (refuses if missing or older than df_cache.pkl) and
models/reversion_model.txt + models/ride_percentile_buckets.json (read only;
pct_rank uses a verbatim copy of predict.py's deleted _compute_pct_rank).
Writes reports/eval/<today>_session5-classifiers.md. Never writes under models/.
"""

from __future__ import annotations

import json
import sys
import time
from datetime import date
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

REPO = Path(__file__).resolve().parents[2]
for p in (REPO, REPO / "cron"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from ml import recipes  # noqa: E402
from ml.recipes import BANDS, RECIPE_B, band_of, change_label, derive_trend, with_  # noqa: E402
from ml.report import _table  # noqa: E402
from ml.splits import day_type, forward_split  # noqa: E402

FRAME = REPO / "df_features_cache.pkl"
RAW_CACHE = REPO / "df_cache.pkl"
MODELS = REPO / "models"
HORIZONS = [30, 60]
VOTE_HORIZONS = [40, 50, 60, 90, 120, 150, 180, 210, 240]  # today's confidence vote
CLF = dict(n_estimators=300, num_leaves=63, learning_rate=0.05, verbose=-1)
ARMS = {"flat5": ("flat", 5), "flat10": ("flat", 10), "pct": ("pct", 0.40, 15)}
DIRECTIONS = ["fall", "rise"]
SUBSAMPLE, SEED = 300_000, 1
HIGH_PRECISION = 0.75
ALERT_THRESHOLDS = [0.35, 0.5, 0.6, 0.7]
ALERT_PRECISION = 0.60
ALERT_BANDS = ["15-25", "30-60"]
MIN_HIGH_CALLS = 50  # tau_high needs at least this many calls behind it


def _load() -> pd.DataFrame:
    if not FRAME.exists():
        print(f"{FRAME.name} not found at the repo root; run the notebook's DUMP cell first.")
        sys.exit(2)
    if RAW_CACHE.exists() and FRAME.stat().st_mtime < RAW_CACHE.stat().st_mtime:
        print(f"{FRAME.name} is older than {RAW_CACHE.name}; re-run the notebook through the DUMP cell first.")
        sys.exit(2)
    t0 = time.time()
    df = pd.read_pickle(FRAME)
    print(f"Loaded {FRAME.name}: {df.shape} in {time.time() - t0:.1f}s")
    return df


def bands(c: pd.Series) -> pd.Series:
    return pd.cut(c, bins=recipes.BAND_EDGES, labels=BANDS).astype(str)


def subsample(df: pd.DataFrame, mask: pd.Series) -> pd.Series:
    idx = np.where(mask.to_numpy())[0]
    rng = np.random.default_rng(SEED)
    if len(idx) > SUBSAMPLE:
        idx = rng.choice(idx, SUBSAMPLE, replace=False)
    out = pd.Series(False, index=df.index)
    out.iloc[idx] = True
    return out


def raw_level(model, df: pd.DataFrame) -> np.ndarray:
    """Serving-style level for every row of df (no validity mask): a delta model's
    output + current, clipped at 0, rounded to 0.1 as predict.py does."""
    X = recipes._features(df, None, model.trajectory_cols_, model.ride_cats_, model.status_cats_)
    raw = model.predict(X)
    c = df["wait_minutes"].to_numpy(dtype=float)
    return np.maximum(0.0, np.round(c + raw if model.recipe_.trajectory_target == "delta" else raw, 1))


def top_precision(p: np.ndarray, y: np.ndarray, frac: float = 0.10) -> float:
    k = max(1, int(frac * len(p)))
    return float(y[np.argsort(-p, kind="stable")[:k]].mean())


def reliability(p: np.ndarray, y: np.ndarray, bins: int = 10) -> pd.DataFrame:
    q = pd.qcut(p, bins, labels=False, duplicates="drop")
    g = pd.DataFrame({"decile": q, "p": p, "y": y}).groupby("decile").agg(
        n=("y", "size"), mean_p=("p", "mean"), observed=("y", "mean"))
    return g


def tau_for_rate(p: np.ndarray, k: int) -> float | None:
    """The probability whose 'p >= tau' calls k rows (the k-th largest)."""
    if k <= 0 or len(p) == 0:
        return None
    return float(np.sort(p)[::-1][min(k, len(p)) - 1])


def tau_high(p: np.ndarray, y: np.ndarray, target: float = HIGH_PRECISION) -> float | None:
    """Lowest tau whose calls (p >= tau) have precision >= target, with at least
    MIN_HIGH_CALLS calls; None when no such tau exists."""
    order = np.argsort(-p, kind="stable")
    ps, ys = p[order], y[order].astype(float)
    prec = np.cumsum(ys) / np.arange(1, len(ys) + 1)
    # Only cut between distinct probabilities, so 'p >= tau' calls exactly the prefix.
    last_of_value = np.r_[ps[1:] != ps[:-1], True]
    ok = np.where((prec >= target) & last_of_value & (np.arange(1, len(ps) + 1) >= MIN_HIGH_CALLS))[0]
    return float(ps[ok[-1]]) if len(ok) else None


def round_tau(t: float | None) -> float | None:
    # Probabilities are rounded to 3 places on the doc; floor so a doc value
    # equal to the rounded tau still calls.
    return None if t is None else float(np.floor(t * 1000) / 1000)


def band_table(p, y, reg_call, band) -> pd.DataFrame:
    out = []
    for b in BANDS:
        m = band == b
        n = int(m.sum())
        if n == 0:
            continue
        pb, yb, rb = p[m], y[m], reg_call[m]
        k = int(rb.sum())
        tc = tau_for_rate(pb, k)
        clf_call = pb >= tc if tc is not None else np.zeros(n, bool)
        th = tau_high(pb, yb)
        out.append({
            "band": b, "n": n, "base_rate": yb.mean(),
            "reg_call_rate": k / n, "reg_precision": yb[rb].mean() if k else np.nan,
            "clf_call_rate": clf_call.mean(), "clf_precision": yb[clf_call].mean() if clf_call.any() else np.nan,
            "tau_call": round_tau(tc), "tau_high": round_tau(th),
        })
    return pd.DataFrame(out).set_index("band")


def fmt(t) -> str:
    return "n/a" if t is None or (isinstance(t, float) and np.isnan(t)) else f"{t:.3f}"


# Copied verbatim from cron/predict.py as of 95d3aca; Session 5 deletes it there
# together with the reversion model, and this experiment still has to score it.
_REVERSION_BREAKPOINTS = [0.05, 0.10, 0.15, 0.25, 0.50, 0.75, 0.85, 0.90, 0.95]
_REVERSION_PCT_KEYS    = ["p5", "p10", "p15", "p25", "p50", "p75", "p85", "p90", "p95"]


def _compute_pct_rank(
    wait: float,
    ride_id: str,
    hour: int,
    day_type: str,
    buckets: dict,
) -> float:
    """Interpolate current wait into [0,1] percentile rank using pre-computed bucket breakpoints.
    Falls back to 0.5 (neutral) when the bucket is absent or has no breakpoints."""
    key = f"{ride_id}__{hour}_{day_type}"
    b = buckets.get(key)
    if not b:
        return 0.5
    breakpoints = list(zip(_REVERSION_BREAKPOINTS, [b.get(k, 0) for k in _REVERSION_PCT_KEYS]))
    if wait <= breakpoints[0][1]:
        return breakpoints[0][0]
    if wait >= breakpoints[-1][1]:
        return breakpoints[-1][0]
    for i in range(len(breakpoints) - 1):
        pct_lo, val_lo = breakpoints[i]
        pct_hi, val_hi = breakpoints[i + 1]
        if val_lo <= wait <= val_hi:
            t = (wait - val_lo) / (val_hi - val_lo) if val_hi > val_lo else 0.5
            return round(pct_lo + t * (pct_hi - pct_lo), 3)
    return 0.5


def reversion_probs(test_df: pd.DataFrame, ride_cats: list) -> tuple[np.ndarray, np.ndarray]:
    """(reversion_prob, pct_rank) for every row of test_df, built as predict.py did."""
    booster = lgb.Booster(model_file=str(MODELS / "reversion_model.txt"))
    buckets = json.loads((MODELS / "ride_percentile_buckets.json").read_text())
    dt = day_type(test_df).to_numpy()
    pct_rank = np.array([
        _compute_pct_rank(float(w), str(r), int(h), d, buckets)
        for w, r, h, d in zip(test_df["wait_minutes"], test_df["ride_id"], test_df["hour_of_day"], dt)
    ])
    X = pd.DataFrame({
        "pct_rank": pct_rank,
        "wait_delta_1": (test_df["wait_minutes"] - test_df["wait_lag_1"]).to_numpy(dtype=float),
        "hour_of_day": test_df["hour_of_day"].to_numpy(),
        "day_of_week": test_df["day_of_week"].to_numpy(),
        "week_of_year": test_df["week_of_year"].to_numpy().astype(int),
        "park_crowd_median": test_df["park_crowd_median"].to_numpy(dtype=float),
        "is_holiday": test_df["is_holiday"].to_numpy().astype(bool),
        "is_holiday_weekend": test_df["is_holiday_weekend"].to_numpy().astype(bool),
        "ride_id_cat": pd.Categorical(test_df["ride_id"].where(test_df["ride_id"].isin(ride_cats)).to_numpy(),
                                      categories=ride_cats),
    })[booster.feature_name()]
    return booster.predict(X), pct_rank


def collapse(word: pd.Series) -> pd.Series:
    return word.replace({"trough": "rising", "peak": "falling"})


def word_shares(word: pd.Series, conf: pd.Series, d: pd.Series) -> dict:
    direction = collapse(word)
    shown = (direction != "stable") & (conf != "low")
    right = ((direction == "rising") & (d >= 5)) | ((direction == "falling") & (d <= -5))
    out = {f"word_{w}": float((direction == w).mean()) for w in ("rising", "falling", "stable")}
    out.update({f"raw_{w}": float((word == w).mean()) for w in ("trough", "peak")})
    out.update({f"confidence_{c}": float((conf == c).mean()) for c in ("high", "medium", "low")})
    out["arrow_shown"] = float(shown.mean())
    out["arrow_precision_flat5"] = float(right[shown].mean()) if shown.any() else float("nan")
    called = direction != "stable"
    out["word_precision_flat5"] = float(right[called].mean()) if called.any() else float("nan")
    return out


def decide_label(tables: dict) -> tuple[str, list[str]]:
    """tables[(h, direction, arm)] = band table."""
    reasons, ok = [], True
    for h in HORIZONS:
        for d in DIRECTIONS:
            f, p = tables[(h, d, "flat5")], tables[(h, d, "pct")]
            parts = []
            for b in ("30-60", ">60", "15-25"):
                fp = f.loc[b, "clf_precision"] if b in f.index else np.nan
                pp = p.loc[b, "clf_precision"] if b in p.index else np.nan
                better = pp > fp if b != "15-25" else pp >= fp  # NaN -> False
                ok &= bool(better)
                parts.append(f"{b} pct {fmt(pp)} vs flat5 {fmt(fp)} -> {'pct ok' if better else 'flat5'}")
            reasons.append(f"T+{h} {d}: " + "; ".join(parts))
    return ("pct" if ok else "flat5"), reasons


def decide_alert(alert: pd.DataFrame) -> tuple[tuple[str, float] | None, list[str]]:
    """alert rows: arm, threshold, band, n, calls, hits_own, ..."""
    reasons, best = [], None
    for (arm, thr), g in alert.groupby(["arm", "threshold"], sort=False):
        g = g.set_index("band")
        if not set(ALERT_BANDS) <= set(g.index):
            continue
        precs = {b: g.loc[b, "precision_own"] for b in ALERT_BANDS}
        rate = g.loc[ALERT_BANDS, "calls"].sum() / g.loc[ALERT_BANDS, "n"].sum()
        qualifies = all(v >= ALERT_PRECISION for v in precs.values())
        reasons.append(f"{arm} @ {thr}: precision 15-25 {fmt(precs['15-25'])}, 30-60 {fmt(precs['30-60'])}, "
                       f"call rate (15-60) {rate:.3f} -> {'qualifies' if qualifies else 'no'}")
        if qualifies and (best is None or rate > best[2]):
            best = (arm, float(thr), rate)
    return (best[:2] if best else None), reasons


def main(argv=None) -> int:
    started = time.time()
    df = _load()
    ride_cats, status_cats = df.attrs["RIDE_ID_CATEGORIES"], df.attrs["STATUS_CATEGORIES"]
    train, test = forward_split(df, weeks=4)
    base = with_(RECIPE_B, classifier_params=dict(CLF))

    summary, tables, rel, cross, probs, ctx = [], {}, {}, {}, {}, {}
    for h in HORIZONS:
        t0 = time.time()
        valid = df[f"training_valid_t{h}"].astype(bool)
        tr = subsample(df, valid & train)
        rows = valid & test
        test_df = df[rows]
        c = test_df["wait_minutes"]
        d = test_df[f"target_t{h}"] - c
        reg = recipes.train_trajectory(df, tr, h, ride_cats, status_cats, recipe=RECIPE_B)
        pred = pd.Series(raw_level(reg, test_df), index=test_df.index)
        dreg = pred - c
        band = bands(c).to_numpy()
        ctx[h] = {"test_df": test_df, "c": c, "d": d, "pred": pred, "band": band, "n_train": int(tr.sum()),
                  "reg": reg}
        labels = {arm: {dr: change_label(d, c, dr, spec).to_numpy() for dr in DIRECTIONS} for arm, spec in ARMS.items()}
        ctx[h]["labels"] = labels
        for arm, spec in ARMS.items():
            rec = with_(base, name=f"B-{arm}", classifier_labels={"fall": spec, "rise": spec})
            for dr in DIRECTIONS:
                model = recipes.train_classifier(df, tr, h, dr, ride_cats, status_cats, rec)
                p = recipes.predict_classifier(model, test_df, h).to_numpy()
                del model
                probs[(h, dr, arm)] = p
                y = labels[arm][dr]
                score = (dreg if dr == "rise" else -dreg).to_numpy()
                reg_call = change_label(dreg, c, dr, spec).to_numpy()
                tables[(h, dr, arm)] = band_table(p, y, reg_call, band)
                if dr == "fall":
                    rel[(h, arm)] = reliability(p, y)
                summary.append({
                    "horizon": h, "direction": dr, "arm": arm, "n": len(y), "base_rate": y.mean(),
                    "auc_clf": roc_auc_score(y, p), "auc_reg": roc_auc_score(y, score),
                    "ap_clf": average_precision_score(y, p), "ap_reg": average_precision_score(y, score),
                    "top10_clf": top_precision(p, y), "top10_reg": top_precision(score, y),
                    "reg_call_rate": reg_call.mean(), "reg_precision": y[reg_call].mean() if reg_call.any() else np.nan,
                })
                print(f"  T+{h} {dr} {arm}: AUC {summary[-1]['auc_clf']:.3f} vs {summary[-1]['auc_reg']:.3f}")
        for dr in DIRECTIONS:
            rows_x = []
            for arm in ARMS:
                p = probs[(h, dr, arm)]
                top = np.argsort(-p, kind="stable")[: max(1, int(0.1 * len(p)))]
                rows_x.append({"top-decile calls of": arm,
                               **{f"hit_{lab}": labels[lab][dr][top].mean() for lab in ARMS}})
            cross[(h, dr)] = pd.DataFrame(rows_x).set_index("top-decile calls of")
        print(f"T+{h}: {len(test_df):,} test rows, {ctx[h]['n_train']:,} train rows, {time.time() - t0:.0f}s")

    label, label_reasons = decide_label(tables)

    def thresholds_for(h: int) -> dict:
        return {b: {"call": {dr: (tables[(h, dr, label)].loc[b, "tau_call"] if b in tables[(h, dr, label)].index else None)
                             for dr in ("rise", "fall")},
                    "high": {dr: (tables[(h, dr, label)].loc[b, "tau_high"] if b in tables[(h, dr, label)].index else None)
                             for dr in ("rise", "fall")}}
                for b in BANDS}

    def clean(t: dict) -> dict:
        return {b: {k: {dr: (None if v is None or (isinstance(v, float) and np.isnan(v)) else float(v))
                        for dr, v in side.items()} for k, side in sides.items()} for b, sides in t.items()}

    thr30, thr60 = clean(thresholds_for(30)), clean(thresholds_for(60))

    # ── Alert (rise, T+30, current > 10) ─────────────────────────────────────
    t0 = time.time()
    x = ctx[30]
    c30, d30, band30 = x["c"].to_numpy(dtype=float), x["d"].to_numpy(dtype=float), x["band"]
    rev_prob, pct_rank = reversion_probs(x["test_df"], ride_cats)
    with np.errstate(divide="ignore", invalid="ignore"):
        rev_label = np.where(c30 > 0, d30 / c30 >= 0.40, d30 > 0)
    flat5_rise = x["labels"]["flat5"]["rise"]
    alert_arms = {arm: (probs[(30, "rise", arm)], x["labels"][arm]["rise"]) for arm in ARMS}
    alert_arms["deployed reversion"] = (rev_prob, rev_label)
    alert_rows = []
    for arm, (p, own) in alert_arms.items():
        for thr in ALERT_THRESHOLDS:
            call = p >= thr if arm != "deployed reversion" else p > thr  # today's gate is '> 0.35'
            for b in BANDS[1:]:
                m = band30 == b
                calls = call & m
                alert_rows.append({"arm": arm, "threshold": thr, "band": b, "n": int(m.sum()),
                                   "calls": int(calls.sum()), "call_rate": calls.sum() / m.sum(),
                                   "precision_own": own[calls].mean() if calls.any() else np.nan,
                                   "precision_flat5": flat5_rise[calls].mean() if calls.any() else np.nan})
    gate = (pct_rank <= 0.15) & (rev_prob > 0.35)
    for b in BANDS[1:]:
        m = band30 == b
        calls = gate & m
        alert_rows.append({"arm": "today's gate (pct_rank<=0.15 & p>0.35)", "threshold": 0.35, "band": b,
                           "n": int(m.sum()), "calls": int(calls.sum()), "call_rate": calls.sum() / m.sum(),
                           "precision_own": rev_label[calls].mean() if calls.any() else np.nan,
                           "precision_flat5": flat5_rise[calls].mean() if calls.any() else np.nan})
    alert = pd.DataFrame(alert_rows)
    pick, alert_reasons = decide_alert(alert[~alert["arm"].str.startswith("today")])
    low = c30 <= 10
    low_lines = []
    for arm, (p, own) in alert_arms.items():
        pos_low = own[low].sum() / own.sum() if own.sum() else np.nan
        calls035 = p > 0.35 if arm == "deployed reversion" else p >= 0.35
        call_low = (calls035 & low).sum() / calls035.sum() if calls035.any() else np.nan
        low_lines.append(f"{arm}: {pos_low:.1%} of its label's positives and {call_low:.1%} of its calls at 0.35 "
                         f"are on current waits <= 10")
    print(f"Alert section: {time.time() - t0:.0f}s")

    # ── Share table: today's rule vs the chosen rule, T+30 rows ──────────────
    t0 = time.time()
    from predict import _derive_trend as today_rule

    tdf = x["test_df"]
    vote = {30: x["pred"].to_numpy()}
    for vh in VOTE_HORIZONS:
        if vh in ctx:  # T+60: the comparator already fit on the same subsample
            vote[vh] = raw_level(ctx[vh]["reg"], tdf)
            continue
        vtr = subsample(df, df[f"training_valid_t{vh}"].astype(bool) & train)
        m = recipes.train_trajectory(df, vtr, vh, ride_cats, status_cats, recipe=RECIPE_B)
        vote[vh] = raw_level(m, tdf)
        del m
        print(f"  vote model T+{vh} done")
    lag1 = tdf["wait_lag_1"].to_numpy(dtype=float)
    old_word, old_conf = [], []
    for i in range(len(tdf)):
        preds_i = {h_: float(vote[h_][i]) for h_ in vote}
        w, _, conf, _ = today_rule(float(c30[i]), float(lag1[i]), preds_i)  # no probs -> regression path
        old_word.append(w)
        old_conf.append(conf)
    pr, pf = probs[(30, "rise", label)], probs[(30, "fall", label)]
    new = [derive_trend(float(c30[i]), float(lag1[i]), float(pr[i]), float(pf[i]), thr30) for i in range(len(tdf))]
    new_word = [t[0] if t else "stable" for t in new]
    new_conf = [t[1] if t else "low" for t in new]
    d30s = pd.Series(d30)
    shares = pd.DataFrame({
        "today (regression)": word_shares(pd.Series(old_word), pd.Series(old_conf), d30s),
        f"new ({label} classifiers)": word_shares(pd.Series(new_word), pd.Series(new_conf), d30s),
    })
    shares["change_pts"] = (shares.iloc[:, 1] - shares.iloc[:, 0]) * 100
    shares.index.name = "share of T+30 forward rows"
    low_move = shares.loc["confidence_low", "change_pts"]
    by_band_low = pd.DataFrame({
        "today_low": pd.Series(np.array(old_conf) == "low").groupby(band30).mean(),
        "new_low": pd.Series(np.array(new_conf) == "low").groupby(band30).mean(),
        "today_arrow": pd.Series((collapse(pd.Series(old_word)) != "stable").to_numpy()
                                 & (np.array(old_conf) != "low")).groupby(band30).mean(),
        "new_arrow": pd.Series((collapse(pd.Series(new_word)) != "stable").to_numpy()
                               & (np.array(new_conf) != "low")).groupby(band30).mean(),
    }).reindex(BANDS)
    by_band_low.index.name = "band"
    print(f"Share table: {time.time() - t0:.0f}s")

    # ── Report ───────────────────────────────────────────────────────────────
    summary_df = pd.DataFrame(summary).set_index(["horizon", "direction", "arm"])
    old_shown, new_shown = shares.loc["arrow_shown"].iloc[:2]
    old_prec, new_prec = shares.loc["arrow_precision_flat5"].iloc[:2]
    lines = [
        f"# Session 5 classifier experiment — {date.today().isoformat()}",
        "",
        f"**In plain words:** today the arrow shows on {old_shown:.1%} of forward rows and is right "
        f"{old_prec:.1%} of the time (a real 5-minute move in that direction by T+30). Under the chosen rule "
        f"it shows on {new_shown:.1%} of rows and is right {new_prec:.1%} of the time.",
        "",
        f"- Frame: `{FRAME.name}` {df.shape[0]:,} rows, {df['date_la'].min()} to {df['date_la'].max()}",
        f"- Forward split, 4 weeks: train {int(df.loc[train, 'date_la'].nunique())} days, "
        f"test {int(df.loc[test, 'date_la'].nunique())} days. Horizons {HORIZONS}.",
        f"- Train rows per horizon: subsample of {SUBSAMPLE:,} (seed {SEED}) of training_valid_tN & train "
        f"({', '.join(f'T+{h} {ctx[h]['n_train']:,}' for h in HORIZONS)}); test rows: "
        f"{', '.join(f'T+{h} {len(ctx[h]['test_df']):,}' for h in HORIZONS)}.",
        f"- Classifiers: `LGBMClassifier({CLF})` on recipe B's {len(RECIPE_B.trajectory_features)} trajectory "
        "features. Regression comparator: recipe B's trajectory model fit on the same train rows; "
        "its score is ±(pred − current) and its calls are today's rule applied to its predicted change.",
        "- Bands on the current (walk-on-normalized) wait: <=10, 15-25 (11–25), 30-60 (26–60), >60.",
        "- Thresholds are chosen on the forward test rows themselves (that is what the spec asks for); "
        "the deployed classifiers are refit on every row, so expect small drift in the realized call rate.",
        f"- Run time: {time.time() - started:.0f}s.",
        "",
        "## Label arms: AUC, average precision, top-decile precision", "",
        "`_reg` columns score the regression's ±(pred − current) against the same label. "
        "reg_call_rate / reg_precision: the regression's own calls under that label.", "",
        _table(summary_df), "",
        "## Band tables", "",
        "Per band: base rate of the label; the regression's call rate and precision; the classifier's precision "
        "when it calls as often as the regression (tau_call), and tau_high, the lowest probability where the "
        f"classifier's precision reaches {HIGH_PRECISION} (n/a if never, or with fewer than {MIN_HIGH_CALLS} calls).", "",
    ]
    for h in HORIZONS:
        for dr in DIRECTIONS:
            for arm in ARMS:
                t = tables[(h, dr, arm)].copy()
                t["tau_call"] = t["tau_call"].map(fmt)
                t["tau_high"] = t["tau_high"].map(fmt)
                lines += [f"### T+{h} {dr}, {arm}", "", _table(t), ""]
    lines += ["## Reliability (fall, by decile of predicted probability)", ""]
    for (h, arm), r in rel.items():
        lines += [f"### T+{h} fall, {arm}", "", _table(r), ""]
    lines += ["## Cross table", "",
              "Each arm's top-decile calls (top 10% of its probability, all test rows), scored under all three labels.", ""]
    for (h, dr), t in cross.items():
        lines += [f"### T+{h} {dr}", "", _table(t), ""]
    lines += [
        "## Alert arms (rise, T+30, current > 10)", "",
        "Call rate and precision per band at each threshold. precision_own = against the arm's own label "
        "(deployed reversion: (target − wait)/wait >= 0.40, no floor); precision_flat5 = against a 5-minute rise, "
        "the common yardstick. The deployed reversion model is called at p > threshold (today's gate uses > 0.35); "
        "the last rows are today's whole gate (pct_rank <= 0.15 and p > 0.35), for reference only.", "",
        "**The deployed reversion model is in-sample here.** `models/reversion_model.txt` was retrained by the "
        "notebook's `rm01ef45` cell during the 2026-10-18 export (its bytes differ from the 2026-10-14 commit), "
        "on the every-5th-day interleaved split through 2026-10-18, so it saw about 80% of these forward test "
        "days, and `ride_percentile_buckets.json` (its pct_rank input) was built from every row through 2026-10-18. "
        "Its numbers are optimistic; an arm that beats it here would beat it by at least as much out of sample.", "",
        _table(alert.set_index(["arm", "threshold", "band"])), "",
        "**Current wait <= 10 (excluded above; the alert never fires there):**", "",
    ]
    lines += [f"- {ln}" for ln in low_lines]
    lines += [
        "",
        "## Trend word and confidence: today vs chosen rule (T+30 forward rows)", "",
        "Today = predict.py's `_derive_trend` on recipe B regressions fit on the same train rows (T+30 sets the word, "
        "T+40..T+240 vote for confidence). New = `ml.recipes.derive_trend` on the chosen arm's p_rise_30 / p_fall_30 "
        "with the T+30 thresholds below. Arrow shown = word not stable and confidence not low; precision is "
        "against a 5-minute move in the arrow's direction by T+30. word_* collapse trough into rising and peak "
        "into falling (raw_* are the refined words).", "",
        _table(shares), "",
        f"Share of rows with confidence == 'low': today {shares.loc['confidence_low'].iloc[0]:.1%}, new "
        f"{shares.loc['confidence_low'].iloc[1]:.1%} ({low_move:+.1f} points). "
        + ("**More than 10 points: the spec says decouple the verdict engine's curve gate (layer1.ts:64) "
           "from this field before shipping (done: see below).**" if abs(low_move) > 10 else
           "Within the spec's ~10-point tolerance."),
        "",
        "`confidence` now governs only the arrow and the AI prompt; the verdict engine's curve gate "
        "(scoring/layer1.ts) keeps the old vote-count rule via the new `curve_confidence` field, so this "
        "shift does not reach the verdict engine.",
        "",
        "By band (share of rows):", "",
        _table(by_band_low), "",
    ]

    def tau_block(t: dict) -> pd.DataFrame:
        return pd.DataFrame([{"band": b, "call rise": fmt(t[b]["call"]["rise"]), "call fall": fmt(t[b]["call"]["fall"]),
                              "high rise": fmt(t[b]["high"]["rise"]), "high fall": fmt(t[b]["high"]["fall"])}
                             for b in BANDS]).set_index("band")

    alert_text = (f"**Alert → {pick[0]} at {pick[1]}.**" if pick else
                  f"**Alert → no arm reaches precision {ALERT_PRECISION} in both bands at any threshold.**")
    lines += [
        "## Decisions", "",
        "**Trend-word label rule:** flat5 unless the pct arm has higher classifier precision at the regression's "
        "call rate (each arm's own band table) in both the 30-60 and >60 bands, for both directions at T+30 and "
        "T+60, and is not worse in 15-25. flat10 is a reference row only.", "",
    ]
    lines += [f"- {r}" for r in label_reasons]
    lines += ["", f"**Trend label → {label} ({ARMS[label]}).**", "",
              f"**Thresholds (T+30, from the {label} classifiers; these ship):** tau_call = the probability at which the "
              "classifier calls as often as today's regression in that band; tau_high = precision reaches "
              f"{HIGH_PRECISION}. n/a never fires.", "",
              _table(tau_block(thr30)), "",
              "T+60 thresholds, for reference only (the word uses T+30):", "",
              _table(tau_block(thr60)), "",
              f"**Alert rule:** the (arm, threshold) with own-label precision >= {ALERT_PRECISION} in both the 15-25 "
              "and 30-60 bands at the highest call rate over those rows; the deployed reversion model competes.", ""]
    lines += [f"- {r}" for r in alert_reasons]
    lines += ["", alert_text, ""]
    constants = {
        "classifier_labels": {"fall": ARMS[label], "rise": ARMS[label]},
        "trend_thresholds": thr30,
        "alert": ({"field": "p_rise_30", "threshold": pick[1], "min_current_wait": 10} if pick else None),
        "alert_arm": pick[0] if pick else None,
    }
    lines += ["Constants for `RECIPE_B` (alert_arm is informational):", "", "```python",
              json.dumps(constants, indent=2), "```", ""]

    out = REPO / "reports" / "eval" / f"{date.today().isoformat()}_session5-classifiers.md"
    out.write_text("\n".join(lines))
    print("\n".join(lines[lines.index("## Decisions"):]))
    print(f"Wrote {out.relative_to(REPO)} in {time.time() - started:.0f}s total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
