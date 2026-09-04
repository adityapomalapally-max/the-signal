/**
 * Season rollover.
 *
 * The failure this guards against has no symptom: on the first Sunday of the
 * regular season the fetch scripts go on asking for the seasons they were told
 * about, every build succeeds, the site renders, and every number on it belongs
 * to last year. So the tests here are mostly about the ALARM — an alarm that
 * cannot be made to ring is not an alarm.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const season = require('../scripts/lib/season');

// `started` is the date of the season's first game, as Sleeper publishes it.
// Every test states one, because "has anyone played yet" is the question the
// library now asks and a test that leaves it to the wall clock would answer
// differently in September than in November.
function at(phase, year, week = 1, started = `${year}-09-10`) {
  season.__setState({
    season: year, previousSeason: year - 1, week, phase,
    seasonStartDate: started, source: 'test',
  });
}

// The league has been told the regular season is on, but the first game has not
// been played. This is the state Sleeper actually published from 2026-08-29.
function declaredButNotPlayed(year = 2026) {
  at('regular', year, 1, `${year}-12-31`);
}

test('the season window rolls over on its own when games start', async () => {
  // August: 2026 stats do not exist yet, so the window has to end at 2025.
  // Asking nflverse for a 2026 file in August gets a 404, or worse an empty file
  // that reads as every player scoring zero.
  at('pre', 2026);
  assert.deepStrictEqual(await season.dataSeasons(3), [2023, 2024, 2025]);
  assert.strictEqual(await season.latestDataSeason(), 2025);

  // September, same code, no edit: the window has moved by itself.
  at('regular', 2026, 2, '2026-09-01');
  assert.deepStrictEqual(await season.dataSeasons(3), [2024, 2025, 2026]);
  assert.strictEqual(await season.latestDataSeason(), 2026);
});

test('a regular season that has been DECLARED but not PLAYED has no data yet', async () => {
  // 2026-08-29: Sleeper began reporting season_type "regular", week 1, while
  // the same payload gave season_start_date 2026-09-09. latestDataSeason read
  // the flag, the window opened to 2026, nflverse 404'd a file for a season
  // with no games in it, and fetch-stats exited 1 — taking the commit step and
  // eleven days of history snapshots with it.
  declaredButNotPlayed(2026);
  assert.strictEqual(await season.latestDataSeason(), 2025,
    'nobody has kicked off, so the newest season WITH DATA is still 2025');
  assert.deepStrictEqual(await season.dataSeasons(3), [2023, 2024, 2025],
    'the fetch window must not ask nflverse for a season nobody has played');
  assert.strictEqual(await season.isInSeason(), false,
    'preseason products have not started aging until a game is played');

  // Kickoff day itself counts; the day before does not.
  at('regular', 2026, 1, '2026-09-10');
  const st = await season.state();
  assert.strictEqual(season.gamesHaveStarted(st, new Date('2026-09-10T12:00:00Z')), true);
  assert.strictEqual(season.gamesHaveStarted(st, new Date('2026-09-09T12:00:00Z')), false);
});

test('a missing start date cannot leave the pipeline quietly a year stale', async () => {
  // The silent failure is the one that matters: if Sleeper drops the field, the
  // answer must not be "no games played" all the way through November.
  const noDate = { season: 2026, previousSeason: 2025, phase: 'regular', week: 0 };

  assert.strictEqual(season.gamesHaveStarted(noDate, new Date('2026-09-02T12:00:00Z')), false,
    'early September with nothing to corroborate: stay conservative');
  assert.strictEqual(season.gamesHaveStarted(noDate, new Date('2026-11-02T12:00:00Z')), true,
    'November is under way whatever the feed forgot to say');
  assert.strictEqual(season.gamesHaveStarted({ ...noDate, week: 2 }, new Date('2026-09-02T12:00:00Z')), true,
    'week 2 means week 1 was played, whatever the calendar says');
});

test('the season being played is never called completed', async () => {
  at('regular', 2026);
  assert.strictEqual(await season.lastCompletedSeason(), 2025, 'week 3 is not a completed 2026');
  assert.strictEqual(await season.targetSeason(), 2026);

  at('post', 2026);
  assert.strictEqual(await season.lastCompletedSeason(), 2026);

  at('off', 2027);
  assert.strictEqual(await season.lastCompletedSeason(), 2027);
});

test('in-season is the flag that ages preseason products', async () => {
  at('off', 2026);                       assert.strictEqual(await season.isInSeason(), false);
  at('pre', 2026);                       assert.strictEqual(await season.isInSeason(), false);
  declaredButNotPlayed(2026);            assert.strictEqual(await season.isInSeason(), false,
    'declared regular, nobody has played: nothing preseason-built has begun aging');
  at('regular', 2026, 1, '2026-09-01');  assert.strictEqual(await season.isInSeason(), true);
  at('post', 2026);                      assert.strictEqual(await season.isInSeason(), true);
});

test('the date fallback names a season the way the league does', () => {
  // The league year rolls over in March, so January's playoffs still belong to
  // the season that started the previous September. Calling January 2027 the
  // 2027 season would ask for a season that has not been played.
  const jan = season.fromDate(new Date('2027-01-15T12:00:00Z'));
  assert.strictEqual(jan.season, 2026, 'January belongs to the season that started last autumn');
  assert.strictEqual(jan.phase, 'post');

  const oct = season.fromDate(new Date('2026-10-05T12:00:00Z'));
  assert.strictEqual(oct.season, 2026);
  assert.strictEqual(oct.phase, 'regular');

  const may = season.fromDate(new Date('2026-05-05T12:00:00Z'));
  assert.strictEqual(may.season, 2026);
  assert.strictEqual(may.phase, 'off', 'May is the offseason, not a playoff');
});

test('the fallback is conservative in the direction that matters', () => {
  // Better to call a live season "pre" for a few days than to declare a regular
  // season that has not started and go asking for games nobody has played.
  const earlySept = season.fromDate(new Date('2026-08-30T12:00:00Z'));
  assert.strictEqual(earlySept.phase, 'pre');
});

test('THE ALARM RINGS: today\'s data would fail a Week 2 check', async () => {
  // The whole point. Today the data is correct for the preseason, so the check
  // passes — which proves nothing on its own. Drive the calendar to Week 2 with
  // the SAME data on disk and it has to go red, or it would never have caught
  // the rollover it exists for.
  //
  // WEEK 2, NOT WEEK 1. In Week 1 there is nothing to have rolled over to:
  // nflverse builds a season's file after its first games, so a pipeline that
  // has not moved is indistinguishable from one with nothing to move to. Asking
  // in Week 1 is what reddened eleven consecutive daily runs in 2026.
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  const ROOT = path.join(__dirname, '..');

  // Today, unmodified: expected to pass.
  execFileSync('node', ['scripts/check-season.js'], { cwd: ROOT });

  // Now pretend the season started, with today's (2025-latest) data still on disk.
  let failed = false, output = '';
  try {
    execFileSync('node', ['-e', `
      const season = require('./scripts/lib/season');
      season.__setState({ season: 2026, previousSeason: 2025, week: 2, phase: 'regular', seasonStartDate: '2026-09-01', source: 'test' });
      require('./scripts/check-season.js');
    `], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    failed = true;
    output = (e.stdout || '').toString() + (e.stderr || '').toString();
  }
  assert.strictEqual(failed, true,
    'with the season under way and only 2025 data on disk, the check MUST fail — otherwise it would never fire');
  assert.match(output, /no 2026 rows|stale|ADP/i, 'and it has to say what is stale');

  // EVERY LAYER THE IN-SEASON SECTION READS HAS TO BE NAMED. The section exists
  // to be used during the season, which makes a silent rollover there the worst
  // case on the site: the matchup board would go on showing last year's
  // defences under a banner that says "preseason" and look entirely correct.
  // A layer missing from this list is a layer that can go stale in silence.
  for (const layer of ['matchups.json', 'weekly-usage.json', 'fieldmap.json', 'charting.json']) {
    assert.ok(output.includes(layer),
      `the alarm did not name ${layer} — it can go a year stale without reddening the run.\n\nGot:\n${output}`);
  }
});

test('AND IT STAYS QUIET before anyone has kicked off', async () => {
  // The other half of an alarm worth having. From 2026-08-29 Sleeper called the
  // season "regular" eleven days before the first game; this check went red on
  // every run for data that was exactly as correct as it could be. An alarm
  // that fires on a normal week is one people learn to ignore.
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  const ROOT = path.join(__dirname, '..');

  execFileSync('node', ['-e', `
    const season = require('./scripts/lib/season');
    season.__setState({ season: 2026, previousSeason: 2025, week: 1, phase: 'regular', seasonStartDate: '2026-12-31', source: 'test' });
    require('./scripts/check-season.js');
  `], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
});
