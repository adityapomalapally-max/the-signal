/**
 * The season boundary, and the scripts that used to keep their own.
 *
 * lib/season.js was written because nine scripts each carried a hand-typed
 * [2023, 2024, 2025] with comments telling the next person to keep them in
 * step by remembering. Five were migrated. Four were not, and nothing said so
 * — the file's own docblock still listed them as the problem it had solved.
 *
 * scripts/dry-run-rollover.js found what that costs. Told the league was in
 * 2026 week 1, build-scheme read the season off the calendar month, fetched
 * 2025, exited 0, and printed "unchanged" five times: scheme, charting, the
 * field maps, player usage and weekly usage would all have stayed on last
 * season under this season's heading. The In Season section reads the last of
 * those.
 *
 * These tests exist so the migration cannot come half-undone again.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const YML = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily-update.yml'), 'utf8');

// Only the scripts the daily Action runs. A research script that pins a season
// on purpose is not the same thing as a build that has to roll over.
const dailyScripts = [...new Set([...YML.matchAll(/node scripts\/([a-z-]+)\.js/g)].map(m => m[1]))];

test('no script in the daily Action hand-types a season', () => {
  // The rule is not "no year literal appears" — several of these declare a
  // placeholder and fill it from the calendar in main(), which is the pattern
  // being asked for. What is forbidden is a year that NOTHING can move: a
  // const, or a let nobody ever reassigns from lib/season.js.
  const offenders = [];
  for (const name of dailyScripts) {
    const file = path.join(SCRIPTS, `${name}.js`);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const decls = [...src.matchAll(/(const|let|var)\s+([A-Za-z_]+)\s*=\s*(20\d\d\b|\[\s*20\d\d\s*,)/g)];
    for (const [, kind, varName] of decls) {
      // ONE EXCEPTION, AND IT IS A DIFFERENT KIND OF NUMBER. A constant named
      // FIRST_<something>_SEASON is not a boundary that has to move with the
      // calendar — it records the season an upstream feed STARTED publishing a
      // column, which is a fact about history and will be as true in 2030 as it
      // is now. Next Gen Stats has no expected-yards figure before 2018; the
      // columns exist and are empty. Deriving that from lib/season.js would be
      // deriving the wrong thing.
      //
      // The name has to say so, so the exception is visible in the code rather
      // than living only here.
      if (/^FIRST_[A-Z_]*SEASON$/.test(varName)) continue;
      if (kind === 'const') { offenders.push(`${name}: const ${varName} — nothing can move it`); continue; }
      // Reassigned from the calendar anywhere else in the file?
      // The whole assignment expression, not just what follows the `=`:
      // build-sos fills its from `live ? st.season : await lastCompletedSeason()`.
      const filled = new RegExp(`${varName}\\s*=\\s*[^;\\n]*[sS]eason`).test(
        src.replace(new RegExp(`(const|let|var)\\s+${varName}\\s*=\\s*20\\d\\d`), ''));
      if (!filled) offenders.push(`${name}: let ${varName} — declared with a year and never filled from the calendar`);
    }
  }
  assert.deepStrictEqual(offenders, [],
    'these run every morning and decide for themselves what season it is:\n  ' + offenders.join('\n  ')
    + '\nDerive it from lib/season.js, or the site publishes last season under this season\'s heading.');
});

test('the scripts that need the calendar actually ask for it', () => {
  // Requiring the module is not proof it is used, but not requiring it IS
  // proof it is not.
  const needsCalendar = ['build-scheme', 'build-teams', 'build-rankings', 'build-injury-curves',
                         'fetch-stats', 'fetch-ngs', 'fetch-injuries', 'build-matchups'];
  for (const name of needsCalendar) {
    const src = fs.readFileSync(path.join(SCRIPTS, `${name}.js`), 'utf8');
    assert.match(src, /require\('\.\/lib\/season'\)/,
      `${name} does not read lib/season.js, so it has a boundary of its own somewhere`);
  }
});

test('availability is measured over completed seasons, never one in progress', () => {
  // Games played out of 17. A season in progress counts every game not yet
  // played as a game missed — in week 3 a healthy starter reads as 3 of 17,
  // and every floor on the site collapses. This is why it is
  // lastCompletedSeason and not the window everything else fetches.
  for (const name of ['build-rankings', 'build-injury-curves']) {
    const src = fs.readFileSync(path.join(SCRIPTS, `${name}.js`), 'utf8');
    assert.match(src, /lastCompletedSeason\(\)/,
      `${name} does not use lastCompletedSeason — a partial season in its window reads unplayed games as missed ones`);
    assert.ok(!/dataSeasons\(/.test(src),
      `${name} uses dataSeasons, which includes the season in progress`);
  }
});

test('a simulated calendar cannot reach the daily Action', () => {
  // The override exists so the rollover can be rehearsed. A file built under it
  // describes a season the league has not played, and no-simulated-data.test.js
  // catches that AFTER the commit — refusing before is better.
  const src = fs.readFileSync(path.join(SCRIPTS, 'lib', 'season.js'), 'utf8');
  assert.match(src, /SIGNAL_SEASON_STATE/, 'the override is gone, so the rollover can no longer be rehearsed');
  // The CI BRANCH itself has to stop, not merely exist. An earlier version of
  // this test looked for process.exit anywhere nearby, and passed happily when
  // the guard was reduced to a console warning — the two aborts for malformed
  // input a few lines below were enough to satisfy it.
  const branch = src.match(/if\s*\(process\.env\.GITHUB_ACTIONS[^)]*\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(branch, 'the simulated calendar no longer refuses to run in CI — it can now build a shipped file for a season nobody has played');
  assert.match(branch[1], /process\.exit\(1\)/,
    'the CI guard warns instead of stopping, so a simulated season can reach a commit');
});

test('the dry run walks the real workflow rather than a copy of it', () => {
  // A list of steps kept beside the workflow is a list that drifts from it,
  // and the drift would be silent in exactly the tool built to find silence.
  const src = fs.readFileSync(path.join(SCRIPTS, 'dry-run-rollover.js'), 'utf8');
  assert.match(src, /daily-update\.yml/,
    'dry-run-rollover no longer reads the workflow, so a step added there is a step it never tests');
});
