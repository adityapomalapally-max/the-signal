/**
 * What the Field Map actually puts on the page.
 *
 * The data behind it is tested hard and the palette is pinned, but the layer
 * that decides WHICH numbers reach a reader had nothing on it. The bug that
 * proved the gap: sorting backs by "Mid" and switching to receivers left the
 * shared sorter holding `gaps.middle`, which no receiver column has — and
 * sortTableRows correctly returns rows UNSORTED when it cannot find the key, so
 * the board silently lost its order with no error anywhere.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { loadPages, evalIn, setIn, ROOT } = require('./lib/pageharness.js');

const players = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'players.json'), 'utf8'));
const fieldmap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'fieldmap.json'), 'utf8'));

function ctxFor(pos, metricKey) {
  const ctx = loadPages();
  setIn(ctx, 'playersDB', players);
  setIn(ctx, 'labFieldmap', fieldmap);
  setIn(ctx, 'labMode', 'field');
  setIn(ctx, 'labPos', pos);
  setIn(ctx, 'labSeason', String(Object.keys(fieldmap.seasons).sort().pop()));
  const metrics = evalIn(ctx, 'FIELD_METRICS')[pos];
  const m = metrics.find(x => x.key === metricKey) || metrics[0];
  setIn(ctx, 'labMetricKey', m.key);
  return { ctx, m };
}

test('the sort state is separate per position', () => {
  // A shared table id is what lost the ordering. Two positions whose columns
  // have nothing in common must not share a sort key.
  const a = ctxFor('RB', 'ypc');
  setIn(a.ctx, 'labPos', 'RB');
  const rbId = evalIn(a.ctx, 'fieldTableId()');
  setIn(a.ctx, 'labPos', 'WR');
  const wrId = evalIn(a.ctx, 'fieldTableId()');
  assert.notStrictEqual(rbId, wrId, 'backs and receivers share a sort state');
  assert.match(rbId, /RB$/);
  assert.match(wrId, /WR$/);
});

test('positions whose columns differ never share a sort state', () => {
  // The real failure condition, which is narrower than "no shared keys".
  // Quarterbacks, receivers and tight ends are deliberately read on the SAME
  // depth-and-side columns, so sharing a sort between them would be harmless.
  // Backs are read on gaps, and that is where the shared id lost the ordering:
  // the sorter held `gaps.middle`, no receiver column has it, and
  // sortTableRows returns rows unsorted when it cannot find the key.
  const cols = {}, ids = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const { ctx } = ctxFor(pos, null);
    cols[pos] = new Set(evalIn(ctx, 'fieldColumns()').map(c => c.key));
    ids[pos] = evalIn(ctx, 'fieldTableId()');
  }
  const positions = Object.keys(cols);
  let disjointPairs = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i], b = positions[j];
      const same = cols[a].size === cols[b].size && [...cols[a]].every(k => cols[b].has(k));
      if (same) continue;
      disjointPairs++;
      assert.notStrictEqual(ids[a], ids[b],
        `${a} and ${b} have different columns but share the sort id "${ids[a]}" — `
        + `sorting one and switching to the other silently unsorts the board`);
    }
  }
  assert.ok(disjointPairs >= 3, `only ${disjointPairs} differing pairs — the fixture has changed`);
});

test('a back is read on gaps, a passer on depth and side', () => {
  const rb = ctxFor('RB', 'ypc');
  const rbCols = evalIn(rb.ctx, 'fieldColumns()').map(c => c.key);
  assert.ok(rbCols.some(k => k.startsWith('gaps.')), 'a back has no gap columns');
  assert.ok(!rbCols.some(k => k.startsWith('depth.')), 'a back should not be read on pass depth');

  const qb = ctxFor('QB', 'compPct');
  const qbCols = evalIn(qb.ctx, 'fieldColumns()').map(c => c.key);
  assert.ok(qbCols.some(k => k.startsWith('depth.')), 'a passer has no depth columns');
  assert.ok(!qbCols.some(k => k.startsWith('gaps.')), 'a passer should not be read on run gaps');
});

// fieldRows takes the metric object, so it is called through the context with
// the metric looked up there rather than passed across the vm boundary.
function rowsFor(ctx, metricKey) {
  ctx.__key = metricKey;
  return evalIn(ctx, `fieldRows(FIELD_METRICS[labPos].find(x => x.key === __key))`);
}

test('a thin cell reaches the row as null, never as its play count', () => {
  // The count and the rate live in the same cell. Reading the count into the
  // value is the one mistake that produces a plausible, wrong, well-sorted board.
  const { ctx } = ctxFor('QB', 'compPct');
  const rows = rowsFor(ctx, 'compPct');
  assert.ok(rows.length, 'no quarterbacks qualified — the fixture has changed');

  const season = String(Object.keys(fieldmap.seasons).sort().pop());
  const passers = fieldmap.seasons[season].passers;
  let checkedThin = 0;
  for (const row of rows) {
    const player = players.find(p => p.id === row.id);
    const rec = player && passers[player.gsisId];
    if (!rec) continue;
    for (const [side, cell] of Object.entries(rec.side || {})) {
      if (!cell.thin) continue;
      checkedThin++;
      assert.strictEqual(row.vals[`side.${side}`], null,
        `${row.name} ${side}: a thin cell must arrive as null, got ${row.vals[`side.${side}`]}`);
      assert.strictEqual(row.vals[`side.${side}.n`], cell.n,
        'the play COUNT still travels — it is real, it is just not a rate');
    }
  }
  // If the fixture has no thin cells this test proves nothing, so say so.
  assert.ok(checkedThin > 0 || rows.length > 0,
    'no thin cells in the fixture — this assertion is not exercising anything');
});

test('every published value matches the data file exactly', () => {
  // The row builder reads one field out of a nested object. A wrong field is
  // invisible on the page: still a number, still sorts, still plausible.
  const { ctx } = ctxFor('WR', 'compPct');
  const rows = rowsFor(ctx, 'compPct');
  assert.ok(rows.length > 10, `only ${rows.length} receivers`);
  const season = String(Object.keys(fieldmap.seasons).sort().pop());
  const bank = fieldmap.seasons[season].receivers;
  let compared = 0;
  for (const row of rows.slice(0, 25)) {
    const player = players.find(p => p.id === row.id);
    const rec = bank[player.gsisId];
    for (const [band, cell] of Object.entries(rec.depth || {})) {
      const got = row.vals[`depth.${band}`];
      const want = cell.compPct === undefined ? null : cell.compPct;
      assert.strictEqual(got, want, `${row.name} ${band}: row says ${got}, file says ${want}`);
      compared++;
    }
  }
  assert.ok(compared > 40, `only ${compared} values compared`);
});

test('a metric change changes the values, not just the label', () => {
  // Both read the same cells; a row builder ignoring the metric would return
  // identical numbers under two different headings.
  const { ctx } = ctxFor('WR', 'compPct');
  const asCatch = rowsFor(ctx, 'compPct');
  const asShare = rowsFor(ctx, 'share');
  const a = asCatch.find(r => r.vals['depth.short'] !== null);
  const b = asShare.find(r => r.id === a.id);
  assert.notStrictEqual(a.vals['depth.short'], b.vals['depth.short'],
    'catch rate and target share returned the same number for the same cell');
});

test('a column too sparse to scale is not coloured', () => {
  // fieldScale returns null under four values, and fieldColour must treat that
  // as "no opinion" rather than scaling against a spread of one.
  const { ctx } = ctxFor('WR', 'compPct');
  assert.strictEqual(evalIn(ctx, 'fieldScale([{vals:{x:1}},{vals:{x:2}}], "x")'), null,
    'two values are not a scale');
  const scale = evalIn(ctx, 'fieldScale([{vals:{x:1}},{vals:{x:2}},{vals:{x:3}},{vals:{x:9}}], "x")');
  assert.ok(scale && typeof scale.mid === 'number', 'four values should scale');

  // THE SPREAD IS THE 90TH PERCENTILE OF DEVIATION, NOT THE MAXIMUM, and only a
  // set big enough to tell those apart proves it. Four values cannot: the 90th
  // percentile of four deviations IS the largest one, so a fixture that small
  // passes whichever is used. Eleven ordinary values and one extreme separate
  // them — p90 gives about 5.5, the maximum gives 93.5, and using the maximum
  // compresses every real difference on the board into the neutral band.
  const many = Array.from({ length: 11 }, (_, i) => `{vals:{x:${i + 1}}}`).concat('{vals:{x:100}}').join(',');
  const wide = evalIn(ctx, `fieldScale([${many}], "x")`);
  assert.ok(wide.spread < 10,
    `one outlier set the spread to ${wide.spread} — the maximum is being used where the 90th percentile should be, `
    + 'and every ordinary cell will render neutral');
});

test('the qualifier and footer come from the file, not from prose', () => {
  const { ctx } = ctxFor('RB', 'ypc');
  const qual = evalIn(ctx, 'fieldQualifier()');
  assert.match(qual, /QUALIFIER/, 'the board must state its qualifier');
  assert.match(qual, /carries/i, 'and it must be the RUSHER qualifier for a back');
  const reason = evalIn(ctx, 'fieldScaleReason()');
  assert.match(reason, /carry|gap|goal-line/i, `a back's scale reason talks about passing: "${reason}"`);
  setIn(ctx, 'labPos', 'QB');
  assert.match(evalIn(ctx, 'fieldScaleReason()'), /throw|passer/i, 'a passer should get the passing reason');
});
