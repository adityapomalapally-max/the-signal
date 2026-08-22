#!/usr/bin/env node
/**
 * dry-run-rollover.js — play the first Sunday in September, in a sandbox.
 *
 * THE FAILURE THIS IS FOR HAS NO SYMPTOM. When the league year flips, every
 * fetch here goes on asking for the season it was told about, every build
 * succeeds, the site renders, and each number quietly belongs to last year.
 * `lib/season.js` exists so that the boundary is derived rather than
 * remembered, and `check-season.js` is the alarm — but neither has ever been
 * run against the actual pipeline on the actual day. An alarm that has never
 * been made to ring is a claim, not a guarantee.
 *
 * So: copy the repo somewhere disposable, tell it the season has flipped, run
 * the daily Action's steps in the Action's order, and classify what each one
 * does. There are only three outcomes and only one of them is dangerous:
 *
 *   OK      — it produced data for the new season.
 *   LOUD    — it failed and said so. Correct: nflverse has no 2026 file in
 *             August, and a fetch that cannot get this season's data MUST fail
 *             the run rather than leave last season's in place.
 *   NET     — it failed on a socket. Says nothing either way; this run pulls
 *             the same ~200MB from nflverse repeatedly and they do time out.
 *   QUIET   — it exited 0 and the file it wrote still describes the old
 *             season. This is the whole point of the exercise, and it found
 *             one: build-scheme carried its own calendar, read the season off
 *             the month, fetched 2025 while being told it was 2026, and
 *             printed "unchanged" five times on the way out.
 *
 * Then check-season is run against the sandbox, and it is expected to go RED.
 * A green alarm here would mean the alarm cannot see the failure it is for.
 *
 *   node scripts/dry-run-rollover.js            # week 1, regular season
 *   node scripts/dry-run-rollover.js --week 6
 *   node scripts/dry-run-rollover.js --keep     # leave the sandbox on disk
 *
 * Nothing it does can reach data/: it runs entirely inside a temp copy, and
 * lib/season.js refuses a simulated calendar in CI.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const KEEP = args.includes('--keep');
const WEEK = Number((args[args.indexOf('--week') + 1] || 1)) || 1;

// The season the simulated calendar claims to be in. Derived from the repo's
// own idea of the target season so this does not become another hand-typed
// boundary — the exact thing lib/season.js was written to abolish.
const season = require('./lib/season');

// The Action's steps, in the Action's order, read from the workflow rather
// than copied out of it: a step added there and not here would be a step this
// never tests, and the divergence would be silent.
function workflowSteps() {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily-update.yml'), 'utf8');
  return [...yml.matchAll(/node scripts\/([a-z-]+)\.js([^\n]*)/g)].map(m => ({
    script: m[1],
    args: m[2].trim().split(/\s+/).filter(Boolean),
  }));
}

// Which season a generated file says it is about. Each layer states it
// differently, which is itself the reason a single check cannot be written.
function seasonsIn(json) {
  const out = new Set();
  const meta = json && json.meta;
  if (meta) {
    if (meta.season) out.add(String(meta.season));
    if (Array.isArray(meta.seasons)) meta.seasons.forEach(s => out.add(String(s)));
    if (meta.statsSeason) out.add(String(meta.statsSeason));
  }
  for (const [k, v] of Object.entries(json || {})) {
    if (k === 'meta' || !v || typeof v !== 'object') continue;
    for (const kk of Object.keys(v)) if (/^\d{4}$/.test(kk)) out.add(kk);
    if (v.seasons && typeof v.seasons === 'object') {
      for (const kk of Object.keys(v.seasons)) if (/^\d{4}$/.test(kk)) out.add(kk);
    }
  }
  return [...out].sort();
}

function snapshotSeasons(dataDir) {
  const out = {};
  for (const f of fs.readdirSync(dataDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      out[f] = seasonsIn(JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')));
    } catch (e) { /* not every file is an object; it is not evidence either way */ }
  }
  return out;
}

async function main() {
  const target = await season.targetSeason();
  const state = JSON.stringify({ season: target, week: WEEK, phase: 'regular' });

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-rollover-'));
  console.log(`[dry-run] sandbox: ${sandbox}`);
  for (const dir of ['scripts', 'data', '.github']) {
    fs.cpSync(path.join(ROOT, dir), path.join(sandbox, dir), { recursive: true });
  }
  const dataDir = path.join(sandbox, 'data');
  const before = snapshotSeasons(dataDir);

  console.log(`[dry-run] the league is now: ${target} regular week ${WEEK}\n`);

  const results = [];
  for (const step of workflowSteps()) {
    const file = path.join(sandbox, 'scripts', `${step.script}.js`);
    if (!fs.existsSync(file)) continue;
    let code = 0, out = '';
    const started = Date.now();
    try {
      out = execFileSync(process.execPath, [file, ...step.args], {
        cwd: sandbox,
        env: { ...process.env, SIGNAL_SEASON_STATE: state, CI: '', GITHUB_ACTIONS: '' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20 * 60 * 1000,
      });
    } catch (e) {
      code = e.status === undefined ? 1 : e.status;
      out = `${e.stdout || ''}${e.stderr || ''}`;
    }
    results.push({ ...step, code, out, secs: Math.round((Date.now() - started) / 1000) });
    console.log(`  ${code === 0 ? '·' : '✗'} ${step.script} (${Math.round((Date.now() - started) / 1000)}s)${code ? ` exit ${code}` : ''}`);
  }

  // ---- Classify -----------------------------------------------------------
  const after = snapshotSeasons(dataDir);
  const y = String(target);
  const rows = [];
  for (const r of results) {
    const touched = Object.keys(after).filter(f => JSON.stringify(after[f]) !== JSON.stringify(before[f] || []));
    let verdict;
    // A download that timed out says nothing about the rollover, and reading it
    // as a finding is how a flaky afternoon turns into a bug report. This run
    // pulls ~200MB from nflverse several times over, so it happens.
    const networky = /ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed/i.test(r.out || '');
    if (r.code !== 0 && networky) verdict = 'NET';
    else if (r.code !== 0) verdict = 'LOUD';
    else {
      // Did anything this run wrote come to include the new season?
      const gained = touched.some(f => after[f].includes(y) && !(before[f] || []).includes(y));
      verdict = gained ? 'OK' : 'QUIET';
    }
    rows.push({ script: r.script, code: r.code, verdict, secs: r.secs, tail: (r.out || '').trim().split('\n').slice(-3).join(' | ').slice(0, 180) });
  }

  console.log(`\n${'='.repeat(78)}\nSTEP OUTCOMES`);
  for (const r of rows) console.log(`  ${r.verdict.padEnd(6)} ${r.script.padEnd(24)} ${r.code ? 'exit ' + r.code : ''}  ${r.tail}`);

  console.log(`\n${'='.repeat(78)}\nWHICH LAYERS NOW CONTAIN ${y}`);
  for (const f of Object.keys(after).sort()) {
    const b = (before[f] || []).join(','), a = after[f].join(',');
    if (b !== a) console.log(`  ${f.padEnd(26)} ${b || '—'}  ->  ${a || '—'}`);
  }
  const stuck = Object.keys(after)
    .filter(f => (before[f] || []).length && !after[f].includes(y) && after[f].length);
  if (stuck.length) {
    console.log(`\n  still with no ${y} in them (expected for anything the fetches could not get):`);
    for (const f of stuck) console.log(`    ${f} — ${after[f].join(',')}`);
  }

  // ---- The alarm has to ring ---------------------------------------------
  console.log(`\n${'='.repeat(78)}\nTHE ALARM`);
  let alarmCode = 0, alarmOut = '';
  try {
    alarmOut = execFileSync(process.execPath, [path.join(sandbox, 'scripts', 'check-season.js')], {
      cwd: sandbox,
      env: { ...process.env, SIGNAL_SEASON_STATE: state, CI: '', GITHUB_ACTIONS: '' },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    alarmCode = e.status || 1;
    alarmOut = `${e.stdout || ''}${e.stderr || ''}`;
  }
  console.log(alarmOut.trim().split('\n').map(l => '  ' + l).join('\n'));
  console.log(`\n  check-season exit ${alarmCode} — ${alarmCode ? 'RED, which is correct: it can see the rollover' : 'GREEN, which means the alarm cannot see what just happened'}`);

  if (KEEP) console.log(`\n[dry-run] sandbox kept at ${sandbox}`);
  else { fs.rmSync(sandbox, { recursive: true, force: true }); console.log('\n[dry-run] sandbox removed'); }
}

main();
