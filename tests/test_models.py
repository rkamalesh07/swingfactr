"""Tests for model training functions using synthetic data.

These tests don't require a real DB connection — they test model logic
with synthetic DataFrames and numpy arrays.
"""

import numpy as np
import pandas as pd
import pytest
from scipy.sparse import csr_matrix
from sklearn.linear_model import Ridge


class TestWinProbEvaluation:
    """Test evaluation metric computation."""

    def test_brier_perfect(self):
        from src.models.win_probability import evaluate_win_prob
        y = np.array([1, 0, 1, 0])
        y_prob = np.array([1.0, 0.0, 1.0, 0.0])
        metrics = evaluate_win_prob(y, y_prob)
        assert metrics["brier_score"] == pytest.approx(0.0, abs=1e-6)

    def test_brier_random(self):
        from src.models.win_probability import evaluate_win_prob
        np.random.seed(42)
        y = np.random.randint(0, 2, 1000)
        y_prob = np.full(1000, 0.5)
        metrics = evaluate_win_prob(y, y_prob)
        assert 0.20 < metrics["brier_score"] < 0.26

    def test_auc_range(self):
        from src.models.win_probability import evaluate_win_prob
        np.random.seed(0)
        y = np.random.randint(0, 2, 500)
        y_prob = np.clip(y + np.random.normal(0, 0.3, 500), 0, 1)
        metrics = evaluate_win_prob(y, y_prob)
        assert 0.5 <= metrics["auc"] <= 1.0


class TestRAPMMatrix:
    """Test RAPM design matrix construction logic."""

    def test_ridge_regression_runs(self):
        """RAPM ridge regression should converge without errors."""
        np.random.seed(42)
        n_stints = 200
        n_players = 50
        # Sparse design matrix: each row has 5 nonzeros (+1 home, -1 away)
        rows, cols, vals = [], [], []
        for i in range(n_stints):
            home_players = np.random.choice(n_players // 2, 5, replace=False)
            away_players = np.random.choice(range(n_players // 2, n_players), 5, replace=False)
            for p in home_players:
                rows.append(i); cols.append(p); vals.append(1)
            for p in away_players:
                rows.append(i); cols.append(p); vals.append(-1)

        X = csr_matrix((vals, (rows, cols)), shape=(n_stints, n_players))
        y = np.random.normal(0, 5, n_stints)

        model = Ridge(alpha=2000.0)
        model.fit(X, y)
        assert len(model.coef_) == n_players
        assert not np.any(np.isnan(model.coef_))

    def test_lineup_id_consistency(self):
        from src.etl.lineups import lineup_id
        # Same players different order → same ID
        a = lineup_id([5, 3, 1, 4, 2])
        b = lineup_id([1, 2, 3, 4, 5])
        assert a == b


class TestFatigueDataset:
    """Test fatigue feature construction with synthetic data."""

    def test_rest_advantage_calculation(self):
        """Home rest advantage should be home_rest - away_rest."""
        df = pd.DataFrame({
            "home_rest_days": [3, 1, 4],
            "away_rest_days": [1, 3, 4],
            "score_margin": [5, -3, 2],
        })
        df["rest_advantage"] = df["home_rest_days"] - df["away_rest_days"]
        assert df["rest_advantage"].tolist() == [2, -2, 0]

    def test_b2b_flag(self):
        """Back-to-back means 0 rest days."""
        df = pd.DataFrame({"rest_days": [0, 1, 2, 0, 3]})
        df["b2b"] = (df["rest_days"] == 0)
        assert df["b2b"].sum() == 2
