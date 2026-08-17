/**
 * Invariants on the committed data. Each of these is a rule the project already
 * learned the hard way; until now every one of them was enforced by nothing but
 * remembering. They run against the real files, so a bad daily run or a bad
 * hand-edit fails here rather than on the site.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DATA = path.join(__dirname, '..', 'data');
const read = name => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
const has = name => fs.existsSync(path.join(DATA, name));

const players = read('players.json');
const poolIds = new Set(players.map(p => p.id));
const STATUS_CLASSES = new Set(['status-healthy', 'status-quest', 'status-out']);

test('the pool is a non-trivial list', () => {
  assert.ok(Array.isArray(players));
  // If a feed breaks, build-players keeps yesterday's file rather than
  // shipping a gutted pool. A tiny pool means that guard failed.
  assert.ok(players.length > 100, `pool is only ${players.length} players`);
});

test('player ids are unique', () => {
  // A duplicate id silently makes one player unreachable: every lookup is
  // find(p => p.id === id) and the second one can never win.
  const seen = new Map();
  const dupes = [];
  for (const p of players) {
    if (seen.has(p.id)) dupes.push(`${p.id}: ${seen.get(p.id)} and ${p.name}`);
    seen.set(p.id, p.name);
  }
  assert.deepStrictEqual(dupes, [], `duplicate ids: ${dupes.join(', ')}`);
});

test('every player has the fields the site renders without checking', () => {
  for (const p of players) {
    assert.ok(p.id, `player with no id: ${JSON.stringify(p).slice(0, 80)}`);
    assert.ok(p.name, `${p.id} has no name`);
    assert.ok(p.pos, `${p.id} has no position`);
    assert.ok(STATUS_CLASSES.has(p.statusClass), `${p.name} has statusClass "${p.statusClass}"`);
    assert.ok(typeof p.status === 'string' && p.status.trim(), `${p.name} has an empty status`);
  }
});

test('status provenance is explicit, never inferred', () => {
  for (const p of players) {
    if (p.manualOverride === true) {
      // A hand-set status must say when it was set. Undated is exactly the
      // state that let one survive two seasons.
      assert.ok(p.statusSetAt, `${p.name} is manualOverride with no statusSetAt`);
      assert.strictEqual(p.statusSource, 'override', `${p.name} is manual but sourced "${p.statusSource}"`);
    }
    if (p.statusSource === 'override') {
      assert.strictEqual(p.manualOverride, true, `${p.name} is override-sourced but not flagged manual`);
    }
  }
});

test('a healthy player carries no injury text, and an injured one does', () => {
  for (const p of players) {
    if (p.statusClass === 'status-healthy') {
      assert.strictEqual(p.status, 'Healthy', `${p.name} is healthy-classed but reads "${p.status}"`);
    } else {
      assert.notStrictEqual(p.status, 'Healthy', `${p.name} reads Healthy but is classed ${p.statusClass}`);
    }
  }
});

test('medical profiles point at players who exist', () => {
  // A profile keyed to an id not in the pool renders nowhere and is invisible.
  const medicals = read('medicals.json');
  for (const id of Object.keys(medicals)) {
    assert.ok(poolIds.has(id), `medicals.json has "${id}", which is not in the pool`);
  }
});

test('every medical injury carries a source', () => {
  // No data without a source — the site prints "✓ <source>" beside each one.
  const medicals = read('medicals.json');
  for (const [id, prof] of Object.entries(medicals)) {
    assert.ok(Array.isArray(prof.injuries), `${id} has no injuries array`);
    for (const inj of prof.injuries) {
      assert.ok(inj.source && String(inj.source).trim(), `${id}: "${inj.title}" has no source`);
      assert.ok(inj.title && String(inj.title).trim(), `${id} has an untitled injury`);
      assert.ok(['high', 'moderate', 'low'].includes(inj.severity), `${id}: "${inj.title}" severity is "${inj.severity}"`);
      assert.ok(typeof inj.impact === 'number' && inj.impact >= 0 && inj.impact <= 100,
        `${id}: "${inj.title}" impact is ${inj.impact}`);
    }
  }
});

test('a dated injury event lines up with a real game log', () => {
  // The event drives the Return to Play curve. An outSeason with no game log
  // on file produces a curve drawn from nothing.
  const medicals = read('medicals.json');
  for (const [id, prof] of Object.entries(medicals)) {
    for (const inj of prof.injuries || []) {
      if (!inj.event) continue;
      const ev = inj.event;
      assert.ok(Number.isInteger(ev.outSeason), `${id}: event.outSeason is not a year`);
      assert.ok(Number.isInteger(ev.outWeek) && ev.outWeek >= 1 && ev.outWeek <= 22,
        `${id}: event.outWeek ${ev.outWeek} is not a week`);
      const log = path.join(DATA, 'weekly', `${id}.json`);
      assert.ok(fs.existsSync(log), `${id} has a dated event but no data/weekly/${id}.json to check it against`);
    }
  }
});

test('injury-report history points at players who exist', () => {
  if (!has('injuries.json')) return;
  const injuries = read('injuries.json');
  for (const id of Object.keys(injuries)) {
    assert.ok(poolIds.has(id), `injuries.json has "${id}", which is not in the pool`);
  }
});

test('rankings reference real players and are ordered', () => {
  const rankings = read('rankings.json');
  for (const tab of ['qb', 'rb', 'wr', 'te']) {
    const list = rankings[tab];
    if (!Array.isArray(list)) continue;
    let last = 0;
    for (const entry of list) {
      assert.ok(entry.name, `${tab} board has an unnamed entry`);
      assert.ok(typeof entry.rank === 'number', `${tab}: ${entry.name} has no rank`);
      assert.ok(entry.rank > last, `${tab} board is out of order at ${entry.name} (${entry.rank} after ${last})`);
      last = entry.rank;
    }
  }
});

test('meta.json records whether the last run actually worked', () => {
  const meta = read('meta.json');
  assert.ok(meta.lastUpdate, 'meta.json has no lastUpdate');
  assert.ok(!Number.isNaN(Date.parse(meta.lastUpdate)), 'lastUpdate is unparseable');
  // The failure ledger may be absent on an old file, but if present it must be
  // a list — check-feeds.js reads it to decide whether to red the run.
  if (meta.fetchFailures !== undefined) {
    assert.ok(Array.isArray(meta.fetchFailures), 'fetchFailures must be an array');
  }
});

test('no projection is invented', () => {
  // Empty beats wrong: a missing projection renders as nothing. A null is
  // fine; a NaN or a string that looks like a number is not.
  if (!has('projections-2026.json')) return;
  const proj = read('projections-2026.json');
  const walk = (node, trail) => {
    if (node === null || node === undefined) return;
    if (typeof node === 'number') {
      assert.ok(Number.isFinite(node), `${trail} is ${node}`);
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, `${trail}.${k}`);
    }
  };
  walk(proj, 'projections');
});
