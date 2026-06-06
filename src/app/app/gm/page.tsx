"use client";
import { useState, useEffect, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "https://swingfactr-production.up.railway.app";
const SALARY_CAP = 140_000_000;
const LUXURY_TAX = 170_000_000;

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
  conf_rank: number | string; conference: string; day: number; season: number; games_simmed: number;
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

const DRAFT_PROSPECTS = [
  {rank:1,name:"Cooper Flagg",pos:"F",age:18,school:"Duke",ovr:91,note:"Elite two-way forward, near-certain #1"},
  {rank:2,name:"Ace Bailey",pos:"F",age:18,school:"Rutgers",ovr:87,note:"Explosive scorer, high upside"},
  {rank:3,name:"Dylan Harper",pos:"G",age:19,school:"Rutgers",ovr:85,note:"Playmaking guard, ready now"},
  {rank:4,name:"VJ Edgecombe",pos:"G",age:19,school:"Baylor",ovr:82,note:"Athletic wing, defensive upside"},
  {rank:5,name:"Tre Johnson",pos:"G",age:19,school:"Texas",ovr:80,note:"Elite scorer, shot creator"},
  {rank:6,name:"Nolan Traore",pos:"G",age:19,school:"France",ovr:78,note:"French point guard, crafty passer"},
  {rank:7,name:"Kon Knueppel",pos:"F",age:19,school:"Duke",ovr:76,note:"Shooter with high IQ"},
  {rank:8,name:"Egor Demin",pos:"G",age:18,school:"BYU",ovr:74,note:"Versatile playmaker, raw"},
  {rank:9,name:"Jeremiah Fears",pos:"G",age:18,school:"Oklahoma",ovr:72,note:"Shifty guard, shot needs work"},
  {rank:10,name:"Khaman Maluach",pos:"C",age:18,school:"Duke",ovr:70,note:"Rim protector, mobile big"},
  {rank:11,name:"Collin Murray-Boyles",pos:"F",age:19,school:"South Carolina",ovr:68,note:"Versatile defender"},
  {rank:12,name:"Nique Clifford",pos:"F",age:22,school:"Colorado St",ovr:65,note:"Ready-now wing, consistent"},
  {rank:13,name:"Will Riley",pos:"F",age:19,school:"Illinois",ovr:63,note:"Long wing, developing scorer"},
  {rank:14,name:"Johni Broome",pos:"C",age:23,school:"Auburn",ovr:62,note:"Productive big, older prospect"},
  {rank:15,name:"Thomas Sorber",pos:"C",age:19,school:"Georgetown",ovr:60,note:"Modern big, stretch potential"},
];

const TEAM_PICKS: Record<string, {round:number,from?:string,note:string}[]> = {
  ATL:[{round:1,note:"Own pick"},{round:2,note:"Own pick"}],
  BOS:[{round:1,from:"BKN",note:"Via BKN"},{round:2,note:"Own pick"}],
  BKN:[{round:2,note:"Own pick"}],
  CHA:[{round:1,note:"Own pick (lottery)"},{round:2,note:"Own pick"}],
  CHI:[{round:1,note:"Own pick (lottery)"},{round:2,note:"Own pick"}],
  CLE:[{round:1,note:"Own pick"},{round:2,note:"Own pick"}],
  DAL:[{round:1,note:"Own pick"},{round:2,note:"Own pick"}],
  DEN:[{round:1,note:"Own pick"},{round:2,note:"Own pick"}],
  DET:[{round:1,note:"Own pick (lottery)"},{round:2,note:"Own pick"}],
  GS:[{round:1,note:"Own pick"},{round:2,note:"Own pick"}],
  HOU:[{round:1,note:"Own pick"},{round:1,from:"BKN",note:"Via BKN"},{round:2,note:"Own pick"}],
  IND:[{round:1,note:"Own pick"},{round:2,note:"Own pick"}],
  LAC:[{round:1,note:"Own pick"},{round:2,note:"Own pick"}],
  LAL:[{round:1,note:"Own pick"},{round:2,note:"Own pick"}],
  MEM:[{round:1,note:"Own pick (lottery)"},{round:2,note:"Own pick"}],
  MIA:[{round:1,note:"Own pick"},{round:2,note:"Own pick"}],
  MIL:[{round:1,note:"Own pick"},{round:2,note:"Own pick"}],
  MIN:[{round:1,note:"Own pick"},{round:2,note:"Own pick"}],
  NO:[{round:1,note:"Own pick (lottery)"},{round:2,note:"Own pick"}],
  NY:[{round:2,note:"Own pick"}],
  OKC:[{round:1,note:"Own pick"},{round:1,from:"HOU",note:"Via HOU"},{round:2,note:"Own pick"}],
  ORL:[{round:1,note:"Own pick"},{round:2,note:"Own pick"}],
  PHI:[{round:1,note:"Own pick (lottery)"},{round:2,note:"Own pick"}],
  PHX:[{round:1,note:"Own pick (lottery)"},{round:2,note:"Own pick"}],
  POR:[{round:1,note:"Own pick (lottery)"},{round:2,note:"Own pick"}],
  SA:[{round:1,note:"Own pick"},{round:2,note:"Own pick"}],
  SAC:[{round:1,note:"Own pick"},{round:2,note:"Own pick"}],
  TOR:[{round:1,note:"Own pick (lottery)"},{round:2,note:"Own pick"}],
  UTAH:[{round:1,note:"Own pick (lottery)"},{round:2,note:"Own pick"}],
  WSH:[{round:1,note:"Own pick (lottery)"},{round:2,note:"Own pick"}],
};

const SEASON_RESULTS: Record<string,{w:number,l:number,result:string,note:string}> = {
  ATL:{w:47,l:35,result:"Lost R1",note:"Lost to NY Knicks in R1. Knicks set NBA record 47-point halftime lead in Game 6."},
  BOS:{w:52,l:30,result:"Lost R1",note:"Blew a 3-1 series lead to Philadelphia 76ers. Historic collapse for the defending champs."},
  BKN:{w:24,l:58,result:"Missed playoffs",note:"Missed playoffs for third straight season. Full rebuild mode."},
  CHA:{w:28,l:54,result:"Missed playoffs",note:"Tenth consecutive missed playoff. Longest active drought in the NBA."},
  CHI:{w:26,l:56,result:"Missed playoffs",note:"Missed playoffs for fourth straight season."},
  CLE:{w:55,l:27,result:"Lost ECF",note:"Swept by NY Knicks 4-0 in Eastern Conference Finals."},
  DAL:{w:30,l:52,result:"Missed playoffs",note:"Missed playoffs for second straight season."},
  DEN:{w:45,l:37,result:"Lost R1",note:"Lost to SA Spurs in Round 1. Eight-year playoff streak ends."},
  DET:{w:57,l:25,result:"Lost R2",note:"1-seed. Overcame 3-1 deficit vs Orlando in R1. Lost to Cleveland in second round."},
  GS:{w:33,l:49,result:"Missed playoffs",note:"Play-in exit. Lost to LA Clippers in play-in elimination game."},
  HOU:{w:48,l:34,result:"Lost R1",note:"Lost to OKC in R1. Blew a 6-point lead in final 30 seconds of regulation."},
  IND:{w:38,l:44,result:"Missed playoffs",note:"Missed playoffs for first time since 2023. Defending Eastern Conference champs."},
  LAC:{w:29,l:53,result:"Missed playoffs",note:"Missed playoffs for first time since 2022. Play-in exit."},
  LAL:{w:44,l:38,result:"Lost R2",note:"Lost to SA Spurs in second round. Blew 3-1 lead — only second time in franchise history."},
  MEM:{w:27,l:55,result:"Missed playoffs",note:"Missed playoffs for second straight season. Young core still developing."},
  MIA:{w:31,l:51,result:"Missed playoffs",note:"Missed playoffs for first time since 2019. Play-in loss to Charlotte."},
  MIL:{w:28,l:54,result:"Missed playoffs",note:"Missed playoffs for first time since 2016."},
  MIN:{w:46,l:36,result:"Lost R2",note:"Lost to OKC in second round. Advanced as 6-seed for second straight season."},
  NO:{w:22,l:60,result:"Missed playoffs",note:"Missed playoffs for second straight season. Lottery team."},
  NY:{w:50,l:32,result:"NBA Finals",note:"In NBA Finals vs SA Spurs. Won Game 1 105-95. 12-game playoff win streak. Seeking first title since 1973."},
  OKC:{w:68,l:14,result:"Lost WCF",note:"Best record in NBA for second straight year. Lost to SA Spurs 4-3 in 7-game WCF thriller."},
  ORL:{w:44,l:38,result:"Lost R1",note:"Lost to Detroit after blowing a 3-1 series lead. Pistons ended 11-game playoff home losing streak."},
  PHI:{w:35,l:47,result:"Lost R2",note:"Play-in team. Shocked Boston 4-3 overcoming 3-1 deficit in R1. Lost to Cleveland in second round."},
  PHX:{w:32,l:50,result:"Missed playoffs",note:"Play-in exit. Lost to Portland Trail Blazers in play-in elimination game."},
  POR:{w:36,l:46,result:"Lost R1",note:"Won play-in vs PHX. Swept by OKC Thunder in Round 1."},
  SA:{w:62,l:20,result:"NBA Finals",note:"In NBA Finals vs NY Knicks. Beat OKC in 7 epic games in WCF. Wembanyama leads all players in rebounds this postseason."},
  SAC:{w:30,l:52,result:"Missed playoffs",note:"Missed playoffs for third consecutive season."},
  TOR:{w:38,l:44,result:"Lost R1",note:"Lost to Cleveland in R1. Cavaliers tied record with 12 straight playoff wins vs Toronto."},
  UTAH:{w:20,l:62,result:"Missed playoffs",note:"Near-lottery record. Full rebuild underway."},
  WSH:{w:18,l:64,result:"Missed playoffs",note:"Fifth straight missed playoffs. One of worst records in the league."},
};

function fmt$(n: number) {
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n/1_000).toFixed(0)}K`;
  return `$${n}`;
}
function attrColor(v: number) {
  if (v >= 75) return "#f0f0f0";
  if (v >= 50) return "#888";
  return "#888";
}
function resultColor(r: string) {
  if (r === "NBA Champions") return "#f0f0f0";
  if (r === "NBA Finals") return "#777";
  if (r.includes("Lost")) return "#888";
  return "#555";
}
function getPickNumber(abbr: string): number {
  const lottery = ["WSH","UTAH","NO","CHA","TOR","MEM","POR","BKN","PHI","CHI","MIL","GS","PHX","SAC","MIA","DAL","IND","LAC"];
  const idx = lottery.indexOf(abbr);
  if (idx >= 0) return idx + 1;
  const playoff = ["DEN","ATL","ORL","DET","CLE","LAL","MIN","HOU","BOS","NY","OKC","SA"];
  const pidx = playoff.indexOf(abbr);
  return pidx >= 0 ? 19 + pidx : 22;
}
function getOffseasonGoals(state: GMState, roster: Player[], result: any): string[] {
  const goals: string[] = [];
  const capSpace = SALARY_CAP - state.cap_used;
  const stars = roster.filter(p => p.overall >= 50);
  const hasCenter = roster.some(p => p.position === "C" && p.overall >= 38);
  const hasPlaymaker = roster.some(p => p.playmaking >= 55);
  if (!stars.length) goals.push("Find a franchise cornerstone. The roster lacks an impact player to build around.");
  if (capSpace > 20_000_000) goals.push(`${fmt$(capSpace)} in cap space. Use it aggressively this offseason.`);
  if (!hasCenter) goals.push("Upgrade at center. Frontcourt depth is a weakness opponents will target.");
  if (!hasPlaymaker) goals.push("Add a legitimate playmaker. The roster needs a true shot creator.");
  if (result?.result?.includes("Lost R1")) goals.push("Address what broke down in the first round. Target those specific weaknesses.");
  if (result?.result === "Missed playoffs") goals.push("Make the playoffs. Set a clear direction and commit to it.");
  if (roster.length < 12) goals.push("Fill the roster. You need depth to survive 82 games.");
  if (goals.length < 3) goals.push("Extend your core before they hit free agency next summer.");
  return goals.slice(0, 4);
}

// ─── Franchise Select ─────────────────────────────────────────────────────────
function FranchiseSelect({ onSelect }: { onSelect: (saveId: string, abbr: string) => void }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [hov, setHov] = useState<string | null>(null);
  const east = NBA_TEAMS.filter(t => t.conf === "East");
  const west = NBA_TEAMS.filter(t => t.conf === "West");

  async function handleSelect(abbr: string) {
    setLoading(abbr);
    try {
      const res = await fetch(`${API}/gm/new-game`, {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({team_abbr: abbr}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed");
      localStorage.setItem("gm_save_id", data.save_id);
      localStorage.setItem("gm_team", abbr);
      onSelect(data.save_id, abbr);
    } catch(e: any) {
      console.error("new-game error:", e.message);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div style={{minHeight:"100vh",background:"#000",padding:"56px 40px"}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{maxWidth:960,margin:"0 auto"}}>
        <div style={{marginBottom:48}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:14}}>SWINGFACTR / GM MODE / 2026 OFFSEASON</div>
          <h1 style={{fontFamily:"Inter,sans-serif",fontSize:40,fontWeight:300,color:"#f0f0f0",lineHeight:1.1,margin:0}}>
            Choose your<br /><strong style={{fontWeight:700}}>franchise.</strong>
          </h1>
          <p style={{fontFamily:"Inter,sans-serif",fontSize:13,color:"#666",marginTop:14,maxWidth:460}}>
            Real 2025-26 rosters derived from actual game logs. SA Spurs are your defending champions.
          </p>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:48}}>
          {[{label:"Eastern Conference",teams:east},{label:"Western Conference",teams:west}].map(conf => (
            <div key={conf.label}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#888",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:10,borderBottom:"1px solid #222",paddingBottom:8}}>{conf.label}</div>
              <div style={{display:"flex",flexDirection:"column",gap:3}}>
                {conf.teams.map(t => {
                  const result = SEASON_RESULTS[t.abbr];
                  const isHov = hov === t.abbr;
                  const isLoading = loading === t.abbr;
                  return (
                    <button key={t.abbr} onClick={() => handleSelect(t.abbr)}
                      onMouseEnter={() => setHov(t.abbr)} onMouseLeave={() => setHov(null)}
                      disabled={!!loading}
                      style={{background:isHov?"#0a0a0a":"transparent",border:`1px solid ${isHov?"#888":"#888"}`,borderRadius:3,padding:"9px 14px",cursor:loading?"not-allowed":"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",transition:"all 0.12s",opacity:loading&&!isLoading?0.4:1,width:"100%"}}>
                      <div style={{textAlign:"left"}}>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#888",textTransform:"uppercase",letterSpacing:"0.08em"}}>{t.abbr}</div>
                        <div style={{fontFamily:"Inter,sans-serif",fontSize:12,color:isHov?"#f0f0f0":"#555",marginTop:2}}>{t.name}</div>
                      </div>
                      <div style={{textAlign:"right",display:"flex",alignItems:"center",gap:10}}>
                        {result && <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:resultColor(result.result)}}>{result.result}</div>}
                        {isLoading && <div style={{width:10,height:10,border:"1px solid #333",borderTopColor:"#888",borderRadius:"50%",animation:"spin 0.8s linear infinite"}} />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Top Bar ──────────────────────────────────────────────────────────────────
function TopBar({state, section, onNav, onNewGame}: {state:GMState; section:string; onNav:(s:string)=>void; onNewGame:()=>void}) {
  const NAV = ["HOME","ROSTER","STANDINGS","DRAFT","TRADE","FREE AGENTS"];
  return (
    <div style={{background:"rgba(0,0,0,0.97)",borderBottom:"1px solid #222",height:48,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 28px",position:"sticky",top:0,zIndex:200}}>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,color:"#f0f0f0"}}>SWINGFACTR</span>
        <span style={{color:"#888"}}>/ GM /</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#666"}}>{state.gm_team}</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#666"}}>{state.wins}-{state.losses}</span>
      </div>
      <div style={{display:"flex",gap:2}}>
        {NAV.map(n => (
          <button key={n} onClick={() => onNav(n)} style={{fontFamily:"'DM Mono',monospace",fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",background:"transparent",border:"none",borderBottom:section===n?"1px solid #888":"1px solid transparent",color:section===n?"#f0f0f0":"#555",padding:"4px 10px",cursor:"pointer"}}>{n}</button>
        ))}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555"}}>{fmt$(state.cap_used)} / $140M</span>
        <button onClick={onNewGame} style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",background:"transparent",border:"none",cursor:"pointer",textTransform:"uppercase"}}>NEW GAME</button>
      </div>
    </div>
  );
}

// ─── Home Section ─────────────────────────────────────────────────────────────
function HomeSection({state, roster, onNav}: {state:GMState; roster:Player[]; onNav:(s:string)=>void}) {
  const result = SEASON_RESULTS[state.gm_team];
  const picks = TEAM_PICKS[state.gm_team] || [];
  const pickNum = picks.some(p => p.round===1) ? getPickNumber(state.gm_team) : null;
  const stars = [...roster].sort((a,b) => b.overall-a.overall).slice(0,3);  // show top 3 regardless of rating
  const capSpace = SALARY_CAP - state.cap_used;
  const capPct = Math.min((state.cap_used/SALARY_CAP)*100, 100);

  function getNarrative() {
    if (result?.result === "NBA Champions") return "You are the defending champions. SA Spurs, NBA champions. Every contender is gunning for you this offseason.";
    if (result?.result === "NBA Finals") return "A Finals run. Close, but not enough. The core is proven — now you need the last piece.";
    if (result?.result?.includes("Lost R2")) return "A second round exit. Real pieces exist here. This offseason is about finding what the roster is missing.";
    if (result?.result?.includes("Lost R1")) return "A first round exit. Playoff experience gained, but serious questions about the ceiling of this group.";
    return "A difficult season. The front office faces a real decision: reload around the current core, or blow it up entirely.";
  }

  const goals = getOffseasonGoals(state, roster, result);
  const relevantProspects = pickNum ? DRAFT_PROSPECTS.filter(p => Math.abs(p.rank-pickNum)<=2) : DRAFT_PROSPECTS.slice(0,3);

  return (
    <div style={{maxWidth:1100,margin:"0 auto",padding:"40px 32px"}}>
      {/* Season banner */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:1,background:"#0d0d0d",borderRadius:4,overflow:"hidden",marginBottom:32}}>
        {[
          {label:"2025-26 Record",value:`${result?.w??state.wins}-${result?.l??state.losses}`},
          {label:"Season Result",value:result?.result??"—",hi:result?.result==="NBA Champions"},
          {label:"Cap Committed",value:fmt$(state.cap_used)},
          {label:"Cap Space",value:fmt$(Math.max(0,capSpace)),warn:capSpace<5_000_000},
        ].map(c => (
          <div key={c.label} style={{background:"#000",padding:"18px 22px"}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>{c.label}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:18,fontWeight:600,color:(c as any).hi?"#f0f0f0":(c as any).warn?"#ff8800":"#666"}}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Cap bar */}
      <div style={{marginBottom:40}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.08em"}}>Salary Cap</span>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:capPct>90?"#ff8800":"#666"}}>{Math.round(capPct)}%</span>
        </div>
        <div style={{height:2,background:"#888",borderRadius:1}}>
          <div style={{height:"100%",width:`${capPct}%`,background:capPct>90?"#ff8800":"#666",borderRadius:1,transition:"width 0.5s"}} />
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#888"}}>$140M cap</span>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#888"}}>$170M luxury tax</span>
        </div>
      </div>

      <p style={{fontFamily:"Inter,sans-serif",fontSize:14,color:"#555",lineHeight:1.7,maxWidth:640,marginBottom:8}}>{getNarrative()}</p>
      {result?.note && <p style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#555",marginBottom:40}}>{result.note}</p>}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20,marginTop:8}}>
        {/* Core Players */}
        <div style={{border:"1px solid #222",borderRadius:4,padding:"18px"}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:16}}>Core Players</div>
          {stars.length===0 && <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#888"}}>No standout players yet</div>}
          {stars.map(p => (
            <div key={p.id} style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <span style={{fontFamily:"Inter,sans-serif",fontSize:12,color:"#e0e0e0"}}>{p.name}</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:attrColor(p.overall)}}>{p.overall} OVR</span>
              </div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#666"}}>{p.archetype} · {p.ppg.toFixed(1)} PPG · {fmt$(p.salary)}/yr</div>
              <div style={{height:1,background:"#0d0d0d",marginTop:10}} />
            </div>
          ))}
          <button onClick={()=>onNav("ROSTER")} style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",background:"transparent",border:"none",cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.08em",marginTop:6}}>FULL ROSTER →</button>
        </div>

        {/* Draft */}
        <div style={{border:"1px solid #222",borderRadius:4,padding:"18px"}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:16}}>2026 Draft</div>
          {picks.map((pick,i) => (
            <div key={i} style={{marginBottom:10}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:pick.round===1?"#666":"#666",marginBottom:2}}>
                Round {pick.round}{pickNum&&pick.round===1?` · Est. #${pickNum}`:""}{pick.from?` · via ${pick.from}`:""}
              </div>
              <div style={{height:1,background:"#0d0d0d",marginTop:8}} />
            </div>
          ))}
          {picks.length===0 && <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#888",marginBottom:12}}>No picks in 2026 draft</div>}
          <div style={{marginTop:8}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#888",textTransform:"uppercase",marginBottom:8}}>Prospects in range</div>
            {relevantProspects.slice(0,4).map(p => (
              <div key={p.rank} style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontFamily:"Inter,sans-serif",fontSize:11,color:pickNum&&p.rank===pickNum?"#e0e0e0":"#666"}}>
                  #{p.rank} {p.name}{pickNum&&p.rank===pickNum?" ◀":""}
                </span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555"}}>{p.pos}</span>
              </div>
            ))}
          </div>
          <button onClick={()=>onNav("DRAFT")} style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",background:"transparent",border:"none",cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.08em",marginTop:8}}>FULL DRAFT BOARD →</button>
        </div>

        {/* Priorities */}
        <div style={{border:"1px solid #222",borderRadius:4,padding:"18px"}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:16}}>Offseason Priorities</div>
          {goals.map((goal,i) => (
            <div key={i} style={{marginBottom:14}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#888",marginBottom:4}}>0{i+1}</div>
              <div style={{fontFamily:"Inter,sans-serif",fontSize:12,color:"#555",lineHeight:1.5}}>{goal}</div>
              <div style={{height:1,background:"#0d0d0d",marginTop:10}} />
            </div>
          ))}
          <button onClick={()=>onNav("TRADE")} style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",background:"transparent",border:"none",cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.08em",marginTop:4}}>TRADE MACHINE →</button>
        </div>
      </div>
    </div>
  );
}

// ─── Roster Section ───────────────────────────────────────────────────────────
function RosterSection({saveId, roster, state, onRosterChange}: {saveId:string; roster:Player[]; state:GMState; onRosterChange:()=>void}) {
  const [expanded, setExpanded] = useState<string|null>(null);
  const [releasing, setReleasing] = useState<string|null>(null);
  const [toast, setToast] = useState<string|null>(null);

  async function handleRelease(p: Player) {
    setReleasing(p.id);
    try {
      const res = await fetch(`${API}/gm/release/${saveId}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({player_id:p.id})});
      const data = await res.json();
      if (!res.ok) { setToast(data.detail); return; }
      setToast(`Released ${p.name}`);
      onRosterChange();
    } finally {
      setReleasing(null);
      setTimeout(()=>setToast(null),2500);
    }
  }

  return (
    <div style={{maxWidth:1100,margin:"0 auto",padding:"40px 32px"}}>
      {toast && <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"#111",border:"1px solid #1a1a1a",borderRadius:4,padding:"10px 20px",fontFamily:"'DM Mono',monospace",fontSize:11,color:"#f0f0f0",zIndex:1000}}>{toast}</div>}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:6}}>ROSTER</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#888"}}>{roster.length}/15 players · {fmt$(roster.reduce((s,p)=>s+p.salary,0))} committed</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 50px 50px 50px 50px 40px 90px 70px",gap:8,padding:"8px 0",borderBottom:"1px solid #222"}}>
        {["Player","PPG","RPG","APG","OVR","AGE","Salary",""].map((h,i)=>(
          <div key={i} style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#888",textTransform:"uppercase",letterSpacing:"0.08em",textAlign:i>0?"right":"left"}}>{h}</div>
        ))}
      </div>
      {roster.map(p=>(
        <div key={p.id} style={{borderBottom:"1px solid #1a1a1a"}}>
          <div onClick={()=>setExpanded(expanded===p.id?null:p.id)} style={{display:"grid",gridTemplateColumns:"1fr 50px 50px 50px 50px 40px 90px 70px",gap:8,padding:"10px 0",cursor:"pointer",alignItems:"center"}}>
            <div>
              <div style={{fontFamily:"Inter,sans-serif",fontSize:12,color:"#e0e0e0"}}>{p.name}</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",marginTop:2}}>{p.position} · {p.archetype}</div>
            </div>
            {[p.ppg,p.rpg,p.apg].map((v,i)=>(
              <div key={i} style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#555",textAlign:"right"}}>{v.toFixed(1)}</div>
            ))}
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:attrColor(p.overall),textAlign:"right",fontWeight:600}}>{p.overall}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#888",textAlign:"right"}}>{p.age}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#666",textAlign:"right"}}>{fmt$(p.salary)}</div>
            <div style={{display:"flex",justifyContent:"flex-end",gap:6,alignItems:"center"}}>
              <button onClick={e=>{e.stopPropagation();handleRelease(p);}} disabled={releasing===p.id} style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#555",background:"transparent",border:"1px solid #222",borderRadius:2,padding:"2px 6px",cursor:"pointer",textTransform:"uppercase"}}>
                {releasing===p.id?"...":"CUT"}
              </button>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#888"}}>{expanded===p.id?"▲":"▼"}</span>
            </div>
          </div>
          {expanded===p.id && (
            <div style={{padding:"12px 0 18px",display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20,borderTop:"1px solid #080808"}}>
              <div>
                {[["Scoring",p.scoring],["Efficiency",p.efficiency],["Playmaking",p.playmaking],["Rebounding",p.rebounding],["Defense",p.defense],["Composure",p.composure]].map(([l,v])=>(
                  <div key={String(l)} style={{marginBottom:7}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555"}}>{l}</span>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:attrColor(v as number)}}>{v}</span>
                    </div>
                    <div style={{height:2,background:"#0d0d0d"}}>
                      <div style={{height:"100%",width:`${v}%`,background:attrColor(v as number)}} />
                    </div>
                  </div>
                ))}
              </div>
              <div>
                {[["PPG",p.ppg],["RPG",p.rpg],["APG",p.apg],["MPG",p.mpg],["GP",p.gp]].map(([l,v])=>(
                  <div key={String(l)} style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#666"}}>{l}</span>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#555"}}>{typeof v==="number"?v.toFixed(1):v}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,color:"#666",marginBottom:6}}>{fmt$(p.salary)}/yr</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#666"}}>{p.years_left} yr{p.years_left!==1?"s":""} left</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",marginTop:6}}>Total: {fmt$(p.salary*p.years_left)}</div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Standings Section ────────────────────────────────────────────────────────
function StandingsSection({saveId, gmTeam}: {saveId:string; gmTeam:string}) {
  const [standings, setStandings] = useState<{east:TeamRow[];west:TeamRow[]}|null>(null);
  useEffect(()=>{fetch(`${API}/gm/standings/${saveId}`).then(r=>r.json()).then(setStandings);},[saveId]);
  if (!standings) return <div style={{padding:"80px 32px",fontFamily:"'DM Mono',monospace",fontSize:11,color:"#888"}}>LOADING...</div>;

  function Table({teams,title}: {teams:TeamRow[];title:string}) {
    return (
      <div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#888",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:12,borderBottom:"1px solid #222",paddingBottom:8}}>{title}</div>
        {teams.map((t,i)=>(
          <div key={t.abbr} style={{display:"grid",gridTemplateColumns:"24px 1fr 36px 36px 56px",gap:8,padding:"7px 0",borderBottom:"1px solid #1a1a1a",background:t.abbr===gmTeam?"#060606":"transparent"}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#888"}}>{i+1}</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:t.abbr===gmTeam?"#f0f0f0":"#888"}}>{t.abbr===gmTeam?"▶ ":""}{t.abbr}</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#555",textAlign:"right"}}>{t.wins}</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#666",textAlign:"right"}}>{t.losses}</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#555",textAlign:"right"}}>{t.pct.toFixed(3)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{maxWidth:1100,margin:"0 auto",padding:"40px 32px"}}>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:32}}>LEAGUE STANDINGS</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:48}}>
        <Table teams={standings.east} title="Eastern Conference" />
        <Table teams={standings.west} title="Western Conference" />
      </div>
    </div>
  );
}

// ─── Draft Section ────────────────────────────────────────────────────────────
function DraftSection({gmTeam}: {gmTeam:string}) {
  const picks = TEAM_PICKS[gmTeam] || [];
  const pickNum = picks.some(p=>p.round===1) ? getPickNumber(gmTeam) : null;

  return (
    <div style={{maxWidth:1100,margin:"0 auto",padding:"40px 32px"}}>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:8}}>2026 NBA DRAFT</div>
      <div style={{fontFamily:"Inter,sans-serif",fontSize:13,color:"#666",marginBottom:32}}>
        {pickNum ? `Your projected pick: #${pickNum} overall.` : "No first round pick this year."} {picks.some(p=>p.round===2)?"Second round pick held.":""}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"280px 1fr",gap:48}}>
        <div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#888",textTransform:"uppercase",marginBottom:14,borderBottom:"1px solid #222",paddingBottom:8}}>Your Picks</div>
          {picks.map((pick,i)=>(
            <div key={i} style={{padding:"12px 0",borderBottom:"1px solid #1a1a1a"}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:pick.round===1?"#777":"#666",marginBottom:4}}>
                Round {pick.round}{pick.round===1&&pickNum?` · #${pickNum} est.`:""}
                {pick.from?` · via ${pick.from}`:""}
              </div>
              <div style={{fontFamily:"Inter,sans-serif",fontSize:12,color:"#666"}}>{pick.note}</div>
            </div>
          ))}
          {picks.length===0 && <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#888"}}>No picks in 2026</div>}
        </div>
        <div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#888",textTransform:"uppercase",marginBottom:14,borderBottom:"1px solid #222",paddingBottom:8}}>2026 Draft Board — Top 15</div>
          {DRAFT_PROSPECTS.map(p=>{
            const inRange = pickNum && Math.abs(p.rank-pickNum)<=2;
            const isYours = pickNum && p.rank===pickNum;
            return (
              <div key={p.rank} style={{padding:"10px 0",borderBottom:"1px solid #1a1a1a",background:isYours?"#080808":"transparent",paddingLeft:isYours?10:0,marginLeft:isYours?-10:0}}>
                <div style={{display:"grid",gridTemplateColumns:"32px 1fr 28px 60px",gap:8,alignItems:"center"}}>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:inRange?"#555":"#888"}}>#{p.rank}</span>
                  <div>
                    <div style={{fontFamily:"Inter,sans-serif",fontSize:12,color:inRange?"#e0e0e0":"#666"}}>
                      {p.name}{isYours?" ◀ YOUR PICK":""}
                    </div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",marginTop:2}}>{p.school} · {p.note}</div>
                  </div>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555"}}>{p.pos}</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:inRange?"#888":"#888",textAlign:"right"}}>{p.ovr} ovr</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Trade Machine ────────────────────────────────────────────────────────────
function TradeSection({roster, state}: {roster:Player[]; state:GMState}) {
  const [targetTeam, setTargetTeam] = useState("");
  const [giving, setGiving] = useState<Player[]>([]);
  const [pickOffered, setPickOffered] = useState(false);
  const [pickRequested, setPickRequested] = useState(false);
  const [result, setResult] = useState<string|null>(null);
  const [submitting, setSubmitting] = useState(false);

  const givingCap = giving.reduce((s,p)=>s+p.salary,0);
  const capAfter = state.cap_used - givingCap;

  function toggleGive(p: Player) {
    setGiving(prev => prev.find(x=>x.id===p.id) ? prev.filter(x=>x.id!==p.id) : [...prev,p]);
    setResult(null);
  }

  function evaluateTrade() {
    if (!targetTeam || giving.length===0) return;
    setSubmitting(true);
    setResult(null);
    setTimeout(()=>{
      const val = giving.reduce((s,p)=>s+p.overall,0);
      const r = Math.random();
      let outcome: string;
      if (val < 35 && !pickOffered) {
        outcome = "REJECTED — Not enough value. Add a draft pick or a better player to sweeten the deal.";
      } else if (val >= 55 || (val >= 40 && pickOffered)) {
        outcome = r > 0.3 ? "ACCEPTED — Trade goes through. Both sides found value here." : "COUNTERED — Close. They want one more piece. Try adding a pick.";
      } else {
        if (r > 0.6) outcome = "ACCEPTED — The other GM thinks this fits their timeline.";
        else if (r > 0.3) outcome = "COUNTERED — Interesting offer. They want a small addition to finalize.";
        else outcome = "REJECTED — They passed. Not enough coming their way.";
      }
      setResult(outcome);
      setSubmitting(false);
    }, 1200);
  }

  const isValid = targetTeam && giving.length > 0;
  const otherTeams = NBA_TEAMS.filter(t=>t.abbr!==state.gm_team);

  return (
    <div style={{maxWidth:1100,margin:"0 auto",padding:"40px 32px"}}>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:8}}>TRADE MACHINE</div>
      <div style={{fontFamily:"Inter,sans-serif",fontSize:13,color:"#666",marginBottom:32}}>Build a trade proposal. CBA salary rules apply.</div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:32}}>
        <div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#888",textTransform:"uppercase",marginBottom:12}}>YOU SEND ({state.gm_team})</div>
          <div style={{border:"1px solid #222",borderRadius:3,minHeight:64,padding:"10px",marginBottom:12}}>
            {giving.length===0
              ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#888"}}>Click players below to add</div>
              : giving.map(p=>(
                <div key={p.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #1a1a1a"}}>
                  <span style={{fontFamily:"Inter,sans-serif",fontSize:12,color:"#777"}}>{p.name}</span>
                  <div style={{display:"flex",gap:12,alignItems:"center"}}>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#666"}}>{fmt$(p.salary)}</span>
                    <button onClick={()=>toggleGive(p)} style={{background:"transparent",border:"none",color:"#555",cursor:"pointer",fontSize:11}}>✕</button>
                  </div>
                </div>
              ))
            }
          </div>
          <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginBottom:16}}>
            <input type="checkbox" checked={pickOffered} onChange={e=>setPickOffered(e.target.checked)} />
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#666"}}>Include 2027 1st round pick</span>
          </label>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#888",textTransform:"uppercase",marginBottom:10}}>Your Roster</div>
          {roster.map(p=>(
            <div key={p.id} onClick={()=>toggleGive(p)} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #1a1a1a",cursor:"pointer",background:giving.find(x=>x.id===p.id)?"#080808":"transparent"}}>
              <div>
                <span style={{fontFamily:"Inter,sans-serif",fontSize:11,color:giving.find(x=>x.id===p.id)?"#f0f0f0":"#888"}}>{p.name}</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",marginLeft:8}}>{p.overall} OVR</span>
              </div>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555"}}>{fmt$(p.salary)}</span>
            </div>
          ))}
        </div>

        <div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#888",textTransform:"uppercase",marginBottom:12}}>TRADE PARTNER</div>
          <select value={targetTeam} onChange={e=>{setTargetTeam(e.target.value);setResult(null);}}
            style={{width:"100%",background:"#0d0d0d",border:"1px solid #222",borderRadius:3,padding:"8px 12px",fontFamily:"'DM Mono',monospace",fontSize:10,color:"#666",marginBottom:16,cursor:"pointer"}}>
            <option value="">Select a team...</option>
            {otherTeams.map(t=><option key={t.abbr} value={t.abbr}>{t.abbr} — {t.name}</option>)}
          </select>

          <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginBottom:20}}>
            <input type="checkbox" checked={pickRequested} onChange={e=>setPickRequested(e.target.checked)} />
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#666"}}>Request their 2027 1st round pick</span>
          </label>

          <div style={{border:"1px solid #222",borderRadius:3,padding:"14px",marginBottom:20}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#888",textTransform:"uppercase",marginBottom:10}}>Salary Check</div>
            {[
              {label:"Sending out",value:fmt$(givingCap)},
              {label:"Your cap after trade",value:fmt$(capAfter)},
              {label:"Under salary cap",value:capAfter<SALARY_CAP?"YES":"NO",ok:capAfter<SALARY_CAP},
              {label:"Under luxury tax",value:capAfter<LUXURY_TAX?"YES":"NO",ok:capAfter<LUXURY_TAX},
            ].map(row=>(
              <div key={row.label} style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555"}}>{row.label}</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:(row as any).ok===false?"#ff4444":(row as any).ok===true?"#666":"#888"}}>{row.value}</span>
              </div>
            ))}
          </div>

          <button onClick={evaluateTrade} disabled={!isValid||submitting} style={{width:"100%",fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",background:isValid?"#f0f0f0":"#888",color:isValid?"#000":"#888",border:"none",borderRadius:3,padding:"12px",cursor:isValid?"pointer":"not-allowed",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            {submitting && <div style={{width:10,height:10,border:"1.5px solid #888",borderTopColor:"#000",borderRadius:"50%",animation:"spin 0.7s linear infinite"}} />}
            {submitting?"EVALUATING...":"PROPOSE TRADE"}
          </button>

          {result && (
            <div style={{marginTop:16,padding:"14px",border:`1px solid ${result.includes("ACCEPTED")?"#888":"#888"}`,borderRadius:3}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:result.includes("ACCEPTED")?"#f0f0f0":result.includes("COUNTERED")?"#666":"#666",marginBottom:6}}>{result.split("—")[0]}</div>
              <div style={{fontFamily:"Inter,sans-serif",fontSize:12,color:"#888"}}>{result.split("—")[1]}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Free Agents Section ──────────────────────────────────────────────────────
function FASection({saveId, state, onSign}: {saveId:string; state:GMState; onSign:()=>void}) {
  const [fa, setFa] = useState<Player[]>([]);
  const [signing, setSigning] = useState<string|null>(null);
  const [toast, setToast] = useState<string|null>(null);
  const [filter, setFilter] = useState("");

  useEffect(()=>{
    fetch(`${API}/gm/free-agents/${saveId}?limit=80`).then(r=>r.json()).then(d=>setFa(d.free_agents||[]));
  },[saveId]);

  async function handleSign(p: Player) {
    setSigning(p.id);
    try {
      const res = await fetch(`${API}/gm/sign/${saveId}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({player_id:p.id})});
      const data = await res.json();
      if (!res.ok) { setToast(data.detail); setTimeout(()=>setToast(null),3000); return; }
      setToast(`Signed ${p.name} for ${fmt$(data.salary)}/yr`);
      setFa(prev=>prev.filter(x=>x.id!==p.id));
      onSign();
      setTimeout(()=>setToast(null),3000);
    } finally { setSigning(null); }
  }

  const filtered = fa.filter(p=>!filter||p.name.toLowerCase().includes(filter.toLowerCase())||p.position.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div style={{maxWidth:1100,margin:"0 auto",padding:"40px 32px"}}>
      {toast && <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"#111",border:"1px solid #1a1a1a",borderRadius:4,padding:"10px 20px",fontFamily:"'DM Mono',monospace",fontSize:11,color:"#f0f0f0",zIndex:1000}}>{toast}</div>}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:6}}>FREE AGENTS</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#888"}}>{fa.length} available · {fmt$(SALARY_CAP-state.cap_used)} cap space</div>
        </div>
        <input placeholder="Search..." value={filter} onChange={e=>setFilter(e.target.value)}
          style={{background:"#0d0d0d",border:"1px solid #222",borderRadius:3,padding:"8px 14px",fontFamily:"'DM Mono',monospace",fontSize:10,color:"#777",width:200,outline:"none"}} />
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 50px 50px 50px 50px 90px 60px",gap:8,padding:"8px 0",borderBottom:"1px solid #222"}}>
        {["Player","PPG","RPG","APG","OVR","Salary",""].map((h,i)=>(
          <div key={i} style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#888",textTransform:"uppercase",letterSpacing:"0.08em",textAlign:i>0?"right":"left"}}>{h}</div>
        ))}
      </div>
      {filtered.map(p=>(
        <div key={p.id} style={{display:"grid",gridTemplateColumns:"1fr 50px 50px 50px 50px 90px 60px",gap:8,padding:"9px 0",borderBottom:"1px solid #1a1a1a",alignItems:"center"}}>
          <div>
            <div style={{fontFamily:"Inter,sans-serif",fontSize:12,color:"#f0f0f0"}}>{p.name}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",marginTop:2}}>{p.position} · {p.archetype} · Age {p.age}</div>
          </div>
          {[p.ppg,p.rpg,p.apg].map((v,i)=>(
            <div key={i} style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#888",textAlign:"right"}}>{v.toFixed(1)}</div>
          ))}
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:attrColor(p.overall),textAlign:"right",fontWeight:600}}>{p.overall}</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#666",textAlign:"right"}}>{fmt$(p.salary)}</div>
          <div style={{textAlign:"right"}}>
            <button onClick={()=>handleSign(p)} disabled={signing===p.id||state.cap_used+p.salary>LUXURY_TAX}
              style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#000",background:state.cap_used+p.salary>LUXURY_TAX?"#111":"#f0f0f0",border:"none",borderRadius:2,padding:"4px 8px",cursor:state.cap_used+p.salary>LUXURY_TAX?"not-allowed":"pointer",textTransform:"uppercase"}}>
              {signing===p.id?"...":state.cap_used+p.salary>LUXURY_TAX?"NO CAP":"SIGN"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function GMPage() {
  const [saveId, setSaveId] = useState<string|null>(null);
  const [state, setState] = useState<GMState|null>(null);
  const [roster, setRoster] = useState<Player[]>([]);
  const [section, setSection] = useState("HOME");
  const [initDone, setInitDone] = useState(false);

  useEffect(()=>{
    const s = localStorage.getItem("gm_save_id");
    if (s) setSaveId(s);
    setInitDone(true);
    fetch(`${API}/gm/init-db`,{method:"POST"}).catch(()=>{});
  },[]);

  const loadData = useCallback(async (sid: string) => {
    const [s,r] = await Promise.all([
      fetch(`${API}/gm/state/${sid}`).then(x=>x.json()),
      fetch(`${API}/gm/roster/${sid}`).then(x=>x.json()),
    ]);
    setState(s);
    setRoster(r.roster||[]);
  },[]);

  useEffect(()=>{ if(saveId) loadData(saveId); },[saveId,loadData]);

  function handleSelect(sid: string, abbr: string) {
    setSaveId(sid);
    setSection("HOME");
  }

  function handleNewGame() {
    localStorage.removeItem("gm_save_id");
    localStorage.removeItem("gm_team");
    setSaveId(null);
    setState(null);
    setRoster([]);
    setSection("HOME");
  }

  if (!initDone) return null;

  if (!saveId || !state) {
    return (
      <>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <FranchiseSelect onSelect={handleSelect} />
      </>
    );
  }

  return (
    <div style={{minHeight:"100vh",background:"#000",color:"#f0f0f0"}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}} select option{background:#060606}`}</style>
      <TopBar state={state} section={section} onNav={setSection} onNewGame={handleNewGame} />
      <div style={{animation:"fadeIn 0.2s ease"}}>
        {section==="HOME"        && <HomeSection state={state} roster={roster} onNav={setSection} />}
        {section==="ROSTER"      && <RosterSection saveId={saveId} roster={roster} state={state} onRosterChange={()=>loadData(saveId)} />}
        {section==="STANDINGS"   && <StandingsSection saveId={saveId} gmTeam={state.gm_team} />}
        {section==="DRAFT"       && <DraftSection gmTeam={state.gm_team} />}
        {section==="TRADE"       && <TradeSection roster={roster} state={state} />}
        {section==="FREE AGENTS" && <FASection saveId={saveId} state={state} onSign={()=>loadData(saveId)} />}
      </div>
    </div>
  );
}
