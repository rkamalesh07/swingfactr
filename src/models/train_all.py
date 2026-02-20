"""Train all SwingFactr models on historical seasons, then score current season.

The flow:
  1. Train on TRAINING_SEASONS (2020-21 → 2024-25) — all outcomes known
  2. Evaluate on held-out games from training seasons
  3. Apply trained models to CURRENT_SEASON (2025-26) for daily inference

Run:
    python -m src.models.train_all               # trains all on historical data
    python -m src.models.train_all --quick       # 2024-25 only (faster)
    python -m src.models.train_all --score-live  # also score current season games
"""

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger("swingfactr.train")

from src.config import TRAINING_SEASONS, CURRENT_SEASON


def train_all(seasons: list[str], score_live: bool = False) -> None:
    from src.etl.db import init_pool
    init_pool()

    logger.info(f"=== SwingFactr Training: {len(seasons)} seasons ===")
    logger.info(f"Seasons: {seasons}")
    logger.info(f"Current season for inference: {CURRENT_SEASON}")
    logger.info("")

    # 1. Defensive scheme clusters (needed as features by other models)
    logger.info("Step 1/4 — Defensive scheme clustering")
    from src.features.defensive_clusters import run_defensive_clustering
    for season in seasons:
        df = run_defensive_clustering(season)
        if not df.empty:
            logger.info(f"  {season}: {df['cluster_label'].value_counts().to_dict()}")

    # 2. Win probability model (trained on all historical seasons combined)
    logger.info("\nStep 2/4 — Win probability model (XGBoost, calibrated)")
    from src.models.win_probability import train_win_prob_model
    wp_result = train_win_prob_model(training_seasons=seasons)
    m = wp_result["metrics"]
    logger.info(f"  Brier: {m['brier_score']}  AUC: {m['auc']}  LogLoss: {m['log_loss']}")

    # 3. Lineup RAPM (per-season + combined)
    logger.info("\nStep 3/4 — Lineup impact model (RAPM ridge regression)")
    from src.models.lineup_impact import train_rapm_model
    for season in seasons:
        try:
            result = train_rapm_model(season)
            logger.info(f"  {season}: {result['n_stints']} stints")
        except ValueError as e:
            logger.warning(f"  {season}: {e}")

    # 4. Fatigue model (combined across seasons for more power)
    logger.info("\nStep 4/4 — Fatigue/travel effect model (OLS)")
    from src.models.fatigue import train_fatigue_model
    fat = train_fatigue_model(seasons=seasons)
    logger.info(f"  R² = {fat.get('r_squared', 'n/a')}")

    # 5. Optionally score current season games
    if score_live:
        logger.info(f"\nScoring current season games ({CURRENT_SEASON})...")
        _score_current_season()

    logger.info("\n=== Training complete. Models saved to models_saved/ ===")


def _score_current_season() -> None:
    """Generate win prob predictions for all completed current-season games."""
    from src.etl.db import get_conn
    from src.models.win_probability import predict_game_win_prob
    from src.config import TRAINING_SEASONS

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT game_id FROM games
                WHERE season_id = %s AND home_score IS NOT NULL
                ORDER BY game_date
            """, (CURRENT_SEASON,))
            game_ids = [r[0] for r in cur.fetchall()]

    logger.info(f"  Scoring {len(game_ids)} completed {CURRENT_SEASON} games")
    for gid in game_ids:
        try:
            predict_game_win_prob(gid, training_seasons=TRAINING_SEASONS)
        except Exception as e:
            logger.warning(f"  {gid}: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true", help="Train on 2024-25 only (faster)")
    parser.add_argument("--score-live", action="store_true", help="Also score current season")
    args = parser.parse_args()

    seasons = ["2024-25"] if args.quick else TRAINING_SEASONS
    train_all(seasons, score_live=args.score_live)
