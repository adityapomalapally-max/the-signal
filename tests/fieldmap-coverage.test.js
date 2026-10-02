/**
 * The field map's uncovered edges.
 *
 * On 2026-10-02 the mutation gate reported 31 survivors across the library
 * files and TWELVE of them were in this one — lines 81, 98, 106, 141, 147, 152,
 * 203, 211, 212, 213 and 260. fieldmap.js was the thinnest-covered code in the
 * repo by a factor of three, which matters because it is also the file whose
 * output looks most authoritative: a 3x4 heatmap with a number in every cell.
 *
 * Each test here was written against a named survivor and verified by putting
 * that mutation back and watching this file go red. They are grouped by the
 * thing they protect rather than by line, because line numbers drift.
 *
 *   node --test tests/fieldmap-coverage.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fm = require('../scripts/lib/fieldmap.js');
const { buildFieldMap, finishFieldMap, finishPass, finishRush, blankCell, addPass, round,
        MIN_CELL, MIN_CELL_STRIP, MIN_ATTEMPTS } = fm;

const COLS = ['pass_attempt', 'play_type', 'pass_location', 'air_yards', 'run_location', 'run_gap',
              'rusher_player_id', 'receiver_player_id', 'passer_player_id', 'yards_gained', 'epa',
              'rush', 'complete_pass', 'success', 'cpoe', 'pass_touchdown', 'rush_touchdown',
              'yardline_100', 'ydstogo', 'down'];
const row = (o) => COLS.map(c => (o[c] === undefined ? '' : o[c])).join(',');
const csv = (rows) => [COLS.join(','), ...rows].join('\n');

const pass = (o = {}) => row({
  pass_attempt: 1, play_type: 'pass', pass_location: 'left', air_yards: 5,
  passer_player_id: 'QB1', receiver_player_id: 'WR1', complete_pass: 1,
  yards_gained: 8, epa: 0.4, cpoe: 2, success: 1, ...o,
});
const run = (o = {}) => row({
  rush: 1, play_type: 'run', run_location: 'right', run_gap: 'guard',
  rusher_player_id: 'RB1', yards_gained: 4, epa: 0.2, success: 1,
  yardline_100: 50, ydstogo: 10, down: 1, ...o,
});

// ── CPOE: accumulated only when present, published only above the floor ─────

test('cpoe is published when there are enough of it (line 81: !== null)', () => {
  // The mutant made the accumulator fire only when cpoe was NULL, so cpoeN
  // never rose and the column silently vanished from every cell on the site.
  const cell = blankCell();
  for (let i = 0; i < MIN_CELL; i++) addPass(cell, { complete: true, yards: 8, td: false, epa: 0.4, cpoe: 3, success: true });
  assert.strictEqual(cell.cpoeN, MIN_CELL, 'cpoe samples were not counted');
  const out = finishPass(cell, 100, MIN_CELL);
  assert.strictEqual(out.cpoe, 3, 'cpoe did not reach the cell');
});

test('a throw with no cpoe does not pretend to have one', () => {
  const cell = blankCell();
  for (let i = 0; i < MIN_CELL; i++) addPass(cell, { complete: true, yards: 8, td: false, epa: 0.4, cpoe: null, success: true });
  assert.strictEqual(cell.cpoeN, 0, 'a null cpoe was counted as a sample');
  assert.strictEqual(finishPass(cell, 100, MIN_CELL).cpoe, undefined,
    'cpoe was published off no samples at all');
});

test('the cpoe floor is ON the floor, not past it (line 98: >=)', () => {
  // Exactly MIN_CELL samples publishes. The mutant required one more, which is
  // invisible — a missing cpoe looks like a feed that did not carry it.
  const at = blankCell(), under = blankCell();
  for (let i = 0; i < MIN_CELL; i++) addPass(at, { complete: true, yards: 8, td: false, epa: 0, cpoe: 1, success: true });
  for (let i = 0; i < MIN_CELL - 1; i++) addPass(under, { complete: true, yards: 8, td: false, epa: 0, cpoe: 1, success: true });
  // The cell itself has to clear its own floor for either to be published, so
  // pad the thin one's n without padding its cpoe.
  for (let i = 0; i < 5; i++) addPass(under, { complete: true, yards: 8, td: false, epa: 0, cpoe: null, success: true });
  assert.strictEqual(finishPass(at, 100, MIN_CELL).cpoe, 1, 'exactly the floor was refused');
  assert.strictEqual(finishPass(under, 100, MIN_CELL).cpoe, undefined, 'one under the floor was published');
});

// ── round: a missing number is null, never nought ───────────────────────────

test('round hands back null for what it cannot round (line 106)', () => {
  // THE MUTANT TURNED NULL INTO 0. On a rate that is the difference between
  // "not measured" and "measured as nothing", and 0 sorts to the bottom of a
  // board where absent would have been left out of it.
  assert.strictEqual(round(null, 1), null);
  assert.strictEqual(round(undefined, 1), null);
  assert.strictEqual(round(NaN, 1), null);
  assert.strictEqual(round(0 / 0, 2), null, '0/0 is NaN and must not round to 0');
  assert.strictEqual(round(1.26, 1), 1.3, 'and it still rounds real numbers');
  assert.strictEqual(round(0, 1), 0, 'a real zero survives');
});

// ── what counts as a carry, and as a located throw ──────────────────────────

test('a scramble is not a carry on the gap chart (line 141: && not ||)', () => {
  // `rush === '1' && play_type === 'run'`. With `||`, a quarterback scramble —
  // rush set, play_type still 'pass' — lands in the gap chart, and so does a
  // kneel. The gap chart is about designed runs hitting a hole.
  const raw = buildFieldMap(csv([
    run(),
    row({ rush: 1, play_type: 'pass', run_location: 'middle', rusher_player_id: 'QB1', yards_gained: 9 }),
    row({ rush: 1, play_type: 'qb_kneel', run_location: 'middle', rusher_player_id: 'QB1', yards_gained: -1 }),
  ]));
  assert.strictEqual(raw.coverage.carries, 1, 'something that was not a designed run was counted');
  assert.ok(!raw.rushers.has('QB1'), 'a scramble or a kneel reached the gap chart');
});

test('a throw with no air yards is excluded like one with no location (line 147: ||)', () => {
  // The existing suite covers the no-location half. `||` -> `&&` needs the
  // other one: a located throw whose air_yards never made the file would land
  // in no band at all and still be counted as located.
  const raw = buildFieldMap(csv([
    pass(),
    pass({ air_yards: '' }),           // located, no depth
    pass({ pass_location: '' }),       // depth, no location
  ]));
  assert.strictEqual(raw.coverage.attempts, 3);
  assert.strictEqual(raw.coverage.located, 1, 'a throw with no air yards was counted as located');
  const p = raw.passers.get('QB1');
  assert.strictEqual(p.total, 1, 'an unplaceable throw reached a cell');
});

test('a completion is a completion (line 152)', () => {
  // The mutant inverted it, which leaves every rate plausible and every one
  // wrong — the hardest kind of error to see on a heatmap.
  const raw = buildFieldMap(csv([
    ...Array.from({ length: 7 }, () => pass({ complete_pass: 1 })),
    ...Array.from({ length: 3 }, () => pass({ complete_pass: 0, yards_gained: 0 })),
  ]));
  const cell = finishPass(raw.passers.get('QB1').cells['left-short'], 10, MIN_CELL);
  assert.strictEqual(cell.n, 10);
  assert.strictEqual(cell.compPct, 70, 'the completion rate is not the completions over the throws');
});

// ── the rushing situations, and the boundaries that define them ─────────────

test('a run for no gain is a stuff (line 203: <= 0)', () => {
  // ON the boundary. A zero-yard carry is the canonical stuffed run and the
  // mutant counted only losses, understating the thing the column exists for.
  const raw = buildFieldMap(csv([
    run({ yards_gained: 0 }), run({ yards_gained: -2 }), run({ yards_gained: 5 }),
  ]));
  const gap = raw.rushers.get('RB1').gaps['right-guard'];
  assert.strictEqual(gap.n, 3);
  assert.strictEqual(gap.stuff, 2, 'a no-gain run was not counted as a stuff');
});

test('a ten-yard run is a ten-yard run, on the boundary', () => {
  const raw = buildFieldMap(csv([run({ yards_gained: 10 }), run({ yards_gained: 9 })]));
  assert.strictEqual(raw.rushers.get('RB1').gaps['right-guard'].ten, 1);
});

test('a carry with no yardline is in no situation at all (line 211: && not ||)', () => {
  // `yl !== null && yl <= 5`. With `||` a missing yardline reads as a goal-line
  // carry, because `null <= 5` is true — so every play on a feed that stopped
  // publishing yardline_100 would become a goal-line carry.
  const raw = buildFieldMap(csv([run({ yardline_100: '', ydstogo: '', down: '' })]));
  const sit = raw.rushers.get('RB1').situations;
  assert.deepStrictEqual(Object.keys(sit), [],
    `a carry with no field position landed in ${Object.keys(sit).join(', ')}`);
});

test('third and two is short yardage, and second and two is not (line 212: >=)', () => {
  // The boundary is the down, not the distance: short yardage means third or
  // fourth, and the mutant quietly dropped every third down.
  const third = buildFieldMap(csv([run({ down: 3, ydstogo: 2 })]));
  assert.ok(third.rushers.get('RB1').situations.shortYardage, 'third and two was not short yardage');
  const fourth = buildFieldMap(csv([run({ down: 4, ydstogo: 1 })]));
  assert.ok(fourth.rushers.get('RB1').situations.shortYardage);
  const second = buildFieldMap(csv([run({ down: 2, ydstogo: 2 })]));
  assert.ok(!second.rushers.get('RB1').situations.shortYardage, 'second and two was counted');
  const long = buildFieldMap(csv([run({ down: 3, ydstogo: 8 })]));
  assert.ok(!long.rushers.get('RB1').situations.shortYardage, 'third and eight was counted');
});

test('open field is beyond the twenty, goal line is inside the five (line 213)', () => {
  const far = buildFieldMap(csv([run({ yardline_100: 35 })]));
  const sit = far.rushers.get('RB1').situations;
  assert.ok(sit.openField, 'a carry from the 35 was not open field');
  assert.ok(!sit.goalline);
  const close = buildFieldMap(csv([run({ yardline_100: 3 })]));
  const near = close.rushers.get('RB1').situations;
  assert.ok(near.goalline, 'a carry from the 3 was not a goal-line carry');
  assert.ok(!near.openField, 'a carry from the 3 was called open field');
  // The gap between them is deliberate: 6 to 20 is neither, and nothing should
  // invent a third label for it.
  const mid = buildFieldMap(csv([run({ yardline_100: 12 })]));
  assert.deepStrictEqual(Object.keys(mid.rushers.get('RB1').situations), []);
});

// ── the published grid ──────────────────────────────────────────────────────

test('a qualified passer gets his own cells, not twelve empty ones (line 260)', () => {
  // `p.cells[k] || blankCell()`. With `&&` every cell that HAD throws in it was
  // replaced by an empty one, so a 200-attempt quarterback published a full
  // twelve-cell grid of zeroes — the exact shape of a number that looks
  // authoritative and means nothing, which is what this file's own header warns
  // about.
  const throws = [];
  for (let i = 0; i < MIN_ATTEMPTS; i++) {
    throws.push(pass({ pass_location: i % 2 ? 'left' : 'right', air_yards: i % 2 ? 5 : 25 }));
  }
  const fin = finishFieldMap(buildFieldMap(csv(throws)), null);
  const qb = fin.passers.QB1;
  assert.ok(qb, `${MIN_ATTEMPTS} attempts did not qualify a passer`);
  assert.strictEqual(qb.attempts, MIN_ATTEMPTS);
  const left = qb.cells['left-short'], right = qb.cells['right-deep'];
  assert.strictEqual(left.n + right.n, MIN_ATTEMPTS, 'the throws did not reach their cells');
  assert.ok(left.n > 0 && right.n > 0, 'a cell with throws in it came back empty');
  // And the twelve are all present, thin ones marked rather than missing.
  assert.strictEqual(Object.keys(qb.cells).length, 12);
  assert.ok(qb.cells['middle-behind'].thin, 'an empty cell is not marked thin');
});
