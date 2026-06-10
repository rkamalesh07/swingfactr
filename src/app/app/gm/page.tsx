"use client";
import { useState, useEffect, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "https://swingfactr-production.up.railway.app";
const SALARY_CAP = 140_000_000;
const LUXURY_TAX = 170_000_000;

type Player = {
  id: string; name: string; position: string; age: number; team: string;
  ppg: number; rpg: number; apg: number; mpg: number; gp: number;
  scoring: number; efficiency: number; playmaking: number;
  rebounding: number; defense: number; composure: number; ball_handling: number; overall: number;
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
  // LOTTERY (1-14)
  {rank:1, name:"AJ Dybantsa",       pos:"SF", school:"BYU",            ovr:62, pot:92, comp:"Jaylen Brown",         note:"Scoring wing with franchise-level tools. Three-level creator with elite competitive makeup. 25.5 PPG. Weaknesses are 3PT shooting, handle, and defensive engagement -- all coachable."},
  {rank:2, name:"Darryn Peterson",   pos:"PG", school:"Kansas",         ovr:60, pot:90, comp:"SGA",                  note:"Most gifted scorer and shotmaker in the class. Rare ability to make tough shots in flow and sustain hot streaks. Bizarre season at Kansas raises questions about consistency."},
  {rank:3, name:"Cameron Boozer",    pos:"PF", school:"Duke",           ovr:61, pot:88, comp:"Kevin Love",           note:"Most NBA-ready freshman ever. Led college basketball with 17.1 BPM, shot 39.1% from 3. Lacks verticality -- won't be an explosive finisher or shot blocker. Pairs best with a taller center."},
  {rank:4, name:"Caleb Wilson",      pos:"PF", school:"North Carolina", ovr:57, pot:86, comp:"Antonio McDyess",      note:"Special upside big. Upgraded motor elevated his profile. Open-floor ball-handling and passing are legit. Only 7-of-27 from 3 -- shooting is the swing skill."},
  {rank:5, name:"Keaton Wagler",     pos:"PG", school:"Illinois",       ovr:56, pot:84, comp:"Jamal Murray",         note:"Tall on-ball playmaker, uncanny floor processor. Led Illinois to Final Four. Late bloomer with obvious growth trajectory. No elite burst but changes speeds brilliantly."},
  {rank:6, name:"Darius Acuff Jr.",  pos:"PG", school:"Arkansas",       ovr:55, pot:83, comp:"Damian Lillard",       note:"Best PG in college basketball. 44% from 3 at 29.5% usage, 2.2 TOV. Creates at all three levels. Defensive framework a caveat -- no one in the NBA expects him to guard yet."},
  {rank:7, name:"Kingston Flemings", pos:"PG", school:"Houston",        ovr:54, pot:81, comp:"De'Aaron Fox",         note:"Explosive burst, elite speed. Shortest wingspan among projected first-round guards. Led combine in 3PT star drill. Top-5 in max vertical, agility, shuttle, sprint."},
  {rank:8, name:"Mikel Brown Jr.",   pos:"PG", school:"Louisville",     ovr:53, pot:80, comp:"Coby White",           note:"Nuclear scorer. Medically cleared after back injury. Regarded as top guard pre-season after Peterson. Positional size + shotmaking + passing vision are elite."},
  {rank:9, name:"Nate Ament",        pos:"SF", school:"Tennessee",      ovr:52, pot:79, comp:"Will Riley",           note:"Best wing measurements at combine: 6-9.5 barefoot, 6-11.5 wingspan. Inconsistent production polarized teams. Comfort with the ball and fluidity at his size are real."},
  {rank:10,name:"Brayden Burries",   pos:"SG", school:"Arizona",        ovr:51, pot:76, comp:"Derrick White",        note:"Three-level scorer, strong physical profile. Oldest freshman -- age may push him down. Needs to improve comfort on the ball. Elite downhill attacker."},
  {rank:11,name:"Aday Mara",         pos:"C",  school:"Michigan",       ovr:50, pot:82, comp:"Andrew Bogut",         note:"7-3 barefoot, 9-9 standing reach. Best passing big in years. 12.0 block% + 19.0 assist% at Michigan. Rare passing instincts for his size."},
  {rank:12,name:"Yaxel Lendeborg",   pos:"PF", school:"Michigan",       ovr:52, pot:74, comp:"Aaron Gordon",         note:"Rare versatility -- center-sized dimensions who guards all 5 positions. Late-blooming trajectory. Playoff-caliber archetype. Age (23) is the caveat."},
  {rank:13,name:"Karim Lopez",       pos:"PF", school:"NZ Breakers",    ovr:49, pot:77, comp:"Franz Wagner",         note:"6-8 international wing, second NBL season showed real growth. Physicality at the 4, spot-up shooting, ball-screen playmaking. Needs to improve as a creator."},
  {rank:14,name:"Labaron Philon",    pos:"PG", school:"Alabama",        ovr:50, pot:74, comp:"Dejounte Murray",      note:"Tight handle, creative scorer. Projects as sixth-man type. Improved shooting and finishing. Below-average athletic testing for a ball handler."},
  // FIRST ROUND LATE (15-30)
  {rank:15,name:"Hannes Steinbach",  pos:"PF", school:"Washington",     ovr:49, pot:72, comp:"Zach Collins",        note:"Best rebounder in the draft. 34% from 3. 6-10.25 barefoot. Bankable floor as a dependable rotation player. Not a prolific shot blocker."},
  {rank:16,name:"Morez Johnson Jr.", pos:"PF", school:"Michigan",       ovr:48, pot:70, comp:"Isaiah Stewart",      note:"6-9 barefoot with plus-6.5 wingspan. 17-of-25 from 3 at combine. 39.5 max vertical. Michigan champion. Defensive versatility is NBA-ready."},
  {rank:17,name:"Koa Peat",          pos:"PF", school:"Arizona",        ovr:46, pot:68, comp:"Rui Hachimura",       note:"Shooting mechanics are the swing skill. Bombed combine drills. Physical scorer, interior passer, defensive versatility. Final Four run was impressive."},
  {rank:18,name:"Bennett Stirtz",    pos:"PG", school:"Iowa",           ovr:50, pot:68, comp:"Malcolm Brogdon",     note:"One of the top shooters at the combine. Rotation-ready, elite IQ. Being a 23-year-old rookie will dissuade lottery teams. Shotmaking simply too advanced to write off."},
  {rank:19,name:"Christian Anderson",pos:"PG", school:"Texas Tech",     ovr:48, pot:67, comp:"Darius Garland",      note:"41.5% from 3, best shooter among late-lottery guards. 40.5 max vertical. Only 6-1 barefoot -- small end of spectrum. Natural playmaker compared to peers."},
  {rank:20,name:"Cameron Carr",      pos:"SG", school:"Baylor",         ovr:47, pot:69, comp:"Devin Vassell",       note:"42-inch max vertical, plus-8.25 wingspan. 30 points at combine scrimmage -- one of top performances in combine history. Limited playmaking and inconsistent defense cap ceiling."},
  {rank:21,name:"Chris Cenac Jr.",   pos:"PF", school:"Houston",        ovr:46, pot:68, comp:"Bobby Portis",        note:"19-year-old with 6-10 barefoot size, 7-5 wingspan. Projectable frame, fluid shooting mechanics. Polarizing production at Houston."},
  {rank:22,name:"Jayden Quaintance", pos:"C",  school:"Kentucky",       ovr:47, pot:74, comp:"Derrick Favors",      note:"7-5 wingspan. Elite defensive potential. ACL surgery last year -- medical status the key question. Only 18 years old. Threw down explosive dunks at pro day."},
  {rank:23,name:"Allen Graves",      pos:"PF", school:"Santa Clara",    ovr:45, pot:66, comp:"Boris Diaw",          note:"Strong analytics profile, feel for winning basketball. Athletic limitations well-documented. Trending toward top-20 after starting on the fringes of NBA radar."},
  {rank:24,name:"Dailyn Swain",      pos:"SF", school:"Texas",          ovr:45, pot:65, comp:"Herb Jones",          note:"Athletic wing, versatile defender. Perimeter shooting is the primary hole. Explosiveness, passing, and defensive playmaking all project well."},
  {rank:25,name:"Isaiah Evans",      pos:"SG", school:"Duke",           ovr:44, pot:64, comp:"Jordan Hawkins",      note:"6-5.5 barefoot, excellent size at 2-guard. Shoots well off movement. Below-average strength and foot speed may cap upside."},
  {rank:26,name:"Ebuka Okorie",      pos:"PG", school:"Stanford",       ovr:44, pot:64, comp:"Dennis Schroder",     note:"6-1.25 barefoot, 6-7.75 wingspan -- measurements eased size concerns. Finished 7th in nation in scoring as a freshman. Strong creator at the rim."},
  {rank:27,name:"Henri Veesaar",     pos:"C",  school:"North Carolina", ovr:44, pot:62, comp:"Nikola Vucevic",      note:"7-footer who hit 40 threes. Productive inside-out scorer. Doesn't block many shots for his size. Translatable scoring package."},
  {rank:28,name:"Meleek Thomas",     pos:"SG", school:"Arkansas",       ovr:43, pot:61, comp:"Jordan Clarkson",     note:"6-3 barefoot. Shooting versatility, dangerous pull-up and floater. Shared time with Acuff at Arkansas. Limited playmaking on show."},
  {rank:29,name:"Zuby Ejiofor",      pos:"C",  school:"St. John's",     ovr:43, pot:60, comp:"Jonathan Mogbo",      note:"Energy, physicality, and defensive activity. Face-up drives and post moves. St. John's champion."},
  {rank:30,name:"Joshua Jefferson",  pos:"PF", school:"Iowa State",     ovr:42, pot:59, comp:"Kyle Anderson",       note:"Complete player. Improved 3PT efficiency, passing stands out for a 6-9 forward. Physical around the basket, quick and smart defensively."},
  // SECOND ROUND (31-60)
  {rank:31,name:"Alex Karaban",      pos:"SF", school:"UConn",          ovr:55, pot:62, comp:"Sam Hauser",          note:"151 college games, three Final Fours. NBA-ready shooter, cutter, professional. Improved athletically at combine after weak 2024 results."},
  {rank:32,name:"Tarris Reed Jr.",   pos:"C",  school:"UConn",          ovr:52, pot:60, comp:"Day'Ron Sharpe",      note:"9.0 block%, 13.0 OREB%, 15.0 assist%. Rare stat combination. Strength, paint touch, passing, and rim protection."},
  {rank:33,name:"Luigi Suigo",       pos:"C",  school:"Italy (Mega)",   ovr:51, pot:61, comp:"Ryan Kalkbrenner",    note:"7-3 barefoot, 289 lbs, 9-6 reach. 18 3PM and 15.0 OREB% for Mega. Size combined with skill makes him an outlier. Villanova offer competing."},
  {rank:34,name:"Baba Miller",       pos:"PF", school:"Cincinnati",     ovr:50, pot:58, comp:"Jonathan Isaac",      note:"6-11 barefoot. Tested well in foot speed drills. 20 pts at combine scrimmage. Finishes like a big, handles like a wing."},
  {rank:35,name:"Trevon Brazile",    pos:"PF", school:"Arkansas",       ovr:49, pot:57, comp:"Obi Toppin",          note:"Improved shooting and driving complement the athleticism. Stretch-4/finisher archetype. Bet worth making on his three-ball."},
  {rank:36,name:"Jack Kayil",        pos:"PG", school:"ALBA Berlin",    ovr:48, pot:56, comp:"Cason Wallace",       note:"30.6 assist percentage in Germany. 1.7 3PM. Confident in projected range. Couldn't attend combine due to season still going."},
  {rank:37,name:"Braden Smith",      pos:"PG", school:"Purdue",         ovr:48, pot:55, comp:"Ish Smith",           note:"5-11 barefoot -- obvious physical limitation. Got to any spot in combine scrimmages. IQ and craftiness for creating for others are real NBA attributes."},
  {rank:38,name:"Sergio de Larrea",  pos:"SG", school:"Valencia (Spain)",ovr:47, pot:55, comp:"Bogdan Bogdanovic",  note:"Consecutive years of accurate 3PT shooting and strong playmaking. Producing in EuroLeague playoffs -- couldn't attend combine. Sure first-round consideration."},
  {rank:39,name:"Richie Saunders",   pos:"SG", school:"BYU",            ovr:46, pot:54, comp:"Ben Sheppard",        note:"Torn ACL ended his BYU career. Shooting specialist. Draft stock already established -- injury shouldn't change projection significantly."},
  {rank:40,name:"Jaden Bradley",     pos:"PG", school:"Arizona",        ovr:45, pot:53, comp:"Darren Collison",     note:"Point guard for a No. 1 seed. Two-way playmaker who can penetrate, make decisions, and cause defensive problems. Shooting keeps interest limited."},
  {rank:41,name:"Ryan Conwell",      pos:"SG", school:"Louisville",     ovr:44, pot:52, comp:"Ochai Agbaji",        note:"Measured 6-2 -- hurts projection as a non-playmaking guard. Off-ball scoring and shooting will keep him in second-round mix."},
  {rank:42,name:"Emanuel Sharp",     pos:"SG", school:"Houston",        ovr:44, pot:51, comp:"Eddie House",         note:"309 career threes at Houston. Shooting specialist. Equally potent in combine scrimmages. Specific but translatable role."},
  {rank:43,name:"Ugonna Onyenso",    pos:"C",  school:"Virginia",       ovr:43, pot:51, comp:"Christian Koloko",    note:"7-5 wingspan, 17.4 block%. 21 shots blocked in 3 ACC tournament games. Offensive limitations are significant but length is worth a late bet."},
  {rank:44,name:"Otega Oweh",        pos:"SG", school:"Kentucky",       ovr:42, pot:50, comp:"Norman Powell",       note:"35 points vs Santa Clara. Career highs in threes and assists. On/off-ball versatility and defense. Missing a true specialty skill."},
  {rank:45,name:"Ja'Kobi Gillespie", pos:"PG", school:"Tennessee",      ovr:42, pot:49, comp:"Marcus Sasser",       note:"Under 6-0 barefoot but 28 pts in combine scrimmage. Microwave shotmaking ability. Instant-offense guard off the bench."},
  {rank:46,name:"Dillon Mitchell",   pos:"PF", school:"St. John's",     ovr:41, pot:49, comp:"Herb Jones",          note:"Athleticism for finishing, strong passing instincts, defensive tools and motor. Glue-guy potential. May take a specific GM to see his value."},
  {rank:47,name:"Kylan Boswell",     pos:"PG", school:"Illinois",       ovr:40, pot:48, comp:"Cory Joseph",         note:"61% inside the arc, smart decisions. Top-graded pick-and-roll ball handler nationally. Not a reliable shooter yet."},
  {rank:48,name:"Tobi Lawal",        pos:"PF", school:"Virginia Tech",  ovr:39, pot:47, comp:"Derrick Jones Jr.",   note:"Near record-setting bounce. Athletic finishes and plays others can't make. Specialty big archetype."},
  {rank:49,name:"Milos Uzan",        pos:"PG", school:"Houston",        ovr:39, pot:47, comp:"Andrew Nembhard",     note:"Float game, passing IQ, backcourt versatility. 3PT% down this year but there's enough evidence of shotmaking to look past it."},
  {rank:50,name:"Bruce Thornton",    pos:"SG", school:"Ohio State",     ovr:38, pot:46, comp:"KJ Simpson",          note:"Well-rounded scoring guard -- creation and shooting. Improving each season. Undersized but won't be as worrisome late in second round."},
  {rank:51,name:"Izaiyah Nelson",    pos:"PF", school:"South Florida",  ovr:37, pot:46, comp:"Jordan Bell",         note:"Only NCAA player on record with 80 dunks, 3.0 stl%, 5.0 blk%. 6-9 with 7-3 wingspan. Specialty big who optimizes every inch."},
  {rank:52,name:"Nick Martinelli",   pos:"SF", school:"Northwestern",   ovr:37, pot:45, comp:"Chandler Hutchinson", note:"Top-10 scorer at 6-7, 41.7% from 3. Unorthodox but productive. Two strong combine scrimmages boosted stock."},
  {rank:53,name:"Aaron Nkrumah",     pos:"SG", school:"Tennessee State",ovr:36, pot:45, comp:"Keon Ellis",          note:"Impressed at G League Camp and NBA combine. Improved shooting, 3.0 APG, 2.8 SPG. Archetype for a two-way wing role."},
  {rank:54,name:"Felix Okpara",      pos:"C",  school:"Tennessee",      ovr:35, pot:45, comp:"Trey Jemison",        note:"6-10 barefoot, 237 lbs, 9-4 reach. Shot-blocking and finishing tools. Body type alone worth a late second-round bet."},
  {rank:55,name:"Maliq Brown",       pos:"PF", school:"Duke",           ovr:35, pot:44, comp:"Anton Watson",        note:"Nation's leader in defensive BPM. Productive in combine scrimmages. Limited offensively but instincts, passing, and finishing project."},
  {rank:56,name:"Rafael Castro",     pos:"C",  school:"George Washington",ovr:34, pot:44, comp:"Brice Johnson",     note:"6-11, 19.1 REB%, 3.7 STL%, 7.6 BLK%. Standout at Portsmouth. Quick bounce for cuts, rolls, and offensive boards."},
  {rank:57,name:"Duke Miles",        pos:"PG", school:"Vanderbilt",     ovr:34, pot:43, comp:"Miles McBride",       note:"Improved pull-up shooting and playmaking. Defensive pressure. More well-rounded offensive weapon creating in ball screens."},
  {rank:58,name:"Keyshawn Hall",     pos:"SF", school:"Auburn",         ovr:33, pot:43, comp:"Cleanthony Early",    note:"Incredibly efficient spot-up scorer. 20+ PPG in SEC. Age and poor defense hold him back -- but the shooting is real."},
  {rank:59,name:"Trey Kaufman-Renn", pos:"PF", school:"Purdue",         ovr:32, pot:42, comp:"Armando Bacot",       note:"Consistent senior production. Soft hands, instincts, and motor. Interior scoring, passing, and rebounding should translate."},
  {rank:60,name:"Bryce Hopkins",     pos:"SF", school:"St. John's",     ovr:31, pot:41, comp:"Stanley Johnson",     note:"Athletic wing, St. John's champion. Developing three-point shot. Role player floor with upside if shooting improves."},
  // LATE SECOND (61-70)
  {rank:61,name:"Nate Bittle",       pos:"C",  school:"Oregon",         ovr:30, pot:40, comp:"Drew Eubanks",        note:"7-0 center, Oregon. Mobile with a developing mid-range game."},
  {rank:62,name:"Tyler Bilodeau",    pos:"PF", school:"UCLA",           ovr:30, pot:40, comp:"Franz Wagner",        note:"Physical forward, UCLA. Productive senior."},
  {rank:63,name:"Graham Ike",        pos:"C",  school:"Gonzaga",        ovr:29, pot:39, comp:"Luke Kornet",         note:"6-9 senior big, Gonzaga. Efficient scorer with good hands."},
  {rank:64,name:"Trey Kaufman-Renn", pos:"PF", school:"Purdue",         ovr:29, pot:39, comp:"Caleb Martin",        note:"Senior wing, Purdue. Reliable spot-up shooter."},
  {rank:65,name:"Jaden Henley",      pos:"SF", school:"Grand Canyon",   ovr:28, pot:38, comp:"Kendall Brown",       note:"Athletic wing, Grand Canyon. Motor and athleticism stand out."},
  {rank:66,name:"Tucker DeVries",    pos:"SF", school:"Indiana",        ovr:28, pot:38, comp:"T.J. McConnell",      note:"Senior wing, Indiana. Reliable two-way player."},
  {rank:67,name:"Nick Martinelli",   pos:"SF", school:"Northwestern",   ovr:27, pot:37, comp:"Pat Connaughton",     note:"Senior, Northwestern. Unorthodox scorer."},
  {rank:68,name:"Seth Trimble",      pos:"PG", school:"North Carolina", ovr:27, pot:37, comp:"Chris Livingston",    note:"Senior guard, North Carolina. Steady rotation player."},
  {rank:69,name:"Tobi Lawal",        pos:"PF", school:"Virginia Tech",  ovr:26, pot:36, comp:"Thaddeus Young",      note:"Athletic wing, Virginia Tech."},
  {rank:70,name:"Tyler Nickel",      pos:"SG", school:"Vanderbilt",     ovr:26, pot:36, comp:"Sam Merrill",         note:"Senior shooter, Vanderbilt. Pure catch-and-shoot specialist."},
];

const TEAM_PICKS: Record<string, {round:number,from?:string,note:string,year?:number,protection?:string}[]> = {
  WSH:[
    {round:1,note:"Own #1 (lottery)"},
    {round:2,note:"NYK via HOU-OKC"},
    {round:2,note:"MIN via NYK-DET"},
    {round:2,note:"OKC via MIA-SAN"},
    {round:1,note:"Own",year:2027},{round:2,note:"Own",year:2027},
    {round:1,note:"Own",year:2028},{round:1,note:"Own",year:2029},
    {round:1,note:"Own",year:2030},{round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  UTAH:[
    {round:1,note:"Own #2"},
    {round:1,note:"Own",year:2027},{round:1,note:"Own",year:2028},{round:1,note:"Own",year:2029},
    {round:1,note:"Own",year:2030},{round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  MEM:[
    {round:1,note:"Own #3"},{round:1,note:"PHX #16 (via MEM swap)"},{round:2,note:"IND via MIL"},
    {round:1,note:"Own",year:2027},{round:1,note:"LAL 5-30",year:2027},{round:1,note:"UTH/CLE/MIN best",year:2027},
    {round:1,note:"Own",year:2028},{round:1,note:"Own",year:2029},{round:1,note:"Own",year:2030},
    {round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  CHI:[
    {round:1,note:"Own #4"},{round:1,note:"POR #15"},{round:2,note:"NO via POR-DET-BOS"},{round:2,note:"DEN via PHX-CHA"},
    {round:1,note:"Own",year:2027},{round:1,note:"Own",year:2028},{round:1,note:"Own",year:2029},
    {round:1,note:"Own",year:2030},{round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  LAC:[
    {round:1,note:"IND #5"},{round:2,note:"MEM via UTAH-ATL"},{round:2,note:"CLE"},
    {round:1,note:"Own (swap w/DEN/OKC)",year:2027,protection:"top-5 protected"},
    {round:1,note:"Own",year:2029,protection:"1-3 protected"},{round:1,note:"Own",year:2030},{round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  BKN:[
    {round:1,note:"Own #6"},{round:2,note:"Own #33"},{round:2,note:"LAC via HOU"},
    {round:1,note:"Own",year:2027},{round:1,note:"Own",year:2028},{round:1,note:"Own",year:2029},
    {round:1,note:"Own",year:2030},{round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  SAC:[
    {round:1,note:"Own #7"},{round:2,note:"Own #34"},{round:2,note:"CHA via NYK-ATL-SAN"},
    {round:1,note:"Own",year:2027},{round:1,note:"Own",year:2028},{round:1,note:"Own",year:2029},
    {round:1,note:"Own",year:2030},{round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  NO:[
    {round:2,note:"DET via LAC-ORL-PHX-BRK-NYK"},
    {round:1,note:"Own (top-4 protected to ATL)",year:2027,protection:"top-4 protected to ATL"},
    {round:1,note:"Own",year:2028},{round:1,note:"Own",year:2029},{round:1,note:"Own",year:2030},
    {round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  DAL:[
    {round:1,note:"Own #9"},{round:1,note:"OKC #30 via PHI-WAS"},{round:2,note:"PHX via WAS"},
    {round:1,note:"Own (3-30, else to CHA)",year:2027,protection:"1-2 to CHA"},{round:1,note:"Own",year:2028},
    {round:1,note:"Own",year:2029},{round:1,note:"Own",year:2030},{round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  MIL:[
    {round:1,note:"Own #10"},
    {round:1,note:"Own",year:2028},{round:1,note:"Own",year:2030},{round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  GS:[
    {round:1,note:"Own #11"},{round:2,note:"LAL via CLE-MIA-TOR"},
    {round:1,note:"Own",year:2027},{round:1,note:"Own",year:2028},{round:1,note:"Own",year:2029},
    {round:1,note:"Own (1-20, else to DAL)",year:2030},{round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  OKC:[
    {round:1,note:"LAC #12"},{round:1,note:"PHI #17"},{round:2,note:"DAL"},{round:2,note:"WAS via MIA-SAN"},
    {round:1,note:"OKC/DEN/LAC complex",year:2027},{round:1,note:"Own or swap DAL",year:2028},
    {round:1,note:"Own + DEN 6-30",year:2029},{round:1,note:"Own + DEN 6-30",year:2030},
    {round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  MIA:[
    {round:1,note:"Own #13"},{round:2,note:"GS via ATL-OKC-NYK-CHA"},
    {round:1,note:"Own (1-14, else to CHA)",year:2027,protection:"15-30 to CHA"},
    {round:1,note:"Own",year:2029},{round:1,note:"Own",year:2030},{round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  CHA:[
    {round:1,note:"Own #14"},{round:1,note:"ORL #18 via MEM swap"},
    {round:1,note:"Own + DAL 3-30 + MIA 15-30",year:2027},{round:1,note:"Own",year:2028},
    {round:1,note:"Own",year:2029},{round:1,note:"Own",year:2030},{round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  ATL:[
    {round:1,note:"NO #8 via SAN swap"},{round:1,note:"CLE #23 via SAN swap"},{round:2,note:"BOS #57"},
    {round:1,note:"Own (5-30, else complex)",year:2027},{round:1,note:"Own",year:2029},
    {round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  DET:[
    {round:1,note:"MIN #21 via DET swap"},
    {round:1,note:"Own",year:2027},{round:1,note:"Own",year:2028},{round:1,note:"Own",year:2029},
    {round:1,note:"Own",year:2030},{round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  PHI:[
    {round:2,note:"HOU #22 via OKC"},{round:2,note:"HOU #53"},
    {round:1,note:"Own",year:2027},{round:1,note:"Own (1-8 kept)",year:2028,protection:"9-30 complex"},
    {round:1,note:"Own or swap LAC 4-30",year:2029},{round:1,note:"Own",year:2030},
    {round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  DEN:[
    {round:1,note:"Own #26"},{round:2,note:"ATL via GOS-BRK"},
    {round:1,note:"Own (1-5 kept, 6-30 to OKC)",year:2027,protection:"top-5 protected"},
    {round:1,note:"Own (1-5 kept)",year:2028,protection:"top-5 protected"},
    {round:1,note:"Own (1-5 kept)",year:2029,protection:"top-5 protected"},
    {round:1,note:"Own (1-5 kept)",year:2030,protection:"top-5 protected"},
    {round:1,note:"Own",year:2032},
  ],
  CLE:[
    {round:2,note:"SAN #29 via SAN swap"},
    {round:1,note:"Own",year:2030},{round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  TOR:[
    {round:1,note:"Own #19"},{round:2,note:"Own #50"},
    {round:1,note:"Own",year:2027},{round:1,note:"Own",year:2028},{round:1,note:"Own",year:2029},
    {round:1,note:"Own",year:2030},{round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  ORL:[
    {round:2,note:"Own #46"},
    {round:1,note:"Own",year:2027},{round:1,note:"Own (1-2 kept)",year:2029,protection:"3-30 to MEM"},
    {round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  SA:[
    {round:1,note:"ATL #20 via SAN swap"},{round:2,note:"UTAH #35 via MIN"},{round:2,note:"POR #42 via NO"},
    {round:2,note:"MIA #44 via MIA-IND"},{round:2,note:"MIN #59 via MIA-IND"},
    {round:1,note:"ATL (via SAN swap)",year:2027},{round:1,note:"Own",year:2028},
    {round:1,note:"Own",year:2029},{round:1,note:"Own",year:2030},
    {round:1,note:"Own or swap SAC",year:2031},{round:1,note:"Own",year:2032},
  ],
  HOU:[
    {round:2,note:"CHI #39 via WAS"},{round:2,note:"Own #53"},
    {round:1,note:"Own or swap BRK",year:2027},{round:1,note:"Own",year:2028},
    {round:1,note:"Own",year:2029},{round:1,note:"Own",year:2030},
    {round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  NYK:[
    {round:1,note:"Own #24"},{round:2,note:"WAS #31 via HOU-OKC"},{round:2,note:"Own #55"},
    {round:1,note:"Own",year:2028},{round:1,note:"Own",year:2030},{round:1,note:"Own",year:2032},
  ],
  LAL:[
    {round:1,note:"Own #25"},
    {round:1,note:"Own (1-4 kept)",year:2027,protection:"5-30 to MEM"},
    {round:1,note:"Own",year:2028},{round:1,note:"Own",year:2030},
    {round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  PHX:[
    {round:2,note:"PHI #47 via OKC-HOU"},
    {round:1,note:"Own",year:2030},{round:1,note:"Own (frozen thru 27-28)",year:2032,protection:"frozen"},
  ],
  MIN:[
    {round:1,note:"DET #28 via DET swap"},{round:2,note:"SAN #59 via MIA-IND"},
    {round:1,note:"Own",year:2028},{round:1,note:"Own (1-5 kept)",year:2029,protection:"6-30 to UTH"},
    {round:1,note:"Own (1 kept)",year:2030,protection:"2-30 complex"},
    {round:1,note:"Own (frozen thru 27-28)",year:2032,protection:"frozen"},
  ],
  POR:[
    {round:1,note:"Own",year:2027},{round:1,note:"Own or swap MIL",year:2028},
    {round:1,note:"Own",year:2029},{round:1,note:"Own or swap MIL",year:2030},
    {round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  IND:[
    {round:1,note:"Own",year:2027},{round:1,note:"Own",year:2028},
    {round:1,note:"Own (traded to LAC)",year:2029},{round:1,note:"Own",year:2030},
    {round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
  BOS:[
    {round:1,note:"Own #27"},{round:2,note:"MIL #40 via ORL"},
    {round:1,note:"Own",year:2027},{round:1,note:"Own (2-30 or swap SAN)",year:2028},
    {round:1,note:"Own",year:2030},{round:1,note:"Own",year:2031},{round:1,note:"Own",year:2032},
  ],
};

const SEASON_RESULTS: Record<string,{w:number,l:number,result:string,note:string}> = {
  ATL:{w:38,l:44,result:"Lost R1",note:"Lost to NY Knicks in R1."},
  BOS:{w:52,l:30,result:"Lost R1",note:"Blew a 3-1 series lead to Philadelphia 76ers. Historic collapse for the defending champs."},
  BKN:{w:24,l:58,result:"Missed playoffs",note:"Missed playoffs for third straight season. Full rebuild mode."},
  CHA:{w:19,l:63,result:"Missed playoffs",note:"Lottery team. Rebuild continues."},
  CHI:{w:22,l:60,result:"Missed playoffs",note:"Missed playoffs for fourth straight season."},
  CLE:{w:64,l:18,result:"Lost ECF",note:"Swept by NY Knicks 4-0 in Eastern Conference Finals."},
  DAL:{w:43,l:39,result:"Missed playoffs",note:"Traded AD to WSH mid-season for picks. Rebuilding around Cooper Flagg (#1 pick 2025)."},
  DEN:{w:45,l:37,result:"Lost R1",note:"Lost to SA Spurs in Round 1."},
  DET:{w:42,l:40,result:"Lost R1",note:"Overcame 3-1 deficit vs Orlando in R1. Lost to Cleveland."},
  GS:{w:36,l:46,result:"Missed playoffs",note:"Play-in exit. Lost to LA Clippers in play-in elimination game."},
  HOU:{w:52,l:30,result:"Lost R1",note:"Lost to OKC in R1."},
  IND:{w:50,l:32,result:"Lost R2",note:"Lost to Cleveland in second round."},
  LAC:{w:41,l:41,result:"Missed playoffs",note:"Play-in exit. Beat GS then lost to PHX."},
  LAL:{w:50,l:32,result:"Lost R2",note:"Lost to SA Spurs in second round."},
  MEM:{w:46,l:36,result:"Lost R1",note:"Won play-in. Lost to OKC in Round 1."},
  MIA:{w:31,l:51,result:"Missed playoffs",note:"Missed playoffs. Play-in loss."},
  MIL:{w:30,l:52,result:"Missed playoffs",note:"Missed playoffs for first time since 2016."},
  MIN:{w:47,l:35,result:"Lost R1",note:"Lost to OKC in Round 1."},
  NO:{w:28,l:54,result:"Missed playoffs",note:"Lottery team."},
  NY:{w:51,l:31,result:"NBA Finals",note:"Lead SA Spurs 2-0 in NBA Finals. Jalen Brunson averaging 34 PPG. Seeking first title since 1973."},
  OKC:{w:68,l:14,result:"Lost WCF",note:"Best record in NBA. Lost to SA Spurs 4-3 in 7 games in WCF."},
  ORL:{w:47,l:35,result:"Lost R1",note:"Lost to Detroit after blowing a 3-1 series lead."},
  PHI:{w:25,l:57,result:"Lost R2",note:"Play-in team. Shocked Boston 4-3 overcoming 3-1 deficit. Lost to Cleveland in R2."},
  PHX:{w:34,l:48,result:"Missed playoffs",note:"Play-in exit. Lost to POR in play-in."},
  POR:{w:22,l:60,result:"Lost R1",note:"Won play-in vs PHX. Swept by OKC in Round 1."},
  SA:{w:62,l:20,result:"NBA Finals",note:"In NBA Finals vs NY Knicks. Trail 0-2. Beat OKC 4-3 in 7-game WCF."},
  SAC:{w:30,l:52,result:"Missed playoffs",note:"Missed playoffs for third consecutive season."},
  TOR:{w:24,l:58,result:"Missed playoffs",note:"Missed playoffs."},
  UTAH:{w:20,l:62,result:"Missed playoffs",note:"Full rebuild underway."},
  WSH:{w:18,l:64,result:"Missed playoffs",note:"Worst record in the East. #1 pick in the draft."},
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

function FranchiseSelect({ onSelect, backButton }: { onSelect: (saveId: string, abbr: string) => void; backButton?: React.ReactNode }) {
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
  const NAV = ["HOME","ROSTER","STANDINGS","PROSPECTS","TRADE","FREE AGENTS"];
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


// ─── NBA Season Calendar ───────────────────────────────────────────────────────
// Map game day (0=Oct 21 2025) to calendar date
function gameDayToDate(day: number): {month:number,day:number,year:number} {
  const start = new Date(2025, 9, 21); // Oct 21 2025
  const d = new Date(start.getTime() + day * 24*60*60*1000);
  return {month: d.getMonth()+1, day: d.getDate(), year: d.getFullYear()};
}
function dateToGameDay(month: number, day: number, year: number): number {
  const start = new Date(2025, 9, 21);
  const target = new Date(year, month-1, day);
  return Math.round((target.getTime()-start.getTime())/(24*60*60*1000));
}

// Key game days (hardcoded)
const GAME_DAYS = {
  preseasonStart:  dateToGameDay(10,2,2025),    // Oct 2
  preseasonEnd:    dateToGameDay(10,17,2025),   // Oct 17
  seasonStart:     dateToGameDay(10,21,2025),   // Oct 21
  seasonEnd:       dateToGameDay(4,12,2026),    // Apr 12
  playinStart:     dateToGameDay(4,14,2026),    // Apr 14
  playinEnd:       dateToGameDay(4,17,2026),    // Apr 17
  r1Start:         dateToGameDay(4,18,2026),    // Apr 18
  r2Start:         dateToGameDay(5,4,2026),     // May 4
  confFinalsStart: dateToGameDay(5,18,2026),    // May 18
  confFinalsEnd:   dateToGameDay(5,30,2026),    // May 30 (G7 if needed)
  finalsG1:        dateToGameDay(6,3,2026),     // Jun 3
  finalsG7:        dateToGameDay(6,19,2026),    // Jun 19 (if needed)
  draftLottery:    dateToGameDay(6,22,2026),    // Jun 22
  draftNight:      dateToGameDay(6,24,2026),    // Jun 24
  freeAgencyOpen:  dateToGameDay(6,30,2026),    // Jun 30
  freeAgencyEnd:   dateToGameDay(7,6,2026),     // Jul 6
  preseason2Start: dateToGameDay(10,2,2026),    // Oct 2 2026
  season2Start:    dateToGameDay(10,21,2026),   // Oct 21 2026
};

interface CalEvent {
  month:number; day:number; year:number;
  label:string; type:string;
  gameDay:number;
  action?:string;
  locked?:boolean;
}

function getCalendarEvents(currentGameDay: number): CalEvent[] {
  const ev: CalEvent[] = [
    {month:10,day:2,year:2025,label:"Preseason Begins",type:"preseason",gameDay:GAME_DAYS.preseasonStart},
    {month:10,day:17,year:2025,label:"Preseason Ends",type:"preseason",gameDay:GAME_DAYS.preseasonEnd},
    {month:10,day:21,year:2025,label:"Regular Season Opens",type:"season",gameDay:GAME_DAYS.seasonStart},
    {month:4,day:12,year:2026,label:"Regular Season Ends",type:"season",gameDay:GAME_DAYS.seasonEnd},
    {month:4,day:14,year:2026,label:"Play-In Tournament",type:"playin",gameDay:GAME_DAYS.playinStart},
    {month:4,day:17,year:2026,label:"Play-In Ends",type:"playin",gameDay:GAME_DAYS.playinEnd},
    {month:4,day:18,year:2026,label:"Playoffs R1",type:"playoffs",gameDay:GAME_DAYS.r1Start},
    {month:5,day:4,year:2026,label:"Second Round",type:"playoffs",gameDay:GAME_DAYS.r2Start},
    {month:5,day:18,year:2026,label:"Conf Finals",type:"playoffs",gameDay:GAME_DAYS.confFinalsStart},
    {month:6,day:3,year:2026,label:"NBA Finals G1",type:"finals",gameDay:GAME_DAYS.finalsG1},
    {month:6,day:22,year:2026,label:"Draft Lottery",type:"draft",gameDay:GAME_DAYS.draftLottery,action:"done"},
    {month:6,day:24,year:2026,label:"NBA Draft",type:"draft",gameDay:GAME_DAYS.draftNight,action:"DRAFT"},
    {month:6,day:30,year:2026,label:"Free Agency Opens",type:"fa",gameDay:GAME_DAYS.freeAgencyOpen,action:"FREE AGENTS"},
    {month:7,day:6,year:2026,label:"Free Agency Frenzy",type:"fa",gameDay:GAME_DAYS.freeAgencyEnd},
    {month:10,day:2,year:2026,label:"Preseason 2026-27",type:"preseason",gameDay:GAME_DAYS.preseason2Start},
    {month:10,day:21,year:2026,label:"Season 2026-27",type:"season",gameDay:GAME_DAYS.season2Start},
  ];
  // Conf Finals G7 -- only show if conf finals went to game 7 (day >= confFinalsEnd)
  if(currentGameDay >= GAME_DAYS.confFinalsEnd) {
    ev.push({month:5,day:30,year:2026,label:"Conf Finals G7",type:"playoffs",gameDay:GAME_DAYS.confFinalsEnd});
  }
  // Finals G7 -- only show if finals reached game 7 (day >= finalsG7)
  if(currentGameDay >= GAME_DAYS.finalsG7) {
    ev.push({month:6,day:19,year:2026,label:"NBA Finals G7",type:"finals",gameDay:GAME_DAYS.finalsG7});
  }
  return ev;
}

const MONTH_NAMES = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function NBACalendar({onNav, currentGameDay, onSimToDay}: {onNav:(s:string)=>void; currentGameDay:number; onSimToDay:(day:number)=>void}) {
  const MM = "'DM Mono',monospace";
  const [viewMonth, setViewMonth] = useState(6); // Start at June (current)
  const [viewYear, setViewYear] = useState(2026);

  function prevMonth() {
    if(viewMonth===1){setViewMonth(12);setViewYear(y=>y-1);}
    else setViewMonth(m=>m-1);
  }
  function nextMonth() {
    if(viewMonth===12){setViewMonth(1);setViewYear(y=>y+1);}
    else setViewMonth(m=>m+1);
  }

  // Get days in month
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const firstDay = new Date(viewYear, viewMonth-1, 1).getDay(); // 0=Sun

  // Events for this month -- filtered by current game day
  const allEvents = getCalendarEvents(currentGameDay);
  const monthEvents = allEvents.filter(e=>e.month===viewMonth&&e.year===viewYear);

  const TYPE_COLORS: Record<string,string> = {
    preseason:"#222",season:"#1a3a1a",playin:"#0d2040",
    playoffs:"#2a2000",finals:"#2a2a0d",draft:"#111",fa:"#2a0d0d",
  };
  const TYPE_DOT: Record<string,string> = {
    preseason:"#333",season:"#4bc87a",playin:"#6ab0e8",
    playoffs:"#c8a84b",finals:"#f0f0f0",draft:"#888",fa:"#c86060",
  };

  // Build day grid
  const cells: (number|null)[] = [];
  for(let i=0;i<firstDay;i++) cells.push(null);
  for(let d=1;d<=daysInMonth;d++) cells.push(d);
  while(cells.length%7!==0) cells.push(null);

  const todayDate = gameDayToDate(currentGameDay);

  return (
    <div style={{marginBottom:32,border:"1px solid #111",borderRadius:4,background:"#030303",overflow:"hidden"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
        padding:"12px 16px",borderBottom:"1px solid #0d0d0d"}}>
        <button onClick={prevMonth} style={{fontFamily:MM,fontSize:10,background:"transparent",
          border:"1px solid #1a1a1a",borderRadius:3,padding:"4px 10px",color:"#555",cursor:"pointer"}}>←</button>
        <div style={{fontFamily:MM,fontSize:10,color:"#888",textTransform:"uppercase",letterSpacing:"0.1em"}}>
          {MONTH_NAMES[viewMonth]} {viewYear}
        </div>
        <button onClick={nextMonth} style={{fontFamily:MM,fontSize:10,background:"transparent",
          border:"1px solid #1a1a1a",borderRadius:3,padding:"4px 10px",color:"#555",cursor:"pointer"}}>→</button>
      </div>

      {/* Day headers */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",borderBottom:"1px solid #080808"}}>
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=>(
          <div key={d} style={{fontFamily:MM,fontSize:7,color:"#333",textAlign:"center" as const,padding:"6px 0",
            textTransform:"uppercase" as const,letterSpacing:"0.06em"}}>{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>
        {cells.map((day,i)=>{
          const events = day ? monthEvents.filter(e=>e.day===day) : [];
          const isToday = day===todayDate.day&&viewMonth===todayDate.month&&viewYear===todayDate.year;
          return (
            <div key={i}
              onClick={()=>{
                if(!day) return;
                const targetDay = dateToGameDay(viewMonth, day, viewYear);
                if(targetDay > currentGameDay) onSimToDay(targetDay);
              }}
              style={{
                minHeight:72,borderRight:"1px solid #080808",borderBottom:"1px solid #080808",
                padding:"6px",background:events.length>0?TYPE_COLORS[events[0].type]:"transparent",
                opacity:day?1:0.3,
                cursor:day&&dateToGameDay(viewMonth,day,viewYear)>currentGameDay?"pointer":"default"}}>
              {day&&(
                <>
                  <div style={{fontFamily:MM,fontSize:8,marginBottom:4,fontWeight:isToday?600:400,
                    outline:isToday?"1px solid #f0f0f0":undefined,
                    borderRadius:isToday?2:0,padding:isToday?"1px 4px":undefined,display:"inline-block"}}>
                    {day}
                  </div>
                  {events.map((ev,ei)=>(
                    <div key={ei} style={{marginTop:2}}>
                      <div style={{display:"flex",alignItems:"center",gap:3}}>
                        <div style={{width:4,height:4,borderRadius:"50%",background:TYPE_DOT[ev.type],flexShrink:0}}/>
                        <div style={{fontFamily:MM,fontSize:6.5,color:TYPE_DOT[ev.type],
                          lineHeight:1.3,letterSpacing:"0.02em"}}>{ev.label}</div>
                      </div>
                      {(ev as any).action&&(ev as any).action!=="done"&&(
                        <button
                          onClick={()=>currentGameDay>=(ev as any).gameDay?onNav((ev as any).action):undefined}
                          style={{fontFamily:MM,fontSize:6,background:"transparent",
                            border:`1px solid ${currentGameDay>=(ev as any).gameDay?TYPE_DOT[ev.type]+"88":"#222"}`,
                            borderRadius:2,padding:"2px 5px",
                            color:currentGameDay>=(ev as any).gameDay?TYPE_DOT[ev.type]:"#333",
                            cursor:currentGameDay>=(ev as any).gameDay?"pointer":"not-allowed",
                            marginTop:2,textTransform:"uppercase" as const,letterSpacing:"0.06em"}}>
                          {currentGameDay>=(ev as any).gameDay?"GO →":"LOCKED"}
                        </button>
                      )}
                      {(ev as any).action==="done"&&(
                        <div style={{fontFamily:MM,fontSize:6,color:"#4bc87a",marginTop:2}}>✓ DONE</div>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{display:"flex",gap:16,padding:"10px 16px",borderTop:"1px solid #080808",flexWrap:"wrap" as const}}>
        {Object.entries(TYPE_DOT).map(([type,color])=>(
          <div key={type} style={{display:"flex",alignItems:"center",gap:4}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:color}}/>
            <span style={{fontFamily:MM,fontSize:7,color:"#333",textTransform:"uppercase" as const,letterSpacing:"0.06em"}}>
              {type==="fa"?"Free Agency":type==="playin"?"Play-In":type.charAt(0).toUpperCase()+type.slice(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExpiringPlayersSection({saveId, state, onResign}: {saveId:string; state:GMState; onResign:()=>void}) {
  const MM = "'DM Mono',monospace";
  const [expiring, setExpiring] = useState<any[]>([]);
  const [offer, setOffer] = useState<Record<string,{salary:number,years:number}>>({});
  const [result, setResult] = useState<Record<string,string>>({});
  const [signing, setSigning] = useState<string|null>(null);

  useEffect(()=>{
    if(!saveId) return;
    fetch(`${API}/gm/expiring-players/${saveId}?expired_only=true`)
      .then(r=>r.json()).then(d=>{
        setExpiring(d.expiring||[]);
        const init: Record<string,{salary:number,years:number}> = {};
        (d.expiring||[]).forEach((p:any)=>{
          init[p.id] = {salary: p.offer_salary, years: Math.min(p.max_years, 3)};
        });
        setOffer(init);
      }).catch(()=>{});
  },[saveId]);

  if(expiring.length === 0) return null;

  async function resign(p: any) {
    const o = offer[p.id];
    if(!o) return;
    setSigning(p.id);
    try {
      const res = await fetch(`${API}/gm/resign/${saveId}`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({player_id: p.id, salary: o.salary, years: o.years}),
      });
      const data = await res.json();
      setResult(prev => ({...prev, [p.id]: data.outcome || data.reason}));
      if(data.accepted) {
        setExpiring(prev => prev.filter(x => x.id !== p.id));
        onResign();
      }
    } catch(e:any) { setResult(prev=>({...prev,[p.id]:"Error"})); }
    finally { setSigning(null); }
  }

  function letWalk(p: any) {
    setExpiring(prev => prev.filter(x => x.id !== p.id));
  }

  return (
    <div style={{marginBottom:24,border:"1px solid #1a1a1a",borderRadius:4,background:"#030303",padding:"16px 20px"}}>
      <div style={{fontFamily:MM,fontSize:9,color:"#c8a84b",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>
        Re-sign Window — {expiring.length} Expired Contract{expiring.length!==1?"s":""}
      </div>
      <div style={{fontFamily:"Inter,sans-serif",fontSize:12,color:"#444",marginBottom:16}}>
        These players' contracts expired after the 2025-26 season. Re-sign them before free agency opens July 1.
      </div>
      {expiring.map(p=>(
        <div key={p.id} style={{borderTop:"1px solid #0d0d0d",paddingTop:12,marginTop:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{fontFamily:"Inter,sans-serif",fontSize:13,color:"#e0e0e0"}}>{p.name}</div>
                {p.years_left===0 && <span style={{fontFamily:"'DM Mono',monospace",fontSize:7,
                  background:"#1a0a0a",color:"#c86060",border:"1px solid #3a1a1a",
                  borderRadius:2,padding:"1px 5px",letterSpacing:"0.06em"}}>EXPIRED</span>}
                {p.years_left===1 && <span style={{fontFamily:"'DM Mono',monospace",fontSize:7,
                  background:"#0d0d00",color:"#c8a84b",border:"1px solid #2a2a00",
                  borderRadius:2,padding:"1px 5px",letterSpacing:"0.06em"}}>EXP '26-27</span>}
              </div>
              <div style={{fontFamily:MM,fontSize:8,color:"#555",marginTop:2}}>
                {p.archetype} · {p.overall} OVR · Age {p.age} · {p.bird_rights.replace("_"," ")} Bird Rights
              </div>
              <div style={{fontFamily:MM,fontSize:8,color:"#333",marginTop:2}}>
                Current: ${(p.salary/1e6).toFixed(1)}M · Max offer: ${(p.max_salary/1e6).toFixed(1)}M
              </div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <div style={{display:"flex",flexDirection:"column" as const,gap:4}}>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <span style={{fontFamily:MM,fontSize:8,color:"#444"}}>$/yr</span>
                  <input
                    type="range"
                    min={p.salary * 0.8}
                    max={p.max_salary}
                    step={500000}
                    value={offer[p.id]?.salary || p.offer_salary}
                    onChange={e=>setOffer(prev=>({...prev,[p.id]:{...prev[p.id],salary:parseInt(e.target.value)}}))}
                    style={{width:120,accentColor:"#f0f0f0"}}
                  />
                  <span style={{fontFamily:MM,fontSize:9,color:"#888",minWidth:40}}>
                    ${((offer[p.id]?.salary||p.offer_salary)/1e6).toFixed(1)}M
                  </span>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <span style={{fontFamily:MM,fontSize:8,color:"#444"}}>yrs</span>
                  {[1,2,3,4,5].filter(y=>y<=p.max_years).map(y=>(
                    <button key={y} onClick={()=>setOffer(prev=>({...prev,[p.id]:{...prev[p.id],years:y}}))}
                      style={{fontFamily:MM,fontSize:8,padding:"2px 8px",cursor:"pointer",
                        background:(offer[p.id]?.years||3)===y?"#f0f0f0":"transparent",
                        color:(offer[p.id]?.years||3)===y?"#000":"#444",
                        border:"1px solid #1a1a1a",borderRadius:2}}>
                      {y}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>resign(p)} disabled={signing===p.id}
                  style={{fontFamily:MM,fontSize:8,textTransform:"uppercase" as const,letterSpacing:"0.08em",
                    background:"#f0f0f0",color:"#000",border:"none",borderRadius:3,
                    padding:"6px 14px",cursor:"pointer"}}>
                  {signing===p.id?"...":"OFFER"}
                </button>
                <button onClick={()=>letWalk(p)}
                  style={{fontFamily:MM,fontSize:8,textTransform:"uppercase" as const,letterSpacing:"0.08em",
                    background:"transparent",color:"#555",border:"1px solid #1a1a1a",borderRadius:3,
                    padding:"6px 14px",cursor:"pointer"}}>
                  LET WALK
                </button>
              </div>
            </div>
          </div>
          {result[p.id] && (
            <div style={{fontFamily:MM,fontSize:9,color:"#888",marginTop:6}}>{result[p.id]}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function HomeSection({state, roster, onNav, saveId, onViewOffer}: {state:GMState; roster:Player[]; onNav:(s:string)=>void; saveId:string; onViewOffer:(offer:any)=>void}) {
  const result = SEASON_RESULTS[state.gm_team];
  const [offers, setOffers] = useState<any[]>([]);
  const [showAllOffers, setShowAllOffers] = useState(false);
  useEffect(()=>{
    if(!saveId) return;
    fetch(`${API}/gm/ai-trade-offers/${saveId}`)
      .then(r=>r.json()).then(d=>setOffers(d.offers||[])).catch(()=>{});
  },[saveId]);
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

      {/* AI Trade Offers */}
      {offers.length > 0 && (
        <div style={{marginBottom:24}}>
          {offers.slice(0, showAllOffers?offers.length:2).map((offer,i)=>(
            <div key={i} style={{border:"1px solid #1a1a1a",borderRadius:4,padding:"14px 18px",
              marginBottom:8,background:"#030303",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#c8a84b",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>
                  INCOMING TRADE OFFER · {offer.from_team} ({offer.from_team_status})
                </div>
                <div style={{fontFamily:"Inter,sans-serif",fontSize:12,color:"#888",marginBottom:4}}>{offer.message}</div>
                <div style={{display:"flex",gap:16,flexWrap:"wrap" as const}}>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#c86060"}}>
                    They want: {offer.they_want?.map((p:any)=>p.name).join(", ")}
                  </span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#4bc87a"}}>
                    They offer: {[
                      ...(offer.they_offer_players||[]).map((p:any)=>p.name),
                      ...(offer.they_offer_picks||[])
                    ].join(", ")}
                  </span>
                </div>
              </div>
              <button onClick={()=>{
                  // Pre-populate both sides of trade
                  const enriched = {...offer, they_offer_picks: offer.they_offer_picks||[], they_want_picks: offer.they_want_picks||[]};
                  onViewOffer(enriched);
                }}
                style={{fontFamily:"'DM Mono',monospace",fontSize:8,textTransform:"uppercase" as const,
                  letterSpacing:"0.08em",background:"transparent",border:"1px solid #333",
                  borderRadius:3,padding:"6px 14px",color:"#888",cursor:"pointer",whiteSpace:"nowrap" as const,marginLeft:16}}>
                VIEW →
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Re-sign Window -- only after draft */}
      <ExpiringPlayersSection saveId={saveId} state={state} onResign={()=>window.location.reload()} />

      {/* NBA Season Calendar */}
      <NBACalendar onNav={onNav} currentGameDay={state.day} onSimToDay={async (targetDay)=>{ await fetch(`${API}/gm/simulate/${saveId}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({days:targetDay-state.day})}); window.location.reload(); }} />

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
          <button onClick={()=>onNav("PROSPECTS")} style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",background:"transparent",border:"none",cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.08em",marginTop:8}}>FULL DRAFT BOARD →</button>
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
                {[["Scoring",p.scoring],["Ball Handling",p.ball_handling],["Efficiency",p.efficiency],["Playmaking",p.playmaking],["Rebounding",p.rebounding],["Defense",p.defense],["Composure",p.composure]].map(([l,v])=>(
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
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#555",marginTop:6}}>
                  Total: {fmt$((p as any).contract_years?.reduce((s:number,v:number)=>s+v,0) || p.salary*(p.years_left+1))}
                </div>
                {(p as any).contract_years && (p as any).contract_years.length > 1 && (
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#333",marginTop:4}}>
                    {(p as any).contract_years.map((v:number,i:number)=>(
                      <span key={i} style={{marginRight:8}}>{2026+i}: {fmt$(v)}</span>
                    ))}
                  </div>
                )}
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

function ProspectsSection({gmTeam, currentGameDay}: {gmTeam:string; currentGameDay:number}) {
  const MM = "'DM Mono',monospace";
  const draftDay = 246;
  const [watchlist, setWatchlist] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [selectedProspect, setSelectedProspect] = useState<typeof DRAFT_PROSPECTS[0]|null>(null);
  const [posFilter, setPosFilter] = useState("ALL");

  function toggleWatchlist(rank: number) {
    setWatchlist(prev => prev.includes(rank) ? prev.filter(r=>r!==rank) : [...prev,rank]);
  }

  const potColor = (pot: number) =>
    pot >= 88 ? "#f0d080" : pot >= 80 ? "#4bc87a" : pot >= 70 ? "#6ab0e8" : "#888";
  const potLabel = (pot: number) =>
    pot >= 88 ? "Franchise" : pot >= 80 ? "All-Star" : pot >= 70 ? "Starter" : "Role Player";

  const filtered = DRAFT_PROSPECTS.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.school.toLowerCase().includes(search.toLowerCase());
    const matchPos = posFilter==="ALL" || p.pos.includes(posFilter);
    return matchSearch && matchPos;
  });

  return (
    <div style={{maxWidth:1100,margin:"0 auto",padding:"24px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
        <div>
          <div style={{fontFamily:MM,fontSize:11,color:"#f0f0f0",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:4}}>2026 DRAFT PROSPECTS</div>
          <div style={{fontFamily:"Inter,sans-serif",fontSize:12,color:"#444"}}>
            {currentGameDay >= draftDay ? "Draft is live" : `${draftDay-currentGameDay} days until draft`}
            {watchlist.length>0 && <span style={{fontFamily:MM,fontSize:8,color:"#4bc87a",marginLeft:12}}>{watchlist.length} ON WATCHLIST</span>}
          </div>
        </div>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search prospects..."
          style={{flex:1,background:"#080808",border:"1px solid #1a1a1a",borderRadius:3,
            padding:"8px 12px",color:"#e0e0e0",fontFamily:"Inter,sans-serif",fontSize:13,outline:"none"}}/>
        {["ALL","G","F","C"].map(f=>(
          <button key={f} onClick={()=>setPosFilter(f)}
            style={{fontFamily:MM,fontSize:8,padding:"6px 12px",border:"1px solid #1a1a1a",borderRadius:3,
              background:posFilter===f?"#f0f0f0":"transparent",color:posFilter===f?"#000":"#444",cursor:"pointer"}}>
            {f}
          </button>
        ))}
        <span style={{fontFamily:MM,fontSize:8,color:"#333"}}>{filtered.length} available</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:16,alignItems:"start"}}>
        <div style={{border:"1px solid #111",borderRadius:4,overflow:"hidden"}}>
          <div style={{display:"grid",gridTemplateColumns:"40px 1fr 50px 100px 55px 55px 90px",
            padding:"8px 12px",borderBottom:"1px solid #0d0d0d",background:"#030303"}}>
            {["#","PLAYER","POS","SCHOOL","NOW","POT",""].map((h,i)=>(
              <div key={i} style={{fontFamily:MM,fontSize:7,color:"#333",textTransform:"uppercase" as const,letterSpacing:"0.06em"}}>{h}</div>
            ))}
          </div>
          <div style={{maxHeight:600,overflowY:"auto" as const}}>
            {filtered.map(p=>{
              const onWatch = watchlist.includes(p.rank);
              const sel = selectedProspect?.rank===p.rank;
              return (
                <div key={p.rank} onClick={()=>setSelectedProspect(sel?null:p)}
                  style={{display:"grid",gridTemplateColumns:"40px 1fr 50px 100px 55px 55px 90px",
                    padding:"9px 12px",borderBottom:"1px solid #060606",cursor:"pointer",
                    background:onWatch?"#0d1a0d":sel?"#0d0d0d":"transparent"}}>
                  <div style={{fontFamily:MM,fontSize:9,color:"#444"}}>{p.rank}</div>
                  <div>
                    <div style={{fontFamily:"Inter,sans-serif",fontSize:12,color:onWatch?"#4bc87a":"#e0e0e0"}}>{p.name}</div>
                    <div style={{fontFamily:MM,fontSize:7,color:"#333",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const}}>{p.note?.slice(0,55)}{(p.note?.length||0)>55?"...":""}</div>
                  </div>
                  <div style={{fontFamily:MM,fontSize:9,color:"#555"}}>{p.pos}</div>
                  <div style={{fontFamily:"Inter,sans-serif",fontSize:10,color:"#444",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const}}>{p.school}</div>
                  <div style={{fontFamily:MM,fontSize:10,color:"#888"}}>{p.ovr}</div>
                  <div style={{fontFamily:MM,fontSize:10,color:potColor(p.pot)}}>{p.pot}</div>
                  <div onClick={e=>{e.stopPropagation();toggleWatchlist(p.rank);}}>
                    <div style={{fontFamily:MM,fontSize:7,textTransform:"uppercase" as const,
                      color:onWatch?"#4bc87a":"#333",border:`1px solid ${onWatch?"#1a3a1a":"#1a1a1a"}`,
                      borderRadius:2,padding:"3px 6px",cursor:"pointer",textAlign:"center" as const,
                      background:onWatch?"#0a1a0a":"transparent"}}>
                      {onWatch?"LISTED":"+ WATCH"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{border:"1px solid #111",borderRadius:4,background:"#030303",padding:"16px",position:"sticky" as const,top:16}}>
          {!selectedProspect ? (
            <div>
              <div style={{fontFamily:MM,fontSize:8,color:"#444",textTransform:"uppercase",marginBottom:12}}>WATCHLIST ({watchlist.length})</div>
              {watchlist.length===0&&<div style={{fontFamily:MM,fontSize:9,color:"#222",marginBottom:8}}>Click + WATCH to add prospects</div>}
              {watchlist.map(rank=>{
                const p=DRAFT_PROSPECTS.find(x=>x.rank===rank);
                if(!p) return null;
                return (
                  <div key={rank} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                    marginBottom:6,padding:"8px 10px",border:"1px solid #1a3a1a",borderRadius:3,background:"#0a1a0a",cursor:"pointer"}}
                    onClick={()=>setSelectedProspect(p)}>
                    <div>
                      <div style={{fontFamily:"Inter,sans-serif",fontSize:12,color:"#4bc87a"}}>{p.name}</div>
                      <div style={{fontFamily:MM,fontSize:7,color:"#444"}}>#{p.rank} · {p.pos} · {p.ovr} OVR</div>
                    </div>
                    <button onClick={e=>{e.stopPropagation();toggleWatchlist(rank);}}
                      style={{background:"transparent",border:"none",color:"#333",cursor:"pointer"}}>x</button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div>
              <button onClick={()=>setSelectedProspect(null)}
                style={{fontFamily:MM,fontSize:7,background:"transparent",border:"none",color:"#444",cursor:"pointer",marginBottom:12}}>back</button>
              <div style={{fontFamily:MM,fontSize:7,color:"#444",textTransform:"uppercase",marginBottom:6}}>#{selectedProspect.rank} · {selectedProspect.pos}</div>
              <div style={{fontFamily:"Inter,sans-serif",fontSize:18,color:"#f0f0f0",fontWeight:600,marginBottom:2}}>{selectedProspect.name}</div>
              <div style={{fontFamily:MM,fontSize:8,color:"#555",marginBottom:16}}>{selectedProspect.school}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
                {[
                  {label:"Current",val:selectedProspect.ovr,color:"#888"},
                  {label:"Potential",val:selectedProspect.pot,color:potColor(selectedProspect.pot)},
                  {label:"Ceiling",val:potLabel(selectedProspect.pot),color:potColor(selectedProspect.pot)},
                  {label:"Comp",val:(selectedProspect as any).comp||"TBD",color:"#6ab0e8"},
                ].map(item=>(
                  <div key={item.label} style={{border:"1px solid #111",borderRadius:3,padding:"10px"}}>
                    <div style={{fontFamily:MM,fontSize:7,color:"#333",marginBottom:4}}>{item.label}</div>
                    <div style={{fontFamily:MM,fontSize:10,color:item.color}}>{String(item.val)}</div>
                  </div>
                ))}
              </div>
              {selectedProspect.note&&(
                <div style={{border:"1px solid #1a1a1a",borderRadius:3,padding:"10px",marginBottom:12,background:"#050505"}}>
                  <div style={{fontFamily:MM,fontSize:7,color:"#333",textTransform:"uppercase",marginBottom:4}}>SCOUTING</div>
                  <div style={{fontFamily:"Inter,sans-serif",fontSize:11,color:"#555",lineHeight:1.5}}>{selectedProspect.note}</div>
                </div>
              )}
              <button onClick={()=>toggleWatchlist(selectedProspect.rank)}
                style={{width:"100%",fontFamily:MM,fontSize:8,textTransform:"uppercase" as const,letterSpacing:"0.08em",
                  background:watchlist.includes(selectedProspect.rank)?"#0a1a0a":"transparent",
                  color:watchlist.includes(selectedProspect.rank)?"#4bc87a":"#888",
                  border:`1px solid ${watchlist.includes(selectedProspect.rank)?"#1a3a1a":"#333"}`,
                  borderRadius:3,padding:"8px",cursor:"pointer"}}>
                {watchlist.includes(selectedProspect.rank)?"ON WATCHLIST":"+ ADD TO WATCHLIST"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
    const teamStatus = TEAM_STATUS[team];
    const isRebuilding = teamStatus?.label === "Rebuilding" || teamStatus?.label === "Rising";
    const isContender = teamStatus?.label === "Contender" || teamStatus?.label === "Dynasty";

    const avail = available.filter(p => !draftLog.find(d => d.prospect?.name === p.name));
    if (avail.length === 0) return available[0];

    const rand = Math.random();

    // Rebuilding teams: 40% chance draft for highest POT regardless of fit
    if (isRebuilding && rand < 0.40) {
      const byPot = [...avail].sort((a,b) => ((b as any).pot||b.ovr) - ((a as any).pot||a.ovr));
      const pool = byPot.slice(0, Math.max(2, Math.floor(slot * 0.3)));
      return pool[Math.floor(Math.random() * pool.length)];
    }

    // Contenders: 35% chance draft for immediate fit (OVR focused, position need)
    if (isContender && rand < 0.35) {
      const byFit = avail.filter(p => needs.includes(p.pos)).slice(0, 4);
      if (byFit.length > 0) return byFit[Math.floor(Math.random() * Math.min(2, byFit.length))];
    }

    // Occasional reach: 15% chance team falls in love with a prospect 3-8 spots lower
    if (rand < 0.15 && slot > 5) {
      const reachPool = avail.slice(2, Math.min(8, avail.length));
      if (reachPool.length > 0) return reachPool[Math.floor(Math.random() * reachPool.length)];
    }

    // Occasional need pick: 25% chance draft for positional fit over BPA
    if (rand < 0.40) {
      const byNeed = avail.filter(p => needs[0] === p.pos).slice(0, 4);
      if (byNeed.length > 0) return byNeed[Math.floor(Math.random() * Math.min(2, byNeed.length))];
    }

    // Default: BPA from top of remaining board
    const bpaPool = avail.slice(0, Math.max(2, Math.floor(slot * 0.25)));
    return bpaPool[Math.floor(Math.random() * bpaPool.length)];
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
            {["#","NAME","POS","SCHOOL","NOW","POT",""].map((h,i)=>(
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
                <span style={{fontFamily:MM,fontSize:9,textAlign:"right",color:
      (p as any).pot >= 88 ? "#c8a84b" :
      (p as any).pot >= 80 ? "#4bc87a" :
      (p as any).pot >= 70 ? "#6ab0e8" : "#555"
    }}>{(p as any).pot || Math.min(99, p.ovr + 15)}</span>
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
function TradeSection({saveId, state, roster, pendingOffer, onOfferClear}: {saveId:string; state:GMState; roster:Player[]; pendingOffer?:any; onOfferClear?:()=>void}) {
  const MM = "'DM Mono',monospace";
  const [targetTeam, setTargetTeam]     = useState("");
  const [theirRoster, setTheirRoster]   = useState<Player[]>([]);
  const [theirPicks, setTheirPicks]     = useState<any[]>([]);
  const [giving, setGiving]             = useState<Player[]>([]);
  const [getting, setGetting]           = useState<Player[]>([]);
  const [myPicksOffered, setMyPicksOffered]   = useState<string[]>([]);
  const [theirPicksReq, setTheirPicksReq]     = useState<string[]>([]);
  const [result, setResult]             = useState<string|null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const [loadingTeam, setLoadingTeam]   = useState(false);
  const [myPicksFromDB, setMyPicksFromDB] = useState<any[]>([]);
  const [mySearch, setMySearch]         = useState("");
  const [theirSearch, setTheirSearch]   = useState("");

  const myPicks = myPicksFromDB.length > 0 ? myPicksFromDB : (TEAM_PICKS[state.gm_team] || []);

  useEffect(()=>{
    if(!saveId) return;
    fetch(`${API}/gm/picks/${saveId}`)
      .then(r=>r.json()).then(d=>setMyPicksFromDB(d.picks||[]))
      .catch(()=>{});
  },[saveId]);

  // Auto-populate from incoming offer
  useEffect(()=>{
    if(!pendingOffer) return;
    const team = pendingOffer.from_team;
    setTargetTeam(team);
    if(pendingOffer.they_want?.length) {
      const wantIds = pendingOffer.they_want.map((p:any)=>p.id).filter(Boolean);
      setGiving(roster.filter(p=>wantIds.includes(p.id) && p.years_left!==0));
    }
    if(pendingOffer.they_offer_picks?.length) setTheirPicksReq(pendingOffer.they_offer_picks);
    loadTeam(team);
    if(onOfferClear) onOfferClear();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[pendingOffer]);

  async function loadTeam(abbr: string) {
    if(!abbr){setTheirRoster([]);setTheirPicks([]);return;}
    setLoadingTeam(true);
    try {
      const [pr, pkr] = await Promise.all([
        fetch(`${API}/gm/league-players/${saveId}?limit=600`),
        fetch(`${API}/gm/picks/${saveId}?team=${abbr}`),
      ]);
      const pd = await pr.json();
      const pkd = await pkr.json();
      setTheirRoster(pd.players.filter((p:Player)=>p.team===abbr));
      setTheirPicks(pkd.picks||[]);
    } catch(e){console.error(e);}
    finally{setLoadingTeam(false);}
  }

  function toggleGive(p: Player) {
    if(p.years_left===0) return;
    setGiving(prev=>prev.find(x=>x.id===p.id)?prev.filter(x=>x.id!==p.id):[...prev,p]);
    setResult(null);
  }
  function toggleGet(p: Player) {
    if(p.years_left===0) return;
    setGetting(prev=>prev.find(x=>x.id===p.id)?prev.filter(x=>x.id!==p.id):[...prev,p]);
    setResult(null);
  }
  function toggleMyPick(note: string) {
    setMyPicksOffered(prev=>prev.includes(note)?prev.filter(n=>n!==note):[...prev,note]);
    setResult(null);
  }
  function toggleTheirPick(note: string) {
    setTheirPicksReq(prev=>prev.includes(note)?prev.filter(n=>n!==note):[...prev,note]);
    setResult(null);
  }

  const givingCap  = giving.reduce((s,p)=>s+p.salary,0);
  const gettingCap = getting.reduce((s,p)=>s+p.salary,0);
  const capAfter   = state.cap_used - givingCap + gettingCap;
  const maxIncoming = givingCap + 7_500_000;
  const salaryOK   = gettingCap <= maxIncoming;
  const isValid    = (giving.length>0||myPicksOffered.length>0) && (getting.length>0||theirPicksReq.length>0) && targetTeam!=="";

  async function evaluateTrade() {
    setSubmitting(true); setResult(null);
    try {
      const res = await fetch(`${API}/gm/trade/${saveId}`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          giving:giving.map(p=>p.id), getting:getting.map(p=>p.id),
          target_team:targetTeam, picks_offered:myPicksOffered, picks_requested:theirPicksReq,
        }),
      });
      const data = await res.json();
      setResult(data.result||data.error||"Unknown response");
      if(data.accepted){
        setGiving([]);setGetting([]);setMyPicksOffered([]);setTheirPicksReq([]);
        setTimeout(()=>window.location.reload(),1500);
      }
    } catch(e:any){setResult("Error: "+e.message);}
    finally{setSubmitting(false);}
  }

  const otherTeams = NBA_TEAMS.filter(t=>t.abbr!==state.gm_team);

  function PlayerRow({p, selected, onToggle, side}: {p:Player; selected:boolean; onToggle:()=>void; side:"give"|"get"}) {
    const expired = p.years_left===0;
    return (
      <div onClick={expired?undefined:onToggle}
        style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",
          borderBottom:"1px solid #060606",cursor:expired?"not-allowed":"pointer",
          background:selected?"#0d0d0d":"transparent",opacity:expired?0.3:1,
          transition:"background 0.1s"}}>
        <div style={{width:14,height:14,border:`1px solid ${selected?"#f0f0f0":"#222"}`,
          borderRadius:2,background:selected?"#f0f0f0":"transparent",flexShrink:0,
          display:"flex",alignItems:"center",justifyContent:"center"}}>
          {selected&&<div style={{width:8,height:8,background:"#000",borderRadius:1}}/>}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontFamily:"Inter,sans-serif",fontSize:12,color:selected?"#f0f0f0":"#888",
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const}}>{p.name}</span>
            {expired&&<span style={{...{fontFamily:MM},fontSize:7,color:"#c86060",border:"1px solid #3a1a1a",
              borderRadius:2,padding:"1px 4px"}}>EXP</span>}
          </div>
          <div style={{fontFamily:MM,fontSize:7,color:"#444",marginTop:1}}>
            {p.overall} OVR · {p.archetype} · Age {p.age}
          </div>
        </div>
        <div style={{fontFamily:MM,fontSize:8,color:"#555",textAlign:"right" as const}}>
          <div>${(p.salary/1e6).toFixed(1)}M</div>
          <div style={{fontSize:7,color:"#333"}}>{p.years_left}yr left</div>
        </div>
      </div>
    );
  }

  function PickRow({pk, selected, onToggle}: {pk:any; selected:boolean; onToggle:()=>void}) {
    const year = pk.year||2026;
    const isR1 = pk.round===1;
    return (
      <div onClick={onToggle}
        style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",
          borderBottom:"1px solid #060606",cursor:"pointer",
          background:selected?"#0d0d0d":"transparent",transition:"background 0.1s"}}>
        <div style={{width:14,height:14,border:`1px solid ${selected?"#f0f0f0":"#222"}`,
          borderRadius:2,background:selected?"#f0f0f0":"transparent",flexShrink:0,
          display:"flex",alignItems:"center",justifyContent:"center"}}>
          {selected&&<div style={{width:8,height:8,background:"#000",borderRadius:1}}/>}
        </div>
        <div style={{flex:1}}>
          <div style={{fontFamily:MM,fontSize:9,color:selected?"#f0f0f0":isR1?"#888":"#555"}}>
            {year} {pk.original_owner||state.gm_team} {isR1?"1st":"2nd"} Round
          </div>
          {pk.protection&&<div style={{fontFamily:MM,fontSize:7,color:"#444",marginTop:1}}>{pk.protection}</div>}
          {pk.acquired_from&&<div style={{fontFamily:MM,fontSize:7,color:"#c8a84b",marginTop:1}}>via {pk.acquired_from}</div>}
        </div>
        <div style={{fontFamily:MM,fontSize:7,color:isR1?"#666":"#444"}}>
          {isR1?"R1":"R2"}
        </div>
      </div>
    );
  }

  const myFiltered    = roster.filter(p=>p.name.toLowerCase().includes(mySearch.toLowerCase()));
  const theirFiltered = theirRoster.filter(p=>p.name.toLowerCase().includes(theirSearch.toLowerCase()));

  return (
    <div style={{maxWidth:1400,margin:"0 auto",padding:"24px 24px"}}>
      <div style={{fontFamily:MM,fontSize:9,color:"#333",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>TRADE MACHINE</div>
      <div style={{fontFamily:"Inter,sans-serif",fontSize:12,color:"#333",marginBottom:20}}>
        Real CBA: over cap +$7.5M max · first apron 110% · second apron must match
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 280px 1fr",gap:16,alignItems:"start"}}>

        {/* ── LEFT: My team ── */}
        <div style={{border:"1px solid #111",borderRadius:4,background:"#030303",overflow:"hidden"}}>
          <div style={{padding:"12px 14px",borderBottom:"1px solid #0d0d0d",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontFamily:MM,fontSize:10,color:"#f0f0f0"}}>{state.gm_team}</div>
            <div style={{fontFamily:MM,fontSize:8,color:"#c86060"}}>${(givingCap/1e6).toFixed(1)}M out</div>
          </div>

          {/* Selected summary */}
          {(giving.length>0||myPicksOffered.length>0) && (
            <div style={{padding:"8px 12px",background:"#050505",borderBottom:"1px solid #0d0d0d"}}>
              <div style={{fontFamily:MM,fontSize:7,color:"#444",textTransform:"uppercase",marginBottom:4}}>SENDING</div>
              {giving.map(p=>(
                <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                  <span style={{fontFamily:"Inter,sans-serif",fontSize:11,color:"#e0e0e0"}}>{p.name}</span>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontFamily:MM,fontSize:8,color:"#555"}}>${(p.salary/1e6).toFixed(1)}M</span>
                    <button onClick={()=>toggleGive(p)} style={{background:"transparent",border:"none",color:"#333",cursor:"pointer",fontSize:10}}>✕</button>
                  </div>
                </div>
              ))}
              {myPicksOffered.map(note=>(
                <div key={note} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                  <span style={{fontFamily:MM,fontSize:9,color:"#6ab0e8"}}>{note}</span>
                  <button onClick={()=>toggleMyPick(note)} style={{background:"transparent",border:"none",color:"#333",cursor:"pointer",fontSize:10}}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Tabs: Roster / Picks */}
          <TeamPanel
            label="ROSTER" picks={myPicks}
            players={myFiltered} selectedPlayers={giving}
            selectedPicks={myPicksOffered}
            onTogglePlayer={toggleGive} onTogglePick={toggleMyPick}
            search={mySearch} onSearch={setMySearch}
            teamAbbr={state.gm_team}
          />
        </div>

        {/* ── CENTER: Summary ── */}
        <div style={{display:"flex",flexDirection:"column" as const,gap:10,position:"sticky" as const,top:16}}>
          <div style={{border:"1px solid #111",borderRadius:4,background:"#030303",padding:"14px"}}>
            <div style={{fontFamily:MM,fontSize:8,color:"#333",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>Summary</div>
            {[
              {label:"Sending",val:`$${(givingCap/1e6).toFixed(1)}M`},
              {label:"Receiving",val:`$${(gettingCap/1e6).toFixed(1)}M`},
              {label:"Cap after",val:`$${(capAfter/1e6).toFixed(1)}M`,warn:capAfter>154_647_000},
            ].map(row=>(
              <div key={row.label} style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontFamily:MM,fontSize:8,color:"#444"}}>{row.label}</span>
                <span style={{fontFamily:MM,fontSize:9,color:(row as any).warn?"#ff8800":"#666"}}>{row.val}</span>
              </div>
            ))}
            <div style={{borderTop:"1px solid #0d0d0d",paddingTop:8,marginTop:8}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontFamily:MM,fontSize:8,color:"#444"}}>CBA</span>
                <span style={{fontFamily:MM,fontSize:8,color:salaryOK?"#4bc87a":"#c86060"}}>
                  {salaryOK?`✓ max $${(maxIncoming/1e6).toFixed(1)}M`:`✗ over limit`}
                </span>
              </div>
            </div>
          </div>

          {/* Team selector */}
          <select value={targetTeam}
            onChange={e=>{setTargetTeam(e.target.value);loadTeam(e.target.value);setGetting([]);setTheirPicksReq([]);setResult(null);}}
            style={{background:"#030303",border:"1px solid #111",borderRadius:4,
              padding:"10px 12px",color:targetTeam?"#e0e0e0":"#333",fontFamily:MM,fontSize:9,
              textTransform:"uppercase" as const,cursor:"pointer",width:"100%"}}>
            <option value="">Select team...</option>
            {otherTeams.map(t=>(
              <option key={t.abbr} value={t.abbr}>{t.abbr} — {t.name} ({TEAM_STATUS_MAP_FRONTEND[t.abbr]||""})</option>
            ))}
          </select>

          <button onClick={evaluateTrade} disabled={!isValid||submitting||!salaryOK}
            style={{fontFamily:MM,fontSize:9,fontWeight:600,textTransform:"uppercase" as const,letterSpacing:"0.1em",
              background:isValid&&salaryOK?"#f0f0f0":"#111",color:isValid&&salaryOK?"#000":"#333",
              border:"none",borderRadius:3,padding:"12px",cursor:isValid&&salaryOK?"pointer":"not-allowed",
              display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            {submitting&&<div style={{width:8,height:8,border:"1.5px solid #888",borderTopColor:"#000",borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>}
            {submitting?"EVALUATING...":pendingOffer?"ACCEPT OFFER":"PROPOSE TRADE"}
          </button>

          {result&&(
            <div style={{border:`1px solid ${result.includes("ACCEPTED")?"#1a3a1a":"#1a1a1a"}`,borderRadius:4,padding:"12px",background:result.includes("ACCEPTED")?"#030d03":"#030303"}}>
              <div style={{fontFamily:MM,fontSize:9,color:result.includes("ACCEPTED")?"#4bc87a":"#888",marginBottom:4}}>
                {result.split("—")[0].trim()}
              </div>
              {result.includes("—")&&(
                <div style={{fontFamily:"Inter,sans-serif",fontSize:11,color:"#555",lineHeight:1.5}}>
                  {result.split("—").slice(1).join("—").trim()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: Their team ── */}
        <div style={{border:"1px solid #111",borderRadius:4,background:"#030303",overflow:"hidden"}}>
          <div style={{padding:"12px 14px",borderBottom:"1px solid #0d0d0d",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontFamily:MM,fontSize:10,color:targetTeam?"#f0f0f0":"#333"}}>
              {targetTeam ? `${targetTeam} — ${NBA_TEAMS.find(t=>t.abbr===targetTeam)?.name||""} (${TEAM_STATUS_MAP_FRONTEND[targetTeam]||""})` : "Select a team..."}
            </div>
            {getting.length>0&&<div style={{fontFamily:MM,fontSize:8,color:"#4bc87a"}}>${(gettingCap/1e6).toFixed(1)}M in</div>}
          </div>

          {/* Selected summary */}
          {(getting.length>0||theirPicksReq.length>0) && (
            <div style={{padding:"8px 12px",background:"#050505",borderBottom:"1px solid #0d0d0d"}}>
              <div style={{fontFamily:MM,fontSize:7,color:"#444",textTransform:"uppercase",marginBottom:4}}>RECEIVING</div>
              {getting.map(p=>(
                <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                  <span style={{fontFamily:"Inter,sans-serif",fontSize:11,color:"#e0e0e0"}}>{p.name}</span>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontFamily:MM,fontSize:8,color:"#555"}}>${(p.salary/1e6).toFixed(1)}M</span>
                    <button onClick={()=>toggleGet(p)} style={{background:"transparent",border:"none",color:"#333",cursor:"pointer",fontSize:10}}>✕</button>
                  </div>
                </div>
              ))}
              {theirPicksReq.map(note=>(
                <div key={note} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                  <span style={{fontFamily:MM,fontSize:9,color:"#6ab0e8"}}>{note}</span>
                  <button onClick={()=>toggleTheirPick(note)} style={{background:"transparent",border:"none",color:"#333",cursor:"pointer",fontSize:10}}>✕</button>
                </div>
              ))}
            </div>
          )}

          {!targetTeam ? (
            <div style={{padding:"40px 20px",textAlign:"center" as const}}>
              <div style={{fontFamily:MM,fontSize:9,color:"#222"}}>Select a team above</div>
            </div>
          ) : loadingTeam ? (
            <div style={{padding:"40px 20px",textAlign:"center" as const}}>
              <div style={{fontFamily:MM,fontSize:9,color:"#333"}}>Loading...</div>
            </div>
          ) : (
            <TeamPanel
              label="ROSTER" picks={theirPicks}
              players={theirFiltered} selectedPlayers={getting}
              selectedPicks={theirPicksReq}
              onTogglePlayer={toggleGet} onTogglePick={toggleTheirPick}
              search={theirSearch} onSearch={setTheirSearch}
              teamAbbr={targetTeam}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const TEAM_STATUS_MAP_FRONTEND: Record<string,string> = {
  OKC:"Dynasty",BOS:"Contender",CLE:"Contender",NY:"Contender",
  SA:"Contender",DEN:"Contender",MIN:"Contender",MEM:"Rising",
  HOU:"Rising",ATL:"Rising",NO:"Rising",IND:"Retooling",
  DAL:"Retooling",LAL:"Retooling",MIL:"Retooling",PHX:"Retooling",
  SAC:"Retooling",GS:"Retooling",MIA:"Retooling",LAC:"Retooling",
  POR:"Rebuilding",DET:"Rebuilding",CHA:"Rebuilding",WSH:"Rebuilding",
  UTAH:"Rebuilding",BKN:"Rebuilding",TOR:"Rebuilding",CHI:"Rebuilding",
  ORL:"Rebuilding",PHI:"Rebuilding",
};

function TeamPanel({label, players, picks, selectedPlayers, selectedPicks, onTogglePlayer, onTogglePick, search, onSearch, teamAbbr}: {
  label:string; players:Player[]; picks:any[]; selectedPlayers:Player[]; selectedPicks:string[];
  onTogglePlayer:(p:Player)=>void; onTogglePick:(note:string)=>void;
  search:string; onSearch:(s:string)=>void; teamAbbr:string;
}) {
  const MM = "'DM Mono',monospace";
  const [tab, setTab] = useState<"players"|"picks">("players");

  // Sort: selected first, then by salary desc
  const sorted = [...players].sort((a,b)=>{
    const as = selectedPlayers.find(x=>x.id===a.id)?1:0;
    const bs = selectedPlayers.find(x=>x.id===b.id)?1:0;
    if(as!==bs) return bs-as;
    return b.salary-a.salary;
  });

  const picksSorted = [...picks].sort((a,b)=>{
    const ay = a.year||2026, by2 = b.year||2026;
    if(ay!==by2) return ay-by2;
    return a.round-b.round;
  });

  return (
    <div>
      <div style={{display:"flex",borderBottom:"1px solid #0d0d0d"}}>
        {(["players","picks"] as const).map(t=>(
          <button key={t} onClick={()=>setTab(t)}
            style={{flex:1,padding:"8px",fontFamily:MM,fontSize:8,textTransform:"uppercase" as const,
              letterSpacing:"0.08em",background:"transparent",border:"none",cursor:"pointer",
              color:tab===t?"#f0f0f0":"#333",borderBottom:tab===t?"1px solid #f0f0f0":"none"}}>
            {t==="players"?`ROSTER (${players.length})`:`PICKS (${picks.length})`}
          </button>
        ))}
      </div>
      {tab==="players"&&(
        <>
          <div style={{padding:"8px 12px",borderBottom:"1px solid #060606"}}>
            <input value={search} onChange={e=>onSearch(e.target.value)}
              placeholder="Search players..."
              style={{width:"100%",background:"transparent",border:"none",color:"#888",
                fontFamily:MM,fontSize:9,outline:"none",boxSizing:"border-box" as const}}/>
          </div>
          <div style={{maxHeight:480,overflowY:"auto" as const}}>
            {sorted.map(p=>{
              const sel = !!selectedPlayers.find(x=>x.id===p.id);
              return (
                <div key={p.id} onClick={p.years_left===0?undefined:()=>onTogglePlayer(p)}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",
                    borderBottom:"1px solid #060606",cursor:p.years_left===0?"not-allowed":"pointer",
                    background:sel?"#0d0d0d":"transparent",opacity:p.years_left===0?0.3:1}}>
                  <div style={{width:14,height:14,border:`1px solid ${sel?"#f0f0f0":"#1a1a1a"}`,
                    borderRadius:2,background:sel?"#f0f0f0":"transparent",flexShrink:0,
                    display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {sel&&<div style={{width:8,height:8,background:"#000",borderRadius:1}}/>}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:5}}>
                      <span style={{fontFamily:"Inter,sans-serif",fontSize:12,color:sel?"#f0f0f0":"#888",
                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const}}>{p.name}</span>
                      {p.years_left===0&&<span style={{fontFamily:MM,fontSize:6,color:"#c86060",border:"1px solid #3a1a1a",borderRadius:2,padding:"1px 3px"}}>EXP</span>}
                    </div>
                    <div style={{fontFamily:MM,fontSize:7,color:"#444",marginTop:1}}>
                      {p.overall} OVR · {p.archetype} · Age {p.age}
                    </div>
                  </div>
                  <div style={{fontFamily:MM,fontSize:8,color:"#555",textAlign:"right" as const,flexShrink:0}}>
                    <div>${(p.salary/1e6).toFixed(1)}M</div>
                    <div style={{fontSize:7,color:"#333"}}>{p.years_left}yr</div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {tab==="picks"&&(
        <div style={{maxHeight:480,overflowY:"auto" as const}}>
          {picksSorted.length===0&&<div style={{padding:"20px",fontFamily:MM,fontSize:9,color:"#222",textAlign:"center" as const}}>No picks</div>}
          {picksSorted.map((pk:any,i:number)=>{
            const sel = selectedPicks.includes(pk.note);
            const year = pk.year||2026;
            const isR1 = pk.round===1;
            const origOwner = pk.original_owner||teamAbbr;
            const label2 = `${year} ${origOwner} ${isR1?"1st":"2nd"}`;
            return (
              <div key={i} onClick={()=>onTogglePick(pk.note)}
                style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",
                  borderBottom:"1px solid #060606",cursor:"pointer",
                  background:sel?"#0d0d0d":"transparent"}}>
                <div style={{width:14,height:14,border:`1px solid ${sel?"#f0f0f0":"#1a1a1a"}`,
                  borderRadius:2,background:sel?"#f0f0f0":"transparent",flexShrink:0,
                  display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {sel&&<div style={{width:8,height:8,background:"#000",borderRadius:1}}/>}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontFamily:MM,fontSize:9,color:sel?"#f0f0f0":isR1?"#888":"#555"}}>{label2}</div>
                  {pk.protection&&<div style={{fontFamily:MM,fontSize:7,color:"#444",marginTop:1}}>{pk.protection}</div>}
                  {pk.acquired_from&&<div style={{fontFamily:MM,fontSize:7,color:"#c8a84b",marginTop:1}}>via {pk.acquired_from}</div>}
                </div>
                <div style={{fontFamily:MM,fontSize:7,color:isR1?"#555":"#333"}}>{isR1?"R1":"R2"}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


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


// ─── Save Manager ─────────────────────────────────────────────────────────────
interface SaveEntry {
  save_id: string;
  name: string;
  team: string;
  team_name: string;
  record: string;
  result: string;
  created: string;
  updated: string;
}

function SaveManager({onLoad, onNewGame}: {onLoad:(sid:string)=>void; onNewGame:()=>void}) {
  const MM = "'DM Mono',monospace";
  const [saves, setSaves] = useState<SaveEntry[]>([]);
  const [deleting, setDeleting] = useState<string|null>(null);

  useEffect(()=>{
    const raw = localStorage.getItem("gm_saves_index");
    if(raw) {
      try { setSaves(JSON.parse(raw)); } catch {}
    }
  },[]);

  function deleteSave(sid: string) {
    const updated = saves.filter(s=>s.save_id!==sid);
    setSaves(updated);
    localStorage.setItem("gm_saves_index", JSON.stringify(updated));
    // Also clean up the active save if it matches
    if(localStorage.getItem("gm_save_id")===sid) {
      localStorage.removeItem("gm_save_id");
      localStorage.removeItem("gm_team");
    }
    setDeleting(null);
  }

  const NBA_TEAM_NAMES: Record<string,string> = {
    ATL:"Hawks",BOS:"Celtics",BKN:"Nets",CHA:"Hornets",CHI:"Bulls",
    CLE:"Cavaliers",DAL:"Mavericks",DEN:"Nuggets",DET:"Pistons",GS:"Warriors",
    HOU:"Rockets",IND:"Pacers",LAC:"Clippers",LAL:"Lakers",MEM:"Grizzlies",
    MIA:"Heat",MIL:"Bucks",MIN:"Timberwolves",NO:"Pelicans",NY:"Knicks",
    OKC:"Thunder",ORL:"Magic",PHI:"76ers",PHX:"Suns",POR:"Trail Blazers",
    SA:"Spurs",SAC:"Kings",TOR:"Raptors",UTAH:"Jazz",WSH:"Wizards",
  };

  return (
    <div style={{minHeight:"100vh",background:"#000",color:"#f0f0f0",fontFamily:"Inter,sans-serif"}}>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* Header */}
      <div style={{borderBottom:"1px solid #0d0d0d",padding:"18px 32px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontFamily:MM,fontSize:11,color:"#f0f0f0",letterSpacing:"0.12em",textTransform:"uppercase"}}>
          SWINGFACTR / GM MODE
        </div>
        <button onClick={onNewGame}
          style={{fontFamily:MM,fontSize:9,textTransform:"uppercase",letterSpacing:"0.1em",
            background:"#f0f0f0",color:"#000",border:"none",borderRadius:3,
            padding:"8px 20px",cursor:"pointer"}}>
          + NEW GAME
        </button>
      </div>

      <div style={{maxWidth:900,margin:"0 auto",padding:"48px 32px",animation:"fadeIn 0.2s ease"}}>

        {saves.length === 0 ? (
          <div style={{textAlign:"center",paddingTop:80}}>
            <div style={{fontFamily:MM,fontSize:11,color:"#222",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:16}}>
              NO SAVED GAMES
            </div>
            <div style={{fontFamily:"Inter,sans-serif",fontSize:13,color:"#333",marginBottom:40}}>
              Start your first GM run below.
            </div>
            <button onClick={onNewGame}
              style={{fontFamily:MM,fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",
                background:"#f0f0f0",color:"#000",border:"none",borderRadius:3,
                padding:"12px 32px",cursor:"pointer"}}>
              START NEW GAME →
            </button>
          </div>
        ) : (
          <>
            <div style={{fontFamily:MM,fontSize:9,color:"#333",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:24}}>
              {saves.length} SAVED RUN{saves.length!==1?"S":""}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
              {[...saves].reverse().map(s=>(
                <div key={s.save_id}
                  style={{border:"1px solid #111",borderRadius:4,background:"#030303",
                    padding:"20px 20px 16px",cursor:"pointer",transition:"border-color 0.15s"}}
                  onMouseEnter={e=>(e.currentTarget.style.borderColor="#222")}
                  onMouseLeave={e=>(e.currentTarget.style.borderColor="#111")}
                  onClick={()=>onLoad(s.save_id)}>
                  <div style={{fontFamily:MM,fontSize:8,color:"#444",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>
                    {s.team} · {NBA_TEAM_NAMES[s.team]||s.team}
                  </div>
                  <div style={{fontFamily:"Inter,sans-serif",fontSize:16,color:"#e0e0e0",fontWeight:600,marginBottom:4}}>
                    {s.name || `${s.team} Run`}
                  </div>
                  <div style={{fontFamily:MM,fontSize:9,color:"#888",marginBottom:2}}>
                    {s.record} · {s.result}
                  </div>
                  <div style={{fontFamily:MM,fontSize:8,color:"#333",marginBottom:16}}>
                    {s.updated ? `Last played ${new Date(s.updated).toLocaleDateString()}` : s.created}
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontFamily:MM,fontSize:8,color:"#555",textTransform:"uppercase",letterSpacing:"0.06em"}}>
                      CLICK TO LOAD
                    </span>
                    {deleting===s.save_id ? (
                      <div style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
                        <button onClick={()=>deleteSave(s.save_id)}
                          style={{fontFamily:MM,fontSize:7,background:"#c86060",color:"#000",border:"none",
                            borderRadius:2,padding:"3px 8px",cursor:"pointer"}}>DELETE</button>
                        <button onClick={()=>setDeleting(null)}
                          style={{fontFamily:MM,fontSize:7,background:"transparent",color:"#555",
                            border:"1px solid #222",borderRadius:2,padding:"3px 8px",cursor:"pointer"}}>CANCEL</button>
                      </div>
                    ) : (
                      <button onClick={e=>{e.stopPropagation();setDeleting(s.save_id);}}
                        style={{fontFamily:MM,fontSize:7,background:"transparent",color:"#333",
                          border:"1px solid #111",borderRadius:2,padding:"3px 8px",cursor:"pointer",
                          textTransform:"uppercase",letterSpacing:"0.06em"}}>
                        DELETE
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {/* New game card */}
              <div onClick={onNewGame}
                style={{border:"1px dashed #111",borderRadius:4,background:"transparent",
                  padding:"20px",cursor:"pointer",display:"flex",flexDirection:"column",
                  alignItems:"center",justifyContent:"center",minHeight:140,transition:"border-color 0.15s"}}
                onMouseEnter={e=>(e.currentTarget.style.borderColor="#222")}
                onMouseLeave={e=>(e.currentTarget.style.borderColor="#111")}>
                <div style={{fontFamily:MM,fontSize:20,color:"#222",marginBottom:8}}>+</div>
                <div style={{fontFamily:MM,fontSize:9,color:"#333",textTransform:"uppercase",letterSpacing:"0.1em"}}>
                  NEW GAME
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── New Game Flow (name input → franchise select) ────────────────────────────
function NewGameFlow({onComplete, onBack}: {onComplete:(sid:string,abbr:string)=>void; onBack:()=>void}) {
  const MM = "'DM Mono',monospace";
  const [step, setStep] = useState<"name"|"franchise">("name");
  const [saveName, setSaveName] = useState("");

  if(step==="name") return (
    <div style={{minHeight:"100vh",background:"#000",color:"#f0f0f0",display:"flex",flexDirection:"column"}}>
      <div style={{borderBottom:"1px solid #0d0d0d",padding:"18px 32px",display:"flex",alignItems:"center",gap:16}}>
        <button onClick={onBack} style={{fontFamily:MM,fontSize:9,background:"transparent",color:"#444",
          border:"1px solid #111",borderRadius:3,padding:"6px 14px",cursor:"pointer",letterSpacing:"0.08em"}}>
          ← BACK
        </button>
        <div style={{fontFamily:MM,fontSize:11,color:"#f0f0f0",letterSpacing:"0.12em",textTransform:"uppercase"}}>
          NEW GAME
        </div>
      </div>
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{textAlign:"center",maxWidth:400}}>
          <div style={{fontFamily:MM,fontSize:9,color:"#444",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:16}}>
            NAME YOUR RUN
          </div>
          <input
            autoFocus
            value={saveName}
            onChange={e=>setSaveName(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&saveName.trim()&&setStep("franchise")}
            placeholder="e.g. Rebuild with WSH, Flagg Dynasty..."
            style={{width:"100%",background:"#080808",border:"1px solid #1a1a1a",borderRadius:3,
              padding:"12px 16px",color:"#e0e0e0",fontFamily:"Inter,sans-serif",fontSize:14,
              outline:"none",marginBottom:16,boxSizing:"border-box" as const}}
          />
          <button
            onClick={()=>saveName.trim()&&setStep("franchise")}
            disabled={!saveName.trim()}
            style={{fontFamily:MM,fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",
              background:saveName.trim()?"#f0f0f0":"#111",color:saveName.trim()?"#000":"#333",
              border:"none",borderRadius:3,padding:"10px 28px",cursor:saveName.trim()?"pointer":"default"}}>
            CHOOSE FRANCHISE →
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <FranchiseSelect
        onSelect={(sid, abbr)=>{
          // Save the name to the saves index
          const raw = localStorage.getItem("gm_saves_index");
          const existing: SaveEntry[] = raw ? JSON.parse(raw) : [];
          const result = SEASON_RESULTS[abbr];
          const entry: SaveEntry = {
            save_id: sid,
            name: saveName.trim() || `${abbr} Run`,
            team: abbr,
            team_name: abbr,
            record: result ? `${result.w}-${result.l}` : "0-0",
            result: result?.result || "",
            created: new Date().toLocaleDateString(),
            updated: new Date().toISOString(),
          };
          localStorage.setItem("gm_saves_index", JSON.stringify([...existing, entry]));
          onComplete(sid, abbr);
        }}
        backButton={
          <button onClick={()=>setStep("name")}
            style={{fontFamily:MM,fontSize:9,background:"transparent",color:"#444",
              border:"1px solid #111",borderRadius:3,padding:"6px 14px",cursor:"pointer",letterSpacing:"0.08em"}}>
            ← BACK
          </button>
        }
      />
    </>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function GMPage() {
  const [saveId, setSaveId] = useState<string|null>(null);
  const [state, setState] = useState<GMState|null>(null);
  const [roster, setRoster] = useState<Player[]>([]);
  const [section, setSection] = useState("HOME");
  const [pendingOffer, setPendingOffer] = useState<any>(null);
  const [screen, setScreen] = useState<"saves"|"new"|"game">("saves");
  const [initDone, setInitDone] = useState(false);

  useEffect(()=>{
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

  function handleLoad(sid: string) {
    localStorage.setItem("gm_save_id", sid);
    setSaveId(sid);
    setSection("HOME");
    setScreen("game");
  }

  function handleNewGameComplete(sid: string, abbr: string) {
    localStorage.setItem("gm_save_id", sid);
    setSaveId(sid);
    setSection("HOME");
    setScreen("game");
  }

  function handleReturnToSaves() {
    localStorage.removeItem("gm_save_id");
    setSaveId(null);
    setState(null);
    setRoster([]);
    setScreen("saves");
  }

  // Update save index with latest record when in game
  useEffect(()=>{
    if(!saveId || !state) return;
    const raw = localStorage.getItem("gm_saves_index");
    if(!raw) return;
    try {
      const saves: SaveEntry[] = JSON.parse(raw);
      const idx = saves.findIndex(s=>s.save_id===saveId);
      if(idx>=0) {
        const result = SEASON_RESULTS[state.gm_team];
        saves[idx] = {...saves[idx],
          record: `${state.wins||0}-${state.losses||0}`,
          result: result?.result||saves[idx].result,
          updated: new Date().toISOString(),
        };
        localStorage.setItem("gm_saves_index", JSON.stringify(saves));
      }
    } catch {}
  },[saveId, state]);

  if (!initDone) return null;

  if (screen==="saves") return <SaveManager onLoad={handleLoad} onNewGame={()=>setScreen("new")} />;
  if (screen==="new") return <NewGameFlow onComplete={handleNewGameComplete} onBack={()=>setScreen("saves")} />;
  if (!saveId || !state) return <SaveManager onLoad={handleLoad} onNewGame={()=>setScreen("new")} />;

  return (
    <div style={{minHeight:"100vh",background:"#000",color:"#f0f0f0"}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}} select option{background:#060606}`}</style>
      <TopBar state={state} section={section} onNav={setSection} onNewGame={handleReturnToSaves} />
      <div style={{animation:"fadeIn 0.2s ease"}}>
        {section==="HOME"        && <HomeSection state={state} roster={roster} onNav={setSection} saveId={saveId} onViewOffer={(o)=>{setPendingOffer(o);setSection('TRADE');}} />}
        {section==="ROSTER"      && <RosterSection saveId={saveId} roster={roster} state={state} onRosterChange={()=>loadData(saveId)} />}
        {section==="STANDINGS"   && <StandingsSection saveId={saveId} gmTeam={state.gm_team} />}
        {section==="PROSPECTS"   && <ProspectsSection gmTeam={state.gm_team} currentGameDay={state.day} />}
        {section==="DRAFT"       && state.day>=246 && <DraftSection gmTeam={state.gm_team} />}
        {section==="DRAFT"       && state.day<246  && <div style={{padding:"40px",textAlign:"center" as const,fontFamily:"'DM Mono',monospace",fontSize:10,color:"#333"}}>Draft unlocks June 24</div>}
        {section==="TRADE"       && <TradeSection saveId={saveId} roster={roster} state={state} pendingOffer={pendingOffer} onOfferClear={()=>setPendingOffer(null)} />}
        {section==="FREE AGENTS" && <FASection saveId={saveId} state={state} onSign={()=>loadData(saveId)} />}
      </div>
    </div>
  );
}
