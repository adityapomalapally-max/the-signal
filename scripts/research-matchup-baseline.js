#!/usr/bin/env node
/**
 * Can the matchup board publish its TRUSTED column in season?
 *
 * matchups.json carries two numbers per defence and position: raw fantasy
 * points allowed, and `vsBaseline` — the same games measured against each
 * player's own season average. The file itself says vsBaseline is the sounder of
 * the two, because the raw number conflates how good a defence is with how good
 * the offences it happened to draw were.
 *
 * FOUR WEEKS INTO 2026 THE TRUSTED COLUMN IS NULL FOR ALL 32 DEFENCES.
 * MIN_BASELINE_GAMES is 6 and nobody has six games until about week 7, so for
 * the first quarter of every season the board leads with the number its own
 * documentation warns about.
 *
 * Two things to measure before changing that floor:
 *
 *   1. THE BASELINE EATS ITS OWN TAIL. It is the player's average across every
 *      game he played INCLUDING the one being measured, so
 *        delta_i = x_i - mean(all) = (n-1)/n * (x_i - mean(others))
 *      — an exact shrinkage of (n-1)/n. Six per cent over seventeen games and
 *      TWENTY-FIVE over four. Leave-one-out removes it entirely. How much does
 *      that move a finished season's board?
 *
 *   2. WHAT A FOUR-GAME CORRECTION IS WORTH. The board is explicit that it is a
 *      record and not a forecast, so the bar is not prediction — but a reader
 *      will use it to pick a matchup, so it is worth knowing whether the first
 *      month's correction has anything to do with the rest of the season's.
 *
 *     node scripts/research-matchup-baseline.js
 */

const fs = require('fs');
const path = require('path');
const { teamKey, isTeam } = require('./lib/teams');

const DATA = path.join(__dirname, '..', 'data');
const WEEKLY = path.join(DATA, 'weekly');
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const SEASONS = ['2024', '2025'];
const EARLY_WEEKS = 4;

const pool = JSON.parse(fs.readFileSync(path.join(DATA, 'players.json'), 'utf8'));
const byId = new Map(pool.map(p => [p.id, p]));

/** Every (player, season, game) with points and an opponent. */
function load() {
  const rows = [];
  for (const file of fs.readdirSync(WEEKLY)) {
    if (!file.endsWith('.json')) continue;
    const p = byId.get(file.replace('.json', ''));
    if (!p || !POSITIONS.includes(p.pos)) continue;
    let shard;
    try { shard = JSON.parse(fs.readFileSync(path.join(WEEKLY, file), 'utf8')); } catch (e) { continue; }
    for (const [season, games] of Object.entries(shard)) {
      if (!SEASONS.includes(String(season))) continue;
      const scored = (games || []).filter(g => typeof g.fpts === 'number' && g.opp);
      for (const g of scored) {
        const def = teamKey(g.opp);
        if (!isTeam(def)) continue;
        rows.push({ id: p.id, pos: p.pos, season: String(season), week: Number(g.week),
                    fpts: g.fpts, def, n: scored.length,
                    sum: scored.reduce((s, x) => s + x.fpts, 0) });
      }
    }
  }
  return rows;
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 6) return null;
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n));
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return (da && db) ? num / Math.sqrt(da * db) : null;
}

/**
 * Per defence+position vsBaseline, over a window of weeks.
 * @param {string} mode 'self' includes the measured game in the baseline, 'loo' does not
 */
function board(rows, season, mode, weekFrom, weekTo, minGames) {
  const inWindow = rows.filter(r => r.season === season && r.week >= weekFrom && r.week <= weekTo);
  // A player's baseline comes from the games in THIS window, which is what an
  // in-season board can actually see.
  const byPlayer = new Map();
  for (const r of inWindow) {
    if (!byPlayer.has(r.id)) byPlayer.set(r.id, []);
    byPlayer.get(r.id).push(r);
  }
  const out = {};
  for (const [, games] of byPlayer) {
    if (games.length < minGames) continue;
    const total = games.reduce((s, g) => s + g.fpts, 0);
    for (const g of games) {
      const base = mode === 'loo'
        ? (total - g.fpts) / (games.length - 1)
        : total / games.length;
      const k = `${g.def}|${g.pos}`;
      (out[k] = out[k] || []).push(g.fpts - base);
    }
  }
  const final = {};
  for (const [k, deltas] of Object.entries(out)) final[k] = { v: mean(deltas), n: deltas.length };
  return final;
}

function ranks(b, pos) {
  const cells = Object.entries(b).filter(([k]) => k.endsWith(`|${pos}`))
    .sort((x, y) => x[1].v - y[1].v);
  const r = new Map();
  cells.forEach(([k], i) => r.set(k.split('|')[0], i + 1));
  return r;
}

const rows = load();
console.log(`\n  ${rows.length} player-games across ${SEASONS.join(' and ')}\n`);

console.log('  1. THE SHRINKAGE THE SELF-INCLUSIVE BASELINE APPLIES');
for (const season of SEASONS) {
  const ns = [...new Set(rows.filter(r => r.season === season).map(r => `${r.id}`))]
    .map(id => rows.find(r => r.season === season && r.id === id).n);
  const factors = ns.map(n => (n - 1) / n);
  console.log(`     ${season}: median games ${ns.sort((a, b) => a - b)[Math.floor(ns.length / 2)]}`
    + `, shrinkage ${(mean(factors) * 100).toFixed(1)}% of the true delta on average`
    + ` (worst ${(Math.min(...factors) * 100).toFixed(0)}%)`);
}

console.log('\n  2. WHAT LEAVE-ONE-OUT DOES TO A FINISHED SEASON');
for (const season of SEASONS) {
  const self = board(rows, season, 'self', 1, 18, 6);
  const loo = board(rows, season, 'loo', 1, 18, 6);
  for (const pos of POSITIONS) {
    const rs = ranks(self, pos), rl = ranks(loo, pos);
    let moved5 = 0, maxMove = 0;
    for (const [team, r1] of rs) {
      const r2 = rl.get(team);
      if (r2 === undefined) continue;
      const d = Math.abs(r1 - r2);
      if (d >= 5) moved5++;
      if (d > maxMove) maxMove = d;
    }
    const vs = Object.keys(self).filter(k => k.endsWith(`|${pos}`));
    const scale = mean(vs.map(k => (loo[k] && self[k] && loo[k].v) ? self[k].v / loo[k].v : null).filter(x => x !== null));
    console.log(`     ${season} ${pos}: ${moved5} defences move 5+ places, max ${maxMove}`
      + `, self/loo magnitude ratio ${scale ? scale.toFixed(3) : 'n/a'}`);
  }
}

console.log('\n  3. DOES A FOUR-WEEK CORRECTION RESEMBLE THE REST OF THE SEASON?');
for (const season of SEASONS) {
  for (const floor of [2, 3, 4]) {
    const early = board(rows, season, 'loo', 1, EARLY_WEEKS, floor);
    const rest = board(rows, season, 'loo', EARLY_WEEKS + 1, 18, 6);
    for (const pos of POSITIONS) {
      const keys = Object.keys(early).filter(k => k.endsWith(`|${pos}`) && rest[k]);
      const a = keys.map(k => early[k].v), b = keys.map(k => rest[k].v);
      const r = pearson(a, b);
      if (pos === 'WR' || pos === 'RB') {
        console.log(`     ${season} ${pos} floor ${floor}: ${keys.length} defences, r = `
          + `${r === null ? 'n/a' : r.toFixed(3)}`);
      }
    }
  }
}

console.log('\n  4. HOW MUCH OF THE BOARD IS PUBLISHABLE AT WEEK 4, BY FLOOR');
for (const season of SEASONS) {
  for (const floor of [2, 3, 4, 6]) {
    const early = board(rows, season, 'loo', 1, EARLY_WEEKS, floor);
    const cells = POSITIONS.map(pos => Object.keys(early).filter(k => k.endsWith(`|${pos}`)).length);
    console.log(`     ${season} floor ${floor}: ${cells.join('/')} cells (QB/RB/WR/TE) of 32 each`);
  }
}
console.log('');

console.log('  5. DOES LOWERING THE FLOOR CHANGE A FINISHED SEASON\'S BOARD?');
// The floor applies to every season, not just the live one, so dropping it from
// 6 lets part-season players (3-5 games, mostly injuries) into the correction.
// Better coverage or noisier baselines — the board has to say which.
for (const season of SEASONS) {
  const strict = board(rows, season, 'loo', 1, 18, 6);
  for (const floor of [3, 4]) {
    const loose = board(rows, season, 'loo', 1, 18, floor);
    for (const pos of ['RB', 'WR']) {
      const rs = ranks(strict, pos), rl = ranks(loose, pos);
      let moved3 = 0, moved5 = 0, maxMove = 0;
      for (const [team, r1] of rs) {
        const r2 = rl.get(team); if (r2 === undefined) continue;
        const d = Math.abs(r1 - r2);
        if (d >= 3) moved3++;
        if (d >= 5) moved5++;
        if (d > maxMove) maxMove = d;
      }
      const keys = Object.keys(strict).filter(k => k.endsWith(`|${pos}`) && loose[k]);
      const extra = keys.map(k => loose[k].n - strict[k].n);
      console.log(`     ${season} ${pos} floor 6 -> ${floor}: ${moved3} move 3+, ${moved5} move 5+, `
        + `max ${maxMove}; +${mean(extra).toFixed(1)} observations per cell`);
    }
  }
}
console.log('');
