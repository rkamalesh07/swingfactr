"""Fatigue and travel effect model — OLS regression across multiple seasons."""

import logging
import pickle
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

from src.config import TRAINING_SEASONS
from src.etl.db import get_conn

logger = logging.getLogger(__name__)
MODEL_DIR = Path(__file__).parent.parent.parent / "models_saved"
MODEL_DIR.mkdir(exist_ok=True)
MODEL_PATH = MODEL_DIR / "fatigue_ols.pkl"


def build_fatigue_dataset(seasons: list) -> pd.DataFrame:
    dfs = []
    for season in seasons:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT
                        g.game_id, g.season_id,
                        g.home_score - g.away_score AS score_margin,
                        g.home_win::int AS home_win,
                        COALESCE(g.home_rest_days, 3) AS home_rest_days,
                        COALESCE(g.away_rest_days, 3) AS away_rest_days,
                        COALESCE(g.home_b2b, FALSE)::int AS home_b2b,
                        COALESCE(g.away_b2b, FALSE)::int AS away_b2b,
                        COALESCE(g.home_3in4, FALSE)::int AS home_3in4,
                        COALESCE(g.away_3in4, FALSE)::int AS away_3in4,
                        COALESCE(g.travel_miles, 0) AS travel_miles,
                        COALESCE(g.tz_change, 0) AS tz_change,
                        COALESCE(g.away_road_trip_game, 1) AS away_road_trip_game,
                        COALESCE(ht.altitude_ft, 0) AS home_altitude
                    FROM games g
                    JOIN teams ht ON ht.team_id = g.home_team_id
                    WHERE g.season_id = %s
                      AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
                """, (season,))
                cols = [d[0] for d in cur.description]
                rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        if rows:
            dfs.append(pd.DataFrame(rows))

    if not dfs:
        return pd.DataFrame()

    df = pd.concat(dfs, ignore_index=True)
    df["rest_advantage"] = df["home_rest_days"] - df["away_rest_days"]
    df["fatigue_asymmetry"] = df["away_b2b"] - df["home_b2b"]
    df["high_altitude"] = (df["home_altitude"] >= 3000).astype(int)
    df["long_trip"] = (df["travel_miles"] >= 1500).astype(int)
    df["travel_miles_100"] = df["travel_miles"] / 100
    return df


def train_fatigue_model(seasons: list = TRAINING_SEASONS) -> dict:
    df = build_fatigue_dataset(seasons)
    if df.empty:
        logger.warning("No fatigue data — skipping")
        return {"summary": "no data — run ETL first"}

    logger.info(f"Fatigue model: {len(df)} games from {len(seasons)} seasons")

    formula = (
        "score_margin ~ rest_advantage + away_b2b + home_b2b "
        "+ travel_miles_100 + tz_change + high_altitude "
        "+ away_road_trip_game + long_trip + fatigue_asymmetry"
    )

    model = smf.ols(formula, data=df).fit()
    logger.info(f"Fatigue OLS R²={model.rsquared:.3f}, n={len(df)}")

    results = {
        "r_squared": round(model.rsquared, 4),
        "n_games": len(df),
        "coefficients": []
    }

    labels = {
        "rest_advantage": "Rest advantage (home - away days)",
        "away_b2b": "Away team back-to-back",
        "home_b2b": "Home team back-to-back",
        "travel_miles_100": "Travel (per 100 miles)",
        "tz_change": "Timezone change (hours)",
        "high_altitude": "High altitude venue (DEN/UTA)",
        "away_road_trip_game": "Away road trip game #",
        "long_trip": "Long trip (1500+ miles)",
        "fatigue_asymmetry": "Fatigue asymmetry (away-home b2b diff)",
        "Intercept": "Intercept",
    }

    for var in model.params.index:
        coef = model.params[var]
        pval = model.pvalues[var]
        ci_low, ci_high = model.conf_int().loc[var]
        results["coefficients"].append({
            "variable": var,
            "label": labels.get(var, var),
            "coefficient": round(float(coef), 3),
            "p_value": round(float(pval), 4),
            "ci_low": round(float(ci_low), 3),
            "ci_high": round(float(ci_high), 3),
            "significant": pval < 0.05,
        })

    with open(MODEL_PATH, "wb") as f:
        pickle.dump({"results": results}, f)  # don't pickle model object — statsmodels can't reload across envs

    logger.info(f"Fatigue model saved to {MODEL_PATH}")
    return results


def get_fatigue_effects(season: str = None) -> dict:
    """
    Load saved fatigue OLS model and return coefficients + metadata.
    Returns {} if model hasn't been trained yet.
    """
    if not MODEL_PATH.exists():
        return {}

    with open(MODEL_PATH, "rb") as f:
        payload = pickle.load(f)

    saved_results = payload.get("results", {})
    coefficients = saved_results.get("coefficients", [])

    wanted = {
        "rest_advantage", "away_b2b", "home_b2b", "travel_miles_100",
        "tz_change", "high_altitude", "long_trip", "fatigue_asymmetry"
    }

    result = {
        "r_squared": saved_results.get("r_squared"),
        "n_games": saved_results.get("n_games"),
    }

    for c in coefficients:
        if c["variable"] in wanted:
            result[c["variable"]] = {
                "coefficient": c["coefficient"],
                "p_value": c["p_value"],
                "ci_low": c["ci_low"],
                "ci_high": c["ci_high"],
            }

    return result
