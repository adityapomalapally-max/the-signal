/**
 * What fetchCSV does with an answer that is not the file.
 *
 * NOTHING IN tests/ MENTIONED lib/match.js, and every nflverse fetch in this
 * repo goes through it. The gap surfaced from the side: on 2026-09-25 the
 * mutation ratchet announced that the suite had got STRONGER, 35 -> 36, and the
 * new kill was `statusCode < 400` in the redirect branch. No assertion had been
 * written. What killed it was build-ros starting to ask the schedule feed, a
 * test spawning build-ros, and GitHub answering the release URL with a 302 —
 * the network being up, dressed as coverage. Bank that number and the first run
 * against a URL that stops redirecting reads as a weaker suite.
 *
 * nflverse release URLs ALWAYS redirect (github.com -> objects.githubusercontent
 * .com), so this branch runs on every fetch the daily Action makes, twenty-odd
 * times a morning, and a mistake in it looks like a feed outage rather than a
 * bug in here.
 *
 * Offline, through the transport seam.
 *
 *   node --test tests/match-fetch.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { EventEmitter } = require('node:events');
const match = require('../scripts/lib/match');

/**
 * A scripted transport. `reply(url, n)` returns what the nth request answers:
 * { status, headers, body }. Records what was asked for, in order, so "it was
 * followed" is a statement about the SECOND request existing and not just about
 * the promise resolving.
 */
function scripted(reply) {
  const asked = [];
  const sent = [];
  match.__setTransport((url, opts, cb) => {
    asked.push(String(url));
    sent.push(opts && opts.headers);
    const answer = reply(String(url), asked.length) || {};
    const res = new EventEmitter();
    res.statusCode = answer.status;
    res.headers = answer.headers || {};
    // Delivered a tick later, the way a socket does it: fetchCSV attaches its
    // listeners inside the callback below, so emitting synchronously here would
    // pass the test for the wrong reason.
    process.nextTick(() => {
      if (answer.body != null) {
        res.emit('data', Buffer.isBuffer(answer.body) ? answer.body : Buffer.from(answer.body));
      }
      res.emit('end');
    });
    cb(res);
    return new EventEmitter();          // the req, which callers hook 'error' on
  });
  return { asked, sent };
}

test.afterEach(() => match.__resetTransport());

test('a redirect is followed, and the body comes from where it points', async () => {
  const t = scripted((url, n) => (n === 1
    ? { status: 302, headers: { location: 'https://objects.example/games.csv' } }
    : { status: 200, body: 'season,week\n2026,1\n' }));

  const csv = await match.fetchCSV('https://github.example/games.csv');
  assert.match(csv, /2026,1/);
  assert.deepStrictEqual(t.asked,
    ['https://github.example/games.csv', 'https://objects.example/games.csv'],
    'the redirect was not followed to the address it named');
  assert.strictEqual(match.parseCSV(csv).length, 1, 'the followed body did not parse as the file');
});

test('every request carries the project User-Agent', async () => {
  // GitHub throttles an unidentified client, and the whole pipeline is one
  // client. lib/agent is the single place that string lives.
  const { USER_AGENT } = require('../scripts/lib/agent');
  const t = scripted(() => ({ status: 200, body: 'a\n1\n' }));
  await match.fetchCSV('https://github.example/x.csv');
  assert.strictEqual(t.sent[0]['User-Agent'], USER_AGENT);
});

test('300 is a redirect and 400 is not', async () => {
  // THE TWO BOUNDARIES OF `>= 300 && < 400`, which is what the ratchet was
  // catching by accident. Asserted ON the edges, not either side of them.
  const low = scripted((url, n) => (n === 1
    ? { status: 300, headers: { location: 'https://objects.example/a.csv' } }
    : { status: 200, body: 'a\n1\n' }));
  assert.match(await match.fetchCSV('https://github.example/a.csv'), /1/);
  assert.strictEqual(low.asked.length, 2, '300 with a location was not followed');

  match.__resetTransport();

  // A 400 IS AN ANSWER, NOT A DIRECTION — even when it carries a location, which
  // real servers do send on errors. Following it would turn a bad request into a
  // fetch of something else entirely.
  const high = scripted(() => ({ status: 400, headers: { location: 'https://objects.example/b.csv' } }));
  await assert.rejects(() => match.fetchCSV('https://github.example/b.csv'), /HTTP 400/);
  assert.strictEqual(high.asked.length, 1, 'a 400 with a location header was followed as a redirect');
});

test('a status that is not 200 and not a redirect is refused, not parsed', async () => {
  // 404 is the ordinary morning shape of a season nflverse has not published
  // yet. It has to arrive as an error the caller can name, never as an empty
  // file that parses to zero rows and silently empties a layer.
  const t = scripted(() => ({ status: 404, body: 'Not Found' }));
  await assert.rejects(() => match.fetchCSV('https://github.example/stats_2027.csv'), /HTTP 404/);
  assert.strictEqual(t.asked.length, 1);
});

test('a .gz answer is gunzipped, and only a .gz answer', async () => {
  const gz = zlib.gzipSync(Buffer.from('season,week\n2026,2\n'));
  scripted(() => ({ status: 200, body: gz }));
  assert.match(await match.fetchCSV('https://github.example/pbp.csv.gz'), /2026,2/);

  match.__resetTransport();
  scripted(() => ({ status: 200, body: 'season,week\n2026,3\n' }));
  assert.match(await match.fetchCSV('https://github.example/pbp.csv'), /2026,3/,
    'a plain body was put through gunzip');
});

test('a redirect loop stops instead of running for ever', { timeout: 5000 }, async () => {
  // The counter is the only thing between a misconfigured redirect and a build
  // that never finishes. A mutation making it count DOWN leaves the cap
  // unreachable, and the symptom is a daily run that hangs rather than fails —
  // which is why this test carries its own timeout: the assertion has to be
  // reached, and under that mutation nothing ever settles.
  const t = scripted((url, n) => ({ status: 302, headers: { location: `https://loop.example/${n}.csv` } }));
  await assert.rejects(() => match.fetchCSV('https://loop.example/0.csv'), /Too many redirects/);
  // SIX, NOT SEVEN: the cap is checked before the request, so the attempt that
  // would have been the seventh is the one refused. Worth pinning as a number —
  // I wrote 7 here first and this assertion is what said otherwise.
  assert.strictEqual(t.asked.length, 6, `the cap let ${t.asked.length} requests through`);
});
