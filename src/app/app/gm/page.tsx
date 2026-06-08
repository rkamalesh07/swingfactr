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
  // LOTTERY (1-14) — averaged ESPN + other rankings
  {rank:1,name:"AJ Dybantsa",pos:"F",school:"BYU",ovr:94,note:"Scoring wing, franchise-level tools. Three-level creator. Comp: T-Mac"},
  {rank:2,name:"Darryn Peterson",pos:"G",school:"Kansas",ovr:92,note:"Best scorer/shotmaker in class. Elite touch on/off ball. Comp: SGA-lite"},
  {rank:3,name:"Cameron Boozer",pos:"F",school:"Duke",ovr:90,note:"Most NBA-ready freshman ever. 2nd-highest BPM at 18 since Zion. Elite IQ"},
  {rank:4,name:"Caleb Wilson",pos:"F",school:"UNC",ovr:88,note:"Special upside big. Explosive motor, multiple injuries in 2026. Comp: KG"},
  {rank:5,name:"Keaton Wagler",pos:"G",school:"Illinois",ovr:86,note:"Tall on-ball playmaker, late bloomer. Led Illinois to Final Four"},
  {rank:6,name:"Darius Acuff Jr.",pos:"G",school:"Arkansas",ovr:84,note:"Best PG in college basketball. 44% from 3 at 29.5% usage"},
  {rank:7,name:"Kingston Flemings",pos:"G",school:"Houston",ovr:82,note:"Explosive burst, elite speed. Shortest wingspan concern. Comp: De'Aaron Fox"},
  {rank:8,name:"Mikel Brown Jr.",pos:"G",school:"Louisville",ovr:80,note:"Nuclear scorer, medically cleared. Positional size + shotmaking elite"},
  {rank:9,name:"Nate Ament",pos:"F",school:"Tennessee",ovr:78,note:"6-9.5 barefoot, elite wing measurements. Skilled but polarizing production"},
  {rank:10,name:"Brayden Burries",pos:"G",school:"Arizona",ovr:77,note:"All-around guard, rebounds, two-way ability. Oldest freshman may push him down"},
  {rank:11,name:"Aday Mara",pos:"C",school:"Michigan",ovr:76,note:"7-3 center, combine star. Best passing big in years. Unique skill set"},
  {rank:12,name:"Yaxel Lendeborg",pos:"F",school:"Michigan",ovr:75,note:"Rare versatility — center size with perimeter skills. Guards all 5 positions"},
  {rank:13,name:"Karim Lopez",pos:"F",school:"NZ Breakers",ovr:74,note:"Second NBL season showed real growth. Size + skill + toughness"},
  {rank:14,name:"Labaron Philon",pos:"G",school:"Alabama",ovr:73,note:"Tight handle, creative scorer. Projects better as 6th-man type"},
  // FIRST ROUND LATE (15-30)
  {rank:15,name:"Hannes Steinbach",pos:"F",school:"Washington",ovr:72,note:"Best rebounder in draft. 34% from 3. Bankable floor"},
  {rank:16,name:"Morez Johnson Jr.",pos:"F",school:"Michigan",ovr:71,note:"Defensive versatility, Michigan champion. Plus-6.5 inch wingspan"},
  {rank:17,name:"Jayden Quaintance",pos:"C",school:"Kentucky",ovr:70,note:"Biggest wildcard. Elite D tools, knee history, only 18 years old"},
  {rank:18,name:"Bennett Stirtz",pos:"G",school:"Iowa",ovr:69,note:"Best passer in draft. Shot well at combine. Veteran savvy"},
  {rank:19,name:"Christian Anderson",pos:"G",school:"Texas Tech",ovr:68,note:"41.5% from 3, elite ball-screen operation. Only 6-1 barefoot"},
  {rank:20,name:"Cameron Carr",pos:"G",school:"Baylor",ovr:67,note:"42-inch max vertical, 30 pts at combine scrimmage. Best athlete in class"},
  {rank:21,name:"Chris Cenac Jr.",pos:"C",school:"Houston",ovr:66,note:"Projectable frame, fluid shooting mechanics, modern center profile"},
  {rank:22,name:"Koa Peat",pos:"F",school:"Arizona",ovr:65,note:"Shooting mechanics concern. Winning history, defensive versatility"},
  {rank:23,name:"Allen Graves",pos:"F",school:"Santa Clara",ovr:64,note:"Strong analytics profile, low usage. Does everything right. Rising stock"},
  {rank:24,name:"Dailyn Swain",pos:"F",school:"Texas",ovr:63,note:"Athletic wing, versatile defender. 3pt shot is biggest hole in game"},
  {rank:25,name:"Isaiah Evans",pos:"G",school:"Duke",ovr:62,note:"6-5.5 barefoot, great size at 2-guard. Shooter off movement"},
  {rank:26,name:"Ebuka Okorie",pos:"G",school:"Stanford",ovr:61,note:"Best driving guard in class. 250 rim attempts. Led ACC in scoring"},
  {rank:27,name:"Henri Veesaar",pos:"C",school:"UNC",ovr:60,note:"7-0 glue guy, stretch and defend. High energy. Comp: Chris Anderson"},
  {rank:28,name:"Meleek Thomas",pos:"G",school:"Arkansas",ovr:59,note:"Athletic wing guard, one of class's better athletes"},
  {rank:29,name:"Zuby Ejiofor",pos:"C",school:"St. John's",ovr:58,note:"Physical big, developing mid-range, high energy and effort"},
  {rank:30,name:"Tarris Reed Jr.",pos:"C",school:"UConn",ovr:57,note:"Burly big, great footwork, measured well at combine"},
  // SECOND ROUND (31-60)
  {rank:31,name:"Alex Karaban",pos:"F",school:"UConn",ovr:55,note:"Veteran UConn champion. Stretch four, elite IQ player"},
  {rank:32,name:"Joshua Jefferson",pos:"F",school:"Iowa State",ovr:54,note:"Productive senior, physical forward"},
  {rank:33,name:"Luigi Suigo",pos:"C",school:"Italy",ovr:53,note:"7-3 international center. Massive hands, long-term project"},
  {rank:34,name:"Ryan Conwell",pos:"G",school:"Louisville",ovr:52,note:"Scoring guard, Louisville"},
  {rank:35,name:"Braden Smith",pos:"G",school:"Purdue",ovr:51,note:"Elite passer. Measured 5-11 barefoot — undersized concern"},
  {rank:36,name:"Baba Miller",pos:"F",school:"Cincinnati",ovr:50,note:"Senior big, Cincinnati"},
  {rank:37,name:"Sergio de Larrea",pos:"G",school:"Spain",ovr:49,note:"International guard, Spain"},
  {rank:38,name:"Richie Saunders",pos:"G",school:"BYU",ovr:48,note:"Senior shooter, BYU"},
  {rank:39,name:"Trevon Brazile",pos:"F",school:"Arkansas",ovr:47,note:"Athletic forward, Arkansas"},
  {rank:40,name:"Jaden Bradley",pos:"G",school:"Arizona",ovr:46,note:"Veteran guard, Arizona"},
  {rank:41,name:"Emanuel Sharp",pos:"G",school:"Houston",ovr:45,note:"Defensive wing, Houston"},
  {rank:42,name:"Ja'Kobi Gillespie",pos:"G",school:"Tennessee",ovr:44,note:"Senior guard, Tennessee"},
  {rank:43,name:"Ugonna Onyenso",pos:"C",school:"Virginia",ovr:43,note:"Rim protector, Virginia"},
  {rank:44,name:"Dillon Mitchell",pos:"F",school:"St. John's",ovr:42,note:"Athletic forward, St. John's"},
  {rank:45,name:"Bruce Thornton",pos:"G",school:"Ohio State",ovr:41,note:"Tenacious guard, Ohio State"},
  {rank:46,name:"Otega Oweh",pos:"G",school:"Kentucky",ovr:40,note:"Athletic wing, Kentucky"},
  {rank:47,name:"Tyler Bilodeau",pos:"F",school:"UCLA",ovr:39,note:"Physical forward, UCLA"},
  {rank:48,name:"Felix Okpara",pos:"C",school:"Tennessee",ovr:38,note:"Mobile big, Tennessee"},
  {rank:49,name:"Tyler Nickel",pos:"F",school:"Vanderbilt",ovr:37,note:"Shooter, Vanderbilt"},
  {rank:50,name:"Kylan Boswell",pos:"G",school:"Illinois",ovr:36,note:"Veteran guard, Illinois"},
  {rank:51,name:"Tobi Lawal",pos:"F",school:"Virginia Tech",ovr:35,note:"Athletic forward, Virginia Tech"},
  {rank:52,name:"Izaiyah Nelson",pos:"F",school:"South Florida",ovr:34,note:"Physical forward, South Florida"},
  {rank:53,name:"Jack Kayil",pos:"G",school:"Germany",ovr:33,note:"German guard, intriguing international prospect"},
  {rank:54,name:"Maliq Brown",pos:"C",school:"Duke",ovr:32,note:"Big wing, Duke"},
  {rank:55,name:"Milos Uzan",pos:"G",school:"Houston",ovr:31,note:"Veteran PG, Houston champion"},
  {rank:56,name:"Bryce Hopkins",pos:"F",school:"St. John's",ovr:30,note:"Wing, St. John's champion"},
  {rank:57,name:"Nate Bittle",pos:"C",school:"Oregon",ovr:29,note:"7-0 center, Oregon"},
  {rank:58,name:"Keyshawn Hall",pos:"F",school:"Auburn",ovr:28,note:"Versatile wing, Auburn"},
  {rank:59,name:"Nick Martinelli",pos:"F",school:"Northwestern",ovr:27,note:"Versatile forward, Northwestern"},
  {rank:60,name:"Tobe Awaka",pos:"F",school:"Arizona",ovr:26,note:"Physical forward, Arizona"},
  // LATE SECOND / UNDRAFTED (61-90)
  {rank:61,name:"Aaron Nkrumah",pos:"G",school:"Tennessee State",ovr:25,note:"Guard, Tennessee State"},
  {rank:62,name:"Noam Yaacov",pos:"G",school:"Israel",ovr:24,note:"International PG, Israel"},
  {rank:63,name:"Oscar Cluff",pos:"C",school:"Purdue",ovr:23,note:"Big center, Purdue"},
  {rank:64,name:"Rafael Castro",pos:"C",school:"George Washington",ovr:22,note:"Center, George Washington"},
  {rank:65,name:"Tamin Lipsey",pos:"G",school:"Iowa State",ovr:21,note:"Defensive PG, Iowa State"},
  {rank:66,name:"Quadir Copeland",pos:"G",school:"NC State",ovr:20,note:"Guard, NC State"},
  {rank:67,name:"Nick Boyd",pos:"G",school:"Wisconsin",ovr:20,note:"Senior guard, Wisconsin"},
  {rank:68,name:"Darrion Williams",pos:"F",school:"NC State",ovr:20,note:"Wing, NC State"},
  {rank:69,name:"Jaron Pierre Jr.",pos:"G",school:"SMU",ovr:20,note:"Scoring guard, SMU"},
  {rank:70,name:"Cade Tyson",pos:"F",school:"Minnesota",ovr:20,note:"Wing, Minnesota"},
  {rank:71,name:"Trey Kaufman-Renn",pos:"F",school:"Purdue",ovr:20,note:"Skilled big, Purdue"},
  {rank:72,name:"Jaden Henley",pos:"G",school:"Grand Canyon",ovr:20,note:"Athletic wing, Grand Canyon"},
  {rank:73,name:"Graham Ike",pos:"C",school:"Gonzaga",ovr:20,note:"Physical big, Gonzaga"},
  {rank:74,name:"Malik Reneau",pos:"F",school:"Miami",ovr:20,note:"Physical forward, Miami"},
  {rank:75,name:"Tucker DeVries",pos:"F",school:"Indiana",ovr:20,note:"Shooter, Indiana"},
  {rank:76,name:"Pavle Backo",pos:"C",school:"Serbia",ovr:20,note:"International center, Serbia"},
  {rank:77,name:"Ernest Udeh Jr.",pos:"C",school:"Miami",ovr:20,note:"Athletic center, Miami"},
  {rank:78,name:"Lamar Wilkerson",pos:"G",school:"Indiana",ovr:20,note:"Wing, Indiana"},
  {rank:79,name:"Seth Trimble",pos:"G",school:"UNC",ovr:20,note:"Athletic guard, UNC"},
  {rank:80,name:"Elijah Mahi",pos:"F",school:"Santa Clara",ovr:20,note:"Forward, Santa Clara"},
  {rank:81,name:"Tre Donaldson",pos:"G",school:"Miami",ovr:20,note:"Guard, Miami"},
  {rank:82,name:"Duke Miles",pos:"G",school:"Vanderbilt",ovr:20,note:"Guard, Vanderbilt"},
  {rank:83,name:"Mark Mitchell",pos:"F",school:"Missouri",ovr:20,note:"Forward, Missouri"},
  {rank:84,name:"Jaxon Kohler",pos:"C",school:"Michigan State",ovr:20,note:"Big center, Michigan State"},
  {rank:85,name:"Melvin Council Jr.",pos:"G",school:"Kansas",ovr:20,note:"Senior guard, Kansas"},
  {rank:86,name:"Josh Dix",pos:"G",school:"Creighton",ovr:20,note:"Shooter, Creighton"},
  {rank:87,name:"Isaac McKneely",pos:"G",school:"Louisville",ovr:20,note:"Shooter, Louisville"},
  {rank:88,name:"Donovan Atwell",pos:"G",school:"Texas Tech",ovr:20,note:"Guard, Texas Tech"},
  {rank:89,name:"Trevon Scott",pos:"C",school:"Coastal Carolina",ovr:20,note:"Physical big, Coastal Carolina"},
  {rank:90,name:"Tyler Powell",pos:"G",school:"Wright State",ovr:20,note:"Guard, Wright State"},
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
  DAL:{w:30,l:52,result:"Missed playoffs",note:"Traded AD to WSH mid-season for picks. Rebuilding around Cooper Flagg (#1 pick 2025)."},
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
  NY:{w:50,l:32,result:"NBA Finals",note:"Lead SA Spurs 2-0 in NBA Finals. Jalen Brunson averaging 34 PPG in the series. Seeking first title since 1973."},
  OKC:{w:68,l:14,result:"Lost WCF",note:"Best record in NBA history this season. Lost to SA Spurs 4-3 in 7 epic games in WCF."},
  ORL:{w:44,l:38,result:"Lost R1",note:"Lost to Detroit after blowing a 3-1 series lead. Pistons ended 11-game playoff home losing streak."},
  PHI:{w:35,l:47,result:"Lost R2",note:"Play-in team. Shocked Boston 4-3 overcoming 3-1 deficit in R1. Lost to Cleveland in second round."},
  PHX:{w:32,l:50,result:"Missed playoffs",note:"Play-in exit. Lost to Portland Trail Blazers in play-in elimination game."},
  POR:{w:36,l:46,result:"Lost R1",note:"Won play-in vs PHX. Swept by OKC Thunder in Round 1."},
  SA:{w:62,l:20,result:"NBA Finals",note:"In NBA Finals vs NY Knicks. Trail 0-2. Beat OKC 4-3 in 7-game WCF. Wembanyama averaging a triple-double in the Finals."},
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
const TEAM_STATUS: Record<string, {label: string; color: string}> = {
  OKC: {label:"Dynasty",color:"#c8a84b"},
  BOS: {label:"Contender",color:"#4bc87a"},
  CLE: {label:"Contender",color:"#4bc87a"},
  NYK: {label:"Contender",color:"#4bc87a"},
  SA:  {label:"Contender",color:"#4bc87a"},
  DEN: {label:"Contender",color:"#4bc87a"},
  MIN: {label:"Contender",color:"#4bc87a"},
  MEM: {label:"Rising",color:"#6ab0e8"},
  HOU: {label:"Rising",color:"#6ab0e8"},
  ATL: {label:"Rising",color:"#6ab0e8"},
  NO:  {label:"Rising",color:"#6ab0e8"},
  IND: {label:"Retooling",color:"#888"},
  DAL: {label:"Retooling",color:"#888"},
  LAL: {label:"Retooling",color:"#888"},
  MIL: {label:"Retooling",color:"#888"},
  PHX: {label:"Retooling",color:"#888"},
  SAC: {label:"Retooling",color:"#888"},
  GS:  {label:"Retooling",color:"#888"},
  MIA: {label:"Retooling",color:"#888"},
  LAC: {label:"Retooling",color:"#888"},
  POR: {label:"Rebuilding",color:"#c86060"},
  DET: {label:"Rebuilding",color:"#c86060"},
  CHA: {label:"Rebuilding",color:"#c86060"},
  WSH: {label:"Rebuilding",color:"#c86060"},
  UTAH: {label:"Rebuilding",color:"#c86060"},
  BKN: {label:"Rebuilding",color:"#c86060"},
  TOR: {label:"Rebuilding",color:"#c86060"},
  CHI: {label:"Rebuilding",color:"#c86060"},
  ORL: {label:"Rebuilding",color:"#c86060"},
  PHI: {label:"Rebuilding",color:"#c86060"},
};

const START_POINTS = [
  {id:"season",      label:"Regular Season",  date:"Oct 21, 2025", desc:"Jump straight into the 2025-26 season. Full roster, no offseason."},
  {id:"playoffs",    label:"Playoffs",        date:"Apr 2026",     desc:"Replay the 2025-26 playoffs with real rosters and seedings."},
  {id:"lottery",     label:"Draft Lottery",   date:"May 2026",     desc:"Watch the lottery unfold, then run your draft, free agency, and season."},
  {id:"draft",       label:"Draft Night",     date:"Jun 26, 2026", desc:"You're on the clock at #1. Draft your future, then sign FAs."},
  {id:"free_agency", label:"Free Agency",     date:"Jul 1, 2026",  desc:"Draft is done. Build your roster in free agency before training camp."},
];

function FranchiseSelect({ onSelect }: { onSelect: (saveId: string, abbr: string) => void }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [hov, setHov] = useState<string | null>(null);
  const [startPoint, setStartPoint] = useState("draft");
  const [hovSP, setHovSP] = useState<string | null>(null);
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
      localStorage.setItem("gm_start_point", startPoint);
      onSelect(data.save_id, abbr);
    } catch(e: any) {
      console.error("new-game error:", e.message);
    } finally {
      setLoading(null);
    }
  }

  const selectedSP = START_POINTS.find(sp => sp.id === startPoint)!;

  return (
    <div style={{minHeight:"100vh",background:"#000",padding:"56px 40px"}}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        .sp-btn:hover{background:#0d0d0d!important;border-color:#333!important;}
        .team-btn:hover .team-name{color:#f0f0f0!important;}
      `}</style>
      <div style={{maxWidth:1000,margin:"0 auto"}}>

        {/* Header */}
        <div style={{marginBottom:40}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#333",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:14}}>
            SWINGFACTR / GM MODE / 2026 OFFSEASON
          </div>
          <h1 style={{fontFamily:"Inter,sans-serif",fontSize:38,fontWeight:300,color:"#f0f0f0",lineHeight:1.1,margin:0}}>
            Choose your <strong style={{fontWeight:700}}>franchise.</strong>
          </h1>
          <p style={{fontFamily:"Inter,sans-serif",fontSize:13,color:"#3a3a3a",marginTop:10,maxWidth:500}}>
            Real 2025-26 rosters from actual game logs. NY Knicks lead SA Spurs 2-0 in the NBA Finals.
          </p>
        </div>

        {/* Start Point Selector */}
        <div style={{marginBottom:40}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#2a2a2a",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:10}}>
            Where do you want to start?
          </div>
          <div style={{display:"flex",gap:3,marginBottom:12}}>
            {START_POINTS.map(sp => {
              const active = startPoint === sp.id;
              return (
                <button key={sp.id}
                  className="sp-btn"
                  onClick={() => setStartPoint(sp.id)}
                  onMouseEnter={() => setHovSP(sp.id)}
                  onMouseLeave={() => setHovSP(null)}
                  style={{
                    fontFamily:"'DM Mono',monospace",fontSize:9,textTransform:"uppercase",
                    letterSpacing:"0.08em",padding:"8px 16px",cursor:"pointer",
                    background: active ? "#f0f0f0" : "#000",
                    color: active ? "#000" : "#555",
                    border: `1px solid ${active ? "#f0f0f0" : "#1c1c1c"}`,
                    borderRadius:3,transition:"all 0.15s",
                  }}>
                  {sp.label}
                </button>
              );
            })}
          </div>
          <div style={{
            background:"#050505",border:"1px solid #111",borderRadius:4,
            padding:"12px 16px",display:"flex",alignItems:"center",gap:16,
          }}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#444",minWidth:90}}>
              {selectedSP.date}
            </div>
            <div style={{fontFamily:"Inter,sans-serif",fontSize:12,color:"#555"}}>
              {selectedSP.desc}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div style={{display:"flex",gap:20,marginBottom:20,alignItems:"center"}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#2a2a2a",textTransform:"uppercase",letterSpacing:"0.1em"}}>Team Status:</div>
          {[
            {label:"Dynasty",color:"#c8a84b"},
            {label:"Contender",color:"#4bc87a"},
            {label:"Rising",color:"#6ab0e8"},
            {label:"Retooling",color:"#888"},
            {label:"Rebuilding",color:"#c86060"},
          ].map(s => (
            <div key={s.label} style={{display:"flex",alignItems:"center",gap:5}}>
              <div style={{width:5,height:5,borderRadius:"50%",background:s.color}} />
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:s.color,textTransform:"uppercase",letterSpacing:"0.08em"}}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Team Grid */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:32}}>
          {[{label:"Eastern Conference",teams:east},{label:"Western Conference",teams:west}].map(conf => (
            <div key={conf.label}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#2a2a2a",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:8,borderBottom:"1px solid #111",paddingBottom:6}}>
                {conf.label}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                {conf.teams.map(t => {
                  const result  = SEASON_RESULTS[t.abbr];
                  const status  = TEAM_STATUS[t.abbr];
                  const isHov   = hov === t.abbr;
                  const isLoading = loading === t.abbr;
                  const picks   = TEAM_PICKS[t.abbr] || [];
                  const r1picks = picks.filter(p => p.round === 1).length;
                  const r2picks = picks.filter(p => p.round === 2).length;
                  return (
                    <button key={t.abbr}
                      className="team-btn"
                      onClick={() => handleSelect(t.abbr)}
                      onMouseEnter={() => setHov(t.abbr)}
                      onMouseLeave={() => setHov(null)}
                      disabled={!!loading}
                      style={{
                        background: isHov ? "#080808" : "transparent",
                        border:`1px solid ${isHov ? "#1a1a1a" : "#0d0d0d"}`,
                        borderRadius:3,padding:"8px 12px",cursor:loading?"not-allowed":"pointer",
                        display:"flex",justifyContent:"space-between",alignItems:"center",
                        transition:"all 0.1s",opacity:loading&&!isLoading?0.3:1,width:"100%",
                      }}>
                      {/* Left: status dot + name */}
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:5,height:5,borderRadius:"50%",background:status?.color || "#333",flexShrink:0}} />
                        <div style={{textAlign:"left"}}>
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#333",textTransform:"uppercase",letterSpacing:"0.08em"}}>
                            {t.abbr}
                          </div>
                          <div className="team-name" style={{fontFamily:"Inter,sans-serif",fontSize:12,color:isHov?"#f0f0f0":"#444",marginTop:1,transition:"color 0.1s"}}>
                            {t.name}
                          </div>
                        </div>
                      </div>
                      {/* Right: result + picks + loading */}
                      <div style={{display:"flex",alignItems:"center",gap:12}}>
                        {status && (
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:status.color,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                            {status.label}
                          </div>
                        )}
                        {result && (
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:resultColor(result.result)}}>
                            {result.result}
                          </div>
                        )}
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#2a2a2a"}}>
                          {r1picks}R1 {r2picks}R2
                        </div>
                        {isLoading && <div style={{width:8,height:8,border:"1px solid #222",borderTopColor:"#666",borderRadius:"50%",animation:"spin 0.8s linear infinite"}} />}
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
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555"}}>{fmt$(state.cap_used)} / $154.6M</span>
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
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#888"}}>$154.6M cap</span>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#888"}}>$187.9M luxury tax</span>
        </div>
      </div>

      <p style={{fontFamily:"Inter,sans-serif",fontSize:14,color:"#555",lineHeight:1.7,maxWidth:640,marginBottom:8}}>{getNarrative()}</p>
      {result?.note && <p style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#555",marginBottom:24}}>{result.note}</p>}

      {/* Offseason Timeline */}
      <div style={{marginBottom:40,padding:"16px 20px",border:"1px solid #111",borderRadius:4,background:"#030303"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:24}}>
            {[
              {id:"draft_lottery",label:"Lottery",date:"May 12"},
              {id:"draft",label:"Draft Night",date:"Jun 26"},
              {id:"free_agency",label:"Free Agency",date:"Jul 1"},
              {id:"preseason",label:"Preseason",date:"Oct 4"},
              {id:"season",label:"Season",date:"Oct 21"},
            ].map((phase,i)=>(
              <div key={phase.id} style={{display:"flex",alignItems:"center",gap:8}}>
                {i>0 && <div style={{width:20,height:1,background:"#1a1a1a"}} />}
                <div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#f0f0f0",textTransform:"uppercase",letterSpacing:"0.06em"}}>{phase.label}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:"#333"}}>{phase.date}</div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={()=>onNav("DRAFT")} style={{fontFamily:"'DM Mono',monospace",fontSize:9,textTransform:"uppercase",letterSpacing:"0.1em",background:"#f0f0f0",color:"#000",border:"none",borderRadius:3,padding:"8px 20px",cursor:"pointer",whiteSpace:"nowrap"}}>
            SIM TO DRAFT →
          </button>
        </div>
      </div>

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
// Draft pick assignment: which team picks at each slot
const DRAFT_ORDER: {slot: number; team: string; note?: string}[] = [
  {slot:1,team:"WSH"},{slot:2,team:"UTAH"},{slot:3,team:"MEM"},
  {slot:4,team:"CHI"},{slot:5,team:"LAC",note:"from IND"},{slot:6,team:"BKN"},
  {slot:7,team:"SAC"},{slot:8,team:"ATL",note:"from NO"},{slot:9,team:"DAL"},
  {slot:10,team:"MIL"},{slot:11,team:"GS"},{slot:12,team:"OKC",note:"from LAC"},
  {slot:13,team:"MIA"},{slot:14,team:"CHA"},{slot:15,team:"CHI",note:"from POR"},
  {slot:16,team:"MEM",note:"from PHX"},{slot:17,team:"OKC",note:"from PHI"},
  {slot:18,team:"CHA",note:"from ORL"},{slot:19,team:"TOR"},{slot:20,team:"SA",note:"from ATL"},
  {slot:21,team:"DET",note:"from MIN"},{slot:22,team:"PHI",note:"from HOU"},
  {slot:23,team:"ATL",note:"from CLE"},{slot:24,team:"NYK"},{slot:25,team:"LAL"},
  {slot:26,team:"DEN"},{slot:27,team:"BOS"},{slot:28,team:"MIN",note:"from DET"},
  {slot:29,team:"CLE",note:"from SA"},{slot:30,team:"DAL",note:"from OKC"},
  // Round 2
  {slot:31,team:"NYK",note:"from WAS"},{slot:32,team:"MEM",note:"from IND"},
  {slot:33,team:"BKN"},{slot:34,team:"SAC"},{slot:35,team:"SA",note:"from UTAH"},
  {slot:36,team:"LAC",note:"from MEM"},{slot:37,team:"OKC",note:"from DAL"},
  {slot:38,team:"CHI",note:"from NO"},{slot:39,team:"HOU",note:"from CHI"},
  {slot:40,team:"SA",note:"from MIA"},{slot:41,team:"MIA",note:"from GS"},
  {slot:42,team:"SA",note:"from POR"},{slot:43,team:"BKN",note:"from LAC"},
  {slot:44,team:"SA",note:"from MIA"},{slot:45,team:"CHA",note:"from SAC"},
  {slot:46,team:"ORL"},{slot:47,team:"PHX",note:"from PHI"},
  {slot:48,team:"DAL",note:"from PHX"},{slot:49,team:"DEN",note:"from ATL"},
  {slot:50,team:"TOR"},{slot:51,team:"WSH",note:"from MIN"},
  {slot:52,team:"LAC",note:"from CLE"},{slot:53,team:"HOU"},
  {slot:54,team:"GS",note:"from LAL"},{slot:55,team:"NYK"},
  {slot:56,team:"CHI",note:"from DEN"},{slot:57,team:"BOS",note:"from ATL"},
  {slot:58,team:"NO",note:"from DET"},{slot:59,team:"MIN",note:"from SA"},
  {slot:60,team:"WSH",note:"from OKC"},
];

// AI team needs by archetype preference
const TEAM_NEEDS: Record<string, string[]> = {
  WSH:["G","F","C"],UTAH:["G","F"],MEM:["F","C"],CHI:["C","F"],
  LAC:["G","F"],BKN:["G","F","C"],SAC:["G","F"],ATL:["F","G"],
  DAL:["G","F"],MIL:["G","C"],GS:["G","F"],OKC:["F","C"],
  MIA:["F","G"],CHA:["G","F"],POR:["G","F"],PHI:["C","F"],
  DEN:["G","F"],CLE:["G","F"],NO:["F","G"],DET:["G","F"],
  MIN:["C","F"],NYK:["C","F"],LAL:["G","F"],TOR:["G","F"],
  HOU:["F","G"],SA:["G","F"],IND:["C","F"],PHX:["G","F"],
  BOS:["F","G"],ORL:["G","F"],
};

type DraftPick = {slot: number; team: string; note?: string; prospect?: {name:string;pos:string;school:string;ovr:number;note:string} | null};

function DraftSection({gmTeam}: {gmTeam:string}) {
  const MM = "'DM Mono',monospace";
  const myPicks = TEAM_PICKS[gmTeam] || [];
  const mySlots = DRAFT_ORDER.filter(d => d.team === gmTeam).map(d => d.slot);
  const nextMyPick = mySlots[0] ?? null;

  const [tab, setTab] = useState<"prospects"|"draft">("prospects");
  const [draftLog, setDraftLog] = useState<DraftPick[]>([]);
  const [available, setAvailable] = useState(DRAFT_PROSPECTS.map(p => ({...p})));
  const [currentSlot, setCurrentSlot] = useState(1);
  const [drafting, setDrafting] = useState(false);
  const [selectedProspect, setSelectedProspect] = useState<typeof DRAFT_PROSPECTS[0] | null>(null);
  const [posFilter, setPosFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const draftComplete = currentSlot > 60;

  const isMyPick = mySlots.includes(currentSlot);
  const currentSlotInfo = DRAFT_ORDER.find(d => d.slot === currentSlot);

  function aiPick(slot: number): typeof DRAFT_PROSPECTS[0] {
    const slotInfo = DRAFT_ORDER.find(d => d.slot === slot);
    const team = slotInfo?.team || "WSH";
    const needs = TEAM_NEEDS[team] || ["G","F","C"];
    const avail = available.filter(p => !draftLog.find(d => d.prospect?.name === p.name));
    // AI drafts BPA but with 20% chance of reaching for a need
    const needPos = needs[0];
    const byNeed = avail.filter(p => p.pos === needPos);
    const useNeed = Math.random() < 0.25 && byNeed.length > 0;
    const pool = useNeed ? byNeed.slice(0, 5) : avail.slice(0, Math.max(3, Math.floor(slot * 0.4)));
    return pool[Math.floor(Math.random() * Math.min(3, pool.length))];
  }

  function simOnePick() {
    if (draftComplete || isMyPick || drafting) return;
    const pick = aiPick(currentSlot);
    const slotInfo = DRAFT_ORDER.find(d => d.slot === currentSlot)!;
    setDraftLog(prev => [...prev, {...slotInfo, prospect: pick || null}]);
    setAvailable(prev => prev.filter(p => p.name !== pick?.name));
    setCurrentSlot(s => s + 1);
  }

  function simToMyPick() {
    if (draftComplete) return;
    setDrafting(true);
    let slot = currentSlot;
    const newLog: DraftPick[] = [...draftLog];
    const newAvail = [...available];
    while (slot <= 60 && !mySlots.includes(slot)) {
      const slotInfo = DRAFT_ORDER.find(d => d.slot === slot)!;
      const avail = newAvail.filter(p => !newLog.find(d => d.prospect?.name === p.name));
      const needs = TEAM_NEEDS[slotInfo.team] || ["G","F","C"];
      const byNeed = avail.filter(p => p.pos === needs[0]);
      const useNeed = Math.random() < 0.25 && byNeed.length > 0;
      const pool = useNeed ? byNeed.slice(0,3) : avail.slice(0, Math.max(3, Math.floor(slot*0.4)));
      const pick = pool[Math.floor(Math.random() * Math.min(3, pool.length))];
      if (pick) {
        newLog.push({...slotInfo, prospect: pick});
        const idx = newAvail.findIndex(p => p.name === pick.name);
        if (idx > -1) newAvail.splice(idx, 1);
      }
      slot++;
    }
    setDraftLog(newLog);
    setAvailable(newAvail);
    setCurrentSlot(slot);
    setDrafting(false);
    setTab("draft");
  }

  function simToEnd() {
    setDrafting(true);
    let slot = currentSlot;
    const newLog: DraftPick[] = [...draftLog];
    const newAvail = [...available];
    while (slot <= 60) {
      const slotInfo = DRAFT_ORDER.find(d => d.slot === slot)!;
      if (mySlots.includes(slot)) {
        // Auto-pick best available for user team
        const avail = newAvail.filter(p => !newLog.find(d => d.prospect?.name === p.name));
        const pick = avail[0];
        if (pick) {
          newLog.push({...slotInfo, prospect: pick});
          const idx = newAvail.findIndex(p => p.name === pick.name);
          if (idx > -1) newAvail.splice(idx, 1);
        }
      } else {
        const avail = newAvail.filter(p => !newLog.find(d => d.prospect?.name === p.name));
        const needs = TEAM_NEEDS[slotInfo.team] || ["G","F","C"];
        const byNeed = avail.filter(p => p.pos === needs[0]);
        const useNeed = Math.random() < 0.25 && byNeed.length > 0;
        const pool = useNeed ? byNeed.slice(0,3) : avail.slice(0, Math.max(3, Math.floor(slot*0.4)));
        const pick = pool[Math.floor(Math.random() * Math.min(3, pool.length))];
        if (pick) {
          newLog.push({...slotInfo, prospect: pick});
          const idx = newAvail.findIndex(p => p.name === pick.name);
          if (idx > -1) newAvail.splice(idx, 1);
        }
      }
      slot++;
    }
    setDraftLog(newLog);
    setAvailable(newAvail);
    setCurrentSlot(61);
    setDrafting(false);
    setTab("draft");
  }

  function makePick(prospect: typeof DRAFT_PROSPECTS[0]) {
    const slotInfo = DRAFT_ORDER.find(d => d.slot === currentSlot)!;
    setDraftLog(prev => [...prev, {...slotInfo, prospect}]);
    setAvailable(prev => prev.filter(p => p.name !== prospect.name));
    setCurrentSlot(s => s + 1);
    setSelectedProspect(null);
    setTab("draft");
  }

  const myDraftedPlayers = draftLog.filter(d => mySlots.includes(d.slot));
  const filteredAvail = available
    .filter(p => !draftLog.find(d => d.prospect?.name === p.name))
    .filter(p => posFilter === "ALL" || p.pos === posFilter)
    .filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || p.school.toLowerCase().includes(search.toLowerCase()));

  const tabBtn = (label: string, active: boolean, onClick: ()=>void) => (
    <button onClick={onClick} style={{fontFamily:MM,fontSize:9,textTransform:"uppercase" as const,letterSpacing:"0.08em",
      background:"transparent",border:"none",borderBottom:`1px solid ${active?"#888":"transparent"}`,
      color:active?"#f0f0f0":"#444",padding:"4px 16px",cursor:"pointer"}}>
      {label}
    </button>
  );

  return (
    <div style={{maxWidth:1200,margin:"0 auto",padding:"24px 32px"}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header + sim controls */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontFamily:MM,fontSize:9,color:"#333",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:4}}>
            2026 NBA DRAFT
          </div>
          <div style={{fontFamily:"Inter,sans-serif",fontSize:13,color:"#555"}}>
            {draftComplete ? "Draft complete." : isMyPick ? `You're on the clock — Pick #${currentSlot}` : `Pick #${currentSlot} — ${currentSlotInfo?.team}${currentSlotInfo?.note?` (${currentSlotInfo.note})`:""} is on the clock`}
          </div>
        </div>

        {/* Sim controls */}
        {!draftComplete && (
          <div style={{display:"flex",gap:6}}>
            {!isMyPick && (
              <button onClick={simOnePick} disabled={drafting}
                style={{fontFamily:MM,fontSize:9,textTransform:"uppercase" as const,letterSpacing:"0.08em",
                  background:"transparent",border:"1px solid #1a1a1a",borderRadius:3,
                  color:"#666",padding:"7px 14px",cursor:"pointer"}}>
                Sim one pick
              </button>
            )}
            {!isMyPick && nextMyPick && currentSlot < nextMyPick && (
              <button onClick={simToMyPick} disabled={drafting}
                style={{fontFamily:MM,fontSize:9,textTransform:"uppercase" as const,letterSpacing:"0.08em",
                  background:"transparent",border:"1px solid #1a1a1a",borderRadius:3,
                  color:"#666",padding:"7px 14px",cursor:"pointer"}}>
                {drafting?"Simming...":"To your next pick"}
              </button>
            )}
            <button onClick={simToEnd} disabled={drafting}
              style={{fontFamily:MM,fontSize:9,textTransform:"uppercase" as const,letterSpacing:"0.08em",
                background:"transparent",border:"1px solid #1a1a1a",borderRadius:3,
                color:"#666",padding:"7px 14px",cursor:"pointer"}}>
              {drafting?"Simming...":"To end of draft"}
            </button>
            {isMyPick && (
              <div style={{fontFamily:MM,fontSize:9,color:"#f0f0f0",padding:"7px 14px",
                border:"1px solid #333",borderRadius:3,background:"#080808"}}>
                ◀ YOUR PICK — Select a prospect
              </div>
            )}
          </div>
        )}
      </div>

      {/* My picks summary */}
      {myDraftedPlayers.length > 0 && (
        <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          {myDraftedPlayers.map(d => (
            <div key={d.slot} style={{border:"1px solid #1a1a1a",borderRadius:3,padding:"6px 12px",background:"#050505"}}>
              <div style={{fontFamily:MM,fontSize:8,color:"#555",textTransform:"uppercase"}}>Pick #{d.slot}</div>
              <div style={{fontFamily:"Inter,sans-serif",fontSize:11,color:"#e0e0e0"}}>{d.prospect?.name}</div>
              <div style={{fontFamily:MM,fontSize:8,color:"#444"}}>{d.prospect?.pos} · {d.prospect?.school}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{display:"flex",gap:0,borderBottom:"1px solid #111",marginBottom:16}}>
        {tabBtn("Prospects",tab==="prospects",()=>setTab("prospects"))}
        {tabBtn(`Draft Results (${draftLog.length})`,tab==="draft",()=>setTab("draft"))}
      </div>

      {/* PROSPECTS TAB */}
      {tab==="prospects" && (
        <div>
          {/* Filters */}
          <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"center"}}>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search prospects..."
              style={{fontFamily:MM,fontSize:9,background:"#080808",border:"1px solid #111",
                borderRadius:3,padding:"6px 12px",color:"#888",width:200,outline:"none"}} />
            {["ALL","G","F","C"].map(pos=>(
              <button key={pos} onClick={()=>setPosFilter(pos)}
                style={{fontFamily:MM,fontSize:8,textTransform:"uppercase" as const,
                  background:posFilter===pos?"#f0f0f0":"transparent",
                  color:posFilter===pos?"#000":"#444",
                  border:`1px solid ${posFilter===pos?"#f0f0f0":"#111"}`,
                  borderRadius:3,padding:"5px 10px",cursor:"pointer"}}>
                {pos}
              </button>
            ))}
            <span style={{fontFamily:MM,fontSize:8,color:"#333"}}>{filteredAvail.length} available</span>
          </div>

          {/* Header */}
          <div style={{display:"grid",gridTemplateColumns:"40px 1fr 36px 80px 60px 60px 80px",gap:8,
            padding:"0 0 8px 0",borderBottom:"1px solid #111",marginBottom:4}}>
            {["#","NAME","POS","SCHOOL","OVR","POT",""].map((h,i)=>(
              <div key={i} style={{fontFamily:MM,fontSize:8,color:"#333",textTransform:"uppercase",textAlign:i>3?"right":"left"}}>{h}</div>
            ))}
          </div>

          {/* Prospect rows */}
          {filteredAvail.slice(0,60).map(p => {
            const drafted = !!draftLog.find(d => d.prospect?.name === p.name);
            if (drafted) return null;
            const isSel = selectedProspect?.name === p.name;
            return (
              <div key={p.rank} onClick={()=>setSelectedProspect(isSel?null:p)}
                style={{display:"grid",gridTemplateColumns:"40px 1fr 36px 80px 60px 60px 80px",gap:8,
                  alignItems:"center",padding:"8px 0",borderBottom:"1px solid #080808",
                  cursor:"pointer",background:isSel?"#0a0a0a":"transparent",
                  opacity:drafted?0.3:1,transition:"background 0.1s"}}>
                <span style={{fontFamily:MM,fontSize:9,color:"#333"}}>#{p.rank}</span>
                <div>
                  <div style={{fontFamily:"Inter,sans-serif",fontSize:12,color:isSel?"#f0f0f0":"#888"}}>{p.name}</div>
                  <div style={{fontFamily:MM,fontSize:8,color:"#333",marginTop:1}}>{p.note?.slice(0,60)}</div>
                </div>
                <span style={{fontFamily:MM,fontSize:9,color:"#555"}}>{p.pos}</span>
                <span style={{fontFamily:MM,fontSize:9,color:"#444"}}>{p.school}</span>
                <span style={{fontFamily:MM,fontSize:10,color:p.ovr>=80?"#f0f0f0":p.ovr>=65?"#888":"#555",textAlign:"right"}}>{p.ovr}</span>
                <span style={{fontFamily:MM,fontSize:9,color:"#444",textAlign:"right"}}>{Math.min(99,p.ovr+Math.floor(Math.random()*15+5))}</span>
                <div style={{textAlign:"right"}}>
                  {isMyPick && isSel && (
                    <button onClick={(e)=>{e.stopPropagation();makePick(p);}}
                      style={{fontFamily:MM,fontSize:8,textTransform:"uppercase" as const,
                        background:"#f0f0f0",color:"#000",border:"none",
                        borderRadius:2,padding:"4px 10px",cursor:"pointer"}}>
                      DRAFT
                    </button>
                  )}
                  {!isMyPick && isSel && (
                    <span style={{fontFamily:MM,fontSize:8,color:"#555"}}>not your pick</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* DRAFT RESULTS TAB */}
      {tab==="draft" && (
        <div>
          {/* Round headers */}
          {[1,2].map(round => {
            const roundPicks = draftLog.filter(d => d.slot <= (round===1?30:60) && d.slot > (round===1?0:30));
            if (roundPicks.length === 0 && round === 2) return null;
            return (
              <div key={round} style={{marginBottom:24}}>
                <div style={{fontFamily:MM,fontSize:9,color:"#333",textTransform:"uppercase",
                  letterSpacing:"0.1em",marginBottom:8,paddingBottom:6,borderBottom:"1px solid #0d0d0d"}}>
                  Round {round}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"50px 60px 1fr 40px 80px",gap:8,
                  padding:"0 0 6px",borderBottom:"1px solid #0a0a0a",marginBottom:4}}>
                  {["PICK","TEAM","NAME","POS","OVR"].map((h,i)=>(
                    <div key={i} style={{fontFamily:MM,fontSize:7,color:"#222",textTransform:"uppercase"}}>{h}</div>
                  ))}
                </div>
                {roundPicks.map(d => {
                  const isMe = mySlots.includes(d.slot);
                  const isNext = d.slot === currentSlot - 1;
                  return (
                    <div key={d.slot} style={{display:"grid",gridTemplateColumns:"50px 60px 1fr 40px 80px",gap:8,
                      alignItems:"center",padding:"7px 0",borderBottom:"1px solid #080808",
                      background:isMe?"#050505":"transparent"}}>
                      <span style={{fontFamily:MM,fontSize:9,color:isMe?"#888":"#333"}}>#{d.slot}</span>
                      <span style={{fontFamily:MM,fontSize:9,color:isMe?"#f0f0f0":"#555"}}>{d.team}{d.note?` *`:""}</span>
                      <div>
                        <div style={{fontFamily:"Inter,sans-serif",fontSize:11,color:isMe?"#f0f0f0":"#666"}}>
                          {d.prospect?.name || "—"}
                          {isMe && " ◀"}
                        </div>
                        {d.prospect && <div style={{fontFamily:MM,fontSize:8,color:"#333"}}>{d.prospect.school}</div>}
                      </div>
                      <span style={{fontFamily:MM,fontSize:9,color:"#444"}}>{d.prospect?.pos}</span>
                      <span style={{fontFamily:MM,fontSize:9,color:"#555"}}>{d.prospect?.ovr}</span>
                    </div>
                  );
                })}
                {/* Upcoming picks this round */}
                {DRAFT_ORDER.filter(d => d.slot > (round===1?0:30) && d.slot <= (round===1?30:60) && d.slot >= currentSlot).slice(0,5).map(d => {
                  const isMe = mySlots.includes(d.slot);
                  const isCurrent = d.slot === currentSlot;
                  return (
                    <div key={d.slot} style={{display:"grid",gridTemplateColumns:"50px 60px 1fr 40px 80px",gap:8,
                      alignItems:"center",padding:"7px 0",borderBottom:"1px solid #080808",
                      opacity:0.4,background:isCurrent?"#050505":"transparent"}}>
                      <span style={{fontFamily:MM,fontSize:9,color:isMe?"#888":"#222"}}>#{d.slot}</span>
                      <span style={{fontFamily:MM,fontSize:9,color:isMe?"#888":"#333"}}>{d.team}</span>
                      <span style={{fontFamily:"Inter,sans-serif",fontSize:11,color:"#333"}}>
                        {isCurrent?(isMe?"Your pick":"On the clock"):"—"}
                      </span>
                      <span style={{fontFamily:MM,fontSize:9,color:"#222"}}></span>
                      <span style={{fontFamily:MM,fontSize:9,color:"#222"}}></span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {draftLog.length === 0 && (
            <div style={{fontFamily:MM,fontSize:10,color:"#333",padding:"32px 0",textAlign:"center"}}>
              No picks made yet. Go to Prospects tab or use sim controls above.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Trade Machine ─────────────────────────────────────────────────────────────
function TradeSection({saveId, state, roster}: {saveId:string; state:GMState; roster:Player[]}) {
  const [giving, setGiving]         = useState<Player[]>([]);
  const [targetTeam, setTargetTeam] = useState("");
  const [myTab, setMyTab]           = useState<"roster"|"picks">("roster");
  const [theirTab, setTheirTab]     = useState<"roster"|"picks">("roster");
  const [theirRoster, setTheirRoster] = useState<Player[]>([]);
  const [theirPicks, setTheirPicks] = useState<{round:number;from?:string;note:string;est_pick?:number}[]>([]);
  const [getting, setGetting]       = useState<Player[]>([]);
  const [myPicksOffered, setMyPicksOffered] = useState<string[]>([]);
  const [theirPicksReq, setTheirPicksReq]   = useState<string[]>([]);
  const [result, setResult]         = useState<string|null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingTeam, setLoadingTeam] = useState(false);

  const otherTeams = NBA_TEAMS.filter(t => t.abbr !== state.gm_team);
  const myPicks    = TEAM_PICKS[state.gm_team] || [];
  const SALARY_CAP   = 154_647_000;
  const LUXURY_TAX   = 187_876_000;

  const givingCap  = giving.reduce((s,p)=>s+p.salary,0);
  const gettingCap = getting.reduce((s,p)=>s+p.salary,0);
  const capAfter   = state.cap_used - givingCap + gettingCap;
  const isValid    = (giving.length>0||myPicksOffered.length>0) && targetTeam!=="";

  function toggleGive(p: Player) {
    setGiving(prev => prev.find(x=>x.id===p.id) ? prev.filter(x=>x.id!==p.id) : [...prev,p]);
    setResult(null);
  }
  function toggleGet(p: Player) {
    setGetting(prev => prev.find(x=>x.id===p.id) ? prev.filter(x=>x.id!==p.id) : [...prev,p]);
    setResult(null);
  }
  function toggleMyPick(desc: string) {
    setMyPicksOffered(prev => prev.includes(desc) ? prev.filter(d=>d!==desc) : [...prev,desc]);
    setResult(null);
  }
  function toggleTheirPick(desc: string) {
    setTheirPicksReq(prev => prev.includes(desc) ? prev.filter(d=>d!==desc) : [...prev,desc]);
    setResult(null);
  }

  async function loadTeam(abbr: string) {
    if (!abbr) { setTheirRoster([]); setTheirPicks([]); return; }
    setLoadingTeam(true);
    try {
      const res = await fetch(`${API}/gm/league-players/${saveId}?limit=600`);
      const data = await res.json();
      const team = data.players.filter((p: Player) => p.team === abbr);
      setTheirRoster(team);
      setTheirPicks(TEAM_PICKS[abbr] || []);
    } catch(e) { console.error(e); }
    finally { setLoadingTeam(false); }
  }

  async function evaluateTrade() {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(`${API}/gm/trade/${saveId}`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          giving: giving.map(p=>p.id),
          getting: getting.map(p=>p.id),
          target_team: targetTeam,
          picks_offered: myPicksOffered,
          picks_requested: theirPicksReq,
        }),
      });
      const data = await res.json();
      setResult(data.result || data.error || "Unknown response");
    } catch(e: any) { setResult("Error: " + e.message); }
    finally { setSubmitting(false); }
  }

  const MONOSPACE: React.CSSProperties = {fontFamily:"'DM Mono',monospace"};
  const CAP_OK   = capAfter < SALARY_CAP;
  const TAX_OK   = capAfter < LUXURY_TAX;

  const tabBtn = (label: string, active: boolean, onClick: ()=>void) => (
    <button onClick={onClick} style={{...MONOSPACE,fontSize:9,textTransform:"uppercase" as const,letterSpacing:"0.08em",
      background:"transparent",border:"none",borderBottom:`1px solid ${active?"#888":"transparent"}`,
      color:active?"#f0f0f0":"#444",padding:"4px 12px",cursor:"pointer"}}>
      {label}
    </button>
  );

  return (
    <div style={{maxWidth:1100,margin:"0 auto",padding:"32px"}}>
      <div style={{...MONOSPACE,fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>Trade Machine</div>
      <p style={{fontFamily:"Inter,sans-serif",fontSize:12,color:"#444",marginBottom:28}}>
        Build a proposal. CBA matching rules apply — outgoing salary must be within 125% + $100K of incoming.
      </p>

      {/* Three-column layout: MY SIDE | SALARY CHECK | THEIR SIDE */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 220px 1fr",gap:16}}>

        {/* ── LEFT: My Side ── */}
        <div style={{border:"1px solid #111",borderRadius:4,overflow:"hidden"}}>
          <div style={{background:"#080808",padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{...MONOSPACE,fontSize:10,color:"#f0f0f0",textTransform:"uppercase",letterSpacing:"0.08em"}}>{state.gm_team}</div>
            <div style={{...MONOSPACE,fontSize:9,color:"#444"}}>{fmt$(givingCap)} out</div>
          </div>
          <div style={{display:"flex",gap:0,borderBottom:"1px solid #111",padding:"0 8px"}}>
            {tabBtn("Roster",myTab==="roster",()=>setMyTab("roster"))}
            {tabBtn(`Picks (${myPicks.length})`,myTab==="picks",()=>setMyTab("picks"))}
          </div>

          {/* Selected players going out */}
          {(giving.length>0||myPicksOffered.length>0) && (
            <div style={{padding:"10px 14px",background:"#050505",borderBottom:"1px solid #0d0d0d"}}>
              <div style={{...MONOSPACE,fontSize:8,color:"#333",textTransform:"uppercase",marginBottom:6}}>Sending</div>
              {giving.map(p=>(
                <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <span style={{fontFamily:"Inter,sans-serif",fontSize:11,color:"#e0e0e0"}}>{p.name}</span>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <span style={{...MONOSPACE,fontSize:9,color:"#444"}}>{fmt$(p.salary)}</span>
                    <button onClick={()=>toggleGive(p)} style={{background:"transparent",border:"none",color:"#444",cursor:"pointer",fontSize:10}}>✕</button>
                  </div>
                </div>
              ))}
              {myPicksOffered.map(d=>(
                <div key={d} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <span style={{...MONOSPACE,fontSize:9,color:"#888"}}>{d}</span>
                  <button onClick={()=>toggleMyPick(d)} style={{background:"transparent",border:"none",color:"#444",cursor:"pointer",fontSize:10}}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div style={{height:360,overflowY:"auto"}}>
            {myTab==="roster" ? roster.map(p=>{
              const sel = !!giving.find(x=>x.id===p.id);
              return (
                <div key={p.id} onClick={()=>toggleGive(p)}
                  style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 14px",
                    borderBottom:"1px solid #080808",cursor:"pointer",
                    background:sel?"#0d0d0d":"transparent",transition:"background 0.1s"}}>
                  <div>
                    <div style={{fontFamily:"Inter,sans-serif",fontSize:11,color:sel?"#f0f0f0":"#888"}}>{p.name}</div>
                    <div style={{...MONOSPACE,fontSize:8,color:"#333",marginTop:2}}>{p.overall} OVR · {p.archetype}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{...MONOSPACE,fontSize:9,color:sel?"#888":"#333"}}>{fmt$(p.salary)}</div>
                    <div style={{...MONOSPACE,fontSize:8,color:"#222"}}>Age {p.age}</div>
                  </div>
                </div>
              );
            }) : (
              <div style={{padding:"12px 14px"}}>
                {myPicks.length===0 && <div style={{...MONOSPACE,fontSize:9,color:"#333"}}>No 2026 picks</div>}
                {myPicks.map(pk=>{
                  const sel = myPicksOffered.includes(pk.note);
                  return (
                    <div key={pk.note} onClick={()=>toggleMyPick(pk.note)}
                      style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                        padding:"10px 0",borderBottom:"1px solid #080808",cursor:"pointer",
                        background:sel?"#0d0d0d":"transparent"}}>
                      <div>
                        <div style={{...MONOSPACE,fontSize:9,color:sel?"#f0f0f0":"#888"}}>Round {pk.round} · {pk.note || pk.from || ""}</div>
                        
                      </div>
                      <div style={{...MONOSPACE,fontSize:8,color:sel?"#888":"#333"}}>
                        {sel?"INCLUDED":"+ ADD"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── CENTER: Salary Check + CTA ── */}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{border:"1px solid #111",borderRadius:4,padding:"16px"}}>
            <div style={{...MONOSPACE,fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:12}}>Salary Check</div>
            {[
              {label:"Sending",val:fmt$(givingCap)},
              {label:"Receiving",val:fmt$(gettingCap)},
              {label:"Cap after",val:fmt$(capAfter),warn:!CAP_OK},
              {label:"Under cap",val:CAP_OK?"✓":"✗",ok:CAP_OK},
              {label:"Under tax",val:TAX_OK?"✓":"✗",ok:TAX_OK},
            ].map(row=>(
              <div key={row.label} style={{display:"flex",justifyContent:"space-between",marginBottom:7}}>
                <span style={{...MONOSPACE,fontSize:8,color:"#444"}}>{row.label}</span>
                <span style={{...MONOSPACE,fontSize:9,color:(row as any).ok===false?"#c86060":(row as any).ok===true?"#4bc87a":(row as any).warn?"#ff8800":"#666"}}>{row.val}</span>
              </div>
            ))}
          </div>

          {/* CBA matching check */}
          {giving.length>0 && getting.length>0 && (() => {
            const maxOut = gettingCap * 1.25 + 100_000;
            const valid = givingCap <= maxOut && gettingCap <= givingCap * 1.25 + 100_000;
            return (
              <div style={{border:`1px solid ${valid?"#111":"#2a1111"}`,borderRadius:4,padding:"12px",background:valid?"transparent":"#0a0303"}}>
                <div style={{...MONOSPACE,fontSize:8,color:valid?"#444":"#c86060",textTransform:"uppercase",marginBottom:4}}>CBA Match</div>
                <div style={{...MONOSPACE,fontSize:8,color:valid?"#4bc87a":"#c86060"}}>{valid?"✓ Salaries match":"✗ Salary mismatch"}</div>
              </div>
            );
          })()}

          <button onClick={evaluateTrade} disabled={!isValid||submitting}
            style={{...MONOSPACE,fontSize:9,fontWeight:600,textTransform:"uppercase" as const,letterSpacing:"0.1em",
              background:isValid?"#f0f0f0":"#111",color:isValid?"#000":"#333",
              border:"none",borderRadius:3,padding:"12px 8px",cursor:isValid?"pointer":"not-allowed",
              display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            {submitting && <div style={{width:8,height:8,border:"1.5px solid #888",borderTopColor:"#000",borderRadius:"50%",animation:"spin 0.7s linear infinite"}} />}
            {submitting?"EVALUATING...":"PROPOSE TRADE"}
          </button>

          {result && (
            <div style={{border:"1px solid #1a1a1a",borderRadius:4,padding:"12px"}}>
              <div style={{...MONOSPACE,fontSize:9,color:result.includes("ACCEPTED")?"#4bc87a":"#888",marginBottom:4}}>
                {result.split("—")[0]}
              </div>
              <div style={{fontFamily:"Inter,sans-serif",fontSize:11,color:"#555",lineHeight:1.5}}>
                {result.split("—")[1]}
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Their Side ── */}
        <div style={{border:"1px solid #111",borderRadius:4,overflow:"hidden"}}>
          <div style={{background:"#080808",padding:"12px 16px"}}>
            <select value={targetTeam} onChange={e=>{setTargetTeam(e.target.value);loadTeam(e.target.value);setGetting([]);setTheirPicksReq([]);setResult(null);}}
              style={{width:"100%",background:"transparent",border:"none",
                ...MONOSPACE,fontSize:10,color:targetTeam?"#f0f0f0":"#444",cursor:"pointer",outline:"none"}}>
              <option value="">Select a team...</option>
              {otherTeams.map(t=>{
                const st = TEAM_STATUS[t.abbr];
                return <option key={t.abbr} value={t.abbr}>{t.abbr} — {t.name}{st?` (${st.label})`:""}</option>;
              })}
            </select>
          </div>
          <div style={{display:"flex",gap:0,borderBottom:"1px solid #111",padding:"0 8px"}}>
            {tabBtn("Roster",theirTab==="roster",()=>setTheirTab("roster"))}
            {tabBtn(`Picks (${theirPicks.length})`,theirTab==="picks",()=>setTheirTab("picks"))}
          </div>

          {/* Selected players coming in */}
          {(getting.length>0||theirPicksReq.length>0) && (
            <div style={{padding:"10px 14px",background:"#050505",borderBottom:"1px solid #0d0d0d"}}>
              <div style={{...MONOSPACE,fontSize:8,color:"#333",textTransform:"uppercase",marginBottom:6}}>Receiving</div>
              {getting.map(p=>(
                <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <span style={{fontFamily:"Inter,sans-serif",fontSize:11,color:"#e0e0e0"}}>{p.name}</span>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <span style={{...MONOSPACE,fontSize:9,color:"#444"}}>{fmt$(p.salary)}</span>
                    <button onClick={()=>toggleGet(p)} style={{background:"transparent",border:"none",color:"#444",cursor:"pointer",fontSize:10}}>✕</button>
                  </div>
                </div>
              ))}
              {theirPicksReq.map(d=>(
                <div key={d} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <span style={{...MONOSPACE,fontSize:9,color:"#888"}}>{d}</span>
                  <button onClick={()=>toggleTheirPick(d)} style={{background:"transparent",border:"none",color:"#444",cursor:"pointer",fontSize:10}}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div style={{height:360,overflowY:"auto"}}>
            {!targetTeam ? (
              <div style={{padding:"32px 16px",textAlign:"center",color:"#333",...MONOSPACE,fontSize:9}}>Select a team to see their roster</div>
            ) : loadingTeam ? (
              <div style={{padding:"32px 16px",textAlign:"center",color:"#333",...MONOSPACE,fontSize:9}}>Loading...</div>
            ) : theirTab==="roster" ? theirRoster.map(p=>{
              const sel = !!getting.find(x=>x.id===p.id);
              return (
                <div key={p.id} onClick={()=>toggleGet(p)}
                  style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 14px",
                    borderBottom:"1px solid #080808",cursor:"pointer",
                    background:sel?"#0d0d0d":"transparent",transition:"background 0.1s"}}>
                  <div>
                    <div style={{fontFamily:"Inter,sans-serif",fontSize:11,color:sel?"#f0f0f0":"#888"}}>{p.name}</div>
                    <div style={{...MONOSPACE,fontSize:8,color:"#333",marginTop:2}}>{p.overall} OVR · {p.archetype}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{...MONOSPACE,fontSize:9,color:sel?"#888":"#333"}}>{fmt$(p.salary)}</div>
                    <div style={{...MONOSPACE,fontSize:8,color:"#222"}}>Age {p.age}</div>
                  </div>
                </div>
              );
            }) : (
              <div style={{padding:"12px 14px"}}>
                {theirPicks.length===0 && <div style={{...MONOSPACE,fontSize:9,color:"#333"}}>No 2026 picks</div>}
                {theirPicks.map(pk=>{
                  const sel = theirPicksReq.includes(pk.note);
                  return (
                    <div key={pk.note} onClick={()=>toggleTheirPick(pk.note)}
                      style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                        padding:"10px 0",borderBottom:"1px solid #080808",cursor:"pointer",
                        background:sel?"#0d0d0d":"transparent"}}>
                      <div>
                        <div style={{...MONOSPACE,fontSize:9,color:sel?"#f0f0f0":"#888"}}>Round {pk.round} · {pk.note || pk.from || ""}</div>
                        
                      </div>
                      <div style={{...MONOSPACE,fontSize:8,color:sel?"#888":"#333"}}>
                        {sel?"REQUESTED":"+ REQUEST"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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
        {section==="TRADE"       && <TradeSection saveId={saveId} roster={roster} state={state} />}
        {section==="FREE AGENTS" && <FASection saveId={saveId} state={state} onSign={()=>loadData(saveId)} />}
      </div>
    </div>
  );
}
