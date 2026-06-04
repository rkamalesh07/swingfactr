"use client";
import { useState, useEffect, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "https://swingfactr-production.up.railway.app";

const CAP = 140_000_000;
const LUX = 170_000_000;

// ─── Types ────────────────────────────────────────────────────────────────────

type Player = {
  id: string; name: string; position: string; age: number; team: string;
  ppg: number; rpg: number; apg: number; mpg: number; gp: number;
  scoring: number; efficiency: number; playmaking: number;
  rebounding: number; defense: number; composure: number; overall: number;
  archetype: string; salary: number; years_left: number;
};

type TeamRow = { abbr: string; name: string; wins: number; losses: number; pct: number; gm_team: boolean; };
type GMState = {
  save_id: string; gm_team: string; team_name: string;
  wins: number; losses: number; cap_used: number; cap_space: number;
  conf_rank: number | string; conference: string; day: number; season: number;
  games_simmed: number;
};

const NBA_TEAMS = [
  {abbr:"ATL",name:"Atlanta Hawks",conf:"East"},{abbr:"BOS",name:"Boston Celtics",conf:"East"},
  {abbr:"BKN",name:"Brooklyn Nets",conf:"East"},{abbr:"CHA",name:"Charlotte Hornets",conf:"East"},
  {abbr:"CHI",name:"Chicago Bulls",conf:"East"},{abbr:"CLE",name:"Cleveland Cavaliers",conf:"East"},
  {abbr:"DAL",name:"Dallas Mavericks",conf:"West"},{abbr:"DEN",name:"Denver Nuggets",conf:"West"},
  {abbr:"DET",name:"Detroit Pistons",conf:"East"},{abbr:"GS",name:"Golden State Warriors",conf:"West"},
  {abbr:"HOU",name:"Houston Rockets",conf:"West"},{abbr:"IND",name:"Indiana Pacers",conf:"East"},
  {abbr:"LAC",name:"LA Clippers",conf:"West"},{abbr:"LAL",name:"LA Lakers",conf:"West"},
  {abbr:"MEM",name:"Memphis Grizzlies",conf:"West"},{abbr:"MIA",name:"Miami Heat",conf:"East"},
  {abbr:"MIL",name:"Milwaukee Bucks",conf:"East"},{abbr:"MIN",name:"Minnesota Timberwolves",conf:"West"},
  {abbr:"NO",name:"New Orleans Pelicans",conf:"West"},{abbr:"NY",name:"New York Knicks",conf:"East"},
  {abbr:"OKC",name:"Oklahoma City Thunder",conf:"West"},{abbr:"ORL",name:"Orlando Magic",conf:"East"},
  {abbr:"PHI",name:"Philadelphia 76ers",conf:"East"},{abbr:"PHX",name:"Phoenix Suns",conf:"West"},
  {abbr:"POR",name:"Portland Trail Blazers",conf:"West"},{abbr:"SA",name:"San Antonio Spurs",conf:"West"},
  {abbr:"SAC",name:"Sacramento Kings",conf:"West"},{abbr:"TOR",name:"Toronto Raptors",conf:"East"},
  {abbr:"UTAH",name:"Utah Jazz",conf:"West"},{abbr:"WSH",name:"Washington Wizards",conf:"East"},
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$$(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function attrColor(v: number) {
  if (v >= 75) return "#f0f0f0";
  if (v >= 55) return "#888";
  return "#444";
}

function capBarColor(used: number, cap: number) {
  const pct = used / cap;
  if (pct >= 1.2) return "#ff4444";
  if (pct >= 1.0) return "#ff8800";
  if (pct >= 0.85) return "#ffcc00";
  return "#f0f0f0";
}

function AttrBar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom: 3 }}>
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#666", textTransform:"uppercase", letterSpacing:"0.08em" }}>{label}</span>
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color: attrColor(value) }}>{value}</span>
      </div>
      <div style={{ height: 2, background:"#1a1a1a", borderRadius: 1 }}>
        <div style={{ height:"100%", width:`${value}%`, background: attrColor(value), borderRadius: 1, transition:"width 0.4s ease" }} />
      </div>
    </div>
  );
}

function CapBar({ used, cap }: { used: number; cap: number }) {
  const pct = Math.min((used / cap) * 100, 120);
  const color = capBarColor(used, cap);
  return (
    <div>
      <div style={{ height: 3, background:"#111", borderRadius: 2, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${Math.min(pct, 100)}%`, background: color, borderRadius: 2, transition:"width 0.5s ease" }} />
      </div>
      {pct > 100 && (
        <div style={{ height: 3, background:"#111", borderRadius: 2, overflow:"hidden", marginTop: 2 }}>
          <div style={{ height:"100%", width:`${pct - 100}%`, background:"#ff4444", borderRadius: 2 }} />
        </div>
      )}
    </div>
  );
}

// ─── Franchise Select Screen ───────────────────────────────────────────────────

function FranchiseSelect({ onSelect }: { onSelect: (abbr: string) => void }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [hovering, setHovering] = useState<string | null>(null);

  const east = NBA_TEAMS.filter(t => t.conf === "East");
  const west = NBA_TEAMS.filter(t => t.conf === "West");

  async function handleSelect(abbr: string) {
    setLoading(abbr);
    try {
      const res = await fetch(`${API}/gm/new-game`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_abbr: abbr }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed");
      localStorage.setItem("gm_save_id", data.save_id);
      localStorage.setItem("gm_team", abbr);
      onSelect(data.save_id);
    } catch (e: any) {
      console.error(e.message);
      alert("Could not connect to backend. Check that Railway is deployed and try again.");
    } finally {
      setLoading(null);
    }
  }

  function TeamBtn({ t }: { t: typeof NBA_TEAMS[0] }) {
    const isLoading = loading === t.abbr;
    const isHov = hovering === t.abbr;
    return (
      <button
        onClick={() => handleSelect(t.abbr)}
        onMouseEnter={() => setHovering(t.abbr)}
        onMouseLeave={() => setHovering(null)}
        disabled={!!loading}
        style={{
          background: isHov ? "#111" : "transparent",
          border: `1px solid ${isHov ? "#333" : "#1a1a1a"}`,
          borderRadius: 4,
          padding: "10px 14px",
          cursor: loading ? "not-allowed" : "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          transition: "all 0.15s",
          opacity: loading && !isLoading ? 0.4 : 1,
        }}
      >
        <div style={{ textAlign:"left" }}>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 10, color:"#888", textTransform:"uppercase", letterSpacing:"0.08em" }}>{t.abbr}</div>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize: 12, color: isHov ? "#f0f0f0" : "#666", marginTop: 2 }}>{t.name}</div>
        </div>
        {isLoading ? (
          <div style={{ width: 12, height: 12, border:"1px solid #444", borderTopColor:"#f0f0f0", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
        ) : (
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 10, color:"#333" }}>SELECT</span>
        )}
      </button>
    );
  }

  return (
    <div style={{ minHeight:"100vh", background:"#000", padding:"60px 40px" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      <div style={{ maxWidth: 900, margin:"0 auto" }}>
        <div style={{ marginBottom: 48 }}>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 10, color:"#444", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom: 12 }}>
            SWINGFACTR / GM MODE
          </div>
          <h1 style={{ fontFamily:"Inter,sans-serif", fontSize: 36, fontWeight: 300, color:"#f0f0f0", lineHeight: 1.1, margin: 0 }}>
            Choose your<br /><strong style={{ fontWeight: 700 }}>franchise.</strong>
          </h1>
          <p style={{ fontFamily:"Inter,sans-serif", fontSize: 13, color:"#555", marginTop: 12, maxWidth: 420 }}>
            Real 2025-26 player data. Derived attributes from actual game logs. Build a contender.
          </p>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap: 40 }}>
          {[{label:"Eastern Conference", teams: east},{label:"Western Conference", teams: west}].map(conf => (
            <div key={conf.label}>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#333", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom: 12, borderBottom:"1px solid #111", paddingBottom: 8 }}>
                {conf.label}
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap: 4 }}>
                {conf.teams.map(t => <TeamBtn key={t.abbr} t={t} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Player Card (Roster + FA) ────────────────────────────────────────────────

function PlayerRow({
  player, action, actionLabel, actionLoading, onAction
}: {
  player: Player;
  action?: boolean;
  actionLabel?: string;
  actionLoading?: boolean;
  onAction?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ borderBottom:"1px solid #0d0d0d" }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display:"grid", gridTemplateColumns:"1fr 60px 60px 60px 60px 60px 100px", gap: 8, padding:"10px 0", cursor:"pointer", alignItems:"center" }}
      >
        <div>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize: 12, color:"#d0d0d0" }}>{player.name}</div>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#444", marginTop: 2 }}>
            {player.position} · {player.archetype} · Age {player.age}
          </div>
        </div>
        {[player.ppg, player.rpg, player.apg].map((v, i) => (
          <div key={i} style={{ fontFamily:"'DM Mono',monospace", fontSize: 11, color:"#888", textAlign:"right" }}>{v.toFixed(1)}</div>
        ))}
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 12, color: attrColor(player.overall), textAlign:"right", fontWeight:600 }}>
          {player.overall}
        </div>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#555", textAlign:"right" }}>{fmt$$(player.salary)}</div>
        <div style={{ display:"flex", justifyContent:"flex-end", gap: 6, alignItems:"center" }}>
          {action && (
            <button
              onClick={(e) => { e.stopPropagation(); onAction?.(); }}
              disabled={actionLoading}
              style={{
                fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#000", background:"#f0f0f0",
                border:"none", borderRadius: 2, padding:"3px 8px", cursor:"pointer",
                textTransform:"uppercase", letterSpacing:"0.06em", opacity: actionLoading ? 0.5 : 1,
              }}
            >
              {actionLoading ? "..." : actionLabel}
            </button>
          )}
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#333" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ padding:"12px 0 16px", display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap: 16, borderTop:"1px solid #0d0d0d" }}>
          <div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#333", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom: 10 }}>Attributes</div>
            <AttrBar label="Scoring"    value={player.scoring} />
            <AttrBar label="Efficiency" value={player.efficiency} />
            <AttrBar label="Playmaking" value={player.playmaking} />
            <AttrBar label="Rebounding" value={player.rebounding} />
            <AttrBar label="Defense"    value={player.defense} />
            <AttrBar label="Composure"  value={player.composure} />
          </div>
          <div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#333", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom: 10 }}>Season Averages</div>
            {[["PPG",player.ppg],["RPG",player.rpg],["APG",player.apg],["MPG",player.mpg],["GP",player.gp]].map(([l,v]) => (
              <div key={l} style={{ display:"flex", justifyContent:"space-between", marginBottom: 5 }}>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#555" }}>{l}</span>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 11, color:"#888" }}>{typeof v === "number" ? v.toFixed(1) : v}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#333", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom: 10 }}>Contract</div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 11, color:"#888", marginBottom: 5 }}>{fmt$$(player.salary)}/yr</div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#555" }}>{player.years_left} yr{player.years_left !== 1 ? "s" : ""} remaining</div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#444", marginTop: 8 }}>
              Total: {fmt$$(player.salary * player.years_left)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Table Header ─────────────────────────────────────────────────────────────

function RosterHeader() {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 60px 60px 60px 60px 60px 100px", gap: 8, padding:"8px 0", borderBottom:"1px solid #111" }}>
      {["Player","PPG","RPG","APG","OVR","Salary",""].map((h,i) => (
        <div key={i} style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#333", textTransform:"uppercase", letterSpacing:"0.08em", textAlign: i > 0 ? "right" : "left" }}>
          {h}
        </div>
      ))}
    </div>
  );
}

// ─── Standings Table ──────────────────────────────────────────────────────────

function StandingsTable({ teams, title, gmTeam }: { teams: TeamRow[]; title: string; gmTeam: string }) {
  return (
    <div>
      <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#333", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom: 10, borderBottom:"1px solid #111", paddingBottom: 8 }}>
        {title}
      </div>
      {teams.map((t, i) => (
        <div key={t.abbr} style={{
          display:"grid", gridTemplateColumns:"24px 1fr 40px 40px 60px",
          gap: 8, padding:"7px 0", borderBottom:"1px solid #0d0d0d",
          background: t.abbr === gmTeam ? "#0a0a0a" : "transparent",
        }}>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 10, color:"#333" }}>{i + 1}</span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 10, color: t.abbr === gmTeam ? "#f0f0f0" : "#666" }}>
            {t.abbr === gmTeam ? "▶ " : ""}{t.abbr}
          </span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 10, color:"#888", textAlign:"right" }}>{t.wins}</span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 10, color:"#555", textAlign:"right" }}>{t.losses}</span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 10, color:"#444", textAlign:"right" }}>{t.pct.toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main GM Dashboard ────────────────────────────────────────────────────────

function GMDashboard({ saveId }: { saveId: string }) {
  const [tab, setTab]             = useState<"roster"|"standings"|"fa">("roster");
  const [state, setState]         = useState<GMState | null>(null);
  const [roster, setRoster]       = useState<Player[]>([]);
  const [standings, setStandings] = useState<{east:TeamRow[];west:TeamRow[];gm_team:string} | null>(null);
  const [fa, setFa]               = useState<Player[]>([]);
  const [simDays, setSimDays]     = useState(7);
  const [simming, setSimming]     = useState(false);
  const [signing, setSigning]     = useState<string | null>(null);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const [toast, setToast]         = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadState = useCallback(async () => {
    const [s, r, st] = await Promise.all([
      fetch(`${API}/gm/state/${saveId}`).then(r => r.json()),
      fetch(`${API}/gm/roster/${saveId}`).then(r => r.json()),
      fetch(`${API}/gm/standings/${saveId}`).then(r => r.json()),
    ]);
    setState(s);
    setRoster(r.roster || []);
    setStandings(st);
    setLoading(false);
  }, [saveId]);

  const loadFA = useCallback(async () => {
    const data = await fetch(`${API}/gm/free-agents/${saveId}?limit=60`).then(r => r.json());
    setFa(data.free_agents || []);
  }, [saveId]);

  useEffect(() => { loadState(); }, [loadState]);
  useEffect(() => { if (tab === "fa") loadFA(); }, [tab, loadFA]);

  async function handleSim() {
    setSimming(true);
    try {
      const res = await fetch(`${API}/gm/simulate/${saveId}`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ days: simDays }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail);
      setStandings({ east: data.standings.east, west: data.standings.west, gm_team: state!.gm_team });
      await loadState();
      showToast(`Simulated ${simDays} day${simDays > 1 ? "s" : ""}. Record: ${data.your_record}`);
    } finally {
      setSimming(false);
    }
  }

  async function handleSign(playerId: string) {
    setSigning(playerId);
    try {
      const res = await fetch(`${API}/gm/sign/${saveId}`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ player_id: playerId }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.detail); return; }
      showToast(`Signed ${data.signed} for ${fmt$$(data.salary)}/yr`);
      await Promise.all([loadState(), loadFA()]);
    } finally {
      setSigning(null);
    }
  }

  async function handleRelease(playerId: string) {
    setReleasing(playerId);
    try {
      const res = await fetch(`${API}/gm/release/${saveId}`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ player_id: playerId }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.detail); return; }
      showToast(`Released player. Cap freed: ${fmt$$(data.cap_freed)}`);
      await loadState();
    } finally {
      setReleasing(null);
    }
  }

  if (loading || !state) {
    return (
      <div style={{ minHeight:"100vh", background:"#000", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 11, color:"#333", letterSpacing:"0.1em" }}>
          LOADING LEAGUE...
        </div>
      </div>
    );
  }

  const capPct = Math.round((state.cap_used / CAP) * 100);
  const overLux = state.cap_used > LUX;

  const TABS = [
    { id:"roster", label:"Roster" },
    { id:"standings", label:"Standings" },
    { id:"fa", label:"Free Agents" },
  ] as const;

  return (
    <div style={{ minHeight:"100vh", background:"#000", color:"#f0f0f0" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:translateY(0) } }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{
          position:"fixed", bottom: 24, left:"50%", transform:"translateX(-50%)",
          background:"#111", border:"1px solid #222", borderRadius: 4,
          padding:"10px 20px", fontFamily:"'DM Mono',monospace", fontSize: 11, color:"#f0f0f0",
          zIndex: 1000, animation:"fadeIn 0.2s ease",
        }}>
          {toast}
        </div>
      )}

      {/* Top Bar */}
      <div style={{ background:"rgba(0,0,0,0.95)", borderBottom:"1px solid #111", padding:"0 32px", height: 48, display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top: 0, zIndex: 100 }}>
        <div style={{ display:"flex", alignItems:"center", gap: 20 }}>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 11, fontWeight: 700, color:"#f0f0f0", letterSpacing:"0.05em" }}>SWINGFACTR</span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#333" }}>/</span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#555", textTransform:"uppercase", letterSpacing:"0.1em" }}>GM MODE</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap: 24 }}>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 10, color:"#888" }}>
            {state.gm_team} · {state.wins}-{state.losses} · #{state.conf_rank} {state.conference}
          </span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 10, color: overLux ? "#ff4444" : "#555" }}>
            {fmt$$(state.cap_used)} / {fmt$$(CAP)}
          </span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#333" }}>
            Day {state.day} · Season {state.season}
          </span>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin:"0 auto", padding:"40px 32px" }}>

        {/* Header Stats */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap: 1, marginBottom: 32, background:"#111", borderRadius: 6, overflow:"hidden" }}>
          {[
            { label:"Record", value:`${state.wins}-${state.losses}` },
            { label:"Conf Rank", value:`#${state.conf_rank} ${state.conference}` },
            { label:"Cap Used", value: fmt$$(state.cap_used) },
            { label:"Cap Space", value: fmt$$(Math.max(0, state.cap_space)), alert: state.cap_space < 5_000_000 },
            { label:"Games Simmed", value: state.games_simmed.toString() },
          ].map(card => (
            <div key={card.label} style={{ background:"#000", padding:"16px 20px" }}>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#333", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom: 6 }}>{card.label}</div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 16, color: (card as any).alert ? "#ff8800" : "#f0f0f0", fontWeight: 600 }}>
                {card.value}
              </div>
            </div>
          ))}
        </div>

        {/* Cap Bar */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom: 6 }}>
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#333", textTransform:"uppercase", letterSpacing:"0.08em" }}>Salary Cap Usage</span>
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color: overLux ? "#ff4444" : "#555" }}>
              {capPct}% {overLux ? "· OVER LUXURY TAX" : ""}
            </span>
          </div>
          <CapBar used={state.cap_used} cap={CAP} />
          <div style={{ display:"flex", justifyContent:"space-between", marginTop: 4 }}>
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 8, color:"#222" }}>{fmt$$(CAP)} cap</span>
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 8, color:"#222" }}>{fmt$$(LUX)} luxury</span>
          </div>
        </div>

        {/* Sim Controls */}
        <div style={{ display:"flex", alignItems:"center", gap: 12, marginBottom: 36, padding:"16px 20px", background:"#080808", border:"1px solid #111", borderRadius: 4 }}>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#444", textTransform:"uppercase", letterSpacing:"0.1em" }}>Simulate</span>
          {[1,7,14,30].map(d => (
            <button key={d} onClick={() => setSimDays(d)} style={{
              fontFamily:"'DM Mono',monospace", fontSize: 10,
              background: simDays === d ? "#f0f0f0" : "transparent",
              color: simDays === d ? "#000" : "#555",
              border:`1px solid ${simDays === d ? "#f0f0f0" : "#222"}`,
              borderRadius: 3, padding:"4px 10px", cursor:"pointer",
            }}>
              {d}d
            </button>
          ))}
          <button
            onClick={handleSim}
            disabled={simming}
            style={{
              fontFamily:"'DM Mono',monospace", fontSize: 10, fontWeight: 600,
              background:"#f0f0f0", color:"#000", border:"none", borderRadius: 3,
              padding:"6px 16px", cursor: simming ? "not-allowed" : "pointer",
              marginLeft: 8, opacity: simming ? 0.6 : 1, letterSpacing:"0.06em",
              display:"flex", alignItems:"center", gap: 6,
            }}
          >
            {simming && <div style={{ width: 10, height: 10, border:"1.5px solid #888", borderTopColor:"#000", borderRadius:"50%", animation:"spin 0.7s linear infinite" }} />}
            {simming ? "SIMULATING..." : "SIM GAMES"}
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap: 0, borderBottom:"1px solid #111", marginBottom: 24 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              fontFamily:"'DM Mono',monospace", fontSize: 10, textTransform:"uppercase", letterSpacing:"0.1em",
              background:"transparent", border:"none", borderBottom: tab === t.id ? "1px solid #f0f0f0" : "1px solid transparent",
              color: tab === t.id ? "#f0f0f0" : "#444",
              padding:"10px 20px", cursor:"pointer", marginBottom: -1,
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Roster Tab */}
        {tab === "roster" && (
          <div style={{ animation:"fadeIn 0.2s ease" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: 16 }}>
              <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#333" }}>
                {roster.length}/15 PLAYERS · {fmt$$(roster.reduce((s,p) => s + p.salary, 0))} TOTAL
              </span>
              <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#333" }}>CLICK ROW FOR DETAIL</span>
            </div>
            <RosterHeader />
            {roster.length === 0 ? (
              <div style={{ padding:"40px 0", fontFamily:"'DM Mono',monospace", fontSize: 11, color:"#333", textAlign:"center" }}>
                NO PLAYERS ON ROSTER
              </div>
            ) : roster.map(p => (
              <PlayerRow
                key={p.id} player={p}
                action actionLabel="RELEASE"
                actionLoading={releasing === p.id}
                onAction={() => handleRelease(p.id)}
              />
            ))}
          </div>
        )}

        {/* Standings Tab */}
        {tab === "standings" && standings && (
          <div style={{ animation:"fadeIn 0.2s ease", display:"grid", gridTemplateColumns:"1fr 1fr", gap: 40 }}>
            <StandingsTable teams={standings.east} title="Eastern Conference" gmTeam={state.gm_team} />
            <StandingsTable teams={standings.west} title="Western Conference" gmTeam={state.gm_team} />
          </div>
        )}

        {/* FA Tab */}
        {tab === "fa" && (
          <div style={{ animation:"fadeIn 0.2s ease" }}>
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#333" }}>
                {fa.length} FREE AGENTS AVAILABLE · {roster.length}/15 ROSTER SPOTS USED
              </span>
            </div>
            <RosterHeader />
            {fa.map(p => (
              <PlayerRow
                key={p.id} player={p}
                action={roster.length < 15}
                actionLabel="SIGN"
                actionLoading={signing === p.id}
                onAction={() => handleSign(p.id)}
              />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Root Page ─────────────────────────────────────────────────────────────────

export default function GMPage() {
  const [saveId, setSaveId] = useState<string | null>(null);
  const [initDone, setInitDone] = useState(false);

  useEffect(() => {
    // Check for existing save
    const existingSave = localStorage.getItem("gm_save_id");
    if (existingSave) setSaveId(existingSave);
    setInitDone(true);

    fetch(`${API}/gm/init-db`, { method: "POST" }).catch(() => {});
  }, []);

  if (!initDone) return null;

  if (!saveId) {
    return <FranchiseSelect onSelect={(id) => setSaveId(id)} />;
  }

  return (
    <div>
      <GMDashboard saveId={saveId} />
      <div style={{ textAlign:"center", padding:"20px 0 40px", borderTop:"1px solid #0d0d0d" }}>
        <button
          onClick={() => {
            localStorage.removeItem("gm_save_id");
            localStorage.removeItem("gm_team");
            setSaveId(null);
          }}
          style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color:"#333", background:"transparent", border:"none", cursor:"pointer", textTransform:"uppercase", letterSpacing:"0.1em" }}
        >
          Start New Game
        </button>
      </div>
    </div>
  );
}
