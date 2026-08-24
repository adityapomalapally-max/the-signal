/**
 * The rushing triangulation.
 *
 * RYOE is the number everyone quotes and the number most likely to be
 * over-read. Measured on this data, 2018-2025: a back's RYOE per attempt
 * repeats year to year at r = 0.22, and as a PERCENTAGE at 0.09 — the form it
 * is usually quoted in is the least repeatable of the three. Yards per carry
 * repeats better (0.29). The distribution is right-skewed (skew 0.57, p90 0.86
 * against a maximum of 2.87), so a season-long figure is carried by a handful
 * of long runs.
 *
 * That is why the three legs travel together, and why 2025 is such a clean
 * demonstration: Rhamondre Stevenson is FIRST in RYOE percentage and 41st of 46
 * in EPA per carry. He beat the tracking expectation by more than anyone in
 * football and his carries were still worth less than almost everyone's.
 * Rachaad White is the mirror image at 40th and 2nd.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const rushing = read('rushing.json');
const ngs = read('ngs.json');
const NGS_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'fetch-ngs.js'), 'utf8');
const LIB = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'rushing.js'), 'utf8');

const latest = Math.max(...Object.keys(rushing.seasons).map(Number));
const backs = rushing.seasons[String(latest)];

test('the percentage form is derived, not the column that shares its name', () => {
  // `rush_pct_over_expected` runs 0.34 to 0.49 across qualified backs: it is
  // the SHARE OF CARRIES that beat their expectation, a consistency measure.
  // Read as "RYOE as a percentage" it would have put 0.4% beside a season James
  // Cook ran 28% above the bar.
  assert.match(NGS_SRC, /beatRate: round\(r\.rush_pct_over_expected/,
    'rush_pct_over_expected is no longer named for what it measures');
  assert.match(NGS_SRC, /ryoePct: pct\(r\.rush_yards_over_expected, r\.expected_rush_yards\)/,
    'the percentage form is no longer derived from RYOE over the expectation');

  // And it has to come out in the right range on real data.
  const rows = Object.values(ngs).map((p) => (p && p[String(latest)] && p[String(latest)].rush) || null)
    .filter((r) => r && r.ryoePct !== null && r.attempts >= 100);
  assert.ok(rows.length >= 10, `only ${rows.length} backs with a percentage to check`);
  for (const r of rows) {
    assert.ok(Math.abs(r.ryoePct) < 100, `a RYOE percentage of ${r.ryoePct}% is not a share of the expectation`);
    if (r.beatRate !== null) assert.ok(r.beatRate > 0 && r.beatRate <= 1,
      `beatRate ${r.beatRate} is not a share of carries`);
  }
});

test('a divide by an absent expectation returns nothing, not Infinity', () => {
  assert.match(NGS_SRC, /if \(!isFinite\(o\) \|\| !isFinite\(e\) \|\| e <= 0\) return null/,
    'the percentage no longer guards against a back with no expectation to beat');
});

test('kneels are not carries', () => {
  // Counted in, they drag every leader down by an amount that has nothing to
  // do with running the ball.
  assert.match(LIB, /qb_kneel/, 'kneels are back in the carry counts');
  assert.match(LIB, /qb_spike/, 'spikes are back in the carry counts');
});

test('success rate travels with EPA per carry', () => {
  // EPA per carry is an average over a skewed distribution and one long
  // touchdown moves it. Success rate asks the same question in a way a single
  // run cannot dominate, so publishing one without the other is publishing the
  // fragile half alone.
  for (const [id, b] of Object.entries(backs)) {
    assert.ok(typeof b.epaPerCarry === 'number', `${id} has no EPA per carry`);
    assert.ok(typeof b.successRate === 'number', `${id} has no success rate`);
    assert.ok(b.successRate >= 0 && b.successRate <= 100, `${id}: success rate ${b.successRate}`);
    assert.ok(b.carries >= rushing.meta.minCarries, `${id}: ${b.carries} carries is under the floor`);
  }
});

test('the three legs are allowed to disagree, and do', () => {
  // If they ever ranked backs the same way, two of them would be decoration.
  const players = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'players.json'), 'utf8'));
  const rows = [];
  for (const p of players) {
    const n = ngs[p.id] && ngs[p.id][String(latest)] && ngs[p.id][String(latest)].rush;
    const r = p.gsisId && backs[p.gsisId];
    if (!n || !r || n.ryoePct === null || n.attempts < 100) continue;
    rows.push({ name: p.name, ryoePct: n.ryoePct, epa: r.epaPerCarry });
  }
  assert.ok(rows.length >= 20, `only ${rows.length} backs carry both legs — the GSIS join has broken`);

  const byRyoe = [...rows].sort((a, b) => b.ryoePct - a.ryoePct).map((r) => r.name);
  const byEpa = [...rows].sort((a, b) => b.epa - a.epa).map((r) => r.name);
  const worstGap = Math.max(...rows.map((r) => Math.abs(byRyoe.indexOf(r.name) - byEpa.indexOf(r.name))));
  assert.ok(worstGap > rows.length / 4,
    `the two orderings never diverge by more than ${worstGap} places out of ${rows.length}; `
    + 'if RYOE and EPA agree this closely, showing both is decoration');
});

test('the file states what EPA per carry is and is not', () => {
  const c = JSON.stringify(rushing.meta.caveats);
  assert.match(c, /third and six|situation/i, 'nothing says EPA prices the situation rather than the yardage');
  assert.match(c, /skewed|one long touchdown/i, 'nothing warns that one long run moves the average');
  assert.match(c, /kneel/i, 'nothing records that kneels are excluded');
  assert.match(c, /not the one that employs him now/i, 'nothing says which team a season belongs to');
});
