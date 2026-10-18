"""Session 4 recipe experiment: which parts of recipe B beat recipe A?

Every arm is scored against Recipe A on identical forward-split rows with the
scoreboard (evaluate.run(..., recipe=RECIPE_A, compare=arm)).

  B0  A + delta trajectory target
  B1  B0 - week_of_year (trajectory features)
  B2  B1 + trajectory params 600 trees x 63 leaves
  B3  B2 + minutes_until_close (trajectory features; corrected since Session 2)
  B4  B3 with week_of_year kept (A's 21 trajectory features + minutes_until_close = 22)
  D1  A with day-profile params 600 x 63
  D2  D1 - week_of_year (day-profile features)

Trajectory arms leave day-profile at A and the D arms leave trajectory at A, so
each table isolates one change (the unchanged half is not retrained; its rows
read as exact ties).

Decision rules (revised 2026-10-18; week_of_year is now tested both ways on
both models and the holdout decides):
  trajectory  -> first of B0, B1, B2, B3 with verdict 'B wins' at T+30, T+60
                 and T+120 and not 'A wins' at T+240. If that is B2 and B3 also
                 qualifies, B3 only if its T+60 paired mean beats B2's by more
                 than B2's half-width. None -> A. Then, if the pick is B3, B4
                 replaces it only if B4 vs B3 head-to-head (same rows) is 'new
                 wins' at T+30, T+60 and T+120 and not 'old wins' at T+240;
                 otherwise B3 (dropping week_of_year stays the default).
  day-profile -> candidates are D1 and D2 with 'B wins' vs A on the day_profile
                 row. Both -> the D2-vs-D1 head-to-head verdict decides; 'noise'
                 means D2 (simpler). One -> that one. None -> A.
Why the rule changed: the first run's rule picked D2 although D1 beat it
head-to-head by 0.20 MAE on 26 of 28 days, and the B1-vs-B0 step (dropping
week_of_year) was itself a small loss at T+30 and T+120. The forward test weeks
(38-41) were unseen in training, so the holdout already measures the
extrapolation case the "week_of_year can't generalize" prior worried about.

    .venv/bin/python -m ml.experiments.session4_recipes [--horizons 30,60,120,240]

Reads df_features_cache.pkl at the repo root (refuses if it is missing or
older than df_cache.pkl), writes reports/eval/<today>_session4-recipes.md.
Never touches models/ (model_dir points at a directory that does not exist).
"""

from __future__ import annotations

import argparse
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

from ml import evaluate, metrics, recipes  # noqa: E402
from ml.recipes import RECIPE_A, Recipe, with_  # noqa: E402
from ml.report import _table  # noqa: E402
from ml.splits import forward_split  # noqa: E402

FRAME = REPO / "df_features_cache.pkl"
RAW_CACHE = REPO / "df_cache.pkl"
HORIZONS = [30, 60, 120, 240]
GATE_HORIZONS = (30, 60, 120)
GUARD_HORIZON = 240
BIG = dict(n_estimators=600, num_leaves=63, learning_rate=0.05, objective="regression_l1", verbose=-1)
CALL_OUTS = ["Radiator Springs Racers", "Haunted Mansion Holiday", "Space Mountain", "Indiana Jones"]
TRAJ_ARMS = ["B0", "B1", "B2", "B3"]   # the base rule picks among these
STEP_CHAIN = ["A", "B0", "B1", "B2", "B3"]
WEEK_ARM = "B4"                          # B3 with week_of_year kept
DP_ARMS = ["D1", "D2"]


def arms() -> dict[str, Recipe]:
    b0 = with_(RECIPE_A, name="B0", trajectory_target="delta")
    b1 = with_(b0, name="B1", trajectory_features=tuple(c for c in b0.trajectory_features if c != "week_of_year"))
    b2 = with_(b1, name="B2", trajectory_params=dict(BIG))
    b3 = with_(b2, name="B3", trajectory_features=b2.trajectory_features + ("minutes_until_close",))
    b4 = with_(b3, name="B4", trajectory_features=RECIPE_A.trajectory_features + ("minutes_until_close",))
    d1 = with_(RECIPE_A, name="D1", day_profile_params=dict(BIG))
    d2 = with_(d1, name="D2", day_profile_features=tuple(c for c in d1.day_profile_features if c != "week_of_year"))
    return {"B0": b0, "B1": b1, "B2": b2, "B3": b3, "B4": b4, "D1": d1, "D2": d2}


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


def qualifies(table: pd.DataFrame, horizons) -> bool:
    gate = all(table.loc[h, "verdict"] == "B wins" for h in GATE_HORIZONS)
    guard = GUARD_HORIZON not in horizons or table.loc[GUARD_HORIZON, "verdict"] != "A wins"
    return gate and guard


def decide_trajectory(tables: dict[str, pd.DataFrame], steps: pd.DataFrame, horizons) -> tuple[str, list[str]]:
    """(winner name or 'A', reasons)."""
    reasons = []
    ok = {name: qualifies(tables[name], horizons) for name in TRAJ_ARMS}
    for name in TRAJ_ARMS:
        t = tables[name]
        verdicts = ", ".join(f"T+{h} {t.loc[h, 'verdict']}" for h in horizons)
        reasons.append(f"{name}: {verdicts} -> {'qualifies' if ok[name] else 'does not qualify'}")
    winner = next((n for n in TRAJ_ARMS if ok[n]), "A")
    if winner == "B2" and ok["B3"]:
        b2, b3 = tables["B2"].loc[60], tables["B3"].loc[60]
        margin = b2["paired_mean"] - b3["paired_mean"]
        take_b3 = margin > b2["half_width_95"]
        reasons.append(f"B2 and B3 both qualify: T+60 paired mean B3 {b3['paired_mean']:+.3f} vs B2 "
                       f"{b2['paired_mean']:+.3f} (margin {margin:.3f} vs B2 half-width {b2['half_width_95']:.3f}) "
                       f"-> {'B3' if take_b3 else 'B2 (simpler)'}")
        winner = "B3" if take_b3 else "B2"
    if winner == "B3":
        h2h = steps.loc[f"{WEEK_ARM} vs B3", "verdict"]
        gate = all(h2h.get(h) == "new wins" for h in GATE_HORIZONS)
        guard = GUARD_HORIZON not in horizons or h2h.get(GUARD_HORIZON) != "old wins"
        verdicts = ", ".join(f"T+{h} {h2h.get(h)}" for h in horizons)
        take_b4 = gate and guard
        reasons.append(f"{WEEK_ARM} vs B3 head-to-head (week_of_year kept vs dropped): {verdicts} -> "
                       f"{WEEK_ARM if take_b4 else 'B3 (week_of_year stays dropped)'}")
        winner = WEEK_ARM if take_b4 else "B3"
    return winner, reasons


def decide_day_profile(tables: dict[str, pd.DataFrame], d2_vs_d1: pd.Series) -> tuple[str, list[str]]:
    """d2_vs_d1: the day_profile comparison row with D1 as 'A' and D2 as 'B'."""
    reasons = []
    for name in ("D1", "D2"):
        row = tables[name].loc["day_profile"]
        reasons.append(f"{name} vs A: day_profile paired {row['paired_mean']:+.3f} ± {row['half_width_95']:.3f}, "
                       f"sign p {row['sign_test_p']:.3g} -> {row['verdict']}")
    ok = [n for n in ("D1", "D2") if tables[n].loc["day_profile", "verdict"] == "B wins"]
    h2h = d2_vs_d1["verdict"]
    reasons.append(f"D2 vs D1 head-to-head: paired {d2_vs_d1['paired_mean']:+.3f} ± {d2_vs_d1['half_width_95']:.3f}, "
                   f"D2 wins {int(d2_vs_d1['wins_B'])} / D1 wins {int(d2_vs_d1['wins_A'])} days, "
                   f"sign p {d2_vs_d1['sign_test_p']:.3g} -> {h2h.replace('B', 'D2').replace('A', 'D1')}")
    if len(ok) == 2:
        return ("D1" if h2h == "A wins" else "D2"), reasons
    return (ok[0] if ok else "A"), reasons


def final_recipe(all_arms: dict[str, Recipe], traj: str, dp: str) -> Recipe:
    t = RECIPE_A if traj == "A" else all_arms[traj]
    d = RECIPE_A if dp == "A" else all_arms[dp]
    return Recipe("B", dict(t.trajectory_params), dict(d.day_profile_params), t.trajectory_target,
                  t.trajectory_features, d.day_profile_features)


def recipe_block(r: Recipe) -> str:
    return "\n".join([
        f"name                 = {r.name!r}",
        f"trajectory_params    = {r.trajectory_params!r}",
        f"day_profile_params   = {r.day_profile_params!r}",
        f"trajectory_target    = {r.trajectory_target!r}",
        f"trajectory_features  = {list(r.trajectory_features)!r}  # {len(r.trajectory_features)}",
        f"day_profile_features = {list(r.day_profile_features)!r}  # {len(r.day_profile_features)}",
    ])


def step_tests(df, preds: dict[str, dict], horizons) -> pd.DataFrame:
    """Each trajectory arm vs the arm before it, plus B4 vs B3 (same rows).
    The B4-vs-B3 rows feed the trajectory rule; the rest are context."""
    out = []
    pairs = list(zip(STEP_CHAIN, STEP_CHAIN[1:])) + [("B3", WEEK_ARM)]
    for prev, cur in pairs:
        for h in horizons:
            a = preds[cur][h]["recipe_A"] if prev == "A" else preds[prev][h][f"recipe_{prev}"]
            b = preds[cur][h][f"recipe_{cur}"]
            rows = pd.Series(False, index=df.index)
            rows[b.index] = True
            y = df[f"target_t{h}"]
            pair = metrics.paired_daily(df, rows, y, b.reindex(df.index), a.reindex(df.index))
            out.append({"step": f"{cur} vs {prev}", "horizon": h, "paired_mean": pair["mean"],
                        "half_width_95": pair["half_width_95"], "wins_new": pair["wins_a"],
                        "wins_old": pair["wins_b"], "sign_test_p": pair["sign_test_p"],
                        "verdict": evaluate.verdict(pair).replace("B", "new").replace("A", "old")})
    return pd.DataFrame(out).set_index(["step", "horizon"])


def per_ride(by_ride: pd.DataFrame, b_col: str | None) -> pd.DataFrame:
    cols = ["n", "persistence", "recipe_A", "lift_recipe_A"]
    if b_col:
        cols += [b_col, f"lift_{b_col}"]
    t = by_ride[cols].copy()
    if b_col:
        t["B_minus_A"] = t[b_col] - t["recipe_A"]
        # Near-constant waits (shows) have MAE ~0, where a percentage means nothing.
        t["B_vs_A_pct"] = ((t["recipe_A"] - t[b_col]) / t["recipe_A"] * 100).where(t["recipe_A"] >= 1.0)
        t = t.sort_values("B_minus_A", ascending=False)
    return t


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizons", default=",".join(map(str, HORIZONS)))
    args = ap.parse_args(argv)
    horizons = [int(h) for h in args.horizons.split(",") if h]

    started = time.time()
    df = _load()
    cats = (df.attrs["RIDE_ID_CATEGORIES"], df.attrs["STATUS_CATEGORIES"])
    train, test = forward_split(df, weeks=4)
    all_arms = arms()

    tables, preds, by_ride, timings = {}, {}, {}, {}
    for name, arm in all_arms.items():
        t0 = time.time()
        res = evaluate.run(
            df, *cats, weeks=4, horizons=horizons,
            run_staleness=False, write_report=False, label=name, model_dir="does-not-exist",
            recipe=RECIPE_A, compare=arm,
        )
        tables[name] = res.recipe_comparison
        if name in TRAJ_ARMS + [WEEK_ARM]:
            preds[name] = {h: {k: v for k, v in res.preds[h].items() if k.startswith("recipe_")} for h in horizons}
            if 60 in horizons:
                by_ride[name] = res.by_ride[60]
        timings[name] = time.time() - t0
        del res
        print(f"  {name}: {timings[name]:.0f}s")
        with pd.option_context("display.width", 200, "display.float_format", "{:.3f}".format):
            print(tables[name])

    # D2 against D1 directly: does dropping week_of_year cost the 600x63 model?
    t0 = time.time()
    d2_vs_d1 = evaluate.run(
        df, *cats, weeks=4, horizons=[], run_staleness=False, write_report=False, label="D2vsD1",
        model_dir="does-not-exist", recipe=with_(all_arms["D1"], name="D1"), compare=all_arms["D2"],
    ).recipe_comparison.loc["day_profile"]
    print(f"  D2 vs D1: {time.time() - t0:.0f}s")
    steps = step_tests(df, preds, horizons)
    traj, traj_reasons = decide_trajectory(tables, steps, horizons)
    dp, dp_reasons = decide_day_profile(tables, d2_vs_d1)
    final = final_recipe(all_arms, traj, dp)
    current_b_matches = recipes.RECIPE_B == final

    lines = [
        f"# Session 4 recipe experiment — {date.today().isoformat()}",
        "",
        f"- Frame: `{FRAME.name}` {df.shape[0]:,} rows, {df['date_la'].min()} to {df['date_la'].max()}",
        f"- Forward split, 4 weeks: train {int(df.loc[train, 'date_la'].nunique())} days, "
        f"test {int(df.loc[test, 'date_la'].nunique())} days. Horizons {horizons}.",
        "- Every arm is scored against Recipe A on identical rows. paired_mean = mean daily MAE(arm) − MAE(A); "
        "negative = arm better. Verdict: a side wins when the mean favors it and clears the 95% half-width "
        "or the sign test has p < 0.05; otherwise noise. day_profile rows are serving-style.",
        "- Trajectory arms leave day-profile at A and D arms leave trajectory at A (those rows are exact ties).",
        f"- Run time: {', '.join(f'{k} {v:.0f}s' for k, v in timings.items())}.",
        "",
    ]
    descriptions = {
        "B0": "A + delta trajectory target",
        "B1": "B0 − week_of_year (trajectory)",
        "B2": "B1 + trajectory 600 trees × 63 leaves",
        "B3": "B2 + minutes_until_close (trajectory)",
        "B4": "B3 with week_of_year kept (trajectory, 22 features)",
        "D1": "A with day-profile 600 × 63",
        "D2": "D1 − week_of_year (day-profile)",
    }
    for name, table in tables.items():
        lines += [f"## {name}: {descriptions[name]}", "", _table(table), ""]

    lines += [
        "## Decisions", "",
        "**Why the rules changed (2026-10-18):** the first run's rule picked D2 although D1 beat it head-to-head "
        "by 0.20 MAE on 26 of 28 days, and dropping week_of_year from trajectory (B1 vs B0) was itself a small "
        "loss at T+30 and T+120. The forward test weeks (38–41) were unseen in training, so the holdout already "
        "measures the extrapolation case the \"week_of_year can't generalize\" prior worried about. "
        "week_of_year is now tested both ways on both models and the holdout decides.", "",
        "**Trajectory rule:** the first of B0, B1, B2, B3 with 'B wins' at T+30, T+60 and T+120 and not "
        "'A wins' at T+240; B3 over B2 only if its T+60 paired mean is lower by more than B2's half-width; "
        "none → A. If that pick is B3, B4 (week_of_year kept) replaces it only if B4 vs B3 head-to-head is "
        "'new wins' at T+30, T+60 and T+120 and not 'old wins' at T+240; otherwise B3.", "",
    ]
    lines += [f"- {r}" for r in traj_reasons]
    lines += ["", f"**Trajectory → {traj}.**", ""]
    if traj == "A":
        lines += ["**NO TRAJECTORY ARM BEAT A. The delta target is NOT in the final RECIPE_B; its trajectory "
                  "side is Recipe A's.**", ""]
    lines += ["**Day-profile rule:** candidates are D1 and D2 with 'B wins' vs A on the day_profile row. "
              "If both qualify, the D2-vs-D1 head-to-head verdict decides ('noise' → D2, the simpler); "
              "one → that one; none → A.", ""]
    lines += [f"- {r}" for r in dp_reasons]
    lines += ["", f"**Day-profile → {dp}.**", ""]
    lines += [
        "## Step-by-step", "",
        "Each trajectory arm against the arm before it, plus B4 vs B3, same rows. Negative = the newer arm is "
        "better. The B4-vs-B3 rows feed the trajectory rule; the rest are context.", "",
        _table(steps), "",
    ]

    if 60 in horizons:
        b_col = None if traj == "A" else f"recipe_{traj}"
        rides = per_ride(by_ride[traj if traj != "A" else "B0"], b_col)
        callouts = rides[[any(c in str(n) for c in CALL_OUTS) for n in rides.index]]
        missing = [c for c in CALL_OUTS if not any(c in str(n) for n in rides.index)]
        lines += [
            f"## Per-ride T+60: A vs final B (trajectory side = {traj})", "",
            "MAE in minutes; lift_* is % vs persistence; B_minus_A is MAE(B) − MAE(A) in minutes "
            "(positive = B worse); B_vs_A_pct is % MAE improvement of B over A, blank when A's MAE < 1.0.", "",
            "### Call-outs", "", _table(callouts), "",
            f"No T+60 scoring rows in the test window (closed or in refurbishment throughout): "
            f"{', '.join(missing) or 'none'}.", "",
            "### All rides (worst B_minus_A first)", "", _table(rides), "",
        ]

    lines += [
        "## Final RECIPE_B", "",
        f"Trajectory from {traj}, day-profile from {dp}. "
        f"`ml/recipes.py` RECIPE_B {'already matches' if current_b_matches else 'must be updated to match'}.", "",
        "```python", recipe_block(final), "```", "",
    ]
    out = REPO / "reports" / "eval" / f"{date.today().isoformat()}_session4-recipes.md"
    out.write_text("\n".join(lines))

    print("\n".join(lines[lines.index("## Decisions"):]))
    print(f"Wrote {out.relative_to(REPO)} in {time.time() - started:.0f}s total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
