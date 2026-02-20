"""Clutch analysis router."""
from fastapi import APIRouter, Query
from src.etl.db import get_conn

router = APIRouter()


@router.get("/")
async def clutch_analysis(
    season: str = Query("2025-26"),
    team_id: int = Query(None),
):
    """Return clutch performance stats (last 5 min, within 5 pts)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if team_id:
                cur.execute("""
                    SELECT s.team_id, t.abbreviation,
                           COUNT(*) AS clutch_stints,
                           SUM(s.points_for) AS pts_for,
                           SUM(s.points_against) AS pts_against,
                           SUM(s.possessions_for) AS poss,
                           COUNT(DISTINCT s.game_id) AS games
                    FROM stints s
                    JOIN teams t ON t.team_id = s.team_id
                    JOIN games g ON g.game_id = s.game_id
                    WHERE s.is_clutch = TRUE AND g.season_id = %s AND s.team_id = %s
                    GROUP BY s.team_id, t.abbreviation
                """, (season, team_id))
            else:
                cur.execute("""
                    SELECT s.team_id, t.abbreviation,
                           COUNT(*) AS clutch_stints,
                           SUM(s.points_for) AS pts_for,
                           SUM(s.points_against) AS pts_against,
                           SUM(s.possessions_for) AS poss,
                           COUNT(DISTINCT s.game_id) AS games
                    FROM stints s
                    JOIN teams t ON t.team_id = s.team_id
                    JOIN games g ON g.game_id = s.game_id
                    WHERE s.is_clutch = TRUE AND g.season_id = %s
                    GROUP BY s.team_id, t.abbreviation
                    ORDER BY (SUM(s.points_for)::float / NULLIF(SUM(s.possessions_for), 0)) DESC
                    LIMIT 30
                """, (season,))
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in rows]

    results = []
    for r in rows:
        poss = r["poss"] or 1
        off_rtg = round((r["pts_for"] or 0) / poss * 100, 1)
        def_rtg = round((r["pts_against"] or 0) / poss * 100, 1)
        results.append({
            "team_id": r["team_id"],
            "team": r["abbreviation"],
            "clutch_net_rating": round(off_rtg - def_rtg, 1),
            "clutch_off_rating": off_rtg,
            "clutch_def_rating": def_rtg,
            "clutch_stints": r["clutch_stints"],
            "games": r["games"],
        })

    return {"season_id": season, "results": results}
