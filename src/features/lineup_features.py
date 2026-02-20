"""Build lineup-level feature dataset for RAPM-style impact modeling."""

import logging
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from src.etl.db import get_conn

logger = logging.getLogger(__name__)


def build_lineup_aggregate_stats(season_id: str) -> pd.DataFrame:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    s.lineup_id, s.team_id,
                    COUNT(*) AS stint_count,
                    SUM(s.duration_seconds) / 60.0 AS total_minutes,
                    SUM(s.points_for) AS total_pts_for,
                    SUM(s.points_against) AS total_pts_against,
                    SUM(s.possessions_for) AS total_poss_for,
                    SUM(s.possessions_against) AS total_poss_against,
                    COUNT(DISTINCT s.game_id) AS games_together
                FROM stints s
                JOIN games g ON g.game_id = s.game_id
                WHERE g.season_id = %s
                GROUP BY s.lineup_id, s.team_id
                HAVING SUM(s.duration_seconds) >= 60
            """, (season_id,))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df["poss_for"] = df["total_poss_for"].replace(0, 1)
    df["poss_against"] = df["total_poss_against"].replace(0, 1)
    df["off_rating"] = (df["total_pts_for"] / df["poss_for"] * 100).round(1)
    df["def_rating"] = (df["total_pts_against"] / df["poss_against"] * 100).round(1)
    df["net_rating"] = (df["off_rating"] - df["def_rating"]).round(1)
    df["season_id"] = season_id
    return df


def build_rapm_design_matrix(season_id: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.stint_id, s.lineup_id, s.team_id, s.game_id,
                       s.points_for, s.points_against,
                       s.possessions_for, s.duration_seconds, g.home_team_id
                FROM stints s
                JOIN games g ON g.game_id = s.game_id
                WHERE g.season_id = %s AND s.duration_seconds >= 30
            """, (season_id,))
            scols = [d[0] for d in cur.description]
            stints = [dict(zip(scols, r)) for r in cur.fetchall()]

            cur.execute("""
                SELECT DISTINCT lp.lineup_id, lp.player_id
                FROM lineup_players lp
                JOIN stints s ON s.lineup_id = lp.lineup_id
                JOIN games g ON g.game_id = s.game_id
                WHERE g.season_id = %s
            """, (season_id,))
            lpcols = [d[0] for d in cur.description]
            lp_rows = [dict(zip(lpcols, r)) for r in cur.fetchall()]

    if not stints:
        return csr_matrix((0, 0)), np.array([]), [], []

    lineup_to_players: dict = {}
    for row in lp_rows:
        lineup_to_players.setdefault(row["lineup_id"], []).append(row["player_id"])

    all_players = sorted(set(p for players in lineup_to_players.values() for p in players))
    player_idx = {pid: i for i, pid in enumerate(all_players)}

    rows_data, cols_data, vals_data, y_vals, lineup_ids_out = [], [], [], [], []

    for row_i, stint in enumerate(stints):
        lid = stint["lineup_id"]
        players = lineup_to_players.get(lid, [])
        poss = max(stint["possessions_for"] or 1, 1)
        net_per_100 = ((stint["points_for"] or 0) - (stint["points_against"] or 0)) / poss * 100
        sign = 1 if stint["team_id"] == stint["home_team_id"] else -1
        for pid in players:
            if pid in player_idx:
                rows_data.append(row_i)
                cols_data.append(player_idx[pid])
                vals_data.append(sign)
        y_vals.append(net_per_100)
        lineup_ids_out.append(lid)

    n_rows = len(y_vals)
    n_cols = len(all_players)
    X = csr_matrix((vals_data, (rows_data, cols_data)), shape=(n_rows, n_cols))
    return X, np.array(y_vals), all_players, lineup_ids_out
