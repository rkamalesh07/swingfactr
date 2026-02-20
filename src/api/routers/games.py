"""Games router."""
from typing import Optional
from fastapi import APIRouter, Query
from src.etl.db import get_conn
from src.api.schemas import GameSummary

router = APIRouter()


@router.get("/", response_model=list[GameSummary])
async def list_games(
    season: str = Query("2025-26"),
    team_id: Optional[int] = Query(None),
    limit: int = Query(50, le=200),
):
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Use subquery to get one team row per team_id (handles duplicates)
            base_query = """
                WITH team_abbrevs AS (
                    SELECT DISTINCT ON (team_id) team_id, abbreviation
                    FROM teams ORDER BY team_id ASC
                )
                SELECT g.game_id, g.game_date::text, g.home_score, g.away_score, g.home_win,
                       ht.abbreviation AS home_team, at.abbreviation AS away_team,
                       g.home_team_id, g.away_team_id
                FROM games g
                JOIN team_abbrevs ht ON ht.team_id = g.home_team_id
                JOIN team_abbrevs at ON at.team_id = g.away_team_id
                WHERE g.season_id = %s AND g.home_score IS NOT NULL
            """
            if team_id:
                cur.execute(base_query + " AND (g.home_team_id = %s OR g.away_team_id = %s) ORDER BY g.game_date DESC LIMIT %s",
                           (season, team_id, team_id, limit))
            else:
                cur.execute(base_query + " ORDER BY g.game_date DESC LIMIT %s", (season, limit))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    return [
        GameSummary(
            game_id=r["game_id"],
            game_date=r["game_date"],
            home_team=r["home_team"],
            away_team=r["away_team"],
            home_score=r["home_score"],
            away_score=r["away_score"],
            home_win=r["home_win"],
        )
        for r in rows
    ]
