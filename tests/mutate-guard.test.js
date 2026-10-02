/**
 * The ratchet's own crash guard.
 *
 * scripts/mutate.js edits scripts/lib/*.js IN PLACE and restores them in a
 * `finally`. A `finally` does not run under SIGKILL, and on 2026-10-01 and 10-02
 * the machine kept sleeping and the system killed the run three times. Each kill
 * left one live mutant in a library:
 *
 *   lib/fieldmap.js   >= 300 -> > 300
 *   lib/weekly.js     typeof v !== 'number' -> === 'number'   (nulls every rounded figure)
 *   lib/season.js     phase !== 'regular' ? false -> true      (the off-season reads as live)
 *
 * All three were caught by running `git status` at the right moment, which is
 * luck rather than a control — the last one would have told the whole site that
 * games had started in February.
 *
 *   node --test tests/mutate-guard.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'mutate.js'), 'utf8');
const { parseSentinel, SENTINEL } = require('../scripts/mutate.js');

test('the note names the files, and says nothing else', () => {
  const text = [
    '# mutate.js started 2026-10-02T23:00:00.000Z as pid 4242',
    '# if this file still exists, that run died without restoring these:',
    'scripts/lib/season.js',
    'scripts/lib/weekly.js',
    '',
  ].join('\n');
  assert.deepStrictEqual(parseSentinel(text), ['scripts/lib/season.js', 'scripts/lib/weekly.js']);
});

test('an empty or absent note heals nothing rather than throwing', () => {
  // The common case is no note at all, and it must be the quiet one.
  assert.deepStrictEqual(parseSentinel(''), []);
  assert.deepStrictEqual(parseSentinel(undefined), []);
  assert.deepStrictEqual(parseSentinel('# only comments\n\n'), []);
});

test('the note lives inside .git, where it cannot be committed or scanned', () => {
  // A crash marker in the working tree is a file that can be committed by
  // accident, shows up in `git status` next to real work, and — the first
  // version of this did exactly that — trips the repo's own test that every
  // JSON write in a daily script goes through writeJSONIfChanged.
  assert.ok(SENTINEL.includes(`${path.sep}.git${path.sep}`),
    `the sentinel is at ${SENTINEL}, which is in the working tree`);
  assert.ok(!/fs\.writeFileSync\([^)]*JSON\.stringify/.test(SRC),
    'mutate.js writes JSON directly, which is the rule it is itself scanned for');
});

test('it heals before it measures, and clears the note only after restoring', () => {
  // Order is the whole mechanism: healing after the pre-flight would measure a
  // poisoned tree, and clearing the note before the restore would lose the list.
  const healAt = SRC.indexOf('healFromPreviousRun();');
  const writeAt = SRC.indexOf('fs.writeFileSync(SENTINEL');
  const suiteAt = SRC.indexOf('if (!runSuite())');
  assert.ok(healAt > 0 && writeAt > 0 && suiteAt > 0, 'the guard is not wired into main');
  assert.ok(healAt < writeAt, 'it writes a new note before healing the old one');
  assert.ok(writeAt < suiteAt, 'it measures before leaving a note, so a kill mid-suite leaves nothing');
  assert.match(SRC, /restore\(\);\s*\n\s*\/\/[\s\S]{0,120}?unlinkSync\(SENTINEL\)/,
    'the note is cleared somewhere other than immediately after the restore it describes');
});

test('a dirty library refuses the run, and only an explicit flag overrides it', () => {
  // A score off a half-finished edit describes somebody's work in progress, and
  // it is also how that edit gets blamed on the ratchet.
  assert.match(SRC, /dirtyLibs\(files\)/, 'nothing checks for uncommitted library changes');
  assert.match(SRC, /--allow-dirty/, 'there is no way to say you meant it');
  assert.match(SRC, /dirty\.length && !argv\.includes\('--allow-dirty'\)/,
    'the refusal is not conditional on the override');
});

test('requiring mutate.js does not start a forty-minute gate', () => {
  assert.match(SRC, /require\.main === module/, 'requiring mutate.js runs the whole gate');
  assert.match(SRC, /require\.main === module\s*\)\s*\{[\s\S]{0,80}main\(\)/,
    'the guard exists but main() is called outside it');
});

test('the survivor list is printed before any verdict, because the verdict exits', () => {
  // CI, 2026-10-02: "REGRESSION ... The survivors above say where" printed above
  // nothing at all, because process.exit(1) ran before the survivor report. The
  // one run where somebody needs to know WHICH mutant stopped dying was the one
  // run that would not tell them, and the list was unrecoverable from the log.
  const reportAt = SRC.indexOf('report();');
  const strictAt = SRC.indexOf("argv.includes('--strict')");
  // THE MESSAGE, NOT THE WORD. The first version of this test searched for
  // 'REGRESSION' and matched the comment explaining the fix, which sat above the
  // code — so it failed while the code was right. A test that can be satisfied
  // or broken by prose is testing prose.
  const exitAt = SRC.indexOf('REGRESSION: the suite used to catch');
  assert.ok(reportAt > 0 && strictAt > 0 && exitAt > 0, 'the report or the ratchet is gone');
  assert.ok(reportAt < strictAt, 'the verdict is reached before the survivors are printed');
  assert.ok(reportAt < exitAt, 'a regression still exits before naming the survivors');
});

test('the baseline records the pool it was drawn from', () => {
  // Without `pool` the recorded count silently describes a different 60 the next
  // time anybody adds an operator to a lib file.
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'mutation-baseline.json'), 'utf8'));
  for (const key of ['budget', 'seed', 'caught', 'pool', 'recorded']) {
    assert.ok(baseline[key] !== undefined, `the baseline has no ${key}`);
  }
  assert.ok(typeof baseline.pool === 'number' && baseline.pool > baseline.budget,
    'the pool must be a count larger than the sample drawn from it');
  // And it must explain itself: every change to this number since September has
  // needed a sentence, and the sentences are why nobody lowered it by reflex.
  assert.ok(Object.keys(baseline).some(k => k.startsWith('_why')),
    'the baseline changed without a note saying why');
});
