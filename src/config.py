"""SwingFactr global configuration.

Season strategy:
- TRAINING_SEASONS: historical seasons used to train models (we have outcomes for all)
- CURRENT_SEASON: the live season we run inference on daily
- Models are trained on historical data, then predict on current season plays in real time.

Why this matters:
  Training on 2020-21 through 2024-25 gives us ~6,000 games of labeled outcomes.
  The 2025-26 model then applies learned patterns to live plays without leakage.
"""

# Seasons used to TRAIN models (we know all outcomes — no leakage)
TRAINING_SEASONS = [
    "2020-21",
    "2021-22",
    "2022-23",
    "2023-24",
    "2024-25",
]

# Current live season — inference only (no outcomes yet during the season)
CURRENT_SEASON = "2025-26"

# Clutch definition
CLUTCH_TIME_REMAINING_SEC = 300   # last 5 minutes of 4th quarter
CLUTCH_SCORE_MARGIN = 5           # within 5 points

# Minimum stint duration to include in lineup models
MIN_STINT_SECONDS = 30

# RAPM regularization (alpha)
RAPM_ALPHA = 2000.0

# Defensive clustering
N_DEF_CLUSTERS = 4
