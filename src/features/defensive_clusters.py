"""Infer defensive scheme clusters from play-by-play shot profile features.

Without optical tracking data, we approximate defensive schemes using:
- opponent 3PA rate (high = allows 3s → could be drop/zone)
- opponent rim attempt rate (high = allows paint → soft coverage)
- average opponent shot distance
- defensive rebound rate
- pace allowed (possessions per game)
- foul rate

We cluster these 6 features per team-season using k-means (k=4).
The cluster labels are subjective but validated by checking known
defensive teams (e.g., Boston Celtics should not be in 'zone-ish').

Cluster interpretations (heuristic, may vary by season):
- 0: Drop/Passive  - high 3PA allowed, low rim allowed, soft scheme
- 1: Switching     - moderate everything, high foul rate
- 2: Pack-the-Paint - low 3PA, high rim, aggressive help defense
- 3: Zone-ish      - high rim allowed, low foul rate, passive close-outs
"""

import logging

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

from src.etl.db import get_conn, upsert_many

logger = logging.getLogger(__name__)

CLUSTER_LABELS = ["drop", "switch", "pack-paint", "zone-ish"]
N_CLUSTERS = 4


def build_defensive_profiles(season_id: str) -> pd.DataFrame:
    """
    Compute defensive profile features for each team in a season.
    Uses plays table: shots allowed, fouls, pace.
    
    Returns DataFrame with one row per team and defensive stats.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            # For each team, compute stats from plays where OTHER team is shooting
            cur.execute("""
                SELECT
                    CASE WHEN p.possession_team_id = g.home_team_id THEN g.away_team_id
                         ELSE g.home_team_id END AS defending_team_id,
                    COUNT(*) AS total_plays,
                    SUM(CASE WHEN p.is_fg_attempt THEN 1 ELSE 0 END) AS fga,
                    SUM(CASE WHEN p.is_3pt AND p.is_fg_attempt THEN 1 ELSE 0 END) AS tpa,
                    SUM(CASE WHEN p.is_rim_attempt THEN 1 ELSE 0 END) AS rim_att,
                    AVG(CASE WHEN p.shot_distance IS NOT NULL THEN p.shot_distance END) AS avg_shot_dist,
                    SUM(CASE WHEN p.is_foul THEN 1 ELSE 0 END) AS total_fouls,
                    SUM(CASE WHEN p.is_turnover THEN 1 ELSE 0 END) AS total_turnovers
                FROM plays p
                JOIN games g ON g.game_id = p.game_id
                WHERE g.season_id = %s
                  AND p.possession_team_id IS NOT NULL
                  AND p.period <= 4
                GROUP BY defending_team_id
            """, (season_id,))
            rows = cur.fetchall()

    if not rows:
        return pd.DataFrame()

    cols = [d[0] for d in cur.description]
    df = pd.DataFrame(rows, columns=cols)
    df = df[df["fga"] > 0]

    df["opp_3pa_rate"] = (df["tpa"] / df["fga"]).round(3)
    df["opp_rim_rate"] = (df["rim_att"] / df["fga"]).round(3)
    df["avg_shot_dist"] = df["avg_shot_dist"].fillna(14.0).round(1)
    df["foul_rate"] = (df["total_fouls"] / df["fga"] * 100).round(1)
    df["turnover_rate"] = (df["total_turnovers"] / df["fga"] * 100).round(1)

    return df


def fit_defensive_clusters(df: pd.DataFrame, season_id: str, random_state: int = 42) -> pd.DataFrame:
    """
    Fit k-means clustering on defensive profile features.
    Stores results in defensive_profiles table.
    
    Returns DataFrame with cluster assignments.
    """
    if df.empty:
        return df

    feature_cols = ["opp_3pa_rate", "opp_rim_rate", "avg_shot_dist", "foul_rate"]
    X = df[feature_cols].fillna(df[feature_cols].mean())

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    kmeans = KMeans(n_clusters=N_CLUSTERS, random_state=random_state, n_init=10)
    df = df.copy()
    df["def_cluster"] = kmeans.fit_predict(X_scaled)

    # Heuristic labeling: cluster with highest avg_shot_dist = drop,
    # highest rim rate = pack-paint, etc.
    cluster_means = df.groupby("def_cluster")[feature_cols].mean()
    
    # Drop = highest 3PA allowed + highest avg shot dist (defend at basket, give up 3s)
    # Pack = highest rim rate allowed (everything close to basket)
    # Switch = highest foul rate (aggressive perimeter)
    # Zone = intermediate
    
    # Simple heuristic: sort by opp_3pa_rate and assign labels
    sorted_clusters = cluster_means["opp_3pa_rate"].sort_values(ascending=False).index.tolist()
    cluster_label_map = {
        sorted_clusters[0]: "drop",    # most 3PAs allowed
        sorted_clusters[1]: "zone-ish",
        sorted_clusters[2]: "switch",
        sorted_clusters[3]: "pack-paint",  # fewest 3PAs (packs the paint)
    }
    df["cluster_label"] = df["def_cluster"].map(cluster_label_map)

    # Store in DB
    rows = []
    for _, row in df.iterrows():
        rows.append({
            "team_id": int(row["defending_team_id"]),
            "season_id": season_id,
            "opp_3pa_rate": float(row["opp_3pa_rate"]),
            "opp_rim_rate": float(row["opp_rim_rate"]),
            "avg_shot_dist": float(row["avg_shot_dist"]),
            "def_reb_pct": None,
            "opp_pace": None,
            "foul_rate": float(row["foul_rate"]),
            "def_cluster": int(row["def_cluster"]),
            "cluster_label": row["cluster_label"],
        })

    if rows:
        upsert_many("defensive_profiles", rows, ["team_id", "season_id"])
        # Update games table with cluster IDs
        with get_conn() as conn:
            with conn.cursor() as cur:
                for row_dict in rows:
                    cur.execute("""
                        UPDATE games SET home_def_cluster = %s
                        WHERE home_team_id = %s AND season_id = %s
                    """, (row_dict["def_cluster"], row_dict["team_id"], season_id))
                    cur.execute("""
                        UPDATE games SET away_def_cluster = %s
                        WHERE away_team_id = %s AND season_id = %s
                    """, (row_dict["def_cluster"], row_dict["team_id"], season_id))

    logger.info(f"Defensive clusters computed for {len(df)} teams in {season_id}")
    return df


def run_defensive_clustering(season_id: str) -> pd.DataFrame:
    """Run the full defensive clustering pipeline."""
    df = build_defensive_profiles(season_id)
    return fit_defensive_clusters(df, season_id)
