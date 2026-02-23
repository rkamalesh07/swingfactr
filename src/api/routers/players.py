"""Player ratings router — net rating from stint data."""
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from src.etl.db import get_conn
from typing import Optional

router = APIRouter()

MIN_SECONDS = 18000  # 300 minutes minimum


@router.get("/")
async def player_ratings(
    season: str = Query("2024-25"),
    team: Optional[str] = Query(None),
    min_minutes: int = Query(300),
):
    min_seconds = min_minutes * 60

    with get_conn() as conn:
        with conn.cursor() as cur:
            team_filter = "AND t.abbreviation = %s" if team else ""
            params = [season, min_seconds]
            if team:
                params.insert(1, team)

            cur.execute(f"""
                SELECT
                    p.player_id,
                    p.first_name || ' ' || p.last_name AS player,
                    t.abbreviation AS team,
                    COUNT(DISTINCT s.game_id) AS games,
                    ROUND(SUM(s.duration_seconds)::numeric / 60, 0) AS minutes,
                    SUM(s.net_points) AS total_net,
                    ROUND(SUM(s.net_points)::numeric / NULLIF(SUM(s.duration_seconds) / 28.8, 0) * 100, 1) AS net_rtg
                FROM stints s
                JOIN lineup_players lp ON lp.lineup_id = s.lineup_id AND lp.team_id = s.team_id
                JOIN players p ON p.player_id = lp.player_id
                JOIN teams t ON t.team_id = lp.team_id
                JOIN games g ON g.game_id = s.game_id
                WHERE g.season_id = %s
                {team_filter}
                AND s.duration_seconds > 0
                GROUP BY p.player_id, p.first_name, p.last_name, t.abbreviation
                HAVING SUM(s.duration_seconds) > %s
                ORDER BY net_rtg DESC
            """, params)

            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    results = []
    for i, r in enumerate(rows):
        results.append({
            "rank": i + 1,
            "player_id": r["player_id"],
            "player": r["player"],
            "team": r["team"],
            "games": r["games"],
            "minutes": int(r["minutes"]),
            "net_rtg": float(r["net_rtg"]),
        })

    return JSONResponse({"season": season, "results": results, "min_minutes": min_minutes})


@router.get("/teams")
async def get_teams(season: str = Query("2024-25")):
    """Return all teams that have player data for this season."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT t.abbreviation
                FROM stints s
                JOIN lineup_players lp ON lp.lineup_id = s.lineup_id AND lp.team_id = s.team_id
                JOIN teams t ON t.team_id = lp.team_id
                JOIN games g ON g.game_id = s.game_id
                WHERE g.season_id = %s
                ORDER BY t.abbreviation
            """, (season,))
            teams = [r[0] for r in cur.fetchall()]
    return JSONResponse({"teams": teams})
