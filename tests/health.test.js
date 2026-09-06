/**
 * The health report, and the one property that makes it worth having.
 *
 * A health check is only useful if it can see a failure the rest of the system
 * cannot. From 2026-08-29 the daily Action failed eleven times and committed
 * nothing for seven days, while its own in-pipeline feed check reported
 * "last update: 0h ago — OK" every single morning — truthfully, about a file
 * written ninety seconds earlier that would never be committed.
 *
 * So the tests here are mostly about INDEPENDENCE. A future change that folds
 * these checks back into the daily build, or that judges freshness by reading
 * the working tree, would restore the exact blind spot this exists to cover and
 * would do it without breaking anything visible.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WF = path.join(ROOT, '.github', 'workflows');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'health-report.js'), 'utf8');
const health = require('../scripts/health-report');

test('the health check does not run inside the build it is checking', () => {
  const daily = fs.readFileSync(path.join(WF, 'daily-update.yml'), 'utf8');
  assert.ok(!daily.includes('health-report.js'),
    'health-report.js has been added to the daily build — it would then be judging the tree that build just wrote, '
    + 'which is the blind spot it exists to cover. It belongs in health.yml, on its own schedule.');

  const own = fs.readFileSync(path.join(WF, 'health.yml'), 'utf8');
  assert.match(own, /schedule:/, 'health.yml must carry its own schedule, not wait to be triggered by the build');
  assert.match(own, /health-report\.js/);
});

test('freshness is asked over HTTP, not read off the disk beside it', () => {
  // The published check must go to the network. If it ever reads data/meta.json
  // from the working tree it is measuring the same file the build just wrote.
  const fn = SRC.slice(SRC.indexOf('async function checkPublished'), SRC.indexOf('/* ── 2.'));
  assert.match(fn, /ORIGIN/, 'checkPublished must ask the published origin');
  assert.ok(!/readFileSync/.test(fn),
    'checkPublished reads a local file — that is the blind spot, not the check');
});

test('a frozen series is a decision, not a dead one', () => {
  const old = '2026-01-01';
  assert.strictEqual(health.rowIsStale({ date: old }), true, 'an ordinary series that stopped is stale');
  assert.strictEqual(health.rowIsStale({ date: old, frozen: true }), false,
    'ADP freezes on purpose when the draft market closes; flagging it would put a permanent red mark on the report');
});

test('the headline takes the worst of what it found', () => {
  const at = (rows) => health.render(rows).split('\n')[0];
  assert.match(at([{ level: 'ok', area: 'a', line: 'x' }]), /all clear/);
  assert.match(at([{ level: 'ok', area: 'a', line: 'x' }, { level: 'warn', area: 'b', line: 'y' }]), /to look at/);
  assert.match(at([{ level: 'warn', area: 'b', line: 'y' }, { level: 'fail', area: 'c', line: 'z' }]), /problem/);
});

test('problems are stated in full, and passes are folded away', () => {
  const out = health.render([
    { level: 'fail', area: 'commits', line: 'NO DATA COMMIT IN 7d', detail: 'the thing that matters' },
    { level: 'ok', area: 'feeds', line: 'all answered' },
  ]);
  assert.ok(out.indexOf('NO DATA COMMIT') < out.indexOf('<details'),
    'a failure must appear above the fold, not inside the collapsed section');
  assert.match(out, /the thing that matters/, 'the detail of a failure is the part somebody acts on');
});
