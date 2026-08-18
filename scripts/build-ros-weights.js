#!/usr/bin/env node
/**
 * build-ros-weights.js — how much should a few games change your mind?
 *
 * THE PROBLEM. On the first Sunday of the season the projections stop being the
 * useful number. Nobody cares in Week 8 what a player was projected for in
 * August; they care what he will do over the twelve games left. But swinging to
 * whatever he has done so far is worse than not moving at all — three good games
 * is a sample of three, and every fantasy site in the world overreacts to it
 * every September.
 *
 * So the real question is a weight: after N games, how much of your forecast
 * should come from what he has actually done and how much from what you thought
 * before the season started?
 *
 * That is answerable rather than arguable, and this answers it out of our own
 * game logs. For every player-season we have, and every week N:
 *
 *     actual  = his points per game through week N
 *     prior   = his points per game the PREVIOUS season, which is the best
 *               stand-in we have for a preseason expectation, since nobody
 *               archived the projections that were actually published
 *     future  = his points per game from week N+1 to the end
 *
 * then find the w that minimises the error of (w · actual + (1-w) · prior)
 * against future. Grid search, because the function is one-dimensional, smooth,
 * and this runs once a year.
 *
 * IT REPORTS WHETHER BLENDING BEATS EITHER SIDE ALONE. If it does not, the
 * honest output is that the blend is not worth doing, and the file says so
 * instead of publishing a weight nobody should use.
 *
 * Not in the daily Action — the inputs move once a season.
 *
 *   node scripts/build-ros-weights.js
 *   node scripts/build-ros-weights.js --dry
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const WEEKLY = path.join(DATA, 'weekly');
const OUT = path.join(DATA, 'ros-weights.json');

// A player needs enough of both halves for the pair to mean anything. Below
// this a single big game sets both sides of the comparison.
const MIN_GAMES_BEFORE = 2;
const MIN_GAMES_AFTER = 4;
const MIN_PRIOR_GAMES = 6;
const MIN_PAIRS = 40;        // below this a weekly weight is noise wearing a number
const MAX_WEEK = 15;

function ppg(games) {
  if (!games.length) return null;
  return games.reduce((s, g) => s + (g.fpts || 0), 0) / games.length;
}

function rmse(pairs, w) {
  let sum = 0;
  for (const p of pairs) {
    const pred = w * p.actual + (1 - w) * p.prior;
    sum += (pred - p.future) ** 2;
  }
  return Math.sqrt(sum / pairs.length);
}

function bestWeight(pairs) {
  let best = { w: 0, err: Infinity };
  for (let i = 0; i <= 100; i++) {
    const w = i / 100;
    const err = rmse(pairs, w);
    if (err < best.err) best = { w, err };
  }
  return best;
}

function main() {
  const dry = process.argv.includes('--dry');
  const files = fs.readdirSync(WEEKLY).filter(f => f.endsWith('.json'));

  // player -> season -> [games]
  const logs = new Map();
  for (const f of files) {
    const id = f.replace(/\.json$/, '');
    const json = JSON.parse(fs.readFileSync(path.join(WEEKLY, f), 'utf8'));
    logs.set(id, json);
  }

  const pool = JSON.parse(fs.readFileSync(path.join(DATA, 'players.json'), 'utf8'));
  const posOf = new Map(pool.map(p => [p.id, p.pos]));

  const seasons = [...new Set([...logs.values()].flatMap(v => Object.keys(v)))].map(Number).sort();
  console.log(`[ros] game logs for ${logs.size} players, seasons ${seasons.join(', ')}`);

  // Build the pairs, one per player-season-week.
  const byWeek = new Map();      // week -> pairs
  const byWeekPos = new Map();   // `${week}|${pos}` -> pairs
  let usable = 0;

  for (const [id, bySeason] of logs) {
    for (const season of seasons) {
      const games = bySeason[season];
      const priorGames = bySeason[season - 1];
      if (!Array.isArray(games) || !Array.isArray(priorGames)) continue;
      if (priorGames.length < MIN_PRIOR_GAMES) continue;
      const prior = ppg(priorGames);
      if (prior === null) continue;

      const sorted = [...games].sort((a, b) => a.week - b.week);
      for (let n = 1; n <= MAX_WEEK; n++) {
        const before = sorted.filter(g => g.week <= n);
        const after = sorted.filter(g => g.week > n);
        if (before.length < MIN_GAMES_BEFORE || after.length < MIN_GAMES_AFTER) continue;
        const pair = { actual: ppg(before), prior, future: ppg(after), pos: posOf.get(id) || '?' };
        if (!byWeek.has(n)) byWeek.set(n, []);
        byWeek.get(n).push(pair);
        const key = `${n}|${pair.pos}`;
        if (!byWeekPos.has(key)) byWeekPos.set(key, []);
        byWeekPos.get(key).push(pair);
        usable++;
      }
    }
  }
  console.log(`[ros] ${usable} player-season-week observations`);

  const weeks = {};
  for (const [n, pairs] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    if (pairs.length < MIN_PAIRS) continue;
    const best = bestWeight(pairs);
    const actualOnly = rmse(pairs, 1);
    const priorOnly = rmse(pairs, 0);
    // The blend has to earn its place. If it does not beat both ends it is a
    // knob that makes the forecast look considered without making it better.
    const beatsBoth = best.err < actualOnly && best.err < priorOnly;
    weeks[n] = {
      weightOnActual: +best.w.toFixed(2),
      weightOnPrior: +(1 - best.w).toFixed(2),
      rmse: +best.err.toFixed(3),
      rmseActualOnly: +actualOnly.toFixed(3),
      rmsePriorOnly: +priorOnly.toFixed(3),
      improvementOverActualOnly: +(100 * (actualOnly - best.err) / actualOnly).toFixed(1),
      beatsBothEnds: beatsBoth,
      observations: pairs.length,
    };
  }

  // Per position, where the sample supports it. Backs and receivers do not
  // stabilise at the same rate and pooling them hides that.
  const positions = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const perWeek = {};
    for (let n = 1; n <= MAX_WEEK; n++) {
      const pairs = byWeekPos.get(`${n}|${pos}`) || [];
      if (pairs.length < MIN_PAIRS) continue;
      const best = bestWeight(pairs);
      perWeek[n] = {
        weightOnActual: +best.w.toFixed(2),
        rmse: +best.err.toFixed(3),
        observations: pairs.length,
      };
    }
    if (Object.keys(perWeek).length) positions[pos] = perWeek;
  }

  const usableWeeks = Object.keys(weeks);
  if (!usableWeeks.length) {
    throw new Error('no week had enough observations — there is not yet enough game-log history to derive this');
  }

  const out = {
    meta: {
      builtBy: 'scripts/build-ros-weights.js',
      builtAt: new Date().toISOString(),
      question: 'after N games, how much of a rest-of-season forecast should come from what a '
        + 'player has actually done, and how much from what was expected of him before the season',
      method: 'grid search on w minimising RMSE of (w·actualPPG + (1-w)·priorPPG) against '
        + 'rest-of-season PPG, over every player-season-week in our own game logs',
      priorIs: 'the player\'s points per game the PREVIOUS season — a stand-in for a preseason '
        + 'expectation, because nobody archived the projections that were actually published. '
        + 'From 2026 the history series makes the real thing available and this should be rebuilt on it.',
      qualifiers: {
        minGamesBefore: MIN_GAMES_BEFORE, minGamesAfter: MIN_GAMES_AFTER,
        minPriorGames: MIN_PRIOR_GAMES, minObservations: MIN_PAIRS,
      },
      caveats: [
        'Fitted on the same seasons it describes, so these weights are in-sample and will read '
        + 'a little better here than they will perform live.',
        'A weight is about the CENTRE of a forecast. It says nothing about the range, which is '
        + 'what floor and ceiling are for.',
        'Nothing here changes a rank. It changes what a player is expected to do from here.',
      ],
      observations: usable,
    },
    byWeek: weeks,
    byPosition: positions,
  };

  console.log('\n  week   weight on actual   RMSE    vs actual-only   vs prior-only   n');
  for (const [n, w] of Object.entries(weeks)) {
    console.log(`  ${String(n).padStart(4)}   ${String(w.weightOnActual).padStart(14)}   `
      + `${String(w.rmse).padStart(5)}   ${String(w.rmseActualOnly).padStart(12)}   `
      + `${String(w.rmsePriorOnly).padStart(12)}   ${w.observations}`
      + (w.beatsBothEnds ? '' : '   ← blend does NOT beat both ends'));
  }

  if (dry) { console.log('\n[ros] dry run — nothing written'); return; }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`\n[ros] wrote data/ros-weights.json`);
}

try { main(); } catch (e) { console.error('[ros] FAILED:', e.message); process.exit(1); }
