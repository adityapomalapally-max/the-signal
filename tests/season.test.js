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

function at(phase, year, week = 1) {
  season.__setState({
    season: year, previousSeason: year - 1, week, phase, source: 'test',
  });
}

test('the season window rolls over on its own when games start', async () => {
  // August: 2026 stats do not exist yet, so the window has to end at 2025.
  // Asking nflverse for a 2026 file in August gets a 404, or worse an empty file
  // that reads as every player scoring zero.
  at('pre', 2026);
  assert.deepStrictEqual(await season.dataSeasons(3), [2023, 2024, 2025]);
  assert.strictEqual(await season.latestDataSeason(), 2025);

  // September, same code, no edit: the window has moved by itself.
  at('regular', 2026);
  assert.deepStrictEqual(await season.dataSeasons(3), [2024, 2025, 2026]);
  assert.strictEqual(await season.latestDataSeason(), 2026);
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
  at('off', 2026);      assert.strictEqual(await season.isInSeason(), false);
  at('pre', 2026);      assert.strictEqual(await season.isInSeason(), false);
  at('regular', 2026);  assert.strictEqual(await season.isInSeason(), true);
  at('post', 2026);     assert.strictEqual(await season.isInSeason(), true);
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

test('THE ALARM RINGS: today\'s data would fail a Week 1 check', async () => {
  // The whole point. Today the data is correct for the preseason, so the check
  // passes — which proves nothing on its own. Drive the calendar to Week 1 with
  // the SAME data on disk and it has to go red, or it would never have caught
  // the rollover it exists for.
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
      season.__setState({ season: 2026, previousSeason: 2025, week: 1, phase: 'regular', source: 'test' });
      require('./scripts/check-season.js');
    `], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    failed = true;
    output = (e.stdout || '').toString() + (e.stderr || '').toString();
  }
  assert.strictEqual(failed, true,
    'with the season under way and only 2025 data on disk, the check MUST fail — otherwise it would never fire');
  assert.match(output, /no 2026 rows|stale|ADP/i, 'and it has to say what is stale');
});
