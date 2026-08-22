/**
 * The order of the daily Action, and what has to be in it.
 *
 * build-rankings.js was NOT in the workflow for most of a year. It was run by
 * hand, which was fine while the board was a static preseason artefact — but
 * it prints a LIVE injury status beside each player's missed-time case, and
 * that flag is computed when the script runs. It was four days stale when this
 * was found: seven players carried a flag that had since changed, and nothing
 * said so. The data-age banner reads meta.json, so the site was calling itself
 * current while this one board described a previous week.
 *
 * Adding it to the Action is only half the fix. The other half is that nobody
 * can take it out again without a red test, and that the steps which READ what
 * it writes keep running after it.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const YML = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily-update.yml'), 'utf8');

// The scripts the daily job runs, in the order it runs them.
const steps = [...YML.matchAll(/node scripts\/([a-z-]+)\.js/g)].map(m => m[1]);

test('the daily Action rebuilds every board that carries a live figure', () => {
  // A file whose contents depend on TODAY has to be rebuilt today. Anything
  // added to this list needs the same argument made for it.
  for (const script of ['build-rankings']) {
    assert.ok(steps.includes(script),
      `${script}.js is not in the daily Action — whatever it prints will be as fresh as the last time somebody ran it by hand`);
  }
});

test('a build runs before the builds that read what it wrote', () => {
  // build-ros reads the medians out of rankings.json, and build-history
  // records the day's ranks from it. Both after, or they record yesterday.
  const at = (s) => steps.indexOf(s);
  for (const reader of ['build-ros', 'build-history']) {
    assert.ok(at(reader) > at('build-rankings'),
      `${reader} runs before build-rankings, so it reads the previous day's rankings.json`);
  }
  // And the rankings themselves need the statuses and the game logs first.
  for (const writer of ['update-data', 'fetch-stats']) {
    assert.ok(at(writer) < at('build-rankings'),
      `build-rankings runs before ${writer}, so its status flags and availability come from stale inputs`);
  }
});

test('the freshness of the rankings board is checked at runtime too', () => {
  // The test above catches the step being deleted. It cannot catch the Action
  // failing, being disabled, or the step erroring while the run stays green —
  // so the alarm that reads the file's own age has to exist as well.
  const check = fs.readFileSync(path.join(ROOT, 'scripts', 'check-season.js'), 'utf8');
  assert.match(check, /rankings\.json/,
    'check-season no longer looks at rankings.json, so a board that stops being rebuilt goes quiet again');
  assert.match(check, /builtAt/,
    'the rankings freshness check no longer reads builtAt, so it cannot tell how old the board is');
});

test('build-rankings writes only when something changed', () => {
  // It runs every morning now. The ordering comes from a hand-written file and
  // moves a few times a season, so most days there is nothing to write, and a
  // rewritten file would be a commit that says the board moved when it did not.
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build-rankings.js'), 'utf8');
  assert.match(src, /writeJSONIfChanged/,
    'build-rankings writes unconditionally — every daily run will commit a new rankings.json');
  assert.ok(!/fs\.writeFileSync\([^)]*JSON\.stringify/.test(src),
    'build-rankings still has a direct JSON write in it');
});
