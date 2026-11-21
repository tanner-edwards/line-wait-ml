# Session 7 model bake-off — scored on the go-now / hold-off decision

- Frame: 2026-05-02 to 2026-11-16 (1,117,257 rows); cutoff 2026-10-19 (forward split, last 4 weeks = 28 test days)
- Decision rows: 75,945 (OPERATING, wait known, full 2-hour future known)
- Rule: hold off when the arm's lowest forecast in T+10..T+120 is >= 10 min under now; walk time 0; posted wait = wait
- Oracle (perfect foresight) net: **5.24 min per decision**; 27.5% of decisions had a real >=10 min dip ahead
- Wait-band row counts: {'<=10': 34987, '11-25': 20927, '26-60': 18192, '>60': 1839}
- Smoke run: False

## Headline: minutes saved vs 'just go now'

net = average minutes saved per decision (go-now scores 0). pct_of_oracle = share of the perfect-foresight savings captured. hit rate = share of hold-offs where the wait really was lower.

| arm          |   net_min_per_decision |   pct_of_oracle |   hold_rate_pct |   hold_hit_rate_pct |   saved_per_hold |   wasted_per_hold |   saved_total_hrs |   wasted_total_hrs |   missed_total_hrs |
|:-------------|-----------------------:|----------------:|----------------:|--------------------:|-----------------:|------------------:|------------------:|-------------------:|-------------------:|
| catboost     |                   1.29 |           24.60 |            9.67 |               81.99 |            14.06 |              0.72 |           1719.92 |              87.83 |            3104.92 |
| lgbm_C_l2    |                   1.27 |           24.22 |            9.39 |               81.90 |            14.17 |              0.65 |           1684.58 |              77.75 |            3127.17 |
| lgbm_C       |                   1.24 |           23.65 |            8.54 |               86.35 |            15.07 |              0.55 |           1628.42 |              59.17 |            3306.17 |
| ens_trees    |                   1.23 |           23.48 |            8.08 |               87.18 |            15.79 |              0.55 |           1614.50 |              56.67 |            3354.17 |
| xgb          |                   1.20 |           22.96 |            7.79 |               87.00 |            15.95 |              0.50 |           1572.50 |              49.08 |            3412.17 |
| ens_all      |                   1.15 |           21.88 |            7.08 |               88.55 |            16.67 |              0.48 |           1494.33 |              42.83 |            3548.00 |
| gru          |                   0.94 |           17.88 |            5.66 |               87.00 |            17.07 |              0.52 |           1223.67 |              37.08 |            3901.00 |
| ridge        |                   0.72 |           13.81 |            4.60 |               84.42 |            16.52 |              0.79 |            962.67 |              46.33 |            4198.08 |
| lookup_delta |                   0.36 |            6.82 |            3.67 |               68.20 |            10.60 |              0.86 |            492.42 |              39.92 |            4993.42 |
| persistence  |                   0.00 |            0.00 |            0.00 |              nan    |           nan    |            nan    |              0.00 |               0.00 |            5600.58 |

## Paired daily test vs incumbent (lgbm_C)

paired_mean_gain = mean over test days of (arm net - incumbent net); positive = the arm saves more. Verdict: a side wins when the mean favors it and clears the 95% half-width or the sign test p < 0.05.

| arm          |   paired_mean_gain |   half_width_95 |   days_arm_better |   days_incumbent_better |   sign_test_p | verdict        |
|:-------------|-------------------:|----------------:|------------------:|------------------------:|--------------:|:---------------|
| persistence  |              -1.23 |            0.30 |                 0 |                      28 |          0.00 | incumbent wins |
| lookup_delta |              -0.87 |            0.19 |                 0 |                      28 |          0.00 | incumbent wins |
| lgbm_C_l2    |               0.03 |            0.05 |                15 |                      13 |          0.85 | noise          |
| xgb          |              -0.03 |            0.08 |                19 |                       9 |          0.09 | noise          |
| catboost     |               0.05 |            0.04 |                19 |                       9 |          0.09 | arm wins       |
| ridge        |              -0.51 |            0.14 |                 0 |                      28 |          0.00 | incumbent wins |
| gru          |              -0.29 |            0.16 |                 4 |                      24 |          0.00 | incumbent wins |
| ens_trees    |              -0.01 |            0.03 |                15 |                      13 |          0.85 | noise          |
| ens_all      |              -0.09 |            0.06 |                 8 |                      20 |          0.04 | incumbent wins |

## Net minutes saved per decision by current wait band

| arm          |   <=10 |   11-25 |   26-60 |   >60 |
|:-------------|-------:|--------:|--------:|------:|
| persistence  |   0.00 |    0.00 |    0.00 |  0.00 |
| lookup_delta |   0.01 |    0.29 |    0.91 |  2.24 |
| lgbm_C       |   0.00 |    0.55 |    3.35 | 11.78 |
| lgbm_C_l2    |   0.00 |    0.47 |    3.53 | 12.22 |
| xgb          |   0.00 |    0.44 |    3.26 | 12.44 |
| catboost     |   0.00 |    0.55 |    3.47 | 12.59 |
| ridge        |  -0.00 |    0.10 |    1.82 | 10.75 |
| gru          |   0.00 |    0.23 |    2.53 | 11.15 |
| ens_trees    |   0.00 |    0.47 |    3.34 | 12.44 |
| ens_all      |   0.00 |    0.39 |    3.12 | 12.09 |

## Net minutes saved per decision by hour of day

|              |    8 |    9 |   10 |   11 |   12 |   13 |    14 |   15 |   16 |   17 |   18 |   19 |   20 |   21 |
|:-------------|-----:|-----:|-----:|-----:|-----:|-----:|------:|-----:|-----:|-----:|-----:|-----:|-----:|-----:|
| persistence  | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |  0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| lookup_delta | 0.06 | 0.00 | 0.00 | 0.05 | 0.00 | 0.00 | -0.03 | 0.01 | 0.26 | 0.37 | 0.65 | 3.72 | 2.40 | 0.00 |
| lgbm_C       | 0.26 | 0.19 | 0.52 | 0.73 | 0.77 | 0.81 |  0.84 | 0.99 | 0.95 | 1.04 | 2.12 | 5.89 | 5.56 | 3.18 |
| lgbm_C_l2    | 0.32 | 0.25 | 0.62 | 0.88 | 0.90 | 0.98 |  0.99 | 1.08 | 1.08 | 0.99 | 1.96 | 5.26 | 5.05 | 2.67 |
| xgb          | 0.34 | 0.21 | 0.57 | 0.72 | 0.79 | 0.88 |  0.87 | 1.04 | 1.00 | 0.95 | 2.03 | 5.23 | 4.95 | 2.97 |
| catboost     | 0.39 | 0.27 | 0.59 | 0.82 | 0.87 | 0.89 |  0.91 | 1.01 | 1.00 | 0.99 | 2.21 | 5.84 | 5.38 | 2.99 |
| ridge        | 0.13 | 0.15 | 0.27 | 0.28 | 0.31 | 0.46 |  0.60 | 0.82 | 0.72 | 0.96 | 1.54 | 2.49 | 2.34 | 2.19 |
| gru          | 0.27 | 0.24 | 0.52 | 0.61 | 0.71 | 0.79 |  0.73 | 0.91 | 0.70 | 0.75 | 1.43 | 3.35 | 3.85 | 3.13 |
| ens_trees    | 0.32 | 0.20 | 0.58 | 0.75 | 0.77 | 0.82 |  0.83 | 0.97 | 0.98 | 0.99 | 2.12 | 5.77 | 5.25 | 3.02 |
| ens_all      | 0.29 | 0.21 | 0.54 | 0.69 | 0.72 | 0.82 |  0.79 | 0.97 | 0.86 | 0.92 | 1.94 | 5.19 | 4.94 | 3.10 |

## Sanity check: MAE (minutes) on the decision rows

| arm          |   T+10 |   T+20 |   T+30 |   T+40 |   T+50 |   T+60 |   T+90 |   T+120 |
|:-------------|-------:|-------:|-------:|-------:|-------:|-------:|-------:|--------:|
| persistence  |   2.21 |   3.72 |   4.57 |   4.99 |   5.23 |   5.38 |   5.91 |    6.50 |
| lookup_delta |   2.21 |   3.73 |   4.57 |   5.00 |   5.21 |   5.32 |   5.66 |    6.05 |
| lgbm_C       |   2.21 |   3.57 |   4.10 |   4.30 |   4.42 |   4.52 |   4.80 |    5.07 |
| lgbm_C_l2    |   2.74 |   3.88 |   4.29 |   4.47 |   4.57 |   4.68 |   4.98 |    5.30 |
| xgb          |   2.26 |   3.57 |   4.08 |   4.29 |   4.42 |   4.52 |   4.83 |    5.15 |
| catboost     |   2.21 |   3.61 |   4.20 |   4.55 |   4.51 |   4.63 |   4.97 |    5.21 |
| ridge        |   2.84 |   4.21 |   4.77 |   4.99 |   5.12 |   5.23 |   5.59 |    5.97 |
| gru          |   2.19 |   3.45 |   4.02 |   4.33 |   4.53 |   4.71 |   5.10 |    5.48 |
| ens_trees    |   2.23 |   3.55 |   4.08 |   4.31 |   4.39 |   4.49 |   4.78 |    5.04 |
| ens_all      |   2.21 |   3.50 |   4.01 |   4.24 |   4.36 |   4.47 |   4.77 |    5.04 |
