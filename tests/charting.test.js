/**
 * FTN charting — who was the READ.
 *
 * player-usage answers which package a player is on the field for. This answers
 * whether the offence is trying to get him the ball, which is the question
 * volume cannot reach: 90 targets of which 60 are first reads is the centre of
 * an offence, and 90 of which 45 are checkdowns is a safety valve.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const D = path.join(__dirname, '..', 'data');
const charting = JSON.parse(fs.readFileSync(path.join(D, 'charting.json'), 'utf8'));
const pool = JSON.parse(fs.readFileSync(path.join(D, 'players.json'), 'utf8'));
const { NFL_TEAMS } = require('../scripts/lib/teams');
const { completedSeason } = require('./lib/sample');

const latest = charting.meta.seasons[charting.meta.seasons.length - 1];
const season = charting.seasons[latest];

test('every charted player is in the pool', () => {
  const ids = new Set(pool.map(p => p.id));
  for (const id of Object.keys(season.players)) {
    assert.ok(ids.has(id), `charting has "${id}", who is not in the pool`);
  }
});

test('the read buckets account for every charted target', () => {
  // read_thrown is a category, not a count. If a value ever appears that the
  // label map does not know, targets would exceed the sum of the buckets and
  // every rate computed from them would be quietly wrong.
  for (const [id, p] of Object.entries(season.players)) {
    const sum = p.firstRead + p.secondRead + p.checkdown + p.scrambleDrill + p.designed;
    assert.strictEqual(sum, p.chartedTargets,
      `${id}: buckets sum to ${sum} but chartedTargets is ${p.chartedTargets} — an unmapped read_thrown value`);
  }
});

test('a rate is a share of that player\'s own charted targets', () => {
  for (const [id, p] of Object.entries(season.players)) {
    if (!p.chartedTargets) continue;
    assert.strictEqual(p.firstReadRate, +(100 * p.firstRead / p.chartedTargets).toFixed(1), `${id} firstReadRate`);
    assert.strictEqual(p.checkdownRate, +(100 * p.checkdown / p.chartedTargets).toFixed(1), `${id} checkdownRate`);
    for (const k of ['firstReadRate', 'checkdownRate', 'catchableRate', 'contestedRate']) {
      assert.ok(p[k] >= 0 && p[k] <= 100, `${id} ${k} = ${p[k]} is not a percentage`);
    }
  }
});

test('team rates are a share of DROPBACKS, not of all snaps', () => {
  // Dividing play-action by every play halves it and reads a play-action
  // offence as a conventional one. The stored rate has to reconcile to
  // dropbacks — and that holds in Week 2 as surely as in Week 18, so it is
  // asked of EVERY season in the file rather than only the newest.
  for (const [year, s] of Object.entries(charting.seasons)) {
    for (const [team, t] of Object.entries(s.teams)) {
      assert.ok(NFL_TEAMS.has(team), `"${team}" is not a franchise`);
      assert.strictEqual(t.playActionRate, +(100 * t.playAction / t.dropbacks).toFixed(1), `${year} ${team} playActionRate`);
      assert.strictEqual(t.blitzFacedRate, +(100 * t.blitzFaced / t.dropbacks).toFixed(1), `${year} ${team} blitzFacedRate`);
      assert.ok(t.dropbacks > 0 && t.dropbacks < t.snaps + 1 || t.snaps === undefined,
        `${year} ${team}: ${t.dropbacks} dropbacks`);
    }
  }
});

test('a finished season is a season and not a handful of games', async () => {
  // THE SCALE HALF, AND IT NEEDS A SEASON TO BE ABOUT. 27 dropbacks is a team
  // that has played once, not a denominator that has quietly become all snaps
  // — which is the mistake this figure is watched for, and it is still watched
  // for, one season back, where the number means something.
  const full = await completedSeason(charting.meta.seasons);
  assert.ok(full, 'charting holds no finished season to check the shape of');
  for (const [team, t] of Object.entries(charting.seasons[full].teams)) {
    assert.ok(t.dropbacks > 200 && t.dropbacks < 1200,
      `${full} ${team}: ${t.dropbacks} dropbacks is not a season — the denominator is probably all snaps`);
  }
});

test('all 32 teams are charted', () => {
  assert.strictEqual(Object.keys(season.teams).length, 32);
});

test('backs are checked down to and receivers are thrown to first', async () => {
  // The external-validity check. If the read labels were ever mapped to the
  // wrong values this inverts, and nothing else in the file would look wrong.
  //
  // IT NEEDS A SEASON'S TARGETS TO BE TRUE OF. The qualifier is 50 charted
  // targets, which nobody has in September, and a handful of players over a
  // handful of targets can invert it without anything being wrong. So it asks
  // the newest finished season, where the sample exists.
  const full = await completedSeason(charting.meta.seasons);
  assert.ok(full, 'charting holds no finished season to check the read labels against');
  const qual = Object.values(charting.seasons[full].players).filter(p => p.chartedTargets >= 50);
  assert.ok(qual.length >= 50, `only ${qual.length} qualified receivers in ${full}`);
  const avg = (pos, key) => {
    const rows = qual.filter(p => p.pos === pos);
    return rows.reduce((s, p) => s + p[key], 0) / rows.length;
  };
  assert.ok(avg('WR', 'firstReadRate') > avg('RB', 'firstReadRate') + 20,
    'receivers should be first reads far more often than backs');
  assert.ok(avg('RB', 'checkdownRate') > avg('WR', 'checkdownRate') + 20,
    'backs should be checkdowns far more often than receivers');
});

test('the file states what a read value means and what it does not prove', () => {
  assert.ok(charting.meta.readValues.firstRead, 'the vocabulary has to travel with the numbers');
  assert.ok(charting.meta.readValues.checkdown);
  assert.match(charting.meta.caveats.join(' '), /share of DROPBACKS/i);
  assert.match(charting.meta.source, /join/i);
});

test('nobody is charted with more drops than targets', () => {
  for (const [id, p] of Object.entries(season.players)) {
    assert.ok(p.drops <= p.chartedTargets, `${id}: ${p.drops} drops on ${p.chartedTargets} targets`);
    assert.ok(p.catchable <= p.chartedTargets, `${id}: catchable exceeds targets`);
    assert.ok(p.contested <= p.chartedTargets, `${id}: contested exceeds targets`);
  }
});
