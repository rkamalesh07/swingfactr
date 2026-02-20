"""
src/app/main.py
SwingFactr — Streamlit Frontend

Views:
  1. 🏀 Game View    — Win probability curve + key plays
  2. 📊 Lineup View  — Lineup impact rankings + WP attribution
  3. ⚡ Clutch View  — Clutch performance comparisons
  4. 😴 Fatigue View — Schedule heatmap + rest/travel effects
"""

import os
import requests
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
import streamlit as st

API_BASE = os.getenv("API_BASE_URL", "http://localhost:8000")

st.set_page_config(
    page_title="SwingFactr",
    page_icon="🏀",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── Custom CSS ───────────────────────────────────────────────────────────────
st.markdown("""
<style>
    .main { background-color: #0d1117; color: #e6edf3; }
    .stMetric { background: #161b22; border-radius: 8px; padding: 10px; }
    h1, h2, h3 { color: #58a6ff; }
    .stSelectbox label, .stSlider label { color: #8b949e; }
    .win-prob-home { color: #3fb950; }
    .win-prob-away { color: #f78166; }
</style>
""", unsafe_allow_html=True)


# ─── API helpers ─────────────────────────────────────────────────────────────

@st.cache_data(ttl=300)
def api_get(endpoint: str, params: dict = {}) -> dict:
    """Cached API call with 5-minute TTL."""
    try:
        r = requests.get(f"{API_BASE}/{endpoint}", params=params, timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        st.error(f"API error ({endpoint}): {e}")
        return {}


# ─── Sidebar ─────────────────────────────────────────────────────────────────
st.sidebar.image("https://via.placeholder.com/200x50/0d1117/58a6ff?text=SwingFactr", width=200)
st.sidebar.markdown("---")

view = st.sidebar.radio(
    "Navigation",
    ["🏀 Game View", "📊 Lineup View", "⚡ Clutch View", "😴 Fatigue View"],
)

seasons = ["2023-24", "2022-23", "2021-22"]
selected_season = st.sidebar.selectbox("Season", seasons)


# ─── 1. Game View ────────────────────────────────────────────────────────────

if view == "🏀 Game View":
    st.title("🏀 Game Win Probability")
    st.caption("Live + historical win probability curves. Click any swing to see the play.")

    games_data = api_get("games/", {"season": selected_season, "limit": 100})
    games = games_data.get("games", [])

    if not games:
        st.warning("No games found. Run the ETL pipeline first: `make etl`")
        st.stop()

    game_options = {
        f"{g['game_date']} — {g['away_abbr']} @ {g['home_abbr']} "
        f"({g.get('away_score','?')}-{g.get('home_score','?')})": g["game_id"]
        for g in games
    }
    selected_label = st.selectbox("Select Game", list(game_options.keys()))
    selected_game_id = game_options[selected_label]

    col1, col2 = st.columns([3, 1])

    with col1:
        with st.spinner("Loading win probability..."):
            wp_data = api_get(f"game/{selected_game_id}/winprob")

        series = wp_data.get("series", [])
        if not series:
            st.warning("No win probability data for this game.")
        else:
            df_wp = pd.DataFrame(series)
            df_wp["seconds_elapsed"] = pd.to_numeric(df_wp["seconds_elapsed"], errors="coerce")
            df_wp["home_win_prob"] = pd.to_numeric(df_wp["home_win_prob"], errors="coerce")
            df_wp = df_wp.dropna(subset=["seconds_elapsed", "home_win_prob"])
            df_wp = df_wp.sort_values("seconds_elapsed")

            # Find game teams for labels
            game_info = games_data["games"]
            game_meta = next((g for g in game_info if g["game_id"] == selected_game_id), {})
            home_label = game_meta.get("home_abbr", "Home")
            away_label = game_meta.get("away_abbr", "Away")

            fig = go.Figure()

            # Win prob curve
            fig.add_trace(go.Scatter(
                x=df_wp["seconds_elapsed"] / 60,
                y=df_wp["home_win_prob"],
                mode="lines",
                line=dict(color="#58a6ff", width=2),
                name=f"{home_label} Win Prob",
                fill="tozeroy",
                fillcolor="rgba(88,166,255,0.1)",
            ))

            # 50% line
            fig.add_hline(y=0.5, line_dash="dash", line_color="#8b949e", opacity=0.5)

            # Quarter dividers
            for q in [12, 24, 36, 48]:
                fig.add_vline(x=q, line_dash="dot", line_color="#30363d", opacity=0.6)

            # Momentum swings (top 5 key plays)
            key_plays_data = api_get(f"game/{selected_game_id}/keyplays", {"top_n": 5})
            key_plays = key_plays_data.get("key_plays", [])
            for kp in key_plays:
                t = kp.get("seconds_elapsed", 0) / 60
                prob = kp.get("home_win_prob", 0.5)
                delta = kp.get("wp_delta", 0)
                desc = kp.get("description", "")[:60]
                fig.add_annotation(
                    x=t, y=prob,
                    text=f"±{delta:.0%}" if delta else "",
                    showarrow=True, arrowhead=2, arrowcolor="#f78166",
                    font=dict(size=9, color="#f78166"),
                )

            fig.update_layout(
                title=f"{away_label} @ {home_label} — Win Probability",
                xaxis_title="Minutes Elapsed",
                yaxis_title=f"{home_label} Win Probability",
                yaxis=dict(tickformat=".0%", range=[0, 1]),
                xaxis=dict(range=[0, 53]),
                plot_bgcolor="#0d1117",
                paper_bgcolor="#0d1117",
                font=dict(color="#e6edf3"),
                height=450,
                showlegend=False,
            )
            st.plotly_chart(fig, use_container_width=True)

    with col2:
        st.subheader("⚡ Key Plays")
        if key_plays:
            for kp in key_plays[:5]:
                delta = kp.get("wp_delta", 0)
                color = "🔴" if delta > 0.05 else "🟡"
                st.markdown(
                    f"{color} **±{delta:.1%}** swing  \n"
                    f"`{kp.get('description','')[:50]}`  \n"
                    f"*{kp.get('seconds_elapsed', 0)/60:.1f} min*"
                )
                st.markdown("---")
        else:
            st.info("Key plays unavailable.")

    # Lineup stints timeline
    st.subheader("🔄 Lineup Changes (by team)")
    stints_data = api_get(f"game/{selected_game_id}/lineups")
    stints = stints_data.get("stints", [])
    if stints:
        df_stints = pd.DataFrame(stints)
        if not df_stints.empty:
            df_stints["start_min"] = df_stints["start_seconds"] / 60
            df_stints["end_min"] = df_stints["end_seconds"] / 60
            df_stints["duration_min"] = df_stints["duration_seconds"] / 60
            df_stints["nrtg_display"] = df_stints.get("net_rating_adj", pd.Series(dtype=float)).round(1)

            fig2 = px.bar(
                df_stints.head(50),
                x="duration_min",
                y="lineup_id",
                color="net_rating_adj" if "net_rating_adj" in df_stints.columns else "duration_min",
                color_continuous_scale="RdYlGn",
                orientation="h",
                title="Lineup Stints — colored by Adjusted Net Rating",
                labels={"duration_min": "Minutes", "lineup_id": "Lineup ID"},
            )
            fig2.update_layout(
                plot_bgcolor="#0d1117", paper_bgcolor="#0d1117",
                font=dict(color="#e6edf3"), height=400,
                showlegend=False,
                yaxis=dict(showticklabels=False),
            )
            st.plotly_chart(fig2, use_container_width=True)


# ─── 2. Lineup View ──────────────────────────────────────────────────────────

elif view == "📊 Lineup View":
    st.title("📊 Lineup Impact Rankings")
    st.caption("5-man unit net ratings, opponent-adjusted. Error bars = 95% bootstrap CI.")

    # Team selector
    teams_data = api_get("games/", {"season": selected_season, "limit": 1})
    # Fetch via game list
    all_games = api_get("games/", {"season": selected_season, "limit": 200}).get("games", [])
    teams_set = {}
    for g in all_games:
        teams_set[g["home_abbr"]] = g.get("home_team_id")
        teams_set[g["away_abbr"]] = g.get("away_team_id")

    team_names = sorted(teams_set.keys())
    selected_team_abbr = st.selectbox("Team", team_names)
    selected_team_id = teams_set.get(selected_team_abbr)

    if selected_team_id:
        min_min = st.slider("Min Minutes Played", 1, 60, 5)
        sort_by = st.radio("Sort by", ["net_rating_adj", "off_rating", "def_rating"], horizontal=True)

        rankings_data = api_get(
            f"team/{selected_team_id}/lineup_rankings",
            {"season": selected_season, "min_minutes": min_min, "sort_by": sort_by, "limit": 20}
        )
        top = rankings_data.get("top_lineups", [])
        bottom = rankings_data.get("bottom_lineups", [])

        col1, col2 = st.columns(2)

        def lineup_chart(lineups, title, ascending=False):
            if not lineups:
                st.info("No lineup data.")
                return
            df = pd.DataFrame(lineups)
            if "net_rating_adj" not in df.columns:
                st.info("Net rating data not available yet.")
                return
            df["lineup_short"] = df["lineup_id"].str[:20] + "..."
            df = df.sort_values("net_rating_adj", ascending=ascending).head(10)

            fig = go.Figure()
            fig.add_trace(go.Bar(
                x=df["net_rating_adj"],
                y=df["lineup_short"],
                orientation="h",
                error_x=dict(
                    type="data",
                    symmetric=False,
                    array=(df.get("net_rating_ci_high", df["net_rating_adj"]) - df["net_rating_adj"]).clip(lower=0),
                    arrayminus=(df["net_rating_adj"] - df.get("net_rating_ci_low", df["net_rating_adj"])).clip(lower=0),
                    color="#8b949e",
                ),
                marker_color=["#3fb950" if v > 0 else "#f78166" for v in df["net_rating_adj"]],
            ))
            fig.update_layout(
                title=title,
                xaxis_title="Adjusted Net Rating",
                plot_bgcolor="#0d1117", paper_bgcolor="#0d1117",
                font=dict(color="#e6edf3"), height=380,
                yaxis=dict(showticklabels=False),
            )
            st.plotly_chart(fig, use_container_width=True)
            st.dataframe(
                df[["lineup_short", "net_rating_adj", "off_rating", "def_rating",
                    "total_minutes", "games_played"]].round(1),
                hide_index=True,
            )

        with col1:
            lineup_chart(top, f"🟢 Best Lineups — {selected_team_abbr}")
        with col2:
            lineup_chart(bottom, f"🔴 Worst Lineups — {selected_team_abbr}", ascending=True)


# ─── 3. Clutch View ──────────────────────────────────────────────────────────

elif view == "⚡ Clutch View":
    st.title("⚡ Clutch Performance")
    st.caption("Last 5 minutes, within 5 points. Lineup-level clutch net rating.")

    col_a, col_b = st.columns(2)
    with col_a:
        clutch_team = st.text_input("Filter by Team ID (optional)", "")
    with col_b:
        clutch_limit = st.slider("Top N Lineups", 5, 50, 20)

    params: dict = {"season": selected_season, "limit": clutch_limit}
    if clutch_team:
        try:
            params["team_id"] = int(clutch_team)
        except ValueError:
            pass

    clutch_data = api_get("clutch/", params)
    clutch_lineups = clutch_data.get("clutch_lineups", [])

    if not clutch_lineups:
        st.warning("No clutch data. Make sure ETL + feature engineering ran.")
    else:
        df_clutch = pd.DataFrame(clutch_lineups)

        fig = px.scatter(
            df_clutch,
            x="clutch_minutes",
            y="clutch_net_rating",
            size="clutch_stints",
            color="team_abbr",
            hover_data=["lineup_id", "clutch_pts_scored", "clutch_pts_allowed"],
            title="Clutch Net Rating vs. Minutes (bubble = # stints)",
            labels={"clutch_net_rating": "Clutch Net Rtg (+100 poss)", "clutch_minutes": "Clutch Minutes"},
        )
        fig.add_hline(y=0, line_dash="dash", line_color="#8b949e")
        fig.update_layout(
            plot_bgcolor="#0d1117", paper_bgcolor="#0d1117",
            font=dict(color="#e6edf3"), height=500,
        )
        st.plotly_chart(fig, use_container_width=True)

        st.dataframe(
            df_clutch[[
                "team_abbr", "lineup_id", "clutch_minutes",
                "clutch_net_rating", "clutch_stints",
                "clutch_pts_scored", "clutch_pts_allowed"
            ]].round(1),
            hide_index=True,
        )


# ─── 4. Fatigue View ─────────────────────────────────────────────────────────

elif view == "😴 Fatigue View":
    st.title("😴 Fatigue & Travel Impact")
    st.caption("How rest, back-to-backs, and travel distance shift win probability.")

    fatigue_data = api_get("fatigue/")
    scenarios = fatigue_data.get("scenarios", [])
    effects = fatigue_data.get("coefficient_effects", {})

    if scenarios:
        st.subheader("📉 Scenario Analysis")
        st.caption("Estimated home win probability shift vs. baseline (equal rest, no travel stress).")
        df_scenarios = pd.DataFrame(scenarios)
        df_scenarios = df_scenarios.sort_values("delta_vs_baseline")

        fig = px.bar(
            df_scenarios,
            x="delta_vs_baseline",
            y="scenario",
            orientation="h",
            color="delta_vs_baseline",
            color_continuous_scale="RdYlGn",
            title="Fatigue Scenario → Home Win Prob Δ",
            labels={"delta_vs_baseline": "ΔWin Probability", "scenario": "Scenario"},
            text="delta_vs_baseline",
        )
        fig.update_traces(texttemplate="%{text:.1%}", textposition="outside")
        fig.update_layout(
            plot_bgcolor="#0d1117", paper_bgcolor="#0d1117",
            font=dict(color="#e6edf3"), height=450,
            coloraxis_showscale=False,
        )
        st.plotly_chart(fig, use_container_width=True)

    if effects:
        st.subheader("🔬 Model Coefficients")
        st.caption("Significant predictors from logistic regression (95% CI excludes 0).")
        sig_effects = {k: v for k, v in effects.items() if v.get("significant")}
        if sig_effects:
            rows = [
                {
                    "Feature": k,
                    "Marginal Effect (ΔWin Prob)": round(v["marginal_effect"], 4),
                    "95% CI Low": round(v["ci_low"], 4),
                    "95% CI High": round(v["ci_high"], 4),
                }
                for k, v in sig_effects.items()
            ]
            st.dataframe(pd.DataFrame(rows), hide_index=True)
        else:
            st.info("No significant effects found (need more data — run ETL for full season).")

    # Schedule heatmap
    st.subheader("📅 Schedule Fatigue Heatmap")
    sched_team = st.text_input("Team ID for schedule heatmap", "")
    if sched_team:
        try:
            sched_data = api_get("fatigue/schedule", {"team_id": int(sched_team), "season": selected_season})
            schedule = sched_data.get("schedule", [])
            if schedule:
                df_sched = pd.DataFrame(schedule)
                df_sched["game_date"] = pd.to_datetime(df_sched["game_date"])
                df_sched["fatigue_score"] = (
                    df_sched["away_back_to_back"].astype(float) * 3
                    + df_sched.get("away_road_trip_len", pd.Series(0, index=df_sched.index)).fillna(0)
                    + df_sched.get("travel_dist_miles", pd.Series(0, index=df_sched.index)).fillna(0) / 1000
                )
                fig2 = px.scatter(
                    df_sched,
                    x="game_date",
                    y="fatigue_score",
                    color="away_back_to_back",
                    size="fatigue_score",
                    hover_data=["home_abbr", "away_abbr", "travel_dist_miles"],
                    title="Fatigue Score by Game",
                )
                fig2.update_layout(
                    plot_bgcolor="#0d1117", paper_bgcolor="#0d1117",
                    font=dict(color="#e6edf3"),
                )
                st.plotly_chart(fig2, use_container_width=True)
        except Exception:
            st.error("Invalid team ID.")
