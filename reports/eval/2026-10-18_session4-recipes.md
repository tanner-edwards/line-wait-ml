# Session 4 recipe experiment — 2026-10-18

- Frame: `df_features_cache.pkl` 940,817 rows, 2026-05-02 to 2026-10-15
- Forward split, 4 weeks: train 139 days, test 28 days. Horizons [30, 60, 120, 240].
- Every arm is scored against Recipe A on identical rows. paired_mean = mean daily MAE(arm) − MAE(A); negative = arm better. Verdict: a side wins when the mean favors it and clears the 95% half-width or the sign test has p < 0.05; otherwise noise. day_profile rows are serving-style.
- Trajectory arms leave day-profile at A and D arms leave trajectory at A (those rows are exact ties).
- Run time: B0 28s, B1 28s, B2 68s, B3 65s, B4 70s, D1 29s, D2 29s.

## B0: A + delta trajectory target

| horizon | A_mae | B_mae | paired_mean | half_width_95 | wins_B | wins_A | sign_test_p | verdict |
|---|---|---|---|---|---|---|---|---|
| 30 | 4.86 | 4.81 | -0.05 | 0.02 | 20 | 8 | 0.04 | B wins |
| 60 | 5.33 | 5.45 | 0.11 | 0.04 | 3 | 25 | 0.00 | A wins |
| 120 | 5.88 | 5.99 | 0.10 | 0.04 | 3 | 25 | 0.00 | A wins |
| 240 | 6.87 | 6.50 | -0.35 | 0.17 | 20 | 8 | 0.04 | B wins |
| day_profile | 6.41 | 6.41 | 0.00 | 0.00 | 0 | 0 |  | noise |

## B1: B0 − week_of_year (trajectory)

| horizon | A_mae | B_mae | paired_mean | half_width_95 | wins_B | wins_A | sign_test_p | verdict |
|---|---|---|---|---|---|---|---|---|
| 30 | 4.86 | 4.85 | -0.01 | 0.03 | 14 | 14 | 1.00 | noise |
| 60 | 5.33 | 5.42 | 0.09 | 0.04 | 3 | 25 | 0.00 | A wins |
| 120 | 5.88 | 6.03 | 0.15 | 0.05 | 4 | 24 | 0.00 | A wins |
| 240 | 6.87 | 6.48 | -0.36 | 0.20 | 20 | 8 | 0.04 | B wins |
| day_profile | 6.41 | 6.41 | 0.00 | 0.00 | 0 | 0 |  | noise |

## B2: B1 + trajectory 600 trees × 63 leaves

| horizon | A_mae | B_mae | paired_mean | half_width_95 | wins_B | wins_A | sign_test_p | verdict |
|---|---|---|---|---|---|---|---|---|
| 30 | 4.86 | 4.73 | -0.13 | 0.02 | 28 | 0 | 0.00 | B wins |
| 60 | 5.33 | 5.19 | -0.14 | 0.03 | 28 | 0 | 0.00 | B wins |
| 120 | 5.88 | 5.68 | -0.20 | 0.04 | 28 | 0 | 0.00 | B wins |
| 240 | 6.87 | 6.23 | -0.62 | 0.20 | 27 | 1 | 0.00 | B wins |
| day_profile | 6.41 | 6.41 | 0.00 | 0.00 | 0 | 0 |  | noise |

## B3: B2 + minutes_until_close (trajectory)

| horizon | A_mae | B_mae | paired_mean | half_width_95 | wins_B | wins_A | sign_test_p | verdict |
|---|---|---|---|---|---|---|---|---|
| 30 | 4.86 | 4.66 | -0.20 | 0.03 | 28 | 0 | 0.00 | B wins |
| 60 | 5.33 | 5.14 | -0.19 | 0.03 | 28 | 0 | 0.00 | B wins |
| 120 | 5.88 | 5.61 | -0.27 | 0.04 | 28 | 0 | 0.00 | B wins |
| 240 | 6.87 | 6.08 | -0.77 | 0.20 | 28 | 0 | 0.00 | B wins |
| day_profile | 6.41 | 6.41 | 0.00 | 0.00 | 0 | 0 |  | noise |

## B4: B3 with week_of_year kept (trajectory, 22 features)

| horizon | A_mae | B_mae | paired_mean | half_width_95 | wins_B | wins_A | sign_test_p | verdict |
|---|---|---|---|---|---|---|---|---|
| 30 | 4.86 | 4.70 | -0.16 | 0.02 | 28 | 0 | 0.00 | B wins |
| 60 | 5.33 | 5.13 | -0.20 | 0.03 | 28 | 0 | 0.00 | B wins |
| 120 | 5.88 | 5.60 | -0.28 | 0.04 | 28 | 0 | 0.00 | B wins |
| 240 | 6.87 | 6.14 | -0.71 | 0.17 | 26 | 2 | 0.00 | B wins |
| day_profile | 6.41 | 6.41 | 0.00 | 0.00 | 0 | 0 |  | noise |

## D1: A with day-profile 600 × 63

| horizon | A_mae | B_mae | paired_mean | half_width_95 | wins_B | wins_A | sign_test_p | verdict |
|---|---|---|---|---|---|---|---|---|
| 30 | 4.86 | 4.86 | 0.00 | 0.00 | 0 | 0 |  | noise |
| 60 | 5.33 | 5.33 | 0.00 | 0.00 | 0 | 0 |  | noise |
| 120 | 5.88 | 5.88 | 0.00 | 0.00 | 0 | 0 |  | noise |
| 240 | 6.87 | 6.87 | 0.00 | 0.00 | 0 | 0 |  | noise |
| day_profile | 6.41 | 6.13 | -0.27 | 0.07 | 27 | 1 | 0.00 | B wins |

## D2: D1 − week_of_year (day-profile)

| horizon | A_mae | B_mae | paired_mean | half_width_95 | wins_B | wins_A | sign_test_p | verdict |
|---|---|---|---|---|---|---|---|---|
| 30 | 4.86 | 4.86 | 0.00 | 0.00 | 0 | 0 |  | noise |
| 60 | 5.33 | 5.33 | 0.00 | 0.00 | 0 | 0 |  | noise |
| 120 | 5.88 | 5.88 | 0.00 | 0.00 | 0 | 0 |  | noise |
| 240 | 6.87 | 6.87 | 0.00 | 0.00 | 0 | 0 |  | noise |
| day_profile | 6.41 | 6.33 | -0.07 | 0.05 | 20 | 8 | 0.04 | B wins |

## Decisions

**Why the rules changed (2026-10-18):** the first run's rule picked D2 although D1 beat it head-to-head by 0.20 MAE on 26 of 28 days, and dropping week_of_year from trajectory (B1 vs B0) was itself a small loss at T+30 and T+120. The forward test weeks (38–41) were unseen in training, so the holdout already measures the extrapolation case the "week_of_year can't generalize" prior worried about. week_of_year is now tested both ways on both models and the holdout decides.

**Trajectory rule:** the first of B0, B1, B2, B3 with 'B wins' at T+30, T+60 and T+120 and not 'A wins' at T+240; B3 over B2 only if its T+60 paired mean is lower by more than B2's half-width; none → A. If that pick is B3, B4 (week_of_year kept) replaces it only if B4 vs B3 head-to-head is 'new wins' at T+30, T+60 and T+120 and not 'old wins' at T+240; otherwise B3.

- B0: T+30 B wins, T+60 A wins, T+120 A wins, T+240 B wins -> does not qualify
- B1: T+30 noise, T+60 A wins, T+120 A wins, T+240 B wins -> does not qualify
- B2: T+30 B wins, T+60 B wins, T+120 B wins, T+240 B wins -> qualifies
- B3: T+30 B wins, T+60 B wins, T+120 B wins, T+240 B wins -> qualifies
- B2 and B3 both qualify: T+60 paired mean B3 -0.193 vs B2 -0.136 (margin 0.057 vs B2 half-width 0.028) -> B3
- B4 vs B3 head-to-head (week_of_year kept vs dropped): T+30 old wins, T+60 noise, T+120 noise, T+240 noise -> B3 (week_of_year stays dropped)

**Trajectory → B3.**

**Day-profile rule:** candidates are D1 and D2 with 'B wins' vs A on the day_profile row. If both qualify, the D2-vs-D1 head-to-head verdict decides ('noise' → D2, the simpler); one → that one; none → A.

- D1 vs A: day_profile paired -0.273 ± 0.068, sign p 2.16e-07 -> B wins
- D2 vs A: day_profile paired -0.071 ± 0.046, sign p 0.0357 -> B wins
- D2 vs D1 head-to-head: paired +0.201 ± 0.050, D2 wins 2 / D1 wins 26 days, sign p 3.03e-06 -> D1 wins

**Day-profile → D1.**

## Step-by-step

Each trajectory arm against the arm before it, plus B4 vs B3, same rows. Negative = the newer arm is better. The B4-vs-B3 rows feed the trajectory rule; the rest are context.

|  | paired_mean | half_width_95 | wins_new | wins_old | sign_test_p | verdict |
|---|---|---|---|---|---|---|
| ('B0 vs A', 30) | -0.05 | 0.02 | 20 | 8 | 0.04 | new wins |
| ('B0 vs A', 60) | 0.11 | 0.04 | 3 | 25 | 0.00 | old wins |
| ('B0 vs A', 120) | 0.10 | 0.04 | 3 | 25 | 0.00 | old wins |
| ('B0 vs A', 240) | -0.35 | 0.17 | 20 | 8 | 0.04 | new wins |
| ('B1 vs B0', 30) | 0.04 | 0.01 | 1 | 27 | 0.00 | old wins |
| ('B1 vs B0', 60) | -0.02 | 0.01 | 21 | 7 | 0.01 | new wins |
| ('B1 vs B0', 120) | 0.05 | 0.03 | 6 | 22 | 0.00 | old wins |
| ('B1 vs B0', 240) | -0.02 | 0.05 | 15 | 13 | 0.85 | noise |
| ('B2 vs B1', 30) | -0.12 | 0.02 | 28 | 0 | 0.00 | new wins |
| ('B2 vs B1', 60) | -0.23 | 0.03 | 28 | 0 | 0.00 | new wins |
| ('B2 vs B1', 120) | -0.35 | 0.04 | 28 | 0 | 0.00 | new wins |
| ('B2 vs B1', 240) | -0.26 | 0.07 | 25 | 3 | 0.00 | new wins |
| ('B3 vs B2', 30) | -0.07 | 0.02 | 27 | 1 | 0.00 | new wins |
| ('B3 vs B2', 60) | -0.06 | 0.01 | 27 | 1 | 0.00 | new wins |
| ('B3 vs B2', 120) | -0.08 | 0.02 | 25 | 3 | 0.00 | new wins |
| ('B3 vs B2', 240) | -0.15 | 0.04 | 26 | 2 | 0.00 | new wins |
| ('B4 vs B3', 30) | 0.04 | 0.01 | 3 | 25 | 0.00 | old wins |
| ('B4 vs B3', 60) | -0.01 | 0.01 | 15 | 13 | 0.85 | noise |
| ('B4 vs B3', 120) | -0.01 | 0.03 | 15 | 13 | 0.85 | noise |
| ('B4 vs B3', 240) | 0.06 | 0.07 | 12 | 16 | 0.57 | noise |

## Per-ride T+60: A vs final B (trajectory side = B3)

MAE in minutes; lift_* is % vs persistence; B_minus_A is MAE(B) − MAE(A) in minutes (positive = B worse); B_vs_A_pct is % MAE improvement of B over A, blank when A's MAE < 1.0.

### Call-outs

| ride_name | n | persistence | recipe_A | lift_recipe_A | recipe_B3 | lift_recipe_B3 | B_minus_A | B_vs_A_pct |
|---|---|---|---|---|---|---|---|---|
| Space Mountain | 1872 | 12.48 | 9.32 | 25.31 | 8.99 | 27.90 | -0.32 | 3.47 |
| Radiator Springs Racers | 1335 | 16.06 | 14.85 | 7.51 | 13.89 | 13.53 | -0.97 | 6.50 |
| Haunted Mansion Holiday | 2120 | 11.79 | 10.92 | 7.45 | 9.94 | 15.76 | -0.98 | 8.98 |

No T+60 scoring rows in the test window (closed or in refurbishment throughout): Indiana Jones.

### All rides (worst B_minus_A first)

| ride_name | n | persistence | recipe_A | lift_recipe_A | recipe_B3 | lift_recipe_B3 | B_minus_A | B_vs_A_pct |
|---|---|---|---|---|---|---|---|---|
| Silly Symphony Swings | 1378 | 1.66 | 1.59 | 4.49 | 1.67 | -0.26 | 0.08 | -4.98 |
| Golden Zephyr | 994 | 1.06 | 1.09 | -2.32 | 1.13 | -6.66 | 0.05 | -4.25 |
| Mickey's PhilharMagic | 1283 | 0.00 | 0.00 |  | 0.04 |  | 0.04 |  |
| Mark Twain Riverboat | 1354 | 0.01 | 0.02 | -57.77 | 0.05 | -373.61 | 0.03 |  |
| Games of Pixar Pier | 961 | 0.00 | 0.00 |  | 0.03 |  | 0.03 |  |
| Redwood Creek Challenge Trail | 1033 | 0.00 | 0.00 |  | 0.02 |  | 0.02 |  |
| Disneyland Railroad | 1939 | 0.72 | 0.74 | -3.81 | 0.77 | -6.79 | 0.02 |  |
| Pirate's Lair on Tom Sawyer Island | 908 | 0.00 | 0.00 |  | 0.02 |  | 0.02 |  |
| Davy Crockett's Explorer Canoes | 264 | 0.27 | 0.28 | -5.13 | 0.29 | -9.01 | 0.01 |  |
| Jessie's Critter Carousel | 1487 | 0.15 | 0.17 | -11.28 | 0.18 | -17.91 | 0.01 |  |
| Mr. Toad's Wild Ride | 1784 | 3.54 | 3.24 | 8.56 | 3.24 | 8.60 | -0.00 | 0.05 |
| King Arthur Carrousel | 1893 | 1.38 | 1.31 | 5.11 | 1.29 | 6.50 | -0.02 | 1.45 |
| Buzz Lightyear Astro Blasters | 2092 | 6.14 | 4.89 | 20.42 | 4.87 | 20.78 | -0.02 | 0.45 |
| Astro Orbitor | 2099 | 6.31 | 5.52 | 12.55 | 5.49 | 12.98 | -0.03 | 0.50 |
| Disneyland Monorail | 1110 | 1.32 | 1.48 | -12.66 | 1.45 | -10.29 | -0.03 | 2.10 |
| Peter Pan's Flight | 1720 | 4.64 | 4.10 | 11.70 | 4.06 | 12.43 | -0.03 | 0.83 |
| Inside Out Emotional Whirlwind | 1390 | 4.00 | 3.95 | 1.26 | 3.91 | 2.24 | -0.04 | 1.00 |
| Pinocchio's Daring Journey | 1829 | 3.06 | 2.88 | 5.80 | 2.84 | 7.18 | -0.04 | 1.47 |
| Millennium Falcon: Smugglers Run | 2242 | 9.52 | 7.84 | 17.64 | 7.79 | 18.11 | -0.04 | 0.57 |
| Casey Jr. Circus Train | 2061 | 3.40 | 2.88 | 15.17 | 2.84 | 16.51 | -0.05 | 1.58 |
| Jumpin' Jellyfish | 1624 | 2.38 | 2.43 | -2.21 | 2.38 | -0.19 | -0.05 | 1.97 |
| Sailing Ship Columbia | 37 | 0.00 | 0.10 |  | 0.04 |  | -0.06 |  |
| Snow White's Enchanted Wish | 1960 | 3.82 | 3.45 | 9.71 | 3.39 | 11.27 | -0.06 | 1.73 |
| Alice in Wonderland | 1610 | 4.78 | 4.14 | 13.28 | 4.08 | 14.72 | -0.07 | 1.66 |
| Storybook Land Canal Boats | 2117 | 4.36 | 3.84 | 11.84 | 3.77 | 13.51 | -0.07 | 1.89 |
| Star Wars: Rise of the Resistance | 1656 | 11.24 | 8.81 | 21.59 | 8.74 | 22.27 | -0.08 | 0.86 |
| Goofy's Sky School | 1158 | 9.52 | 7.62 | 19.90 | 7.54 | 20.73 | -0.08 | 1.04 |
| The Many Adventures of Winnie the Pooh | 1872 | 5.10 | 4.32 | 15.18 | 4.22 | 17.24 | -0.11 | 2.43 |
| Mickey & Minnie's Runaway Railway | 1732 | 8.77 | 6.63 | 24.39 | 6.49 | 26.01 | -0.14 | 2.14 |
| Big Thunder Mountain Railroad | 1851 | 7.55 | 6.17 | 18.35 | 6.02 | 20.24 | -0.14 | 2.32 |
| "it's a small world" | 1964 | 3.87 | 3.58 | 7.51 | 3.44 | 11.23 | -0.14 | 4.02 |
| Star Tours - The Adventures Continue | 2233 | 5.94 | 4.95 | 16.65 | 4.80 | 19.09 | -0.14 | 2.93 |
| Finding Nemo Submarine Voyage | 2199 | 5.31 | 4.50 | 15.35 | 4.35 | 18.13 | -0.15 | 3.28 |
| Dumbo the Flying Elephant | 2154 | 5.35 | 4.54 | 15.18 | 4.39 | 17.96 | -0.15 | 3.27 |
| Jungle Cruise | 2006 | 5.83 | 4.77 | 18.18 | 4.62 | 20.75 | -0.15 | 3.13 |
| Pirates of the Caribbean | 1982 | 5.30 | 4.34 | 18.21 | 4.17 | 21.27 | -0.16 | 3.75 |
| Autopia | 2230 | 9.76 | 7.98 | 18.21 | 7.80 | 20.09 | -0.18 | 2.30 |
| Pixar Pal-A-Round - Swinging | 1475 | 6.79 | 6.08 | 10.50 | 5.89 | 13.22 | -0.19 | 3.05 |
| Mater's Graveyard JamBOOree | 1677 | 5.98 | 5.34 | 10.65 | 5.13 | 14.26 | -0.22 | 4.04 |
| Chip 'n' Dale's GADGETcoaster | 1973 | 7.04 | 6.04 | 14.19 | 5.81 | 17.51 | -0.23 | 3.86 |
| Tiana's Bayou Adventure | 1535 | 9.48 | 7.51 | 20.78 | 7.25 | 23.51 | -0.26 | 3.45 |
| Roger Rabbit's Car Toon Spin | 1344 | 11.22 | 8.30 | 26.03 | 8.04 | 28.37 | -0.26 | 3.17 |
| Toy Story Midway Mania! | 1563 | 10.10 | 7.56 | 25.14 | 7.29 | 27.82 | -0.27 | 3.58 |
| Soarin’ Across America | 1678 | 11.56 | 9.01 | 22.07 | 8.71 | 24.61 | -0.29 | 3.27 |
| Matterhorn Bobsleds | 1975 | 9.54 | 7.84 | 17.82 | 7.55 | 20.91 | -0.30 | 3.76 |
| Space Mountain | 1872 | 12.48 | 9.32 | 25.31 | 8.99 | 27.90 | -0.32 | 3.47 |
| Luigi's Honkin' Haul-O-Ween | 842 | 6.75 | 6.48 | 4.03 | 6.14 | 9.06 | -0.34 | 5.24 |
| The Little Mermaid - Ariel's Undersea Adventure | 1535 | 8.36 | 7.22 | 13.53 | 6.87 | 17.80 | -0.36 | 4.94 |
| Pixar Pal-A-Round – Non-Swinging | 1464 | 7.12 | 6.67 | 6.23 | 6.30 | 11.47 | -0.37 | 5.59 |
| WEB SLINGERS: A Spider-Man Adventure | 1334 | 10.77 | 8.31 | 22.81 | 7.92 | 26.51 | -0.40 | 4.79 |
| Incredicoaster | 1343 | 8.20 | 7.03 | 14.29 | 6.61 | 19.43 | -0.42 | 6.00 |
| Monsters, Inc. Mike & Sulley to the Rescue! | 1349 | 11.17 | 8.75 | 21.68 | 8.28 | 25.87 | -0.47 | 5.34 |
| Guardians of the Galaxy - Mission: BREAKOUT! | 740 | 14.34 | 13.00 | 9.30 | 12.47 | 13.00 | -0.53 | 4.09 |
| Guardians of the Galaxy - Monsters After Dark | 708 | 16.88 | 14.04 | 16.80 | 13.47 | 20.21 | -0.57 | 4.09 |
| Grizzly River Run | 1356 | 8.96 | 8.47 | 5.52 | 7.74 | 13.60 | -0.72 | 8.55 |
| Radiator Springs Racers | 1335 | 16.06 | 14.85 | 7.51 | 13.89 | 13.53 | -0.97 | 6.50 |
| Haunted Mansion Holiday | 2120 | 11.79 | 10.92 | 7.45 | 9.94 | 15.76 | -0.98 | 8.98 |
| Adventureland Treehouse inspired by Walt Disney’s Swiss Family Robinson | 248 | 0.00 | 5.00 |  | 0.02 |  | -4.98 | 99.57 |

## Final RECIPE_B

Trajectory from B3, day-profile from D1. `ml/recipes.py` RECIPE_B already matches.

```python
name                 = 'B'
trajectory_params    = {'n_estimators': 600, 'num_leaves': 63, 'learning_rate': 0.05, 'objective': 'regression_l1', 'verbose': -1}
day_profile_params   = {'n_estimators': 600, 'num_leaves': 63, 'learning_rate': 0.05, 'objective': 'regression_l1', 'verbose': -1}
trajectory_target    = 'delta'
trajectory_features  = ['wait_minutes', 'wait_lag_1', 'wait_lag_2', 'wait_lag_3', 'wait_delta_1', 'park_crowd_median', 'hour_of_day', 'day_of_week', 'month', 'is_holiday', 'is_holiday_weekend', 'days_until_next_holiday', 'days_since_last_holiday', 'minutes_since_last_status_change', 'closure_duration_minutes', 'minutes_at_current_level', 'wait_regime_danger_zone', 'crowd_level_ratio', 'ride_id_cat', 'status_cat', 'minutes_until_close']  # 21
day_profile_features = ['ride_id_cat', 'hour_of_day', 'day_of_week', 'week_of_year', 'month', 'temp_high_f', 'crowd_level_ratio', 'is_holiday', 'is_holiday_weekend', 'days_until_next_holiday', 'days_since_last_holiday', 'minutes_until_close', 'total_operating_hours', 'had_closure_today', 'max_closure_duration_today_min', 'hours_since_reopen', 'closure_start_hour']  # 17
```
