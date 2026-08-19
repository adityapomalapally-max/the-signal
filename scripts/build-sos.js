#!/usr/bin/env node

/**
 * The Signal — Strength of schedule by position
 *
 * Produces data/sos.json: how generous every defense was to each fantasy
 * position last season, and what that implies for each team's 2026 slate —
 * for the whole season, the opening month, and the fantasy playoff weeks.
 *
 * Two things this deliberately does not pretend to be:
 *
 *   1. A forecast of 2026 defenses. It is last season's result. Coordinators
 *      and secondaries turn over, and a unit can look completely different in
 *      September. Treated as a prior, not a projection.
 *   2. A measure of defensive quality. Fantasy points allowed moves with pace
 *      and game script as much as with talent — a defense whose offense goes
 *      down early faces more passes and concedes more. It is also unadjusted
 *      for the offenses each defense happened to face.
 *
 * Both are stated on the page. What it is good for is the comparative
 * question a drafter actually asks: of two similar receivers, whose schedule
 * opens softer.
 *
 * Runs daily alongside build-teams.
 */

const fs = require('fs');
const path = require('path');
const { fetchCSV, parseCSV } = require('./lib/match');
const seasonLib = require('./lib/season');
const { writeJSONIfChanged } = require('./lib/write');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA_DIR, 'sos.json');
// Derived, not typed. In August the only defensive results that exist are last
// season's, and that is what SOS has to be built on. Once a few weeks of the new
// season are played, LAST season's defences stop being the right answer — the
// coordinators, the personnel and the injuries have all moved — and continuing
// to publish them is a schedule strength describing teams that no longer exist.
//
// MIN_WEEKS_FOR_LIVE is the honest floor: four weeks of defensive results is a
// thin sample, but it is a sample of THIS season, and past it the current data
// beats the stale data. Below it, last season is still the better guess.
const MIN_WEEKS_FOR_LIVE = 4;
let SEASON = 2026;
let DEF_SEASON = 2025;
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const SEGMENTS = {
  early: { label: 'Weeks 1–4', from: 1, to: 4 },
  playoffs: { label: 'Weeks 15–17', from: 15, to: 17 }
};

const STATS_URL = s => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${s}.csv`;
const SCHEDULE_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';

const log = (m) => console.log(`[sos] ${m}`);
const r1 = (n) => Math.round(n * 10) / 10;

async function main() {
  const st = await seasonLib.state();
  SEASON = st.season;
  // The defensive season is this one once enough of it has been played, and
  // last one until then.
  const live = (st.phase === 'regular' || st.phase === 'post') && st.week > MIN_WEEKS_FOR_LIVE;
  DEF_SEASON = live ? st.season : await seasonLib.lastCompletedSeason();
  log(`schedule for ${SEASON}, defences from ${DEF_SEASON} (${live ? `${st.week} weeks played` : 'not enough of this season played yet'})`);

  log('=== SOS Start ===');

  log(`Fetching ${DEF_SEASON} weekly stats...`);
  const rows = parseCSV(await fetchCSV(STATS_URL(DEF_SEASON)));
  const totals = {};                 // "TEAM|POS" -> points conceded
  const weeksFaced = {};             // TEAM -> Set(weeks)
  for (const r of rows) {
    if (r.season_type !== 'REG') continue;
    if (!POSITIONS.includes(r.position) || !r.opponent_team) continue;
    const k = `${r.opponent_team}|${r.position}`;
    totals[k] = (totals[k] || 0) + (r.fantasy_points_ppr || 0);
    (weeksFaced[r.opponent_team] ||= new Set()).add(r.week);
  }
  const defenses = Object.keys(weeksFaced);
  if (defenses.length < 32) {
    log(`ABORT: only ${defenses.length} defenses found in ${DEF_SEASON}. Feed or schema moved.`);
    process.exit(1);
  }

  // Rank 1 = stingiest. A LOW rank is a hard matchup for that position.
  const defense = {};
  for (const pos of POSITIONS) {
    const perGame = defenses.map(t => ({
      team: t, v: r1((totals[`${t}|${pos}`] || 0) / weeksFaced[t].size)
    })).sort((a, b) => a.v - b.v);
    perGame.forEach((d, i) => {
      (defense[d.team] ||= {})[pos] = { perGame: d.v, rank: i + 1 };
    });
  }

  log('Fetching schedule...');
  const games = parseCSV(await fetchCSV(SCHEDULE_URL))
    .filter(g => g.season === SEASON && g.game_type === 'REG');
  const schedule = {};
  for (const g of games) {
    if (!g.away_team || !g.home_team) continue;
    (schedule[g.away_team] ||= []).push({ week: g.week, opp: g.home_team });
    (schedule[g.home_team] ||= []).push({ week: g.week, opp: g.away_team });
  }

  const teams = {};
  for (const [team, sched] of Object.entries(schedule)) {
    teams[team] = {};
    for (const pos of POSITIONS) {
      const pick = (from, to) => {
        const vals = sched.filter(g => g.week >= from && g.week <= to)
          .map(g => defense[g.opp] && defense[g.opp][pos])
          .filter(Boolean);
        if (!vals.length) return null;
        return {
          games: vals.length,
          avgRank: r1(vals.reduce((a, d) => a + d.rank, 0) / vals.length),
          avgPerGame: r1(vals.reduce((a, d) => a + d.perGame, 0) / vals.length)
        };
      };
      teams[team][pos] = {
        season: pick(1, 18),
        early: pick(SEGMENTS.early.from, SEGMENTS.early.to),
        playoffs: pick(SEGMENTS.playoffs.from, SEGMENTS.playoffs.to)
      };
    }
  }

  // League rank of each team's own season-long slate, so "12th easiest WR
  // schedule" is sayable rather than just an average of ranks.
  for (const pos of POSITIONS) {
    const order = Object.keys(teams)
      .filter(t => teams[t][pos].season)
      .sort((a, b) => teams[b][pos].season.avgRank - teams[a][pos].season.avgRank); // easiest first
    order.forEach((t, i) => { teams[t][pos].seasonEaseRank = i + 1; });
  }

  const out = {
    meta: {
      builtBy: 'scripts/build-sos.js',
      builtAt: new Date().toISOString(),
      season: SEASON,
      defenseSeason: DEF_SEASON,
      segments: SEGMENTS,
      scale: 'Defensive rank 1–32 where 1 conceded the fewest fantasy points to that position. ' +
        'A low opponent rank is a hard matchup; a high one is a soft matchup. Team ease rank is 1 = easiest slate.',
      caveats: `Defensive numbers are ${DEF_SEASON} results, not a ${SEASON} projection — coordinators and ` +
        `secondaries turn over and a unit can look nothing like this by September. Fantasy points allowed also ` +
        `moves with pace and game script as much as with talent: a defense whose offense falls behind faces more ` +
        `passes and concedes more. Nothing here is adjusted for the offenses each defense happened to face. ` +
        `Use it for the comparative question — of two similar players, whose schedule opens softer — not as a forecast.`
    },
    defense,
    teams
  };

  const wrote = writeJSONIfChanged(OUT, out);
  if (!wrote) log('unchanged — not rewritten');
  else log(`Wrote data/sos.json (${(fs.statSync(OUT).size / 1024).toFixed(0)}KB)`);
  for (const pos of POSITIONS) {
    const easiest = Object.entries(teams).filter(([, v]) => v[pos].seasonEaseRank === 1)[0];
    const hardest = Object.entries(teams).sort((a, b) => b[1][pos].seasonEaseRank - a[1][pos].seasonEaseRank)[0];
    log(`  ${pos}: easiest slate ${easiest[0]} (opp avg rank ${easiest[1][pos].season.avgRank}), ` +
        `hardest ${hardest[0]} (${hardest[1][pos].season.avgRank})`);
  }
  log('=== SOS Complete ===');
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
