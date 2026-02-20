"""Lineup Impact Model — RAPM-inspired ridge regression."""

import logging
import pickle
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge

from src.features.lineup_features import build_lineup_aggregate_stats, build_rapm_design_matrix
from src.etl.db import get_conn, upsert_many

logger = logging.getLogger(__name__)
MODEL_DIR = Path(__file__).parent.parent.parent / "models_saved"
MODEL_DIR.mkdir(exist_ok=True)


def train_rapm_model(season_id: str, alpha: float = 2000.0) -> dict:
    logger.info(f"Building RAPM design matrix for {season_id}...")
    X, y, player_ids, lineup_ids = build_rapm_design_matrix(season_id)

    if X.shape[0] == 0:
        raise ValueError(f"No stint data for {season_id}. Run ETL first.")

    logger.info(f"RAPM matrix: {X.shape[0]} stints, {X.shape[1]} players")

    model = Ridge(alpha=alpha, fit_intercept=True)
    model.fit(X, y)

    player_rapm = dict(zip(player_ids, model.coef_))
    lineup_stats = build_lineup_aggregate_stats(season_id)

    lineup_rapm_rows = []
    for _, row in lineup_stats.iterrows():
        lid = row["lineup_id"]
        players_in_lineup = [int(p) for p in str(lid).split("-") if p.isdigit()]
        rapm_est = sum(player_rapm.get(pid, 0.0) for pid in players_in_lineup)
        lineup_rapm_rows.append({"lineup_id": lid, "rapm_estimate": round(rapm_est, 2)})

    ci_map = _bootstrap_rapm_ci(X, y, player_ids, lineup_ids, n_bootstrap=50, alpha=alpha)

    final_rows = []
    rapm_lookup = {r["lineup_id"]: r["rapm_estimate"] for r in lineup_rapm_rows}
    for _, row in lineup_stats.iterrows():
        lid = row["lineup_id"]
        ci = ci_map.get(lid, (None, None))
        final_rows.append({
            "lineup_id": lid,
            "season_id": season_id,
            "team_id": int(row["team_id"]),
            "total_minutes": float(row["total_minutes"]),
            "total_possessions": int(row.get("total_poss_for") or 0),
            "off_rating": float(row["off_rating"]) if not pd.isna(row["off_rating"]) else None,
            "def_rating": float(row["def_rating"]) if not pd.isna(row["def_rating"]) else None,
            "net_rating": float(row["net_rating"]) if not pd.isna(row["net_rating"]) else None,
            "stint_count": int(row["stint_count"]),
            "games_together": int(row["games_together"]),
            "rapm_estimate": rapm_lookup.get(lid),
            "rapm_ci_low": ci[0],
            "rapm_ci_high": ci[1],
        })

    upsert_many("lineup_stats", final_rows, ["lineup_id", "season_id"])

    save_path = MODEL_DIR / f"rapm_{season_id.replace('-', '')}.pkl"
    with open(save_path, "wb") as f:
        pickle.dump({"model": model, "player_ids": player_ids, "player_rapm": player_rapm}, f)
    logger.info(f"RAPM model saved to {save_path}")

    return {"model": model, "player_rapm": player_rapm, "n_stints": X.shape[0]}


def _bootstrap_rapm_ci(X, y, player_ids, lineup_ids, n_bootstrap=50, alpha=2000.0) -> dict:
    lineup_estimates: dict = {}
    rng = np.random.RandomState(42)
    lineup_to_row_idx: dict = {}
    for i, lid in enumerate(lineup_ids):
        lineup_to_row_idx.setdefault(lid, []).append(i)

    for _ in range(n_bootstrap):
        boot_idx = rng.choice(len(y), size=len(y), replace=True)
        m = Ridge(alpha=alpha, fit_intercept=True)
        m.fit(X[boot_idx], y[boot_idx])
        pr = dict(zip(player_ids, m.coef_))
        for lid in lineup_to_row_idx:
            players = [int(p) for p in str(lid).split("-") if p.isdigit()]
            est = sum(pr.get(pid, 0.0) for pid in players)
            lineup_estimates.setdefault(lid, []).append(est)

    return {
        lid: (round(float(np.percentile(e, 5)), 2), round(float(np.percentile(e, 95)), 2))
        for lid, e in lineup_estimates.items()
    }


def get_team_lineup_rankings(team_id: int, season_id: str, min_minutes: float = 5.0) -> pd.DataFrame:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT ls.lineup_id, ls.total_minutes, ls.off_rating, ls.def_rating,
                       ls.net_rating, ls.rapm_estimate, ls.rapm_ci_low, ls.rapm_ci_high,
                       ls.stint_count, ls.games_together
                FROM lineup_stats ls
                WHERE ls.team_id = %s AND ls.season_id = %s AND ls.total_minutes >= %s
                ORDER BY ls.rapm_estimate DESC NULLS LAST
                LIMIT 20
            """, (team_id, season_id, min_minutes))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT player_id, first_name, last_name, full_name FROM players")
            pcols = [d[0] for d in cur.description]
            player_names = {}
            for r in cur.fetchall():
                pr = dict(zip(pcols, r))
                name = pr.get("full_name") or f"{pr.get('first_name','')} {pr.get('last_name','')}".strip()
                player_names[pr["player_id"]] = name

    def lineup_display(lineup_id: str) -> str:
        try:
            pids = [int(p) for p in str(lineup_id).split("-") if p.isdigit()]
            names = [player_names.get(pid, str(pid)) for pid in pids]
            return " / ".join(sorted(n.split()[-1] for n in names if n))
        except Exception:
            return lineup_id

    df["lineup_display"] = df["lineup_id"].apply(lineup_display)
    return df
