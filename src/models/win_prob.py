"""
src/models/win_prob.py
Win Probability Model

Architecture:
  Baseline: Calibrated Logistic Regression (interpretable, fast)
  Main: XGBoost (better accuracy, still explainable via SHAP)
  Optional: LSTM (only if XGBoost Brier score doesn't meet threshold)

Evaluation:
  - Brier score (lower = better; baseline naive model ≈ 0.25)
  - Log loss
  - AUC
  - Calibration curve / reliability diagram
  - Time-slice Brier (early/mid/late game accuracy)

Target variable: home_win (binary)
Train/test split: by GAME (not by row) to prevent leakage.
"""

import logging
import os
import json
from pathlib import Path

import numpy as np
import pandas as pd
import joblib
import shap
import matplotlib
matplotlib.use("Agg")  # Non-interactive backend
import matplotlib.pyplot as plt

from sklearn.linear_model import LogisticRegression
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline

import xgboost as xgb

logger = logging.getLogger(__name__)

MODELS_DIR = Path(os.getenv("MODELS_DIR", "models_store"))
MODELS_DIR.mkdir(exist_ok=True)

FEATURE_COLS = [
    "score_diff",
    "score_diff_sq",
    "score_diff_x_time",
    "pct_time_remaining",
    "is_overtime",
    "score_diff_momentum",
    "rest_diff",
    "net_rating_diff",
    "home_btb",
    "away_btb",
    "travel_dist_miles",
    "tz_change_hours",
    "high_altitude_home",
]

TARGET_COL = "home_win"


# ─── Data loading ─────────────────────────────────────────────────────────────

def load_data(features_dir: str = "features_store") -> pd.DataFrame:
    path = Path(features_dir) / "win_prob_features.parquet"
    if not path.exists():
        raise FileNotFoundError(
            f"Features not found at {path}. Run: python -m src.features.build_features"
        )
    df = pd.read_parquet(path)

    # Fill missing
    df[FEATURE_COLS] = df[FEATURE_COLS].fillna(0)
    df = df.dropna(subset=[TARGET_COL])
    return df


# ─── Train / Eval ─────────────────────────────────────────────────────────────

def train_and_evaluate(features_dir: str = "features_store") -> dict:
    df = load_data(features_dir)

    X = df[FEATURE_COLS].values
    y = df[TARGET_COL].values
    groups = df["game_id"].values  # Group by game for split

    # Game-aware train/test split (80/20 by game)
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    train_idx, test_idx = next(splitter.split(X, y, groups))
    X_train, X_test = X[train_idx], X[test_idx]
    y_train, y_test = y[train_idx], y[test_idx]

    logger.info("Train: %d plays | Test: %d plays", len(X_train), len(X_test))

    results = {}

    # ── Model 1: Logistic Regression (baseline) ──────────────────────────────
    logger.info("Training Logistic Regression baseline...")
    lr_pipe = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", CalibratedClassifierCV(
            LogisticRegression(max_iter=1000, C=1.0),
            cv=5, method="isotonic"
        )),
    ])
    lr_pipe.fit(X_train, y_train)
    lr_probs = lr_pipe.predict_proba(X_test)[:, 1]

    results["logistic"] = _evaluate(y_test, lr_probs, "Logistic Regression")
    joblib.dump(lr_pipe, MODELS_DIR / "win_prob_logistic.pkl")

    # ── Model 2: XGBoost (main model) ─────────────────────────────────────────
    logger.info("Training XGBoost...")
    xgb_model = xgb.XGBClassifier(
        n_estimators=500,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=5,
        use_label_encoder=False,
        eval_metric="logloss",
        random_state=42,
        n_jobs=-1,
        early_stopping_rounds=30,
    )
    xgb_model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )
    # Calibrate XGBoost probabilities
    xgb_calibrated = CalibratedClassifierCV(xgb_model, cv="prefit", method="isotonic")
    xgb_calibrated.fit(X_test, y_test)

    xgb_probs = xgb_calibrated.predict_proba(X_test)[:, 1]
    results["xgboost"] = _evaluate(y_test, xgb_probs, "XGBoost (calibrated)")
    joblib.dump(xgb_calibrated, MODELS_DIR / "win_prob_xgb.pkl")
    joblib.dump(xgb_model, MODELS_DIR / "win_prob_xgb_raw.pkl")

    # ── Save feature names + metrics ─────────────────────────────────────────
    with open(MODELS_DIR / "win_prob_metrics.json", "w") as f:
        json.dump(results, f, indent=2)

    # ── Calibration plot ──────────────────────────────────────────────────────
    _plot_calibration(y_test, lr_probs, xgb_probs)

    # ── SHAP feature importance ───────────────────────────────────────────────
    _shap_summary(xgb_model, X_test, FEATURE_COLS)

    # ── Time-slice Brier ──────────────────────────────────────────────────────
    test_df = df.iloc[test_idx].copy()
    test_df["xgb_prob"] = xgb_probs
    _time_slice_brier(test_df)

    logger.info("Results: %s", json.dumps(results, indent=2))
    return results


def _evaluate(y_true, y_prob, name: str) -> dict:
    metrics = {
        "brier_score": round(float(brier_score_loss(y_true, y_prob)), 4),
        "log_loss": round(float(log_loss(y_true, y_prob)), 4),
        "auc": round(float(roc_auc_score(y_true, y_prob)), 4),
    }
    logger.info(
        "%s — Brier: %.4f | LogLoss: %.4f | AUC: %.4f",
        name, metrics["brier_score"], metrics["log_loss"], metrics["auc"]
    )
    return metrics


def _plot_calibration(y_test, lr_probs, xgb_probs) -> None:
    fig, ax = plt.subplots(figsize=(7, 6))
    for probs, label in [(lr_probs, "Logistic"), (xgb_probs, "XGBoost")]:
        frac_pos, mean_pred = calibration_curve(y_test, probs, n_bins=15)
        ax.plot(mean_pred, frac_pos, marker="o", label=label)
    ax.plot([0, 1], [0, 1], "k--", label="Perfect")
    ax.set_xlabel("Mean Predicted Probability")
    ax.set_ylabel("Fraction of Positives")
    ax.set_title("SwingFactr Win Probability — Calibration Curve")
    ax.legend()
    fig.savefig(MODELS_DIR / "calibration_curve.png", dpi=120, bbox_inches="tight")
    plt.close(fig)
    logger.info("Calibration plot saved.")


def _shap_summary(model, X_test, feature_names) -> None:
    try:
        explainer = shap.TreeExplainer(model)
        shap_values = explainer.shap_values(X_test[:1000])  # sample for speed
        fig, ax = plt.subplots(figsize=(8, 5))
        shap.summary_plot(shap_values, X_test[:1000], feature_names=feature_names,
                          show=False, plot_type="bar")
        plt.tight_layout()
        plt.savefig(MODELS_DIR / "shap_summary.png", dpi=120, bbox_inches="tight")
        plt.close()
    except Exception as e:
        logger.warning("SHAP failed: %s", e)


def _time_slice_brier(test_df: pd.DataFrame) -> dict:
    """Evaluate Brier score at early/mid/late game stages."""
    slices = {
        "early (0-30%)": test_df[test_df["pct_time_remaining"] > 0.7],
        "mid (30-70%)":  test_df[(test_df["pct_time_remaining"] >= 0.3) & (test_df["pct_time_remaining"] <= 0.7)],
        "late (70%+)":   test_df[test_df["pct_time_remaining"] < 0.3],
    }
    results = {}
    for name, subset in slices.items():
        if len(subset) > 0:
            bs = brier_score_loss(subset["home_win"], subset["xgb_prob"])
            results[name] = round(float(bs), 4)
            logger.info("Time-slice Brier [%s]: %.4f", name, bs)

    with open(MODELS_DIR / "time_slice_brier.json", "w") as f:
        json.dump(results, f, indent=2)
    return results


# ─── Inference ────────────────────────────────────────────────────────────────

def load_model(model_type: str = "xgboost"):
    """Load a trained win probability model."""
    path = MODELS_DIR / f"win_prob_{'xgb' if model_type == 'xgboost' else 'logistic'}.pkl"
    if not path.exists():
        raise FileNotFoundError(f"Model not found at {path}. Run: python -m src.models.win_prob")
    return joblib.load(path)


def predict_game_series(game_plays_df: pd.DataFrame, model=None) -> pd.DataFrame:
    """
    Given a DataFrame of plays for one game (from `plays` table),
    return play-by-play win probability series for the home team.
    """
    if model is None:
        model = load_model()

    df = game_plays_df.copy()

    # Engineer features (same as training)
    df["score_diff_sq"] = df["score_diff"] ** 2
    df["pct_time_remaining"] = df["seconds_remaining"] / 2880.0
    df["score_diff_x_time"] = df["score_diff"] * df["pct_time_remaining"]
    df["is_overtime"] = (df["period"] > 4).astype(int)
    df["score_diff_momentum"] = (
        df["score_diff"].rolling(window=10, min_periods=1).mean()
    )
    for col in FEATURE_COLS:
        if col not in df.columns:
            df[col] = 0

    X = df[FEATURE_COLS].fillna(0).values
    df["home_win_prob"] = model.predict_proba(X)[:, 1]
    return df[["seconds_elapsed", "score_diff", "home_win_prob", "event_type", "description"]]


if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser()
    parser.add_argument("--features-dir", default="features_store")
    args = parser.parse_args()
    train_and_evaluate(args.features_dir)
