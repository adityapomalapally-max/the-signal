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

test('and something actually writes the flag that decision is carried in', () => {
  // THE TEST ABOVE PASSED FOR THREE DAYS WHILE THE REPORT WAS RED. It proves the
  // reader honours `frozen`; nothing proved the writer ever emits one, and it did
  // not — build-history logged "the market closed, so the series does too" and
  // skipped the write entirely, so the last row was an ordinary row wearing no
  // flag. Two correct halves, never introduced to each other.
  //
  // A guard whose key is only ever written by the test that checks it is
  // decoration. This holds the real producer against the real consumer, so
  // renaming the flag on either side reds it.
  const { frozenRow } = require('../scripts/build-history');
  const last = { date: '2026-09-08', source: 'Fantasy Football Calculator', values: { x: 1 } };
  const row = frozenRow(last, { closedNote: 'Drafts are over.' });

  assert.strictEqual(health.rowIsStale(row), false,
    'the row build-history stamps must be the row rowIsStale forgives — that is the whole handshake');
  assert.strictEqual(health.rowIsStale(last), true,
    'and the unstamped row it was built from must still read as stale, or the test proves nothing');
  assert.strictEqual(row.date, last.date, 'the stamp marks where the series ENDED, never a fresh day');
  assert.deepStrictEqual(row.values, last.values, 'stamping must not disturb the data on the row');
  assert.ok(row.frozenReason, 'a freeze with no reason on it is indistinguishable from a bug next season');
});

test('the live ADP series says which of the two states it is in', () => {
  // End to end, against what is actually on disk, and it asserts in BOTH phases
  // rather than skipping one — a test that only means something for half the year
  // is the shape that goes quiet in the preseason and rots unnoticed.
  const adp = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'adp.json'), 'utf8'));
  const rows = fs.readFileSync(path.join(ROOT, 'data', 'history', 'adp.jsonl'), 'utf8')
    .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const last = rows[rows.length - 1];

  if (adp.meta && adp.meta.historical) {
    assert.ok(last.frozen,
      `adp.json is stamped historical (closed ${String(adp.meta.closedAt).slice(0, 10)}) but the last series row `
      + `(${last.date}) carries no frozen flag — the health report will red every morning until the next preseason`);
  } else {
    assert.ok(!last.frozen,
      'the draft market is open but the series is stamped frozen — it has stopped sampling a market that is still moving');
  }
});

test('the report does not count its own failures as evidence', () => {
  // IT EXITS 1 WHENEVER IT FINDS ANYTHING, so a failed Health Report run is the
  // alarm RINGING, not a fault. Counted back in, one broken thing reads as two:
  // on 2026-09-11 a single failing test in the daily build was reported as "2
  // scheduled runs have failed IN A ROW", the second being this report saying so.
  const run = (name, conclusion, p) => ({
    status: 'completed', conclusion, name, path: p,
    created_at: '2026-09-11T14:55:00Z', html_url: 'https://example.invalid/1',
  });
  const v = health.judgeRuns([
    run('Health Report', 'failure', health.SELF_WORKFLOW),
    run('Daily Data Update', 'failure', '.github/workflows/daily-update.yml'),
    run('Daily Data Update', 'success', '.github/workflows/daily-update.yml'),
  ]);
  assert.strictEqual(v.level, 'warn',
    'one real failure with this report’s own red on top of it must not read as a streak of two');
  assert.ok(!/Health Report/.test(v.detail || ''),
    'the detail must not send the reader to a run whose only content is the paragraph above it');
});

test('one red at the top is neither a pattern nor a recovery', () => {
  // The state that printed "recovered — 0 green in a row", which cannot be true
  // of anything: the recovery branch counts the green runs AHEAD of the newest
  // run, and when the newest run is red there are none. It had never executed —
  // reaching it needs a token and a network, so it was only ever judged against
  // whatever the repo happened to have done that week.
  const run = (conclusion, i) => ({
    status: 'completed', conclusion, name: 'Daily Data Update',
    path: '.github/workflows/daily-update.yml',
    created_at: `2026-09-${10 - i}T14:55:00Z`, html_url: `https://example.invalid/${i}`,
  });
  const v = health.judgeRuns([run('failure', 0), run('success', 1), run('failure', 2),
    run('failure', 3), run('success', 4)]);
  assert.strictEqual(v.level, 'warn', 'the newest scheduled run failed — that is not an all-clear');
  assert.ok(!/recovered/.test(v.line), `a run that just failed is not a recovery: "${v.line}"`);
  assert.ok(!/\b0 green\b/.test(v.line), `"0 green in a row" is not a state anything can be in: "${v.line}"`);

  // And the branch it used to fall into still works when it is actually true.
  const rec = health.judgeRuns([run('success', 0), run('success', 1), run('failure', 2),
    run('failure', 3), run('failure', 4)]);
  assert.strictEqual(rec.level, 'ok', 'green at the top with old failures behind it IS a recovery');
  assert.match(rec.line, /2 green in a row/, 'and it counts the green ones it actually found');
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

test('a finished build is never thrown away at the push', () => {
  // 2026-09-06: every build step passed, the commit was made, and `git push`
  // was rejected with "fetch first" because a code commit had landed during the
  // seven minutes the data took to build. Seven minutes of work discarded, and
  // the run went red having kept none of it — the same shape as the eleven-day
  // outage, where the pipeline ran fine and committed nothing.
  //
  // A bare `git push` in that step is the bug. It must retry.
  const daily = fs.readFileSync(path.join(WF, 'daily-update.yml'), 'utf8');
  const step = daily.slice(daily.indexOf('name: Commit and push'));
  assert.match(step, /git pull --rebase/,
    'the push must rebase and retry — anything landing during the build otherwise discards the whole run');
  assert.match(step, /for attempt in/,
    'one retry is not a retry loop; a second commit can land while the first rebase runs');
});

test('two data runs cannot race each other', () => {
  // Each run rebuilds the whole of data/, so an overlapping pair races to the
  // same files and the loser's build is discarded at the push. The rebase above
  // is safe precisely BECAUSE this guarantees whatever landed underneath is
  // code rather than data.
  const daily = fs.readFileSync(path.join(WF, 'daily-update.yml'), 'utf8');
  assert.match(daily, /concurrency:/,
    'the daily build needs a concurrency group, or it can race itself');
  assert.match(daily, /cancel-in-progress:\s*false/,
    'cancelling a run mid-build would throw away the data it had already fetched');
});
