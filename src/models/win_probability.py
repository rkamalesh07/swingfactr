"""Win Probability Model for SwingFactr.

Training strategy:
- Train on TRAINING_SEASONS (2020-21 → 2024-25) where all game outcomes are known
- Evaluate with game-aware train/test split (no leakage between plays in same game)
- Inference runs on CURRENT_SEASON (2025-26) daily as games complete

This is correct because: for any play in 2025-26, we know the game eventually
ended — we just don't know when we're predicting mid-game. The model was trained
on completed historical games, so it learned what game states tend to win.

Evaluation metrics:
- Brier score (lower better; random = 0.25, perfect = 0)
- Log loss
- ROC AUC
- Calibration curve / reliability diagram
- Time-slice AUC per quarter
"""

import argparse
import logging
import pickle
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit
import xgboost as xgb

from src.config import TRAINING_SEASONS, CURRENT_SEASON
from src.features.win_prob_features import build_win_prob_dataset, FEATURE_COLS
from src.etl.db import get_conn

logger = logging.getLogger(__name__)
MODEL_DIR = Path(__file__).parent.parent.parent / "models_saved"
MODEL_DIR.mkdir(exist_ok=True)

# Saved model is shared across all historical seasons
MODEL_PATH = MODEL_DIR / "win_prob_xgb.pkl"


def train_win_prob_model(
    training_seasons: list[str] = TRAINING_SEASONS,
    model_type: str = "xgb",
    test_size: float = 0.15,
    random_state: int = 42,
) -> dict:
    """
    Train win probability model on historical seasons (all outcomes known).
    
    Combines data from all training_seasons into one dataset, then splits
    by game (not by play) to prevent leakage.
    
    Args:
        training_seasons: list of season strings to train on
        model_type: 'xgb' or 'lr'
        test_size: fraction of games held out for evaluation
        random_state: seed for reproducibility
    
    Returns:
        dict with model, metrics, feature_importance
    """
    logger.info(f"Building training data from {len(training_seasons)} seasons...")

    dfs = []
    for season in training_seasons:
        df_s = build_win_prob_dataset(season)
        if not df_s.empty:
            df_s["season_id"] = season
            dfs.append(df_s)
            logger.info(f"  {season}: {len(df_s)} rows, {df_s['game_id'].nunique()} games")

    if not dfs:
        raise ValueError("No data found. Run ETL first: python -m src.etl.run_pipeline --mode train")

    df = pd.concat(dfs, ignore_index=True)
    logger.info(f"Total: {len(df)} play-rows, {df['game_id'].nunique()} games")

    X = df[FEATURE_COLS].values
    y = df["home_win"].values
    groups = df["game_id"].values  # split by game, not by row

    gss = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=random_state)
    train_idx, test_idx = next(gss.split(X, y, groups))

    X_train, X_test = X[train_idx], X[test_idx]
    y_train, y_test = y[train_idx], y[test_idx]
    g_test = groups[test_idx]

    logger.info(f"Train: {len(X_train)} rows | Test: {len(X_test)} rows ({len(set(g_test))} games)")

    if model_type == "xgb":
        base = xgb.XGBClassifier(
            n_estimators=400,
            max_depth=5,
            learning_rate=0.04,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_weight=10,
            eval_metric="logloss",
            random_state=random_state,
            n_jobs=-1,
        )
        model = CalibratedClassifierCV(base, method="sigmoid", cv=3)
    else:
        base = LogisticRegression(max_iter=2000, C=0.1, random_state=random_state)
        model = CalibratedClassifierCV(base, method="sigmoid", cv=3)

    model.fit(X_train, y_train)

    y_prob = model.predict_proba(X_test)[:, 1]
    game_seconds_test = df.iloc[test_idx]["game_seconds_elapsed"].values
    metrics = _evaluate(y_test, y_prob, game_seconds_test)

    # Feature importance
    feat_importance = {}
    if model_type == "xgb":
        try:
            inner = model.calibrated_classifiers_[0].estimator
            feat_importance = dict(zip(FEATURE_COLS, inner.feature_importances_))
        except Exception:
            pass

    # Save
    with open(MODEL_PATH, "wb") as f:
        pickle.dump({
            "model": model,
            "feature_cols": FEATURE_COLS,
            "training_seasons": training_seasons,
            "model_type": model_type,
        }, f)
    logger.info(f"Model saved → {MODEL_PATH}")

    # Log to DB
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO model_runs (model_name, season_id, brier_score, log_loss, auc, notes)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                f"win_prob_{model_type}",
                training_seasons[-1] if training_seasons else "2024-25",
                metrics["brier_score"], metrics["log_loss"], metrics["auc"],
                f"trained_on={len(training_seasons)}_seasons,test_games={len(set(g_test))}"[:200]
            ))

    return {"model": model, "metrics": metrics, "feature_importance": feat_importance}


def _evaluate(y_true: np.ndarray, y_prob: np.ndarray, game_seconds: np.ndarray | None = None) -> dict:
    metrics = {
        "brier_score": round(brier_score_loss(y_true, y_prob), 4),
        "log_loss": round(log_loss(y_true, y_prob), 4),
        "auc": round(roc_auc_score(y_true, y_prob), 4),
    }
    if game_seconds is not None:
        for label, (s, e) in [("Q1",(0,720)),("Q2",(720,1440)),("Q3",(1440,2160)),("Q4",(2160,2880))]:
            mask = (game_seconds >= s) & (game_seconds < e)
            if mask.sum() > 50 and y_true[mask].sum() > 0:
                metrics[f"auc_{label}"] = round(roc_auc_score(y_true[mask], y_prob[mask]), 4)
    return metrics


def load_model() -> dict:
    """Load the trained win probability model."""
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"No model found at {MODEL_PATH}. "
            "Run: python -m src.models.train_all"
        )
    with open(MODEL_PATH, "rb") as f:
        return pickle.load(f)


def predict_game_win_prob(
    game_id: str,
    training_seasons: list[str] = TRAINING_SEASONS,
) -> pd.DataFrame:
    """
    Generate and store win probability curve for a completed or in-progress game.
    Works for both historical games and current-season games.
    
    Returns DataFrame with game_seconds and home_win_prob columns.
    """
    model_data = load_model()
    model = model_data["model"]
    feat_cols = model_data["feature_cols"]

    # Determine which season this game belongs to
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT season_id FROM games WHERE game_id = %s", (game_id,))
            row = cur.fetchone()
    if not row:
        raise ValueError(f"Game {game_id} not in DB")
    season_id = row[0] if isinstance(row, (list, tuple)) else row["season_id"]

    df_all = build_win_prob_dataset(season_id, sample_every_n=1)
    df = df_all[df_all["game_id"] == game_id].copy()
    if df.empty:
        return pd.DataFrame()

    X = df[feat_cols].values
    probs = model.predict_proba(X)[:, 1]
    df["home_win_prob"] = probs
    df = df.sort_values("game_seconds_elapsed")
    # Smooth with rolling window for display
    df["home_win_prob_smooth"] = df["home_win_prob"].rolling(7, center=True, min_periods=1).mean()

    # Store predictions
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM win_prob_predictions WHERE game_id = %s", (game_id,))
            for _, r in df.iterrows():
                cur.execute(
                    "INSERT INTO win_prob_predictions (game_id, play_id, game_seconds, home_win_prob) VALUES (%s,%s,%s,%s)",
                    (game_id, int(r["play_id"]), int(r["game_seconds_elapsed"]), float(r["home_win_prob_smooth"]))
                )

    return df[["game_seconds_elapsed", "home_win_prob", "home_win_prob_smooth"]]


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s — %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--seasons", nargs="+", default=TRAINING_SEASONS)
    parser.add_argument("--model", default="xgb", choices=["xgb", "lr"])
    parser.add_argument("--eval", action="store_true")
    parser.add_argument("--plot", action="store_true")
    args = parser.parse_args()

    result = train_win_prob_model(training_seasons=args.seasons, model_type=args.model)
    print("\n=== Win Probability Results ===")
    for k, v in result["metrics"].items():
        print(f"  {k}: {v}")
    if result["feature_importance"]:
        print("\nTop features:")
        for feat, imp in sorted(result["feature_importance"].items(), key=lambda x: -x[1])[:8]:
            print(f"  {feat}: {imp:.4f}")

    if args.plot:
        try:
            import matplotlib.pyplot as plt
            df_plot = build_win_prob_dataset(args.seasons[0])
            y_all = df_plot["home_win"].values
            y_prob_all = result["model"].predict_proba(df_plot[FEATURE_COLS].values)[:, 1]
            prob_true, prob_pred = calibration_curve(y_all, y_prob_all, n_bins=10)
            plt.figure(figsize=(7, 5))
            plt.plot(prob_pred, prob_true, "s-", label="SwingFactr")
            plt.plot([0,1],[0,1],"k--",label="Perfect")
            plt.xlabel("Predicted probability"); plt.ylabel("Actual fraction")
            plt.title("Win Probability Calibration Curve")
            plt.legend(); plt.tight_layout()
            plt.savefig("calibration_curve.png", dpi=150)
            print("Saved calibration_curve.png")
        except ImportError:
            print("pip install matplotlib to generate plot")
