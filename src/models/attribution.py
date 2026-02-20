"""
src/models/attribution.py
Win Probability Attribution + What-If Simulation

Answers:
  1. "What changed the game?" — plays with highest WP delta
  2. "What if we had used lineup A instead of lineup B?"

Methodology:
  - WP delta = |win_prob[t+1] - win_prob[t]|
  - Lineup attribution: for each stint, credit/debit the WP change to that lineup
  - What-if: replace stint's WP trajectory with lineup's historical avg net_rating
    and estimate resulting WP shift via linear approximation
"""

import logging
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

logger = logging.getLogger(__name__)
MODELS_DIR = Path("models_store")


# ─── Key plays ────────────────────────────────────────────────────────────────

def find_key_plays(game_win_prob_df: pd.DataFrame, top_n: int = 10) -> pd.DataFrame:
    """
    Given a win probability series for one game, return the top-N plays
    with the largest absolute WP swing.
    
    Input columns: seconds_elapsed, home_win_prob, description, event_type
    """
    df = game_win_prob_df.copy().sort_values("seconds_elapsed")
    df["wp_delta"] = df["home_win_prob"].diff().abs()
    return (
        df.nlargest(top_n, "wp_delta")
        [["seconds_elapsed", "home_win_prob", "wp_delta", "description", "event_type"]]
        .reset_index(drop=True)
    )


# ─── Lineup WP attribution ────────────────────────────────────────────────────

def attribute_wp_to_lineups(
    stints_df: pd.DataFrame,
    win_prob_series: pd.DataFrame,
    team_id: int,
) -> pd.DataFrame:
    """
    For each stint of a given team, compute:
      - WP at start of stint
      - WP at end of stint
      - Net WP change attributed to this lineup
    
    stints_df: subset of stints table for one game + team
    win_prob_series: play-by-play WP from predict_game_series()
    team_id: which team to attribute (home or away)
    """
    wp = win_prob_series.sort_values("seconds_elapsed")
    stints = stints_df[stints_df["team_id"] == team_id].copy()

    attributed = []
    for _, stint in stints.iterrows():
        start_wp_row = wp[wp["seconds_elapsed"] <= stint["start_seconds"]].tail(1)
        end_wp_row = wp[wp["seconds_elapsed"] <= stint["end_seconds"]].tail(1)

        start_wp = float(start_wp_row["home_win_prob"].iloc[0]) if not start_wp_row.empty else 0.5
        end_wp = float(end_wp_row["home_win_prob"].iloc[0]) if not end_wp_row.empty else 0.5

        # For home team: positive delta is good. For away: flip sign.
        delta = end_wp - start_wp
        if team_id != stints_df.get("home_team_id", pd.Series([team_id])).iloc[0]:
            delta = -delta

        attributed.append({
            "lineup_id": stint["lineup_id"],
            "start_seconds": stint["start_seconds"],
            "end_seconds": stint["end_seconds"],
            "duration_seconds": stint["duration_seconds"],
            "wp_start": round(start_wp, 4),
            "wp_end": round(end_wp, 4),
            "wp_delta": round(delta, 4),
            "wp_delta_abs": round(abs(delta), 4),
        })

    return pd.DataFrame(attributed).sort_values("wp_delta_abs", ascending=False)


# ─── What-if simulation ───────────────────────────────────────────────────────

def what_if_lineup_swap(
    stint_row: dict,
    replacement_lineup_id: str,
    lineup_rankings: pd.DataFrame,
    current_win_prob: float,
) -> dict:
    """
    Estimate win probability shift if `replacement_lineup_id` had been used
    instead of the actual lineup for this stint.

    Method:
      - Get net_rating_adj of actual lineup and replacement lineup
      - ΔNetRating = replacement.nrtg - actual.nrtg
      - Linear approximation: each ~3 net rating points ≈ 0.01 WP shift per minute
        (calibrated empirically from logistic model coefficients)
      
    ASSUMPTION: This is a linear approximation. True WP impact depends on
    game state, opponent, and time remaining — factors not captured here.
    """
    WP_PER_NRTG_PER_MIN = 0.003  # Rough calibration constant

    actual_lineup_id = stint_row.get("lineup_id", "")
    duration_min = stint_row.get("duration_seconds", 0) / 60

    actual_nrtg = _get_nrtg(lineup_rankings, actual_lineup_id)
    replacement_nrtg = _get_nrtg(lineup_rankings, replacement_lineup_id)

    if actual_nrtg is None or replacement_nrtg is None:
        return {
            "status": "insufficient_data",
            "message": "One or both lineups have no historical data.",
        }

    delta_nrtg = replacement_nrtg - actual_nrtg
    estimated_wp_shift = delta_nrtg * duration_min * WP_PER_NRTG_PER_MIN
    new_wp = max(0.01, min(0.99, current_win_prob + estimated_wp_shift))

    return {
        "actual_lineup": actual_lineup_id,
        "replacement_lineup": replacement_lineup_id,
        "actual_nrtg_adj": round(actual_nrtg, 2),
        "replacement_nrtg_adj": round(replacement_nrtg, 2),
        "delta_nrtg": round(delta_nrtg, 2),
        "stint_duration_min": round(duration_min, 1),
        "estimated_wp_shift": round(estimated_wp_shift, 4),
        "current_win_prob": round(current_win_prob, 4),
        "estimated_new_win_prob": round(new_wp, 4),
        "confidence": "low — linear approximation only",
    }


def _get_nrtg(rankings_df: pd.DataFrame, lineup_id: str) -> float | None:
    row = rankings_df[rankings_df["lineup_id"] == lineup_id]
    if row.empty:
        return None
    return float(row.iloc[0].get("net_rating_adj", row.iloc[0].get("net_rating", 0)))
