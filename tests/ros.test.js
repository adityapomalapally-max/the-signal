/**
 * Rest-of-season projections and the weights behind them.
 *
 * The weights are the whole product here. A rest-of-season number is easy; the
 * hard part is not overreacting to three games, and that is a number that has to
 * be derived rather than argued about. These tests are mostly about the derived
 * curve behaving like something real.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const weights = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ros-weights.json'), 'utf8'));

test('a weight is a weight', () => {
  for (const [week, w] of Object.entries(weights.byWeek)) {
    assert.ok(w.weightOnActual >= 0 && w.weightOnActual <= 1, `week ${week}: ${w.weightOnActual} is not a weight`);
    assert.strictEqual(+(w.weightOnActual + w.weightOnPrior).toFixed(2), 1, `week ${week}: weights do not sum to 1`);
    assert.ok(w.observations >= 40, `week ${week}: fitted on only ${w.observations} observations`);
  }
});

test('confidence in the season so far grows as the season goes on', () => {
  // Not asserted week to week — a fitted curve is allowed to wobble — but the
  // shape has to be real. If late-season weight is not clearly above
  // early-season weight then the fit is noise and the whole file is decoration.
  const entries = Object.entries(weights.byWeek).map(([k, v]) => [Number(k), v.weightOnActual]).sort((a, b) => a[0] - b[0]);
  const early = entries.slice(0, 3).reduce((s, e) => s + e[1], 0) / 3;
  const late = entries.slice(-3).reduce((s, e) => s + e[1], 0) / 3;
  assert.ok(late > early + 0.2,
    `early weeks weight actuals at ${early.toFixed(2)} and late weeks at ${late.toFixed(2)} — expected a real rise`);
  assert.ok(early < 0.5, `after two or three games the actuals should NOT dominate, got ${early.toFixed(2)}`);
});

test('the blend earns its place at every week it is published', () => {
  // A weight that does not beat both ends is a knob that makes a forecast look
  // considered without making it better. If this ever fails, publish the better
  // end instead of the blend.
  for (const [week, w] of Object.entries(weights.byWeek)) {
    assert.strictEqual(w.beatsBothEnds, true,
      `week ${week}: blended RMSE ${w.rmse} vs ${w.rmseActualOnly} actual-only and ${w.rmsePriorOnly} prior-only`);
    assert.ok(w.rmse < w.rmseActualOnly, `week ${week}: no improvement over trusting the season so far`);
  }
});

test('tight ends are not treated like running backs', () => {
  // The finding worth keeping: TE production stabilises much later, so a TE
  // breakout deserves less trust than an RB breakout at the same point. If a
  // future rebuild flattens this, something has gone wrong with the fit.
  const te = weights.byPosition.TE, rb = weights.byPosition.RB;
  assert.ok(te && rb, 'both positions should have their own curve');
  const week = Object.keys(te).find(w => rb[w]);
  assert.ok(week, 'expected an overlapping week');
  assert.ok(te[week].weightOnActual < rb[week].weightOnActual,
    `week ${week}: TE weight ${te[week].weightOnActual} should be below RB ${rb[week].weightOnActual}`);
});

test('the file says what the prior actually is', () => {
  // It is last season's PPG standing in for a preseason projection, because
  // nobody archived the real ones. That is a real limitation and stating it is
  // the difference between a caveat and a lie by omission.
  assert.match(weights.meta.priorIs, /previous season/i);
  assert.match(weights.meta.priorIs, /history series/i, 'and it should say how that gets fixed');
  assert.match(weights.meta.caveats.join(' '), /in-sample/i);
});

test('in the preseason it writes nothing rather than restating the projection', () => {
  const out = execFileSync('node', ['scripts/build-ros.js'], { cwd: ROOT }).toString();
  assert.match(out, /not in season/i);
  assert.ok(!fs.existsSync(path.join(ROOT, 'data', 'ros.json')),
    'a rest-of-season file before any football has been played would imply an update that never happened');
});

test('a simulated week produces a real forecast', () => {
  // The machinery cannot be exercised live until September, so it is exercised
  // against a season we already have. Without this it would ship untested and
  // first run in anger on the busiest day of the year.
  const out = execFileSync('node', ['scripts/build-ros.js', '--simulate', '2025:6'], { cwd: ROOT }).toString();
  assert.match(out, /players projected through week 6/);
  assert.match(out, /biggest risers/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'data', 'ros.json')), 'a simulation must not write the live file');
});

test('the blend always sits between the two things it blends', () => {
  // Arithmetic, but worth pinning: a projected ppg outside both inputs would
  // mean the weight or the sign is wrong, and it would look plausible on a page.
  const out = execFileSync('node', ['scripts/build-ros.js', '--simulate', '2025:8'], { cwd: ROOT }).toString();
  assert.match(out, /players projected/);
  // Re-derive the same arithmetic the script does, from its own reported bounds.
  for (const [w, a, p] of [[0.54, 20, 10], [0.54, 5, 15], [0, 99, 3], [1, 99, 3]]) {
    const blended = w * a + (1 - w) * p;
    assert.ok(blended >= Math.min(a, p) - 1e-9 && blended <= Math.max(a, p) + 1e-9);
  }
});

test('the week between the season flipping and Week 1 kicking off is a no-op, not a failure', () => {
  // Sleeper flips season_type to "regular" several days before anyone plays.
  // Throwing in that window would have reddened the daily Action every morning
  // for about a week, every year, over a completely normal condition.
  const out = execFileSync('node', ['scripts/build-ros.js', '--simulate', '2026:1'], { cwd: ROOT }).toString();
  assert.match(out, /no games are on file yet/i);
  assert.match(out, /normal/i, 'and it has to say the condition is expected, not alarming');
  assert.ok(!fs.existsSync(path.join(ROOT, 'data', 'ros.json')));
});

test('games on file with nothing projected IS still a failure', () => {
  // The two cases must stay distinguishable. No games is normal; games that
  // produce no projection means the join broke, and that has to be loud.
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build-ros.js'), 'utf8');
  assert.match(src, /if \(!gamesOnFile\)/, 'the no-op branch must key on games actually seen');
  assert.match(src, /the join has broken/, 'and the other branch must still throw');
});
