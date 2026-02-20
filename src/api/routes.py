"""
src/api/routes.py
All API route handlers for SwingFactr.

Endpoints:
  GET /games                          — list games with filters
  GET /game/{game_id}/winprob         — WP time series for a game
  GET /game/{game_id}/lineups         — lineup stints + WP attribution
  GET /game/{game_id}/keyplays        — top WP swing plays
  GET /game/{game_id}/whatif          — what-if lineup simulation
  GET /team/{team_id}/lineup_rankings — top/bottom lineups for a team
  GET /clutch                         — clutch segment analysis
  GET /fatigue                        — fatigue/travel effect summaries
"""

import os
import json
import logging
from pathlib import Path
from typing import Optional
from functools import lru_cache

import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text

from src.etl.db import get_async_engine, AsyncSessionLocal

logger = logging.getLogger("swingfactr.routes")

MODELS_DIR = Path(os.getenv("MODELS_DIR", "models_store"))

# ─── Routers ─────────────────────────────────────────────────────────────────

games_router  = APIRouter()
game_router   = APIRouter()
team_router   = APIRouter()
clutch_router = APIRouter()
fatigue_router = APIRouter()


# ─── Helper: async DB query ───────────────────────────────────────────────────

async def _query(sql: str, params: dict = {}) -> list[dict]:
    async with AsyncSessionLocal() as sess:
        result = await sess.execute(text(sql), params)
        return [dict(row._mapping) for row in result]


# ─── /games ───────────────────────────────────────────────────────────────────

@games_router.get("/")
async def list_games(
    season: Optional[str] = Query(None, example="2023-24"),
    team_id: Optional[int] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
):
    """List games with optional filters."""
    conditions = ["1=1"]
    params: dict = {"limit": limit, "offset": offset}

    if season:
        conditions.append("g.season = :season")
        params["season"] = season
    if team_id:
        conditions.append("(g.home_team_id = :team_id OR g.away_team_id = :team_id)")
        params["team_id"] = team_id

    sql = f"""
    SELECT g.game_id, g.season, g.game_date, g.home_score, g.away_score,
           g.home_win, g.home_rest_days, g.away_rest_days,
           ht.abbreviation AS home_abbr, ht.full_name AS home_name,
           at.abbreviation AS away_abbr, at.full_name AS away_name
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE {' AND '.join(conditions)}
    ORDER BY g.game_date DESC
    LIMIT :limit OFFSET :offset
    """
    rows = await _query(sql, params)
    return {"games": rows, "count": len(rows)}


# ─── /game/{game_id}/winprob ─────────────────────────────────────────────────

@game_router.get("/{game_id}/winprob")
async def get_win_prob(game_id: str):
    """
    Return win probability time series for a game.
    If pre-computed series exists in win_prob_series, return that.
    Otherwise, compute on-the-fly using the trained model.
    """
    # Try cached series first
    rows = await _query(
        "SELECT seconds_elapsed, home_win_prob, score_diff, event_description, lineup_change "
        "FROM win_prob_series WHERE game_id = :gid ORDER BY seconds_elapsed",
        {"gid": game_id},
    )
    if rows:
        return {"game_id": game_id, "series": rows, "source": "cache"}

    # Compute on-the-fly from plays table
    plays = await _query(
        """
        SELECT p.*, g.home_team_id, g.away_team_id,
               g.home_rest_days, g.away_rest_days,
               g.home_back_to_back, g.away_back_to_back,
               g.travel_dist_miles, g.tz_change_hours,
               COALESCE(g.home_net_rating_prior, 0) AS home_net_rating_prior,
               COALESCE(g.away_net_rating_prior, 0) AS away_net_rating_prior
        FROM plays p
        JOIN games g ON p.game_id = g.game_id
        WHERE p.game_id = :gid
        ORDER BY p.seconds_elapsed
        """,
        {"gid": game_id},
    )
    if not plays:
        raise HTTPException(404, f"No plays found for game {game_id}")

    df = pd.DataFrame(plays)

    try:
        from src.models.win_prob import predict_game_series, load_model
        model = _load_wp_model()
        result_df = predict_game_series(df, model)
        series = result_df.to_dict(orient="records")
    except Exception as e:
        logger.error("Win prob computation failed: %s", e)
        # Fallback: naive linear model (score_diff-based)
        df["home_win_prob"] = 0.5 + df["score_diff"] * 0.01
        df["home_win_prob"] = df["home_win_prob"].clip(0.02, 0.98)
        series = df[["seconds_elapsed", "home_win_prob", "score_diff"]].to_dict(orient="records")

    return {"game_id": game_id, "series": series, "source": "computed"}


@lru_cache(maxsize=1)
def _load_wp_model():
    """Cache the win prob model in memory (loaded once per API process)."""
    from src.models.win_prob import load_model
    return load_model("xgboost")


# ─── /game/{game_id}/lineups ─────────────────────────────────────────────────

@game_router.get("/{game_id}/lineups")
async def get_game_lineups(game_id: str, team_id: Optional[int] = None):
    """Return lineup stints for a game with WP attribution."""
    params: dict = {"gid": game_id}
    team_filter = "AND s.team_id = :team_id" if team_id else ""
    if team_id:
        params["team_id"] = team_id

    stints = await _query(
        f"""
        SELECT s.stint_id, s.team_id, s.lineup_id, s.period,
               s.start_seconds, s.end_seconds, s.duration_seconds,
               s.start_score_diff, s.end_score_diff, s.possessions,
               s.is_clutch,
               l.net_rating_adj, l.off_rating, l.def_rating
        FROM stints s
        LEFT JOIN lineups l ON s.lineup_id = l.lineup_id
        WHERE s.game_id = :gid {team_filter}
        ORDER BY s.start_seconds
        """,
        params,
    )
    return {"game_id": game_id, "stints": stints, "count": len(stints)}


# ─── /game/{game_id}/keyplays ────────────────────────────────────────────────

@game_router.get("/{game_id}/keyplays")
async def get_key_plays(game_id: str, top_n: int = Query(10, le=25)):
    """Return top plays by win probability swing magnitude."""
    # We need the WP series first
    wp_resp = await get_win_prob(game_id)
    series = wp_resp["series"]
    if not series:
        raise HTTPException(404, "No WP data for this game.")

    df = pd.DataFrame(series)
    df = df.sort_values("seconds_elapsed")
    df["wp_delta"] = df["home_win_prob"].diff().abs()

    key = df.nlargest(top_n, "wp_delta").to_dict(orient="records")
    return {"game_id": game_id, "key_plays": key}


# ─── /game/{game_id}/whatif ──────────────────────────────────────────────────

@game_router.get("/{game_id}/whatif")
async def what_if(
    game_id: str,
    stint_id: int,
    replacement_lineup_id: str,
    current_win_prob: float = Query(0.5, ge=0, le=1),
):
    """Simulate swapping a lineup and estimate WP impact."""
    stint_rows = await _query(
        "SELECT * FROM stints WHERE stint_id = :sid", {"sid": stint_id}
    )
    if not stint_rows:
        raise HTTPException(404, f"Stint {stint_id} not found.")

    lineup_rows = await _query(
        "SELECT * FROM lineups ORDER BY net_rating_adj DESC LIMIT 1000"
    )
    from src.models.attribution import what_if_lineup_swap
    result = what_if_lineup_swap(
        stint_rows[0],
        replacement_lineup_id,
        pd.DataFrame(lineup_rows),
        current_win_prob,
    )
    return result


# ─── /team/{team_id}/lineup_rankings ─────────────────────────────────────────

@team_router.get("/{team_id}/lineup_rankings")
async def team_lineup_rankings(
    team_id: int,
    season: Optional[str] = None,
    min_minutes: float = 5.0,
    limit: int = Query(20, le=50),
    sort_by: str = Query("net_rating_adj", enum=["net_rating_adj", "off_rating", "def_rating", "total_minutes"]),
):
    """Return top and bottom lineup rankings for a team."""
    params: dict = {"team_id": team_id, "min_min": min_minutes * 60, "limit": limit}
    season_filter = "AND l.season = :season" if season else ""
    if season:
        params["season"] = season

    sql = f"""
    SELECT l.lineup_id, l.season, l.player_ids,
           l.total_seconds / 60.0 AS total_minutes,
           l.total_possessions, l.off_rating, l.def_rating,
           l.net_rating, l.net_rating_adj,
           l.net_rating_ci_low, l.net_rating_ci_high,
           l.games_played, l.clutch_net_rating
    FROM lineups l
    WHERE l.team_id = :team_id
      AND l.total_seconds >= :min_min
      {season_filter}
    ORDER BY {sort_by} DESC
    LIMIT :limit
    """
    top = await _query(sql, params)

    # Bottom lineups
    bottom_sql = sql.replace(f"ORDER BY {sort_by} DESC", f"ORDER BY {sort_by} ASC")
    bottom = await _query(bottom_sql, params)

    return {
        "team_id": team_id,
        "top_lineups": top,
        "bottom_lineups": bottom,
        "sort_by": sort_by,
    }


# ─── /clutch ─────────────────────────────────────────────────────────────────

@clutch_router.get("/")
async def clutch_analysis(
    team_id: Optional[int] = None,
    season: Optional[str] = None,
    limit: int = Query(20, le=100),
):
    """Return clutch performance metrics by lineup."""
    conditions = ["s.is_clutch = TRUE", "s.duration_seconds >= 30"]
    params: dict = {"limit": limit}

    if team_id:
        conditions.append("s.team_id = :team_id")
        params["team_id"] = team_id
    if season:
        conditions.append("g.season = :season")
        params["season"] = season

    sql = f"""
    SELECT
        s.lineup_id,
        s.team_id,
        t.abbreviation AS team_abbr,
        g.season,
        COUNT(*) AS clutch_stints,
        SUM(s.duration_seconds) / 60.0 AS clutch_minutes,
        SUM(s.pts_scored)     AS clutch_pts_scored,
        SUM(s.pts_allowed)    AS clutch_pts_allowed,
        (SUM(s.pts_scored) - SUM(s.pts_allowed)) * 100.0 / NULLIF(SUM(s.possessions), 0)
                              AS clutch_net_rating,
        AVG(s.end_score_diff - s.start_score_diff) AS avg_score_change
    FROM stints s
    JOIN games g ON s.game_id = g.game_id
    JOIN teams t ON s.team_id = t.team_id
    WHERE {' AND '.join(conditions)}
    GROUP BY s.lineup_id, s.team_id, t.abbreviation, g.season
    HAVING SUM(s.duration_seconds) >= 60  -- At least 1 clutch minute
    ORDER BY clutch_net_rating DESC
    LIMIT :limit
    """
    rows = await _query(sql, params)
    return {"clutch_lineups": rows, "count": len(rows)}


# ─── /fatigue ────────────────────────────────────────────────────────────────

@fatigue_router.get("/")
async def fatigue_effects():
    """Return fatigue/travel effect summaries and scenarios."""
    # Load pre-computed scenarios
    scenarios_path = MODELS_DIR / "fatigue_scenarios.json"
    effects_path = MODELS_DIR / "fatigue_effects.json"

    scenarios, effects = [], {}
    if scenarios_path.exists():
        with open(scenarios_path) as f:
            scenarios = json.load(f)
    if effects_path.exists():
        with open(effects_path) as f:
            effects = json.load(f)

    # DB rows as backup
    db_rows = await _query(
        "SELECT scenario, avg_net_rating_delta FROM fatigue_effects ORDER BY ABS(avg_net_rating_delta) DESC"
    )

    return {
        "scenarios": scenarios,
        "coefficient_effects": effects,
        "db_summaries": db_rows,
    }


@fatigue_router.get("/schedule")
async def schedule_fatigue(
    team_id: Optional[int] = None,
    season: Optional[str] = None,
):
    """Return game-by-game fatigue indicators for a team (schedule heatmap data)."""
    params: dict = {}
    conditions = ["1=1"]
    if team_id:
        conditions.append("(g.home_team_id = :team_id OR g.away_team_id = :team_id)")
        params["team_id"] = team_id
    if season:
        conditions.append("g.season = :season")
        params["season"] = season

    rows = await _query(
        f"""
        SELECT g.game_id, g.game_date, g.season,
               ht.abbreviation AS home_abbr, at.abbreviation AS away_abbr,
               g.home_rest_days, g.away_rest_days,
               g.home_back_to_back, g.away_back_to_back,
               g.travel_dist_miles, g.tz_change_hours,
               g.home_road_trip_len, g.away_road_trip_len,
               g.home_win
        FROM games g
        JOIN teams ht ON g.home_team_id = ht.team_id
        JOIN teams at ON g.away_team_id = at.team_id
        WHERE {' AND '.join(conditions)}
        ORDER BY g.game_date
        """,
        params,
    )
    return {"schedule": rows}
