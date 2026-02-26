"""RAPM router — computed on demand."""
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from src.etl.db import get_conn
from typing import Optional
import math

router = APIRouter()


def compute_rapm(season: str, alpha: float = 2000.0, min_minutes: int = 200):
    """Compute RAPM inline for API response."""
    try:
        import numpy as np
        from scipy.sparse import lil_matrix, csr_matrix
        from sklearn.linear_model import Ridge
    except ImportError:
        return None, "scipy/sklearn not installed"

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.stint_id, s.team_id, s.lineup_id,
                       s.net_points, s.possessions, s.duration_seconds,
                       g.home_team_id
                FROM stints s
                JOIN games g ON g.game_id = s.game_id
                WHERE g.season_id = %s
                AND s.duration_seconds >= 30
                AND s.possessions > 0
            """, (season,))
            cols = [d[0] for d in cur.description]
            stints = [dict(zip(cols, r)) for r in cur.fetchall()]

            cur.execute("""
                SELECT DISTINCT lp.lineup_id, lp.player_id, lp.team_id
                FROM lineup_players lp
                JOIN stints s ON s.lineup_id = lp.lineup_id
                JOIN games g ON g.game_id = s.game_id
                WHERE g.season_id = %s AND lp.team_id IS NOT NULL
            """, (season,))
            lineup_players = {}
            player_teams = {}
            for lineup_id, player_id, team_id in cur.fetchall():
                if lineup_id not in lineup_players:
                    lineup_players[lineup_id] = []
                lineup_players[lineup_id].append(player_id)
                player_teams[player_id] = team_id

            cur.execute("""
                SELECT DISTINCT p.player_id,
                       COALESCE(p.first_name || ' ' || p.last_name, p.full_name) as name,
                       t.abbreviation as team,
                       lp.team_id
                FROM lineup_players lp
                JOIN players p ON p.player_id = lp.player_id
                JOIN teams t ON t.team_id = lp.team_id
                JOIN stints s ON s.lineup_id = lp.lineup_id
                JOIN games g ON g.game_id = s.game_id
                WHERE g.season_id = %s AND lp.team_id IS NOT NULL
            """, (season,))
            players = {}
            for pid, name, team, team_id in cur.fetchall():
                players[pid] = {"name": name, "team": team}

    if not stints or not players:
        return [], None

    player_ids = sorted(players.keys())
    player_idx = {pid: i for i, pid in enumerate(player_ids)}
    n_players = len(player_ids)

    # Compute minutes per player
    player_seconds = {}
    for s in stints:
        for pid in lineup_players.get(s["lineup_id"], []):
            player_seconds[pid] = player_seconds.get(pid, 0) + s["duration_seconds"]

    valid_stints = [s for s in stints if len(lineup_players.get(s["lineup_id"], [])) == 5]

    n = len(valid_stints)
    X = lil_matrix((n, n_players))
    y = np.zeros(n)
    w = np.zeros(n)

    for i, s in enumerate(valid_stints):
        lineup = lineup_players.get(s["lineup_id"], [])
        is_home = s["team_id"] == s["home_team_id"]
        sign = 1 if is_home else -1
        for pid in lineup:
            if pid in player_idx:
                X[i, player_idx[pid]] = sign
        poss = max(s["possessions"], 1)
        y[i] = (s["net_points"] / poss) * 100
        w[i] = poss

    model = Ridge(alpha=alpha, fit_intercept=False)
    model.fit(csr_matrix(X), y, sample_weight=w)

    results = []
    for i, pid in enumerate(player_ids):
        minutes = player_seconds.get(pid, 0) / 60
        if minutes < min_minutes:
            continue
        info = players.get(pid, {})
        results.append({
            "player_id": pid,
            "player": info.get("name", f"Player {pid}"),
            "team": info.get("team", "?"),
            "rapm": round(float(model.coef_[i]), 2),
            "minutes": round(minutes),
        })

    results.sort(key=lambda x: x["rapm"], reverse=True)
    for i, r in enumerate(results):
        r["rank"] = i + 1

    return results, None


@router.get("/")
async def get_rapm(
    season: str = Query("2025-26"),
    min_minutes: int = Query(200),
    team: Optional[str] = Query(None),
):
    results, error = compute_rapm(season, min_minutes=min_minutes)
    if error:
        return JSONResponse({"error": error}, status_code=500)

    if team:
        results = [r for r in results if r["team"] == team.upper()]
        for i, r in enumerate(results):
            r["rank"] = i + 1

    return JSONResponse({"season": season, "results": results, "min_minutes": min_minutes})
