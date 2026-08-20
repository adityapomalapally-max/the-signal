/**
 * Telling a reader when the data is old.
 *
 * This site is built around one failure: the daily job stops, nothing errors,
 * every page renders, and every number quietly belongs to last week.
 * check-season and check-feeds red the RUN when that happens — but a reader
 * looking at a board has no way to know, and in season that is the whole game.
 *
 * The footer already printed "Data updated: 18 Aug", in the same grey at the
 * same size whether that was six hours ago or six days. A date is not an age.
 *
 * THE HARDEST PART IS THE SILENCE. A banner on a healthy morning is noise that
 * trains people to ignore banners, and then it is worth nothing on the morning
 * it matters. Most of what follows is about it staying quiet.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'assets', 'app-core.js'), 'utf8');

// dataHealth is a pure function of meta and the clock, so it is lifted out and
// run directly rather than through the whole page harness.
function loadHealth() {
  const start = SRC.indexOf('const STALE_HOURS');
  const end = SRC.indexOf('// Rendered above the page content');
  assert.ok(start > -1 && end > start, 'the data-health block has moved');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(SRC.slice(start, end) + '\nglobalThis.out = { dataHealth, describeAge };', ctx);
  return ctx.out;
}
const { dataHealth, describeAge } = loadHealth();

const NOW = Date.parse('2026-09-15T12:00:00Z');
const agoHours = (h) => ({ lastUpdate: new Date(NOW - h * 36e5).toISOString(), fetchFailures: [] });

test('a healthy build says nothing at all', () => {
  // The job runs daily at about 11:30 UTC, so any age under a day is normal and
  // must be silent. If this ever starts returning a level, the banner becomes
  // furniture and stops being read.
  for (const h of [0, 1, 6, 12, 23, 25, 30, 35]) {
    const r = dataHealth(agoHours(h), NOW);
    assert.strictEqual(r.level, 'ok', `${h} hours old reported as "${r.level}" — that is a normal morning`);
  }
});

test('a missed day speaks, and a missed week speaks louder', () => {
  assert.strictEqual(dataHealth(agoHours(37), NOW).level, 'stale');
  assert.strictEqual(dataHealth(agoHours(50), NOW).level, 'stale');
  assert.strictEqual(dataHealth(agoHours(97), NOW).level, 'very-stale');
  assert.strictEqual(dataHealth(agoHours(24 * 8), NOW).level, 'very-stale');
});

test('the message states an age, not a date', () => {
  // "Data updated: 12 Sept" requires the reader to know today's date and do
  // the subtraction. The number they need is how old it is.
  const r = dataHealth(agoHours(50), NOW);
  assert.match(r.message, /\d+\s+(hours|days)/, `no age in the message: "${r.message}"`);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(r.message), 'the message prints a raw timestamp');
  assert.strictEqual(describeAge(40), '40 hours');
  assert.strictEqual(describeAge(49), '2 days');
  assert.strictEqual(describeAge(24 * 9 + 5), '9 days');
});

test('a failed source is reported even when the run was recent', () => {
  // Harder to spot than a whole site being behind: one layer is older than the
  // rest and every other number on the page is current.
  const meta = { ...agoHours(3), fetchFailures: [{ source: 'nflverse ngs', message: 'HTTP 404' }] };
  const r = dataHealth(meta, NOW);
  assert.strictEqual(r.level, 'partial');
  assert.match(r.message, /nflverse ngs/, 'the message does not say WHICH source failed');
  assert.match(r.message, /older than the rest/i, 'and it must say what that means for the reader');
});

test('staleness outranks a partial failure', () => {
  // Both true at once: say the bigger thing.
  const meta = { ...agoHours(120), fetchFailures: [{ source: 'sleeper', message: 'timeout' }] };
  assert.strictEqual(dataHealth(meta, NOW).level, 'very-stale');
});

test('a meta with no timestamp is not treated as fresh', () => {
  // The dangerous default. An absent field must not read as "just updated".
  for (const meta of [null, {}, { lastUpdate: null }]) {
    const r = dataHealth(meta, NOW);
    assert.notStrictEqual(r.level, 'ok', `${JSON.stringify(meta)} was treated as healthy`);
    assert.strictEqual(r.level, 'unknown');
  }
});

test('the banner is hidden until it has something to say', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<div id="dataHealth" hidden><\/div>/,
    'the host must ship hidden — a visible empty bar is a layout shift on every load');
  assert.match(SRC, /if \(h\.level === 'ok'\) \{[^}]*hidden = true/,
    'a healthy build must re-hide the host rather than leaving whatever was there');
  assert.match(SRC, /role="status"/, 'a screen reader gets no notice that the data is stale');
});

test('the real meta on disk is healthy', () => {
  // If this fails the site is genuinely behind, which is the point.
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'meta.json'), 'utf8'));
  const r = dataHealth(meta, Date.now());
  assert.ok(['ok', 'partial'].includes(r.level),
    `the committed data is ${r.level}: ${r.message}`);
});
