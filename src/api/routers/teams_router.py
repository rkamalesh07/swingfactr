"""Team rankings and lineup router — with exponential decay weighting."""
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from src.etl.db import get_conn
import math
from datetime import date

router = APIRouter()

DECAY_LAMBDA = 0.015  # half-life ~46 days


def exp_weight(game_date, today=None):
    """Weight a game by how recent it is. Recent = higher weight."""
    if today is None:
        today = date.today()
    if isinstance(game_date, str):
        game_date = date.fromisoformat(game_date)
    days_ago = (today - game_date).days
    return math.exp(-DECAY_LAMBDA * days_ago)


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
                    -- collect all margins and dates for weighted calc
                    json_agg(json_build_object(
                        'margin', CASE WHEN g.home_team_id = t.team_id
                                       THEN g.home_score - g.away_score
                                       ELSE g.away_score - g.home_score END,
                        'date', g.game_date
                    )) as game_data
                FROM teams t
                JOIN games g ON (g.home_team_id = t.team_id OR g.away_team_id = t.team_id)
                WHERE g.season_id = %s AND g.home_score IS NOT NULL
                GROUP BY t.team_id, t.abbreviation
                HAVING COUNT(*) >= 10
            """, (season,))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    today = date.today()
    results = []
    for r in rows:
        games_data = r["game_data"] or []

        # Full season avg margin
        margins = [g["margin"] for g in games_data]
        avg_margin = round(sum(margins) / len(margins), 1) if margins else 0

        # Exponential weighted net rating
        total_w = 0
        total_wm = 0
        for g in games_data:
            w = exp_weight(g["date"][:10], today)
            total_w += w
            total_wm += w * g["margin"]
        weighted_margin = round(total_wm / total_w, 1) if total_w > 0 else 0

        results.append({
            "team_id": r["team_id"],
            "team": r["abbreviation"],
            "wins": r["wins"],
            "losses": r["losses"],
            "games": r["games"],
            "avg_margin": avg_margin,
            "net_rtg": weighted_margin,   # exponentially weighted — this is what we sort by
            "full_season_margin": avg_margin,
            "weighted_margin": weighted_margin,
        })

    results.sort(key=lambda x: x["net_rtg"], reverse=True)
    for i, r in enumerate(results):
        r["rank"] = i + 1

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
                    WHERE lp.lineup_id = ANY(%s) AND lp.team_id IS NOT NULL
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


@router.get("/form")
async def team_form(season: str = Query("2025-26")):
    """
    Returns each team's weighted vs full-season margin delta.
    Positive delta = team is trending up (hot streak).
    Negative delta = team is trending down (cold streak).
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT t.team_id, t.abbreviation,
                    json_agg(json_build_object(
                        'margin', CASE WHEN g.home_team_id = t.team_id
                                       THEN g.home_score - g.away_score
                                       ELSE g.away_score - g.home_score END,
                        'date', g.game_date,
                        'won', CASE WHEN (g.home_win AND g.home_team_id = t.team_id)
                                      OR (NOT g.home_win AND g.away_team_id = t.team_id)
                               THEN true ELSE false END
                    ) ORDER BY g.game_date) as game_data
                FROM teams t
                JOIN games g ON (g.home_team_id = t.team_id OR g.away_team_id = t.team_id)
                WHERE g.season_id = %s AND g.home_score IS NOT NULL
                GROUP BY t.team_id, t.abbreviation
                HAVING COUNT(*) >= 15
            """, (season,))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    today = date.today()
    results = []
    for r in rows:
        games_data = sorted(r["game_data"] or [], key=lambda g: g["date"])
        if len(games_data) < 10:
            continue

        margins = [g["margin"] for g in games_data]
        full_avg = sum(margins) / len(margins)

        # Exponential weighted
        total_w = total_wm = 0
        for g in games_data:
            w = exp_weight(g["date"][:10], today)
            total_w += w
            total_wm += w * g["margin"]
        weighted_avg = total_wm / total_w if total_w > 0 else 0

        # Last 5 and last 10 records
        last5 = games_data[-5:]
        last10 = games_data[-10:]
        l5_wins = sum(1 for g in last5 if g["won"])
        l10_wins = sum(1 for g in last10 if g["won"])
        l5_margin = sum(g["margin"] for g in last5) / 5
        l10_margin = sum(g["margin"] for g in last10) / 10

        trend = weighted_avg - full_avg  # positive = trending up

        results.append({
            "team": r["abbreviation"],
            "team_id": r["team_id"],
            "full_season_margin": round(full_avg, 1),
            "weighted_margin": round(weighted_avg, 1),
            "trend": round(trend, 1),
            "trending": "up" if trend > 0.5 else "down" if trend < -0.5 else "neutral",
            "l5": f"{l5_wins}-{5-l5_wins}",
            "l10": f"{l10_wins}-{10-l10_wins}",
            "l5_margin": round(l5_margin, 1),
            "l10_margin": round(l10_margin, 1),
        })

    results.sort(key=lambda x: x["trend"], reverse=True)
    return JSONResponse({"season": season, "results": results})
