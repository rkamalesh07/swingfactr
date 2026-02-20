"""Lineups router."""
from fastapi import APIRouter, Query
from src.models.lineup_impact import get_team_lineup_rankings

router = APIRouter()


@router.get("/{team_id}/lineup_rankings")
async def team_lineup_rankings(
    team_id: int,
    season: str = Query("2025-26"),
    min_minutes: float = Query(5.0),
):
    """Return ranked 5-man lineups for a team with RAPM and raw ratings."""
    df = get_team_lineup_rankings(team_id, season, min_minutes)
    if df.empty:
        return {"team_id": team_id, "season_id": season, "lineups": []}
    return {"team_id": team_id, "season_id": season, "lineups": df.to_dict("records")}
