#!/usr/bin/env node

/**
 * The Signal — Projection Band Builder
 *
 * Replaces the floor and ceiling in data/projections-2026.json with a range
 * derived from what actually happens to players year over year. It NEVER
 * touches a median.
 *
 * WHY THE MEDIAN STAYS HAND-SET. The median is the analyst's forecast, and it
 * has standing here the same way rankings-manual.json does. Generating it would
 * mean resampling a player's own past, which cannot work for the rookies in the
 * file (no NFL games at all) and is actively misleading for the dozen players
 * who changed offences. A backward-looking number presented as a projection is
 * worse than a labelled human one, because a script makes it look measured.
 *
 * WHAT THE BAND IS. Uncertainty is the part data can honestly supply, and the
 * file already declares what it means: build-rankings.js reads the floor as
 * "roughly a 15th-percentile outcome". So the band is the 15th and 85th
 * percentile of the year-over-year change in POINTS PER GAME, measured across
 * this pool, centred on the analyst's median.
 *
 * PER GAME, deliberately: the projections assume 17 games and availability is
 * a SEPARATE downside the rankings chart draws on its own. Folding missed games
 * in here would count the same injury twice.
 *
 * LEVEL MATTERS, and it is the whole reason this is not one multiplier per
 * position. An established back's upside and a committee back's upside are not
 * the same number: the top half of RB seasons carry +27% at the 85th
 * percentile, the bottom half +151%. Applying a pooled figure would have given
 * every elite player a ceiling nobody has ever reached.
 *
 * Two tiers were not enough either. A player projected at 12 points a game was
 * landing in the same bucket as three-point-a-game backups, whose promotions
 * drive that +151%, and inherited a ceiling of 512 — higher than any back has
 * ever scored. The promotion is already priced into the analyst's median: he is
 * projecting a starter. So each player is compared to the NEAREST historical
 * seasons instead, the ones that began at roughly the level he is projected
 * for. The band tightens with level because the evidence does.
 *
 * Run: node scripts/build-projection-bands.js [--dry]
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const PROJ = path.join(DATA, 'projections-2026.json');
const WEEKLY = path.join(DATA, 'weekly');

const GAMES_PER_SEASON = 17;
// Matches FLOOR_PERCENTILE in build-rankings.js. If one moves, move both.
const FLOOR_PCT = 15;
const CEIL_PCT = 85;
// A season under this many games says more about availability than about
// production, and availability is not what this band measures.
const MIN_GAMES = 8;
// Below this a percentile is being read off a handful of careers. Publishing a
// band from that would be inventing precision, so the run stops instead.
const MIN_PAIRS = 20;
// Sanity rails. A multiplier outside these means the inputs moved under us.
const MULT_SANE = { floor: [0.35, 0.95], ceiling: [1.05, 3.5] };

const POSITIONS = ['QB', 'RB', 'WR', 'TE'];

function log(m) { console.log(`[bands] ${m}`); }

function percentile(sorted, p) {
  const i = (sorted.length - 1) * p / 100;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// Every consecutive-season pair in the pool: what a player did per game, and
// what he did per game the year before.
function collectPairs() {
  const players = JSON.parse(fs.readFileSync(path.join(DATA, 'players.json'), 'utf8'));
  const posById = {};
  players.forEach(p => { posById[p.id] = p.pos; });

  const pairs = [];
  for (const file of fs.readdirSync(WEEKLY)) {
    if (!file.endsWith('.json')) continue;
    const id = file.replace(/\.json$/, '');
    const pos = posById[id];
    if (!POSITIONS.includes(pos)) continue;

    const log_ = JSON.parse(fs.readFileSync(path.join(WEEKLY, file), 'utf8'));
    const ppg = {};
    for (const season of Object.keys(log_)) {
      const games = (log_[season] || []).filter(g => typeof g.fpts === 'number');
      if (games.length >= MIN_GAMES) {
        ppg[Number(season)] = games.reduce((a, g) => a + g.fpts, 0) / games.length;
      }
    }
    for (const season of Object.keys(ppg).map(Number)) {
      const prev = ppg[season - 1];
      if (prev > 0) pairs.push({ pos, prevPpg: prev, ratio: ppg[season] / prev });
    }
  }
  return pairs;
}

/**
 * Local quantiles: the multipliers for a given projected level come from the
 * NEIGHBOURS times K historical seasons that started nearest that level.
 *
 * Centring on the neighbourhood's own median ratio matters: TE seasons drift up
 * 8% in this sample, and without centring every tight end would inherit that
 * drift as free upside on top of the analyst's number.
 */
function multipliersFor(rows, ppg) {
  const near = [...rows].sort((a, b) => Math.abs(a.prevPpg - ppg) - Math.abs(b.prevPpg - ppg))
    .slice(0, Math.max(MIN_PAIRS, Math.round(rows.length * 0.45)));
  const sorted = near.map(r => r.ratio).sort((a, b) => a - b);
  const mid = percentile(sorted, 50);
  if (!(mid > 0)) throw new Error(`median ratio is ${mid} near ${ppg} ppg`);
  const floor = percentile(sorted, FLOOR_PCT) / mid;
  const ceiling = percentile(sorted, CEIL_PCT) / mid;
  for (const [k, v] of Object.entries({ floor, ceiling })) {
    const [lo, hi] = MULT_SANE[k];
    if (v < lo || v > hi) throw new Error(`${k} multiplier ${v.toFixed(2)} near ${ppg} ppg is outside [${lo}, ${hi}]`);
  }
  return { floor, ceiling, neighbours: near.length };
}

function buildModel(pairs) {
  const model = {};
  for (const pos of POSITIONS) {
    const rows = pairs.filter(p => p.pos === pos);
    if (rows.length < MIN_PAIRS * 2) {
      throw new Error(`${pos}: only ${rows.length} season pairs, need ${MIN_PAIRS * 2}`);
    }
    // A readable summary of the curve, for the meta block and for anyone
    // checking that the band tightens as the level rises.
    const levels = [6, 9, 12, 15, 18, 21];
    const curve = {};
    for (const ppg of levels) {
      const m = multipliersFor(rows, ppg);
      curve[`${ppg}ppg`] = { floor: +m.floor.toFixed(3), ceiling: +m.ceiling.toFixed(3) };
    }
    model[pos] = { pairs: rows.length, rows, curve };
  }
  return model;
}

function main() {
  const dry = process.argv.includes('--dry');
  const pairs = collectPairs();
  log(`${pairs.length} consecutive-season pairs from ${fs.readdirSync(WEEKLY).length} game logs`);

  const model = buildModel(pairs);
  for (const pos of POSITIONS) {
    const m = model[pos];
    const c = m.curve;
    log(`${pos} (n=${m.pairs}): ` + Object.entries(c).map(([lvl, v]) => `${lvl} x${v.floor}/x${v.ceiling}`).join('  '));
  }

  const file = JSON.parse(fs.readFileSync(PROJ, 'utf8'));
  let banded = 0, skipped = 0, widened = 0, narrowed = 0;

  for (const [key, list] of Object.entries(file.projections)) {
    const pos = key.toUpperCase();
    if (!model[pos]) continue;
    for (const p of list) {
      // A baseline-only entry is a median with no claim of a range. Inventing
      // one here would be asserting confidence the file deliberately withheld.
      if (p.baselineOnly || typeof p.median !== 'number') { skipped++; continue; }
      const ppg = p.median / GAMES_PER_SEASON;
      const m = multipliersFor(model[pos].rows, ppg);
      const before = (p.ceiling || 0) - (p.floor || 0);
      p.floor = Math.round(p.median * m.floor);
      p.ceiling = Math.round(p.median * m.ceiling);
      if (p.ceiling - p.floor > before) widened++; else narrowed++;
      banded++;
    }
  }

  file.meta = file.meta || {};
  // This line used to say the bands were hand-set judgment, which stopped being
  // true the moment this script ran. It is owned here now so it cannot go stale
  // again. Worth recording that the note it replaces reached the same finding
  // independently: an earlier Monte Carlo of the top WRs found the hand-set
  // bands "systematically 10-28 points too narrow and too symmetric (true
  // distributions are right-skewed, ~1.24)". The established-WR ceiling this
  // model derives from three seasons of game logs is x1.24.
  file.meta.bandCaveat = 'Bands are derived, not hand-set: the 15th and 85th percentile of year-over-year change in points per game, taken from the seasons that began nearest each player\'s projected level. They are right-skewed because outcomes are. The median they surround is the analyst\'s forecast, not a simulation. Availability is priced separately as the missed-time case, so it is not inside these bands.';
  file.meta.bands = {
    generated: new Date().toISOString(),
    method: `Floor and ceiling are the ${FLOOR_PCT}th and ${CEIL_PCT}th percentile of year-over-year change in points per game across this pool, centred on the median outcome so the analyst's projection stays the expected case.`,
    perGame: 'Measured per game, because the projections assume 17 games and the rankings chart draws availability as a separate downside. Folding missed games in here would count one injury twice.',
    level: 'Each player is compared to the historical seasons that began nearest his projected points per game, because upside depends on level. Pooling them gave a 12-point-a-game back the upside of a promoted backup and a ceiling of 512, which is higher than any back has ever scored — that promotion is already inside the analyst\'s median.',
    medianIsHandSet: 'Medians are the analyst\'s forecast and are never generated. Only the range around them is.',
    sample: Object.fromEntries(Object.entries(model).map(([k, v]) => [k, { pairs: v.pairs, curve: v.curve }])),
    caveats: `Three seasons of game logs, and only players who played ${MIN_GAMES}+ games in consecutive seasons. That is survivorship: a player who lost his job or his season entirely leaves the sample, so the real downside is likely worse than the floor shown.`,
  };

  if (dry) { log('dry run — nothing written'); return; }
  fs.writeFileSync(PROJ, JSON.stringify(file, null, 2) + '\n');
  log(`banded ${banded} players (${widened} wider, ${narrowed} tighter), left ${skipped} baseline-only entries alone`);
}

main();
