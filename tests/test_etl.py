"""Unit tests for ETL functions.

These tests don't require a live DB — they test parsing logic in isolation.
"""

import pytest
from src.etl.pbp import clock_to_seconds, period_to_game_seconds, parse_shot_distance
from src.etl.lineups import lineup_id
from src.etl.schedule import haversine_miles


class TestClockParsing:
    def test_standard_clock(self):
        assert clock_to_seconds("12:00") == 720
        assert clock_to_seconds("0:00") == 0
        assert clock_to_seconds("5:30") == 330

    def test_iso_clock(self):
        # nba_api sometimes returns ISO 8601 duration
        assert clock_to_seconds("PT11M32.00S") == 692
        assert clock_to_seconds("PT0M0.00S") == 0

    def test_game_seconds(self):
        # Start of Q1: period=1, clock=720 → 0 elapsed
        assert period_to_game_seconds(1, 720) == 0
        # End of Q1: period=1, clock=0 → 720 elapsed
        assert period_to_game_seconds(1, 0) == 720
        # Start of Q2: period=2, clock=720 → 720 elapsed
        assert period_to_game_seconds(2, 720) == 720
        # Midway Q3: period=3, clock=360 → 1440 + 360 = 1800
        assert period_to_game_seconds(3, 360) == 1800


class TestShotDistance:
    def test_extracts_distance(self):
        assert parse_shot_distance("Curry 27' Jump Shot") == 27.0
        assert parse_shot_distance("Dunk by LeBron") is None
        assert parse_shot_distance("") is None


class TestLineupId:
    def test_sorted_stable(self):
        players = [202695, 1629029, 1628389, 1627783, 203110]
        assert lineup_id(players) == lineup_id(list(reversed(players)))
        assert "-" in lineup_id(players)

    def test_five_players(self):
        players = [1, 2, 3, 4, 5]
        lid = lineup_id(players)
        assert lid == "1-2-3-4-5"


class TestTravelDistance:
    def test_la_to_boston(self):
        # Los Angeles to Boston ≈ 2596 miles
        dist = haversine_miles(34.043, -118.267, 42.361, -71.057)
        assert 2500 < dist < 2700

    def test_same_city(self):
        dist = haversine_miles(34.043, -118.267, 34.043, -118.267)
        assert dist < 1


class TestFeatureEngineering:
    """Test feature computation without DB (using synthetic data)."""

    def test_clutch_detection(self):
        """Clutch = Q4 or later, ≤5 min remaining, score within 5."""
        from src.etl.lineups import _close_stint
        stint = _close_stint(
            game_id="test123",
            team_id=1,
            players=[1, 2, 3, 4, 5],
            start_info={"period": 4, "clock_seconds": 240, "game_seconds": 2640, "score_diff": 3, "lineup_id": "1-2-3-4-5"},
            end_period=4,
            end_clock=0,
            end_game_sec=2880,
            end_score_diff=3,
        )
        assert stint["is_clutch"] is True

    def test_non_clutch(self):
        from src.etl.lineups import _close_stint
        stint = _close_stint(
            game_id="test123",
            team_id=1,
            players=[1, 2, 3, 4, 5],
            start_info={"period": 2, "clock_seconds": 600, "game_seconds": 840, "score_diff": 12, "lineup_id": "1-2-3-4-5"},
            end_period=2,
            end_clock=360,
            end_game_sec=1080,
            end_score_diff=14,
        )
        assert stint["is_clutch"] is False
