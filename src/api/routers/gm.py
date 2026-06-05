"""
SwingFactr GM Mode — FastAPI Router
src/api/routers/gm.py

Add to main.py:
    from src.api.routers.gm import router as gm_router
    app.include_router(gm_router)
"""

import uuid
import math
import random
import json
from datetime import datetime, date
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from src.etl.db import get_conn

router = APIRouter(prefix="/gm", tags=["gm"])

# ─── Constants ────────────────────────────────────────────────────────────────

SALARY_CAP       = 140_000_000
LUXURY_TAX       = 170_000_000
MID_LEVEL        = 12_400_000
VET_MIN          = 1_200_000
PLAYOFFS_START   = "2026-04-18"

NBA_TEAMS = [
    "ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GS",
    "HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NO","NY",
    "OKC","ORL","PHI","PHX","POR","SA","SAC","TOR","UTAH","WSH"
]

TEAM_FULL_NAMES = {
    "ATL":"Atlanta Hawks","BOS":"Boston Celtics","BKN":"Brooklyn Nets",
    "CHA":"Charlotte Hornets","CHI":"Chicago Bulls","CLE":"Cleveland Cavaliers",
    "DAL":"Dallas Mavericks","DEN":"Denver Nuggets","DET":"Detroit Pistons",
    "GS":"Golden State Warriors","HOU":"Houston Rockets","IND":"Indiana Pacers",
    "LAC":"LA Clippers","LAL":"LA Lakers","MEM":"Memphis Grizzlies",
    "MIA":"Miami Heat","MIL":"Milwaukee Bucks","MIN":"Minnesota Timberwolves",
    "NO":"New Orleans Pelicans","NY":"New York Knicks","OKC":"Oklahoma City Thunder",
    "ORL":"Orlando Magic","PHI":"Philadelphia 76ers","PHX":"Phoenix Suns",
    "POR":"Portland Trail Blazers","SA":"San Antonio Spurs","SAC":"Sacramento Kings",
    "TOR":"Toronto Raptors","UTAH":"Utah Jazz","WSH":"Washington Wizards"
}

CONFERENCE = {
    "ATL":"East","BOS":"East","BKN":"East","CHA":"East","CHI":"East",
    "CLE":"East","DET":"East","IND":"East","MIA":"East","MIL":"East",
    "NY":"East","ORL":"East","PHI":"East","TOR":"East","WSH":"East",
    "DAL":"West","DEN":"West","GS":"West","HOU":"West","LAC":"West",
    "LAL":"West","MEM":"West","MIN":"West","NO":"West","OKC":"West",
    "PHX":"West","POR":"West","SA":"West","SAC":"West","UTAH":"West"
}


# ─── Rating Engine ──────────────────────────────────────────────────────────
"""
SwingFactr GM Rating Engine
============================

Three-number system, no external dependencies:

  current_ability  — how good right now (0-99), shown in UI
  trade_value      — market worth (0-99), drives AI decisions
  potential        — hidden ceiling (0-99), revealed through simulation

All ratings derived from percentile rank within the actual player pool,
so the distribution is self-correcting regardless of era or inflation.
"""

import math
import random
import uuid


# ─── Core Math ────────────────────────────────────────────────────────────────

# ─── Rating Engine ──────────────────────────────────────────────────────────
"""
SwingFactr GM Rating Engine
============================

Three-number system, no external dependencies:

  current_ability  — how good right now (0-99), shown in UI
  trade_value      — market worth (0-99), drives AI decisions
  potential        — hidden ceiling (0-99), revealed through simulation

All ratings derived from percentile rank within the actual player pool,
so the distribution is self-correcting regardless of era or inflation.
"""

import math
import random
import uuid


# ─── Core Math ────────────────────────────────────────────────────────────────

def safe_div(a, b, default=0.0):
    try:
        a, b = float(a), float(b)
    except (TypeError, ValueError):
        return default
    return a / b if b > 0 else default

def clamp(v, lo=0.0, hi=99.0):
    return max(lo, min(hi, float(v)))

def percentile_rank(value: float, distribution: list[float]) -> float:
    """Return percentile of value within distribution (0-100)."""
    if not distribution:
        return 50.0
    below = sum(1 for x in distribution if x < value)
    return (below / len(distribution)) * 100.0

def percentile_to_rating(pct: float, lo: float = 25.0, hi: float = 95.0) -> float:
    """Convert 0-100 percentile to a rating in [lo, hi]."""
    return clamp(lo + (pct / 100.0) * (hi - lo), lo, hi)


# ─── Stat Derivation (per-36, percentile-independent) ─────────────────────────

def extract_raw_stats(row: dict) -> dict:
    """Pull and type-cast all raw stats from a player row."""
    def f(v, default=0.0):
        try:
            return float(v) if v is not None else default
        except (TypeError, ValueError):
            return default
    def i(v, default=0):
        try:
            return int(float(v)) if v is not None else default
        except (TypeError, ValueError):
            return default

    mpg  = max(f(row.get("mpg"), 1.0), 0.5)
    ppg  = f(row.get("ppg"))
    rpg  = f(row.get("rpg"))
    apg  = f(row.get("apg"))
    spg  = f(row.get("spg"))
    bpg  = f(row.get("bpg"))
    tov  = f(row.get("tov"))
    fg3m = f(row.get("fg3m"))
    efg  = f(row.get("efg_pct"), 50.0)
    gp   = f(row.get("gp"), 1.0)
    age  = i(row.get("age"), 26)
    pos  = str(row.get("position") or "G").upper()

    pts36 = safe_div(ppg, mpg) * 36
    ast36 = safe_div(apg, mpg) * 36
    reb36 = safe_div(rpg, mpg) * 36
    stk36 = safe_div(spg + bpg, mpg) * 36   # stocks (stl+blk) per 36
    tov36 = safe_div(tov, mpg) * 36
    fg3_36 = safe_div(fg3m, mpg) * 36
    pm_net = ast36 - tov36 * 0.5             # playmaking net

    # Availability: fraction of full season at full minutes
    availability = (gp / 82.0) * (mpg / 36.0)

    return {
        "mpg": mpg, "ppg": ppg, "rpg": rpg, "apg": apg,
        "spg": spg, "bpg": bpg, "tov": tov, "fg3m": fg3m,
        "efg": efg, "gp": gp, "age": age, "pos": pos,
        "pts36": pts36, "ast36": ast36, "reb36": reb36,
        "stk36": stk36, "tov36": tov36, "fg3_36": fg3_36,
        "pm_net": pm_net, "availability": availability,
    }


# ─── Percentile Distributions (computed once over full player pool) ───────────

def build_distributions(all_raw: list[dict]) -> dict:
    """
    Compute per-stat distributions across all players.
    Called once at league init. Returns dict of sorted lists.
    """
    keys = ["pts36", "ast36", "reb36", "stk36", "pm_net",
            "fg3_36", "efg", "availability", "mpg"]
    return {k: sorted(r[k] for r in all_raw) for k in keys}


# ─── Component Scores (0-100 each) ────────────────────────────────────────────

def offensive_score(raw: dict, dist: dict) -> float:
    """
    Offensive impact score.
    Scoring + Efficiency + Playmaking + Spacing
    """
    scoring_pct    = percentile_rank(raw["pts36"],  dist["pts36"])
    efficiency_pct = percentile_rank(raw["efg"],    dist["efg"])
    playmaking_pct = percentile_rank(raw["pm_net"], dist["pm_net"])
    spacing_pct    = percentile_rank(raw["fg3_36"], dist["fg3_36"])

    # Convert to ratings: scoring and efficiency get wider range
    scoring    = percentile_to_rating(scoring_pct,    lo=20, hi=98)
    efficiency = percentile_to_rating(efficiency_pct, lo=25, hi=90)
    playmaking = percentile_to_rating(playmaking_pct, lo=15, hi=92)
    spacing    = percentile_to_rating(spacing_pct,    lo=10, hi=85)

    return clamp(
        0.38 * scoring +
        0.30 * efficiency +
        0.22 * playmaking +
        0.10 * spacing,
        lo=10, hi=99
    )

def defensive_score(raw: dict, dist: dict) -> float:
    """
    Defensive impact score.
    Stocks + Rebounding + Positional versatility proxy
    """
    stocks_pct = percentile_rank(raw["stk36"],   dist["stk36"])
    reb_pct    = percentile_rank(raw["reb36"],    dist["reb36"])

    stocks = percentile_to_rating(stocks_pct, lo=15, hi=95)
    reb    = percentile_to_rating(reb_pct,    lo=15, hi=90)

    return clamp(
        0.55 * stocks +
        0.45 * reb,
        lo=10, hi=99
    )

def availability_score(raw: dict, dist: dict) -> float:
    """Reliability: how much of a full season a player actually plays."""
    avail_pct = percentile_rank(raw["availability"], dist["availability"])
    return percentile_to_rating(avail_pct, lo=20, hi=90)


# ─── Current Ability ──────────────────────────────────────────────────────────

def compute_current_ability(raw: dict, dist: dict) -> float:
    """
    Primary visible rating.
    Offense(55%) + Defense(35%) + Availability(10%)
    Then apply MPG gate so bench players can't inflate.
    """
    off = offensive_score(raw, dist)
    dfn = defensive_score(raw, dist)
    avl = availability_score(raw, dist)

    base = clamp(
        0.55 * off +
        0.35 * dfn +
        0.10 * avl,
        lo=15, hi=99
    )

    # MPG gate: low-minute players haven't proven sustained production
    mpg = raw["mpg"]
    # MPG gate -- but give relief for proven scorers
    ppg_relief = 8 if ppg >= 16 else (4 if ppg >= 12 else 0)
    if   mpg < 8:  base = min(base, 44 + ppg_relief)
    elif mpg < 13: base = min(base, 54 + ppg_relief)
    elif mpg < 18: base = min(base, 64 + ppg_relief)
    elif mpg < 22: base = min(base, 76 + ppg_relief)
    elif mpg < 26: base = min(base, 85 + ppg_relief)

    # PPG floor: high scorers get a floor regardless of other metrics
    ppg = raw["ppg"]
    if   ppg >= 30: base = max(base, 88)
    elif ppg >= 25: base = max(base, 82)
    elif ppg >= 20: base = max(base, 74)
    elif ppg >= 16: base = max(base, 64)
    elif ppg >= 12: base = max(base, 52)

    # Non-scorer cap: role bigs inflated by rebounding/defense alone
    if   ppg < 8:  base = min(base, 62)
    elif ppg < 12: base = min(base, 71)

    return round(clamp(base))


# ─── Future Ability (age curve projection) ────────────────────────────────────

AGE_TRAJECTORY = {
    # age: (expected_delta, variance)
    19: (+6.0, 5.0),
    20: (+5.0, 5.0),
    21: (+4.5, 4.5),
    22: (+3.5, 4.0),
    23: (+2.5, 3.5),
    24: (+1.5, 3.0),
    25: (+0.8, 2.5),
    26: (+0.2, 2.0),
    27: (-0.3, 2.0),
    28: (-0.8, 2.0),
    29: (-1.5, 2.5),
    30: (-2.5, 3.0),
    31: (-3.5, 3.0),
    32: (-5.0, 3.5),
    33: (-6.5, 4.0),
    34: (-8.0, 4.0),
}

def compute_future_ability(current: float, age: int) -> float:
    """Expected ability at peak (ages 26-28 target window)."""
    if age >= 35:
        return max(current - 15, 25)

    traj = AGE_TRAJECTORY.get(age, (-2.0, 3.0))
    years_to_peak = max(0, 27 - age)   # target peak age = 27
    expected_delta = traj[0] * min(years_to_peak, 4)

    future = current + expected_delta
    # Future ceiling: low-current players can't project to stars
    # A 45 OVR player can realistically reach ~65 max, not 90
    future_ceiling = current + (99 - current) * 0.35 + (5 if age <= 22 else 0)
    return round(clamp(future, lo=max(15, current - 20), hi=min(99, future_ceiling)))


# ─── Potential + Outcome Tree ─────────────────────────────────────────────────

def build_outcome_tree(current: float, age: int) -> dict:
    """
    Hidden outcome tree. Never shown to user directly.
    Revealed through simulation paths.

    Returns:
        ceiling: max possible career rating
        floor: minimum realistic outcome
        bust_risk: probability (0-1) of significant decline
        trajectory: "rising" | "peak" | "declining"
        outcomes: probability distribution of career paths
    """
    # Base ceiling = current + age-dependent upside
    if age <= 21:
        upside_range = (8, 25)
        bust_risk = random.uniform(0.10, 0.35)
        trajectory = "rising"
    elif age <= 23:
        upside_range = (5, 18)
        bust_risk = random.uniform(0.05, 0.20)
        trajectory = "rising"
    elif age <= 25:
        upside_range = (3, 12)
        bust_risk = random.uniform(0.03, 0.12)
        trajectory = "rising"
    elif age <= 28:
        upside_range = (0, 5)
        bust_risk = random.uniform(0.02, 0.08)
        trajectory = "peak"
    elif age <= 31:
        upside_range = (0, 2)
        bust_risk = random.uniform(0.05, 0.15)
        trajectory = "declining"
    else:
        upside_range = (0, 0)
        bust_risk = random.uniform(0.15, 0.40)
        trajectory = "declining"

    upside = random.uniform(*upside_range)
    ceiling = round(clamp(current + upside, lo=current, hi=99))
    floor   = round(clamp(current - bust_risk * 20, lo=25, hi=current))

    # Outcome probability distribution (career path)
    if current >= 82:
        outcomes = {"superstar": 0.70, "all_star": 0.22, "starter": 0.06, "role_player": 0.02, "bust": 0.00}
    elif current >= 72:
        outcomes = {"superstar": 0.15, "all_star": 0.45, "starter": 0.30, "role_player": 0.08, "bust": 0.02}
    elif current >= 60:
        outcomes = {"superstar": 0.04, "all_star": 0.18, "starter": 0.42, "role_player": 0.28, "bust": 0.08}
    elif current >= 48:
        outcomes = {"superstar": 0.01, "all_star": 0.05, "starter": 0.25, "role_player": 0.50, "bust": 0.19}
    else:
        outcomes = {"superstar": 0.00, "all_star": 0.01, "starter": 0.10, "role_player": 0.45, "bust": 0.44}

    # Young players get upside boost
    if age <= 22 and current >= 55:
        outcomes["superstar"] = min(0.35, outcomes["superstar"] * 2.5)
        outcomes["all_star"]  = min(0.45, outcomes["all_star"]  * 1.5)
        outcomes["bust"]      = min(0.30, outcomes["bust"] * 1.8)

    return {
        "ceiling":    ceiling,
        "floor":      floor,
        "bust_risk":  round(bust_risk, 3),
        "trajectory": trajectory,
        "outcomes":   outcomes,
        "revealed":   False,
    }


# ─── Contract Value ───────────────────────────────────────────────────────────

# Market rate lookup: what a player of this ability "should" earn
# Based on 2025-26 CBA max scales and market data
def market_salary(current_ability: float, age: int) -> int:
    """Expected annual salary based on ability and age."""
    # Base salary as fraction of cap
    if current_ability >= 88:   base_frac = 0.35     # supermax
    elif current_ability >= 80: base_frac = 0.28     # max
    elif current_ability >= 72: base_frac = 0.20     # near-max
    elif current_ability >= 64: base_frac = 0.13     # mid-tier
    elif current_ability >= 55: base_frac = 0.08     # starter
    elif current_ability >= 45: base_frac = 0.04     # rotation
    else:                        base_frac = 0.015   # vet min range

    CAP = 140_000_000
    base = base_frac * CAP

    # Age adjustment on market value
    if age <= 22:   age_mult = 0.80   # rookie/young: cheaper
    elif age <= 25: age_mult = 0.95
    elif age <= 28: age_mult = 1.10   # prime: premium
    elif age <= 30: age_mult = 1.00
    elif age <= 32: age_mult = 0.85
    else:           age_mult = 0.65

    result = int(base * age_mult)
    VET_MIN = 1_200_000
    MAX_SAL = int(CAP * 0.35)
    return max(VET_MIN, min(MAX_SAL, result))

def contract_years_for(current_ability: float, age: int) -> int:
    """Realistic contract length."""
    if current_ability >= 80:
        return random.choice([4, 4, 5]) if age <= 30 else random.choice([2, 3])
    elif current_ability >= 65:
        return random.choice([3, 3, 4]) if age <= 28 else random.choice([2, 3])
    elif current_ability >= 50:
        return random.choice([2, 2, 3])
    else:
        return random.choice([1, 2])

def contract_value_score(current_ability: float, salary: int, age: int) -> float:
    """
    How good is this contract? 0-100.
    100 = massive underpay (rookie deal superstar)
    50  = fair market value
    0   = terrible overpay
    """
    expected = market_salary(current_ability, age)
    ratio = expected / max(salary, 1)
    # ratio > 1 means player earns less than market (good deal)
    # ratio < 1 means player earns more than market (bad deal)
    score = 50 + (ratio - 1.0) * 40
    return round(clamp(score, lo=0, hi=99))


# ─── Position Scarcity ────────────────────────────────────────────────────────

POSITION_SCARCITY = {
    # How scarce/valuable elite players at this position are
    "primary_ball_handler": 1.15,
    "floor_general": 1.10,
    "shot_creator": 1.12,
    "rim_protector": 1.08,
    "3-and-D": 1.06,
    "wing_scorer": 1.05,
    "scoring_wing": 1.04,
    "stretch_four": 1.03,
    "playmaking_big": 1.03,
    "perimeter_defender": 1.02,
    "spot-up_shooter": 1.01,
    "defensive_big": 1.00,
    "traditional_big": 0.98,
    "energy_big": 0.96,
    "secondary_playmaker": 0.98,
    "role_player": 0.95,
}


# ─── Trade Value ──────────────────────────────────────────────────────────────

def compute_trade_value(
    current: float,
    future: float,
    salary: int,
    age: int,
    archetype: str,
    years_left: int,
) -> float:
    """
    Market trade value (0-99). What AI GMs will evaluate.

    Components:
      Current Impact   40% — how much does player help win today
      Future Impact    25% — expected value over contract window
      Contract Value   20% — production per dollar
      Age Curve        10% — years of prime remaining
      Position Scarcity 5% — how replaceable is this role
    """
    # Contract value score
    cv = contract_value_score(current, salary, age)

    # Age curve: prime window value
    years_of_prime = max(0, min(years_left, 30 - age))  # years left in prime (pre-30)
    age_score = clamp(years_of_prime / 6.0 * 80 + 20, lo=10, hi=90)

    # Position scarcity multiplier
    arch_key = archetype.lower().replace(" ", "_").replace("-", "-")
    scarcity_mult = POSITION_SCARCITY.get(arch_key, 1.00)

    raw_value = (
        0.40 * current +
        0.25 * future +
        0.20 * cv +
        0.10 * age_score +
        0.05 * 60   # placeholder for scarcity (applied as multiplier below)
    )

    trade_val = raw_value * scarcity_mult
    return round(clamp(trade_val, lo=5, hi=99))


# ─── Archetype Detection ──────────────────────────────────────────────────────

def detect_archetype(raw: dict) -> str:
    ppg  = raw["ppg"]
    apg  = raw["apg"]
    rpg  = raw["rpg"]
    spg  = raw["spg"]
    bpg  = raw["bpg"]
    fg3m = raw["fg3m"]
    mpg  = raw["mpg"]
    pos  = raw["pos"]

    ast_rate = safe_div(apg, mpg)
    is_big   = pos in ("C", "F", "PF", "C-F", "F-C", "PF-C", "C-PF")

    if (ast_rate > 0.32 and ppg >= 14) or (raw["apg"] >= 6.0 and ppg >= 25): return "Primary Ball Handler"
    if ast_rate > 0.30 and ppg >= 12:           return "Floor General"
    if fg3m >= 2.5 and spg >= 1.2:             return "3-and-D"
    if rpg > 7.5 and bpg > 1.2:               return "Rim Protector"
    if rpg > 8.0 and bpg > 1.0 and ppg < 12:  return "Defensive Big"
    if is_big and fg3m >= 1.5 and rpg > 5:    return "Stretch Four"
    if is_big and ast_rate > 0.20 and rpg > 5: return "Playmaking Big"
    if is_big and rpg > 6.5:                   return "Traditional Big"
    if ppg >= 20 and fg3m >= 2.0:             return "Shot Creator"
    if ppg >= 18 and fg3m >= 1.5:             return "Wing Scorer"
    if fg3m >= 2.5 and ppg < 15:              return "Spot-Up Shooter"
    if spg >= 1.5 and ppg < 14:               return "Perimeter Defender"
    if ppg >= 15:                              return "Scoring Wing"
    if rpg > 5 and ppg < 10:                  return "Energy Big"
    if ast_rate > 0.22:                        return "Secondary Playmaker"
    return "Role Player"


# ─── Full Player Rating (called per-player with league distributions) ──────────

def rate_player(row: dict, dist: dict) -> dict:
    """
    Main entry point. Given a player row + league distributions,
    return the full rating package.
    """
    raw = extract_raw_stats(row)
    age = raw["age"]

    # Component scores
    off = offensive_score(raw, dist)
    dfn = defensive_score(raw, dist)
    avl = availability_score(raw, dist)

    # Current ability
    current = compute_current_ability(raw, dist)

    # Future ability
    future = compute_future_ability(current, age)

    # Outcome tree (hidden)
    outcome_tree = build_outcome_tree(current, age)

    # Archetype
    archetype = detect_archetype(raw)

    # Salary estimate
    salary = market_salary(current, age)
    years  = contract_years_for(current, age)

    # Contract value
    cv = contract_value_score(current, salary, age)

    # Trade value
    trade_val = compute_trade_value(
        current, future, salary, age, archetype, years
    )

    # Individual dimension ratings for UI display
    return {
        # Core three numbers
        "overall":      current,                     # displayed as OVR
        "future":       future,                      # shown as potential arrow
        "trade_value":  trade_val,                   # shown in trade machine

        # Dimension breakdowns (for expanded player card)
        "scoring":      round(clamp(off * 0.6 + percentile_to_rating(
                            percentile_rank(raw["pts36"], dist["pts36"]), 20, 98) * 0.4)),
        "efficiency":   round(clamp(percentile_to_rating(
                            percentile_rank(raw["efg"], dist["efg"]), 25, 90))),
        "playmaking":   round(clamp(percentile_to_rating(
                            percentile_rank(raw["pm_net"], dist["pm_net"]), 15, 92))),
        "rebounding":   round(clamp(percentile_to_rating(
                            percentile_rank(raw["reb36"], dist["reb36"]), 15, 90))),
        "defense":      round(clamp(dfn)),
        "composure":    round(clamp(avl)),

        # Contract
        "salary":       salary,
        "years_left":   years,
        "contract_value": round(cv),

        # Archetype
        "archetype":    archetype,

        # Hidden (stored in save, not sent to frontend unless revealed)
        "_outcome_tree": outcome_tree,
    }


# ─── League Init (called once, computes distributions then rates everyone) ─────

def build_player_ratings(players: list[dict]) -> list[dict]:
    """
    Two-pass system:
    Pass 1: extract raw stats for all players
    Pass 2: compute percentile distributions, then rate each player
    """
    # Pass 1: raw stats
    all_raw = []
    errors_p1 = []
    for p in players:
        try:
            raw = extract_raw_stats(p)
            raw["_row"] = p
            all_raw.append(raw)
        except Exception as e:
            import traceback
            errors_p1.append(f"{p.get('full_name','?')}: {e} | {traceback.format_exc()[-200:]}")
            continue
    if errors_p1:
        # Return first error in exception so it shows in API response
        raise RuntimeError(f"Pass1 failed on {len(errors_p1)} players. First: {errors_p1[0][:500]}")

    if not all_raw:
        return []

    # Build distributions across full player pool
    dist = build_distributions(all_raw)

    # Pass 2: rate each player using population distributions
    rated = []
    for raw in all_raw:
        p = raw["_row"]
        try:
            ratings = rate_player(p, dist)
            rated.append({
                "id":       str(uuid.uuid4())[:8],
                "name":     p.get("full_name") or p.get("player_name") or "Unknown",
                "position": p.get("position") or "G",
                "age":      int(p.get("age") or 26),
                "team":     p.get("team_abbr") or "FA",
                "ppg":      round(float(p.get("ppg") or 0), 1),
                "rpg":      round(float(p.get("rpg") or 0), 1),
                "apg":      round(float(p.get("apg") or 0), 1),
                "spg":      round(float(p.get("spg") or 0), 1),
                "bpg":      round(float(p.get("bpg") or 0), 1),
                "fg3m":     round(float(p.get("fg3m") or 0), 1),
                "mpg":      round(float(p.get("mpg") or 0), 1),
                "gp":       int(p.get("gp") or 0),
                **ratings,
            })
        except Exception as e:
            import traceback
            print(f"Pass2 error for {p.get('full_name','?')}: {e}")
            traceback.print_exc()
            continue

    print(f"build_player_ratings: {len(all_raw)} raw, {len(rated)} rated")
    return rated


# ─── Salary + Contract helpers (wrappers around engine functions) ─────────────

def estimate_salary(overall: int, age: int) -> int:
    return market_salary(float(overall), age)

def contract_years(overall: int, age: int) -> int:
    return contract_years_for(float(overall), age)

# ─── Abbr Normalisation ───────────────────────────────────────────────────────

ABBR_TO_ESPN = {
    "GSW": "GS", "SAS": "SA", "NOP": "NO", "NYK": "NY",
    "UTA": "UTAH", "WAS": "WSH", "PHO": "PHX",
}



def fetch_all_players(conn) -> list[dict]:
    """
    Fetch players with season stats + most recent team from game logs.
    Falls back to players table for teams with no recent logs (injuries etc).
    """
    cur = conn.cursor()
    cur.execute("""
        WITH season_stats AS (
            SELECT
                gl.player_name,
                COUNT(*)                         AS gp,
                AVG(gl.pts)                      AS ppg,
                AVG(gl.reb)                      AS rpg,
                AVG(gl.ast)                      AS apg,
                AVG(gl.stl)                      AS spg,
                AVG(gl.blk)                      AS bpg,
                AVG(gl.fg3m)                     AS fg3m,
                AVG(gl.tov)                      AS tov,
                AVG(gl.minutes)                  AS mpg,
                AVG(CASE WHEN gl.fga > 0
                    THEN gl.fg_made::float / gl.fga * 100 END) AS fg_pct,
                AVG(CASE WHEN gl.fga > 0
                    THEN (gl.fg_made + 0.5*gl.fg3m)::float / gl.fga * 100 END) AS efg_pct,
                AVG(CASE WHEN gl.fga > 0
                    THEN gl.fg3m::float / (gl.fga * 0.38) * 100 END) AS fg3_pct_est
            FROM player_game_logs gl
            WHERE gl.season_id = '2025-26'
            GROUP BY gl.player_name
            HAVING COUNT(*) >= 5 AND AVG(gl.minutes) >= 5
        ),
        latest_team AS (
            SELECT DISTINCT ON (player_name)
                player_name,
                team_abbr,
                game_date
            FROM player_game_logs
            WHERE season_id = '2025-26'
            ORDER BY player_name, game_date DESC
        )
        SELECT
            s.player_name        AS full_name,
            COALESCE(p.position, 'G') AS position,
            COALESCE(pa.age, 26) AS age,
            COALESCE(lt.team_abbr, p.team_id::text, 'FA') AS team_abbr,
            s.gp, s.ppg, s.rpg, s.apg, s.spg, s.bpg,
            s.fg3m, s.tov, s.mpg, s.fg_pct, s.efg_pct, s.fg3_pct_est
        FROM season_stats s
        LEFT JOIN latest_team lt ON lt.player_name = s.player_name
        LEFT JOIN players p ON p.full_name = s.player_name
        LEFT JOIN player_ages pa ON pa.full_name = s.player_name
        ORDER BY s.ppg DESC
    """)
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    cur.close()

    for row in rows:
        abbr = row.get("team_abbr") or "FA"
        row["team_abbr"] = ABBR_TO_ESPN.get(str(abbr).upper(), str(abbr).upper())

    return rows

def get_save(conn, save_id: str) -> dict:
    cur = conn.cursor()
    cur.execute("SELECT state FROM gm_saves WHERE save_id = %s", (save_id,))
    row = cur.fetchone()
    cur.close()
    if not row:
        raise HTTPException(404, f"Save not found: {save_id}")
    val = row[0]
    return val if isinstance(val, dict) else json.loads(val)

def put_save(conn, save_id: str, state: dict):
    cur = conn.cursor()
    cur.execute("""
        UPDATE gm_saves SET state = %s, updated_at = NOW()
        WHERE save_id = %s
    """, (json.dumps(state), save_id))
    cur.close()

# ─── League Initialisation ────────────────────────────────────────────────────

def build_league(players: list[dict]) -> dict:
    """
    Distribute real players across 30 teams.
    Uses two-pass percentile rating engine so all ratings are
    relative to the actual player pool, not hardcoded ranges.
    """
    # Rate all players in one pass (builds distributions first)
    rated_players = build_player_ratings(players)

    enriched = []
    for p in rated_players:
        enriched.append({
            "id":          p["id"],
            "name":        p["name"],
            "position":    p["position"],
            "age":         p["age"],
            "team":        p["team"],
            "ppg":         p["ppg"],
            "rpg":         p["rpg"],
            "apg":         p["apg"],
            "spg":         p.get("spg", 0.0),
            "bpg":         p.get("bpg", 0.0),
            "fg3m":        p.get("fg3m", 0.0),
            "mpg":         p["mpg"],
            "gp":          p["gp"],
            "overall":     p["overall"],
            "future":      p["future"],
            "trade_value": p["trade_value"],
            "scoring":     p["scoring"],
            "efficiency":  p["efficiency"],
            "playmaking":  p["playmaking"],
            "rebounding":  p["rebounding"],
            "defense":     p["defense"],
            "composure":   p["composure"],
            "archetype":   p["archetype"],
            "contract_value": p["contract_value"],
            "salary":      p["salary"],
            "years_left":  p["years_left"],
        })

    # Build team rosters from real team assignments
    teams = {}
    for abbr in NBA_TEAMS:
        teams[abbr] = {
            "abbr":     abbr,
            "name":     TEAM_FULL_NAMES[abbr],
            "conf":     CONFERENCE[abbr],
            "roster":   [],
            "cap_used": 0,
            "wins":     0,
            "losses":   0,
            "gm_team":  False,
        }

    fa_pool = []
    for p in enriched:
        abbr = p["team"]
        if abbr in teams:
            teams[abbr]["roster"].append(p)
            teams[abbr]["cap_used"] += p["salary"]
        else:
            fa_pool.append(p)

    # Trim rosters > 15 (move extras to FA)
    for abbr, team in teams.items():
        roster = sorted(team["roster"], key=lambda x: -x["overall"])
        if len(roster) > 15:
            fa_pool.extend(roster[15:])
            team["roster"] = roster[:15]
        team["roster"] = roster
        team["cap_used"] = sum(p["salary"] for p in team["roster"])

    return {"teams": teams, "fa_pool": fa_pool, "season": 1, "day": 0, "games_simmed": 0}

# ─── Season Simulation ────────────────────────────────────────────────────────

def team_strength(team: dict) -> float:
    """Simple team strength from avg overall of top 8 players."""
    roster = sorted(team["roster"], key=lambda x: -x["overall"])[:8]
    if not roster:
        return 50.0
    return sum(p["overall"] for p in roster) / len(roster)

def sim_game(home: dict, away: dict) -> tuple[str, str]:
    """Simulate one game. Returns (winner_abbr, loser_abbr)."""
    home_str = team_strength(home) + 3.0  # home court
    away_str = team_strength(away)
    diff = home_str - away_str
    prob = 1 / (1 + math.exp(-diff * 0.12))
    if random.random() < prob:
        return home["abbr"], away["abbr"]
    return away["abbr"], home["abbr"]

def simulate_days(league: dict, n_days: int) -> dict:
    """Simulate n_days of games across all 30 teams."""
    teams = league["teams"]
    team_list = list(teams.values())

    for _ in range(n_days):
        random.shuffle(team_list)
        # ~15 games per day (all 30 teams play)
        played = set()
        for i in range(0, len(team_list) - 1, 2):
            h = team_list[i]
            a = team_list[i + 1]
            if h["abbr"] in played or a["abbr"] in played:
                continue
            winner, loser = sim_game(h, a)
            teams[winner]["wins"]   += 1
            teams[loser]["losses"]  += 1
            played.add(h["abbr"])
            played.add(a["abbr"])

        league["day"] += 1
        league["games_simmed"] += 15

    return league

# ─── Standings Helper ─────────────────────────────────────────────────────────

def standings_sorted(teams: dict) -> dict:
    east, west = [], []
    for t in teams.values():
        entry = {
            "abbr":   t["abbr"],
            "name":   t["name"],
            "wins":   t["wins"],
            "losses": t["losses"],
            "pct":    round(safe_div(t["wins"], t["wins"] + t["losses"]), 3),
            "gm_team": t.get("gm_team", False),
        }
        if t["conf"] == "East":
            east.append(entry)
        else:
            west.append(entry)
    east.sort(key=lambda x: -x["pct"])
    west.sort(key=lambda x: -x["pct"])
    return {"east": east, "west": west}

# ─── DB Schema Init ───────────────────────────────────────────────────────────

@router.post("/init-db")
def init_db():
    """Create GM tables. Run once."""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS gm_saves (
                save_id    TEXT PRIMARY KEY,
                team_abbr  TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                state      JSONB NOT NULL
            );
        """)
        cur.close()
    return {"ok": True, "message": "gm_saves table ready"}

# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/teams")
def list_teams():
    """Return all 30 teams with name + conference for franchise select."""
    return [
        {"abbr": abbr, "name": TEAM_FULL_NAMES[abbr], "conf": CONFERENCE[abbr]}
        for abbr in NBA_TEAMS
    ]

class NewGameBody(BaseModel):
    team_abbr: str

@router.post("/new-game")
def new_game(body: NewGameBody):
    """
    Initialise a new GM save.
    Pulls real player data, derives attributes, distributes across 30 teams.
    Returns save_id (UUID) for all subsequent calls.
    """
    abbr = body.team_abbr.upper()
    if abbr not in NBA_TEAMS:
        raise HTTPException(400, f"Unknown team: {abbr}")

    save_id = str(uuid.uuid4())
    with get_conn() as conn:
        players = fetch_all_players(conn)
        league  = build_league(players)
        league["teams"][abbr]["gm_team"] = True
        league["gm_team"] = abbr
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO gm_saves (save_id, team_abbr, state)
            VALUES (%s, %s, %s)
        """, (save_id, abbr, json.dumps(league)))
        cur.close()

    team = league["teams"][abbr]
    total_players = sum(len(t["roster"]) for t in league["teams"].values())
    fa_count = len(league.get("fa_pool", []))
    return {
        "save_id":   save_id,
        "team":      abbr,
        "team_name": TEAM_FULL_NAMES[abbr],
        "roster_count": len(team["roster"]),
        "cap_used":  team["cap_used"],
        "cap_space": SALARY_CAP - team["cap_used"],
        "message":   f"GM save created for {TEAM_FULL_NAMES[abbr]}",
        "debug_total_players": total_players,
        "debug_fa_count": fa_count,
    }

@router.get("/state/{save_id}")
def get_state(save_id: str):
    """Return top-level league state (day, season, standings summary)."""
    with get_conn() as conn:
        league = get_save(conn, save_id)

    abbr  = league["gm_team"]
    team  = league["teams"][abbr]
    stnd  = standings_sorted(league["teams"])

    # Find your position in standings
    conf  = CONFERENCE[abbr]
    conf_standings = stnd["east"] if conf == "East" else stnd["west"]
    rank  = next((i+1 for i, t in enumerate(conf_standings) if t["abbr"] == abbr), "?")

    return {
        "save_id":     save_id,
        "season":      league["season"],
        "day":         league["day"],
        "gm_team":     abbr,
        "team_name":   TEAM_FULL_NAMES[abbr],
        "wins":        team["wins"],
        "losses":      team["losses"],
        "cap_used":    team["cap_used"],
        "cap_space":   SALARY_CAP - team["cap_used"],
        "luxury_tax":  LUXURY_TAX,
        "conf_rank":   rank,
        "conference":  conf,
        "games_simmed": league.get("games_simmed", 0),
    }

@router.get("/roster/{save_id}")
def get_roster(save_id: str):
    """Return your team's roster with all attributes."""
    with get_conn() as conn:
        league = get_save(conn, save_id)

    abbr   = league["gm_team"]
    team   = league["teams"][abbr]
    roster = sorted(team["roster"], key=lambda x: -x["overall"])

    return {
        "team":      abbr,
        "team_name": TEAM_FULL_NAMES[abbr],
        "cap_used":  team["cap_used"],
        "cap_space": SALARY_CAP - team["cap_used"],
        "salary_cap": SALARY_CAP,
        "luxury_tax": LUXURY_TAX,
        "roster":    roster,
        "count":     len(roster),
    }

@router.get("/standings/{save_id}")
def get_standings(save_id: str):
    """Return East/West standings."""
    with get_conn() as conn:
        league = get_save(conn, save_id)
    return {
        "day":      league["day"],
        "season":   league["season"],
        "gm_team":  league["gm_team"],
        **standings_sorted(league["teams"])
    }

@router.get("/free-agents/{save_id}")
def get_free_agents(save_id: str, limit: int = Query(50)):
    """Return FA pool sorted by overall."""
    with get_conn() as conn:
        league = get_save(conn, save_id)

    fa = sorted(league["fa_pool"], key=lambda x: -x["overall"])[:limit]
    return {"free_agents": fa, "total": len(league["fa_pool"])}

class SimBody(BaseModel):
    days: int = 7

@router.post("/simulate/{save_id}")
def simulate(save_id: str, body: SimBody):
    """Simulate N days of games. Updates standings in save."""
    days = max(1, min(body.days, 30))
    conn = get_conn()
    league = get_save(conn, save_id)
    league = simulate_days(league, days)
    with get_conn() as conn:
        put_save(conn, save_id, league)

    abbr = league["gm_team"]
    team = league["teams"][abbr]
    return {
        "days_simmed": days,
        "total_day":   league["day"],
        "your_record": f"{team['wins']}-{team['losses']}",
        "standings":   standings_sorted(league["teams"]),
    }

class SignBody(BaseModel):
    player_id: str

@router.post("/sign/{save_id}")
def sign_player(save_id: str, body: SignBody):
    """Sign a free agent to your roster."""
    conn = get_conn()
    league = get_save(conn, save_id)

    abbr = league["gm_team"]
    team = league["teams"][abbr]

    if len(team["roster"]) >= 15:
        raise HTTPException(400, "Roster full (15/15). Release a player first.")

    fa_pool = league["fa_pool"]
    player  = next((p for p in fa_pool if p["id"] == body.player_id), None)
    if not player:
        raise HTTPException(404, "Player not in FA pool")

    new_cap = team["cap_used"] + player["salary"]
    if new_cap > LUXURY_TAX:
        raise HTTPException(400, f"Signing would push you over luxury tax (${LUXURY_TAX:,})")

    team["roster"].append({**player, "team": abbr})
    team["cap_used"] = new_cap
    league["fa_pool"] = [p for p in fa_pool if p["id"] != body.player_id]

    with get_conn() as conn:
        put_save(conn, save_id, league)

    return {
        "signed":    player["name"],
        "salary":    player["salary"],
        "cap_used":  new_cap,
        "cap_space": SALARY_CAP - new_cap,
        "roster_count": len(team["roster"]),
    }

class ReleaseBody(BaseModel):
    player_id: str

@router.post("/release/{save_id}")
def release_player(save_id: str, body: ReleaseBody):
    """Release a player from your roster to the FA pool."""
    conn = get_conn()
    league = get_save(conn, save_id)

    abbr   = league["gm_team"]
    team   = league["teams"][abbr]
    roster = team["roster"]

    player = next((p for p in roster if p["id"] == body.player_id), None)
    if not player:
        raise HTTPException(404, "Player not on your roster")

    team["roster"]   = [p for p in roster if p["id"] != body.player_id]
    team["cap_used"] -= player["salary"]
    league["fa_pool"].append({**player, "team": "FA"})

    with get_conn() as conn:
        put_save(conn, save_id, league)

    return {
        "released":  player["name"],
        "cap_freed": player["salary"],
        "cap_used":  team["cap_used"],
        "cap_space": SALARY_CAP - team["cap_used"],
    }
