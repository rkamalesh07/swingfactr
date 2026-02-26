"""RAPM router — Regularized Adjusted Plus/Minus."""
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from src.etl.db import get_conn
from typing import Optional

router = APIRouter()


def compute_rapm(season: str, alpha: float = 2000.0, min_minutes: int = 200):
    try:
        import numpy as np
        from scipy.sparse import lil_matrix, csr_matrix
        from sklearn.linear_model import Ridge
    except ImportError:
        return None, "scipy/sklearn not installed on server"

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Get stints
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

            # Get lineup -> players
            cur.execute("""
                SELECT lp.lineup_id, lp.player_id, lp.team_id,
                       SUM(s.duration_seconds) as total_seconds
                FROM lineup_players lp
                JOIN stints s ON s.lineup_id = lp.lineup_id
                JOIN games g ON g.game_id = s.game_id
                WHERE g.season_id = %s AND lp.team_id IS NOT NULL
                GROUP BY lp.lineup_id, lp.player_id, lp.team_id
            """, (season,))
            lineup_players = {}
            player_seconds_by_team = {}  # player_id -> {team_id: seconds}
            for lineup_id, player_id, team_id, secs in cur.fetchall():
                if lineup_id not in lineup_players:
                    lineup_players[lineup_id] = []
                lineup_players[lineup_id].append(player_id)
                if player_id not in player_seconds_by_team:
                    player_seconds_by_team[player_id] = {}
                player_seconds_by_team[player_id][team_id] = \
                    player_seconds_by_team[player_id].get(team_id, 0) + secs

            # Assign each player to their primary team (most minutes)
            player_primary_team = {}
            for pid, team_secs in player_seconds_by_team.items():
                player_primary_team[pid] = max(team_secs, key=team_secs.get)

            # Get player names and team abbreviations
            cur.execute("""
                SELECT p.player_id,
                       COALESCE(NULLIF(TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), ' '), p.full_name, 'Player ' || p.player_id::text) as name,
                       t.abbreviation, t.team_id
                FROM players p
                JOIN teams t ON t.team_id = ANY(
                    SELECT DISTINCT lp.team_id FROM lineup_players lp
                    JOIN stints s ON s.lineup_id = lp.lineup_id
                    JOIN games g ON g.game_id = s.game_id
                    WHERE g.season_id = %s AND lp.player_id = p.player_id
                )
                WHERE p.player_id IN (
                    SELECT DISTINCT lp.player_id FROM lineup_players lp
                    JOIN stints s ON s.lineup_id = lp.lineup_id
                    JOIN games g ON g.game_id = s.game_id
                    WHERE g.season_id = %s
                )
            """, (season, season))
            team_abbr = {}  # team_id -> abbreviation
            player_names = {}
            for pid, name, abbr, tid in cur.fetchall():
                team_abbr[tid] = abbr
                if pid not in player_names:
                    player_names[pid] = name

    if not stints:
        return [], None

    # Compute total minutes per player
    player_total_seconds = {}
    for s in stints:
        for pid in lineup_players.get(s["lineup_id"], []):
            player_total_seconds[pid] = player_total_seconds.get(pid, 0) + s["duration_seconds"]

    # Filter to qualified players
    qualified = {pid for pid, secs in player_total_seconds.items() if secs >= min_minutes * 60}

    player_ids = sorted(qualified)
    if not player_ids:
        return [], None

    player_idx = {pid: i for i, pid in enumerate(player_ids)}
    n_players = len(player_ids)

    valid_stints = [s for s in stints if len(lineup_players.get(s["lineup_id"], [])) == 5]

    n = len(valid_stints)
    import numpy as np
    from scipy.sparse import lil_matrix, csr_matrix
    from sklearn.linear_model import Ridge

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
        primary_tid = player_primary_team.get(pid)
        team = team_abbr.get(primary_tid, "?")
        name = player_names.get(pid, f"Player {pid}")
        minutes = round(player_total_seconds.get(pid, 0) / 60)
        results.append({
            "player_id": pid,
            "player": name.strip(),
            "team": team,
            "rapm": round(float(model.coef_[i]), 2),
            "minutes": minutes,
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
