#!/usr/bin/env node
/**
 * What a defence actually costs the player you are starting.
 *
 * Fantasy points allowed is the most-used matchup number in the sport and the
 * most misleading one, because it conflates two things: how good the defence is,
 * and how good the offences it happened to face were. A defence that drew the
 * three best receiving corps in the league looks porous; one that drew the three
 * worst looks elite. Neither has been measured.
 *
 * So this file publishes TWO numbers and says which to trust.
 *
 *   pointsAllowedPerGame — the familiar one. Average fantasy points scored by a
 *     pool player at that position in a game against this defence. Comparable to
 *     what every other site prints, and carries the same flaw.
 *
 *   vsBaseline — the same games, each measured against THAT PLAYER'S OWN season
 *     average. A receiver who averages 14 and puts up 9 against this defence
 *     contributes -5. It controls for who the defence faced, which is the whole
 *     problem with the first number, and it is the same "over expected" framing
 *     the rest of this site already uses for CPOE, YAC and availability.
 *
 * The pool is the top-350 fantasy players, so this is points allowed to players
 * worth starting rather than to everybody. For a fantasy matchup that is the
 * right population; it is not the whole league, and the file says so.
 *
 *   node scripts/build-matchups.js
 */

const fs = require('fs');
const path = require('path');
const seasonLib = require('./lib/season');
const { dataSeasons, latestDataSeason } = seasonLib;
const { isTeam, teamKey } = require('./lib/teams');
const { writeJSONIfChanged } = require('./lib/write');

const DATA = path.join(__dirname, '..', 'data');
const WEEKLY = path.join(DATA, 'weekly');
const OUT = path.join(DATA, 'matchups.json');

// THE SAMPLE IS GAMES, NOT PLAYER-GAMES, AND THAT DISTINCTION IS THE WHOLE
// CALIBRATION. A flat player-game floor sounds even-handed and is not: measured
// across 2025, a defence faces 2.39 pool receivers per game but only 1.07
// quarterbacks. A floor of 8 player-games therefore demanded 3.3 games of
// evidence at receiver and 7.5 at quarterback — and simulated forward, the QB
// matchup board did not publish a single defence until week 8 and was not full
// until week 10. Over half a season on last year's data because the unit was
// wrong.
//
// A defensive performance is a GAME. Gating on the number of distinct weeks a
// defence has faced the position asks the same question of every position and
// needs no per-position rate to be estimated or maintained.
const MIN_GAMES = 4;
// And a floor on observations, for the pathological case of four games against
// one player. Deliberately low: it is a backstop, not the qualifier.
const MIN_PLAYER_GAMES = 4;
// And a player needs a real season behind him before his own average is a
// baseline worth measuring anything against.
const MIN_BASELINE_GAMES = 6;

const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const log = (...a) => console.log('[matchups]', ...a);

function round(v, p = 2) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  const m = Math.pow(10, p);
  return Math.round(v * m) / m;
}

/**
 * One defence-position cell, decided against the sample floor.
 *
 * Extracted so the THIN path can be tested. On a completed season every cell
 * clears the floor, so a test against real data never exercises it — and the
 * weeks when it matters most are Weeks 1 to 3, when a single afternoon is the
 * entire sample and the board is at its most tempting to read.
 */
function shapeCell(c, floor) {
  const min = floor === undefined ? MIN_PLAYER_GAMES : floor;
  const games = c.weeks ? c.weeks.size : 0;
  if (games < MIN_GAMES || c.playerGames < min) {
    return { playerGames: c.playerGames, gamesPlayed: games, thin: true };
  }
  return {
    playerGames: c.playerGames,
    gamesPlayed: games,
    pointsAllowedPerGame: round(c.points / c.playerGames),
    vsBaseline: c.deltaN >= min ? round(c.delta / c.deltaN) : null,
  };
}

async function main() {
  // --simulate 2026:6 drives the calendar forward so the in-season paths can be
  // built and looked at before September. Same flag, same spelling and the same
  // stamp as build-ros.js, because the problem is identical: the weeks that
  // matter most cannot be reached until they arrive, and by then it is too late
  // to find out the board is empty.
  const simArg = process.argv.includes('--simulate')
    ? process.argv[process.argv.indexOf('--simulate') + 1] : null;
  if (simArg) {
    const [sy, sw] = simArg.split(':').map(Number);
    seasonLib.__setState({ season: sy, previousSeason: sy - 1, week: sw, phase: 'regular', source: 'simulation' });
    log(`SIMULATING ${sy} week ${sw} — the output is stamped and cannot be committed`);
  }

  const pool = JSON.parse(fs.readFileSync(path.join(DATA, 'players.json'), 'utf8'));
  const byId = new Map(pool.map(p => [p.id, p]));
  const seasons = (await dataSeasons(3)).map(String);

  // season -> defence -> position -> { games: Set(week), points, plays, delta, deltaN }
  const acc = {};
  let skippedNoPos = 0, skippedThinBaseline = 0, counted = 0;

  for (const file of fs.readdirSync(WEEKLY)) {
    if (!file.endsWith('.json')) continue;
    const id = file.replace(/\.json$/, '');
    const player = byId.get(id);
    if (!player || !POSITIONS.includes(player.pos)) { skippedNoPos++; continue; }
    const shard = JSON.parse(fs.readFileSync(path.join(WEEKLY, file), 'utf8'));

    for (const [season, games] of Object.entries(shard)) {
      if (!seasons.includes(String(season))) continue;
      if (!Array.isArray(games) || !games.length) continue;

      // The baseline is the player's own average across the games he PLAYED
      // that season. Computed per season, because a player is not the same
      // player two years apart.
      const scored = games.filter(g => typeof g.fpts === 'number');
      const baseline = scored.length >= MIN_BASELINE_GAMES
        ? scored.reduce((s, g) => s + g.fpts, 0) / scored.length
        : null;
      if (!baseline) skippedThinBaseline++;

      for (const g of games) {
        if (typeof g.fpts !== 'number' || !g.opp) continue;
        const def = teamKey(g.opp);
        if (!isTeam(def)) continue;
        acc[season] = acc[season] || {};
        acc[season][def] = acc[season][def] || {};
        const cell = acc[season][def][player.pos] = acc[season][def][player.pos]
          || { weeks: new Set(), points: 0, playerGames: 0, delta: 0, deltaN: 0 };
        cell.weeks.add(g.week);
        cell.points += g.fpts;
        cell.playerGames++;
        if (baseline !== null) { cell.delta += g.fpts - baseline; cell.deltaN++; }
        counted++;
      }
    }
  }

  const out = { meta: {}, seasons: {} };
  let published = 0, withheld = 0;

  for (const season of Object.keys(acc).sort()) {
    const defs = {};
    for (const def of Object.keys(acc[season]).sort()) {
      const row = {};
      for (const pos of POSITIONS) {
        const c = acc[season][def][pos];
        if (!c) continue;
        const shaped = shapeCell(c);
        if (shaped.thin) withheld++; else published++;
        row[pos] = shaped;
      }
      if (Object.keys(row).length) defs[def] = row;
    }
    // A season that produced fewer than 32 defences is a partial season, which
    // is normal in-season and worth saying rather than hiding.
    out.seasons[season] = { defenses: defs, defenseCount: Object.keys(defs).length };
  }

  const live = await latestDataSeason();
  out.meta = {
    generated: new Date().toISOString(),
    seasons: Object.keys(out.seasons).map(Number).sort(),
    latestSeasonWithGames: live,
    source: 'Per-game fantasy points from data/weekly, attributed to the defence faced. Half-PPR.',
    qualifiers: {
      games: `${MIN_GAMES}+ separate games against the position before any rate is published. The `
        + `sample is GAMES, not player-games: a defence faces about 2.4 pool receivers a game and only `
        + `1.07 quarterbacks, so a flat player-game floor asks three times as much of a quarterback `
        + `board as of a receiver one.`,
      playerGames: `${MIN_PLAYER_GAMES}+ player-games as a backstop, for four games against one player`,
      baseline: `a player needs ${MIN_BASELINE_GAMES}+ games that season before his own average is used as a baseline`,
    },
    readThis: 'This board is DESCRIPTIVE. It records what a defence has already allowed; it is not a '
      + 'forecast of what it will allow. Of the two numbers, vsBaseline is the sounder — '
      + 'pointsAllowedPerGame conflates the defence with the offences it happened to face, while '
      + 'vsBaseline measures each performance against that player\'s own season average, so a defence '
      + 'is not credited for drawing weak opponents.',
    predictiveness: 'MEASURED, AND IT IS WEAK. Splitting 2023-25 at several points and correlating a '
      + 'defence\'s vsBaseline over the first N weeks with its rating over the rest of the season gives '
      + 'r = 0.05 to 0.32 for QB, RB and WR, and it does NOT improve as the sample grows — the week-8 '
      + 'split is no better than the week-4 one. Reproduce with scripts/research-matchup-stability.js. '
      + 'Read this board as a record of what happened, not as a projection of what will.',
    caveats: [
      'The population is the top-350 fantasy pool, so this is points allowed to players worth '
      + 'starting rather than to everybody at the position. For a start/sit decision that is the '
      + 'right population; it is not the whole league.',
      'A baseline is the player\'s average across the games he PLAYED that season, so it already '
      + 'contains his good and bad matchups. It corrects for who a defence faced, not for when in '
      + 'the season they faced them.',
      'Defensive personnel changes across a season and completely across an offseason. A figure '
      + 'from a past season describes that season\'s defence, not the one lining up on Sunday.',
    ],
  };

  // A stamped file looks exactly like a real one to every page that reads it,
  // so it carries the stamp and tests/no-simulated-data.test.js refuses to let
  // it be committed.
  if (simArg) out.meta.simulated = `simulated from ${simArg} for interface work — NOT REAL`;
  const wrote = writeJSONIfChanged(OUT, out);
  log(`${counted} player-games counted, ${published} cells published, ${withheld} withheld as thin`);
  log(`skipped: ${skippedNoPos} non-pool shards, ${skippedThinBaseline} player-seasons too short for a baseline`);
  for (const [s, v] of Object.entries(out.seasons)) log(`  ${s}: ${v.defenseCount} defences`);
  log(wrote ? `wrote data/matchups.json (${Math.round(fs.statSync(OUT).size / 1024)}KB)`
            : 'data/matchups.json unchanged — not rewritten');
}

module.exports = { shapeCell, MIN_GAMES, MIN_PLAYER_GAMES, MIN_BASELINE_GAMES };

if (require.main === module) main().catch(e => { console.error('[matchups] fatal:', e.message); process.exit(1); });
