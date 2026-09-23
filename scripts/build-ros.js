#!/usr/bin/env node
/**
 * build-ros.js — rest-of-season projections
 *
 * The projections in projections-2026.json are season-long medians built in
 * August. On the first Sunday of the season they begin to answer a question
 * nobody is asking any more: by Week 8, what matters is not what a player was
 * expected to do over seventeen games, it is what he will do over the nine that
 * are left.
 *
 * This produces that, and it deliberately does NOT produce it by trusting the
 * season so far. Weighting is the whole problem — three good games is a sample
 * of three, and overreacting to it is the single most common way a fantasy
 * forecast goes wrong in September. The weights come from
 * scripts/build-ros-weights.js, which derived them out of our own game logs
 * rather than picking them: 0.32 on actuals after two games, crossing 0.5 at
 * week seven, 0.83 by week fourteen. Tight ends stabilise much later than backs
 * and get their own curve.
 *
 * WHAT THIS IS NOT
 * It is not a re-ranking of the analyst's board and it does not touch
 * rankings.json. The medians there are his call and stay his call. This is a
 * separate file answering a separate question, and it is allowed to order
 * players differently precisely because the question is different.
 *
 * IN THE PRESEASON IT WRITES NOTHING, and says why. A rest-of-season projection
 * before any football has been played is just the season projection wearing a
 * different name, and publishing it would imply an update that never happened.
 *
 *   node scripts/build-ros.js
 *   node scripts/build-ros.js --dry
 *   node scripts/build-ros.js --simulate 2025:6    (pretend it is week 6 of 2025)
 */

const fs = require('fs');
const path = require('path');
const seasonLib = require('./lib/season');
const { writeJSONIfChanged } = require('./lib/write');

const DATA = path.join(__dirname, '..', 'data');
const WEEKLY = path.join(DATA, 'weekly');
const OUT = path.join(DATA, 'ros.json');

const REGULAR_SEASON_WEEKS = 18;

const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

/**
 * The last week this season anybody has a game on file for.
 *
 * Read off the same game logs the blend is built from, rather than off the
 * calendar. A player who is on bye, hurt or benched has no row for a week, so
 * the MAXIMUM across the pool is the question — "has anybody played week N" —
 * and not any single player's last game.
 */
function lastPlayedWeek(season) {
  let last = 0;
  for (const f of fs.readdirSync(WEEKLY)) {
    if (!f.endsWith('.json')) continue;
    let log;
    try { log = JSON.parse(fs.readFileSync(path.join(WEEKLY, f), 'utf8')); } catch (e) { continue; }
    for (const g of (log[season] || [])) {
      const w = Number(g.week);
      if (Number.isFinite(w) && w > last) last = w;
    }
  }
  return last;
}

function weightFor(weights, week, pos) {
  const perPos = weights.byPosition[pos];
  if (perPos) {
    const exact = perPos[week];
    if (exact) return { w: exact.weightOnActual, basis: `${pos} week ${week}` };
    // Nearest week we actually fitted, rather than an interpolation nobody
    // measured.
    const keys = Object.keys(perPos).map(Number).sort((a, b) => Math.abs(a - week) - Math.abs(b - week));
    if (keys.length) return { w: perPos[keys[0]].weightOnActual, basis: `${pos} week ${keys[0]} (nearest fitted)` };
  }
  const pooled = weights.byWeek[week];
  if (pooled) return { w: pooled.weightOnActual, basis: `all positions, week ${week}` };
  const keys = Object.keys(weights.byWeek).map(Number).sort((a, b) => Math.abs(a - week) - Math.abs(b - week));
  if (!keys.length) return null;
  return { w: weights.byWeek[keys[0]].weightOnActual, basis: `all positions, week ${keys[0]} (nearest fitted)` };
}

async function main() {
  const dry = process.argv.includes('--dry');
  const simArg = process.argv.includes('--simulate')
    ? process.argv[process.argv.indexOf('--simulate') + 1] : null;

  let season, week, phase;
  if (simArg) {
    const [s, w] = simArg.split(':').map(Number);
    season = s; week = w; phase = 'regular';
    console.log(`[ros] SIMULATING ${season} week ${week}`);
  } else {
    const st = await seasonLib.state();
    season = st.season; phase = st.phase;
    // WEEKS PLAYED, NOT THE WEEK ON THE CALENDAR, AND THEY ARE NOT THE SAME
    // NUMBER. Sleeper's `week` is the one ABOUT to be played — it turns over on
    // the Tuesday — so taking it as the week this projection is "through"
    // overstated the season by one all year:
    //
    //   - the weights are fitted per week as "N games of evidence"
    //     (build-ros-weights: before = g.week <= N), so a player with two games
    //     was being handed the weight fitted for three, which trusts a small
    //     sample more than the fit says it should;
    //   - gamesRemaining counted the upcoming week as already gone, so every
    //     rest-of-season TOTAL was one game short — about 7% at this point of a
    //     season, and the number a reader actually trades on;
    //   - and the card said "through week 3" on a Tuesday when week 3 kicked
    //     off on the Thursday.
    //
    // The game logs are what the blend is built from, so they are what the
    // window is asked of: the last week anybody has a game on file. Two numbers
    // derived from one source cannot come apart.
    week = lastPlayedWeek(season);
    console.log(`[ros] league is in ${await seasonLib.describe()}; game logs are complete through week ${week}`);
  }

  if (phase !== 'regular' && phase !== 'post') {
    console.log('[ros] not in season — a rest-of-season projection before any football has been '
      + 'played is the season projection under another name. Nothing written.');
    return;
  }

  if (!week) {
    console.log('[ros] no game has been played in this season yet — a rest-of-season projection with '
      + 'nothing behind it is the preseason projection under another name. Nothing written.');
    return;
  }

  const weights = read('ros-weights.json');
  const rankings = read('rankings.json');

  // The preseason expectation, per player, straight off the published board.
  const prior = new Map();
  for (const pos of ['qb', 'rb', 'wr', 'te']) {
    for (const row of rankings[pos] || []) {
      if (typeof row.ppg === 'number') prior.set(row.name, { ppg: row.ppg, pos: row.pos, team: row.team, rank: row.rank });
    }
  }

  const pool = read('players.json');
  const byName = new Map(pool.map(p => [p.name, p]));

  const players = {};
  let projected = 0, noLog = 0, noPrior = 0;
  // Counted explicitly rather than inferred from the miss counters — inferring it
  // from `noLog < prior.size` was wrong the moment one ranked player was absent
  // from the pool, which is the normal state of affairs.
  let gamesOnFile = 0;

  for (const [name, pre] of prior) {
    const player = byName.get(name);
    if (!player) { noPrior++; continue; }
    const logPath = path.join(WEEKLY, `${player.id}.json`);
    if (!fs.existsSync(logPath)) { noLog++; continue; }
    const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    const games = (log[season] || []).filter(g => g.week <= week);
    gamesOnFile += games.length;
    if (!games.length) { noLog++; continue; }

    const actualPpg = games.reduce((s, g) => s + (g.fpts || 0), 0) / games.length;
    const chosen = weightFor(weights, week, player.pos);
    if (!chosen) continue;

    const blended = chosen.w * actualPpg + (1 - chosen.w) * pre.ppg;
    // `week` is now the last week PLAYED, so the weeks still to come are
    // week+1..REGULAR_SEASON_WEEKS, less the one bye that falls somewhere in a
    // season. The old arithmetic subtracted an extra week because it read the
    // upcoming week as a played one.
    const gamesLeft = Math.max(0, REGULAR_SEASON_WEEKS - week - 1);   // one bye already taken or coming

    players[player.id] = {
      name: player.name, pos: player.pos, team: player.team,
      gamesPlayed: games.length,
      pointsSoFar: +games.reduce((s, g) => s + (g.fpts || 0), 0).toFixed(1),
      actualPpg: +actualPpg.toFixed(2),
      preseasonPpg: pre.ppg,
      weightOnActual: chosen.w,
      weightBasis: chosen.basis,
      projectedPpg: +blended.toFixed(2),
      gamesRemaining: gamesLeft,
      restOfSeasonPoints: +(blended * gamesLeft).toFixed(1),
      // The movement is the story: who the season has actually changed our mind
      // about, and by how much.
      ppgDelta: +(blended - pre.ppg).toFixed(2),
    };
    projected++;
  }

  if (!projected) {
    // THE WINDOW NOBODY THINKS ABOUT. Sleeper flips season_type to "regular"
    // several days before Week 1 actually kicks off, so there is a stretch where
    // the season is "on" and not one game has been played. Throwing here would
    // have reddened the daily Action every morning for about a week, every year,
    // for a condition that is completely normal.
    //
    // No game logs at all is not a failure. Some game logs and nothing
    // projected IS one, because that means the join broke — so the two are
    // told apart rather than lumped together.
    if (!gamesOnFile) {
      console.log(`[ros] season ${season} is under way but no games are on file yet — nothing to project. `
        + 'This is normal in the days between the season flipping over and Week 1 kicking off.');
      return;
    }
    throw new Error('game logs exist for this season but no player could be projected — the join has broken');
  }

  const out = {
    meta: {
      builtBy: 'scripts/build-ros.js',
      builtAt: new Date().toISOString(),
      season, throughWeek: week,
      gamesRemaining: Math.max(0, REGULAR_SEASON_WEEKS - week - 1),
      method: 'blend of season-to-date points per game with the preseason projection, at a weight '
        + 'derived in build-ros-weights.js from our own game logs rather than chosen',
      weightsFrom: weights.meta.builtAt,
      isNot: 'a re-ranking of the board. rankings.json is untouched; the medians there are the '
        + 'analyst\'s call. This answers a different question and is allowed to order players differently.',
      caveats: [
        'Points per game, so it says nothing about availability — a player who misses games scores '
        + 'nothing in them, and that downside belongs to the availability figure, not here.',
        'Games remaining is a simple count from the current week and does not know about byes '
        + 'still to come for a specific team.',
        'The weights were fitted in-sample on the seasons they describe.',
      ],
      coverage: { projected, skippedNoGameLog: noLog, skippedNotInPool: noPrior },
    },
    players,
  };

  console.log(`[ros] ${projected} players projected through week ${week}`
    + ` (${noLog} without a game log, ${noPrior} not in the pool)`);
  const movers = Object.values(players).sort((a, b) => b.ppgDelta - a.ppgDelta);
  console.log('  biggest risers:  ' + movers.slice(0, 3).map(m => `${m.name} ${m.ppgDelta > 0 ? '+' : ''}${m.ppgDelta}`).join(', '));
  console.log('  biggest fallers: ' + movers.slice(-3).map(m => `${m.name} ${m.ppgDelta}`).join(', '));

  // --write lets a SIMULATION produce a real file, which is the only way to
  // build the pages that read it before September. It is stamped, and there is
  // a test that fails if a stamped file is ever committed — the capability has
  // to exist without being able to ship.
  const writeSim = simArg && process.argv.includes('--write');
  if (writeSim) out.meta.simulated = `simulated from ${simArg} for interface work — NOT REAL`;
  if (dry || (simArg && !writeSim)) {
    console.log(simArg ? '[ros] simulation — nothing written (pass --write to build a file for UI work)' : '[ros] dry run — nothing written');
    return;
  }
  const wrote = writeJSONIfChanged(OUT, out);
  if (!wrote) console.log('[ros] unchanged — not rewritten');
  else console.log(`[ros] wrote data/ros.json`);
}

main().catch(e => { console.error('[ros] FAILED:', e.message); process.exit(1); });
