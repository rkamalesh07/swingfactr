"""Clutch analysis router - computed from plays + stints tables."""
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from src.etl.db import get_conn

router = APIRouter()


@router.get("/")
async def clutch_analysis(season: str = Query("2024-25")):
    """
    Clutch = last 5 min (start_game_seconds >= 2580), score margin <= 5.
    Computes off/def/net rating from plays data in clutch situations.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Compute clutch stats per team from plays table
            # For each clutch play, the scoring team gets credit for offense
            # and the other team gets charged for defense
            cur.execute("""
                WITH clutch_plays AS (
                    SELECT
                        p.game_id,
                        p.possession_team_id AS team_id,
                        p.is_fg_made,
                        p.is_fg_attempt,
                        p.is_3pt,
                        p.score_diff,
                        g.home_team_id,
                        g.away_team_id,
                        CASE
                            WHEN p.possession_team_id = g.home_team_id THEN g.away_team_id
                            ELSE g.home_team_id
                        END AS opponent_id
                    FROM plays p
                    JOIN games g ON g.game_id = p.game_id
                    WHERE g.season_id = %s
                    AND p.game_seconds_elapsed >= 2580
                    AND ABS(p.score_diff) <= 5
                    AND p.possession_team_id IS NOT NULL
                    AND p.is_fg_attempt = TRUE
                ),
                team_off AS (
                    SELECT
                        team_id,
                        COUNT(*) AS fga,
                        SUM(CASE WHEN is_fg_made AND is_3pt THEN 3
                                 WHEN is_fg_made THEN 2
                                 ELSE 0 END) AS pts,
                        COUNT(DISTINCT game_id) AS games
                    FROM clutch_plays
                    GROUP BY team_id
                ),
                team_def AS (
                    SELECT
                        opponent_id AS team_id,
                        COUNT(*) AS opp_fga,
                        SUM(CASE WHEN is_fg_made AND is_3pt THEN 3
                                 WHEN is_fg_made THEN 2
                                 ELSE 0 END) AS opp_pts
                    FROM clutch_plays
                    GROUP BY opponent_id
                )
                SELECT
                    o.team_id,
                    t.abbreviation,
                    o.pts,
                    d.opp_pts,
                    o.fga,
                    d.opp_fga,
                    o.games
                FROM team_off o
                JOIN team_def d ON d.team_id = o.team_id
                JOIN teams t ON t.team_id = o.team_id
                ORDER BY (o.pts::float / NULLIF(o.fga, 0)) DESC
            """, (season,))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    if not rows:
        return JSONResponse({"season_id": season, "results": [], "source": "plays"})

    # Compute ratings per 100 possessions (estimate poss from FGA)
    results = []
    for r in rows:
        fga = float(r["fga"] or 1)
        opp_fga = float(r["opp_fga"] or 1)
        poss = (fga + opp_fga) / 2  # rough possession estimate

        off_rtg = round(float(r["pts"] or 0) / poss * 100, 1)
        def_rtg = round(float(r["opp_pts"] or 0) / poss * 100, 1)
        net_rtg = round(off_rtg - def_rtg, 1)

        results.append({
            "team_id": r["team_id"],
            "team": r["abbreviation"],
            "clutch_net_rating": net_rtg,
            "clutch_off_rating": off_rtg,
            "clutch_def_rating": def_rtg,
            "clutch_stints": int(fga),
            "games": r["games"],
        })

    results.sort(key=lambda x: x["clutch_net_rating"], reverse=True)
    return JSONResponse({"season_id": season, "results": results, "source": "plays"})
