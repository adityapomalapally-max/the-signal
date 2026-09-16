/**
 * lib/feeds.js — the gate between "not published yet" and "gone".
 *
 * A missing upstream file means opposite things either side of a season's end.
 * Before it, nflverse simply has not built the file and the honest answer is to
 * carry on without that layer. After it, a missing file is nflverse moving an
 * asset on us — which has happened, and which left every profile on the site a
 * year stale for months because a per-season try/catch swallowed the 404.
 *
 * So the gate is a function of the season's state, and it is asserted both
 * ways: the wrong answer in one direction stops the pipeline for a file nobody
 * can make appear, and in the other it hides the failure the pipeline exists to
 * notice.
 *
 *   node --test tests/feeds.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const feeds = require('../scripts/lib/feeds');

test('a season still being played may be missing its participation file', () => {
  const g = feeds.participationGate({ rows: 0, error: new Error('HTTP 404'), seasonFinished: false });
  assert.strictEqual(g.available, false);
  assert.strictEqual(g.fatal, false, 'a 404 in September must not take the build down');
  assert.match(g.reason, /404/, 'and the reason has to survive to the log and the stamp');
});

test('a season that FINISHED may not be missing it', () => {
  const g = feeds.participationGate({ rows: 0, error: new Error('HTTP 404'), seasonFinished: true });
  assert.strictEqual(g.fatal, true,
    'a finished season whose file has vanished is the nflverse release move, and it must fail the run');
});

test('an empty file is a missing file', () => {
  // The rule the FTN charting block already follows: a file that exists with no
  // rows in it fell through to a join rate of zero and threw "the join key
  // moved", which is a different and much more alarming thing than "not yet".
  const young = feeds.participationGate({ rows: 0, error: null, seasonFinished: false });
  assert.strictEqual(young.available, false);
  assert.strictEqual(young.fatal, false);
  assert.match(young.reason, /empty/i);

  const done = feeds.participationGate({ rows: 0, error: null, seasonFinished: true });
  assert.strictEqual(done.fatal, true, 'a finished season with an empty file is not "not yet"');
});

test('rows are the only thing that makes it available', () => {
  const g = feeds.participationGate({ rows: 45184, error: null, seasonFinished: true });
  assert.strictEqual(g.available, true);
  assert.strictEqual(g.fatal, false);
  assert.strictEqual(g.reason, null);
});

test('the three verdicts on a layer whose season is missing', () => {
  const layer = { label: 'personnel', file: 'scheme.json', season: 2026, feed: 'pbp_participation' };

  assert.strictEqual(feeds.judgeGatedLayer({ ...layer, hasSeason: true, published: false }).level, 'ok',
    'a layer that has the season is never a finding, whatever the feed is doing');

  const behind = feeds.judgeGatedLayer({ ...layer, hasSeason: false, published: true });
  assert.strictEqual(behind.level, 'problem');
  assert.match(behind.message, /HAS published/, 'the message has to name what changed, or nobody knows what to do');

  const pending = feeds.judgeGatedLayer({ ...layer, hasSeason: false, published: false });
  assert.strictEqual(pending.level, 'note');

  // COULD NOT ASK IS NOT NO. It is reported rather than folded into either
  // answer — and it does not red the run, because every other nflverse fetch in
  // the same run would have failed first if the network were the problem.
  const unknown = feeds.judgeGatedLayer({ ...layer, hasSeason: false, published: null });
  assert.strictEqual(unknown.level, 'note');
  assert.notStrictEqual(unknown.message, pending.message,
    'an unanswered question must not read as an answer');
});

test('one definition of the URL, and it is the one the build fetches', () => {
  const url = feeds.participationUrl(2026);
  assert.match(url, /pbp_participation_2026\.csv$/);
  assert.ok(!url.endsWith('.gz'), 'participation ships uncompressed only — there is no .csv.gz asset');
  const build = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'build-scheme.js'), 'utf8');
  assert.match(build, /feeds\.participationUrl\(season\)/,
    'build-scheme has grown its own copy of the URL, and the two will drift');
  assert.ok(!/pbp_participation\/pbp_participation_\$\{season\}/.test(build),
    'the old hand-written URL is back in build-scheme');
});
