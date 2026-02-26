"""Team rankings and lineup router."""
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from src.etl.db import get_conn

router = APIRouter()


@router.get("/rankings")
async def team_rankings(season: str = Query("2025-26")):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    t.team_id, t.abbreviation,
                    COUNT(*) as games,
                    SUM(CASE WHEN (g.home_win = TRUE AND g.home_team_id = t.team_id)
                                  OR (g.home_win = FALSE AND g.away_team_id = t.team_id)
                             THEN 1 ELSE 0 END) as wins,
                    SUM(CASE WHEN (g.home_win = FALSE AND g.home_team_id = t.team_id)
                                  OR (g.home_win = TRUE AND g.away_team_id = t.team_id)
                             THEN 1 ELSE 0 END) as losses,
                    ROUND(AVG(
                        CASE WHEN g.home_team_id = t.team_id
                             THEN g.home_score - g.away_score
                             ELSE g.away_score - g.home_score END
                    )::numeric, 1) as avg_margin,
                    ROUND(AVG(
                        CASE WHEN g.home_team_id = t.team_id
                             THEN g.home_score - g.away_score
                             ELSE g.away_score - g.home_score END
                    )::numeric, 1) as net_rtg
                FROM teams t
                JOIN games g ON (g.home_team_id = t.team_id OR g.away_team_id = t.team_id)
                WHERE g.season_id = %s AND g.home_score IS NOT NULL
                GROUP BY t.team_id, t.abbreviation
                HAVING COUNT(*) >= 10
                ORDER BY net_rtg DESC
            """, (season,))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    results = []
    for i, r in enumerate(rows):
        results.append({
            "rank": i + 1,
            "team_id": r["team_id"],
            "team": r["abbreviation"],
            "wins": r["wins"],
            "losses": r["losses"],
            "games": r["games"],
            "avg_margin": float(r["avg_margin"] or 0),
            "net_rtg": float(r["net_rtg"] or 0),
        })

    return JSONResponse({"season": season, "results": results})


@router.get("/lineups")
async def lineup_rankings(
    season: str = Query("2025-26"),
    team_id: int = Query(None),
    min_possessions: int = Query(50),
):
    with get_conn() as conn:
        with conn.cursor() as cur:
            team_filter = "AND s.team_id = %s" if team_id else ""
            params = [season, min_possessions]
            if team_id:
                params.insert(1, team_id)

            cur.execute(f"""
                SELECT
                    s.lineup_id,
                    s.team_id,
                    t.abbreviation as team,
                    COUNT(DISTINCT s.game_id) as games,
                    SUM(s.possessions) as possessions,
                    ROUND(SUM(s.duration_seconds)::numeric / 60, 1) as minutes,
                    ROUND(SUM(s.net_points)::numeric / NULLIF(SUM(s.possessions), 0) * 100, 1) as net_rtg
                FROM stints s
                JOIN teams t ON t.team_id = s.team_id
                JOIN games g ON g.game_id = s.game_id
                WHERE g.season_id = %s
                {team_filter}
                AND s.possessions > 0
                GROUP BY s.lineup_id, s.team_id, t.abbreviation
                HAVING SUM(s.possessions) >= %s
                ORDER BY net_rtg DESC
            """, params)
            cols = [d[0] for d in cur.description]
            stints_rows = [dict(zip(cols, r)) for r in cur.fetchall()]

            all_lineup_ids = [r["lineup_id"] for r in stints_rows[:200]]
            if all_lineup_ids:
                cur.execute("""
                    SELECT lp.lineup_id,
                           COALESCE(NULLIF(TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), ' '), p.full_name) as name
                    FROM lineup_players lp
                    JOIN players p ON p.player_id = lp.player_id
                    WHERE lp.lineup_id = ANY(%s)
                    AND lp.team_id IS NOT NULL
                """, (all_lineup_ids,))
                lineup_player_names = {}
                for lid, name in cur.fetchall():
                    if lid not in lineup_player_names:
                        lineup_player_names[lid] = []
                    lineup_player_names[lid].append((name or '').strip())
            else:
                lineup_player_names = {}

    results = []
    for i, r in enumerate(stints_rows[:200]):
        players = lineup_player_names.get(r["lineup_id"], [])
        results.append({
            "rank": i + 1,
            "lineup_id": r["lineup_id"],
            "team": r["team"],
            "team_id": r["team_id"],
            "players": sorted(players),
            "games": r["games"],
            "possessions": r["possessions"],
            "minutes": float(r["minutes"] or 0),
            "net_rtg": float(r["net_rtg"] or 0),
        })

    return JSONResponse({"season": season, "results": results})
