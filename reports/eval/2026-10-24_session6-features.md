# Session 6 feature batch — 2026-10-24

- Frame: `df_features_cache.pkl` 974,795 rows, 2026-05-02 to 2026-10-21
- Forward split, 4 weeks: train 145 days, test 28 days. Horizons [30, 60, 120, 240].
- Every arm is scored against recipe B (live since 2026-10-24) on identical rows. In the tables, 'A' is recipe B and 'B' is the arm: paired_mean = mean daily MAE(arm) − MAE(recipe B); negative = arm better; verdict 'B wins' = the arm wins. day_profile rows are serving-style (crowd values and, for F1, the operating counts at each day's 13:00 poll, as `_build_full_day` feeds them).
- Headliners (median OPERATING wait >= 30, train rows): 18. Posting tiers (median lastUpdated age <= 5 min on OPERATING train rows = automated): 24 automated, 42 hand.
- Lightning Lane rides (any non-NONE ll_state in train): 25.
- Run time: F1 191s, F2 185s, F3 158s, F4 169s, F5a 100s, F5b 102s; arms total 905s (feature derivation and loading excluded).

## Coverage (training_valid_t60 rows, all days)

non_null = share with a value; informative = share with a value other than 0 / NONE. lags_missing is 0 on these rows by construction (they have all three lags); its rows are the F4 counts below.

| column | n_rows | non_null | informative | distribution |
|---|---|---|---|---|
| n_operating_rides_park | 567866 | 1.00 | 1.00 | p10 19.0, median 34.0, p90 38.0 |
| n_headliners_down | 567866 | 1.00 | 0.68 | p10 0.0, median 1.0, p90 2.0 |
| last_updated_age_min | 567866 | 1.00 | 1.00 | p10 1.1, median 8.9, p90 200.1 |
| posting_tier_cat | 567866 | 1.00 | 1.00 | hand: 55.6%, automated: 44.4% |
| ll_offset_min | 567866 | 0.39 | 0.39 | p10 -5.2, median 19.7, p90 219.7 |
| ll_state_cat | 567866 | 1.00 | 0.45 | NONE: 55.3%, AVAILABLE: 39.3%, FINISHED: 5.3% |
| lags_missing | 567866 | 1.00 | 0.00 | p10 0.0, median 0.0, p90 0.0 |
| water_ride | 567866 | 1.00 | 0.16 | p10 0.0, median 0.0, p90 1.0 |
| water_ride_x_temp | 567866 | 1.00 | 0.16 | p10 0.0, median 0.0, p90 80.9 |
| soak_ride | 567866 | 1.00 | 0.05 | p10 0.0, median 0.0, p90 0.0 |
| soak_ride_x_temp | 567866 | 1.00 | 0.05 | p10 0.0, median 0.0, p90 0.0 |

Test window only (training_valid_t60 & test days):

| column | n_rows | non_null | informative | distribution |
|---|---|---|---|---|
| n_operating_rides_park | 88808 | 1.00 | 1.00 | p10 20.0, median 34.0, p90 37.0 |
| n_headliners_down | 88808 | 1.00 | 1.00 | p10 1.0, median 2.0, p90 3.0 |
| last_updated_age_min | 88808 | 1.00 | 1.00 | p10 1.3, median 11.4, p90 191.4 |
| posting_tier_cat | 88808 | 1.00 | 1.00 | hand: 57.8%, automated: 42.2% |
| ll_offset_min | 88808 | 0.37 | 0.37 | p10 -5.3, median 19.7, p90 219.7 |
| ll_state_cat | 88808 | 1.00 | 0.43 | NONE: 57.0%, AVAILABLE: 36.5%, FINISHED: 6.5% |
| lags_missing | 88808 | 1.00 | 0.00 | p10 0.0, median 0.0, p90 0.0 |
| water_ride | 88808 | 1.00 | 0.16 | p10 0.0, median 0.0, p90 1.0 |
| water_ride_x_temp | 88808 | 1.00 | 0.16 | p10 0.0, median 0.0, p90 85.3 |
| soak_ride | 88808 | 1.00 | 0.05 | p10 0.0, median 0.0, p90 0.0 |
| soak_ride_x_temp | 88808 | 1.00 | 0.05 | p10 0.0, median 0.0, p90 0.0 |

### F4 row counts

reopen_rows = OPERATING rows with a wait and a target whose lags were null (filled with the current wait, lags_missing = 1): valid under training_valid_tN_f only.

| horizon | training_valid | widened | reopen_rows | reopen_rows_test |
|---|---|---|---|---|
| 30 | 601268 | 650870 | 49602 | 7980 |
| 60 | 567866 | 615639 | 47773 | 7660 |
| 120 | 512914 | 555442 | 42528 | 7205 |
| 240 | 420693 | 459540 | 38847 | 6430 |

lags_missing rows by the previous poll's status (same ride, same day):

| status | rows |
|---|---|
| OPERATING | 36706 |
| DOWN | 9154 |
| CLOSED | 8291 |
| none (first poll of day) | 82 |
| REFURBISHMENT | 5 |

## F1: + n_operating_rides_park, n_headliners_down (trajectory, classifiers, day-profile)

### Recipe comparison

| horizon | A_mae | B_mae | paired_mean | half_width_95 | wins_B | wins_A | sign_test_p | verdict |
|---|---|---|---|---|---|---|---|---|
| 30 | 4.65 | 4.67 | 0.02 | 0.01 | 4 | 24 | 0.00 | A wins |
| 60 | 5.08 | 5.06 | -0.01 | 0.01 | 20 | 8 | 0.04 | B wins |
| 120 | 5.54 | 5.55 | 0.01 | 0.01 | 12 | 16 | 0.57 | noise |
| 240 | 6.06 | 6.08 | 0.02 | 0.03 | 11 | 17 | 0.34 | noise |
| day_profile | 6.02 | 5.99 | -0.03 | 0.04 | 17 | 11 | 0.34 | noise |

### Classifiers (recipe B vs arm, same rows)

|  | n | base_rate | B_auc | F1_auc | B_ap | F1_ap | B_top_decile | F1_top_decile | top_decile_change |
|---|---|---|---|---|---|---|---|---|---|
| p_fall_30 | 94188 | 0.22 | 0.87 | 0.87 | 0.63 | 0.63 | 0.71 | 0.71 | 0.00 |
| p_fall_60 | 88808 | 0.27 | 0.88 | 0.88 | 0.72 | 0.72 | 0.82 | 0.82 | 0.00 |
| p_rise_30 | 94188 | 0.24 | 0.84 | 0.84 | 0.63 | 0.63 | 0.73 | 0.73 | 0.00 |
| p_rise_60 | 88808 | 0.29 | 0.84 | 0.84 | 0.69 | 0.69 | 0.80 | 0.80 | -0.00 |

## F2: + last_updated_age_min, posting_tier_cat (trajectory, classifiers)

### Recipe comparison

| horizon | A_mae | B_mae | paired_mean | half_width_95 | wins_B | wins_A | sign_test_p | verdict |
|---|---|---|---|---|---|---|---|---|
| 30 | 4.65 | 4.66 | 0.01 | 0.01 | 2 | 26 | 0.00 | A wins |
| 60 | 5.08 | 5.09 | 0.01 | 0.01 | 9 | 19 | 0.09 | A wins |
| 120 | 5.54 | 5.57 | 0.03 | 0.01 | 5 | 23 | 0.00 | A wins |
| 240 | 6.06 | 6.03 | -0.02 | 0.04 | 15 | 13 | 0.85 | noise |
| day_profile | 6.02 | 6.02 | 0.00 | 0.00 | 0 | 0 |  | noise |

### Classifiers (recipe B vs arm, same rows)

|  | n | base_rate | B_auc | F2_auc | B_ap | F2_ap | B_top_decile | F2_top_decile | top_decile_change |
|---|---|---|---|---|---|---|---|---|---|
| p_fall_30 | 94188 | 0.22 | 0.87 | 0.87 | 0.63 | 0.63 | 0.71 | 0.71 | 0.00 |
| p_fall_60 | 88808 | 0.27 | 0.88 | 0.88 | 0.72 | 0.72 | 0.82 | 0.81 | -0.00 |
| p_rise_30 | 94188 | 0.24 | 0.84 | 0.84 | 0.63 | 0.63 | 0.73 | 0.73 | -0.00 |
| p_rise_60 | 88808 | 0.29 | 0.84 | 0.84 | 0.69 | 0.69 | 0.80 | 0.80 | -0.00 |

## F3: + ll_offset_min, ll_state_cat (trajectory, classifiers)

### Recipe comparison

| horizon | A_mae | B_mae | paired_mean | half_width_95 | wins_B | wins_A | sign_test_p | verdict |
|---|---|---|---|---|---|---|---|---|
| 30 | 4.65 | 4.64 | -0.01 | 0.01 | 18 | 10 | 0.18 | noise |
| 60 | 5.08 | 5.06 | -0.02 | 0.01 | 20 | 8 | 0.04 | B wins |
| 120 | 5.54 | 5.54 | 0.00 | 0.02 | 12 | 16 | 0.57 | noise |
| 240 | 6.06 | 6.03 | -0.02 | 0.04 | 16 | 12 | 0.57 | noise |
| day_profile | 6.02 | 6.02 | 0.00 | 0.00 | 0 | 0 |  | noise |

### Classifiers (recipe B vs arm, same rows)

|  | n | base_rate | B_auc | F3_auc | B_ap | F3_ap | B_top_decile | F3_top_decile | top_decile_change |
|---|---|---|---|---|---|---|---|---|---|
| p_fall_30 | 94188 | 0.22 | 0.87 | 0.87 | 0.63 | 0.63 | 0.71 | 0.71 | 0.01 |
| p_fall_60 | 88808 | 0.27 | 0.88 | 0.88 | 0.72 | 0.72 | 0.82 | 0.82 | 0.00 |
| p_rise_30 | 94188 | 0.24 | 0.84 | 0.84 | 0.63 | 0.63 | 0.73 | 0.74 | 0.00 |
| p_rise_60 | 88808 | 0.29 | 0.84 | 0.84 | 0.69 | 0.69 | 0.80 | 0.80 | 0.00 |

### Lightning Lane rides only

Same models and rows, restricted to the LL rides. Trajectory only.

| horizon | A_mae | B_mae | paired_mean | half_width_95 | wins_B | wins_A | sign_test_p | verdict | n_rows |
|---|---|---|---|---|---|---|---|---|---|
| 30 | 7.22 | 7.20 | -0.02 | 0.02 | 18 | 10 | 0.18 | B wins | 40732 |
| 60 | 7.56 | 7.52 | -0.04 | 0.02 | 21 | 7 | 0.01 | B wins | 38194 |
| 120 | 8.15 | 8.12 | -0.03 | 0.03 | 16 | 12 | 0.57 | B wins | 34171 |
| 240 | 8.72 | 8.73 | 0.02 | 0.06 | 11 | 17 | 0.34 | noise | 27183 |

## F4: + lags_missing; filled lags, widened training_valid_tN_f rows (trajectory, classifiers)

### Recipe comparison

| horizon | A_mae | B_mae | paired_mean | half_width_95 | wins_B | wins_A | sign_test_p | verdict |
|---|---|---|---|---|---|---|---|---|
| 30 | 4.65 | 4.63 | -0.01 | 0.01 | 20 | 8 | 0.04 | B wins |
| 60 | 5.08 | 5.07 | -0.01 | 0.01 | 19 | 9 | 0.09 | noise |
| 120 | 5.54 | 5.57 | 0.03 | 0.02 | 10 | 18 | 0.18 | A wins |
| 240 | 6.06 | 6.09 | 0.03 | 0.04 | 10 | 18 | 0.18 | noise |
| day_profile | 6.02 | 6.02 | 0.00 | 0.00 | 0 | 0 |  | noise |

### Classifiers (recipe B vs arm, same rows)

|  | n | base_rate | B_auc | F4_auc | B_ap | F4_ap | B_top_decile | F4_top_decile | top_decile_change |
|---|---|---|---|---|---|---|---|---|---|
| p_fall_30 | 94188 | 0.22 | 0.87 | 0.87 | 0.63 | 0.63 | 0.71 | 0.71 | 0.00 |
| p_fall_60 | 88808 | 0.27 | 0.88 | 0.88 | 0.72 | 0.72 | 0.82 | 0.82 | -0.00 |
| p_rise_30 | 94188 | 0.24 | 0.84 | 0.84 | 0.63 | 0.63 | 0.73 | 0.73 | 0.00 |
| p_rise_60 | 88808 | 0.29 | 0.84 | 0.84 | 0.69 | 0.68 | 0.80 | 0.80 | -0.00 |

### Reopen rows vs persistence

Rows valid only under the widened mask (test days). Recipe B has no prediction here (today these rides are tombstoned), so persistence is the only baseline. paired_mean = mean daily MAE(F4) − MAE(persistence).

| horizon | n_rows | persistence_mae | F4_mae | paired_mean | half_width_95 | wins_F4 | wins_persistence | sign_test_p | verdict |
|---|---|---|---|---|---|---|---|---|---|
| 30 | 7980 | 6.28 | 5.06 | -1.21 | 0.14 | 28 | 0 | 0.00 | F4 wins |
| 60 | 7660 | 7.47 | 5.49 | -1.96 | 0.27 | 28 | 0 | 0.00 | F4 wins |
| 120 | 7205 | 10.32 | 6.37 | -3.94 | 0.41 | 28 | 0 | 0.00 | F4 wins |
| 240 | 6430 | 12.44 | 7.38 | -5.01 | 0.80 | 28 | 0 | 0.00 | F4 wins |

## F5a: + water_ride_x_temp (day-profile only)

### Recipe comparison

| horizon | A_mae | B_mae | paired_mean | half_width_95 | wins_B | wins_A | sign_test_p | verdict |
|---|---|---|---|---|---|---|---|---|
| 30 | 4.65 | 4.65 | 0.00 | 0.00 | 0 | 0 |  | noise |
| 60 | 5.08 | 5.08 | 0.00 | 0.00 | 0 | 0 |  | noise |
| 120 | 5.54 | 5.54 | 0.00 | 0.00 | 0 | 0 |  | noise |
| 240 | 6.06 | 6.06 | 0.00 | 0.00 | 0 | 0 |  | noise |
| day_profile | 6.02 | 6.00 | -0.02 | 0.03 | 18 | 10 | 0.18 | noise |

### Classifiers (recipe B vs arm, same rows)

|  | n | base_rate | B_auc | F5a_auc | B_ap | F5a_ap | B_top_decile | F5a_top_decile | top_decile_change |
|---|---|---|---|---|---|---|---|---|---|
| p_fall_30 | 94188 | 0.22 | 0.87 | 0.87 | 0.63 | 0.63 | 0.71 | 0.71 | 0 |
| p_fall_60 | 88808 | 0.27 | 0.88 | 0.88 | 0.72 | 0.72 | 0.82 | 0.82 | 0 |
| p_rise_30 | 94188 | 0.24 | 0.84 | 0.84 | 0.63 | 0.63 | 0.73 | 0.73 | 0 |
| p_rise_60 | 88808 | 0.29 | 0.84 | 0.84 | 0.69 | 0.69 | 0.80 | 0.80 | 0 |

## F5b: + soak_ride_x_temp (day-profile only)

### Recipe comparison

| horizon | A_mae | B_mae | paired_mean | half_width_95 | wins_B | wins_A | sign_test_p | verdict |
|---|---|---|---|---|---|---|---|---|
| 30 | 4.65 | 4.65 | 0.00 | 0.00 | 0 | 0 |  | noise |
| 60 | 5.08 | 5.08 | 0.00 | 0.00 | 0 | 0 |  | noise |
| 120 | 5.54 | 5.54 | 0.00 | 0.00 | 0 | 0 |  | noise |
| 240 | 6.06 | 6.06 | 0.00 | 0.00 | 0 | 0 |  | noise |
| day_profile | 6.02 | 6.00 | -0.02 | 0.03 | 17 | 11 | 0.34 | noise |

### Classifiers (recipe B vs arm, same rows)

|  | n | base_rate | B_auc | F5b_auc | B_ap | F5b_ap | B_top_decile | F5b_top_decile | top_decile_change |
|---|---|---|---|---|---|---|---|---|---|
| p_fall_30 | 94188 | 0.22 | 0.87 | 0.87 | 0.63 | 0.63 | 0.71 | 0.71 | 0 |
| p_fall_60 | 88808 | 0.27 | 0.88 | 0.88 | 0.72 | 0.72 | 0.82 | 0.82 | 0 |
| p_rise_30 | 94188 | 0.24 | 0.84 | 0.84 | 0.63 | 0.63 | 0.73 | 0.73 | 0 |
| p_rise_60 | 88808 | 0.29 | 0.84 | 0.84 | 0.69 | 0.69 | 0.80 | 0.80 | 0 |

## Gate

traj_T+60_win: 'B wins' (the arm) at T+60. traj_no_loss: not 'A wins' (recipe B) at T+30/120/240 (F5: at any horizon; their trajectory is recipe B's). p_*_60_ok: top-decile precision not lower by more than 0.01 and AUC not lower at 3 decimals. day_profile: not 'A wins' (F5: must be 'B wins'). F4 'WIN (coverage)': no 'A wins' at any horizon, classifiers ok, and not worse than persistence on the reopen rows at T+30/60/120.

| arm | traj_T+60_win | traj_no_loss | p_fall_60_ok | p_rise_60_ok | day_profile | reopen_vs_persistence | verdict |
|---|---|---|---|---|---|---|---|
| F1 | pass | FAIL | pass | FAIL (auc) | pass |  | FLAT |
| F2 | FAIL | FAIL | pass | pass | pass |  | FLAT |
| F3 | pass | pass | pass | pass | pass |  | WIN |
| F4 | FAIL | FAIL | pass | FAIL (auc) | pass | pass | FLAT |
| F5a | n/a (unchanged) | pass | pass | pass | FAIL (noise) |  | FLAT |
| F5b | n/a (unchanged) | pass | pass | pass | FAIL (noise) |  | FLAT |

## Per-ride T+60: F3 vs recipe B

MAE in minutes; lift_* is % vs persistence; F3_minus_B > 0 = arm worse; F3_vs_B_pct blank when recipe B's MAE < 1.0.

|  | n | persistence | recipe_B | lift_recipe_B | recipe_F3 | lift_recipe_F3 | F3_minus_B | F3_vs_B_pct |
|---|---|---|---|---|---|---|---|---|
| Guardians of the Galaxy - Monsters After Dark | 709 | 17.96 | 14.07 | 21.69 | 14.39 | 19.90 | 0.32 | -2.29 |
| The Little Mermaid - Ariel's Undersea Adventure | 1552 | 8.36 | 6.82 | 18.42 | 6.92 | 17.20 | 0.10 | -1.49 |
| Adventureland Treehouse inspired by Walt Disney’s Swiss Family Robinson | 239 | 0.00 | 0.03 |  | 0.12 |  | 0.09 |  |
| Inside Out Emotional Whirlwind | 1400 | 4.03 | 3.86 | 4.25 | 3.93 | 2.49 | 0.07 | -1.83 |
| Millennium Falcon: Smugglers Run | 2221 | 9.16 | 7.39 | 19.37 | 7.44 | 18.78 | 0.05 | -0.73 |
| Matterhorn Bobsleds | 1889 | 10.43 | 7.95 | 23.76 | 8.00 | 23.34 | 0.04 | -0.56 |
| Pixar Pal-A-Round - Swinging | 1463 | 6.58 | 5.87 | 10.85 | 5.91 | 10.27 | 0.04 | -0.65 |
| Peter Pan's Flight | 1703 | 4.63 | 3.99 | 13.78 | 4.02 | 13.21 | 0.03 | -0.66 |
| Roger Rabbit's Car Toon Spin | 1165 | 11.61 | 8.37 | 27.84 | 8.40 | 27.64 | 0.02 | -0.28 |
| Silly Symphony Swings | 1291 | 1.70 | 1.68 | 1.14 | 1.71 | -0.10 | 0.02 | -1.25 |
| Mad Tea Party | 435 | 2.29 | 1.93 | 15.57 | 1.95 | 14.65 | 0.02 | -1.09 |
| Davy Crockett's Explorer Canoes | 223 | 0.54 | 0.57 | -5.32 | 0.58 | -8.60 | 0.02 |  |
| Autopia | 2220 | 9.73 | 7.56 | 22.29 | 7.58 | 22.13 | 0.02 | -0.21 |
| Pirates of the Caribbean | 1981 | 5.47 | 4.34 | 20.72 | 4.35 | 20.47 | 0.01 | -0.32 |
| Pirate's Lair on Tom Sawyer Island | 903 | 0.00 | 0.01 |  | 0.02 |  | 0.01 |  |
| Finding Nemo Submarine Voyage | 2210 | 5.15 | 4.31 | 16.27 | 4.32 | 16.01 | 0.01 | -0.31 |
| Casey Jr. Circus Train | 2063 | 3.05 | 2.58 | 15.37 | 2.60 | 14.95 | 0.01 | -0.49 |
| Mickey's PhilharMagic | 1346 | 0.00 | 0.01 |  | 0.02 |  | 0.01 |  |
| "it's a small world" | 1918 | 3.32 | 2.94 | 11.33 | 2.95 | 10.99 | 0.01 | -0.39 |
| Pinocchio's Daring Journey | 1810 | 2.89 | 2.60 | 9.98 | 2.61 | 9.60 | 0.01 | -0.42 |
| Star Wars: Rise of the Resistance | 1644 | 11.48 | 8.55 | 25.54 | 8.56 | 25.46 | 0.01 | -0.11 |
| Jessie's Critter Carousel | 1455 | 0.08 | 0.11 | -29.64 | 0.11 | -38.65 | 0.01 |  |
| Games of Pixar Pier | 833 | 0.00 | 0.03 |  | 0.03 |  | 0.01 |  |
| Disneyland Railroad | 1914 | 0.68 | 0.71 | -3.36 | 0.71 | -3.65 | 0.00 |  |
| Soarin’ Across America | 1679 | 11.14 | 8.22 | 26.23 | 8.22 | 26.23 | 0.00 | -0.00 |
| King Arthur Carrousel | 1916 | 1.13 | 1.08 | 4.79 | 1.08 | 4.81 | -0.00 | 0.03 |
| Alice in Wonderland | 1628 | 4.76 | 4.02 | 15.51 | 4.02 | 15.53 | -0.00 | 0.02 |
| Redwood Creek Challenge Trail | 1049 | 0.00 | 0.02 |  | 0.02 |  | -0.00 |  |
| Chip 'n' Dale's GADGETcoaster | 1913 | 7.15 | 5.83 | 18.54 | 5.82 | 18.58 | -0.00 | 0.05 |
| Snow White's Enchanted Wish | 1985 | 3.56 | 3.11 | 12.78 | 3.10 | 12.90 | -0.00 | 0.14 |
| Sailing Ship Columbia | 47 | 0.00 | 0.15 |  | 0.14 |  | -0.01 |  |
| Jungle Cruise | 1990 | 5.94 | 4.67 | 21.51 | 4.66 | 21.65 | -0.01 | 0.17 |
| Mark Twain Riverboat | 1303 | 0.01 | 0.04 | -252.37 | 0.03 | -172.02 | -0.01 |  |
| Disneyland Monorail | 985 | 1.47 | 1.55 | -5.76 | 1.54 | -5.12 | -0.01 | 0.61 |
| Mr. Toad's Wild Ride | 1722 | 3.65 | 3.33 | 8.68 | 3.32 | 8.97 | -0.01 | 0.31 |
| Jumpin' Jellyfish | 1618 | 2.37 | 2.39 | -0.88 | 2.38 | -0.44 | -0.01 | 0.44 |
| Storybook Land Canal Boats | 2098 | 4.47 | 3.98 | 11.00 | 3.96 | 11.34 | -0.01 | 0.38 |
| The Many Adventures of Winnie the Pooh | 1901 | 4.99 | 4.06 | 18.75 | 4.04 | 19.08 | -0.02 | 0.41 |
| Guardians of the Galaxy - Mission: BREAKOUT! | 739 | 15.15 | 13.16 | 13.14 | 13.14 | 13.25 | -0.02 | 0.13 |
| Pixar Pal-A-Round – Non-Swinging | 1452 | 7.17 | 6.32 | 11.87 | 6.30 | 12.13 | -0.02 | 0.30 |
| Space Mountain | 1832 | 12.66 | 9.16 | 27.65 | 9.14 | 27.80 | -0.02 | 0.21 |
| Toy Story Midway Mania! | 1508 | 10.16 | 7.35 | 27.68 | 7.33 | 27.87 | -0.02 | 0.27 |
| Dumbo the Flying Elephant | 2159 | 5.22 | 4.23 | 18.96 | 4.21 | 19.37 | -0.02 | 0.50 |
| Mater's Graveyard JamBOOree | 1662 | 6.05 | 5.36 | 11.40 | 5.33 | 11.82 | -0.03 | 0.47 |
| Big Thunder Mountain Railroad | 1804 | 7.38 | 5.79 | 21.47 | 5.77 | 21.82 | -0.03 | 0.45 |
| Astro Orbitor | 2114 | 6.28 | 5.67 | 9.62 | 5.65 | 10.05 | -0.03 | 0.48 |
| Golden Zephyr | 972 | 1.15 | 1.21 | -5.49 | 1.18 | -3.10 | -0.03 | 2.26 |
| Goofy's Sky School | 1138 | 10.04 | 7.73 | 22.99 | 7.70 | 23.30 | -0.03 | 0.40 |
| Incredicoaster | 1332 | 7.92 | 6.54 | 17.45 | 6.51 | 17.88 | -0.03 | 0.53 |
| Star Tours - The Adventures Continue | 2226 | 5.88 | 4.76 | 18.99 | 4.72 | 19.68 | -0.04 | 0.85 |
| WEB SLINGERS: A Spider-Man Adventure | 1187 | 10.94 | 8.23 | 24.76 | 8.19 | 25.20 | -0.05 | 0.58 |
| Buzz Lightyear Astro Blasters | 2148 | 5.99 | 4.72 | 21.20 | 4.66 | 22.13 | -0.06 | 1.18 |
| Luigi's Honkin' Haul-O-Ween | 831 | 7.33 | 6.67 | 9.08 | 6.59 | 10.15 | -0.08 | 1.17 |
| Mickey & Minnie's Runaway Railway | 1693 | 8.82 | 6.53 | 26.01 | 6.45 | 26.90 | -0.08 | 1.20 |
| Tiana's Bayou Adventure | 1542 | 9.15 | 7.14 | 21.92 | 7.04 | 22.98 | -0.10 | 1.36 |
| Monsters, Inc. Mike & Sulley to the Rescue! | 1379 | 11.46 | 8.36 | 27.06 | 8.26 | 27.93 | -0.10 | 1.20 |
| Grizzly River Run | 1273 | 8.74 | 7.58 | 13.22 | 7.39 | 15.48 | -0.20 | 2.60 |
| Haunted Mansion Holiday | 2082 | 11.77 | 9.37 | 20.35 | 9.15 | 22.27 | -0.23 | 2.42 |
| Radiator Springs Racers | 1314 | 16.30 | 13.69 | 16.04 | 13.10 | 19.62 | -0.58 | 4.27 |

## Decisions

- F1: FLAT -> the round stops here (spec decision 2); later winners do not ship.
- F2: FLAT.
- F3: arm F3 WIN, but after the first flat (F1) -> does not ship this round.
- F4: FLAT.
- F5: FLAT.

**Closed candidates (for `ml_feature_gaps.md`):**

- **F1** (+ n_operating_rides_park, n_headliners_down (trajectory, classifiers, day-profile)): FLAT on traj_no_loss, p_rise_60_ok. Forward numbers (paired mean daily MAE arm − B, ± 95% half-width): T+30 +0.019 ± 0.011 (A wins); T+60 -0.014 ± 0.009 (B wins); T+120 +0.008 ± 0.013 (noise); T+240 +0.025 ± 0.034 (noise); day-profile -0.029 ± 0.041 (noise). p_fall_60 AUC 0.882→0.882, top-decile 0.817→0.817; p_rise_60 AUC 0.842→0.841, top-decile 0.798→0.797.
- **F2** (+ last_updated_age_min, posting_tier_cat (trajectory, classifiers)): FLAT on traj_T+60_win, traj_no_loss. Forward numbers (paired mean daily MAE arm − B, ± 95% half-width): T+30 +0.013 ± 0.005 (A wins); T+60 +0.008 ± 0.007 (A wins); T+120 +0.031 ± 0.013 (A wins); T+240 -0.021 ± 0.045 (noise); day-profile +0.000 ± 0.000 (noise). p_fall_60 AUC 0.882→0.882, top-decile 0.817→0.814; p_rise_60 AUC 0.842→0.842, top-decile 0.798→0.798.
- **F4** (+ lags_missing; filled lags, widened training_valid_tN_f rows (trajectory, classifiers)): FLAT on traj_T+60_win, traj_no_loss, p_rise_60_ok. Forward numbers (paired mean daily MAE arm − B, ± 95% half-width): T+30 -0.015 ± 0.011 (B wins); T+60 -0.007 ± 0.009 (noise); T+120 +0.029 ± 0.019 (A wins); T+240 +0.034 ± 0.040 (noise); day-profile +0.000 ± 0.000 (noise). p_fall_60 AUC 0.882→0.882, top-decile 0.817→0.816; p_rise_60 AUC 0.842→0.840, top-decile 0.798→0.797.
- **F5a** (+ water_ride_x_temp (day-profile only)): FLAT on day_profile. Forward numbers (paired mean daily MAE arm − B, ± 95% half-width): T+30 +0.000 ± 0.000 (noise); T+60 +0.000 ± 0.000 (noise); T+120 +0.000 ± 0.000 (noise); T+240 +0.000 ± 0.000 (noise); day-profile -0.023 ± 0.031 (noise). p_fall_60 AUC 0.882→0.882, top-decile 0.817→0.817; p_rise_60 AUC 0.842→0.842, top-decile 0.798→0.798.
- **F5b** (+ soak_ride_x_temp (day-profile only)): FLAT on day_profile. Forward numbers (paired mean daily MAE arm − B, ± 95% half-width): T+30 +0.000 ± 0.000 (noise); T+60 +0.000 ± 0.000 (noise); T+120 +0.000 ± 0.000 (noise); T+240 +0.000 ± 0.000 (noise); day-profile -0.023 ± 0.027 (noise). p_fall_60 AUC 0.882→0.882, top-decile 0.817→0.817; p_rise_60 AUC 0.842→0.842, top-decile 0.798→0.798.

**Won but blocked by the stop rule:** F3. Not in recipe C; the owner decides whether to ship it anyway or re-test it in the next round.

**No winner ships: RECIPE_C is not created; serving and export are unchanged.**
