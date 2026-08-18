/**
 * The history series.
 *
 * This is the one part of the data that cannot be rebuilt if it goes wrong. Every
 * other file here is regenerated from a feed each morning; a day missing from
 * these, or a day written twice, is gone or wrong for good. So the invariants
 * are checked harder than elsewhere, and the append is checked for idempotence
 * because the Action gets re-dispatched by hand.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const HIST = path.join(ROOT, 'data', 'history');

function lines(file) {
  const p = path.join(HIST, file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l, i) => {
    try { return JSON.parse(l); } catch (e) { throw new Error(`${file} line ${i + 1} is not JSON: ${e.message}`); }
  });
}

const SERIES = ['adp.jsonl', 'rankings.jsonl'];

test('every history file is valid JSONL', () => {
  for (const f of [...SERIES, 'status.jsonl']) {
    const rows = lines(f);
    assert.ok(rows.length > 0, `${f} is empty — the series has to start somewhere`);
    for (const r of rows) assert.ok(r.date, `${f} has a row with no date`);
  }
});

test('a series has ONE line per day, in order', () => {
  // The Action can be re-dispatched by hand, and a second run that appends
  // rather than replaces would double that day and quietly skew any average
  // computed over the series later.
  for (const f of SERIES) {
    const rows = lines(f);
    const dates = rows.map(r => r.date);
    const unique = new Set(dates);
    assert.strictEqual(unique.size, dates.length, `${f} has a duplicated day: ${dates.filter((d, i) => dates.indexOf(d) !== i)}`);
    const sorted = [...dates].sort();
    assert.deepStrictEqual(dates, sorted, `${f} is out of order`);
    for (const d of dates) assert.match(d, /^\d{4}-\d{2}-\d{2}$/, `${f} has a malformed date "${d}"`);
  }
});

test('a series line actually carries values', () => {
  // An empty values object is what a broken name join looks like, and it would
  // otherwise sit in the file forever looking like a day when nobody was ranked.
  for (const f of SERIES) {
    for (const r of lines(f)) {
      assert.ok(r.values && typeof r.values === 'object', `${f} ${r.date}: no values object`);
      assert.ok(Object.keys(r.values).length > 10, `${f} ${r.date}: only ${Object.keys(r.values).length} values — the join probably broke`);
    }
  }
});

test('a status entry is a real change, never a restatement', () => {
  // 286 of 350 players are healthy on a given day. If "still healthy" were
  // logged the ten lines that matter would be buried under 350 that do not.
  for (const r of lines('status.jsonl')) {
    assert.notStrictEqual(r.from, r.to, `${r.date} ${r.id}: logged "${r.from}" → "${r.to}", which is not a change`);
    assert.ok(r.to, `${r.date} ${r.id}: no destination status`);
  }
});

test('a first sighting is labelled, not disguised as a change', () => {
  // The day we start watching a player is not the day something happened to him.
  // Reading those 350 rows as August injuries would be badly wrong.
  const rows = lines('status.jsonl');
  const firsts = rows.filter(r => r.first);
  assert.ok(firsts.length > 0, 'the first snapshot should be all first sightings');
  for (const r of firsts) {
    assert.strictEqual(r.from, null, `${r.id}: a first sighting must come from null, not "${r.from}"`);
  }
  const real = rows.filter(r => !r.first && r.to !== '__left__');
  assert.ok(real.length > 0, 'expected some genuine status changes in the backfilled history');
});

test('the status log replays to the pool as it stands today', () => {
  // The log IS the state — build-history replays it to decide what changed. If a
  // replay disagrees with players.json, tomorrow's diff is computed against
  // fiction and every subsequent day is wrong.
  const pool = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'players.json'), 'utf8'));
  const state = new Map();
  for (const r of lines('status.jsonl')) state.set(r.id, r.to);

  const wrong = [];
  for (const p of pool) {
    if (state.get(p.id) !== p.status) wrong.push(`${p.id}: log says "${state.get(p.id)}", pool says "${p.status}"`);
  }
  assert.deepStrictEqual(wrong, [], `the replayed log disagrees with the pool:\n  ${wrong.slice(0, 5).join('\n  ')}`);
});

test('running the builder twice does not write the day twice', () => {
  // The idempotence guarantee, exercised rather than asserted. A dry run leaves
  // the files alone, so this is safe to run in CI.
  const before = SERIES.concat('status.jsonl').map(f => lines(f).length);
  execFileSync('node', ['scripts/build-history.js', '--dry'], { cwd: ROOT });
  execFileSync('node', ['scripts/build-history.js', '--dry'], { cwd: ROOT });
  const after = SERIES.concat('status.jsonl').map(f => lines(f).length);
  assert.deepStrictEqual(after, before, 'a dry run must not change the files at all');
});

test('history ids point at players, not at nothing', () => {
  // A series keyed by something the rest of the site cannot resolve is a series
  // nobody can ever chart. Departed players are expected — the pool churns — so
  // this asserts the overlap is high, not total.
  const pool = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'players.json'), 'utf8'));
  const ids = new Set(pool.map(p => p.id));
  for (const f of SERIES) {
    const rows = lines(f);
    const latest = rows[rows.length - 1];
    const keys = Object.keys(latest.values);
    const known = keys.filter(k => ids.has(k)).length;
    assert.ok(known / keys.length > 0.9,
      `${f} ${latest.date}: only ${known}/${keys.length} ids are in today's pool`);
  }
});
