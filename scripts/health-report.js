#!/usr/bin/env node

/**
 * health-report.js — the checks that run when nothing else is running.
 *
 * WHY THIS IS NOT check-feeds.js. Every check in the daily Action runs INSIDE
 * the job that just built the data, against the runner's working tree. That is
 * the right place for most of them and it is exactly wrong for one question:
 * "is the site actually up to date?"
 *
 * From 2026-08-29 to 2026-09-04 the Action failed eleven times running and
 * committed nothing. check-feeds.js reported, on every one of those runs:
 *
 *     last update:   2026-09-04T14:52:42.823Z (0h ago)
 *     OK — every source reported in.
 *
 * It was telling the truth about a file that had been written ninety seconds
 * earlier and would never be committed. The data a reader could actually see
 * was seven days old. A check that reads the artefact it just produced cannot
 * see the failure that matters, and a green tick on that check is worse than no
 * check, because somebody believed it.
 *
 * So everything here is asked from OUTSIDE the pipeline:
 *   - the published site, over HTTP, the way a reader gets it
 *   - the repository's commit history, not the working tree
 *   - the Actions API, not the run this is part of
 *
 * It reports rather than blocks, and it goes red only for things that are
 * actually wrong, because an alarm that cries on a normal day is one people
 * learn to scroll past — the lesson from check-season.js firing for eleven days
 * about a season that had not started.
 *
 *   node scripts/health-report.js            # markdown to stdout
 *   node scripts/health-report.js --quiet    # exit code only
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ORIGIN } = require('./lib/site');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');

// The full build runs daily at 11:00 UTC and takes ~7 minutes. Anything past a
// day and a half means at least one build did not land, which is a real event
// and not a slow morning.
const STALE_WARN_H = 30;
const STALE_FAIL_H = 48;

const results = [];
const add = (level, area, line, detail) => results.push({ level, area, line, detail });
const ok = (a, l, d) => add('ok', a, l, d);
const warn = (a, l, d) => add('warn', a, l, d);
const fail = (a, l, d) => add('fail', a, l, d);

const hoursSince = (iso) => (Date.now() - new Date(iso).getTime()) / 36e5;
const fmtAge = (h) => h < 48 ? `${h.toFixed(1)}h` : `${Math.floor(h / 24)}d`;

async function get(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeout || 15000);
  try {
    return await fetch(url, { signal: ctl.signal, redirect: 'follow', ...opts });
  } finally {
    clearTimeout(t);
  }
}

/* ── 1. What a reader actually sees ─────────────────────────────────────── */
async function checkPublished() {
  let res;
  try {
    res = await get(`${ORIGIN}/data/meta.json`);
  } catch (e) {
    return fail('published', `the live site did not answer — ${e.message}`,
      'Nothing below this line has been checked against what readers get.');
  }
  if (!res.ok) {
    return fail('published', `${ORIGIN}/data/meta.json returned ${res.status}`);
  }

  let meta;
  try { meta = await res.json(); } catch (e) {
    return fail('published', `the published meta.json is not valid JSON — ${e.message}`);
  }

  if (!meta.lastUpdate) return fail('published', 'the published meta.json has no lastUpdate');

  const age = hoursSince(meta.lastUpdate);
  const when = `last built ${fmtAge(age)} ago (${meta.lastUpdate})`;
  if (age > STALE_FAIL_H) {
    fail('published', `THE LIVE SITE IS STALE — ${when}`,
      'A build has not reached readers in over two days. Check the Daily Data Update runs.');
  } else if (age > STALE_WARN_H) {
    warn('published', `the live site is getting old — ${when}`);
  } else {
    ok('published', `live data is current — ${when}`);
  }

  const failures = Array.isArray(meta.fetchFailures) ? meta.fetchFailures : [];
  if (failures.length) {
    warn('published', `${failures.length} feed(s) failed in the published build`,
      failures.map(f => `${f.source}: ${f.message}`).join('\n'));
  }
  return undefined;
}

/* ── 2. Did the data actually get COMMITTED ─────────────────────────────── */
// The check that would have caught the outage on day two. A run can go green
// and commit nothing; a run can go red having already pushed. Only the commit
// log knows which happened.
async function checkCommits() {
  // ASK GITHUB, NOT THE CLONE IN FRONT OF US. The first draft of this file read
  // `git log` in the working tree and reported five dead history series and a
  // 44-hour-old commit — on a repository whose scheduled runs were all green.
  // The clone was three commits behind, and the check had reproduced the exact
  // mistake described at the top of this file: judging the world by the copy
  // nearest to hand. In CI the checkout is fresh and the two agree; the point is
  // that the check must not DEPEND on that being true.
  let last = await lastRemoteDataCommit();
  let source = 'github';
  if (!last) {
    try {
      last = execFileSync('git', ['log', '-1', '--format=%cI', '--', 'data/'],
        { cwd: ROOT }).toString().trim();
      source = 'local clone (unverified against origin)';
    } catch (e) {
      return warn('commits', `could not read the commit log — ${e.message}`);
    }
  }
  if (!last) return fail('commits', 'no commit has ever touched data/');

  const age = hoursSince(last);
  if (age > STALE_FAIL_H) {
    fail('commits', `NO DATA COMMIT IN ${fmtAge(age)} (last ${last.slice(0, 16)})`,
      'The pipeline is running and producing nothing, or not running at all.');
  } else if (age > STALE_WARN_H) {
    warn('commits', `last data commit was ${fmtAge(age)} ago`);
  } else {
    ok('commits', `data committed ${fmtAge(age)} ago (via ${source})`);
  }
  return undefined;
}

// The most recent commit that touched data/, as the world sees it.
async function lastRemoteDataCommit() {
  const token = ghToken();
  if (!token) return null;
  const repo = process.env.GITHUB_REPOSITORY || 'adityapomalapally-max/the-signal';
  try {
    const res = await get(`https://api.github.com/repos/${repo}/commits?path=data&per_page=1`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const j = await res.json();
    return j[0] && j[0].commit && j[0].commit.committer && j[0].commit.committer.date || null;
  } catch { return null; }
}

/* ── 3. The series that cannot be backfilled ────────────────────────────── */
// build-history.js appends one row per day. Seven days of adp, depth, rankings
// and trending were lost in the 2026 outage and cannot be recovered from any
// feed — nothing publishes what a board looked like last Tuesday.
async function checkHistory() {
  const dir = path.join(DATA, 'history');
  if (!fs.existsSync(dir)) return fail('history', 'data/history/ is missing entirely');

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
  if (!files.length) return fail('history', 'data/history/ has no series in it');

  const stale = [];
  for (const f of files) {
    // The PUBLISHED series, for the same reason as everything else here. Only
    // the last row matters, so ask for the tail rather than the file — these
    // grow without limit and the answer is in the final 4KB.
    const lines = await tailPublished(`data/history/${f}`)
      || fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean);
    if (!lines.length) { stale.push(`${f} is empty`); continue; }
    let row;
    try { row = JSON.parse(lines[lines.length - 1]); } catch { stale.push(`${f} ends in unreadable JSON`); continue; }
    const date = row.date || row.day;
    if (!date) { stale.push(`${f} has no date on its last row`); continue; }
    if (rowIsStale(row)) stale.push(`${f} last gained a row on ${date} (${Math.floor(daysSinceRow(row))}d ago)`);
  }

  if (stale.length) {
    fail('history', `${stale.length} of ${files.length} history series have stopped growing`,
      stale.join('\n') + '\nThese days cannot be backfilled from any feed.');
  } else {
    ok('history', `all ${files.length} history series are current`);
  }
  return undefined;
}

function daysSinceRow(row, now = Date.now()) {
  const date = row.date || row.day;
  return (now - new Date(`${date}T12:00:00Z`).getTime()) / 864e5;
}

// A FROZEN SERIES IS A DECISION, NOT A FAULT. adp stops on purpose when the
// draft market closes and says so in the row it wrote; treating that as a dead
// series would put a permanent red mark on the report every season from
// September onward, which is how a report stops being read.
function rowIsStale(row, now = Date.now()) {
  return daysSinceRow(row, now) > 2 && !row.frozen;
}

// A Range request for the tail. If the host ignores Range it sends the whole
// file and the last line is still the last line, so this degrades into being
// merely wasteful rather than wrong. The final line may be a fragment when the
// range lands mid-row, so it is dropped unless it parses.
async function tailPublished(relPath) {
  try {
    const res = await get(`${ORIGIN}/${relPath}`, { headers: { Range: 'bytes=-4096' } });
    if (!res.ok && res.status !== 206) return null;
    const body = await res.text();
    const lines = body.trim().split('\n').filter(Boolean);
    while (lines.length) {
      try { JSON.parse(lines[lines.length - 1]); break; } catch { lines.pop(); }
    }
    return lines.length ? lines : null;
  } catch { return null; }
}

/* ── 4. Are the scheduled runs even passing ─────────────────────────────── */
async function checkRuns() {
  const token = ghToken();
  if (!token) return warn('runs', 'no GitHub token available, so run history was not checked');

  const repo = process.env.GITHUB_REPOSITORY || 'adityapomalapally-max/the-signal';
  let runs;
  try {
    const res = await get(
      `https://api.github.com/repos/${repo}/actions/runs?event=schedule&per_page=15`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
    if (!res.ok) return warn('runs', `the Actions API returned ${res.status}`);
    runs = (await res.json()).workflow_runs || [];
  } catch (e) {
    return warn('runs', `could not reach the Actions API — ${e.message}`);
  }

  const done = runs.filter(r => r.status === 'completed');
  if (!done.length) return warn('runs', 'no completed scheduled runs to judge');

  let streak = 0;
  for (const r of done) { if (r.conclusion === 'failure') streak++; else break; }

  const recent = done.slice(0, 10);
  const failed = recent.filter(r => r.conclusion === 'failure').length;

  if (streak >= 2) {
    fail('runs', `${streak} scheduled runs have failed IN A ROW`,
      done.slice(0, streak).map(r => `${r.created_at.slice(0, 16)}  ${r.name}  ${r.html_url}`).join('\n'));
  } else if (failed > 2) {
    // A streak of zero with old failures behind it is a RECOVERY, not a fault.
    // Reporting "7 of the last 10 failed" on a repo that has been green for two
    // days is technically true and practically noise.
    const green = [];
    for (const r of done) { if (r.conclusion === 'success') green.push(r); else break; }
    ok('runs', `recovered — ${green.length} green in a row, after ${failed} failures still inside the last ${recent.length}`);
  } else {
    ok('runs', `scheduled runs are healthy (${recent.length - failed}/${recent.length} green)`);
  }
  return undefined;
}

function ghToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || localToken();
}

function localToken() {
  try { return execFileSync('gh', ['auth', 'token'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return null; }
}

/* ── 5. Do the upstream feeds still answer ──────────────────────────────── */
// Asked directly, not through the pipeline's own error handling, so a feed that
// the pipeline has learned to swallow still shows up here.
async function checkFeeds() {
  const season = require('./lib/season');
  const st = await season.state().catch(() => null);
  const dataSeason = st ? (await season.latestDataSeason()) : null;

  const feeds = [
    ['Sleeper state', 'https://api.sleeper.app/v1/state/nfl'],
    ['Sleeper players', 'https://api.sleeper.app/v1/players/nfl/trending/add?limit=1'],
    ['ESPN news', 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news'],
    ['nflverse stats', dataSeason
      ? `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${dataSeason}.csv`
      : null],
  ].filter(f => f[1]);

  const down = [];
  for (const [name, url] of feeds) {
    try {
      const res = await get(url, { method: name === 'nflverse stats' ? 'HEAD' : 'GET' });
      if (!res.ok) down.push(`${name} → HTTP ${res.status}`);
    } catch (e) {
      down.push(`${name} → ${e.message}`);
    }
  }

  if (down.length) warn('feeds', `${down.length} of ${feeds.length} upstream feeds are not answering`, down.join('\n'));
  else ok('feeds', `all ${feeds.length} upstream feeds answered`);
}

/* ── 6. The season, asked the same way the pipeline asks it ─────────────── */
async function checkSeason() {
  const season = require('./lib/season');
  try {
    const st = await season.state();
    const started = season.gamesHaveStarted(st);
    const latest = await season.latestDataSeason();
    ok('season', `${st.season} ${st.phase} week ${st.week} — games started: ${started}, newest season with data: ${latest}`);
  } catch (e) {
    return warn('season', `could not read the calendar — ${e.message}`);
  }
  try {
    execFileSync('node', ['scripts/check-season.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    ok('season', 'the data on disk matches the season being played');
  } catch (e) {
    const out = ((e.stdout || '') + (e.stderr || '')).toString();
    fail('season', 'check-season.js is unhappy', out.split('\n').filter(l => l.includes('✗')).join('\n'));
  }
  return undefined;
}

/* ── 7. Are the security headers still the ones we wrote ────────────────── */
// vercel.json is a config file with nothing asserting it. Headers are the kind
// of thing that gets loosened during a debugging session and never tightened
// again, and the loosening is invisible: the site works either way. So the
// live response is read back and compared to what the file claims.
//
// UNSAFE-INLINE IS TRACKED, NOT FAILED. index.html carries 108 inline event
// handlers and assets/*.js generate ~56 more, so script-src cannot drop it
// today and pretending otherwise would put a permanent red mark on the report.
// It is stated on every run instead, with the count, so it stays a known debt
// with a number attached rather than a thing everyone stopped noticing.
const REQUIRED_HEADERS = [
  'content-security-policy',
  'x-content-type-options',
  'referrer-policy',
  'x-frame-options',
  'permissions-policy',
  'strict-transport-security',
];
const REQUIRED_CSP = ['default-src', 'object-src', 'base-uri', 'form-action', 'frame-ancestors'];

async function checkHeaders() {
  let res;
  try { res = await get(`${ORIGIN}/`); }
  catch (e) { return warn('headers', `could not read the live headers — ${e.message}`); }

  const missing = REQUIRED_HEADERS.filter(h => !res.headers.get(h));
  if (missing.length) {
    fail('headers', `${missing.length} security header(s) are no longer being served`, missing.join('\n'));
  }

  const csp = (res.headers.get('content-security-policy') || '').toLowerCase();
  if (csp) {
    const lost = REQUIRED_CSP.filter(d => !csp.includes(d));
    if (lost.length) fail('headers', `the live CSP has lost ${lost.length} directive(s)`, lost.join(', '));

    // A regression that would matter far more than the inline handlers do.
    if (csp.includes("'unsafe-eval'")) {
      fail('headers', "the live CSP now allows 'unsafe-eval'",
        'Nothing on this site needs eval. This is a straight loosening.');
    }
    if (csp.includes("script-src") && csp.includes("'unsafe-inline'")) {
      warn('headers', "script-src still allows 'unsafe-inline' — the known debt",
        `${countInlineHandlers()} inline handlers stand between here and dropping it. `
        + 'Until then the CSP cannot stop an injected payload from running.');
    }
  }
  if (!missing.length && csp) ok('headers', `all ${REQUIRED_HEADERS.length} security headers present and the CSP is intact`);
  return undefined;
}

function countInlineHandlers() {
  let n = 0;
  const files = [path.join(ROOT, 'index.html'), ...fs.readdirSync(path.join(ROOT, 'assets'))
    .filter(f => f.endsWith('.js')).map(f => path.join(ROOT, 'assets', f))];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    n += (fs.readFileSync(f, 'utf8').match(/\son[a-z]+\s*=\s*["'`]/g) || []).length;
  }
  return n;
}

/* ── 8. Housekeeping — the quality-of-life column ───────────────────────── */
// Nothing here fails a run. It is the list of small things that rot quietly:
// the kind of item that is never urgent and is therefore never done.
function checkHousekeeping() {
  const notes = [];

  // GitHub retires the Node runtime under an action major, not the action, so a
  // pin that still works today starts printing a deprecation warning and then
  // one day stops. Anything below v5 is already running on the Node 20 shim.
  const wfDir = path.join(ROOT, '.github', 'workflows');
  const behind = [];
  for (const f of fs.readdirSync(wfDir).filter(n => n.endsWith('.yml'))) {
    const yml = fs.readFileSync(path.join(wfDir, f), 'utf8');
    for (const [, action, v] of yml.matchAll(/uses:\s*(actions\/[\w-]+)@v(\d+)/g)) {
      if (Number(v) < 5) behind.push(`${f}: ${action}@v${v}`);
    }
  }
  if (behind.length) notes.push(`${behind.length} action pin(s) on a deprecated Node 20 runtime: ${behind.join(', ')}`);

  const pc = path.join(DATA, 'playcallers.json');
  if (fs.existsSync(pc)) {
    const j = JSON.parse(fs.readFileSync(pc, 'utf8'));
    const rows = Array.isArray(j) ? j : (j.rows || Object.values(j.teams || {}));
    const filled = rows.filter(r => r && (r.playcaller || r.name)).length;
    if (filled < rows.length) notes.push(`playcallers.json is ${filled}/${rows.length} filled — a coordinator change is invisible until it is`);
  }

  const metaPath = path.join(DATA, 'meta.json');
  if (fs.existsSync(metaPath)) {
    const d = (JSON.parse(fs.readFileSync(metaPath, 'utf8')).statusDiagnostics) || {};
    if (d.unmatched && d.unmatched.length) notes.push(`${d.unmatched.length} player(s) the status feed cannot match: ${d.unmatched.join(', ')}`);
    if (d.overridesExpired && d.overridesExpired.length) notes.push(`${d.overridesExpired.length} injury override(s) have expired and can be deleted`);
    if (d.overridesOrphaned && d.overridesOrphaned.length) notes.push(`${d.overridesOrphaned.length} injury override(s) point at players no longer in the pool`);
  }

  if (notes.length) warn('housekeeping', `${notes.length} thing(s) worth an hour some day`, notes.join('\n'));
  else ok('housekeeping', 'nothing rotting');
}

/* ── the report ─────────────────────────────────────────────────────────── */
function render(rows = results) {
  const icon = { ok: '✅', warn: '⚠️', fail: '❌' };
  const fails = rows.filter(r => r.level === 'fail');
  const warns = rows.filter(r => r.level === 'warn');

  const headline = fails.length
    ? `❌ ${fails.length} problem${fails.length > 1 ? 's' : ''}`
    : warns.length ? `⚠️ ${warns.length} thing${warns.length > 1 ? 's' : ''} to look at` : '✅ all clear';

  const out = [];
  out.push(`## ${headline}`);
  out.push('');
  out.push(`_${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC · [${ORIGIN.replace(/^https:\/\//, '')}](${ORIGIN})_`);
  out.push('');

  // Problems first and in full. Everything else collapses.
  for (const r of [...fails, ...warns]) {
    out.push(`${icon[r.level]} **${r.area}** — ${r.line}`);
    if (r.detail) out.push('', '```', r.detail, '```');
    out.push('');
  }

  const passed = rows.filter(r => r.level === 'ok');
  if (passed.length) {
    out.push('<details><summary>' + `${passed.length} check${passed.length > 1 ? 's' : ''} passed` + '</summary>');
    out.push('');
    for (const r of passed) out.push(`- ✅ **${r.area}** — ${r.line}`);
    out.push('');
    out.push('</details>');
  }
  return out.join('\n');
}

async function main() {
  await checkPublished();
  await checkCommits();
  await checkHistory();
  await checkRuns();
  await checkFeeds();
  await checkSeason();
  await checkHeaders();
  checkHousekeeping();

  if (!process.argv.includes('--quiet')) console.log(render());
  return results.some(r => r.level === 'fail') ? 1 : 0;
}

if (require.main === module) {
  main().then(c => process.exit(c)).catch(e => {
    console.error(`health-report crashed: ${e.stack}`);
    process.exit(1);
  });
}

module.exports = { main, results, render, rowIsStale, daysSinceRow };
