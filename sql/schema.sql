-- SwingFactr Database Schema PostgreSQL 15+

CREATE TABLE IF NOT EXISTS seasons (
    season_id   VARCHAR(10) PRIMARY KEY,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
    team_id         INTEGER PRIMARY KEY,
    abbreviation    VARCHAR(5) NOT NULL,
    city            VARCHAR(50),
    name            VARCHAR(50),
    conference      VARCHAR(4),
    division        VARCHAR(20),
    home_lat        FLOAT,
    home_lon        FLOAT,
    altitude_ft     INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS players (
    player_id   INTEGER PRIMARY KEY,
    first_name  VARCHAR(50),
    last_name   VARCHAR(50),
    full_name   VARCHAR(100),
    position    VARCHAR(5)
);

CREATE TABLE IF NOT EXISTS games (
    game_id         VARCHAR(20) PRIMARY KEY,
    season_id       VARCHAR(10) REFERENCES seasons(season_id),
    game_date       DATE NOT NULL,
    home_team_id    INTEGER REFERENCES teams(team_id),
    away_team_id    INTEGER REFERENCES teams(team_id),
    home_score      INTEGER,
    away_score      INTEGER,
    home_win        BOOLEAN,
    home_rest_days  INTEGER,
    away_rest_days  INTEGER,
    home_b2b        BOOLEAN DEFAULT FALSE,
    away_b2b        BOOLEAN DEFAULT FALSE,
    home_3in4       BOOLEAN DEFAULT FALSE,
    away_3in4       BOOLEAN DEFAULT FALSE,
    travel_miles    FLOAT,
    tz_change       INTEGER,
    away_road_trip_game INTEGER DEFAULT 1,
    home_def_cluster INTEGER,
    away_def_cluster INTEGER,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_games_date ON games(game_date);
CREATE INDEX IF NOT EXISTS idx_games_season ON games(season_id);

CREATE TABLE IF NOT EXISTS plays (
    play_id                 BIGSERIAL PRIMARY KEY,
    game_id                 VARCHAR(20) REFERENCES games(game_id),
    play_num                INTEGER,
    period                  INTEGER,
    clock_seconds           INTEGER,
    game_seconds_elapsed    INTEGER,
    time_remaining_seconds  INTEGER,
    description             TEXT,
    home_score              INTEGER DEFAULT 0,
    away_score              INTEGER DEFAULT 0,
    score_diff              INTEGER,
    possession_team_id      INTEGER,
    is_home_possession      BOOLEAN,
    is_fg_attempt           BOOLEAN DEFAULT FALSE,
    is_fg_made              BOOLEAN DEFAULT FALSE,
    is_3pt                  BOOLEAN DEFAULT FALSE,
    shot_distance           FLOAT,
    is_rim_attempt          BOOLEAN DEFAULT FALSE,
    is_turnover             BOOLEAN DEFAULT FALSE,
    is_foul                 BOOLEAN DEFAULT FALSE,
    is_timeout              BOOLEAN DEFAULT FALSE,
    play_type               VARCHAR(100)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plays_game_num ON plays(game_id, play_num);
CREATE INDEX IF NOT EXISTS idx_plays_game ON plays(game_id);

CREATE TABLE IF NOT EXISTS stints (
    stint_id            BIGSERIAL PRIMARY KEY,
    game_id             VARCHAR(20) REFERENCES games(game_id),
    team_id             INTEGER REFERENCES teams(team_id),
    lineup_id           VARCHAR(100),
    period              INTEGER,
    start_clock_seconds INTEGER,
    end_clock_seconds   INTEGER,
    start_game_seconds  INTEGER,
    end_game_seconds    INTEGER,
    duration_seconds    INTEGER,
    start_score_diff    INTEGER,
    end_score_diff      INTEGER,
    net_points          INTEGER,
    possessions         INTEGER DEFAULT 0,
    is_clutch           BOOLEAN DEFAULT FALSE,
    points_for          INTEGER DEFAULT 0,
    points_against      INTEGER DEFAULT 0,
    possessions_for     INTEGER DEFAULT 0,
    possessions_against INTEGER DEFAULT 0,
    off_rating          FLOAT,
    def_rating          FLOAT,
    net_rating          FLOAT
);

CREATE UNIQUE INDEX IF NOT EXISTS stints_unique_idx ON stints(game_id, team_id, lineup_id, period, start_game_seconds);
CREATE INDEX IF NOT EXISTS idx_stints_game ON stints(game_id);
CREATE INDEX IF NOT EXISTS idx_stints_lineup ON stints(lineup_id);
CREATE INDEX IF NOT EXISTS idx_stints_team ON stints(team_id);

CREATE TABLE IF NOT EXISTS lineup_players (
    lineup_id   VARCHAR(100) NOT NULL,
    player_id   INTEGER,
    team_id     INTEGER REFERENCES teams(team_id),
    PRIMARY KEY (lineup_id, player_id)
);

CREATE TABLE IF NOT EXISTS lineup_stats (
    lineup_id           VARCHAR(100) NOT NULL,
    season_id           VARCHAR(10) REFERENCES seasons(season_id),
    team_id             INTEGER REFERENCES teams(team_id),
    total_minutes       FLOAT DEFAULT 0,
    total_possessions   INTEGER DEFAULT 0,
    off_rating          FLOAT,
    def_rating          FLOAT,
    net_rating          FLOAT,
    stint_count         INTEGER DEFAULT 0,
    games_together      INTEGER DEFAULT 0,
    rapm_estimate       FLOAT,
    rapm_ci_low         FLOAT,
    rapm_ci_high        FLOAT,
    PRIMARY KEY (lineup_id, season_id)
);

CREATE TABLE IF NOT EXISTS schedule (
    schedule_id     BIGSERIAL PRIMARY KEY,
    team_id         INTEGER REFERENCES teams(team_id),
    game_id         VARCHAR(20) REFERENCES games(game_id),
    game_date       DATE,
    is_home         BOOLEAN,
    opponent_id     INTEGER,
    rest_days       INTEGER,
    b2b             BOOLEAN DEFAULT FALSE,
    third_in_four   BOOLEAN DEFAULT FALSE,
    road_trip_game  INTEGER DEFAULT 0,
    travel_from_city VARCHAR(50),
    travel_miles    FLOAT DEFAULT 0,
    tz_change       INTEGER DEFAULT 0,
    altitude_ft     INTEGER DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS schedule_team_game_idx ON schedule(team_id, game_id);

CREATE TABLE IF NOT EXISTS win_prob_predictions (
    pred_id         BIGSERIAL PRIMARY KEY,
    game_id         VARCHAR(20) REFERENCES games(game_id),
    play_id         BIGINT,
    game_seconds    INTEGER,
    home_win_prob   FLOAT,
    model_version   VARCHAR(20) DEFAULT 'xgb_v1'
);

CREATE INDEX IF NOT EXISTS idx_winprob_game ON win_prob_predictions(game_id);

CREATE TABLE IF NOT EXISTS defensive_profiles (
    team_id         INTEGER REFERENCES teams(team_id),
    season_id       VARCHAR(10) REFERENCES seasons(season_id),
    opp_3pa_rate    FLOAT,
    opp_rim_rate    FLOAT,
    avg_shot_dist   FLOAT,
    def_reb_pct     FLOAT,
    opp_pace        FLOAT,
    foul_rate       FLOAT,
    def_cluster     INTEGER,
    cluster_label   VARCHAR(30),
    PRIMARY KEY (team_id, season_id)
);

CREATE TABLE IF NOT EXISTS clutch_segments (
    segment_id      BIGSERIAL PRIMARY KEY,
    game_id         VARCHAR(20) REFERENCES games(game_id),
    team_id         INTEGER REFERENCES teams(team_id),
    lineup_id       VARCHAR(100),
    start_seconds   INTEGER,
    end_seconds     INTEGER,
    score_diff_at_start INTEGER,
    points_scored   INTEGER DEFAULT 0,
    points_allowed  INTEGER DEFAULT 0,
    possessions     INTEGER DEFAULT 0,
    won_segment     BOOLEAN,
    game_won        BOOLEAN,
    home_team_id    INTEGER,
    opp_def_cluster INTEGER,
    rest_days       INTEGER,
    b2b             BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS model_runs (
    run_id          BIGSERIAL PRIMARY KEY,
    model_name      VARCHAR(50),
    season_id       VARCHAR(10),
    trained_at      TIMESTAMP DEFAULT NOW(),
    brier_score     FLOAT,
    log_loss        FLOAT,
    auc             FLOAT,
    notes           TEXT
);
