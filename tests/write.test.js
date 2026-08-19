/**
 * Writing only when something changed.
 *
 * The failure this guards against is not a crash — it is a build that quietly
 * stops writing real data. A comparison that is too eager reads a genuine
 * change as "unchanged" and freezes a file forever, and the site goes stale
 * with every build reporting success. That is the same shape as nflverse moving
 * the stats file: no error, no symptom, months of wrong numbers.
 *
 * So the tests here lean hard on the direction that matters: a change of ANY
 * kind must still write.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeJSONIfChanged, canonical, VOLATILE } = require('../scripts/lib/write.js');

function tmp() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-')), 'out.json');
}

test('the first write always happens', () => {
  const f = tmp();
  assert.strictEqual(writeJSONIfChanged(f, { meta: { generated: 'now' }, a: 1 }), true);
  assert.ok(fs.existsSync(f));
});

test('a second run with only a new timestamp does not rewrite', () => {
  const f = tmp();
  writeJSONIfChanged(f, { meta: { generated: '2026-01-01T00:00:00Z' }, rows: [1, 2, 3] });
  const first = fs.readFileSync(f, 'utf8');
  const mtime = fs.statSync(f).mtimeMs;

  const wrote = writeJSONIfChanged(f, { meta: { generated: '2026-08-19T09:00:00Z' }, rows: [1, 2, 3] });
  assert.strictEqual(wrote, false, 'a timestamp is not a change');
  assert.strictEqual(fs.readFileSync(f, 'utf8'), first, 'the file on disk must be untouched');
  assert.strictEqual(fs.statSync(f).mtimeMs, mtime, 'and not even restatted');
});

test('ANY real change still writes', () => {
  // The dangerous direction. Each of these differs from the base in exactly one
  // way, and every one of them must land.
  const base = { meta: { generated: 'T0', season: 2025 }, rows: [{ id: 'a', v: 1 }], league: { x: 1 } };
  const changes = {
    'a changed number': d => { d.rows[0].v = 2; },
    'a changed string': d => { d.rows[0].id = 'b'; },
    'an added row': d => { d.rows.push({ id: 'c', v: 3 }); },
    'a removed row': d => { d.rows = []; },
    'a changed nested value': d => { d.league.x = 2; },
    'an added key': d => { d.extra = true; },
    'a removed key': d => { delete d.league; },
    'a number becoming a string': d => { d.rows[0].v = '1'; },
    'null replacing a value': d => { d.rows[0].v = null; },
    'a non-volatile meta field': d => { d.meta.season = 2026; },
    'reordered array': d => { d.rows = [{ id: 'a', v: 1 }, { id: 'z', v: 9 }]; },
  };
  for (const [what, mutate] of Object.entries(changes)) {
    const f = tmp();
    writeJSONIfChanged(f, JSON.parse(JSON.stringify(base)));
    const next = JSON.parse(JSON.stringify(base));
    next.meta.generated = 'T1';
    mutate(next);
    assert.strictEqual(writeJSONIfChanged(f, next), true, `${what} must be written`);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), next, `${what}: the new data must be on disk`);
  }
});

test('array order is a change, because in these files it is', () => {
  // Rankings are ordered. Two files with the same rows in a different order are
  // not the same file, and a comparison that sorted rows would freeze a
  // reordered board.
  const f = tmp();
  writeJSONIfChanged(f, { rows: ['a', 'b', 'c'] });
  assert.strictEqual(writeJSONIfChanged(f, { rows: ['c', 'b', 'a'] }), true);
});

test('key order alone is not a change', () => {
  // The mirror of the rule above: object key order is not meaningful in JSON
  // and a build that enumerates a map differently must not read as a change.
  const f = tmp();
  writeJSONIfChanged(f, { alpha: 1, beta: 2, meta: { generated: 'T0' } });
  assert.strictEqual(writeJSONIfChanged(f, { beta: 2, meta: { generated: 'T1' }, alpha: 1 }), false);
});

test('a volatile field nested anywhere is ignored, not just at the top', () => {
  const f = tmp();
  writeJSONIfChanged(f, { a: { b: { generated: 'T0', v: 1 } } });
  assert.strictEqual(writeJSONIfChanged(f, { a: { b: { generated: 'T9', v: 1 } } }), false);
  assert.strictEqual(writeJSONIfChanged(f, { a: { b: { generated: 'T9', v: 2 } } }), true);
});

test('a corrupt file on disk is rewritten rather than trusted', () => {
  const f = tmp();
  fs.writeFileSync(f, '{ this is not json');
  assert.strictEqual(writeJSONIfChanged(f, { ok: true }), true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { ok: true });
});

test('the volatile list is the only exemption, and it is short', () => {
  // If this list grows to cover something meaningful, the guard above stops
  // protecting anything. Anything added here must genuinely be a clock.
  for (const k of VOLATILE) {
    assert.match(k, /generated|built|run|fetched/i, `"${k}" does not look like a timestamp field`);
  }
  assert.ok(VOLATILE.length <= 8, 'the exemption list is growing suspiciously long');
});

test('every daily build that writes JSON goes through the helper', () => {
  // A build that still calls writeFileSync directly is one that keeps churning,
  // and the churn is invisible in review because the diff looks like data.
  const wf = path.join(__dirname, '..', '.github', 'workflows', 'daily-update.yml');
  const yml = fs.readFileSync(wf, 'utf8');
  const steps = [...yml.matchAll(/node scripts\/([a-z-]+)\.js/g)].map(m => m[1]);
  const offenders = [];
  for (const step of new Set(steps)) {
    const p = path.join(__dirname, '..', 'scripts', `${step}.js`);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    // JSON writes only — sitemap and robots are text, and history is JSONL.
    const raw = src.match(/fs\.writeFileSync\([^)]*JSON\.stringify/g);
    if (raw && !src.includes('writeJSONIfChanged')) offenders.push(step);
  }
  assert.deepStrictEqual(offenders, [],
    `these daily builds still rewrite JSON unconditionally: ${offenders.join(', ')}`);
});
