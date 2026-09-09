/**
 * Expected fantasy points — the file with the most ways to be quietly wrong.
 *
 * Every other board here reports something that happened. This one reports what
 * should have happened, which means a bug in it produces a number that is
 * plausible, well-formatted, and impossible to check by eye. The failures worth
 * writing down:
 *
 *   THE TWO SIDES CAN COME FROM DIFFERENT PLAYS. Actual points from one source
 *   and expected from another gives a diff that is mostly the gap between the
 *   sources. Both sides here are built from the same play set on the same
 *   scoring, so league actual and league expected can differ only by what the
 *   thin-cell fallbacks smoothed — 0.1% measured. A wide gap means the pricing
 *   and the attribution have come loose, and every per-player figure on the
 *   site is then wrong by an amount nobody can see.
 *
 *   A CELL CAN BE PRICED OFF NOISE. The first grid had a cell of forty plays
 *   worth 4.00 points each. Cells under the floor fall back to the marginal,
 *   and the share that did is published — if it climbs, the grid has stopped
 *   fitting the data.
 *
 *   THE ARITHMETIC CAN BE BACKWARDS AND LOOK FINE. The witness is physical: a
 *   ball CAUGHT IN THE END ZONE IS A TOUCHDOWN, so in those cells the catch
 *   rate and the touchdown rate are the same number. Nothing about the code
 *   forces that — it falls out of the join being right — which is exactly what
 *   makes it worth asserting.
 *
 *   node --test tests/xfp.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const D = path.join(__dirname, '..', 'data');
const xfp = JSON.parse(fs.readFileSync(path.join(D, 'xfp.json'), 'utf8'));
const pool = JSON.parse(fs.readFileSync(path.join(D, 'players.json'), 'utf8'));

const seasons = xfp.meta.seasons;
const latest = seasons[seasons.length - 1];
const players = xfp.seasons[latest];

test('a ball caught in the end zone is a touchdown', () => {
  // THE PHYSICAL WITNESS. Nothing in the code enforces this; it is true only if
  // the completion flag, the touchdown flag and the target line are being read
  // off the same play. A join that slips by one row breaks it immediately.
  const ez = Object.entries(xfp.cells.targets).filter(([k]) => k.endsWith('|endzone'));
  assert.ok(ez.length >= 2, 'the end-zone cells have gone from the price table');
  for (const [key, c] of ez) {
    assert.strictEqual(c.catchRate, c.tdRate,
      `${key}: ${c.catchRate}% of these were caught but ${c.tdRate}% scored — a catch in the end zone is a touchdown`);
  }
});

test('nothing outside the end zone scores on every catch', () => {
  // The other half of the same witness, and the one that catches the mutation
  // that would make the test above pass trivially: if tdRate were simply copied
  // from catchRate, every cell would match, not only the end-zone ones.
  const off = Object.entries(xfp.cells.targets).filter(([k]) => !k.endsWith('|endzone'));
  const identical = off.filter(([, c]) => c.catchRate === c.tdRate && c.catchRate > 0);
  assert.deepStrictEqual(identical.map(([k]) => k), [],
    'a cell outside the end zone scores on every completion, which cannot happen');
});

test('league actual and league expected are the same points counted twice', () => {
  const b = xfp.meta.build;
  assert.ok(b && Number.isFinite(b.leagueRatio), 'the file no longer states its own consistency check');
  assert.ok(Math.abs(b.leagueRatio - 1) <= 0.02,
    `league actual is ${b.leagueRatio}x league expected — the pricing and the attribution disagree`);
});

test('the grid still fits the data', () => {
  const b = xfp.meta.build;
  assert.ok(Number.isFinite(b.fallbackPct), 'the fallback share is not reported');
  assert.ok(b.fallbackPct < 5,
    `${b.fallbackPct}% of opportunities were priced off a marginal rather than their own cell — the grid has stopped fitting`);
  assert.strictEqual(b.skippedNoLine, 0,
    'opportunities are being dropped for want of a field position — pbp has changed');
});

test('a thin cell is marked, not hidden', () => {
  for (const side of ['targets', 'carries']) {
    for (const [key, c] of Object.entries(xfp.cells[side])) {
      assert.strictEqual(c.thin, c.n < xfp.meta.build.minCell,
        `${side} ${key}: n=${c.n} but thin=${c.thin}`);
    }
  }
});

test('a chance at the goal line is worth more than the same chance in the open field', () => {
  // The whole point of the model in one assertion. If this inverts, the target
  // line is being read backwards — a mistake that leaves every value in range
  // and every total correct, and reverses the meaning of the entire board.
  const t = xfp.cells.targets;
  for (const depth of ['short', 'inter', 'deep']) {
    const ez = t[`${depth}|endzone`], far = t[`${depth}|21+`];
    if (!ez || !far) continue;
    assert.ok(ez.price > far.price,
      `a ${depth} throw into the end zone prices at ${ez.price} and one past the 21 at ${far.price}`);
    assert.ok(ez.tdRate > far.tdRate,
      `${depth}: end-zone touchdown rate ${ez.tdRate}% is not above the open-field ${far.tdRate}%`);
  }
  const c = xfp.cells.carries;
  if (c['gl|early'] && c['back|early']) {
    assert.ok(c['gl|early'].price > c['back|early'].price,
      `a carry from the goal line prices at ${c['gl|early'].price} and one from beyond the 50 at ${c['back|early'].price}`);
  }
});

test('a deeper throw is caught less often', () => {
  // Independent of the scoring dimension, and it fails if the depth bands are
  // shuffled — which the price assertions above would not notice.
  const t = xfp.cells.targets;
  const far = ['behind', 'short', 'inter', 'deep'].map(d => t[`${d}|21+`]).filter(Boolean);
  assert.ok(far.length >= 3, 'the open-field depth cells have gone');
  for (let i = 1; i < far.length; i++) {
    assert.ok(far[i].catchRate < far[i - 1].catchRate,
      `catch rate does not fall with depth: ${far.map(c => c.catchRate).join(' -> ')}`);
  }
});

test('every player has the opportunities his totals were built from', () => {
  for (const [id, p] of Object.entries(players)) {
    const opps = p.targets + p.carries;
    assert.ok(opps >= xfp.meta.build.minOpportunities,
      `${id} is published on ${opps} opportunities, under the stated floor`);
    assert.ok(p.xfp > 0, `${id} has ${opps} opportunities and ${p.xfp} expected points`);
    assert.ok(p.games >= 1 && p.games <= 23, `${id}: ${p.games} games`);
    assert.strictEqual(p.diff, Math.round((p.fp - p.xfp) * 10) / 10,
      `${id}: diff ${p.diff} does not equal fp ${p.fp} minus xfp ${p.xfp}`);
  }
});

test('the weekly series adds up to the season it belongs to', () => {
  // The weekly chart and the season headline are drawn from the same rows, so a
  // reader can add the chart up and get the total. If they drift, one of them
  // is being written from a different accumulator.
  for (const [id, p] of Object.entries(players)) {
    const wkFp = p.weeks.reduce((a, w) => a + w.fp, 0);
    const wkXfp = p.weeks.reduce((a, w) => a + w.xfp, 0);
    // Each week is rounded to a tenth before summing, so the total may drift by
    // half a point across seventeen of them. More than that is a real gap.
    assert.ok(Math.abs(wkFp - p.fp) < 1.5, `${id}: weeks sum to ${wkFp.toFixed(1)} points, season says ${p.fp}`);
    assert.ok(Math.abs(wkXfp - p.xfp) < 1.5, `${id}: weeks sum to ${wkXfp.toFixed(1)} expected, season says ${p.xfp}`);
    assert.strictEqual(p.weeks.length, p.games, `${id}: ${p.weeks.length} weeks but ${p.games} games`);
  }
});

test('a week a player did not play is absent, never a zero', () => {
  // Same rule the weekly shards follow. A zero reads as "played and got
  // nothing", which is a different fact from "did not play" — and on a chart
  // of points against expectation it draws a dip that never happened.
  for (const [id, p] of Object.entries(players)) {
    for (const w of p.weeks) {
      assert.ok(w.opps > 0, `${id} week ${w.week} is published with no opportunities in it`);
    }
    const weeks = p.weeks.map(w => w.week);
    assert.strictEqual(new Set(weeks).size, weeks.length, `${id} carries a week twice`);
  }
});

test('quarterbacks are absent rather than published wrong', () => {
  // Passing is not priced. A quarterback's rushing expectation beside his total
  // points would show every one of them hundreds over expected, so they are
  // left out — and the file has to say so, because an absence explains nothing
  // by itself.
  const qbGsis = new Set(pool.filter(p => p.pos === 'QB' && p.gsisId).map(p => p.gsisId));
  const published = Object.keys(players).filter(id => qbGsis.has(id));
  assert.deepStrictEqual(published, [],
    `${published.length} quarterbacks are in a file that does not price passing`);
  assert.ok(xfp.meta.caveats.some(c => /passing is not priced/i.test(c)),
    'the file no longer says why quarterbacks are missing');
});

test('the price table travels with the numbers it produced', () => {
  // A figure whose source lives only in the builder is one the reader has to
  // take on trust. Same rule the medical research layer follows.
  assert.ok(xfp.cells && xfp.cells.targets && xfp.cells.carries, 'the price table has gone');
  assert.ok(Object.keys(xfp.cells.targets).length >= 12, 'the target price table has collapsed');
  assert.ok(Object.keys(xfp.cells.carries).length >= 10, 'the carry price table has collapsed');
  for (const side of ['targets', 'carries']) {
    for (const [key, c] of Object.entries(xfp.cells[side])) {
      assert.ok(Number.isFinite(c.price) && c.price > 0, `${side} ${key} has no price`);
      assert.ok(c.n > 0, `${side} ${key} has a price off no plays`);
    }
  }
});

test('the file states that the gap is mostly touchdowns', () => {
  // The single most important caveat, because the number invites exactly the
  // reading it does not support: a player far over expected is usually not a
  // player who stays there.
  assert.ok(xfp.meta.caveats.some(c => /touchdowns do not repeat/i.test(c)),
    'the caveat that the diff is mostly touchdown variance has gone');
  assert.match(xfp.meta.scoring, /PPR/, 'the file no longer states its scoring');
  assert.match(xfp.meta.method, /EMPIRICAL, NOT FITTED/,
    'the file no longer says the prices are measured rather than modelled');
});
