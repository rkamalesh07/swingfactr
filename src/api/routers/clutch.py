"""Clutch analysis router - team and player ratings from plays table."""
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from src.etl.db import get_conn
from typing import Optional

router = APIRouter()


@router.get("/teams")
async def clutch_teams(season: str = Query("2024-25")):
    """Team clutch net ratings — last 5 min, margin <= 5."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                WITH clutch_plays AS (
                    SELECT
                        p.game_id,
                        p.possession_team_id AS team_id,
                        p.is_fg_made,
                        p.is_3pt,
                        CASE
                            WHEN p.possession_team_id = g.home_team_id THEN g.away_team_id
                            ELSE g.home_team_id
                        END AS opponent_id
                    FROM plays p
                    JOIN games g ON g.game_id = p.game_id
                    WHERE g.season_id = %s
                    AND p.time_remaining_seconds <= 300
                    AND ABS(p.score_diff) <= 5
                    AND p.possession_team_id IS NOT NULL
                    AND p.is_fg_attempt = TRUE
                ),
                team_off AS (
                    SELECT team_id,
                        COUNT(*) AS fga,
                        SUM(CASE WHEN is_fg_made AND is_3pt THEN 3 WHEN is_fg_made THEN 2 ELSE 0 END) AS pts,
                        COUNT(DISTINCT game_id) AS games
                    FROM clutch_plays GROUP BY team_id
                ),
                team_def AS (
                    SELECT opponent_id AS team_id,
                        COUNT(*) AS opp_fga,
                        SUM(CASE WHEN is_fg_made AND is_3pt THEN 3 WHEN is_fg_made THEN 2 ELSE 0 END) AS opp_pts
                    FROM clutch_plays GROUP BY opponent_id
                )
                SELECT o.team_id, t.abbreviation, o.pts, d.opp_pts, o.fga, d.opp_fga, o.games
                FROM team_off o
                JOIN team_def d ON d.team_id = o.team_id
                JOIN teams t ON t.team_id = o.team_id
                ORDER BY (o.pts::float / NULLIF(o.fga, 0)) DESC
            """, (season,))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    results = []
    for r in rows:
        poss = (float(r["fga"] or 1) + float(r["opp_fga"] or 1)) / 2
        off_rtg = round(float(r["pts"] or 0) / poss * 100, 1)
        def_rtg = round(float(r["opp_pts"] or 0) / poss * 100, 1)
        net_rtg = round(off_rtg - def_rtg, 1)
        results.append({
            "team_id": r["team_id"],
            "team": r["abbreviation"],
            "clutch_net_rating": net_rtg,
            "clutch_off_rating": off_rtg,
            "clutch_def_rating": def_rtg,
            "games": r["games"],
        })

    results.sort(key=lambda x: x["clutch_net_rating"], reverse=True)
    for i, r in enumerate(results):
        r["rank"] = i + 1

    return JSONResponse({"season": season, "results": results})


@router.get("/players")
async def clutch_players(
    season: str = Query("2024-25"),
    team: Optional[str] = Query(None),
    min_clutch_fga: int = Query(20),
):
    """Player clutch ratings — net points per 100 possessions in clutch stints."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            team_filter = "AND t.abbreviation = %s" if team else ""
            params = [season, min_clutch_fga]
            if team:
                params.insert(1, team)

            cur.execute(f"""
                SELECT
                    p.player_id,
                    p.first_name || ' ' || p.last_name AS player,
                    t.abbreviation AS team,
                    COUNT(DISTINCT s.game_id) AS games,
                    COUNT(DISTINCT s.stint_id) AS clutch_stints,
                    ROUND(SUM(s.duration_seconds)::numeric / 60, 1) AS clutch_minutes,
                    SUM(s.net_points) AS total_net,
                    ROUND(SUM(s.net_points)::numeric / NULLIF(SUM(s.duration_seconds) / 28.8, 0) * 100, 1) AS clutch_net_rtg
                FROM stints s
                JOIN lineup_players lp ON lp.lineup_id = s.lineup_id AND lp.team_id = s.team_id
                JOIN players p ON p.player_id = lp.player_id
                JOIN teams t ON t.team_id = lp.team_id
                JOIN games g ON g.game_id = s.game_id
                WHERE g.season_id = %s
                {team_filter}
                AND s.time_remaining_seconds <= 300
                AND ABS(s.start_score_diff) <= 5
                AND s.duration_seconds > 0
                GROUP BY p.player_id, p.first_name, p.last_name, t.abbreviation
                HAVING COUNT(DISTINCT s.stint_id) >= %s
                ORDER BY clutch_net_rtg DESC
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
            "clutch_stints": r["clutch_stints"],
            "clutch_minutes": float(r["clutch_minutes"] or 0),
            "clutch_net_rtg": float(r["clutch_net_rtg"] or 0),
        })

    return JSONResponse({"season": season, "results": results})


@router.get("/")
async def clutch_analysis(season: str = Query("2024-25")):
    """Default endpoint - returns team clutch ratings."""
    return await clutch_teams(season=season)
