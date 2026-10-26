"""Session 6 feature batch: five review candidates, each as an arm against
recipe B on the forward scoreboard.

Spec: ~/.claude/specs/line-wait-ml/session6-feature-batch.md.

  F1   + n_operating_rides_park, n_headliners_down (trajectory, classifiers, day-profile)
  F2   + last_updated_age_min, posting_tier_cat     (trajectory, classifiers)
  F3   + ll_offset_min, ll_state_cat                (trajectory, classifiers);
       also scored on Lightning Lane rides only (any non-NONE ll_state in train)
  F4   + lags_missing, trained on the filled lags and the widened
       training_valid_tN_f rows; scored on the original rows and, separately,
       on the reopen rows (valid only under the widened mask) against persistence
  F5a  + water_ride_x_temp (day-profile only)
  F5b  + soak_ride_x_temp  (day-profile only; Grizzly, Tiana's, Pirates)

Every arm: evaluate.run(df, recipe=RECIPE_B, compare=arm), forward split, last
4 weeks, horizons 30/60/120/240, identical rows, paired per day. Headliners and
posting tiers are fit on the forward-split train rows only.

Gate (spec): an arm WINS when
  - trajectory: 'B wins' (the arm) at T+60 and not 'A wins' (recipe B) at
    T+30, T+120, T+240;
  - classifiers: p_fall_60 and p_rise_60 top-decile precision not lower by more
    than 0.01 and AUC not lower (compared at 3 decimals);
  - day-profile: not 'A wins'; F5 arms need 'B wins' there instead of the
    trajectory criteria (their trajectory is recipe B's, unchanged).
  F4 may also win on coverage: not 'A wins' at any horizon on the original
  rows, the classifier criteria, and on the reopen rows not worse than
  persistence (paired verdict) at T+30, T+60 and T+120.
Otherwise FLAT. Every arm is measured; what ships stops at the first FLAT in
the order F1, F2, F3, F4, F5 (spec decision 2). F5 counts as won when either
arm wins (both -> the larger day-profile improvement).

    .venv/bin/python -m ml.experiments.session6_features [--smoke] [--cache-dir DIR]

Reads df_features_cache.pkl (refuses if missing or older than df_cache.pkl),
writes reports/eval/<today>_session6-features.md (--smoke: tiny models,
horizons 30/60, report into the cache dir). Never touches models/.
--cache-dir keeps each finished arm's tables as JSON so a rerun resumes.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parents[2]
for p in (REPO, REPO / "cron"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from ml import evaluate, metrics  # noqa: E402
from ml.features import F4_SUFFIX, add_session6_features, coverage, fit_sidecars  # noqa: E402
from ml.recipes import RECIPE_B, Recipe, with_  # noqa: E402
from ml.report import _table  # noqa: E402
from ml.splits import forward_split  # noqa: E402

FRAME = REPO / "df_features_cache.pkl"
RAW_CACHE = REPO / "df_cache.pkl"
HORIZONS = [30, 60, 120, 240]
GATE_HORIZON = 60
GUARD_HORIZONS = (30, 120, 240)
REOPEN_HORIZONS = (30, 60, 120)
GATE_CLASSIFIERS = ("p_fall_60", "p_rise_60")
TOP_DECILE_SLACK = 0.01
AUC_DECIMALS = 3
ORDER = ["F1", "F2", "F3", "F4", "F5"]
F1_COLS = ("n_operating_rides_park", "n_headliners_down")
F2_COLS = ("last_updated_age_min", "posting_tier_cat")
F3_COLS = ("ll_offset_min", "ll_state_cat")
F4_COLS = ("lags_missing",)
DESCRIPTIONS = {
    "F1": "+ n_operating_rides_park, n_headliners_down (trajectory, classifiers, day-profile)",
    "F2": "+ last_updated_age_min, posting_tier_cat (trajectory, classifiers)",
    "F3": "+ ll_offset_min, ll_state_cat (trajectory, classifiers)",
    "F4": "+ lags_missing; filled lags, widened training_valid_tN_f rows (trajectory, classifiers)",
    "F5a": "+ water_ride_x_temp (day-profile only)",
    "F5b": "+ soak_ride_x_temp (day-profile only)",
}


def arms(base: Recipe = RECIPE_B) -> dict[str, Recipe]:
    t, d = base.trajectory_features, base.day_profile_features
    return {
        "F1": with_(base, name="F1", trajectory_features=t + F1_COLS, day_profile_features=d + F1_COLS),
        "F2": with_(base, name="F2", trajectory_features=t + F2_COLS),
        "F3": with_(base, name="F3", trajectory_features=t + F3_COLS),
        "F4": with_(base, name="F4", trajectory_features=t + F4_COLS),
        "F5a": with_(base, name="F5a", day_profile_features=d + ("water_ride_x_temp",)),
        "F5b": with_(base, name="F5b", day_profile_features=d + ("soak_ride_x_temp",)),
    }


def _load() -> pd.DataFrame:
    if not FRAME.exists():
        print(f"{FRAME.name} not found at the repo root; run the notebook's DUMP cell first.")
        sys.exit(2)
    if RAW_CACHE.exists() and FRAME.stat().st_mtime < RAW_CACHE.stat().st_mtime:
        print(f"{FRAME.name} is older than {RAW_CACHE.name}; re-run the notebook through the DUMP cell first.")
        sys.exit(2)
    t0 = time.time()
    df = pd.read_pickle(FRAME)
    print(f"Loaded {FRAME.name}: {df.shape} in {time.time() - t0:.1f}s", flush=True)
    return df


def _tiny(r: Recipe) -> Recipe:
    small = dict(n_estimators=5, num_leaves=15)
    return with_(r, trajectory_params={**r.trajectory_params, **small},
                 day_profile_params={**r.day_profile_params, **small},
                 classifier_params={**(r.classifier_params or {}), **small})


# ── Per-arm tables ───────────────────────────────────────────────────────────

def classifier_table(res, name: str) -> pd.DataFrame:
    rows = []
    for clf in ("p_fall_30", "p_fall_60", "p_rise_30", "p_rise_60"):
        b, a = res.classifiers.get(clf), res.classifiers.get(f"{name}:{clf}")
        if b is None or a is None:
            continue
        rows.append({"classifier": clf, "n": b["n"], "base_rate": b["base_rate"],
                     "B_auc": b["auc"], f"{name}_auc": a["auc"],
                     "B_ap": b["ap"], f"{name}_ap": a["ap"],
                     "B_top_decile": b["top_decile_precision"], f"{name}_top_decile": a["top_decile_precision"],
                     "top_decile_change": a["top_decile_precision"] - b["top_decile_precision"]})
    return pd.DataFrame(rows).set_index("classifier")


def ll_subset_table(df, res, name: str, ll_rides: set[str], horizons) -> pd.DataFrame:
    """recipe comparison restricted to Lightning Lane rides (same rows otherwise)."""
    out = []
    for h in horizons:
        preds = res.preds[h]
        idx = preds[f"recipe_{name}"].index
        idx = idx[df.loc[idx, "ride_id"].isin(ll_rides).to_numpy()]
        rows = pd.Series(False, index=df.index)
        rows[idx] = True
        y = df[f"target_t{h}"]
        a, b = preds["recipe_B"].reindex(df.index), preds[f"recipe_{name}"].reindex(df.index)
        pair = metrics.paired_daily(df, rows, y, b, a)
        row = evaluate._comparison_row(h, metrics.mae(y[rows], a[rows]), metrics.mae(y[rows], b[rows]), pair)
        row["n_rows"] = int(rows.sum())
        out.append(row)
    return pd.DataFrame(out).set_index("horizon")


def reopen_table(df, res, name: str) -> pd.DataFrame:
    """The arm vs persistence on the rows valid only under the widened mask."""
    out = []
    col = f"recipe_{name}"
    for h, w in sorted(res.widened.items()):
        rows = pd.Series(False, index=df.index)
        rows[w.index] = True
        y = df[f"target_t{h}"]
        p_arm, p_pers = w[col].reindex(df.index), w["persistence"].reindex(df.index)
        pair = metrics.paired_daily(df, rows, y, p_arm, p_pers)
        # paired_daily(arm, persistence): evaluate.verdict's 'B wins' is side a (the arm).
        v = {"B wins": f"{name} wins", "A wins": "persistence wins"}.get(evaluate.verdict(pair), "noise")
        out.append({"horizon": h, "n_rows": int(rows.sum()),
                    "persistence_mae": metrics.mae(y[rows], p_pers[rows]), f"{name}_mae": metrics.mae(y[rows], p_arm[rows]),
                    "paired_mean": pair["mean"], "half_width_95": pair["half_width_95"],
                    f"wins_{name}": pair["wins_a"], "wins_persistence": pair["wins_b"],
                    "sign_test_p": pair["sign_test_p"], "verdict": v})
    return pd.DataFrame(out).set_index("horizon") if out else pd.DataFrame()


def per_ride(by_ride: pd.DataFrame, name: str) -> pd.DataFrame:
    b = f"recipe_{name}"
    t = by_ride[["n", "persistence", "recipe_B", "lift_recipe_B", b, f"lift_{b}"]].copy()
    t[f"{name}_minus_B"] = t[b] - t["recipe_B"]
    t[f"{name}_vs_B_pct"] = ((t["recipe_B"] - t[b]) / t["recipe_B"] * 100).where(t["recipe_B"] >= 1.0)
    return t.sort_values(f"{name}_minus_B", ascending=False)


# ── Gate ─────────────────────────────────────────────────────────────────────

def gate(name: str, comp: pd.DataFrame, clf: pd.DataFrame, reopen: pd.DataFrame | None) -> dict:
    v = comp["verdict"]
    day_profile_arm = name.startswith("F5")
    row = {"arm": name}
    if day_profile_arm:
        row["traj_T+60_win"] = "n/a (unchanged)"
        row["traj_no_loss"] = "pass" if not (v.drop("day_profile") == "A wins").any() else "FAIL"
    else:
        row["traj_T+60_win"] = "pass" if v.get(GATE_HORIZON) == "B wins" else "FAIL"
        row["traj_no_loss"] = "pass" if all(v.get(h) != "A wins" for h in GUARD_HORIZONS) else "FAIL"
    clf_ok = True
    for c in GATE_CLASSIFIERS:
        if c not in clf.index:
            row[f"{c}_ok"] = "n/a"
            continue
        r = clf.loc[c]
        top_ok = r[f"{name}_top_decile"] >= r["B_top_decile"] - TOP_DECILE_SLACK
        auc_ok = round(r[f"{name}_auc"], AUC_DECIMALS) >= round(r["B_auc"], AUC_DECIMALS)
        ok = bool(top_ok and auc_ok)
        clf_ok &= ok
        row[f"{c}_ok"] = "pass" if ok else ("FAIL (top)" if not top_ok else "FAIL (auc)")
    dp = v.get("day_profile")
    if day_profile_arm:
        row["day_profile"] = "pass" if dp == "B wins" else f"FAIL ({dp})"
        dp_ok = dp == "B wins"
    else:
        row["day_profile"] = "pass" if dp != "A wins" else "FAIL (A wins)"
        dp_ok = dp != "A wins"
    traj_ok = row["traj_no_loss"] == "pass" and (day_profile_arm or row["traj_T+60_win"] == "pass")
    win = traj_ok and clf_ok and dp_ok
    verdict = "WIN" if win else "FLAT"
    if name == "F4":
        no_loss_any = all(v.get(h) != "A wins" for h in HORIZONS if h in v.index)
        reopen_ok = reopen is not None and len(reopen) > 0 and all(
            reopen.loc[h, "verdict"] != "persistence wins" for h in REOPEN_HORIZONS if h in reopen.index)
        row["reopen_vs_persistence"] = "pass" if reopen_ok else "FAIL"
        if not win and no_loss_any and clf_ok and dp_ok and reopen_ok:
            verdict = "WIN (coverage)"
    else:
        row["reopen_vs_persistence"] = ""
    row["verdict"] = verdict
    return row


def decide(gates: pd.DataFrame, tables: dict) -> tuple[list[str], list[str], list[str]]:
    """(shipped candidates in order, blocked-by-stop-rule winners, reasons)."""
    won = {}
    for cand in ORDER:
        names = [cand] if cand != "F5" else ["F5a", "F5b"]
        wins = [n for n in names if n in gates.index and gates.loc[n, "verdict"] != "FLAT"]
        if len(wins) > 1:
            wins = [min(wins, key=lambda n: tables[n].loc["day_profile", "paired_mean"])]
        won[cand] = wins[0] if wins else None
    shipped, blocked, reasons, stopped = [], [], [], None
    for cand in ORDER:
        arm = won[cand]
        if stopped is None and arm is None:
            stopped = cand
            reasons.append(f"{cand}: FLAT -> the round stops here (spec decision 2); later winners do not ship.")
        elif stopped is None:
            shipped.append(arm)
            reasons.append(f"{cand}: arm {arm} {gates.loc[arm, 'verdict']} -> ships in recipe C.")
        elif arm is not None:
            blocked.append(arm)
            reasons.append(f"{cand}: arm {arm} {gates.loc[arm, 'verdict']}, but after the first flat ({stopped}) -> "
                           "does not ship this round.")
        else:
            reasons.append(f"{cand}: FLAT.")
    return shipped, blocked, reasons


def recipe_c(all_arms: dict[str, Recipe], shipped: list[str]) -> Recipe | None:
    if not shipped:
        return None
    traj, dp, sidecars = RECIPE_B.trajectory_features, RECIPE_B.day_profile_features, []
    for name in shipped:
        a = all_arms[name]
        traj += tuple(c for c in a.trajectory_features if c not in traj)
        dp += tuple(c for c in a.day_profile_features if c not in dp)
    if "F1" in shipped:
        sidecars.append("headliners.json")
    if "F2" in shipped:
        sidecars.append("posting_tiers.json")
    return with_(RECIPE_B, name="C", trajectory_features=traj, day_profile_features=dp, sidecars=tuple(sidecars))


# ── Cache ────────────────────────────────────────────────────────────────────

def _save(cache: Path | None, name: str, payload: dict) -> None:
    if cache is None:
        return
    cache.mkdir(parents=True, exist_ok=True)
    data = {k: (v.to_json(orient="split", default_handler=str) if isinstance(v, pd.DataFrame) else v)
            for k, v in payload.items()}
    (cache / f"{name}.json").write_text(json.dumps(data))


def _restore(cache: Path | None, name: str) -> dict | None:
    if cache is None or not (cache / f"{name}.json").exists():
        return None
    from io import StringIO

    data = json.loads((cache / f"{name}.json").read_text())
    out = {}
    for k, v in data.items():
        if isinstance(v, str) and v.startswith("{\"columns\""):
            t = pd.read_json(StringIO(v), orient="split")
            if k in ("comparison", "ll_subset", "reopen"):
                t.index = [int(i) if str(i).isdigit() else i for i in t.index]
                t.index.name = "horizon"
            out[k] = t
        else:
            out[k] = v
    return out


def run_arm(df, cats, name: str, arm: Recipe, horizons, ll_rides: set[str], primary: Recipe) -> dict:
    t0 = time.time()
    res = evaluate.run(
        df, *cats, weeks=4, horizons=horizons, run_staleness=False, write_report=False, label=name,
        model_dir="does-not-exist", recipe=primary, compare=arm,
        valid_suffix=F4_SUFFIX if name == "F4" else "",
    )
    out = {"comparison": res.recipe_comparison, "classifiers": classifier_table(res, name),
           "headline": res.headline, "seconds": time.time() - t0}
    if GATE_HORIZON in horizons:
        out["by_ride60"] = per_ride(res.by_ride[GATE_HORIZON], name)
    if name == "F3":
        out["ll_subset"] = ll_subset_table(df, res, name, ll_rides, horizons)
    if name == "F4":
        out["reopen"] = reopen_table(df, res, name)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true", help="tiny models, horizons 30/60, report into --cache-dir")
    ap.add_argument("--cache-dir", default=None)
    ap.add_argument("--arms", default=None, help="comma list (default: all)")
    args = ap.parse_args(argv)
    horizons = [30, 60] if args.smoke else HORIZONS
    cache = Path(args.cache_dir) if args.cache_dir else None

    started = time.time()
    df = _load()
    cats = (df.attrs["RIDE_ID_CATEGORIES"], df.attrs["STATUS_CATEGORIES"])
    train, test = forward_split(df, weeks=4)
    t0 = time.time()
    heads, tiers = fit_sidecars(df, train)
    df = add_session6_features(df, heads, tiers)
    print(f"Session 6 features derived in {time.time() - t0:.0f}s: {len(heads)} headliners, "
          f"{sum(v == 'automated' for v in tiers.values())} automated / "
          f"{sum(v == 'hand' for v in tiers.values())} hand-posted rides", flush=True)

    tv60 = df["training_valid_t60"].astype(bool)
    cov = coverage(df, tv60)
    cov_test = coverage(df, tv60 & test)
    print("\nCoverage on training_valid_t60 rows (all days):")
    with pd.option_context("display.width", 220, "display.max_colwidth", 80):
        print(cov)
    reopen_counts = pd.DataFrame([{
        "horizon": h,
        "training_valid": int(df[f"training_valid_t{h}"].sum()),
        "widened": int(df[f"training_valid_t{h}{F4_SUFFIX}"].sum()),
        "reopen_rows": int((df[f"training_valid_t{h}{F4_SUFFIX}"] & ~df[f"training_valid_t{h}"]).sum()),
        "reopen_rows_test": int((df[f"training_valid_t{h}{F4_SUFFIX}"] & ~df[f"training_valid_t{h}"] & test).sum()),
    } for h in HORIZONS]).set_index("horizon")
    prev_status = df.groupby(["ride_id", "date_la"], sort=False)["status"].shift(1)
    lm = df["lags_missing"].astype(bool)
    reopen_after = prev_status[lm].fillna("none (first poll of day)").value_counts()
    print("\nF4 rows:\n", reopen_counts, "\nlags_missing rows by previous poll's status:\n", reopen_after, flush=True)
    ll_rides = set(df.loc[train & (df["ll_state_cat"].astype(object) != "NONE"), "ride_id"].unique())
    print(f"Lightning Lane rides (non-NONE ll_state in train): {len(ll_rides)}", flush=True)

    primary = _tiny(RECIPE_B) if args.smoke else RECIPE_B
    all_arms = arms(primary)
    if args.smoke:
        all_arms = {k: with_(_tiny(v), name=k) for k, v in all_arms.items()}
    selected = args.arms.split(",") if args.arms else list(all_arms)

    results = {}
    for name in selected:
        cached = _restore(cache, name)
        if cached is not None:
            results[name] = cached
            print(f"\n== {name}: restored from {cache}", flush=True)
            continue
        print(f"\n== {name}: {DESCRIPTIONS[name]} (started {time.strftime('%H:%M:%S')})", flush=True)
        results[name] = run_arm(df, cats, name, all_arms[name], horizons, ll_rides, primary)
        _save(cache, name, results[name])
        print(f"   {name} done in {results[name]['seconds']:.0f}s", flush=True)
        with pd.option_context("display.width", 220, "display.float_format", "{:.3f}".format):
            print(results[name]["comparison"])
            print(results[name]["classifiers"])
            for k in ("ll_subset", "reopen"):
                if k in results[name]:
                    print(results[name][k])

    tables = {n: r["comparison"] for n, r in results.items()}
    gates = pd.DataFrame([gate(n, r["comparison"], r["classifiers"], r.get("reopen"))
                          for n, r in results.items()]).set_index("arm")
    print("\nGATE")
    with pd.option_context("display.width", 220):
        print(gates)
    shipped, blocked, reasons = decide(gates, tables)
    final = recipe_c(all_arms, shipped)

    # ── Report ───────────────────────────────────────────────────────────────
    lines = [
        f"# Session 6 feature batch — {date.today().isoformat()}",
        "",
        f"- Frame: `{FRAME.name}` {df.shape[0]:,} rows, {df['date_la'].min()} to {df['date_la'].max()}"
        + (" (**SMOKE RUN: tiny models, not a result**)" if args.smoke else ""),
        f"- Forward split, 4 weeks: train {int(df.loc[train, 'date_la'].nunique())} days, "
        f"test {int(df.loc[test, 'date_la'].nunique())} days. Horizons {horizons}.",
        "- Every arm is scored against recipe B (live since 2026-10-24) on identical rows. In the tables, "
        "'A' is recipe B and 'B' is the arm: paired_mean = mean daily MAE(arm) − MAE(recipe B); negative = arm "
        "better; verdict 'B wins' = the arm wins. day_profile rows are serving-style (crowd values and, for F1, "
        "the operating counts at each day's 13:00 poll, as `_build_full_day` feeds them).",
        f"- Headliners (median OPERATING wait >= 30, train rows): {len(heads)}. Posting tiers (median "
        f"lastUpdated age <= 5 min on OPERATING train rows = automated): "
        f"{sum(v == 'automated' for v in tiers.values())} automated, {sum(v == 'hand' for v in tiers.values())} hand.",
        f"- Lightning Lane rides (any non-NONE ll_state in train): {len(ll_rides)}.",
        f"- Run time: {', '.join(f'{k} {r['seconds']:.0f}s' for k, r in results.items())}; "
        f"arms total {sum(r['seconds'] for r in results.values()):.0f}s (feature derivation and loading excluded).",
        "",
        "## Coverage (training_valid_t60 rows, all days)", "",
        "non_null = share with a value; informative = share with a value other than 0 / NONE. lags_missing is 0 "
        "on these rows by construction (they have all three lags); its rows are the F4 counts below.", "",
        _table(cov), "",
        "Test window only (training_valid_t60 & test days):", "",
        _table(cov_test), "",
        "### F4 row counts", "",
        "reopen_rows = OPERATING rows with a wait and a target whose lags were null (filled with the current wait, "
        "lags_missing = 1): valid under training_valid_tN_f only.", "",
        _table(reopen_counts), "",
        "lags_missing rows by the previous poll's status (same ride, same day):", "",
        _table(reopen_after.rename("rows").to_frame()), "",
    ]
    for name, r in results.items():
        lines += [f"## {name}: {DESCRIPTIONS[name]}", "", "### Recipe comparison", "", _table(r["comparison"]), "",
                  "### Classifiers (recipe B vs arm, same rows)", "", _table(r["classifiers"]), ""]
        if "ll_subset" in r:
            lines += ["### Lightning Lane rides only", "",
                      "Same models and rows, restricted to the LL rides. Trajectory only.", "",
                      _table(r["ll_subset"]), ""]
        if "reopen" in r:
            lines += ["### Reopen rows vs persistence", "",
                      "Rows valid only under the widened mask (test days). Recipe B has no prediction here "
                      "(today these rides are tombstoned), so persistence is the only baseline. paired_mean = "
                      "mean daily MAE(F4) − MAE(persistence).", "",
                      _table(r["reopen"]), ""]
    lines += [
        "## Gate", "",
        "traj_T+60_win: 'B wins' (the arm) at T+60. traj_no_loss: not 'A wins' (recipe B) at T+30/120/240 "
        "(F5: at any horizon; their trajectory is recipe B's). p_*_60_ok: top-decile precision not lower by more "
        f"than {TOP_DECILE_SLACK} and AUC not lower at {AUC_DECIMALS} decimals. day_profile: not 'A wins' "
        "(F5: must be 'B wins'). F4 'WIN (coverage)': no 'A wins' at any horizon, classifiers ok, and not worse "
        "than persistence on the reopen rows at T+30/60/120.", "",
        _table(gates), "",
    ]
    for name in results:
        if name in gates.index and gates.loc[name, "verdict"] != "FLAT" and "by_ride60" in results[name]:
            lines += [f"## Per-ride T+60: {name} vs recipe B", "",
                      f"MAE in minutes; lift_* is % vs persistence; {name}_minus_B > 0 = arm worse; "
                      f"{name}_vs_B_pct blank when recipe B's MAE < 1.0.", "",
                      _table(results[name]["by_ride60"]), ""]

    lines += ["## Decisions", ""]
    lines += [f"- {r}" for r in reasons]
    lines += [""]
    closed = []
    for name, r in results.items():
        if gates.loc[name, "verdict"] == "FLAT":
            c = r["comparison"]
            cells = "; ".join(f"T+{h} {c.loc[h, 'paired_mean']:+.3f} ± {c.loc[h, 'half_width_95']:.3f} "
                              f"({c.loc[h, 'verdict']})" for h in c.index if h != "day_profile")
            dpc = c.loc["day_profile"]
            clf = r["classifiers"]
            ctext = "; ".join(f"{k} AUC {clf.loc[k, 'B_auc']:.3f}→{clf.loc[k, f'{name}_auc']:.3f}, top-decile "
                              f"{clf.loc[k, 'B_top_decile']:.3f}→{clf.loc[k, f'{name}_top_decile']:.3f}"
                              for k in GATE_CLASSIFIERS if k in clf.index)
            fails = ", ".join(k for k, v in gates.loc[name].items() if str(v).startswith("FAIL"))
            closed.append(f"- **{name}** ({DESCRIPTIONS[name]}): FLAT on {fails or 'the gate'}. Forward numbers "
                          f"(paired mean daily MAE arm − B, ± 95% half-width): {cells}; day-profile "
                          f"{dpc['paired_mean']:+.3f} ± {dpc['half_width_95']:.3f} ({dpc['verdict']}). {ctext}.")
    if closed:
        lines += ["**Closed candidates (for `ml_feature_gaps.md`):**", ""] + closed + [""]
    if blocked:
        lines += [f"**Won but blocked by the stop rule:** {', '.join(blocked)}. Not in recipe C; the owner "
                  "decides whether to ship it anyway or re-test it in the next round.", ""]
    if final is None:
        lines += ["**No winner ships: RECIPE_C is not created; serving and export are unchanged.**", ""]
    else:
        lines += [
            f"**Recipe C = recipe B + {', '.join(shipped)}.**", "", "```python",
            f"trajectory_features  = {list(final.trajectory_features)!r}  # {len(final.trajectory_features)}",
            f"day_profile_features = {list(final.day_profile_features)!r}  # {len(final.day_profile_features)}",
            "classifier_features  = trajectory_features (mirrored)",
            f"sidecars             = {list(final.sidecars)!r}",
            "```", "",
        ]
        if "F4" in shipped:
            lines += ["F4 ships: recipe C trains on the filled lags and the widened rows "
                      "(`fill_lags=True`), and serving fills missing lags instead of tombstoning.", ""]

    out_dir = (cache or Path(".")) if args.smoke else REPO / "reports" / "eval"
    out = out_dir / f"{date.today().isoformat()}_session6-features.md"
    out.write_text("\n".join(lines))
    print("\n".join(lines[lines.index("## Decisions"):]))
    print(f"Wrote {out} in {time.time() - started:.0f}s total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
