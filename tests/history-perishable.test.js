/**
 * The two series that cannot be rebuilt.
 *
 * Everything else on this site is reconstructible: usage, charting, field maps
 * and matchups all come back out of play-by-play whenever they are asked for.
 * These two do not.
 *
 *   TRENDING is what the room is doing RIGHT NOW. Sleeper serves today's add
 *   rate and nothing else — there is no endpoint for last Tuesday's, and no way
 *   to derive one. A morning it does not run is a morning gone for good.
 *
 *   DEPTH CHART POSITION is published by nflverse as the CURRENT chart with no
 *   history behind it, so a promotion is visible the day it happens and
 *   invisible a week later.
 *
 * The shapes differ for the reason status and rankings differ: one moves every
 * day and the movement IS the signal, the other sits still and only the
 * handful of changes matter.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HIST = path.join(__dirname, '..', 'data', 'history');
const read = (f) => {
  const p = path.join(HIST, f);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
};

test('trending is a series — one line a day, never doubled', () => {
  const rows = read('trending.jsonl');
  if (!rows) return;
  const dates = rows.map(r => r.date);
  assert.strictEqual(new Set(dates).size, dates.length,
    'a date appears twice — a re-dispatched Action doubled a day and every average over the series is now wrong');
  assert.deepStrictEqual([...dates].sort(), dates, 'the series is not in date order');
  for (const r of rows) {
    assert.ok(Array.isArray(r.adds) && Array.isArray(r.drops), `${r.date}: adds/drops must be lists`);
    assert.ok(r.source, `${r.date}: no source recorded`);
  }
});

test('an unmatched trending name keeps its count and never a guessed id', () => {
  // The pool is 350 players; the room speculates on more than that. A free
  // agent being added 60,000 times is worth recording — attaching him to the
  // wrong player id is not. This repo's rule is to skip an ambiguous match
  // rather than guess one, and here that means keeping the name instead.
  const rows = read('trending.jsonl');
  if (!rows) return;
  let unmatched = 0, matched = 0;
  for (const r of rows) {
    for (const e of [...r.adds, ...r.drops]) {
      assert.ok(typeof e.count === 'number' && e.count > 0, 'a trending entry with no count is not a signal');
      if (e.id) { matched++; assert.ok(!e.name, 'a matched entry should carry the id, not a duplicate name'); }
      else { unmatched++; assert.ok(e.name, 'an unmatched entry must at least record who it was'); }
    }
  }
  assert.ok(matched > 0, 'nothing matched the pool at all — the join has broken');
  assert.ok(unmatched > 0,
    'everything matched, which for a 350-man pool against league-wide waiver activity is implausible — '
    + 'check that unmatched names are not being silently dropped');
});

test('depth is an event log — a first sighting is not a promotion', () => {
  // The same rule status follows. 342 players sit still; logging "still second
  // on the depth chart" every morning buries the handful of lines that matter.
  const rows = read('depth.jsonl');
  if (!rows) return;
  for (const r of rows) {
    assert.ok(r.to, `${r.id}: an entry with no new position`);
    if (r.first) {
      assert.strictEqual(r.from, null,
        `${r.id} is marked as a first sighting but carries a previous position`);
    } else {
      assert.ok(r.from, `${r.id}: a change with nothing to have changed from`);
      const same = ['team', 'position', 'positionRank', 'slot'].every(k => r.from[k] === r.to[k]);
      assert.ok(!same, `${r.id}: logged as a move but nothing moved — the log is filling with noise`);
    }
  }
});

test('a player who did not move produces no line at all', () => {
  // THE SKIP IS THE WHOLE DESIGN and it cannot be tested against day-one data,
  // because on day one every entry is a first sighting and there is nothing to
  // skip. A mutation deleting the guard passed cleanly against the real file.
  // 342 players sit still; without this, the log gains 342 identical lines every
  // morning and the handful that matter are unfindable inside a year.
  const { depthChangesFor } = require('../scripts/build-history.js');
  const depth = {
    steady: { team: 'BUF', position: 'WR', positionRank: 2, slot: 1 },
    promoted: { team: 'BUF', position: 'WR', positionRank: 1, slot: 1 },
    traded: { team: 'KC', position: 'RB', positionRank: 1, slot: 1 },
    brandNew: { team: 'NYJ', position: 'TE', positionRank: 3, slot: 1 },
  };
  const prior = new Map([
    ['steady', { team: 'BUF', position: 'WR', positionRank: 2, slot: 1 }],
    ['promoted', { team: 'BUF', position: 'WR', positionRank: 3, slot: 1 }],
    ['traded', { team: 'LV', position: 'RB', positionRank: 1, slot: 1 }],
  ]);
  const pool = Object.keys(depth).map(id => ({ id, name: id }));
  const inPool = new Set(pool.map(p => p.id));
  const changes = depthChangesFor(depth, prior, pool, inPool, '2026-09-15');
  const ids = changes.map(c => c.id).sort();

  assert.deepStrictEqual(ids, ['brandNew', 'promoted', 'traded'],
    'a player whose position is unchanged must produce no line');
  const promo = changes.find(c => c.id === 'promoted');
  assert.strictEqual(promo.from.positionRank, 3);
  assert.strictEqual(promo.to.positionRank, 1);
  assert.strictEqual(promo.first, undefined, 'a real move must not be marked as a first sighting');
  assert.strictEqual(changes.find(c => c.id === 'brandNew').first, true);
  // A TRADE IS A MOVE. The rank is identical on both sides and only the team
  // changed, so a comparison that looked at rank alone would miss it entirely.
  const traded = changes.find(c => c.id === 'traded');
  assert.strictEqual(traded.from.team, 'LV');
  assert.strictEqual(traded.to.team, 'KC');
});

test('a player outside the pool is not tracked', () => {
  const { depthChangesFor } = require('../scripts/build-history.js');
  const depth = { inside: { team: 'BUF', position: 'WR', positionRank: 1, slot: 1 },
                  outside: { team: 'BUF', position: 'WR', positionRank: 9, slot: 1 } };
  const changes = depthChangesFor(depth, new Map(), [{ id: 'inside', name: 'In' }],
    new Set(['inside']), '2026-09-15');
  assert.deepStrictEqual(changes.map(c => c.id), ['inside']);
});

test('a player never appears twice on the same day in the event log', () => {
  const rows = read('depth.jsonl');
  if (!rows) return;
  const seen = new Set();
  for (const r of rows) {
    const k = `${r.date}|${r.id}`;
    assert.ok(!seen.has(k), `${r.id} logged twice on ${r.date} — a re-run appended instead of replacing`);
    seen.add(k);
  }
});

test('both series are written by the daily job', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-history.js'), 'utf8');
  assert.match(src, /trending\.jsonl/, 'trending is not being recorded');
  assert.match(src, /depth\.jsonl/, 'depth chart position is not being recorded');
  // And the reason has to travel with the code, because the next person will
  // reasonably wonder why these are not just rebuilt like everything else.
  assert.match(src, /cannot be rebuilt|gone for good|no history of it/i,
    'nothing explains why these two are recorded rather than derived');
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily-update.yml'), 'utf8');
  assert.match(yml, /node scripts\/build-history\.js/,
    'the only irreplaceable capture on the site is not in the daily Action');
});
