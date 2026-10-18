# Session 3 crowd-feature variants — 2026-10-16

- Frame: `df_features_cache.pkl` 940,817 rows, 2026-05-02 to 2026-10-15
- Forward split, 4 weeks: train 139 days, test 28 days; expected tables fit on train days only (V0 excepted).
- Day-profile MAE columns are Recipe A; 'serving' replaces the crowd features with each day's (and park's) 13:00 value, as `_build_full_day` does. DCA / DL are serving-style MAE by park.
- Paired: mean of daily MAE(variant) − MAE(reference) on serving-style day-profile, ± 95% half-width; negative = variant better. p = sign test on daily wins.
- Morning variants: trajectory horizons [30, 60, 120] (trajectory does not read morning_crowd_index).

## Variants

| variant | dp_mae_frame | dp_mae_serving | dca_dp_mae | dl_dp_mae | T+30_mae | T+60_mae | T+120_mae | paired_vs | paired_mean | half_width_95 | sign_test_p |
|---|---|---|---|---|---|---|---|---|---|---|---|
| V0 | 6.77 | 7.09 | 8.53 | 6.34 | 4.85 | 5.34 | 5.94 | V1 | 0.64 | 0.22 | 0.00 |
| V1 | 5.97 | 6.45 | 6.82 | 6.25 | 4.85 | 5.33 | 5.91 | — |  |  |  |
| V2 | 5.68 | 6.34 | 6.80 | 6.10 | 4.85 | 5.31 | 5.89 | V1 | -0.10 | 0.14 | 0.34 |
| M0 | 5.97 | 6.45 | 6.82 | 6.25 | 4.85 | 5.33 | 5.91 | M2 | 0.04 | 0.03 | 0.09 |
| M1 | 5.84 | 6.37 | 6.74 | 6.17 | 4.85 | 5.33 | 5.91 | M2 | -0.04 | 0.09 | 0.34 |
| M1b | 5.84 | 6.38 | 6.81 | 6.15 | 4.85 | 5.33 | 5.91 | M2 | -0.03 | 0.05 | 0.18 |
| M2 | 5.95 | 6.41 | 6.82 | 6.19 | 4.85 | 5.33 | 5.91 | — |  |  |  |

## Decisions

**V0 reference:** serving-style 7.093 vs 7.09 in `reports/eval/2026-10-16_clean.md` (match, tolerance 0.05); frame-features 6.765 vs 6.77.

**Ratio → V1.** V2 vs V1 serving-style paired -0.103 ± 0.141 (beats half-width: False); DCA MAE V2 6.800 vs V1 6.824 (improves: True); DCA-only paired -0.016 ± 0.171. Spec's stricter reading (DCA also beyond its half-width) would pick V1.

**Morning → M2.** Better of M1/M1b by serving MAE: M1 (6.367); vs M2 paired -0.039 ± 0.087 (beats half-width: False). M0 vs M2 paired +0.039 ± 0.033.

## Day-profile serving-style MAE by hour, V1 vs V2

| hour_of_day | V1_all | V2_all | V1_dca | V1_dl | V2_dca | V2_dl | V2_minus_V1_dca |
|---|---|---|---|---|---|---|---|
| 8 | 7.60 | 8.13 | 8.34 | 7.14 | 9.11 | 7.52 | 0.77 |
| 9 | 6.77 | 6.74 | 7.00 | 6.63 | 7.05 | 6.55 | 0.05 |
| 10 | 5.58 | 5.53 | 5.82 | 5.43 | 5.81 | 5.34 | -0.00 |
| 11 | 5.83 | 5.72 | 6.06 | 5.68 | 5.99 | 5.54 | -0.07 |
| 12 | 5.76 | 5.59 | 6.01 | 5.60 | 5.81 | 5.44 | -0.20 |
| 13 | 5.49 | 5.44 | 5.75 | 5.32 | 5.70 | 5.26 | -0.05 |
| 14 | 5.50 | 5.42 | 5.92 | 5.23 | 5.92 | 5.10 | 0.00 |
| 15 | 6.01 | 5.88 | 6.70 | 5.55 | 6.79 | 5.28 | 0.09 |
| 16 | 6.26 | 6.19 | 6.63 | 6.02 | 6.77 | 5.81 | 0.15 |
| 17 | 6.81 | 6.64 | 7.41 | 6.42 | 7.47 | 6.11 | 0.07 |
| 18 | 7.27 | 6.86 | 7.24 | 7.28 | 6.84 | 6.87 | -0.40 |
| 19 | 8.54 | 8.17 | 9.14 | 8.31 | 8.65 | 7.99 | -0.50 |
| 20 | 8.29 | 8.03 | 9.60 | 7.84 | 9.03 | 7.68 | -0.58 |
| 21 | 7.00 | 6.97 | 8.67 | 6.79 | 8.52 | 6.78 | -0.15 |
| 22 | 5.53 | 5.51 |  | 5.53 |  | 5.51 |  |
| 23 | 4.27 | 3.80 |  | 4.27 |  | 3.80 |  |

## Headliners (median OPERATING wait over train days ≥ 20: 24; ≥ 30: 18)

| ride_name | park_name | ride_id | ge_30 |
|---|---|---|---|
| Goofy's Sky School | Disney California Adventure Park | f44a5072-3cda-4c7c-8574-33ad09d16cca | True |
| Grizzly River Run | Disney California Adventure Park | b1d285a7-2444-4a7c-b7bb-d2d4d6428a85 | False |
| Guardians of the Galaxy - Mission: BREAKOUT! | Disney California Adventure Park | b7678dab-5544-48d5-8fdc-c1a0127cfbcd | True |
| Guardians of the Galaxy - Monsters After Dark | Disney California Adventure Park | 2108cc58-80df-4fff-9b91-735e89873ffd | True |
| Incredicoaster | Disney California Adventure Park | 5d07a2b1-49ca-4de7-9d32-6d08edf69b08 | True |
| Monsters, Inc. Mike & Sulley to the Rescue! | Disney California Adventure Park | 40524fba-5d84-49e7-9204-f493dbe2d5a4 | True |
| Pixar Pal-A-Round - Swinging | Disney California Adventure Park | 528016ef-db24-47fa-a0f2-b6d26d61e29f | False |
| Radiator Springs Racers | Disney California Adventure Park | c60c768b-3461-465c-8f4f-b44b087506fc | True |
| Soarin' Over California | Disney California Adventure Park | 77f205a4-d482-4d91-a5ff-71e54a086ad2 | True |
| Toy Story Midway Mania! | Disney California Adventure Park | 86ab3069-110d-49c5-a7e7-29ddf28695a6 | True |
| WEB SLINGERS: A Spider-Man Adventure | Disney California Adventure Park | 2295351d-ce6b-4c04-92d5-5b416372c5b5 | True |
| Alice in Wonderland | Disneyland Park | a07f3110-013e-43bb-a182-e66bb8b5e28d | False |
| Big Thunder Mountain Railroad | Disneyland Park | 0de1413a-73ee-46cf-af2e-c491cc7c7d3b | True |
| Chip 'n' Dale's GADGETcoaster | Disneyland Park | 59647168-d239-4161-8b24-92eb128e96fb | False |
| Dumbo the Flying Elephant | Disneyland Park | cc980e8e-192f-48b6-848c-27784084e54b | False |
| Haunted Mansion | Disneyland Park | ff52cb64-c1d5-4feb-9d43-5dbd429bac81 | True |
| Hyperspace Mountain | Disneyland Park | 9167db1d-e5e7-46da-a07f-ae30a87bc4c4 | True |
| Indiana Jones™ Adventure | Disneyland Park | 2aedc657-1ee2-4545-a1ce-14753f28cc66 | True |
| Matterhorn Bobsleds | Disneyland Park | faaa8be9-cc1e-4535-ac20-04a535654bd0 | True |
| Mickey & Minnie's Runaway Railway | Disneyland Park | cd670bff-81d1-4f34-8676-7bafdf49220a | False |
| Peter Pan's Flight | Disneyland Park | c23af6ba-8515-406a-8a48-d0818ba0bfc9 | True |
| Roger Rabbit's Car Toon Spin | Disneyland Park | 6ce9cdd1-0a43-459e-83cd-f4cace9cfa7b | True |
| Star Wars: Rise of the Resistance | Disneyland Park | 34b1d70f-11c4-42df-935e-d5582c9f1a8e | True |
| Tiana's Bayou Adventure | Disneyland Park | a9076acd-7630-4bad-a8da-e6bd689ddcac | True |
