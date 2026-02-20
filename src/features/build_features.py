"""
src/features/build_features.py
Builds ML-ready feature matrices from Postgres tables.

Outputs:
  - win_prob_features.parquet  (play-level, for win prob model)
  - lineup_features.parquet    (lineup-level, for lineup impact model)
  - clutch_features.parquet    (stint-level clutch segments)
  - fatigue_features.parquet   (game-level, for fatigue model)
  - def_profiles.parquet       (team-season level, for clustering)
"""

import logging
import os
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

from src.etl.db import execute_sql

logger = logging.getLogger(__name__)
FEATURES_DIR = Path(os.getenv("FEATURES_DIR", "features_store"))
FEATURES_DIR.mkdir(exist_ok=True)

CLUTCH_MINS = 5.0
CLUTCH_MARGIN = 5


# ─── 1. Win Probability Features ──────────────────────────────────────────────

def build_win_prob_features(season: str | None = None) -> pd.DataFrame:
    """
    Play-level feature matrix for win probability model.
    Target: home_win (1 = home team wins the game)
    """
    logger.info("Building win probability features...")

    season_filter = "AND g.season = :s" if season else ""
    params = {"s": season} if season else {}

    sql = f"""
    SELECT
        p.game_id,
        p.event_num,
        p.seconds_elapsed,
        p.seconds_remaining,
        p.period,
        p.score_diff,
        p.is_made_shot,
        p.is_turnover,
        p.is_foul,
        -- Time features
        CASE WHEN p.period <= 4 THEN p.seconds_remaining / 2880.0
             ELSE GREATEST(0, p.seconds_remaining) / 300.0 END AS pct_time_remaining,
        CASE WHEN p.period > 4 THEN 1 ELSE 0 END AS is_overtime,
        -- Game context
        g.home_win::int AS home_win,
        g.home_rest_days,
        g.away_rest_days,
        g.home_back_to_back::int AS home_btb,
        g.away_back_to_back::int AS away_btb,
        COALESCE(g.home_net_rating_prior, 0) AS home_net_rating_prior,
        COALESCE(g.away_net_rating_prior, 0) AS away_net_rating_prior,
        -- Travel / fatigue proxy
        COALESCE(g.travel_dist_miles, 0) AS travel_dist_miles,
        COALESCE(g.tz_change_hours, 0) AS tz_change_hours,
        -- Momentum: rolling score diff last N plays
        AVG(p.score_diff) OVER (
            PARTITION BY p.game_id
            ORDER BY p.seconds_elapsed
            ROWS BETWEEN 10 PRECEDING AND CURRENT ROW
        ) AS score_diff_momentum
    FROM plays p
    JOIN games g ON p.game_id = g.game_id
    WHERE g.home_win IS NOT NULL
      {season_filter}
    ORDER BY p.game_id, p.seconds_elapsed
    """
    df = pd.DataFrame(execute_sql(sql, params))

    if df.empty:
        logger.warning("No play data found! Did you run the ETL pipeline?")
        return df

    # Feature engineering
    df["score_diff_sq"] = df["score_diff"] ** 2
    df["score_diff_x_time"] = df["score_diff"] * df["pct_time_remaining"]
    df["rest_diff"] = df["home_rest_days"] - df["away_rest_days"]
    df["net_rating_diff"] = df["home_net_rating_prior"] - df["away_net_rating_prior"]

    # Normalize altitude-ish (Denver flag — high altitude gives home advantage)
    # We'll add this at the game level later; for now placeholder
    df["high_altitude_home"] = 0  # Updated after merging team data

    df.to_parquet(FEATURES_DIR / "win_prob_features.parquet", index=False)
    logger.info("Win prob features: %d rows", len(df))
    return df


# ─── 2. Lineup Features ───────────────────────────────────────────────────────

def build_lineup_features(season: str | None = None) -> pd.DataFrame:
    """
    Lineup-level features aggregated from stints.
    Used for lineup impact / net rating modeling.
    """
    logger.info("Building lineup features...")
    season_filter = "AND g.season = :s" if season else ""
    params = {"s": season} if season else {}

    sql = f"""
    SELECT
        s.lineup_id,
        s.team_id,
        g.season,
        s.game_id,
        s.period,
        s.duration_seconds,
        s.possessions,
        s.pts_scored,
        s.pts_allowed,
        s.start_score_diff,
        s.end_score_diff,
        s.is_clutch,
        g.home_team_id,
        g.home_win::int AS home_win,
        g.home_net_rating_prior,
        g.away_net_rating_prior,
        -- Opponent strength proxy
        CASE WHEN s.team_id = g.home_team_id
             THEN COALESCE(g.away_net_rating_prior, 0)
             ELSE COALESCE(g.home_net_rating_prior, 0)
        END AS opp_net_rating
    FROM stints s
    JOIN games g ON s.game_id = g.game_id
    WHERE s.duration_seconds >= 30  -- Filter out very short stints (noise)
      AND s.lineup_id != ''
      {season_filter}
    """
    df = pd.DataFrame(execute_sql(sql, params))
    if df.empty:
        return df

    # Point margin per stint
    df["pts_margin"] = df["pts_scored"] - df["pts_allowed"]

    # Offensive/Defensive rating per 100 possessions
    df["off_rating"] = (df["pts_scored"] / df["possessions"].clip(lower=1)) * 100
    df["def_rating"] = (df["pts_allowed"] / df["possessions"].clip(lower=1)) * 100
    df["net_rating"] = df["off_rating"] - df["def_rating"]

    # Duration weight (more time → more reliable)
    df["minutes"] = df["duration_seconds"] / 60

    # Aggregate to lineup level
    lineup_agg = (
        df.groupby(["lineup_id", "team_id", "season"])
        .agg(
            total_minutes=("minutes", "sum"),
            total_possessions=("possessions", "sum"),
            total_pts_scored=("pts_scored", "sum"),
            total_pts_allowed=("pts_allowed", "sum"),
            games_played=("game_id", "nunique"),
            avg_opp_net_rating=("opp_net_rating", "mean"),
            clutch_mins=("minutes", lambda x: x[df.loc[x.index, "is_clutch"]].sum()),
        )
        .reset_index()
    )

    lineup_agg["off_rating"] = (lineup_agg["total_pts_scored"] / lineup_agg["total_possessions"].clip(lower=1)) * 100
    lineup_agg["def_rating"] = (lineup_agg["total_pts_allowed"] / lineup_agg["total_possessions"].clip(lower=1)) * 100
    lineup_agg["net_rating"] = lineup_agg["off_rating"] - lineup_agg["def_rating"]

    lineup_agg.to_parquet(FEATURES_DIR / "lineup_features.parquet", index=False)
    logger.info("Lineup features: %d unique lineups", len(lineup_agg))
    return lineup_agg


# ─── 3. Defensive Profile Features (for clustering) ───────────────────────────

def build_defensive_profiles(season: str | None = None) -> pd.DataFrame:
    """
    Team-level defensive features used for k-means scheme clustering.

    ASSUMPTION: Without optical tracking data, we approximate defensive scheme by:
      - shot_dist_allowed: avg shot distance from plays where team was on defense
      - opp_3pa_rate: fraction of opponent shots that are 3-pointers
      - rim_att_rate: fraction of close shots (dist <= 5 ft proxy)
      - def_reb_pct: defensive rebound rate
      - foul_rate: fouls per possession
      - pace_allowed: avg seconds per opponent possession

    These serve as proxies for drop-coverage (allows more mid-range),
    switch-heavy (fewer rim shots), zone-ish (high foul rate), etc.
    Clustering labels are NOT ground truth — they're ML proxies.
    """
    logger.info("Building defensive profile features...")

    sql = """
    SELECT
        g.home_team_id,
        g.away_team_id,
        g.season,
        p.team_id AS offensive_team_id,
        p.shot_distance,
        p.is_three,
        p.is_made_shot,
        p.is_foul,
        p.is_turnover
    FROM plays p
    JOIN games g ON p.game_id = g.game_id
    WHERE p.event_type IN (1, 2, 3, 6)  -- shots, FTs, fouls
    """
    df = pd.DataFrame(execute_sql(sql))
    if df.empty:
        return df

    # Tag defending team
    df["defending_team_id"] = df.apply(
        lambda r: r["away_team_id"] if r["offensive_team_id"] == r["home_team_id"] else r["home_team_id"],
        axis=1,
    )

    # Aggregate per defending team per season
    shots = df[df["event_type_implied"].isin([1, 2]) if "event_type_implied" in df.columns else df["is_made_shot"].notna()]

    profile = (
        df.groupby(["defending_team_id", "season"])
        .agg(
            avg_shot_dist=("shot_distance", "mean"),
            opp_3pa_rate=("is_three", "mean"),
            foul_rate=("is_foul", "mean"),
        )
        .reset_index()
        .rename(columns={"defending_team_id": "team_id"})
    )

    profile.to_parquet(FEATURES_DIR / "def_profiles.parquet", index=False)
    return profile


# ─── 4. Fatigue Features ──────────────────────────────────────────────────────

def build_fatigue_features() -> pd.DataFrame:
    """
    Game-level fatigue features for interpretable regression.
    """
    sql = """
    SELECT
        g.game_id,
        g.season,
        g.home_team_id,
        g.away_team_id,
        g.home_win::int AS home_win,
        COALESCE(g.home_rest_days, 2)    AS home_rest_days,
        COALESCE(g.away_rest_days, 2)    AS away_rest_days,
        g.home_back_to_back::int         AS home_btb,
        g.away_back_to_back::int         AS away_btb,
        COALESCE(g.home_road_trip_len, 0) AS home_road_trip,
        COALESCE(g.away_road_trip_len, 0) AS away_road_trip,
        COALESCE(g.travel_dist_miles, 0)  AS travel_dist_miles,
        COALESCE(g.tz_change_hours, 0)    AS tz_change,
        COALESCE(g.home_net_rating_prior, 0) AS home_prior_nrtg,
        COALESCE(g.away_net_rating_prior, 0) AS away_prior_nrtg
    FROM games g
    WHERE g.home_win IS NOT NULL
    """
    df = pd.DataFrame(execute_sql(sql))
    if df.empty:
        return df

    df["rest_advantage"] = df["home_rest_days"] - df["away_rest_days"]
    df["btb_disadvantage"] = df["away_btb"] - df["home_btb"]  # positive = away more tired
    df["fatigue_composite"] = (
        -1.5 * df["away_btb"]
        + 1.2 * df["home_btb"] * -1  # home btb hurts home
        - 0.01 * df["travel_dist_miles"]
        - 0.3 * df["tz_change"].abs()
    )

    df.to_parquet(FEATURES_DIR / "fatigue_features.parquet", index=False)
    return df


# ─── 5. Clutch Features ───────────────────────────────────────────────────────

def build_clutch_features(season: str | None = None) -> pd.DataFrame:
    """
    Stint-level features filtered to clutch situations.
    Clutch = last 5 min of 4th quarter (or OT) with score margin <= 5.
    """
    season_filter = "AND g.season = :s" if season else ""
    params = {"s": season} if season else {}

    sql = f"""
    SELECT
        s.stint_id,
        s.game_id,
        s.team_id,
        s.lineup_id,
        s.duration_seconds,
        s.possessions,
        s.pts_scored,
        s.pts_allowed,
        s.start_score_diff,
        s.end_score_diff,
        g.home_team_id,
        g.home_win::int AS home_win,
        g.home_net_rating_prior,
        g.away_net_rating_prior
    FROM stints s
    JOIN games g ON s.game_id = g.game_id
    WHERE s.is_clutch = TRUE
      {season_filter}
    """
    df = pd.DataFrame(execute_sql(sql, params))
    if df.empty:
        return df

    df["clutch_net_rating"] = (
        (df["pts_scored"] - df["pts_allowed"]) / df["possessions"].clip(lower=1)
    ) * 100
    df["won_clutch"] = (df["end_score_diff"] > df["start_score_diff"]).astype(int)

    df.to_parquet(FEATURES_DIR / "clutch_features.parquet", index=False)
    return df


# ─── Runner ───────────────────────────────────────────────────────────────────

def build_all(season: str | None = None) -> None:
    """Build all feature files."""
    build_win_prob_features(season)
    build_lineup_features(season)
    build_defensive_profiles(season)
    build_fatigue_features()
    build_clutch_features(season)
    logger.info("All feature files written to %s", FEATURES_DIR)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", default=None)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    build_all(args.season)
