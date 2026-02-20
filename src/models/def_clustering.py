"""
src/models/def_clustering.py
Defensive Scheme Proxy Clustering

Uses unsupervised k-means on team-level defensive profiles to assign
"scheme-like" cluster labels. Labels are NOT ground truth — they're
ML proxies inferred purely from play-by-play shot data.

Cluster interpretation example (will vary by season):
  Cluster 0: "drop-coverage-like"  — allows more mid-range, fewer rim shots
  Cluster 1: "switch-heavy-like"   — high foul rate, fewer open 3s allowed
  Cluster 2: "zone-ish"            — low pace allowed, high def reb rate

The cluster_id is fed as a categorical feature into lineup/win-prob models
to capture opponent defensive context.
"""

import logging
import json
from pathlib import Path

import numpy as np
import pandas as pd
import joblib
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import silhouette_score
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

logger = logging.getLogger(__name__)
MODELS_DIR = Path("models_store")
FEATURES_DIR = Path("features_store")

SCHEME_LABELS = {
    0: "drop-coverage-like",
    1: "switch-heavy-like",
    2: "zone-ish",
    3: "aggressive-help",
}

PROFILE_FEATURES = [
    "avg_shot_dist",
    "opp_3pa_rate",
    "foul_rate",
]


def train_def_clustering(n_clusters: int = 4) -> pd.DataFrame:
    """
    Load defensive profiles, cluster, assign labels, store results.
    """
    path = FEATURES_DIR / "def_profiles.parquet"
    if not path.exists():
        logger.warning("Defensive profiles not found. Run feature engineering first.")
        return pd.DataFrame()

    df = pd.read_parquet(path).dropna(subset=PROFILE_FEATURES)
    if len(df) < n_clusters:
        logger.warning("Not enough data for clustering (%d rows).", len(df))
        return df

    X = df[PROFILE_FEATURES].values
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Find optimal k via silhouette
    best_k, best_score = n_clusters, -1
    if len(df) > 10:
        for k in range(2, min(6, len(df))):
            km = KMeans(n_clusters=k, random_state=42, n_init=10)
            labels = km.fit_predict(X_scaled)
            score = silhouette_score(X_scaled, labels)
            logger.info("k=%d  silhouette=%.3f", k, score)
            if score > best_score:
                best_score = score
                best_k = k

    logger.info("Using k=%d clusters (silhouette=%.3f)", best_k, best_score)
    km = KMeans(n_clusters=best_k, random_state=42, n_init=10)
    df["cluster_id"] = km.fit_predict(X_scaled)
    df["scheme_label"] = df["cluster_id"].map(SCHEME_LABELS).fillna("unknown")

    # Save
    joblib.dump({"kmeans": km, "scaler": scaler, "feature_cols": PROFILE_FEATURES},
                MODELS_DIR / "def_cluster_model.pkl")
    df.to_parquet(MODELS_DIR / "def_clusters.parquet", index=False)

    # Upsert to Postgres
    try:
        from src.etl.db import session_scope
        with session_scope() as sess:
            for _, row in df.iterrows():
                sess.execute(
                    """
                    INSERT INTO def_clusters (team_id, season, cluster_id, scheme_label,
                        avg_shot_dist_allowed, opp_3pa_rate, foul_rate)
                    VALUES (:team_id, :season, :cluster_id, :scheme_label,
                        :avg_shot_dist, :opp_3pa_rate, :foul_rate)
                    ON CONFLICT (team_id, season) DO UPDATE SET
                        cluster_id = EXCLUDED.cluster_id,
                        scheme_label = EXCLUDED.scheme_label
                    """,
                    row.to_dict(),
                )
        logger.info("Defensive clusters upserted.")
    except Exception as e:
        logger.warning("Could not upsert clusters: %s", e)

    _plot_clusters(X_scaled, df["cluster_id"].values, df["scheme_label"].values)
    return df


def predict_scheme(team_id: int, season: str) -> dict:
    """Load cached cluster result for a team/season."""
    path = MODELS_DIR / "def_clusters.parquet"
    if not path.exists():
        return {}
    df = pd.read_parquet(path)
    row = df[(df["team_id"] == team_id) & (df["season"] == season)]
    if row.empty:
        return {}
    r = row.iloc[0]
    return {"cluster_id": int(r["cluster_id"]), "scheme_label": str(r["scheme_label"])}


def _plot_clusters(X_scaled, labels, scheme_labels):
    if X_scaled.shape[1] < 2:
        return
    fig, ax = plt.subplots(figsize=(7, 6))
    for c in np.unique(labels):
        mask = labels == c
        label = SCHEME_LABELS.get(int(c), f"cluster_{c}")
        ax.scatter(X_scaled[mask, 0], X_scaled[mask, 1], label=label, alpha=0.8)
    ax.set_xlabel(PROFILE_FEATURES[0])
    ax.set_ylabel(PROFILE_FEATURES[1])
    ax.set_title("Defensive Scheme Clusters (proxy)")
    ax.legend()
    plt.tight_layout()
    plt.savefig(MODELS_DIR / "def_clusters_plot.png", dpi=120, bbox_inches="tight")
    plt.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    train_def_clustering()
