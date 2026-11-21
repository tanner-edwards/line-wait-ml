"""Session 7 model bake-off: other model families scored on the decision, not the forecast.

The question every arm answers, at every test row (a ride, a moment):
"go now, or hold off until the time in the next 2 hours you think is lowest?"

Assumptions (agreed 2026-11-20): walk time is a constant, so it is zero here;
the posted wait IS the wait (no actual-wait modelling). A jump after you join a
line costs nothing, because you locked in the posted wait. The only way to win
or lose is the hold-off call.

Decision rule (same for every arm): from the arm's level forecasts at
T+10/20/30/40/50/60/90/120, take the lowest (earliest on ties). If it is at
least HOLD_THRESHOLD (10) minutes below the current wait, HOLD OFF until that
time; otherwise GO NOW.

Scoring, in posted minutes, versus "go now" (persistence = trust the posted
wait = Disney's app, scores exactly 0):
  saved   = hold off and the wait at the picked time was lower than now  (now - actual_at_pick)
  wasted  = hold off and it was not lower                                (actual_at_pick - now)
  missed  = went now, but the wait really did drop >= 10 within 2 hours  (now - actual_min)
  net     = (saved - wasted) / decisions  -> the headline, higher is better
  oracle  = mean max(0, now - actual_min): the most any model could net.

Winner: paired daily test of net minutes saved per decision vs the incumbent
(LightGBM recipe C), same as the scoreboard's verdict rule.

Decision rows: forward-split test days, status OPERATING, current wait known,
and training_valid_tN at every window horizon (the 2-hour future exists).

Arms
  persistence      go now always (0 by definition)
  lookup_delta     current + typical change for (ride, hour, day type)
  lgbm_C           incumbent: recipe C, delta target, L1, 600 x 63
  lgbm_C_l2        recipe C with L2 loss (predicts the mean, not the median)
  xgb              XGBoost, same features/target, L1 loss, 600 x 63 leaves
  catboost         CatBoost, same features/target, MAE loss, depth 8
  ridge            linear model on the same features (one-hot rides, imputed)
  gru              PyTorch: GRU over the ride's last 2 hours of waits + the
                   static features, one network predicting all 8 horizons
  ens_trees        mean of lgbm_C, xgb, catboost
  ens_all          mean of lgbm_C, xgb, catboost, gru

    .venv/bin/python ml/experiments/session7_bakeoff.py [--smoke] [--cache-dir DIR] [--arms a,b]

Reads df_features_cache.pkl, writes reports/eval/<today>_session7-bakeoff.md
(run as a file, not with -m: ml/__init__ imports lightgbm before torch;
--smoke: tiny models, report into the cache dir). Never touches models/.
--cache-dir keeps each finished arm's predictions so a rerun resumes.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path

# torch and lightgbm/xgboost each bring an OpenMP runtime, and on macOS they
# cannot share a process: lightgbm-then-torch segfaults on the first tensor copy,
# torch-then-lightgbm segfaults in the first fit (verified 2026-11-20). So the gru
# arm always trains in a child process (`--arms gru`, torch imported first,
# before ml/__init__ pulls in lightgbm) and hands its predictions back via the cache.
if __name__ == "__main__" and sys.argv[1:3] == ["--arms", "gru"]:
    import torch  # noqa: F401  isort: skip

import numpy as np
import pandas as pd
from scipy.stats import binomtest

REPO = Path(__file__).resolve().parents[2]
for p in (REPO, REPO / "cron"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from ml import baselines, metrics, recipes  # noqa: E402
from ml.recipes import RECIPE_C, with_  # noqa: E402
from ml.report import _table  # noqa: E402
from ml.splits import forward_split, wait_band  # noqa: E402

FRAME = REPO / "df_features_cache.pkl"
H = [10, 20, 30, 40, 50, 60, 90, 120]
HOLD_THRESHOLD = 10.0
INCUMBENT = "lgbm_C"
SEQ_LEN = 12  # GRU history: 12 polls = 2 hours
TREE_ARMS = ["lgbm_C", "xgb", "catboost"]
ALL_ARMS = ["lookup_delta", "lgbm_C", "lgbm_C_l2", "xgb", "catboost", "ridge", "gru", "ens_trees", "ens_all"]
FEATURES = list(RECIPE_C.trajectory_features)
CATS = recipes.cat_features(FEATURES)
NUMERIC = [c for c in FEATURES if c not in CATS]


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ── Data ─────────────────────────────────────────────────────────────────────

def load() -> pd.DataFrame:
    if not FRAME.exists():
        sys.exit(f"{FRAME.name} not found; run the notebook's DUMP cell first.")
    df = pd.read_pickle(FRAME)
    df = df.sort_values(["ride_id", "timestamp_utc"]).reset_index(drop=True)
    log(f"Loaded {FRAME.name}: {df.shape}")
    return df


def decision_rows(df: pd.DataFrame, test: pd.Series) -> pd.Series:
    rows = test & (df["status"] == "OPERATING") & df["wait_minutes"].notna()
    for h in H:
        rows &= df[f"training_valid_t{h}"].astype(bool)
    return rows


def matrix(df: pd.DataFrame, rows: pd.Series, cats) -> pd.DataFrame:
    return recipes._features(df, rows, FEATURES, *cats)


# ── Arms: each returns a DataFrame (index = decision rows, columns = H) of levels ──

def arm_lookup(df, train, dec, cats, smoke):
    return pd.DataFrame({h: baselines.lookup_delta(df, train, h)[dec] for h in H})


def _per_horizon(df, train, dec, cats, smoke, fit_predict):
    out = {}
    Xd = matrix(df, dec, cats)
    now = df.loc[dec, "wait_minutes"].to_numpy(float)
    for h in H:
        rows = train & df[f"training_valid_t{h}"].astype(bool)
        if smoke:
            rows &= pd.Series(np.random.default_rng(h).random(len(df)) < 0.05, index=df.index)
        X = matrix(df, rows, cats)
        y = (df.loc[rows, f"target_t{h}"] - df.loc[rows, "wait_minutes"]).to_numpy(float)
        t0 = time.time()
        delta = fit_predict(X, y, Xd)
        out[h] = np.clip(now + delta, 0, None)
        log(f"  T+{h}: {len(y):,} train rows, {time.time() - t0:.0f}s")
    return pd.DataFrame(out, index=Xd.index)


def _lgbm(params):
    import lightgbm as lgb

    def fp(X, y, Xd):
        m = lgb.LGBMRegressor(**params)
        m.fit(X, y, categorical_feature=CATS)
        return m.predict(Xd)
    return fp


def arm_lgbm_C(df, train, dec, cats, smoke):
    p = dict(RECIPE_C.trajectory_params, **({"n_estimators": 20} if smoke else {}))
    return _per_horizon(df, train, dec, cats, smoke, _lgbm(p))


def arm_lgbm_C_l2(df, train, dec, cats, smoke):
    p = dict(RECIPE_C.trajectory_params, objective="regression", **({"n_estimators": 20} if smoke else {}))
    return _per_horizon(df, train, dec, cats, smoke, _lgbm(p))


def arm_xgb(df, train, dec, cats, smoke):
    import xgboost as xgb

    def fp(X, y, Xd):
        m = xgb.XGBRegressor(
            n_estimators=20 if smoke else 600, learning_rate=0.05, max_leaves=63, max_depth=0,
            grow_policy="lossguide", tree_method="hist", objective="reg:absoluteerror",
            enable_categorical=True, max_cat_to_onehot=1, n_jobs=-1, random_state=0)
        m.fit(X, y)
        return m.predict(Xd)
    return _per_horizon(df, train, dec, cats, smoke, fp)


def _cb_frame(X: pd.DataFrame) -> pd.DataFrame:
    X = X.copy()
    for c in CATS:
        X[c] = X[c].astype(object).where(X[c].notna(), "nan").astype(str)
    return X


def arm_catboost(df, train, dec, cats, smoke):
    from catboost import CatBoostRegressor

    def fp(X, y, Xd):
        m = CatBoostRegressor(iterations=20 if smoke else 800, learning_rate=0.1, depth=8,
                              loss_function="MAE", thread_count=-1, random_seed=0, verbose=0)
        m.fit(_cb_frame(X), y, cat_features=CATS)
        return m.predict(_cb_frame(Xd))
    return _per_horizon(df, train, dec, cats, smoke, fp)


class _Prep:
    """Train-fit numeric imputation + scaling (+ missing flags) and category codes."""

    def __init__(self, X: pd.DataFrame):
        num = X[NUMERIC].astype(float)
        self.med = num.median()
        self.flags = [c for c in NUMERIC if num[c].isna().any()]
        filled = num.fillna(self.med)
        self.mu, self.sd = filled.mean(), filled.std().replace(0, 1).fillna(1)

    def numeric(self, X: pd.DataFrame) -> np.ndarray:
        num = X[NUMERIC].astype(float)
        z = ((num.fillna(self.med) - self.mu) / self.sd).to_numpy(np.float32)
        f = num[self.flags].isna().to_numpy(np.float32)
        return np.hstack([z, f])

    @staticmethod
    def codes(X: pd.DataFrame) -> np.ndarray:
        # category code + 1 so NaN (-1) becomes 0
        return np.stack([X[c].cat.codes.to_numpy() + 1 for c in CATS], axis=1).astype(np.int64)


def arm_ridge(df, train, dec, cats, smoke):
    from scipy import sparse
    from sklearn.linear_model import Ridge
    from sklearn.preprocessing import OneHotEncoder

    state = {}

    def design(X, fit):
        if fit:
            state["prep"] = _Prep(X)
            state["ohe"] = OneHotEncoder(handle_unknown="ignore").fit(_Prep.codes(X))
        num = sparse.csr_matrix(state["prep"].numeric(X))
        return sparse.hstack([num, state["ohe"].transform(_Prep.codes(X))]).tocsr()

    def fp(X, y, Xd):
        m = Ridge(alpha=1.0, solver="sparse_cg")
        m.fit(design(X, True), y)
        return m.predict(design(Xd, False))
    return _per_horizon(df, train, dec, cats, smoke, fp)


def history(df: pd.DataFrame) -> np.ndarray:
    """(n_rows, SEQ_LEN) previous waits on the same ride and day, oldest first; NaN where absent."""
    g = df.groupby(["ride_id", "date_la"], sort=False)["wait_minutes"]
    return np.stack([g.shift(k).to_numpy(float) for k in range(SEQ_LEN, 0, -1)], axis=1)


def arm_gru(df, train, dec, cats, smoke):
    import torch
    from torch import nn

    torch.manual_seed(0)
    np.random.seed(0)
    dev = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    hist = history(df)

    any_valid = np.zeros(len(df), bool)
    for h in H:
        any_valid |= df[f"training_valid_t{h}"].to_numpy(bool)
    fit_rows = train & pd.Series(any_valid, index=df.index) & df["wait_minutes"].notna()
    if smoke:
        fit_rows &= pd.Series(np.random.default_rng(0).random(len(df)) < 0.05, index=df.index)
    # Validation = the last 14 train days (inside train; the test weeks stay unseen).
    last_train = df.loc[train, "date_la"].max()
    val_day = df["date_la"] > last_train - timedelta(days=14)
    val_rows = fit_rows & val_day
    tr_rows = fit_rows & ~val_day

    X_fit = matrix(df, tr_rows, cats)
    prep = _Prep(X_fit)
    n_cat = [len(X_fit[c].cat.categories) + 1 for c in CATS]

    def tensors(rows):
        X = matrix(df, rows, cats)
        now = df.loc[rows, "wait_minutes"].to_numpy(np.float32)
        hs = hist[rows.to_numpy()]
        seq = np.stack([np.nan_to_num((hs - now[:, None]) / 30.0), (~np.isnan(hs)).astype(np.float32)], axis=2)
        y = np.stack([(df.loc[rows, f"target_t{h}"].to_numpy(float) - now) / 30.0 for h in H], axis=1)
        valid = np.stack([df.loc[rows, f"training_valid_t{h}"].to_numpy(bool) for h in H], axis=1)
        y = np.where(valid, np.nan_to_num(y), 0.0)
        return [torch.tensor(a) for a in (prep.numeric(X), _Prep.codes(X), seq.astype(np.float32),
                                          y.astype(np.float32), valid.astype(np.float32))], now

    class Net(nn.Module):
        def __init__(self, n_num):
            super().__init__()
            self.embs = nn.ModuleList([nn.Embedding(n, min(16, n)) for n in n_cat])
            emb_dim = sum(min(16, n) for n in n_cat)
            self.gru = nn.GRU(2, 64, batch_first=True)
            self.mlp = nn.Sequential(
                nn.Linear(n_num + emb_dim + 64, 256), nn.ReLU(), nn.Dropout(0.1),
                nn.Linear(256, 128), nn.ReLU(), nn.Linear(128, len(H)))

        def forward(self, num, cat, seq):
            e = [emb(cat[:, i]) for i, emb in enumerate(self.embs)]
            _, hN = self.gru(seq)
            return self.mlp(torch.cat([num, *e, hN[-1]], dim=1))

    (tr, _), (va, _) = tensors(tr_rows), tensors(val_rows)
    net = Net(tr[0].shape[1]).to(dev)
    opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-5)
    epochs = 1 if smoke else 8
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=epochs * (len(tr[0]) // 4096 + 1))

    def loss_on(batch):
        num, cat, seq, y, m = (t.to(dev) for t in batch)
        return ((net(num, cat, seq) - y).abs() * m).sum() / m.sum().clamp(min=1)

    best, best_state = float("inf"), None
    for ep in range(epochs):
        net.train()
        perm = torch.randperm(len(tr[0]))
        t0 = time.time()
        for i in range(0, len(perm), 4096):
            idx = perm[i:i + 4096]
            opt.zero_grad()
            loss = loss_on([t[idx] for t in tr])
            loss.backward()
            opt.step()
            sched.step()
        net.eval()
        with torch.no_grad():
            vl = np.mean([loss_on([t[i:i + 16384] for t in va]).item() for i in range(0, len(va[0]), 16384)])
        log(f"  gru epoch {ep + 1}/{epochs}: val L1 {vl * 30:.3f} min ({time.time() - t0:.0f}s)")
        if vl < best:
            best, best_state = vl, {k: v.detach().clone() for k, v in net.state_dict().items()}
    net.load_state_dict(best_state)

    (te, now) = tensors(dec)
    net.eval()
    outs = []
    with torch.no_grad():
        for i in range(0, len(te[0]), 16384):
            num, cat, seq = (t[i:i + 16384].to(dev) for t in te[:3])
            outs.append(net(num, cat, seq).cpu().numpy())
    delta = np.concatenate(outs) * 30.0
    return pd.DataFrame(np.clip(now[:, None] + delta, 0, None), index=df.index[dec], columns=H)


ARM_FNS = {
    "lookup_delta": arm_lookup, "lgbm_C": arm_lgbm_C, "lgbm_C_l2": arm_lgbm_C_l2,
    "xgb": arm_xgb, "catboost": arm_catboost, "ridge": arm_ridge, "gru": arm_gru,
}
ENSEMBLES = {"ens_trees": TREE_ARMS, "ens_all": TREE_ARMS + ["gru"]}


# ── Scoring ──────────────────────────────────────────────────────────────────

def decide(pred: pd.DataFrame, now: pd.Series, actual: pd.DataFrame) -> pd.DataFrame:
    """Per decision row: hold (bool), pick horizon, gain (minutes saved vs go-now; negative = wasted)."""
    p = pred[H].to_numpy(float)
    a = actual[H].to_numpy(float)
    n = now.to_numpy(float)
    pick = np.argmin(p, axis=1)  # first = earliest on ties
    hold = (n - p[np.arange(len(p)), pick]) >= HOLD_THRESHOLD
    at_pick = a[np.arange(len(a)), pick]
    gain = np.where(hold, n - at_pick, 0.0)
    oracle = np.clip(n - a.min(axis=1), 0, None)
    return pd.DataFrame({"hold": hold, "pick": np.array(H)[pick], "gain": gain, "oracle": oracle},
                        index=pred.index)


def summary_row(name: str, d: pd.DataFrame) -> dict:
    hold = d["hold"]
    saved = d["gain"].where(hold & (d["gain"] > 0), 0.0)
    wasted = (-d["gain"]).where(hold & (d["gain"] <= 0), 0.0)
    missed = d["oracle"].where(~hold & (d["oracle"] >= HOLD_THRESHOLD), 0.0)
    n = len(d)
    holds = int(hold.sum())
    return {
        "arm": name,
        "net_min_per_decision": d["gain"].mean(),
        "pct_of_oracle": 100 * d["gain"].sum() / d["oracle"].sum(),
        "hold_rate_pct": 100 * holds / n,
        "hold_hit_rate_pct": 100 * (hold & (d["gain"] > 0)).sum() / holds if holds else np.nan,
        "saved_per_hold": saved.sum() / holds if holds else np.nan,
        "wasted_per_hold": wasted.sum() / holds if holds else np.nan,
        "saved_total_hrs": saved.sum() / 60,
        "wasted_total_hrs": wasted.sum() / 60,
        "missed_total_hrs": missed.sum() / 60,
    }


def paired(df: pd.DataFrame, d_arm: pd.DataFrame, d_base: pd.DataFrame) -> dict:
    """Daily mean gain(arm) - gain(base); positive = arm saves more."""
    day = df.loc[d_arm.index, "date_la"]
    diff = (d_arm["gain"] - d_base["gain"]).groupby(day).mean()
    n = len(diff)
    sd = diff.std(ddof=1)
    wins, losses = int((diff > 0).sum()), int((diff < 0).sum())
    hw = 1.96 * sd / np.sqrt(n) if n > 1 else np.nan
    p = binomtest(wins, wins + losses).pvalue if wins + losses else np.nan
    mean = diff.mean()
    sig = abs(mean) > hw or p < 0.05
    v = "arm wins" if mean > 0 and sig else ("incumbent wins" if mean < 0 and sig else "noise")
    return {"paired_mean_gain": mean, "half_width_95": hw, "days_arm_better": wins,
            "days_incumbent_better": losses, "sign_test_p": p, "verdict": v}


# ── Main ─────────────────────────────────────────────────────────────────────

def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--cache-dir", type=Path, default=None)
    ap.add_argument("--arms", default=",".join(ALL_ARMS))
    args = ap.parse_args(argv)
    want = args.arms.split(",")

    df = load()
    cats = (df.attrs["RIDE_ID_CATEGORIES"], df.attrs["STATUS_CATEGORIES"])
    train, test = forward_split(df, weeks=4)
    dec = decision_rows(df, test)
    cutoff = df.loc[train, "date_la"].max()
    log(f"Cutoff {cutoff}; {test.sum():,} test rows -> {dec.sum():,} decision rows")

    now = df.loc[dec, "wait_minutes"]
    actual = pd.DataFrame({h: df.loc[dec, f"target_t{h}"] for h in H})
    preds: dict[str, pd.DataFrame] = {"persistence": pd.DataFrame({h: now for h in H})}
    cache = args.cache_dir
    if cache:
        cache.mkdir(parents=True, exist_ok=True)

    for name in [a for a in want if a in ARM_FNS]:
        f = cache / f"{name}{'_smoke' if args.smoke else ''}.pkl" if cache else None
        if f and f.exists():
            preds[name] = pd.read_pickle(f)
            log(f"{name}: cached")
            continue
        log(f"{name}: training")
        t0 = time.time()
        if name == "gru" and want != ["gru"]:
            if not cache:
                sys.exit("the gru arm needs --cache-dir (it trains in a child process)")
            cmd = [sys.executable, "-X", "faulthandler", __file__, "--arms", "gru", "--cache-dir", str(cache)]
            subprocess.run(cmd + (["--smoke"] if args.smoke else []), check=True)
            preds[name] = pd.read_pickle(f)
            log(f"{name}: done in {time.time() - t0:.0f}s (child process)")
            continue
        preds[name] = ARM_FNS[name](df, train, dec, cats, args.smoke)
        log(f"{name}: done in {time.time() - t0:.0f}s")
        if f:
            preds[name].to_pickle(f)
    for name, members in ENSEMBLES.items():
        if name in want and all(m in preds for m in members):
            preds[name] = sum(preds[m] for m in members) / len(members)

    decisions = {k: decide(v, now, actual) for k, v in preds.items()}
    summary = pd.DataFrame([summary_row(k, d) for k, d in decisions.items()]).set_index("arm")
    oracle = decisions["persistence"]["oracle"].mean()

    comp = pd.DataFrame({k: paired(df, d, decisions[INCUMBENT])
                         for k, d in decisions.items() if k != INCUMBENT and INCUMBENT in decisions}).T
    comp.index.name = "arm"

    mae = pd.DataFrame({k: {f"T+{h}": metrics.mae(actual[h], v[h]) for h in H} for k, v in preds.items()}).T
    mae.index.name = "arm"

    band = wait_band(now)
    by_band = pd.DataFrame({k: d["gain"].groupby(band, observed=True).mean() for k, d in decisions.items()}).T
    counts = band.value_counts()
    by_band.index.name = "arm"

    hour = df.loc[dec, "hour_of_day"]
    by_hour = pd.DataFrame({k: d["gain"].groupby(hour).mean() for k, d in decisions.items()}).T

    lines = [
        "# Session 7 model bake-off — scored on the go-now / hold-off decision",
        "",
        f"- Frame: {df['date_la'].min()} to {df['date_la'].max()} ({len(df):,} rows); "
        f"cutoff {cutoff} (forward split, last 4 weeks = {df.loc[test, 'date_la'].nunique()} test days)",
        f"- Decision rows: {len(now):,} (OPERATING, wait known, full 2-hour future known)",
        f"- Rule: hold off when the arm's lowest forecast in T+10..T+120 is >= {HOLD_THRESHOLD:.0f} min under now; "
        "walk time 0; posted wait = wait",
        f"- Oracle (perfect foresight) net: **{oracle:.2f} min per decision**; "
        f"{(decisions['persistence']['oracle'] >= HOLD_THRESHOLD).mean() * 100:.1f}% of decisions had a real >=10 min dip ahead",
        f"- Wait-band row counts: {counts.to_dict()}",
        f"- Smoke run: {args.smoke}",
        "",
        "## Headline: minutes saved vs 'just go now'",
        "",
        "net = average minutes saved per decision (go-now scores 0). pct_of_oracle = share of the "
        "perfect-foresight savings captured. hit rate = share of hold-offs where the wait really was lower.",
        "",
        _table(summary.sort_values("net_min_per_decision", ascending=False)),
        "",
        f"## Paired daily test vs incumbent ({INCUMBENT})",
        "",
        "paired_mean_gain = mean over test days of (arm net - incumbent net); positive = the arm saves more. "
        "Verdict: a side wins when the mean favors it and clears the 95% half-width or the sign test p < 0.05.",
        "",
        _table(comp),
        "",
        "## Net minutes saved per decision by current wait band",
        "",
        _table(by_band),
        "",
        "## Net minutes saved per decision by hour of day",
        "",
        _table(by_hour),
        "",
        "## Sanity check: MAE (minutes) on the decision rows",
        "",
        _table(mae),
        "",
    ]
    out_dir = cache if args.smoke and cache else REPO / "reports" / "eval"
    out = out_dir / f"{date.today().isoformat()}_session7-bakeoff.md"
    out.write_text("\n".join(lines))
    log(f"Wrote {out}")
    print(summary.sort_values("net_min_per_decision", ascending=False).round(2).to_string())
    print(comp.round(3).to_string())


if __name__ == "__main__":
    main()
