/**
 * The hand-written status layer. Every case here is a way a human can get the
 * file wrong, and every one of them fails SILENTLY on the site if it is not
 * caught: the file says a player is on PUP and the page shows him healthy.
 */

const test = require('node:test');
const assert = require('node:assert');
const { validateOverrides, DEFAULT_DURATION_DAYS } = require('../scripts/lib/overrides');

const DAY = 86400000;
const NOW = Date.parse('2026-08-17T12:00:00Z');
const iso = ms => new Date(ms).toISOString().slice(0, 10);

function entry(over = {}) {
  return {
    player: 'Malik Nabers', pos: 'WR',
    status: 'PUP (Knee - ACL)', statusClass: 'status-out',
    setAt: iso(NOW - 2 * DAY), source: 'SNY, Aug 15 2026',
    ...over,
  };
}
const check = (entries) => validateOverrides({ overrides: entries }, NOW);

test('a well-formed entry is live and error-free', () => {
  const { rows } = check([entry()]);
  assert.strictEqual(rows[0].errors.length, 0, rows[0].errors.join('; '));
  assert.strictEqual(rows[0].live, true);
});

test('every required field is required', () => {
  for (const field of ['player', 'pos', 'status', 'statusClass', 'setAt', 'source']) {
    const e = entry();
    delete e[field];
    const { rows } = check([e]);
    assert.ok(rows[0].errors.some(x => x.includes(field)), `missing ${field} was not reported`);
    assert.strictEqual(rows[0].live, false);
  }
});

test('a source is mandatory — no data without a source', () => {
  const { rows } = check([entry({ source: '   ' })]);
  assert.ok(rows[0].errors.some(x => x.includes('source')));
});

test('a statusClass the stylesheet does not define is rejected', () => {
  const { rows } = check([entry({ statusClass: 'status-yellow' })]);
  assert.ok(rows[0].errors.some(x => x.includes('statusClass')));
});

test('a misspelled key is caught rather than silently ignored', () => {
  // "expiry" instead of "expires" would hand the entry three extra weeks.
  const { rows } = check([entry({ expiry: '2026-09-01' })]);
  assert.ok(rows[0].errors.some(x => x.includes('expiry')), 'unknown field not reported');
});

test('a future setAt is rejected', () => {
  const { rows } = check([entry({ setAt: iso(NOW + 30 * DAY) })]);
  assert.ok(rows[0].errors.some(x => x.includes('future')));
});

test('a malformed date is rejected', () => {
  for (const bad of ['Aug 15 2026', '2026/08/15', '15-08-2026', 'yesterday']) {
    const { rows } = check([entry({ setAt: bad })]);
    assert.ok(rows[0].errors.length > 0, `${bad} was accepted as a date`);
  }
});

test('expires must be after setAt', () => {
  const { rows } = check([entry({ setAt: iso(NOW - 2 * DAY), expires: iso(NOW - 5 * DAY) })]);
  assert.ok(rows[0].errors.some(x => x.includes('expires')));
});

test('two entries for one player is an unresolvable instruction', () => {
  const { rows } = check([entry(), entry({ status: 'Healthy', statusClass: 'status-healthy' })]);
  assert.ok(rows[1].errors.some(x => x.includes('duplicate')));
});

test('an entry expires on its own, without anyone remembering to remove it', () => {
  // This is the whole point of the file. The status it replaced could not
  // expire, so it outlived the injury it described by two seasons.
  const old = entry({ setAt: iso(NOW - (DEFAULT_DURATION_DAYS + 5) * DAY) });
  const { rows } = check([old]);
  assert.strictEqual(rows[0].errors.length, 0, 'an expired entry is stale, not malformed');
  assert.strictEqual(rows[0].expired, true);
  assert.strictEqual(rows[0].live, false, 'an expired entry must not be applied');
});

test('an entry inside the default window is still live', () => {
  const fresh = entry({ setAt: iso(NOW - (DEFAULT_DURATION_DAYS - 2) * DAY) });
  assert.strictEqual(check([fresh]).rows[0].live, true);
});

test('an explicit expires overrides the default window', () => {
  const longLived = entry({
    setAt: iso(NOW - 40 * DAY),
    expires: iso(NOW + 10 * DAY),
  });
  assert.strictEqual(check([longLived]).rows[0].live, true, 'explicit expires should extend life');

  const shortLived = entry({ setAt: iso(NOW - 5 * DAY), expires: iso(NOW - 1 * DAY) });
  assert.strictEqual(check([shortLived]).rows[0].expired, true, 'explicit expires should shorten life');
});

test('a file without an overrides array is a file error, not 50 row errors', () => {
  assert.ok(validateOverrides({}, NOW).fileError);
  assert.ok(validateOverrides({ overrides: 'nope' }, NOW).fileError);
});

test('an empty override list is valid — the feed simply owns every status', () => {
  const { fileError, rows } = check([]);
  assert.strictEqual(fileError, null);
  assert.strictEqual(rows.length, 0);
});

test('the committed override file itself is valid', () => {
  // Guards the real file, so a bad hand-edit fails here and not on the site.
  const { readOverrides, validateOverrides: v } = require('../scripts/lib/overrides');
  const { fileError, rows } = v(readOverrides());
  assert.strictEqual(fileError, null);
  for (const row of rows) {
    assert.strictEqual(row.errors.length, 0, `${row.label}: ${row.errors.join('; ')}`);
  }
});
