/**
 * Depth charts and combine testing.
 *
 * Both joined cleanly on the first try in the sense that mattered — but the
 * depth chart filter matched NOTHING on its first run, because the offensive
 * group is labelled by its personnel ("3WR 1TE") rather than by the word
 * offense. It produced an empty section and no error. That is the shape of
 * failure these tests exist for.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const D = path.join(__dirname, '..', 'data');
const ctx = JSON.parse(fs.readFileSync(path.join(D, 'context.json'), 'utf8'));
const pool = JSON.parse(fs.readFileSync(path.join(D, 'players.json'), 'utf8'));
const { NFL_TEAMS } = require('../scripts/lib/teams');

test('a section that joined nothing is a failure, not an empty section', () => {
  // The original bug: /off/i matched no group name, the section came back empty
  // and everything downstream would have rendered a site with no depth charts on
  // it and no indication anything was wrong.
  assert.ok(Object.keys(ctx.depthChart).length > pool.length * 0.8,
    `depth chart covers only ${Object.keys(ctx.depthChart).length}/${pool.length} — the group filter has probably stopped matching`);
  assert.ok(Object.keys(ctx.combine).length > 100,
    `combine covers only ${Object.keys(ctx.combine).length} — the pfr crosswalk is failing`);
});

test('everything is keyed to somebody in the pool', () => {
  const ids = new Set(pool.map(p => p.id));
  for (const id of Object.keys(ctx.depthChart)) assert.ok(ids.has(id), `depthChart has "${id}"`);
  for (const id of Object.keys(ctx.combine)) assert.ok(ids.has(id), `combine has "${id}"`);
});

test('a depth chart entry is an offensive one', () => {
  // A receiver listed third among kick returners must never be read as the
  // third receiver. Our pool is QB/RB/WR/TE only, so any defensive abbreviation
  // appearing here means the group filter let something through.
  const defensive = /^(LDE|RDE|LDT|RDT|LOLB|ROLB|MLB|LCB|RCB|SS|FS|NB|DL|LB|DB)$/;
  for (const [id, d] of Object.entries(ctx.depthChart)) {
    assert.ok(!defensive.test(String(d.position)), `${id} is listed at ${d.position}, which is a defensive spot`);
    assert.ok(NFL_TEAMS.has(d.team), `${id} is on "${d.team}"`);
    assert.ok(d.positionRank >= 1 && d.positionRank <= 20, `${id} has position rank ${d.positionRank}`);
  }
});

test('the chart is current, not last season\'s', () => {
  const dates = Object.values(ctx.depthChart).map(d => d.asOf).sort();
  const newest = dates[dates.length - 1];
  const ageDays = (Date.now() - new Date(newest).getTime()) / 86400000;
  assert.ok(ageDays < 120, `the freshest depth chart row is ${Math.round(ageDays)} days old`);
});

test('a percentile is against the position, and missing when it cannot be computed', () => {
  // Empty beats wrong: no comparison group means no percentile, never 50.
  for (const [id, c] of Object.entries(ctx.combine)) {
    for (const [drill, v] of Object.entries(c.drills)) {
      assert.ok(typeof v.value === 'number' && v.value > 0, `${id} ${drill}: ${v.value}`);
      if (v.percentileAtPosition === null) {
        assert.ok(v.sampleSize < 30, `${id} ${drill}: no percentile despite ${v.sampleSize} comparisons`);
      } else {
        assert.ok(v.percentileAtPosition >= 0 && v.percentileAtPosition <= 100, `${id} ${drill}: ${v.percentileAtPosition}`);
        assert.ok(v.sampleSize >= 30);
      }
    }
    assert.ok(Object.keys(c.drills).length > 0, `${id} has an empty drills object`);
  }
});

test('a faster forty scores higher than a slower one at the same position', () => {
  // The inversion is the easy thing to get backwards, and backwards it would
  // rank the slowest players in the league as the most athletic — while looking
  // completely normal on a page.
  const byPos = {};
  for (const [id, c] of Object.entries(ctx.combine)) {
    const f = c.drills.forty;
    if (!f || f.percentileAtPosition === null) continue;
    (byPos[c.position] = byPos[c.position] || []).push({ id, value: f.value, pct: f.percentileAtPosition });
  }
  let compared = 0;
  for (const [pos, rows] of Object.entries(byPos)) {
    if (rows.length < 4) continue;
    const sorted = [...rows].sort((a, b) => a.value - b.value);
    const fastest = sorted[0], slowest = sorted[sorted.length - 1];
    assert.ok(fastest.pct >= slowest.pct,
      `${pos}: ${fastest.id} ran ${fastest.value} and scores ${fastest.pct}, `
      + `${slowest.id} ran ${slowest.value} and scores ${slowest.pct} — the percentile is inverted`);
    compared++;
  }
  assert.ok(compared >= 3, `only compared ${compared} positions`);
});

test('a depth chart is labelled as what a team publishes, not what it does', () => {
  const caveats = ctx.meta.caveats.join(' ');
  assert.match(caveats, /publishes, not what it does/i);
  assert.match(caveats, /never instead of it/i, 'it must say to read it alongside usage');
  assert.match(caveats, /not against/i, 'the percentile comparison group has to be stated');
});
