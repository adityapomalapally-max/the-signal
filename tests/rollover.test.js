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
  // THE PROPERTY, NOT THE MECHANISM. This used to assert that these files never
  // mention dataSeasons, which is a way of writing the rule and not the rule
  // itself — and it blocked the correct fix. build-rankings now derives its
  // window from dataSeasons (so it can only ask for seasons the fetches
  // actually write) and then drops anything past the last completed one. That
  // satisfies this test's reason and failed its letter.
  for (const name of ['build-rankings', 'build-injury-curves']) {
    const src = fs.readFileSync(path.join(SCRIPTS, `${name}.js`), 'utf8');
    assert.match(src, /lastCompletedSeason\(\)/,
      `${name} does not consult lastCompletedSeason — a partial season in its window reads unplayed games as missed ones`);
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/dataSeasons\(/.test(body)) {
      assert.match(body, /filter\(\s*s\s*=>\s*s\s*<=\s*last\s*\)/,
        `${name} takes its window from dataSeasons, which includes the season in progress, `
        + `without filtering it back to completed seasons`);
    }
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

/* ═══════════════════════════════════════════════════════════════════════════
   A CHECK MUST NOT DEMAND A STATE ITS OWN RUN CANNOT REACH.

   The 2026 season began at 01:00 UTC on 09-09, between a full run at 15:00 the
   previous afternoon and a light run at 01:05 that night. The light run
   correctly noticed the ADP board had not been frozen, failed, and could not
   possibly have fixed it: fetch-adp.js — the only script that freezes it — was
   guarded `tier == 'full'` while check-season.js, which fails the run over it,
   was guarded `tier != 'none'`.

   That is the third time in this repo a check has fired for a state the run
   could not produce, so it is worth a rule rather than a third fix: every
   script that SATISFIES an assertion must run on at least the tiers of the
   check that MAKES it.
   ═══════════════════════════════════════════════════════════════════════════ */

// Which tiers a step's `if:` admits. The workflow only ever uses these shapes;
// anything else should fail loudly rather than be guessed at.
function tiersFor(guard) {
  if (!guard) return new Set(['full', 'light']);
  const g = guard.replace(/always\(\)\s*&&\s*/, '').trim();
  if (/tier\s*!=\s*'none'/.test(g)) return new Set(['full', 'light']);
  if (/tier\s*==\s*'full'/.test(g)) return new Set(['full']);
  if (/tier\s*==\s*'light'/.test(g)) return new Set(['light']);
  throw new Error(`unrecognised tier guard, teach this test about it: ${guard}`);
}

function stepGuards(yml) {
  const out = new Map();
  // Steps are "- name: X" then optionally "if: ..." then "run: node scripts/y.js"
  const blocks = yml.split(/\n      - name: /).slice(1);
  for (const b of blocks) {
    const guard = (b.match(/\n        if:\s*(.+)/) || [])[1] || null;
    for (const m of b.matchAll(/node scripts\/([a-z-]+)\.js/g)) out.set(m[1], guard);
  }
  return out;
}

test('a check never demands something its own run was not allowed to do', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily-update.yml'), 'utf8');
  const guards = stepGuards(yml);

  // [the check that can fail, the script that is the only way to satisfy it]
  const PAIRS = [
    ['check-season', 'fetch-adp'],       // "the board has not been frozen"
    ['check-overrides', 'update-data'],  // overrides are applied by the update
    ['check-feeds', 'update-data'],      // meta.json is written by the update
  ];

  for (const [checker, fixer] of PAIRS) {
    if (!guards.has(checker) || !guards.has(fixer)) continue;
    const need = tiersFor(guards.get(checker));
    const can = tiersFor(guards.get(fixer));
    const unreachable = [...need].filter(t => !can.has(t));
    assert.deepStrictEqual(unreachable, [],
      `${checker}.js runs on [${[...need]}] but ${fixer}.js — the only thing that can satisfy it — `
      + `runs on [${[...can]}]. On a ${unreachable} run the check can fail and nothing could have prevented it.`);
  }
});

test('the tier guards in the workflow are ones this test understands', () => {
  // So that a new guard shape cannot slip past the rule above by being
  // unparseable rather than by being wrong.
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily-update.yml'), 'utf8');
  for (const [script, guard] of stepGuards(yml)) {
    assert.doesNotThrow(() => tiersFor(guard), `${script}.js has a guard the rule cannot read: ${guard}`);
  }
});

test('every per-season fetch knows a new season is not published on day one', () => {
  // THE FOURTH TIME. nflverse builds a season's files after its first games, so
  // between kickoff and that build a 404 for the current season is correct.
  // fetch-stats and fetch-injuries learned that on 09-04; fetch-ngs did not,
  // and on the first full build after the 2026 season began it took the whole
  // run down over snap_counts_2026.csv.
  //
  // The rule is in lib/season.js now, and this is what stops a fifth script
  // building a per-season URL without it.
  const offenders = [];
  for (const name of fs.readdirSync(SCRIPTS).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(SCRIPTS, name), 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // A URL built per season. THE FIRST VERSION OF THIS ANCHORED ON `http` and
    // therefore missed build-scheme, whose path is assembled from a `${base}`
    // variable — `${base}/pbp_participation/pbp_participation_${season}.csv` —
    // and which took the first full build after kickoff down over exactly that
    // file. Match the shape that matters instead: a season interpolated into
    // something that ends in a file extension.
    const perSeason = /\$\{season\}[^`'"]{0,40}\.(csv|json|gz|parquet)/.test(body)
      || /\bURL\(season\)/.test(body);
    if (!perSeason) continue;
    if (!/notPublishedYet/.test(body)) offenders.push(name);
  }
  assert.deepStrictEqual(offenders, [],
    `these fetch a file per season and would abort the run on the day a season starts, `
    + `before nflverse has published it: ${offenders.join(', ')}. Guard the catch with `
    + `seasonLib.notPublishedYet(season).`);
});

test('a completed season going missing is still fatal', () => {
  // The other half. The 2025 stats file 404'd for months after nflverse moved
  // the release and nothing said so. Tolerating THAT is the bug the tolerance
  // must not introduce.
  for (const name of ['fetch-stats.js', 'fetch-injuries.js', 'fetch-ngs.js', 'build-scheme.js']) {
    const src = fs.readFileSync(path.join(SCRIPTS, name), 'utf8');
    assert.match(src, /notPublishedYet/, `${name} lost the publication-lag guard`);
    assert.ok(/process\.exit\(1\)|throw e/.test(src),
      `${name} no longer fails on a season that IS published and missing`);
  }
});

test('no build reads a season window the fetches do not write', () => {
  // THE ROLLOVER PULLS TWO WINDOWS APART. fetch-stats writes dataSeasons(3),
  // which moves forward the day the season starts — [2023,2024,2025] becomes
  // [2024,2025,2026], so 2023 stops being written. build-rankings computed its
  // availability window separately, from lastCompletedSeason, and went on
  // asking for 2023. A season missing from the weekly logs reads as zero games
  // for every player, the league floor came out as 0, and the build aborted
  // over a window it had invented.
  //
  // Any window a build reads has to be derived from the window the fetches
  // write, or the two agree all year and disagree in September.
  const src = fs.readFileSync(path.join(SCRIPTS, 'build-rankings.js'), 'utf8');
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(body, /AVAIL_SEASONS\s*=\s*\(await season\.dataSeasons\(/,
    'the availability window must come from dataSeasons — the same source fetch-stats writes from');
  assert.ok(!/AVAIL_SEASONS\s*=\s*\[\s*last\s*-\s*2/.test(body),
    'the availability window is being computed independently of the data again');
});

test('the availability window stays inside the data at the rollover', async () => {
  const season = require('../scripts/lib/season');
  const inside = async (label) => {
    const data = await season.dataSeasons(3);
    const last = await season.lastCompletedSeason();
    const avail = data.filter(s => s <= last);
    assert.ok(avail.length >= 2, `${label}: only ${avail.length} completed season(s) on disk`);
    for (const s of avail) {
      assert.ok(data.includes(s), `${label}: availability wants ${s}, which the fetches do not write`);
    }
  };

  // Preseason: the windows agree.
  season.__setState({ season: 2026, previousSeason: 2025, week: 0, phase: 'pre',
                      seasonStartDate: '2026-09-09', source: 'test' });
  await inside('preseason');

  // The day it starts: dataSeasons moves and lastCompletedSeason does not.
  season.__setState({ season: 2026, previousSeason: 2025, week: 1, phase: 'regular',
                      seasonStartDate: '2026-09-01', source: 'test' });
  await inside('opening week');

  season.__reset();
});
