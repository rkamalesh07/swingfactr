"""Build win probability training dataset from stored plays."""

import logging
import pandas as pd
import numpy as np
from src.etl.db import get_conn

logger = logging.getLogger(__name__)


def compute_team_net_ratings(season_id: str) -> dict:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT home_team_id, away_team_id, home_score, away_score
                FROM games
                WHERE season_id = %s AND home_score IS NOT NULL
            """, (season_id,))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    if not rows:
        return {}

    margins: dict = {}
    for row in rows:
        home_margin = (row["home_score"] or 0) - (row["away_score"] or 0)
        margins.setdefault(row["home_team_id"], []).append(home_margin)
        margins.setdefault(row["away_team_id"], []).append(-home_margin)

    return {tid: float(np.mean(m)) for tid, m in margins.items()}


def build_win_prob_dataset(season_id: str, sample_every_n: int = 5) -> pd.DataFrame:
    logger.info(f"Building win prob dataset for season {season_id}")
    net_ratings = compute_team_net_ratings(season_id)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    p.play_id, p.game_id, p.game_seconds_elapsed,
                    p.period, p.score_diff, p.home_score, p.away_score,
                    p.possession_team_id,
                    g.home_team_id, g.away_team_id, g.home_win,
                    g.home_rest_days, g.away_rest_days,
                    g.home_b2b, g.away_b2b,
                    g.travel_miles, g.tz_change,
                    ht.altitude_ft AS home_altitude
                FROM plays p
                JOIN games g ON g.game_id = p.game_id
                JOIN teams ht ON ht.team_id = g.home_team_id
                WHERE g.season_id = %s
                  AND g.home_win IS NOT NULL
                  AND p.period <= 4
                ORDER BY p.game_id, p.game_seconds_elapsed
            """, (season_id,))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    if not rows:
        logger.warning("No plays found — run ETL first")
        return pd.DataFrame()

    df = pd.DataFrame(rows)

    df["time_remaining"] = (2880 - df["game_seconds_elapsed"]).clip(lower=0)
    df["is_home_possession"] = (df["possession_team_id"] == df["home_team_id"]).astype(int)
    df["home_net_rating"] = df["home_team_id"].map(net_ratings).fillna(0.0)
    df["away_net_rating"] = df["away_team_id"].map(net_ratings).fillna(0.0)
    df["net_rating_diff"] = df["home_net_rating"] - df["away_net_rating"]
    df["home_rest_days"] = df["home_rest_days"].fillna(3).clip(0, 7)
    df["away_rest_days"] = df["away_rest_days"].fillna(3).clip(0, 7)
    df["home_b2b"] = df["home_b2b"].fillna(False).astype(int)
    df["away_b2b"] = df["away_b2b"].fillna(False).astype(int)
    df["travel_miles"] = df["travel_miles"].fillna(0).clip(0, 3000)
    df["tz_change"] = df["tz_change"].fillna(0)
    df["high_altitude_game"] = (df["home_altitude"] >= 3000).astype(int)
    df["quarter"] = df["period"].clip(1, 4)
    df["is_overtime"] = (df["period"] > 4).astype(int)
    df["score_diff_clipped"] = df["score_diff"].clip(-30, 30)
    df["home_win"] = df["home_win"].astype(int)
    df["home_fouls"] = 0
    df["away_fouls"] = 0

    feature_cols = [
        "score_diff_clipped", "time_remaining", "quarter",
        "is_home_possession", "home_net_rating", "away_net_rating",
        "net_rating_diff", "home_fouls", "away_fouls",
        "home_b2b", "away_b2b", "home_rest_days", "away_rest_days",
        "travel_miles", "tz_change", "high_altitude_game", "is_overtime",
    ]

    keep_cols = ["play_id", "game_id", "game_seconds_elapsed"] + feature_cols + ["home_win"]
    df = df[[c for c in keep_cols if c in df.columns]].dropna(subset=feature_cols)
    logger.info(f"Built win prob dataset: {len(df)} rows, {len(df['game_id'].unique())} games")
    return df


FEATURE_COLS = [
    "score_diff_clipped", "time_remaining", "quarter",
    "is_home_possession", "home_net_rating", "away_net_rating",
    "net_rating_diff", "home_fouls", "away_fouls",
    "home_b2b", "away_b2b", "home_rest_days", "away_rest_days",
    "travel_miles", "tz_change", "high_altitude_game", "is_overtime",
]
