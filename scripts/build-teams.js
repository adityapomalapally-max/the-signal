#!/usr/bin/env node

/**
 * The Signal — Team pages and the weekly schedule
 *
 * Produces data/teams.json: for every team, who is on the roster now, what
 * each of them actually did last season, and the full 2026 schedule.
 *
 * The question this answers is the one fantasy players ask most and the
 * site could not answer at all: who gets the ball in this offense.
 *
 * One honesty problem is built into it. The roster is TODAY'S roster, and
 * the production is LAST SEASON'S — so a player who moved carries numbers he
 * earned somewhere else. Rather than hide that, each player's production
 * records the team he produced it for, and the site marks anyone whose
 * numbers came from a different uniform.
 *
 * Also carries the schedule with results, so the site has a live week to
 * point at once games start. Before kickoff every result is null and the
 * current week is simply week 1.
 *
 * Runs daily — the roster moves, and in season the results do too.
 */

const fs = require('fs');
const path = require('path');
const { fetchCSV, parseCSV } = require('./lib/match');
const { writeJSONIfChanged } = require('./lib/write');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA_DIR, 'teams.json');
const SEASON = 2026;
const STATS_SEASON = 2025;        // the most recent completed season
const MIN_TEAMS = 30;

const SCHEDULE_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const TEAMS_URL = 'https://github.com/nflverse/nflverse-data/releases/download/teams/teams_colors_logos.csv';

const log = (m) => console.log(`[teams] ${m}`);
const r1 = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : null);

async function main() {
  log('=== Teams Start ===');

  const meta = parseCSV(await fetchCSV(TEAMS_URL));
  const teamInfo = new Map();
  for (const t of meta) {
    if (t.team_abbr) teamInfo.set(t.team_abbr, {
      name: t.team_name || t.team_abbr,
      nick: t.team_nick || null,
      conf: t.team_conf || null,
      division: t.team_division || null
    });
  }

  const games = parseCSV(await fetchCSV(SCHEDULE_URL))
    .filter(g => g.season === SEASON && g.game_type === 'REG');
  if (!games.length) {
    log(`ABORT: no ${SEASON} regular-season games in the schedule feed.`);
    process.exit(1);
  }

  const schedule = {};      // team -> [ {week, opp, home, date, result} ]
  const playedWeeks = {};   // season week -> whether any result exists
  for (const g of games) {
    const done = g.result !== null && g.result !== undefined && g.result !== '';
    playedWeeks[g.week] = playedWeeks[g.week] || done;
    for (const [team, opp, home] of [[g.away_team, g.home_team, false], [g.home_team, g.away_team, true]]) {
      if (!team) continue;
      (schedule[team] ||= []).push({
        week: g.week, opp, home, date: g.gameday || null,
        result: done ? (home ? g.result : -g.result) : null
      });
    }
  }
  for (const t of Object.keys(schedule)) schedule[t].sort((a, b) => a.week - b.week);

  // The live week: the first week that has not produced a result yet. Before
  // kickoff that is week 1, which is exactly right.
  const allWeeks = [...new Set(games.map(g => g.week))].sort((a, b) => a - b);
  const currentWeek = allWeeks.find(w => !playedWeeks[w]) || allWeeks[allWeeks.length - 1];

  // Which team a player actually produced for, from his own game log: his
  // opponent each week identifies the other side of that game.
  const opponentOf = new Map();
  for (const g of parseCSV(await fetchCSV(SCHEDULE_URL))) {
    if (g.game_type !== 'REG' || g.season !== STATS_SEASON) continue;
    opponentOf.set(`${g.week}|${g.home_team}`, g.away_team);
    opponentOf.set(`${g.week}|${g.away_team}`, g.home_team);
  }
  function producedFor(playerId) {
    let weekly;
    try {
      weekly = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'weekly', `${playerId}.json`), 'utf8'));
    } catch (e) { return null; }
    const votes = {};
    for (const g of (weekly[STATS_SEASON] || [])) {
      const t = opponentOf.get(`${g.week}|${g.opp}`);
      if (t) votes[t] = (votes[t] || 0) + 1;
    }
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
  }

  const players = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'players.json'), 'utf8'));
  const stats = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'stats.json'), 'utf8'));
  let ngs = {};
  try { ngs = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ngs.json'), 'utf8')); } catch (e) {}

  const teams = {};
  for (const p of players) {
    if (!p.team) continue;
    const s = stats[p.id] && stats[p.id].seasons && stats[p.id].seasons[STATS_SEASON];
    const n = ngs[p.id] && ngs[p.id][STATS_SEASON];
    const from = s ? producedFor(p.id) : null;
    const row = {
      id: p.id, name: p.name, pos: p.pos, age: p.age,
      status: p.status, statusClass: p.statusClass, fRank: p.fRank,
      games: s ? s.games : null,
      targets: s ? (s.targets ?? null) : null,
      tgtShare: s ? r1(s.tgtShare) : null,
      airYardShare: s ? r1(s.airYardShare) : null,
      carries: s ? (s.carries ?? null) : null,
      recYds: s ? (s.recYds ?? null) : null,
      rushYds: s ? (s.rushYds ?? null) : null,
      ppg: s ? r1(s.fantasyPPG) : null,
      snapPct: n ? (n.snapPct ?? null) : null,
      // null means he was here last season too, or we have no log for him.
      producedFor: from && from !== p.team ? from : null
    };
    ((teams[p.team] ||= { roster: [] }).roster).push(row);
  }

  const out = { meta: {
    builtBy: 'scripts/build-teams.js',
    builtAt: new Date().toISOString(),
    season: SEASON,
    statsSeason: STATS_SEASON,
    currentWeek,
    seasonStarted: Object.values(playedWeeks).some(Boolean),
    note: `Rosters are current. Production is ${STATS_SEASON}, and a player who changed teams carries the ` +
      `numbers he earned at his old one — those are marked.`
  }, teams: {} };

  for (const [abbr, t] of Object.entries(teams)) {
    const info = teamInfo.get(abbr) || {};
    // Order each position group by last season's usage, so the depth chart
    // reads as what actually happened rather than alphabetically.
    const order = (a, b) => (b.targets || b.carries || 0) - (a.targets || a.carries || 0) || (b.ppg || 0) - (a.ppg || 0);
    out.teams[abbr] = {
      abbr, name: info.name || abbr, nick: info.nick || null,
      conf: info.conf || null, division: info.division || null,
      schedule: schedule[abbr] || [],
      bye: (() => {
        const weeks = new Set((schedule[abbr] || []).map(g => g.week));
        for (const w of allWeeks) if (!weeks.has(w)) return w;
        return null;
      })(),
      roster: t.roster.sort(order)
    };
  }

  const n = Object.keys(out.teams).length;
  if (n < MIN_TEAMS) {
    log(`ABORT: only ${n} teams built (need ${MIN_TEAMS}). Roster or schedule feed moved.`);
    process.exit(1);
  }

  const wrote = writeJSONIfChanged(OUT, out);
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  const moved = Object.values(out.teams).reduce((a, t) => a + t.roster.filter(p => p.producedFor).length, 0);
  log(`${wrote ? 'Wrote' : 'Unchanged —'} data/teams.json: ${n} teams, ${kb}KB, current week ${currentWeek}, ${moved} players carrying another team's numbers`);
  log('=== Teams Complete ===');
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
