"""Admin dashboard grading (see dashboard/README.md).

Reads the admin_prediction_runs history that cron/predict.py writes and grades
it with the same functions the forward-holdout scoreboard uses (ml.metrics,
ml.clean, cron/crowd_features.py). Never imported by cron/ or app/.
"""
