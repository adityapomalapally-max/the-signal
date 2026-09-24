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
// MIN_WEEKS_FOR_LIVE is the floor, and the sentence that used to sit here —
// "past it the current data beats the stale data" — was an assertion nobody had
// checked. It is measured now, in research-matchup-stability.js, asked exactly
// as this line asks it: standing at week N, which better predicts what defences
// allow over the REST of the season, this year's N games or last year whole?
//
//   split 4      QB 0.19/0.20   RB 0.09/0.22   WR 0.15/0.03   TE 0.54/0.34
//                (this season / last season, Pearson r, 2024 and 2025)
//
// THIS SEASON WINS IN TWO POSITIONS OF FOUR, and by a hair on the mean (0.243
// against 0.199). Backs go the other way and not narrowly. So the switch stays
// at four — there is no evidence for moving it, which is different from there
// being evidence for it — and the claim beside it is now the measured one: at
// this point of a season the two priors are about equally weak, and the whole
// figure is a comparative reading rather than a forecast. Both numbers live
// under r = 0.25; nothing here predicts a defence.
const MIN_WEEKS_FOR_LIVE = 4;

/**
 * Whether to build on this season's defences, given how many weeks have
 * actually been PLAYED.
 *
 * It used to read Sleeper's week — `st.week > MIN_WEEKS_FOR_LIVE` — which is
 * the week about to be played and turns over on the Tuesday. So the switch
 * would have fired a week early, on four games while the log said six, the
 * third instance of the same confusion in this repo in two days. The rest of
 * this file already asks the schedule which games have results; so does this.
 */
function liveDefences(weeksPlayed) {
  return Number(weeksPlayed) >= MIN_WEEKS_FOR_LIVE;
}

/**
 * How many weeks of this season are in the books, from the schedule's own rows.
 *
 * A WEEK IS FINISHED WHEN NOTHING IN IT IS STILL TO COME, which is why this
 * counts up to the first unplayed game rather than counting played ones: on a
 * Tuesday the Monday night game has a result and the week is over; on a Sunday
 * evening half the week has results and the week is not. Counting rows with
 * results would call that half-week a week.
 *
 * A postponement moves the floor DOWN rather than up, which is the safe
 * direction: it means building on less rather than on a week nobody finished.
 */
function weeksPlayedFrom(games) {
  const open = games.filter(g => !String(g.result || '').trim()).map(g => Number(g.week))
    .filter(Number.isFinite);
  if (!open.length) return games.length ? Math.max(...games.map(g => Number(g.week) || 0)) : 0;
  return Math.max(0, Math.min(...open) - 1);
}
let SEASON = 2026;
let DEF_SEASON = 2025;
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const LAST_WEEK = 18;

/**
 * THE SEGMENTS MOVE WITH THE SEASON, because one of them was in the past.
 *
 * This published "Weeks 1–4" and called it the opening month all the way
 * through a season — so in week 4 the team pages offered a reader the schedule
 * strength of games that had already been played, beside a season-long figure
 * that was half history. Neither answers the only schedule question anybody has
 * once games start: whose slate is soft FROM HERE.
 *
 * So the opening month is a PRESEASON segment and rest-of-season replaces it
 * the moment a week is complete. The definitions are published in meta and the
 * page renders whatever it finds there, rather than carrying its own copy of
 * the words "Weeks 1–4" — which is how that label survived into October.
 */
function segmentsFor(week) {
  const playoffs = { label: 'Weeks 15–17', from: 15, to: 17 };
  // Sleeper's `week` is the one about to be played, so it is the first week
  // still ahead of a reader. Below 2 nothing has been played and the opening
  // month is genuinely the useful cut.
  if (!week || week < 2) return { early: { label: 'Weeks 1–4', from: 1, to: 4 }, playoffs };
  return {
    rest: { label: `Weeks ${week}–${LAST_WEEK}`, from: week, to: LAST_WEEK },
    playoffs,
  };
}
let SEGMENTS = segmentsFor(0);

const STATS_URL = s => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${s}.csv`;
const SCHEDULE_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';

const log = (m) => console.log(`[sos] ${m}`);
const r1 = (n) => Math.round(n * 10) / 10;

async function main() {
  const st = await seasonLib.state();
  SEASON = st.season;

  log('=== SOS Start ===');

  // THE SCHEDULE COMES FIRST because two decisions below depend on which games
  // have been played: which season's defences to build on, and where the
  // rest-of-season window starts. Both used to be taken from the calendar.
  log('Fetching schedule...');
  const games = parseCSV(await fetchCSV(SCHEDULE_URL))
    .filter(g => g.season === SEASON && g.game_type === 'REG');
  const weeksPlayed = weeksPlayedFrom(games);
  const firstOpen = weeksPlayed + 1;

  // The defensive season is this one once enough of it has been played, and
  // last one until then.
  const live = (st.phase === 'regular' || st.phase === 'post') && liveDefences(weeksPlayed);
  DEF_SEASON = live ? st.season : await seasonLib.lastCompletedSeason();
  log(`schedule for ${SEASON}, defences from ${DEF_SEASON} `
    + `(${weeksPlayed} week${weeksPlayed === 1 ? '' : 's'} played, floor is ${MIN_WEEKS_FOR_LIVE})`);

  log(`Fetching ${DEF_SEASON} weekly stats...`);
  const readDefenses = async (year) => {
    const rows = parseCSV(await fetchCSV(STATS_URL(year)));
    const totals = {};               // "TEAM|POS" -> points conceded
    const weeksFaced = {};           // TEAM -> Set(weeks)
    for (const r of rows) {
      if (r.season_type !== 'REG') continue;
      if (!POSITIONS.includes(r.position) || !r.opponent_team) continue;
      const k = `${r.opponent_team}|${r.position}`;
      totals[k] = (totals[k] || 0) + (r.fantasy_points_ppr || 0);
      (weeksFaced[r.opponent_team] ||= new Set()).add(r.week);
    }
    return { totals, weeksFaced, defenses: Object.keys(weeksFaced) };
  };

  // THE SWITCH IS MADE ON SLEEPER'S WEEK NUMBER AND THE DATA IS FETCHED FROM
  // NFLVERSE, AND THOSE ARE TWO DIFFERENT CLOCKS. `week > MIN_WEEKS_FOR_LIVE`
  // says the calendar has reached week five; it does not say nflverse has
  // finished publishing week four. Sleeper is already known to run ahead — it
  // called the 2026 season "regular, week 1" eleven days before anyone played.
  //
  // When the two disagreed, this aborted the process, which takes the WHOLE
  // daily run down and loses the day's data over a file that will be complete
  // by tomorrow. That is the same mistake build-environment made on 2026-09-10:
  // a guard that cannot tell "the feed moved" from "the season is young", and
  // answers both with a fatal.
  //
  // The fallback it needs already exists and is the entire point of
  // MIN_WEEKS_FOR_LIVE — below the floor, last season is the better guess. So a
  // thin live season now takes that path and says why. Only the completed
  // season coming up short is fatal, because that one really cannot be a
  // publication lag.
  let { totals, weeksFaced, defenses } = await readDefenses(DEF_SEASON);
  if (defenses.length < 32 && live) {
    const fallback = await seasonLib.lastCompletedSeason();
    log(`only ${defenses.length} defenses have played in ${DEF_SEASON} so far — not a moved feed, a young season. `
      + `Falling back to ${fallback}, the same call MIN_WEEKS_FOR_LIVE makes below the floor.`);
    DEF_SEASON = fallback;
    ({ totals, weeksFaced, defenses } = await readDefenses(DEF_SEASON));
  }
  if (defenses.length < 32) {
    log(`ABORT: only ${defenses.length} defenses found in ${DEF_SEASON}, a completed season. Feed or schema moved.`);
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

  // WHAT IS LEFT IS ASKED OF THE SCHEDULE, NOT OF THE CALENDAR. Sleeper's week
  // and the games that have actually been played are two clocks and they
  // disagree in both directions — Sleeper called the season "week 1" eleven
  // days before kickoff, and on the Tuesday after week 3 it still said week 3
  // with every week-3 game complete. A rest-of-season slate built on the second
  // reading includes a week nobody can still play.
  //
  // The schedule feed carries the result, and it is the same file the slate
  // itself is built from, so the window and the games cannot come apart. The
  // calendar is the fallback for a feed that has stopped publishing results.
  SEGMENTS = segmentsFor(firstOpen);
  log(`${games.filter(g => String(g.result || '').trim()).length} of ${games.length} games played; segments: `
    + Object.entries(SEGMENTS).map(([k, v]) => `${k} ${v.label}`).join(', '));
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
      // `season` stays whatever it always was — the whole slate, which in
      // season is half a record — because the preseason headline is built on it
      // and a team page still wants to say what the year looked like. What
      // changes is which segment LEADS, and that is decided below.
      teams[team][pos] = { season: pick(1, LAST_WEEK) };
      for (const [key, seg] of Object.entries(SEGMENTS)) {
        teams[team][pos][key] = pick(seg.from, seg.to);
      }
    }
  }

  // League rank of a team's own slate, so "12th easiest WR schedule" is sayable
  // rather than just an average of ranks. Computed for the whole season AND for
  // what is left, because in November they are different questions and only one
  // of them is actionable.
  const easeRank = (segmentKey, field) => {
    for (const pos of POSITIONS) {
      const order = Object.keys(teams)
        .filter(t => teams[t][pos][segmentKey])
        .sort((a, b) => teams[b][pos][segmentKey].avgRank - teams[a][pos][segmentKey].avgRank); // easiest first
      order.forEach((t, i) => { teams[t][pos][field] = i + 1; });
    }
  };
  easeRank('season', 'seasonEaseRank');
  if (SEGMENTS.rest) easeRank('rest', 'restEaseRank');

  const out = {
    meta: {
      builtBy: 'scripts/build-sos.js',
      builtAt: new Date().toISOString(),
      season: SEASON,
      defenseSeason: DEF_SEASON,
      segments: SEGMENTS,
      // WHICH FIGURE THE PAGE SHOULD LEAD WITH. Naming it here rather than
      // leaving the page to guess is what stops the two from disagreeing about
      // whether the season is under way — the page has no calendar and should
      // not grow one.
      headline: SEGMENTS.rest ? 'rest' : 'season',
      headlineRankField: SEGMENTS.rest ? 'restEaseRank' : 'seasonEaseRank',
      scale: 'Defensive rank 1–32 where 1 conceded the fewest fantasy points to that position. ' +
        'A low opponent rank is a hard matchup; a high one is a soft matchup. Team ease rank is 1 = easiest slate.',
      caveats: (SEGMENTS.rest
        ? `The headline figure is what is LEFT of the schedule (${SEGMENTS.rest.label}); the season-long number is `
          + `half a record by now and is kept for the shape of the year. `
        : '')
        + `A defence's rating barely predicts its own future: measured over 2024 and 2025, what a unit `
        + `allowed through week four correlates with what it allowed afterwards at r = 0.09 to 0.54 by `
        + `position, and last season's full rating does about as well (0.03 to 0.34). Neither is a forecast. `
        + `Defensive numbers are ${DEF_SEASON} results, not a ${SEASON} projection — coordinators and ` +
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
  // Reports whatever the page leads with, or the log describes a different
  // board from the one a reader sees.
  const key = out.meta.headline, field = out.meta.headlineRankField;
  for (const pos of POSITIONS) {
    const ranked = Object.entries(teams).filter(([, v]) => v[pos][field]);
    const easiest = ranked.find(([, v]) => v[pos][field] === 1);
    const hardest = ranked.sort((a, b) => b[1][pos][field] - a[1][pos][field])[0];
    if (!easiest || !hardest) continue;
    log(`  ${pos} (${SEGMENTS[key] ? SEGMENTS[key].label : 'season'}): easiest ${easiest[0]} `
      + `(opp avg rank ${easiest[1][pos][key].avgRank}), hardest ${hardest[0]} (${hardest[1][pos][key].avgRank})`);
  }
  log('=== SOS Complete ===');
}

// Exported so the switch can be exercised from a test at every week rather
// than only on the morning it happens to fire. Still a script when run as one.
module.exports = { liveDefences, weeksPlayedFrom, segmentsFor, MIN_WEEKS_FOR_LIVE };

if (require.main === module) {
  main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
}
