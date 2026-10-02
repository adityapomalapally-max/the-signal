#!/usr/bin/env node
/**
 * mutate.js — does the suite actually check anything?
 *
 * THE FAILURE THIS EXISTS FOR is not an untested line. It is a test written
 * from the same wrong idea as the code, which passes forever and proves
 * nothing. Three of those shipped in one day:
 *
 *   - the draft grade's value sign was inverted, and its test asserted the
 *     inversion in English: "taken at 1 with an ADP of 12 is eleven picks of
 *     value". Both were wrong in the same direction, so the test was green.
 *   - lastCompletedSeason() named an unplayed season in the offseason, and the
 *     test pinned `at('off', 2027) -> 2027`, which IS the bug.
 *   - the CSP check searched the whole policy for 'unsafe-inline' instead of
 *     the script-src directive, so it could not tell that its own subject had
 *     been fixed.
 *
 * Coverage cannot see any of that: every one of those lines was executed by a
 * passing test. The question coverage does not ask is whether the test would
 * have NOTICED had the line been wrong.
 *
 * So: change the code on purpose, one edit at a time — a minus for a plus, a
 * >= for a >, a true for a false — and run the suite. If the suite still
 * passes, that edit is a hole. Either nothing checks the behaviour, or
 * something checks it in the same wrong terms.
 *
 *   node scripts/mutate.js                  # the derived-number libraries
 *   node scripts/mutate.js --budget 40      # cap the run
 *   node scripts/mutate.js --files scripts/lib/season.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? dflt : argv[i + 1];
};

// The files where a wrong character changes a published number. Rendering code
// is deliberately out of scope: a mutant there usually breaks a snapshot, which
// says nothing about whether the maths is checked.
const DEFAULT_FILES = [
  'scripts/lib/season.js',
  'scripts/lib/schedule.js',   // the week clock: build-ros and build-sos both read it
  'scripts/lib/scoring.js',    // where touchdowns come from: a bettor reads this one
  'scripts/lib/status.js',
  'scripts/lib/match.js',
  'scripts/lib/overrides.js',
  'scripts/lib/weekly.js',
  'scripts/lib/rushing.js',
  'scripts/lib/cadence.js',
  'scripts/lib/fieldmap.js',
];

/**
 * Which characters are real code — not inside a string, a comment or a
 * template. Mutating "the season is under way" into "the season is under wag"
 * would be a survivor that means nothing, and there would be thousands of them.
 * Template literals are skipped whole: conservative, and it costs only mutants.
 */
function codeMask(src) {
  const mask = new Array(src.length).fill(true);
  let i = 0;
  const mark = (from, to) => { for (let k = from; k < to && k < src.length; k++) mask[k] = false; };
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e === -1 ? src.length : e; mark(i, end); i = end; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e === -1 ? src.length : e + 2; mark(i, end); i = end; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j++;
      }
      mark(i, j + 1); i = j + 1; continue;
    }
    i++;
  }
  return mask;
}

// Each rule is [what to find, what to put there, a human name]. They are chosen
// so that every one CHANGES BEHAVIOUR — a mutant that cannot change an output
// is a survivor that teaches nothing.
const RULES = [
  ['>=', '>', 'boundary'], ['<=', '<', 'boundary'],
  ['===', '!==', 'equality'], ['!==', '===', 'equality'],
  ['&&', '||', 'logic'], ['||', '&&', 'logic'],
  ['true', 'false', 'constant'], ['false', 'true', 'constant'],
];
// Single characters need a look-around so `+=`, `->` and `=>` are left alone.
const CHAR_RULES = [
  ['+', '-', 'arithmetic'], ['-', '+', 'arithmetic'],
  ['>', '<', 'comparison'], ['<', '>', 'comparison'],
];

function mutantsFor(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const mask = codeMask(src);
  const out = [];
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;

  for (const [find, repl, kind] of RULES) {
    let from = 0;
    for (;;) {
      const at = src.indexOf(find, from);
      if (at === -1) break;
      from = at + 1;
      if (!mask[at]) continue;
      // Do not match a longer operator's prefix (>= inside >==, === inside ====)
      const before = src[at - 1] || '', after = src[at + find.length] || '';
      if (/[=<>&|!]/.test(before) || /[=<>&|]/.test(after)) continue;
      if (/[A-Za-z0-9_$]/.test(before) || /[A-Za-z0-9_$]/.test(after)) continue;
      out.push({ file, index: at, len: find.length, from: find, to: repl, kind, line: lineOf(at) });
    }
  }
  for (const [find, repl, kind] of CHAR_RULES) {
    for (let at = 0; at < src.length; at++) {
      if (src[at] !== find || !mask[at]) continue;
      const before = src[at - 1] || '', after = src[at + 1] || '';
      if (/[=+\-<>*/&|]/.test(before) || /[=+\-<>&|]/.test(after)) continue;  // += -- => >= etc
      out.push({ file, index: at, len: 1, from: find, to: repl, kind, line: lineOf(at) });
    }
  }
  return out;
}

// The test files are enumerated rather than passed as a directory or a glob:
// there is no shell here to expand `tests/*.test.js`, and `node --test tests/`
// resolves the directory as a module and fails before running anything — which
// looks exactly like "the suite is broken".
const TEST_FILES = fs.readdirSync(path.join(ROOT, 'tests'))
  .filter(f => f.endsWith('.test.js')).map(f => path.join('tests', f));

/* ═══════════════════════════════════════════════════════════════════════════
   A KILLED RUN MUST NOT LEAVE A LIVE MUTANT IN THE REPO
   ═══════════════════════════════════════════════════════════════════════════

   This file edits scripts/lib/*.js in place and restores them in a `finally`.
   A `finally` does not run when the process is SIGKILLed — and on 2026-10-01
   and 10-02 that happened three times, because the machine kept sleeping and
   the system killed the run for memory. Each time it left one mutant sitting in
   a library:

     lib/fieldmap.js   >= 300  ->  > 300
     lib/weekly.js     typeof v !== 'number'  ->  === 'number'   (nulls every rounded figure)
     lib/season.js     phase !== 'regular' ? false  ->  true      (off-season reads as live)

   All three were caught by running `git status` at the right moment, which is
   luck wearing the clothes of a process. The last one would have told the whole
   site that games had started in February.

   So the run now leaves a note on disk naming the files it is about to touch.
   If that note is still there next time, the previous run died without
   restoring, and the first thing this one does is put those files back.

   The note is NOT a lock: two runs at once are not the failure being prevented,
   and a lock that outlives a crash is the same trap one level up.

   IT LIVES IN .git/ AND IT IS NOT JSON. Both on purpose. Inside .git it can
   never be committed, never show in `git status`, and never trip a test that
   reads the repo's contents — a crash marker that can itself be mistaken for
   data is not an improvement. And writing it as JSON made `mutate.js` an
   offender against this repo's own rule that every JSON write in a daily script
   goes through writeJSONIfChanged, which is how the suite caught the first
   version of this file within a minute. Plain lines instead. */
const SENTINEL = path.join(ROOT, '.git', 'mutate-in-flight');

/** The file list out of the note, comments and blank lines dropped. */
function parseSentinel(text) {
  return String(text || '').split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

/** Restore anything a previous killed run left mutated, and say so loudly. */
function healFromPreviousRun() {
  if (!fs.existsSync(SENTINEL)) return [];
  let files = [];
  try {
    files = parseSentinel(fs.readFileSync(SENTINEL, 'utf8'));
  } catch (e) {
    files = [];
  }
  const healed = [];
  for (const f of files) {
    try {
      execFileSync('git', ['checkout', '--', f], { cwd: ROOT, stdio: 'ignore' });
      healed.push(f);
    } catch (e) {
      console.error(`[mutate] could not restore ${f}: ${e.message}`);
    }
  }
  fs.unlinkSync(SENTINEL);
  if (healed.length) {
    console.error('');
    console.error('[mutate] A PREVIOUS RUN WAS KILLED WITHOUT RESTORING. These files were put back');
    console.error('         from git before this run started — if you had uncommitted edits in them,');
    console.error('         they are gone and that is the lesser of the two losses:');
    for (const f of healed) console.error(`           ${f}`);
    console.error('');
  }
  return healed;
}

/** Refuse to measure a tree somebody is in the middle of editing. */
function dirtyLibs(files) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', ...files],
                             { cwd: ROOT, encoding: 'utf8' });
    return out.split('\n').map(l => l.slice(3).trim()).filter(Boolean);
  } catch (e) {
    return [];                                  // not a git checkout: nothing to compare against
  }
}

function runSuite() {
  try {
    execFileSync('node', ['--test', ...TEST_FILES], { cwd: ROOT, stdio: 'ignore', timeout: 120000 });
    return true;   // suite passed => the mutant lived
  } catch {
    return false;  // suite failed => the mutant was caught
  }
}

function main() {
  const files = (arg('files') || DEFAULT_FILES.join(',')).split(',').filter(Boolean);
  const budget = Number(arg('budget', '0')) || 0;
  const seed = Number(arg('seed', '7'));

  let all = [];
  for (const f of files) {
    if (!fs.existsSync(path.join(ROOT, f))) { console.error(`[mutate] no such file: ${f}`); continue; }
    all.push(...mutantsFor(f));
  }

  // Deterministic shuffle, so a budgeted run is a fair sample rather than the
  // top of the first file, and the same sample every time.
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  all.sort((a, b) => (a.file + a.index).localeCompare(b.file + b.index));
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  const chosen = budget ? all.slice(0, budget) : all;

  healFromPreviousRun();

  // A MUTATION SCORE OFF A DIRTY TREE MEASURES SOMEBODY'S WORK IN PROGRESS, not
  // the suite. It is also how a half-finished edit gets blamed on the ratchet.
  const dirty = dirtyLibs(files);
  if (dirty.length && !argv.includes('--allow-dirty')) {
    console.error(`[mutate] these library files have uncommitted changes, so a score would not `
      + `describe the committed suite:`);
    for (const f of dirty) console.error(`           ${f}`);
    console.error('         Commit or stash them, or pass --allow-dirty if you meant it.');
    process.exit(2);
  }

  fs.writeFileSync(SENTINEL,
    `# mutate.js started ${new Date().toISOString()} as pid ${process.pid}\n`
    + `# if this file still exists, that run died without restoring these:\n`
    + files.join('\n') + '\n');

  console.log(`[mutate] ${all.length} mutants available across ${files.length} files; running ${chosen.length}`);
  if (!runSuite()) {
    console.error('[mutate] the suite fails before any mutation — fix that first');
    if (fs.existsSync(SENTINEL)) fs.unlinkSync(SENTINEL);
    process.exit(2);
  }

  const survivors = [];
  const originals = new Map();
  const restore = () => { for (const [f, txt] of originals) fs.writeFileSync(path.join(ROOT, f), txt); };
  process.on('SIGINT', () => {
    restore();
    if (fs.existsSync(SENTINEL)) fs.unlinkSync(SENTINEL);
    process.exit(130);
  });

  try {
    for (const [n, m] of chosen.entries()) {
      if (!originals.has(m.file)) originals.set(m.file, fs.readFileSync(path.join(ROOT, m.file), 'utf8'));
      const src = originals.get(m.file);
      const mutated = src.slice(0, m.index) + m.to + src.slice(m.index + m.len);
      fs.writeFileSync(path.join(ROOT, m.file), mutated);
      const lived = runSuite();
      fs.writeFileSync(path.join(ROOT, m.file), src);
      if (lived) survivors.push(m);
      if ((n + 1) % 25 === 0) process.stderr.write(`  ...${n + 1}/${chosen.length}\n`);
    }
  } finally {
    restore();
    // The note goes only when the restore it describes has actually happened.
    if (fs.existsSync(SENTINEL)) fs.unlinkSync(SENTINEL);
  }

  const caught = chosen.length - survivors.length;
  const score = chosen.length ? (100 * caught / chosen.length) : 100;

  // THE RATCHET. Under --strict the run fails when the suite catches FEWER
  // mutants than it used to, on the same seeded sample. It is deliberately not
  // a target: the point is to notice the suite getting weaker — an assertion
  // deleted, a boundary loosened, a real check swapped for one that cannot
  // fail — not to chase a percentage. See tests/mutation-baseline.json.
  // THE SURVIVORS COME FIRST, BECAUSE THE REGRESSION PATH EXITS.
  //
  // This printed the verdict and then the survivor list, and `process.exit(1)`
  // on a regression happened in between — so the one run where somebody needs to
  // know WHICH mutant stopped dying printed a message saying "the survivors above
  // say where" above nothing at all. CI did exactly that on 2026-10-02 and the
  // list was unrecoverable from the log.
  const report = () => {
    console.log('');
    console.log(`[mutate] caught ${caught}/${chosen.length}  (${score.toFixed(1)}%)`);
    if (!survivors.length) return;
    console.log('');
    console.log('        SURVIVORS — the suite did not notice these edits:');
    const byFile = {};
    for (const m of survivors) (byFile[m.file] ||= []).push(m);
    for (const [f, list] of Object.entries(byFile)) {
      console.log(`        ${f}`);
      for (const m of list.sort((a, b) => a.line - b.line)) {
        console.log(`          line ${String(m.line).padStart(4)}  ${m.kind.padEnd(11)} ${m.from} -> ${m.to}`);
      }
    }
  };
  report();

  const baselinePath = path.join(ROOT, 'tests', 'mutation-baseline.json');
  let baseline = null;
  if (fs.existsSync(baselinePath)) baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  if (argv.includes('--strict') && baseline) {
    if (baseline.budget !== chosen.length || baseline.seed !== seed) {
      console.error(`[mutate] --strict needs the recorded sample: --budget ${baseline.budget} --seed ${baseline.seed}`);
      process.exit(2);
    }
    // THE SAMPLE CAN RE-ROLL WITHOUT THE BUDGET OR THE SEED CHANGING, and then
    // the recorded number describes 60 different mutants. The shuffle runs over
    // the whole pool, so ONE operator added or removed anywhere in the lib files
    // moves which 60 get run — it happened on 2026-09-26 (224 -> 236 mutants,
    // caught 36 -> 30) and nothing said so; the drop looks exactly like a suite
    // that has got weaker, and the fix for that is to lower the baseline, which
    // is the one thing this file exists to prevent. So it says so out loud.
    if (baseline.pool && baseline.pool !== all.length) {
      console.error('');
      console.error(`[mutate] THE SAMPLE IS NOT THE RECORDED ONE: ${all.length} mutants available, baseline was drawn from ${baseline.pool}.`);
      console.error('         The count below is not comparable with the recorded one, in either direction.');
      console.error('         Re-measure and re-record pool + caught before reading anything into the number.');
      console.error('');
    }
    if (caught < baseline.caught) {
      console.error('');
      console.error(`[mutate] REGRESSION: the suite used to catch ${baseline.caught} of these ${chosen.length}, it now catches ${caught}.`);
      console.error('         Something that was checked is no longer checked. The survivor list above says where.');
      process.exit(1);
    }
    if (caught > baseline.caught) {
      console.log('');
      console.log(`[mutate] the suite got stronger: ${baseline.caught} -> ${caught}. Raise "caught" in tests/mutation-baseline.json.`);
    }
  }
  process.exit(0);
}

// SAME GUARD build-scheme.js GOT TODAY, for the same reason: requiring this file
// ran it, and running it means editing every library in place for forty minutes.
// A test that wants to check the crash guard should not have to launch the gate.
if (require.main === module) {
  main();
}

module.exports = { parseSentinel, SENTINEL };
