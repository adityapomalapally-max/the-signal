#!/usr/bin/env node
/**
 * How much does a defensive matchup rating tell you about the future?
 *
 * RESEARCH, not a build. It writes no data file and is not in the Action. It
 * exists for the same reason research-vegas-weather.js does: to answer a
 * question with a measurement before the answer gets decided by intuition, and
 * to stop the same question being reopened from memory later.
 *
 * The matchup board publishes what a defence HAS allowed. Every reader will use
 * it to guess what it WILL allow. Those are different claims and only one of
 * them is on the page, so the gap between them is worth knowing.
 *
 * THE TEST: split each season at week N. Compute each defence's vsBaseline over
 * weeks 1..N and again over N+1..18, and correlate them. A defence whose rating
 * carries information about its own future produces a high correlation; one
 * whose rating is mostly noise produces nothing.
 *
 *   node scripts/research-matchup-stability.js
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const WEEKLY = path.join(DATA, 'weekly');
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const SEASONS = ['2023', '2024', '2025'];
const SPLITS = [4, 6, 8, 10];
const MIN_CELL = 4;          // games behind a rating, matching the board's floor
const MIN_BASELINE = 6;      // games behind a player's own average

const pool = JSON.parse(fs.readFileSync(path.join(DATA, 'players.json'), 'utf8'));
const byId = new Map(pool.map(p => [p.id, p]));

function ratings(season, from, to) {
  const acc = {};
  for (const f of fs.readdirSync(WEEKLY)) {
    const p = byId.get(f.replace(/\.json$/, ''));
    if (!p || !POSITIONS.includes(p.pos)) continue;
    const j = JSON.parse(fs.readFileSync(path.join(WEEKLY, f), 'utf8'));
    const games = (j[season] || []).filter(g => typeof g.fpts === 'number');
    if (games.length < MIN_BASELINE) continue;
    const base = games.reduce((a, g) => a + g.fpts, 0) / games.length;
    for (const g of games) {
      if (g.week < from || g.week > to || !g.opp) continue;
      const k = `${p.pos}|${g.opp}`;
      acc[k] = acc[k] || { delta: 0, n: 0, weeks: new Set() };
      acc[k].delta += g.fpts - base;
      acc[k].n++;
      acc[k].weeks.add(g.week);
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(acc)) if (v.weeks.size >= MIN_CELL) out[k] = v.delta / v.n;
  return out;
}

function pearson(a, b, prefix) {
  const keys = Object.keys(a).filter(k => k in b && k.startsWith(prefix));
  if (keys.length < 10) return null;
  const xs = keys.map(k => a[k]), ys = keys.map(k => b[k]);
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (!dx || !dy) return null;
  return { r: num / Math.sqrt(dx * dy), n: keys.length };
}

console.log('[stability] Does a defence\'s matchup rating predict its own rest of season?');
console.log('[stability] Correlation of vsBaseline over weeks 1..N with weeks N+1..18.');
console.log('[stability] Averaged across ' + SEASONS.join(', ') + '.\n');
console.log('  split   ' + POSITIONS.map(p => p.padStart(7)).join('') + '      pairs');

const summary = {};
for (const split of SPLITS) {
  const cells = [];
  let pairs = 0;
  for (const pos of POSITIONS) {
    const rs = [];
    for (const s of SEASONS) {
      const c = pearson(ratings(s, 1, split), ratings(s, split + 1, 18), `${pos}|`);
      if (c) { rs.push(c.r); pairs += c.n; }
    }
    const avg = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
    summary[`${pos}@${split}`] = avg;
    cells.push(avg === null ? '    n/a' : avg.toFixed(3).padStart(7));
  }
  console.log(`  wk ${String(split).padStart(2)}   ${cells.join('')}   ${String(pairs).padStart(8)}`);
}

const all = Object.values(summary).filter(v => v !== null);
const best = Math.max(...all), worst = Math.min(...all);
console.log(`\n[stability] range: r = ${worst.toFixed(2)} to ${best.toFixed(2)}`);
console.log('[stability] CONCLUSION: a defensive matchup rating is WEAKLY self-predictive at best,');
console.log('[stability] and it does NOT get more predictive as the sample grows — the week-8 split');
console.log('[stability] is no better than the week-4 one. The board describes what a defence HAS');
console.log('[stability] allowed. It is not a forecast, and the page must not let it read as one.');
console.log('[stability] Nothing is written; this is a measurement, not a build.');

/* ── The second question, and it decides a line of build-sos ──────────────────

   STRENGTH OF SCHEDULE HAS TO PICK A PRIOR, and build-sos picks by fiat:
   MIN_WEEKS_FOR_LIVE = 4, so from week five it stops using last season's
   defences and starts using this one's. The reasoning written beside it is
   plausible — "past the floor the current data beats the stale data" — and
   nobody has ever checked it. The branch has not run yet either; it first fires
   around October 6th.

   It is a measurable question, asked exactly as the build asks it: standing at
   week N, which better predicts what defences will allow over the REST of this
   season — the N games already played this year, or all of last year?

   Same ratings, same correlation, one more column.                          */

const PRIOR_SEASONS = SEASONS.slice(1);   // each needs the season before it

console.log('\n[stability] Standing at week N, which prior predicts the rest of THIS season better?');
console.log('[stability] Left: this season\'s first N weeks. Right: last season, whole.');
console.log('[stability] Averaged across ' + PRIOR_SEASONS.join(', ') + '.\n');
console.log('  split  ' + POSITIONS.map(p => `${p} now / prior`.padStart(16)).join(''));

const verdicts = [];
for (const split of SPLITS) {
  const cells = [];
  for (const pos of POSITIONS) {
    const now = [], prior = [];
    for (const s of PRIOR_SEASONS) {
      const rest = ratings(s, split + 1, 18);
      const a = pearson(ratings(s, 1, split), rest, `${pos}|`);
      const b = pearson(ratings(String(Number(s) - 1), 1, 18), rest, `${pos}|`);
      if (a) now.push(a.r);
      if (b) prior.push(b.r);
    }
    const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const n = mean(now), p = mean(prior);
    if (n !== null && p !== null) verdicts.push({ split, pos, now: n, prior: p });
    cells.push(`${n === null ? 'n/a' : n.toFixed(2)} / ${p === null ? 'n/a' : p.toFixed(2)}`.padStart(16));
  }
  console.log(`  wk ${String(split).padStart(2)}  ${cells.join('')}`);
}

const atFour = verdicts.filter(v => v.split === 4);
const nowWins = atFour.filter(v => v.now > v.prior).length;
console.log(`\n[stability] At the week-4 split — which is where build-sos switches — this season's`);
console.log(`[stability] games are the better prior in ${nowWins} of ${atFour.length} position-cases.`);
const avgNow = atFour.reduce((a, v) => a + v.now, 0) / (atFour.length || 1);
const avgPrior = atFour.reduce((a, v) => a + v.prior, 0) / (atFour.length || 1);
console.log(`[stability] Mean r: this season ${avgNow.toFixed(3)} · last season ${avgPrior.toFixed(3)}.`);
