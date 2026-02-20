"""
src/etl/config.py
Central constants for ETL — city coordinates, altitude, timezone offsets.
All data is PUBLIC DOMAIN / fact-based.
"""

# NBA Team home city data: lat, lon, altitude (ft), timezone offset from ET
TEAM_CITY_DATA: dict[int, dict] = {
    1610612737: {"city": "Atlanta",       "lat": 33.757, "lon": -84.396, "alt": 1050, "tz_offset_et": 0},
    1610612738: {"city": "Boston",        "lat": 42.366, "lon": -71.062, "alt": 141,  "tz_offset_et": 0},
    1610612751: {"city": "Brooklyn",      "lat": 40.683, "lon": -73.975, "alt": 33,   "tz_offset_et": 0},
    1610612766: {"city": "Charlotte",     "lat": 35.225, "lon": -80.839, "alt": 748,  "tz_offset_et": 0},
    1610612741: {"city": "Chicago",       "lat": 41.881, "lon": -87.674, "alt": 595,  "tz_offset_et": -1},
    1610612739: {"city": "Cleveland",     "lat": 41.496, "lon": -81.688, "alt": 653,  "tz_offset_et": 0},
    1610612742: {"city": "Dallas",        "lat": 32.790, "lon": -96.810, "alt": 430,  "tz_offset_et": -1},
    1610612743: {"city": "Denver",        "lat": 39.749, "lon": -104.999,"alt": 5280, "tz_offset_et": -2},
    1610612765: {"city": "Detroit",       "lat": 42.341, "lon": -83.055, "alt": 600,  "tz_offset_et": 0},
    1610612744: {"city": "Golden State",  "lat": 37.768, "lon": -122.388,"alt": 30,   "tz_offset_et": -3},
    1610612745: {"city": "Houston",       "lat": 29.751, "lon": -95.362, "alt": 43,   "tz_offset_et": -1},
    1610612754: {"city": "Indiana",       "lat": 39.764, "lon": -86.156, "alt": 715,  "tz_offset_et": 0},
    1610612746: {"city": "LA Clippers",   "lat": 34.043, "lon": -118.267,"alt": 233,  "tz_offset_et": -3},
    1610612747: {"city": "LA Lakers",     "lat": 34.043, "lon": -118.267,"alt": 233,  "tz_offset_et": -3},
    1610612763: {"city": "Memphis",       "lat": 35.138, "lon": -90.051, "alt": 337,  "tz_offset_et": -1},
    1610612748: {"city": "Miami",         "lat": 25.781, "lon": -80.188, "alt": 6,    "tz_offset_et": 0},
    1610612749: {"city": "Milwaukee",     "lat": 43.045, "lon": -87.917, "alt": 617,  "tz_offset_et": -1},
    1610612750: {"city": "Minnesota",     "lat": 44.979, "lon": -93.276, "alt": 815,  "tz_offset_et": -1},
    1610612740: {"city": "New Orleans",   "lat": 29.949, "lon": -90.082, "alt": 3,    "tz_offset_et": -1},
    1610612752: {"city": "New York",      "lat": 40.751, "lon": -73.994, "alt": 33,   "tz_offset_et": 0},
    1610612760: {"city": "Oklahoma City", "lat": 35.463, "lon": -97.515, "alt": 1201, "tz_offset_et": -1},
    1610612753: {"city": "Orlando",       "lat": 28.539, "lon": -81.383, "alt": 96,   "tz_offset_et": 0},
    1610612755: {"city": "Philadelphia",  "lat": 39.901, "lon": -75.172, "alt": 39,   "tz_offset_et": 0},
    1610612756: {"city": "Phoenix",       "lat": 33.446, "lon": -112.071,"alt": 1086, "tz_offset_et": -2},
    1610612757: {"city": "Portland",      "lat": 45.532, "lon": -122.667,"alt": 50,   "tz_offset_et": -3},
    1610612758: {"city": "Sacramento",    "lat": 38.580, "lon": -121.499,"alt": 30,   "tz_offset_et": -3},
    1610612759: {"city": "San Antonio",   "lat": 29.427, "lon": -98.438, "alt": 650,  "tz_offset_et": -1},
    1610612761: {"city": "Toronto",       "lat": 43.643, "lon": -79.379, "alt": 249,  "tz_offset_et": 0},
    1610612762: {"city": "Utah",          "lat": 40.768, "lon": -111.901,"alt": 4330, "tz_offset_et": -2},
    1610612764: {"city": "Washington",    "lat": 38.898, "lon": -77.021, "alt": 49,   "tz_offset_et": 0},
}

# nba_api event types
EVENT_TYPES = {
    1:  "made_shot",
    2:  "missed_shot",
    3:  "free_throw",
    4:  "rebound",
    5:  "turnover",
    6:  "foul",
    7:  "violation",
    8:  "substitution",
    9:  "timeout",
    10: "jump_ball",
    11: "ejection",
    12: "start_period",
    13: "end_period",
    18: "instant_replay",
    20: "stoppage",
}

CLUTCH_MINUTES_REMAINING = 5.0
CLUTCH_SCORE_MARGIN = 5
REGULATION_SECONDS = 2880  # 4 x 12 min
OT_SECONDS = 300           # 5 min OT
