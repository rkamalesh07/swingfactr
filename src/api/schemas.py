"""Pydantic schemas for SwingFactr API responses."""

from typing import Optional
from pydantic import BaseModel


class GameSummary(BaseModel):
    game_id: str
    game_date: str
    home_team: str
    away_team: str
    home_score: Optional[int]
    away_score: Optional[int]
    home_win: Optional[bool]


class WinProbPoint(BaseModel):
    game_seconds: int
    home_win_prob: float
    quarter: int
    score_diff: int


class WinProbResponse(BaseModel):
    game_id: str
    home_team_id: int
    away_team_id: int
    final_home_win_prob: Optional[float]
    series: list[WinProbPoint]


class LineupStint(BaseModel):
    lineup_id: str
    lineup_display: str
    team_id: int
    total_minutes: float
    net_rating: Optional[float]
    off_rating: Optional[float]
    def_rating: Optional[float]
    rapm_estimate: Optional[float]
    rapm_ci_low: Optional[float]
    rapm_ci_high: Optional[float]
    stint_count: int


class LineupRankingsResponse(BaseModel):
    team_id: int
    season_id: str
    lineups: list[LineupStint]


class ClutchSummary(BaseModel):
    team_id: int
    season_id: str
    clutch_win_pct: float
    clutch_net_rating: float
    games_in_clutch: int


class FatigueEffect(BaseModel):
    factor: str
    coefficient: float
    p_value: float
    ci_low: float
    ci_high: float
    significant: bool


class FatigueResponse(BaseModel):
    season_id: str
    effects: list[FatigueEffect]
    r_squared: float
    interpretation: str
