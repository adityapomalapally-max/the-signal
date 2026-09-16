#!/usr/bin/env node
/**
 * research-xfp-carryover.js — can last season's prices price this season?
 *
 * THE QUESTION, ASKED PROPERLY. Expected fantasy points are a mean over a
 * season's own plays, so in September a season prices itself off almost
 * nothing: two weeks of 2026 put 29.3% of opportunities on a marginal cell and
 * left league expected 10.9% away from league actual. The file is withheld
 * until its grid fits, which is honest and means the board is dark through the
 * weeks it would be most useful — actual points are noisiest early, and "were
 * his chances any good" is the question that answers.
 *
 * The alternative is to price a young season off the last FINISHED season's
 * table. Whether that is better is measurable, and the measurement does not
 * need 2026 at all:
 *
 *   TRUTH   — 2025's full season priced by its own full-season table. What
 *             those plays are actually worth.
 *   NOW     — 2025 weeks 1-2 only, priced by the table those two weeks build.
 *             This is the status quo applied to a young season.
 *   PROPOSED— 2025 weeks 1-2 only, priced by 2024's full-season table.
 *
 * Both are then compared against TRUTH over the same plays. The winner is
 * whichever reproduces what those opportunities were really worth.
 *
 * A carried table is also asked the easier question — does it hold up over a
 * whole season — because if it does not, nothing else here matters.
 *
 *   node scripts/research-xfp-carryover.js
 *   node scripts/research-xfp-carryover.js --weeks 3
 */

const { fetchCSV } = require('./lib/match');
const { buildXfp } = require('./lib/xfp');
const feeds = require('./lib/feeds');

const args = process.argv.slice(2);
const WEEKS = args.includes('--weeks') ? Number(args[args.indexOf('--weeks') + 1]) : 2;
const log = (...a) => console.log('[xfp-carry]', ...a);

const pbpUrl = (season) => `${feeds.RELEASES}/pbp/play_by_play_${season}.csv.gz`;

// The young-season slice: the same file, cut at a week. Done here rather than
// in lib/xfp.js — a maxWeek option in the library would be machinery that only
// a research script ever uses.
function throughWeek(csv, week) {
  const lines = csv.split('\n');
  const header = lines[0];
  const cols = header.split(',').map(h => h.replace(/"/g, '').trim());
  const wi = cols.indexOf('week');
  const ti = cols.indexOf('season_type');
  if (wi === -1) throw new Error('pbp has no week column');
  const kept = [header];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const v = lines[i].split(',');
    // Good enough for a cut: week and season_type are plain numbers and words,
    // never quoted fields with commas in them. buildXfp parses properly.
    if (ti !== -1 && (v[ti] || '').replace(/"/g, '').trim() !== 'REG') continue;
    const w = Number((v[wi] || '').replace(/"/g, '').trim());
    if (Number.isFinite(w) && w <= week) kept.push(lines[i]);
  }
  return kept.join('\n');
}

// Per-player expected points per game, over the players both sides published.
function compare(label, candidate, truth) {
  const ids = Object.keys(candidate.players).filter(id => truth.players[id]);
  const rows = ids.map(id => ({
    id,
    a: candidate.players[id].xfpPerG,
    b: truth.players[id].xfpPerG,
  })).filter(r => Number.isFinite(r.a) && Number.isFinite(r.b));

  const diffs = rows.map(r => r.a - r.b);
  const absDiffs = diffs.map(Math.abs).sort((x, y) => x - y);
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const median = (sorted) => sorted[Math.floor(sorted.length / 2)];
  const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

  // Pearson on the values, and the rank gap that actually matters to a reader:
  // how far a player moves on the board when the table changes.
  const ma = mean(rows.map(r => r.a)), mb = mean(rows.map(r => r.b));
  const cov = mean(rows.map(r => (r.a - ma) * (r.b - mb)));
  const sa = Math.sqrt(mean(rows.map(r => (r.a - ma) ** 2)));
  const sb = Math.sqrt(mean(rows.map(r => (r.b - mb) ** 2)));
  const r = cov / (sa * sb);

  const rankOf = (key) => {
    const order = [...rows].sort((x, y) => y[key] - x[key]);
    const m = new Map();
    order.forEach((row, i) => m.set(row.id, i + 1));
    return m;
  };
  const ra = rankOf('a'), rb = rankOf('b');
  const shifts = rows.map(row => Math.abs(ra.get(row.id) - rb.get(row.id))).sort((x, y) => x - y);

  console.log(`\n  ${label}`);
  console.log(`    players compared      ${rows.length}`);
  console.log(`    mean |error| per game ${mean(absDiffs).toFixed(3)} pts   (median ${median(absDiffs).toFixed(3)}, p90 ${pct(absDiffs, 0.9).toFixed(3)})`);
  console.log(`    mean signed error     ${mean(diffs) >= 0 ? '+' : ''}${mean(diffs).toFixed(3)} pts per game`);
  console.log(`    correlation           r = ${r.toFixed(4)}`);
  console.log(`    board movement        median ${median(shifts)} places, p90 ${pct(shifts, 0.9)}, worst ${shifts[shifts.length - 1]}`);
  return { meanAbs: mean(absDiffs), r, medianShift: median(shifts), p90Shift: pct(shifts, 0.9), n: rows.length };
}

async function main() {
  log('fetching play-by-play for 2023, 2024 and 2025...');
  const [pbp23, pbp24, pbp25] = await Promise.all([
    fetchCSV(pbpUrl(2023)), fetchCSV(pbpUrl(2024)), fetchCSV(pbpUrl(2025)),
  ]);

  const full23 = buildXfp(pbp23);
  const full24 = buildXfp(pbp24);
  const full25 = buildXfp(pbp25);
  log(`2023: ${full23.meta.playersQualified} players, ${full23.meta.fallbackPct}% off marginals, ratio ${full23.meta.leagueRatio}`);
  log(`2024: ${full24.meta.playersQualified} players, ${full24.meta.fallbackPct}% off marginals, ratio ${full24.meta.leagueRatio}`);
  log(`2025: ${full25.meta.playersQualified} players, ${full25.meta.fallbackPct}% off marginals, ratio ${full25.meta.leagueRatio}`);

  console.log(`\n${'='.repeat(78)}\n1. DOES A CARRIED TABLE HOLD UP OVER A WHOLE SEASON`);
  console.log('   The easy question first: price a finished season with the previous');
  console.log('   season\'s table and see how far it lands from its own.');
  const carried25 = buildXfp(pbp25, { priceTable: full24.cells });
  console.log(`   2025 priced by 2024: league ratio ${carried25.meta.leagueRatio} (own table: ${full25.meta.leagueRatio}), `
    + `${carried25.meta.unpriced} opportunities had no cell`);
  compare('2025 by 2024\'s table  vs  2025 by its own', carried25, full25);
  const carried24 = buildXfp(pbp24, { priceTable: full23.cells });
  console.log(`   2024 priced by 2023: league ratio ${carried24.meta.leagueRatio} (own table: ${full24.meta.leagueRatio})`);
  compare('2024 by 2023\'s table  vs  2024 by its own', carried24, full24);

  console.log(`\n${'='.repeat(78)}\n2. THE QUESTION THAT DECIDES IT — WEEKS 1-${WEEKS}`);
  console.log('   The same young plays, priced three ways. TRUTH is those plays priced');
  console.log('   by the full season they belong to: what they were really worth.');
  const young25 = throughWeek(pbp25, WEEKS);
  const truth = buildXfp(young25, { priceTable: full25.cells });
  const now = buildXfp(young25);
  const proposed = buildXfp(young25, { priceTable: full24.cells });
  console.log(`\n   NOW      weeks 1-${WEEKS} priced by their own ${WEEKS} weeks: `
    + `${now.meta.fallbackPct}% off marginals, league ratio ${now.meta.leagueRatio}`);
  console.log(`   PROPOSED weeks 1-${WEEKS} priced by 2024's full table:    `
    + `${proposed.meta.fallbackPct}% off marginals, league ratio ${proposed.meta.leagueRatio}`);
  console.log(`   TRUTH    weeks 1-${WEEKS} priced by 2025's full table:    `
    + `${truth.meta.fallbackPct}% off marginals, league ratio ${truth.meta.leagueRatio}`);

  const nowV = compare(`NOW      (self-priced ${WEEKS} weeks)  vs  TRUTH`, now, truth);
  const propV = compare(`PROPOSED (2024's table)          vs  TRUTH`, proposed, truth);

  console.log(`\n${'='.repeat(78)}\nVERDICT`);
  const better = propV.meanAbs < nowV.meanAbs;
  const factor = nowV.meanAbs / propV.meanAbs;
  console.log(`  Pricing a ${WEEKS}-week season off last season's table is ${better ? 'CLOSER' : 'FURTHER'} to what`);
  console.log(`  those opportunities were really worth: ${propV.meanAbs.toFixed(3)} vs ${nowV.meanAbs.toFixed(3)} points per game`);
  console.log(`  of mean error, a factor of ${factor.toFixed(2)}. Board movement against truth:`);
  console.log(`  median ${propV.medianShift} places carried vs ${nowV.medianShift} self-priced.`);
}

main().catch(e => { console.error('[xfp-carry] failed:', e.message); process.exit(1); });
