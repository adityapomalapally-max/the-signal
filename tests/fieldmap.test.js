/**
 * The field map.
 *
 * Two things here are easy to get wrong in a way that looks completely normal
 * on a page, so both are pinned with a test:
 *
 *   1. THE BAND BOUNDARIES. air_yards of exactly 0, 10 and 20 must each land in
 *      one band and only one. An off-by-one at the seam moves thousands of
 *      throws between "short" and "intermediate" and no reader could ever tell.
 *   2. THE FLOOR. A rate computed on four throws is noise wearing a number's
 *      clothes. The count and the share are published at any size because they
 *      are read against the season total; the RATE is not.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const fm = require('../scripts/lib/fieldmap.js');
const { depthOf, finishPass, finishRush, blankCell, addPass, buildFieldMap, finishFieldMap,
        DEPTH_BANDS, SIDES, GAPS, MIN_CELL, MIN_CELL_STRIP } = fm;

test('every air-yard value lands in exactly one band', () => {
  // The seams are the whole point: -1/0 and 9/10 and 19/20.
  for (let ay = -15; ay <= 60; ay++) {
    const hits = DEPTH_BANDS.filter(b => b.test(ay));
    assert.strictEqual(hits.length, 1, `air_yards ${ay} matched ${hits.length} bands`);
  }
  assert.strictEqual(depthOf(-1), 'behind');
  assert.strictEqual(depthOf(0), 'short', 'a throw AT the line is short, not behind it');
  assert.strictEqual(depthOf(9), 'short');
  assert.strictEqual(depthOf(10), 'inter', 'ten is the first intermediate yard');
  assert.strictEqual(depthOf(19), 'inter');
  assert.strictEqual(depthOf(20), 'deep', 'twenty is the first deep yard');
});

test('a rate is withheld under the floor but the count never is', () => {
  const thin = blankCell();
  for (let i = 0; i < MIN_CELL - 1; i++) addPass(thin, { complete: true, yards: 10, td: false, epa: 0.5, cpoe: 2, success: true });
  const out = finishPass(thin, 500, MIN_CELL);
  assert.strictEqual(out.n, MIN_CELL - 1, 'the count is always published');
  assert.ok(out.share > 0, 'the share is always published — it is read against the season total');
  assert.strictEqual(out.compPct, undefined, 'a completion rate on a thin cell must not be published');
  assert.strictEqual(out.epa, undefined);
  assert.strictEqual(out.thin, true, 'and the cell must SAY it is thin rather than going quietly blank');

  const fat = blankCell();
  for (let i = 0; i < MIN_CELL; i++) addPass(fat, { complete: i % 2 === 0, yards: 10, td: false, epa: 0.5, cpoe: 2, success: true });
  const ok = finishPass(fat, 500, MIN_CELL);
  assert.strictEqual(ok.thin, undefined);
  assert.strictEqual(ok.compPct, 50, 'exactly at the floor the rate publishes');
});

test('a share is a share of the season, not of the cell', () => {
  const c = blankCell();
  for (let i = 0; i < 25; i++) addPass(c, { complete: true, yards: 5, td: false, epa: 0, cpoe: 0, success: true });
  assert.strictEqual(finishPass(c, 100, MIN_CELL).share, 25);
  assert.strictEqual(finishPass(c, 200, MIN_CELL).share, 12.5);
});

test('the rushing floor withholds a yards-per-carry the same way', () => {
  const thin = { n: 3, yards: 30, td: 1, epa: 1, success: 2, stuff: 0, ten: 1 };
  const out = finishRush(thin, 200, MIN_CELL_STRIP);
  assert.strictEqual(out.n, 3);
  assert.strictEqual(out.ypc, undefined, '10 yards a carry on three carries is not a finding');
  assert.strictEqual(out.thin, true);
});

test('every rushing rate divides by the carries in the cell', () => {
  // Each of these has its own denominator and they are easy to cross-wire,
  // because they all look right at a glance: a stuff rate off the wrong
  // divisor still lands between 0 and 100 and still sorts plausibly.
  const c = { n: 20, yards: 90, td: 2, epa: 4, success: 11, stuff: 5, ten: 3 };
  const out = finishRush(c, 200, MIN_CELL_STRIP);
  assert.strictEqual(out.ypc, 4.5, '90 yards on 20 carries');
  assert.strictEqual(out.success, 55, '11 of 20');
  assert.strictEqual(out.stuffPct, 25, '5 of 20 — divided by the carries in THIS cell');
  assert.strictEqual(out.tenPct, 15, '3 of 20');
  assert.strictEqual(out.epa, 0.2, '4 EPA over 20 carries');
  assert.strictEqual(out.td, 2, 'touchdowns are a count, not a rate');
  assert.strictEqual(out.share, 10, '20 of the season\'s 200 carries');
});

test('the gaps are the seven the play-by-play actually records', () => {
  // Middle carries no gap — there is no "middle guard" — so it is its own
  // column rather than being dropped for having a blank field.
  assert.strictEqual(GAPS.length, 7);
  const mid = GAPS.find(g => g.key === 'middle');
  assert.strictEqual(mid.gap, null, 'a middle run has no gap designation in pbp');
  for (const side of ['left', 'right']) {
    for (const g of ['end', 'tackle', 'guard']) {
      assert.ok(GAPS.some(x => x.key === `${side}-${g}`), `${side}-${g} missing`);
    }
  }
});

test('the aggregator reads a hand-built play file the way the page will', () => {
  // A tiny CSV rather than a fixture off the wire: it can assert on exact
  // numbers, and it fails if the column names this file depends on move.
  const cols = ['pass_attempt','play_type','pass_location','air_yards','run_location','run_gap',
                'rusher_player_id','receiver_player_id','passer_player_id','yards_gained','epa',
                'rush','complete_pass','success','cpoe','pass_touchdown','rush_touchdown',
                'yardline_100','ydstogo','down'];
  const row = (o) => cols.map(c => o[c] === undefined ? '' : o[c]).join(',');
  const pass = (loc, ay, complete) => row({ pass_attempt: 1, play_type: 'pass', pass_location: loc,
    air_yards: ay, passer_player_id: 'QB1', receiver_player_id: 'WR1', complete_pass: complete ? 1 : 0,
    yards_gained: complete ? ay + 3 : 0, epa: complete ? 0.4 : -0.5, cpoe: 1, success: complete ? 1 : 0 });
  const run = (loc, gap, yds) => row({ rush: 1, play_type: 'run', run_location: loc, run_gap: gap,
    rusher_player_id: 'RB1', yards_gained: yds, epa: yds > 3 ? 0.2 : -0.2, success: yds > 3 ? 1 : 0, yardline_100: 50, ydstogo: 10, down: 1 });

  const lines = [cols.join(',')];
  for (let i = 0; i < 12; i++) lines.push(pass('left', 5, i % 2 === 0));   // 12 short left, 6 complete
  for (let i = 0; i < 4; i++) lines.push(pass('middle', 30, true));        // 4 deep middle — under the floor
  for (let i = 0; i < 10; i++) lines.push(run('right', 'guard', 5));
  for (let i = 0; i < 3; i++) lines.push(run('middle', '', 1));

  const raw = buildFieldMap(lines.join('\n'));
  assert.strictEqual(raw.coverage.attempts, 16);
  assert.strictEqual(raw.coverage.located, 16);

  const fin = finishFieldMap(raw, null);
  // Nothing clears the season qualifiers, so nothing is published — which is
  // itself the rule worth checking.
  assert.deepStrictEqual(Object.keys(fin.passers), [], '16 attempts must not clear a 200-attempt bar');

  // Drop the qualifiers to read the cells themselves.
  const p = raw.passers.get('QB1');
  assert.strictEqual(p.total, 16);
  assert.strictEqual(p.cells['left-short'].n, 12);
  assert.strictEqual(p.cells['left-short'].comp, 6);
  assert.strictEqual(p.cells['middle-deep'].n, 4);
  const shortLeft = finishPass(p.cells['left-short'], p.total, MIN_CELL);
  assert.strictEqual(shortLeft.compPct, 50);
  assert.strictEqual(shortLeft.share, 75);
  assert.strictEqual(finishPass(p.cells['middle-deep'], p.total, MIN_CELL).thin, true,
    'four deep-middle throws must not produce a completion rate');

  const r = raw.rushers.get('RB1');
  assert.strictEqual(r.total, 13);
  assert.strictEqual(r.gaps['right-guard'].n, 10);
  assert.strictEqual(r.gaps['middle'].n, 3, 'a middle run with a blank gap column is still a middle run');
});

test('a throw with no location is excluded, not bucketed', () => {
  const cols = ['pass_attempt','play_type','pass_location','air_yards','run_location','run_gap',
                'rusher_player_id','receiver_player_id','passer_player_id','yards_gained','epa','rush'];
  const lines = [cols.join(',')];
  // A throwaway: attempted, but the gamebook recorded no direction.
  lines.push([1,'pass','','','','','','WR1','QB1',0,-0.8,''].join(','));
  lines.push([1,'pass','left',7,'','','','WR1','QB1',9,0.3,''].join(','));
  const raw = buildFieldMap(lines.join('\n'));
  assert.strictEqual(raw.coverage.attempts, 2);
  assert.strictEqual(raw.coverage.located, 1, 'the throwaway counts as an attempt but not as a located one');
  assert.strictEqual(raw.passers.get('QB1').total, 1, 'and it must not land in a cell');
});

test('the schema is asserted, so a renamed column fails the run', () => {
  assert.throws(() => buildFieldMap('game_id,play_id\n1,2\n'),
    /missing .* the schema moved/,
    'a pbp without the field-map columns must fail loudly, not build an empty map');
});

test('the published file states what it cannot do', () => {
  const f = path.join(__dirname, '..', 'data', 'fieldmap.json');
  if (!fs.existsSync(f)) return;   // not built yet on a fresh clone
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const caveats = d.meta.caveats.join(' ');
  assert.match(caveats, /BLOCKING SCHEME IS NOT IN THIS FILE|wide zone/i,
    'the one thing people will assume is here has to be denied in the file itself');
  assert.match(caveats, /median of one|under five/i,
    'and the measurement behind the receiver grid decision has to travel with it');
  assert.ok(d.meta.qualifiers.cell, 'the cell floor is a qualifier and every board states its qualifier');
});
