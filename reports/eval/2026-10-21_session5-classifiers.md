# Session 5 classifier experiment — 2026-10-21

**In plain words:** today the arrow shows on 14.6% of forward rows and is right 70.3% of the time (a real 5-minute move in that direction by T+30). Under the chosen rule it shows on 15.0% of rows and is right 73.8% of the time.

- Frame: `df_features_cache.pkl` 955,685 rows, 2026-05-02 to 2026-10-18
- Forward split, 4 weeks: train 142 days, test 28 days. Horizons [30, 60].
- Train rows per horizon: subsample of 300,000 (seed 1) of training_valid_tN & train (T+30 300,000, T+60 300,000); test rows: T+30 93,214, T+60 88,083.
- Classifiers: `LGBMClassifier({'n_estimators': 300, 'num_leaves': 63, 'learning_rate': 0.05, 'verbose': -1})` on recipe B's 21 trajectory features. Regression comparator: recipe B's trajectory model fit on the same train rows; its score is ±(pred − current) and its calls are today's rule applied to its predicted change.
- Bands on the current (walk-on-normalized) wait: <=10, 15-25 (11–25), 30-60 (26–60), >60.
- Thresholds are chosen on the forward test rows themselves (that is what the spec asks for); the deployed classifiers are refit on every row, so expect small drift in the realized call rate.
- Run time: 216s.

## Label arms: AUC, average precision, top-decile precision

`_reg` columns score the regression's ±(pred − current) against the same label. reg_call_rate / reg_precision: the regression's own calls under that label.

|  | n | base_rate | auc_clf | auc_reg | ap_clf | ap_reg | top10_clf | top10_reg | reg_call_rate | reg_precision |
|---|---|---|---|---|---|---|---|---|---|---|
| (30, 'fall', 'flat5') | 93214 | 0.23 | 0.86 | 0.78 | 0.62 | 0.55 | 0.71 | 0.67 | 0.10 | 0.67 |
| (30, 'rise', 'flat5') | 93214 | 0.24 | 0.83 | 0.74 | 0.63 | 0.54 | 0.73 | 0.69 | 0.05 | 0.77 |
| (30, 'fall', 'flat10') | 93214 | 0.14 | 0.90 | 0.84 | 0.58 | 0.52 | 0.60 | 0.57 | 0.04 | 0.67 |
| (30, 'rise', 'flat10') | 93214 | 0.15 | 0.85 | 0.76 | 0.53 | 0.46 | 0.58 | 0.55 | 0.02 | 0.79 |
| (30, 'fall', 'pct') | 93214 | 0.07 | 0.89 | 0.79 | 0.39 | 0.23 | 0.37 | 0.25 | 0.00 | 0.63 |
| (30, 'rise', 'pct') | 93214 | 0.08 | 0.92 | 0.80 | 0.52 | 0.39 | 0.46 | 0.37 | 0.02 | 0.72 |
| (60, 'fall', 'flat5') | 88083 | 0.28 | 0.88 | 0.81 | 0.72 | 0.67 | 0.82 | 0.79 | 0.17 | 0.74 |
| (60, 'rise', 'flat5') | 88083 | 0.30 | 0.84 | 0.77 | 0.69 | 0.65 | 0.81 | 0.79 | 0.12 | 0.77 |
| (60, 'fall', 'flat10') | 88083 | 0.16 | 0.91 | 0.86 | 0.65 | 0.61 | 0.70 | 0.68 | 0.07 | 0.73 |
| (60, 'rise', 'flat10') | 88083 | 0.18 | 0.85 | 0.79 | 0.57 | 0.54 | 0.64 | 0.63 | 0.04 | 0.77 |
| (60, 'fall', 'pct') | 88083 | 0.09 | 0.91 | 0.83 | 0.51 | 0.34 | 0.48 | 0.37 | 0.03 | 0.67 |
| (60, 'rise', 'pct') | 88083 | 0.09 | 0.92 | 0.79 | 0.54 | 0.35 | 0.49 | 0.36 | 0.03 | 0.70 |

## Band tables

Per band: base rate of the label; the regression's call rate and precision; the classifier's precision when it calls as often as the regression (tau_call), and tau_high, the lowest probability where the classifier's precision reaches 0.75 (n/a if never, or with fewer than 50 calls).

### T+30 fall, flat5

| band | n | base_rate | reg_call_rate | reg_precision | clf_call_rate | clf_precision | tau_call | tau_high |
|---|---|---|---|---|---|---|---|---|
| <=10 | 36848 | 0.04 | 0.00 |  | 0.00 |  | n/a | n/a |
| 15-25 | 27065 | 0.26 | 0.02 | 0.66 | 0.02 | 0.73 | 0.744 | 0.762 |
| 30-60 | 26079 | 0.42 | 0.28 | 0.67 | 0.28 | 0.70 | 0.605 | 0.678 |
| >60 | 3222 | 0.53 | 0.48 | 0.66 | 0.48 | 0.67 | 0.594 | 0.750 |

### T+30 fall, flat10

| band | n | base_rate | reg_call_rate | reg_precision | clf_call_rate | clf_precision | tau_call | tau_high |
|---|---|---|---|---|---|---|---|---|
| <=10 | 36848 | 0.00 | 0.00 |  | 0.00 |  | n/a | n/a |
| 15-25 | 27065 | 0.12 | 0.00 | 1.00 | 0.00 | 1.00 | 0.870 | 0.707 |
| 30-60 | 26079 | 0.32 | 0.10 | 0.69 | 0.10 | 0.73 | 0.667 | 0.686 |
| >60 | 3222 | 0.49 | 0.34 | 0.63 | 0.34 | 0.67 | 0.618 | 0.749 |

### T+30 fall, pct

| band | n | base_rate | reg_call_rate | reg_precision | clf_call_rate | clf_precision | tau_call | tau_high |
|---|---|---|---|---|---|---|---|---|
| <=10 | 36848 | 0.00 | 0.00 |  | 0.00 |  | n/a | n/a |
| 15-25 | 27065 | 0.12 | 0.00 | 1.00 | 0.00 | 1.00 | 0.881 | 0.744 |
| 30-60 | 26079 | 0.12 | 0.00 | 0.62 | 0.00 | 0.69 | 0.735 | 0.770 |
| >60 | 3222 | 0.11 | 0.00 |  | 0.00 |  | n/a | n/a |

### T+30 rise, flat5

| band | n | base_rate | reg_call_rate | reg_precision | clf_call_rate | clf_precision | tau_call | tau_high |
|---|---|---|---|---|---|---|---|---|
| <=10 | 36848 | 0.18 | 0.01 | 0.81 | 0.01 | 0.89 | 0.793 | 0.641 |
| 15-25 | 27065 | 0.31 | 0.09 | 0.77 | 0.09 | 0.82 | 0.698 | 0.592 |
| 30-60 | 26079 | 0.26 | 0.07 | 0.76 | 0.07 | 0.79 | 0.667 | 0.612 |
| >60 | 3222 | 0.18 | 0.00 |  | 0.00 |  | n/a | n/a |

### T+30 rise, flat10

| band | n | base_rate | reg_call_rate | reg_precision | clf_call_rate | clf_precision | tau_call | tau_high |
|---|---|---|---|---|---|---|---|---|
| <=10 | 36848 | 0.10 | 0.00 | 0.85 | 0.00 | 0.92 | 0.810 | 0.667 |
| 15-25 | 27065 | 0.19 | 0.03 | 0.78 | 0.03 | 0.82 | 0.726 | 0.623 |
| 30-60 | 26079 | 0.18 | 0.02 | 0.78 | 0.02 | 0.80 | 0.712 | 0.635 |
| >60 | 3222 | 0.14 | 0.00 |  | 0.00 |  | n/a | n/a |

### T+30 rise, pct

| band | n | base_rate | reg_call_rate | reg_precision | clf_call_rate | clf_precision | tau_call | tau_high |
|---|---|---|---|---|---|---|---|---|
| <=10 | 36848 | 0.00 | 0.00 |  | 0.00 |  | n/a | n/a |
| 15-25 | 27065 | 0.19 | 0.05 | 0.73 | 0.05 | 0.77 | 0.664 | 0.635 |
| 30-60 | 26079 | 0.08 | 0.01 | 0.68 | 0.01 | 0.71 | 0.609 | 0.632 |
| >60 | 3222 | 0.01 | 0.00 |  | 0.00 |  | n/a | n/a |

### T+60 fall, flat5

| band | n | base_rate | reg_call_rate | reg_precision | clf_call_rate | clf_precision | tau_call | tau_high |
|---|---|---|---|---|---|---|---|---|
| <=10 | 34552 | 0.06 | 0.00 |  | 0.00 |  | n/a | 0.704 |
| 15-25 | 25810 | 0.34 | 0.14 | 0.74 | 0.14 | 0.75 | 0.666 | 0.659 |
| 30-60 | 24697 | 0.48 | 0.38 | 0.74 | 0.38 | 0.74 | 0.609 | 0.625 |
| >60 | 3024 | 0.64 | 0.73 | 0.73 | 0.73 | 0.73 | 0.547 | 0.593 |

### T+60 fall, flat10

| band | n | base_rate | reg_call_rate | reg_precision | clf_call_rate | clf_precision | tau_call | tau_high |
|---|---|---|---|---|---|---|---|---|
| <=10 | 34552 | 0.00 | 0.00 |  | 0.00 |  | n/a | n/a |
| 15-25 | 25810 | 0.16 | 0.03 | 0.75 | 0.03 | 0.74 | 0.681 | 0.695 |
| 30-60 | 24697 | 0.33 | 0.17 | 0.73 | 0.17 | 0.74 | 0.615 | 0.634 |
| >60 | 3024 | 0.58 | 0.54 | 0.73 | 0.54 | 0.75 | 0.578 | 0.587 |

### T+60 fall, pct

| band | n | base_rate | reg_call_rate | reg_precision | clf_call_rate | clf_precision | tau_call | tau_high |
|---|---|---|---|---|---|---|---|---|
| <=10 | 34552 | 0.00 | 0.00 |  | 0.00 |  | n/a | n/a |
| 15-25 | 25810 | 0.16 | 0.05 | 0.68 | 0.05 | 0.70 | 0.604 | 0.693 |
| 30-60 | 24697 | 0.13 | 0.04 | 0.65 | 0.04 | 0.71 | 0.573 | 0.650 |
| >60 | 3024 | 0.15 | 0.03 | 0.66 | 0.03 | 0.60 | 0.662 | n/a |

### T+60 rise, flat5

| band | n | base_rate | reg_call_rate | reg_precision | clf_call_rate | clf_precision | tau_call | tau_high |
|---|---|---|---|---|---|---|---|---|
| <=10 | 34552 | 0.25 | 0.09 | 0.79 | 0.09 | 0.81 | 0.733 | 0.607 |
| 15-25 | 25810 | 0.36 | 0.15 | 0.80 | 0.15 | 0.81 | 0.676 | 0.586 |
| 30-60 | 24697 | 0.31 | 0.14 | 0.73 | 0.14 | 0.73 | 0.600 | 0.635 |
| >60 | 3024 | 0.23 | 0.02 | 0.57 | 0.02 | 0.66 | 0.546 | n/a |

### T+60 rise, flat10

| band | n | base_rate | reg_call_rate | reg_precision | clf_call_rate | clf_precision | tau_call | tau_high |
|---|---|---|---|---|---|---|---|---|
| <=10 | 34552 | 0.14 | 0.02 | 0.80 | 0.02 | 0.79 | 0.714 | 0.635 |
| 15-25 | 25810 | 0.21 | 0.06 | 0.77 | 0.06 | 0.79 | 0.649 | 0.595 |
| 30-60 | 24697 | 0.20 | 0.04 | 0.73 | 0.04 | 0.73 | 0.627 | 0.645 |
| >60 | 3024 | 0.18 | 0.00 | 0.57 | 0.00 | 0.57 | 0.610 | n/a |

### T+60 rise, pct

| band | n | base_rate | reg_call_rate | reg_precision | clf_call_rate | clf_precision | tau_call | tau_high |
|---|---|---|---|---|---|---|---|---|
| <=10 | 34552 | 0.00 | 0.00 |  | 0.00 |  | n/a | n/a |
| 15-25 | 25810 | 0.21 | 0.09 | 0.71 | 0.09 | 0.71 | 0.583 | 0.643 |
| 30-60 | 24697 | 0.09 | 0.01 | 0.66 | 0.01 | 0.64 | 0.546 | 0.726 |
| >60 | 3024 | 0.03 | 0.00 |  | 0.00 |  | n/a | n/a |

## Reliability (fall, by decile of predicted probability)

### T+30 fall, flat5

| decile | n | mean_p | observed |
|---|---|---|---|
| 0 | 9322 | 0.00 | 0.00 |
| 1 | 9321 | 0.00 | 0.00 |
| 2 | 9321 | 0.01 | 0.00 |
| 3 | 9322 | 0.06 | 0.05 |
| 4 | 9321 | 0.12 | 0.12 |
| 5 | 9321 | 0.19 | 0.20 |
| 6 | 9322 | 0.29 | 0.29 |
| 7 | 9321 | 0.41 | 0.39 |
| 8 | 9321 | 0.55 | 0.51 |
| 9 | 9322 | 0.73 | 0.71 |

### T+30 fall, flat10

| decile | n | mean_p | observed |
|---|---|---|---|
| 0 | 9322 | 0.00 | 0.00 |
| 1 | 9324 | 0.00 | 0.00 |
| 2 | 9318 | 0.00 | 0.00 |
| 3 | 9322 | 0.00 | 0.00 |
| 4 | 9321 | 0.02 | 0.02 |
| 5 | 9321 | 0.06 | 0.06 |
| 6 | 9322 | 0.12 | 0.12 |
| 7 | 9321 | 0.23 | 0.22 |
| 8 | 9321 | 0.40 | 0.38 |
| 9 | 9322 | 0.65 | 0.60 |

### T+30 fall, pct

| decile | n | mean_p | observed |
|---|---|---|---|
| 0 | 9322 | 0.00 | 0.00 |
| 1 | 9321 | 0.00 | 0.00 |
| 2 | 9322 | 0.00 | 0.00 |
| 3 | 9321 | 0.00 | 0.00 |
| 4 | 9321 | 0.01 | 0.01 |
| 5 | 9321 | 0.03 | 0.03 |
| 6 | 9322 | 0.05 | 0.05 |
| 7 | 9321 | 0.09 | 0.10 |
| 8 | 9321 | 0.18 | 0.16 |
| 9 | 9322 | 0.42 | 0.37 |

### T+60 fall, flat5

| decile | n | mean_p | observed |
|---|---|---|---|
| 0 | 8810 | 0.00 | 0.00 |
| 1 | 8807 | 0.00 | 0.00 |
| 2 | 8808 | 0.01 | 0.01 |
| 3 | 8808 | 0.08 | 0.08 |
| 4 | 8809 | 0.16 | 0.16 |
| 5 | 8808 | 0.25 | 0.25 |
| 6 | 8808 | 0.37 | 0.35 |
| 7 | 8808 | 0.51 | 0.48 |
| 8 | 8808 | 0.66 | 0.62 |
| 9 | 8809 | 0.83 | 0.82 |

### T+60 fall, flat10

| decile | n | mean_p | observed |
|---|---|---|---|
| 0 | 8813 | 0.00 | 0.00 |
| 1 | 8804 | 0.00 | 0.00 |
| 2 | 8808 | 0.00 | 0.00 |
| 3 | 8808 | 0.00 | 0.00 |
| 4 | 8810 | 0.02 | 0.03 |
| 5 | 8807 | 0.07 | 0.07 |
| 6 | 8808 | 0.13 | 0.14 |
| 7 | 8808 | 0.25 | 0.24 |
| 8 | 8808 | 0.44 | 0.42 |
| 9 | 8809 | 0.71 | 0.70 |

### T+60 fall, pct

| decile | n | mean_p | observed |
|---|---|---|---|
| 0 | 8809 | 0.00 | 0.00 |
| 1 | 8808 | 0.00 | 0.00 |
| 2 | 8808 | 0.00 | 0.00 |
| 3 | 8808 | 0.00 | 0.00 |
| 4 | 8809 | 0.01 | 0.01 |
| 5 | 8808 | 0.03 | 0.03 |
| 6 | 8808 | 0.05 | 0.07 |
| 7 | 8808 | 0.10 | 0.11 |
| 8 | 8808 | 0.21 | 0.20 |
| 9 | 8809 | 0.51 | 0.48 |

## Cross table

Each arm's top-decile calls (top 10% of its probability, all test rows), scored under all three labels.

### T+30 fall

| top-decile calls of | hit_flat5 | hit_flat10 | hit_pct |
|---|---|---|---|
| flat5 | 0.71 | 0.60 | 0.31 |
| flat10 | 0.69 | 0.60 | 0.29 |
| pct | 0.62 | 0.50 | 0.37 |

### T+30 rise

| top-decile calls of | hit_flat5 | hit_flat10 | hit_pct |
|---|---|---|---|
| flat5 | 0.73 | 0.57 | 0.36 |
| flat10 | 0.71 | 0.58 | 0.37 |
| pct | 0.65 | 0.50 | 0.46 |

### T+60 fall

| top-decile calls of | hit_flat5 | hit_flat10 | hit_pct |
|---|---|---|---|
| flat5 | 0.82 | 0.67 | 0.40 |
| flat10 | 0.81 | 0.70 | 0.40 |
| pct | 0.76 | 0.59 | 0.48 |

### T+60 rise

| top-decile calls of | hit_flat5 | hit_flat10 | hit_pct |
|---|---|---|---|
| flat5 | 0.81 | 0.63 | 0.33 |
| flat10 | 0.80 | 0.64 | 0.35 |
| pct | 0.71 | 0.53 | 0.49 |

## Alert arms (rise, T+30, current > 10)

Call rate and precision per band at each threshold. precision_own = against the arm's own label (deployed reversion: (target − wait)/wait >= 0.40, no floor); precision_flat5 = against a 5-minute rise, the common yardstick. The deployed reversion model is called at p > threshold (today's gate uses > 0.35); the last rows are today's whole gate (pct_rank <= 0.15 and p > 0.35), for reference only.

**The deployed reversion model is in-sample here.** `models/reversion_model.txt` was retrained by the notebook's `rm01ef45` cell during the 2026-10-18 export (its bytes differ from the 2026-10-14 commit), on the every-5th-day interleaved split through 2026-10-18, so it saw about 80% of these forward test days, and `ride_percentile_buckets.json` (its pct_rank input) was built from every row through 2026-10-18. Its numbers are optimistic; an arm that beats it here would beat it by at least as much out of sample.

|  | n | calls | call_rate | precision_own | precision_flat5 |
|---|---|---|---|---|---|
| ('flat5', 0.35, '15-25') | 27065 | 9552 | 0.35 | 0.58 | 0.58 |
| ('flat5', 0.35, '30-60') | 26079 | 7099 | 0.27 | 0.57 | 0.57 |
| ('flat5', 0.35, '>60') | 3222 | 251 | 0.08 | 0.47 | 0.47 |
| ('flat5', 0.5, '15-25') | 27065 | 5649 | 0.21 | 0.69 | 0.69 |
| ('flat5', 0.5, '30-60') | 26079 | 4046 | 0.16 | 0.67 | 0.67 |
| ('flat5', 0.5, '>60') | 3222 | 23 | 0.01 | 0.61 | 0.61 |
| ('flat5', 0.6, '15-25') | 27065 | 3717 | 0.14 | 0.76 | 0.76 |
| ('flat5', 0.6, '30-60') | 26079 | 2609 | 0.10 | 0.74 | 0.74 |
| ('flat5', 0.6, '>60') | 3222 | 6 | 0.00 | 0.67 | 0.67 |
| ('flat5', 0.7, '15-25') | 27065 | 2325 | 0.09 | 0.82 | 0.82 |
| ('flat5', 0.7, '30-60') | 26079 | 1514 | 0.06 | 0.81 | 0.81 |
| ('flat5', 0.7, '>60') | 3222 | 4 | 0.00 | 0.75 | 0.75 |
| ('flat10', 0.35, '15-25') | 27065 | 4330 | 0.16 | 0.57 | 0.71 |
| ('flat10', 0.35, '30-60') | 26079 | 4023 | 0.15 | 0.54 | 0.67 |
| ('flat10', 0.35, '>60') | 3222 | 110 | 0.03 | 0.45 | 0.50 |
| ('flat10', 0.5, '15-25') | 27065 | 2441 | 0.09 | 0.68 | 0.80 |
| ('flat10', 0.5, '30-60') | 26079 | 2018 | 0.08 | 0.65 | 0.77 |
| ('flat10', 0.5, '>60') | 3222 | 8 | 0.00 | 0.62 | 0.75 |
| ('flat10', 0.6, '15-25') | 27065 | 1636 | 0.06 | 0.74 | 0.84 |
| ('flat10', 0.6, '30-60') | 26079 | 1193 | 0.05 | 0.72 | 0.83 |
| ('flat10', 0.6, '>60') | 3222 | 0 | 0.00 |  |  |
| ('flat10', 0.7, '15-25') | 27065 | 1035 | 0.04 | 0.80 | 0.89 |
| ('flat10', 0.7, '30-60') | 26079 | 642 | 0.02 | 0.80 | 0.88 |
| ('flat10', 0.7, '>60') | 3222 | 0 | 0.00 |  |  |
| ('pct', 0.35, '15-25') | 27065 | 4561 | 0.17 | 0.56 | 0.70 |
| ('pct', 0.35, '30-60') | 26079 | 1187 | 0.05 | 0.51 | 0.79 |
| ('pct', 0.35, '>60') | 3222 | 0 | 0.00 |  |  |
| ('pct', 0.5, '15-25') | 27065 | 2635 | 0.10 | 0.66 | 0.78 |
| ('pct', 0.5, '30-60') | 26079 | 574 | 0.02 | 0.63 | 0.87 |
| ('pct', 0.5, '>60') | 3222 | 0 | 0.00 |  |  |
| ('pct', 0.6, '15-25') | 27065 | 1782 | 0.07 | 0.73 | 0.84 |
| ('pct', 0.6, '30-60') | 26079 | 312 | 0.01 | 0.70 | 0.89 |
| ('pct', 0.6, '>60') | 3222 | 0 | 0.00 |  |  |
| ('pct', 0.7, '15-25') | 27065 | 1094 | 0.04 | 0.80 | 0.89 |
| ('pct', 0.7, '30-60') | 26079 | 138 | 0.01 | 0.83 | 0.93 |
| ('pct', 0.7, '>60') | 3222 | 0 | 0.00 |  |  |
| ('deployed reversion', 0.35, '15-25') | 27065 | 16288 | 0.60 | 0.30 | 0.45 |
| ('deployed reversion', 0.35, '30-60') | 26079 | 7962 | 0.31 | 0.21 | 0.50 |
| ('deployed reversion', 0.35, '>60') | 3222 | 73 | 0.02 | 0.11 | 0.56 |
| ('deployed reversion', 0.5, '15-25') | 27065 | 12025 | 0.44 | 0.36 | 0.52 |
| ('deployed reversion', 0.5, '30-60') | 26079 | 4780 | 0.18 | 0.28 | 0.59 |
| ('deployed reversion', 0.5, '>60') | 3222 | 24 | 0.01 | 0.12 | 0.46 |
| ('deployed reversion', 0.6, '15-25') | 27065 | 9273 | 0.34 | 0.41 | 0.57 |
| ('deployed reversion', 0.6, '30-60') | 26079 | 3107 | 0.12 | 0.34 | 0.65 |
| ('deployed reversion', 0.6, '>60') | 3222 | 11 | 0.00 | 0.09 | 0.64 |
| ('deployed reversion', 0.7, '15-25') | 27065 | 6163 | 0.23 | 0.48 | 0.63 |
| ('deployed reversion', 0.7, '30-60') | 26079 | 1885 | 0.07 | 0.42 | 0.73 |
| ('deployed reversion', 0.7, '>60') | 3222 | 5 | 0.00 | 0.20 | 0.80 |
| ("today's gate (pct_rank<=0.15 & p>0.35)", 0.35, '15-25') | 27065 | 3726 | 0.14 | 0.38 | 0.53 |
| ("today's gate (pct_rank<=0.15 & p>0.35)", 0.35, '30-60') | 26079 | 1483 | 0.06 | 0.34 | 0.63 |
| ("today's gate (pct_rank<=0.15 & p>0.35)", 0.35, '>60') | 3222 | 0 | 0.00 |  |  |

**Current wait <= 10 (excluded above; the alert never fires there):**

- flat5: 29.2% of its label's positives and 30.1% of its calls at 0.35 are on current waits <= 10
- flat10: 25.1% of its label's positives and 22.8% of its calls at 0.35 are on current waits <= 10
- pct: 0.0% of its label's positives and 0.0% of its calls at 0.35 are on current waits <= 10
- deployed reversion: 47.2% of its label's positives and 57.1% of its calls at 0.35 are on current waits <= 10

## Trend word and confidence: today vs chosen rule (T+30 forward rows)

Today = predict.py's `_derive_trend` on recipe B regressions fit on the same train rows (T+30 sets the word, T+40..T+240 vote for confidence). New = `ml.recipes.derive_trend` on the chosen arm's p_rise_30 / p_fall_30 with the T+30 thresholds below. Arrow shown = word not stable and confidence not low; precision is against a 5-minute move in the arrow's direction by T+30. word_* collapse trough into rising and peak into falling (raw_* are the refined words).

| share of T+30 forward rows | today (regression) | new (flat5 classifiers) | change_pts |
|---|---|---|---|
| word_rising | 0.05 | 0.05 | 0.02 |
| word_falling | 0.10 | 0.10 | 0.02 |
| word_stable | 0.85 | 0.85 | -0.04 |
| raw_trough | 0.00 | 0.00 | -0.03 |
| raw_peak | 0.01 | 0.01 | -0.08 |
| confidence_high | 0.26 | 0.33 | 7.11 |
| confidence_medium | 0.01 | 0.19 | 18.18 |
| confidence_low | 0.73 | 0.47 | -25.29 |
| arrow_shown | 0.15 | 0.15 | 0.40 |
| arrow_precision_flat5 | 0.70 | 0.74 | 3.51 |
| word_precision_flat5 | 0.70 | 0.74 | 3.59 |

Share of rows with confidence == 'low': today 72.6%, new 47.3% (-25.3 points). **More than 10 points: the spec says decouple the verdict engine's curve gate (layer1.ts:64) from this field before shipping (done: see below).**

`confidence` now governs only the arrow and the AI prompt; the verdict engine's curve gate (scoring/layer1.ts) keeps the old vote-count rule via the new `curve_confidence` field, so this shift does not reach the verdict engine.

By band (share of rows):

| band | today_low | new_low | today_arrow | new_arrow |
|---|---|---|---|---|
| <=10 | 0.95 | 0.24 | 0.01 | 0.01 |
| 15-25 | 0.77 | 0.67 | 0.10 | 0.10 |
| 30-60 | 0.41 | 0.59 | 0.34 | 0.35 |
| >60 | 0.38 | 0.49 | 0.47 | 0.48 |

## Decisions

**Trend-word label rule:** flat5 unless the pct arm has higher classifier precision at the regression's call rate (each arm's own band table) in both the 30-60 and >60 bands, for both directions at T+30 and T+60, and is not worse in 15-25. flat10 is a reference row only.

- T+30 fall: 30-60 pct 0.688 vs flat5 0.703 -> flat5; >60 pct n/a vs flat5 0.673 -> flat5; 15-25 pct 1.000 vs flat5 0.731 -> pct ok
- T+30 rise: 30-60 pct 0.713 vs flat5 0.792 -> flat5; >60 pct n/a vs flat5 n/a -> flat5; 15-25 pct 0.769 vs flat5 0.819 -> flat5
- T+60 fall: 30-60 pct 0.707 vs flat5 0.739 -> flat5; >60 pct 0.605 vs flat5 0.734 -> flat5; 15-25 pct 0.699 vs flat5 0.754 -> flat5
- T+60 rise: 30-60 pct 0.640 vs flat5 0.735 -> flat5; >60 pct n/a vs flat5 0.662 -> flat5; 15-25 pct 0.715 vs flat5 0.806 -> flat5

**Trend label → flat5 (('flat', 5)).**

**Thresholds (T+30, from the flat5 classifiers; these ship):** tau_call = the probability at which the classifier calls as often as today's regression in that band; tau_high = precision reaches 0.75. n/a never fires.

| band | call rise | call fall | high rise | high fall |
|---|---|---|---|---|
| <=10 | 0.793 | n/a | 0.641 | n/a |
| 15-25 | 0.698 | 0.744 | 0.592 | 0.762 |
| 30-60 | 0.667 | 0.605 | 0.612 | 0.678 |
| >60 | n/a | 0.594 | n/a | 0.750 |

T+60 thresholds, for reference only (the word uses T+30):

| band | call rise | call fall | high rise | high fall |
|---|---|---|---|---|
| <=10 | 0.733 | n/a | 0.607 | 0.704 |
| 15-25 | 0.676 | 0.666 | 0.586 | 0.659 |
| 30-60 | 0.600 | 0.609 | 0.635 | 0.625 |
| >60 | 0.546 | 0.547 | n/a | 0.593 |

**Alert rule:** the (arm, threshold) with own-label precision >= 0.6 in both the 15-25 and 30-60 bands at the highest call rate over those rows; the deployed reversion model competes.

- flat5 @ 0.35: precision 15-25 0.583, 30-60 0.570, call rate (15-60) 0.313 -> no
- flat5 @ 0.5: precision 15-25 0.686, 30-60 0.674, call rate (15-60) 0.182 -> qualifies
- flat5 @ 0.6: precision 15-25 0.756, 30-60 0.741, call rate (15-60) 0.119 -> qualifies
- flat5 @ 0.7: precision 15-25 0.819, 30-60 0.807, call rate (15-60) 0.072 -> qualifies
- flat10 @ 0.35: precision 15-25 0.567, 30-60 0.544, call rate (15-60) 0.157 -> no
- flat10 @ 0.5: precision 15-25 0.682, 30-60 0.651, call rate (15-60) 0.084 -> qualifies
- flat10 @ 0.6: precision 15-25 0.740, 30-60 0.719, call rate (15-60) 0.053 -> qualifies
- flat10 @ 0.7: precision 15-25 0.798, 30-60 0.796, call rate (15-60) 0.032 -> qualifies
- pct @ 0.35: precision 15-25 0.560, 30-60 0.512, call rate (15-60) 0.108 -> no
- pct @ 0.5: precision 15-25 0.662, 30-60 0.634, call rate (15-60) 0.060 -> qualifies
- pct @ 0.6: precision 15-25 0.726, 30-60 0.699, call rate (15-60) 0.039 -> qualifies
- pct @ 0.7: precision 15-25 0.797, 30-60 0.833, call rate (15-60) 0.023 -> qualifies
- deployed reversion @ 0.35: precision 15-25 0.297, 30-60 0.209, call rate (15-60) 0.456 -> no
- deployed reversion @ 0.5: precision 15-25 0.357, 30-60 0.280, call rate (15-60) 0.316 -> no
- deployed reversion @ 0.6: precision 15-25 0.407, 30-60 0.341, call rate (15-60) 0.233 -> no
- deployed reversion @ 0.7: precision 15-25 0.477, 30-60 0.425, call rate (15-60) 0.151 -> no

**Alert → flat5 at 0.5.**

Constants for `RECIPE_B` (alert_arm is informational):

```python
{
  "classifier_labels": {
    "fall": [
      "flat",
      5
    ],
    "rise": [
      "flat",
      5
    ]
  },
  "trend_thresholds": {
    "<=10": {
      "call": {
        "rise": 0.793,
        "fall": null
      },
      "high": {
        "rise": 0.641,
        "fall": null
      }
    },
    "15-25": {
      "call": {
        "rise": 0.698,
        "fall": 0.744
      },
      "high": {
        "rise": 0.592,
        "fall": 0.762
      }
    },
    "30-60": {
      "call": {
        "rise": 0.667,
        "fall": 0.605
      },
      "high": {
        "rise": 0.612,
        "fall": 0.678
      }
    },
    ">60": {
      "call": {
        "rise": null,
        "fall": 0.594
      },
      "high": {
        "rise": null,
        "fall": 0.75
      }
    }
  },
  "alert": {
    "field": "p_rise_30",
    "threshold": 0.5,
    "min_current_wait": 10
  },
  "alert_arm": "flat5"
}
```
