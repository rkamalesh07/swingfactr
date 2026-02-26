"""
RAPM — Regularized Adjusted Plus/Minus

For each stint we have:
- 5 home players (offense/defense depending on possession)
- 5 away players
- net_points scored by home team
- possessions (estimated from duration)

We build a sparse matrix X where:
- each row = one stint
- each column = one player
- home players get +1, away players get -1
- target y = net points per 100 possessions for that stint
- weight = possessions (longer stints matter more)

Ridge regression finds player coefficients that best explain outcomes.
"""

import numpy as np
from scipy.sparse import lil_matrix, csr_matrix
from sklearn.linear_model import Ridge
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from src.etl.db import init_pool, get_conn

logger = logging.getLogger(__name__)


def fetch_stint_data(season: str):
    """Fetch all stints with their lineups from DB."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Get all stints with enough possessions
            cur.execute("""
                SELECT s.stint_id, s.game_id, s.team_id, s.lineup_id,
                       s.net_points, s.possessions, s.duration_seconds,
                       g.home_team_id, g.away_team_id
                FROM stints s
                JOIN games g ON g.game_id = s.game_id
                WHERE g.season_id = %s
                AND s.duration_seconds >= 30
                AND s.possessions > 0
            """, (season,))
            cols = [d[0] for d in cur.description]
            stints = [dict(zip(cols, r)) for r in cur.fetchall()]

            # Get lineup -> players mapping
            cur.execute("""
                SELECT DISTINCT lp.lineup_id, lp.player_id
                FROM lineup_players lp
                JOIN stints s ON s.lineup_id = lp.lineup_id
                JOIN games g ON g.game_id = s.game_id
                WHERE g.season_id = %s
                AND lp.team_id IS NOT NULL
            """, (season,))
            lineup_players = {}
            for lineup_id, player_id in cur.fetchall():
                if lineup_id not in lineup_players:
                    lineup_players[lineup_id] = []
                lineup_players[lineup_id].append(player_id)

            # Get player info
            cur.execute("""
                SELECT DISTINCT p.player_id, p.first_name || ' ' || p.last_name as name,
                       t.abbreviation as team
                FROM lineup_players lp
                JOIN players p ON p.player_id = lp.player_id
                JOIN teams t ON t.team_id = lp.team_id
                JOIN stints s ON s.lineup_id = lp.lineup_id
                JOIN games g ON g.game_id = s.game_id
                WHERE g.season_id = %s
                AND lp.team_id IS NOT NULL
            """, (season,))
            players = {r[0]: {"name": r[1], "team": r[2]} for r in cur.fetchall()}

    return stints, lineup_players, players


def build_rapm_matrix(stints, lineup_players, players):
    """Build sparse matrix for ridge regression."""
    player_ids = sorted(players.keys())
    player_idx = {pid: i for i, pid in enumerate(player_ids)}
    n_players = len(player_ids)

    valid_stints = []
    for s in stints:
        home_lineup = lineup_players.get(s["lineup_id"], [])
        # Find the opposing lineup for this game/period
        # We use home/away team to determine signs
        if len(home_lineup) == 5:
            valid_stints.append(s)

    if not valid_stints:
        logger.warning("No valid stints found")
        return None, None, None, player_ids

    n_stints = len(valid_stints)
    X = lil_matrix((n_stints, n_players))
    y = np.zeros(n_stints)
    weights = np.zeros(n_stints)

    stints_used = 0
    for i, s in enumerate(valid_stints):
        lineup = lineup_players.get(s["lineup_id"], [])
        if len(lineup) != 5:
            continue

        is_home = s["team_id"] == s["home_team_id"]
        sign = 1 if is_home else -1

        for pid in lineup:
            if pid in player_idx:
                X[i, player_idx[pid]] = sign

        # net points per 100 possessions
        poss = max(s["possessions"], 1)
        y[i] = (s["net_points"] / poss) * 100
        weights[i] = poss
        stints_used += 1

    logger.info(f"Built matrix: {stints_used} stints, {n_players} players")
    return csr_matrix(X), y, weights, player_ids


def run_rapm(season: str = "2025-26", alpha: float = 2000.0):
    """
    Run RAPM for a season.
    alpha=2000 is standard for single-season NBA RAPM.
    Higher alpha = more shrinkage toward 0 (more conservative).
    """
    logger.info(f"Running RAPM for {season}, alpha={alpha}")

    stints, lineup_players, players = fetch_stint_data(season)
    logger.info(f"Fetched {len(stints)} stints, {len(players)} players")

    X, y, weights, player_ids = build_rapm_matrix(stints, lineup_players, players)
    if X is None:
        return []

    # Ridge regression with possession weights
    model = Ridge(alpha=alpha, fit_intercept=False)
    model.fit(X, y, sample_weight=weights)

    # Build results
    results = []
    for i, pid in enumerate(player_ids):
        coef = model.coef_[i]
        player_info = players.get(pid, {})

        # Get minutes played
        total_seconds = sum(
            s["duration_seconds"] for s in stints
            if s["lineup_id"] in lineup_players
            and pid in lineup_players.get(s["lineup_id"], [])
        )
        minutes = total_seconds / 60

        if minutes < 100:  # skip low-minute players
            continue

        results.append({
            "player_id": pid,
            "player": player_info.get("name", f"Player {pid}"),
            "team": player_info.get("team", "?"),
            "rapm": round(float(coef), 2),
            "minutes": round(minutes, 0),
        })

    results.sort(key=lambda x: x["rapm"], reverse=True)
    for i, r in enumerate(results):
        r["rank"] = i + 1

    logger.info(f"RAPM computed for {len(results)} players")
    return results


def store_rapm(results, season: str):
    """Store RAPM results back to DB in lineup_stats or a new structure."""
    # For now just log — we'll add DB storage in next iteration
    logger.info(f"Top 10 RAPM ({season}):")
    for r in results[:10]:
        logger.info(f"  {r['rank']}. {r['player']} ({r['team']}): {r['rapm']:+.2f}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
    init_pool()
    results = run_rapm("2025-26")
    store_rapm(results, "2025-26")
