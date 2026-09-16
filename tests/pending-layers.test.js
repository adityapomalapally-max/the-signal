/**
 * The alarm's three answers about a layer with no current season.
 *
 * A layer that does not carry the season being played is one of three things,
 * and check-season used to call all of them the same thing:
 *
 *   BEHIND   — the feed published and we did not build it. The year-stale
 *              failure with no symptom, and the reason the alarm exists.
 *   PENDING  — the feed has not published. nflverse ships pbp_participation
 *              after a season ENDS, so scheme, player-usage and routes cannot
 *              have this season until then. Four of those rang every morning
 *              for five days in September 2026 and reddened the whole daily
 *              run over a file nobody here can make appear.
 *   YOUNG    — the data is there and nobody has met the qualifier yet. The
 *              field map wants 200 attempts from a passer; that is Week 6.
 *
 * Only the first is a problem. Telling them apart takes two facts that are not
 * in the file: what the feed has published, which lib/feeds.js asks out loud,
 * and why the build produced nothing, which the build stamps into the file's
 * own meta.
 *
 * EVERY STATE IS BUILT ON PURPOSE HERE. The alarm used to be testable only in
 * whatever state this morning's data happened to be in, so the case that
 * mattered most — a stamp still excusing a layer whose feed had published —
 * had never run at all.
 *
 *   node --test tests/pending-layers.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const seasonLib = require('../scripts/lib/season');

// The season the fixture plays, derived rather than typed: a year written in
// here is a test that starts lying every September.
const LIVE = seasonLib.fromDate(new Date()).season;
const PREV = LIVE - 1;

const LAYERS = ['scheme.json', 'player-usage.json', 'routes.json', 'charting.json',
                'fieldmap.json', 'matchups.json', 'weekly-usage.json'];

// A data directory in which nothing is wrong. Each case below breaks exactly
// one thing in it, so a failure names its own cause.
function healthyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-season-'));
  const write = (f, o) => fs.writeFileSync(path.join(dir, f), JSON.stringify(o));
  const perPlayerSeasons = { p1: { seasons: { [LIVE]: { g: 1 } } } };
  const perPlayerYears = { p1: { [LIVE]: { g: 1 } } };

  write('stats.json', perPlayerSeasons);
  write('ngs.json', perPlayerYears);
  write('injuries.json', perPlayerYears);
  for (const f of LAYERS) write(f, { meta: { seasons: [PREV, LIVE] } });
  write('adp.json', { meta: { historical: true, closedAt: `${LIVE}-09-09T00:00:00Z` } });
  write('ros.json', { players: {} });
  write('sos.json', { meta: { season: LIVE, defenseSeason: PREV } });
  write(`projections-${LIVE}.json`, {});
  write('rankings.json', { meta: { builtAt: new Date().toISOString() } });
  write('teams.json', { meta: { season: LIVE } });
  return dir;
}

// Run the real check-season against the fixture, with the calendar and the
// feed's answer both stated rather than fetched.
function runCheck(dir, { published }) {
  const script = `
    const season = require('${path.join(ROOT, 'scripts', 'lib', 'season.js')}');
    season.__setState({ season: ${LIVE}, previousSeason: ${PREV}, week: 2, phase: 'regular',
                        seasonStartDate: '${LIVE}-09-01', source: 'test' });
    require('${path.join(ROOT, 'scripts', 'lib', 'feeds.js')}').__setPublished(${JSON.stringify(published)});
    require('${path.join(ROOT, 'scripts', 'check-season.js')}');
  `;
  try {
    const out = execFileSync('node', ['-e', script], {
      cwd: ROOT, env: { ...process.env, SIGNAL_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output: out.toString() };
  } catch (e) {
    return { code: e.status, output: (e.stdout || '').toString() + (e.stderr || '').toString() };
  }
}

const editMeta = (dir, file, fn) => {
  const p = path.join(dir, file);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(j.meta);
  fs.writeFileSync(p, JSON.stringify(j));
};

test('a fixture with nothing wrong in it passes, or nothing below means anything', () => {
  const dir = healthyFixture();
  const r = runCheck(dir, { published: true });
  assert.strictEqual(r.code, 0, `the healthy fixture failed:\n${r.output}`);
});

test('PENDING: the feed has not published, so the layer is a note and the run stays green', () => {
  const dir = healthyFixture();
  editMeta(dir, 'scheme.json', (m) => { m.seasons = [PREV]; });
  const r = runCheck(dir, { published: false });
  assert.strictEqual(r.code, 0, `a layer waiting on an unpublished feed reddened the run:\n${r.output}`);
  assert.match(r.output, /note:.*scheme\.json/, 'and it has to say so rather than go silent');
});

test('BEHIND: the same layer, once the feed HAS published, is the failure this alarm is for', () => {
  const dir = healthyFixture();
  editMeta(dir, 'scheme.json', (m) => { m.seasons = [PREV]; });
  const r = runCheck(dir, { published: true });
  assert.strictEqual(r.code, 1, `the feed published and the layer was not built, and nothing rang:\n${r.output}`);
  assert.match(r.output, /scheme\.json/);
});

test('OUR STAMP DOES NOT OUTRANK THE FEED', () => {
  // The case that had never run. A build that stops running leaves its last
  // stamp behind, and a stamp that outranked the feed would go on excusing the
  // layer for the rest of the season — silently, which is the one outcome
  // every check in this repo is pointed at.
  const dir = healthyFixture();
  editMeta(dir, 'scheme.json', (m) => {
    m.seasons = [PREV];
    m.pending = { season: LIVE, reason: 'left over from a build that is no longer running' };
  });
  const r = runCheck(dir, { published: true });
  assert.strictEqual(r.code, 1, `a stale stamp silenced a layer whose feed had published:\n${r.output}`);
});

test('YOUNG: a layer that says why it is empty is a note, and one that does not is a problem', () => {
  // THE PRODUCER AND THE CONSUMER IN ONE TEST. build-scheme writes meta.pending
  // and check-season reads it; a key renamed on either side has to go red, and
  // a flag whose only writer is the test that checks it is decoration.
  const withStamp = healthyFixture();
  editMeta(withStamp, 'fieldmap.json', (m) => {
    m.seasons = [PREV];
    m.pending = { season: LIVE, reason: 'no passer at 200+ attempts yet' };
  });
  const quiet = runCheck(withStamp, { published: true });
  assert.strictEqual(quiet.code, 0, `a layer that stated why it is empty still reddened the run:\n${quiet.output}`);
  assert.match(quiet.output, /no passer at 200\+ attempts yet/,
    'the reason has to reach the reader, or the stamp is just a way to go quiet');

  const bare = healthyFixture();
  editMeta(bare, 'fieldmap.json', (m) => { m.seasons = [PREV]; });
  assert.strictEqual(runCheck(bare, { published: true }).code, 1,
    'an unexplained empty layer is indistinguishable from a build that stopped, and must ring');
});

test('a stamp is about ONE season, and next year it excuses nothing', () => {
  const dir = healthyFixture();
  editMeta(dir, 'fieldmap.json', (m) => {
    m.seasons = [PREV];
    m.pending = { season: PREV, reason: 'last season was young once too' };
  });
  assert.strictEqual(runCheck(dir, { published: true }).code, 1,
    'a stamp naming a different season silenced the season being played');
});

test('the real build stamps the real files, in the shape the real check reads', () => {
  // The other half of the producer/consumer bargain: the files this repo ships
  // are read by the same rule the fixture is. A stamp on disk has to name a
  // season and carry a reason — an empty one would pass the check above and
  // tell a reader nothing.
  for (const f of LAYERS) {
    const p = path.join(ROOT, 'data', f);
    if (!fs.existsSync(p)) continue;
    const meta = (JSON.parse(fs.readFileSync(p, 'utf8')).meta) || {};
    if (!meta.pending) continue;
    assert.ok(Number.isFinite(Number(meta.pending.season)), `${f}: a stamp with no season`);
    assert.ok(typeof meta.pending.reason === 'string' && meta.pending.reason.length > 20,
      `${f}: a stamp with no reason in it is a way to go quiet, not an explanation`);
    assert.ok(!(meta.seasons || []).map(Number).includes(Number(meta.pending.season)),
      `${f}: ${meta.pending.season} is both published and pending, which cannot both be true`);
  }
});
