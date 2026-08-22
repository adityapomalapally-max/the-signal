/**
 * Two tiers, and which one a run is.
 *
 * The daily build is correctly timed for the STATS and badly timed for Sunday.
 * Measured against nflverse's own schedule, they rebuild play-by-play after
 * every window — TNF at 05:30 UTC Friday, the early window 22:00 UTC Sunday,
 * the late window 00:05 UTC Monday, SNF 05:30 UTC Monday, MNF 05:30 UTC Tuesday
 * — all overnight, so an 11:00 UTC build has the weekend by Monday morning.
 * Nothing about the CSVs wants a second run.
 *
 * Inactives do. They are official ninety minutes before kickoff, so a build
 * that ran at 6:00 ET does not have them, and a reader setting a lineup at noon
 * on Sunday is reading a status page from before the teams said who was
 * playing. That is what the light tier is for, and it is the whole reason to
 * split the job rather than simply run it more often: running the 200MB half
 * four more times a week would cost everything and change nothing.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const YML = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily-update.yml'), 'utf8');
const cadence = require('../scripts/lib/cadence');
const season = require('../scripts/lib/season');

const CRONS = [...YML.matchAll(/- cron: '([^']+)'/g)].map(m => m[1]);

function withSeason(state, fn) {
  season.__setState(state);
  try { return fn(); } finally { season.__reset(); }
}

test('exactly one schedule is the full build, and the planner agrees which', () => {
  // The rule is "the cron at 11:00 UTC is the full one". Two of them, or none,
  // and the rule stops meaning anything.
  const full = CRONS.filter(c => cadence.tierForSchedule(c) === 'full');
  assert.strictEqual(full.length, 1,
    `${full.length} schedules map to the full build (${full.join(', ')}) — the planner's rule assumes exactly one`);
  assert.strictEqual(Number(full[0].split(/\s+/)[1]), cadence.FULL_HOUR_UTC);
  assert.ok(CRONS.length > 1, 'there are no light refreshes at all');
});

test('a late daily build is still the full build', async () => {
  // GitHub delays scheduled runs, sometimes past the hour. Reading the wall
  // clock would demote a 12:07 start to a status refresh and skip the day's
  // real work — so the decision comes from the schedule that fired.
  const out = await withSeason({ season: 2026, previousSeason: 2025, week: 3, phase: 'regular', source: 'test' },
    () => cadence.plan({ schedule: '0 11 * * *' }));
  assert.strictEqual((await out).tier, 'full');
  const off = await withSeason({ season: 2026, previousSeason: 2025, week: 0, phase: 'off', source: 'test' },
    () => cadence.plan({ schedule: '0 11 * * *' }));
  assert.strictEqual((await off).tier, 'full', 'the full build must run out of season too — it always has');
});

test('a light schedule runs in season and does nothing out of it', async () => {
  for (const cron of CRONS.filter(c => cadence.tierForSchedule(c) === 'light')) {
    const inSeason = await withSeason({ season: 2026, previousSeason: 2025, week: 3, phase: 'regular', source: 'test' },
      () => cadence.plan({ schedule: cron }));
    assert.strictEqual((await inSeason).tier, 'light', `${cron} should be a light refresh in season`);

    for (const phase of ['pre', 'off']) {
      const out = await withSeason({ season: 2026, previousSeason: 2025, week: 2, phase, source: 'test' },
        () => cadence.plan({ schedule: cron }));
      assert.strictEqual((await out).tier, 'none',
        `${cron} runs in the ${phase} season, where no inactive is being announced for a game nobody is playing`);
    }
  }
});

test('a hand-triggered run gets what the person asked for', async () => {
  const light = await cadence.plan({ tier: 'light' });
  assert.strictEqual(light.tier, 'light');
  const full = await cadence.plan({ tier: 'full' });
  assert.strictEqual(full.tier, 'full');
  // No schedule and no input: something else triggered it, so do everything
  // rather than silently half of it.
  const bare = await withSeason({ season: 2026, previousSeason: 2025, week: 0, phase: 'off', source: 'test' },
    () => cadence.plan({}));
  assert.strictEqual((await bare).tier, 'full');
});

// ---- The gates in the workflow -------------------------------------------

function steps() {
  const out = [];
  const lines = YML.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^      - name: (.+)$/);
    if (!m) continue;
    let body = '';
    for (let j = i + 1; j < lines.length && !/^      - name:/.test(lines[j]); j++) body += lines[j] + '\n';
    out.push({ name: m[1], body });
  }
  return out;
}

test('nothing that downloads from nflverse can run in a light refresh', () => {
  // The list is DERIVED, not kept here: any script that reaches nflverse is
  // heavy by definition, and a new one added to the light tier by mistake is
  // exactly the accident this exists to prevent.
  const heavy = fs.readdirSync(path.join(ROOT, 'scripts'))
    .filter(f => f.endsWith('.js'))
    .filter(f => /nflverse-data|fetchCSV/.test(fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8')))
    .map(f => f.replace('.js', ''));
  assert.ok(heavy.length >= 5, `only ${heavy.length} scripts look like nflverse downloads — has the detection broken?`);

  for (const step of steps()) {
    const m = step.body.match(/run: node scripts\/([a-z-]+)\.js/);
    if (!m || !heavy.includes(m[1])) continue;
    assert.match(step.body, /tier == 'full'/,
      `"${step.name}" runs ${m[1]}, which downloads from nflverse, but is not gated to the full build`);
  }
});

test('the series are written once a day and the events whenever they happen', () => {
  // The two halves of build-history behave differently and the cadence made it
  // matter. ADP, ranks and trending are SERIES — one reading a day, at the same
  // hour, or every delta over them carries a time-of-day wobble. Status and
  // depth are EVENT LOGS, and the log is the state the script diffs against.
  //
  // Skipping the whole file on a light run left the log describing a pool it no
  // longer matched, and tests/history.test.js went red within minutes: the
  // replay said Healthy where players.json said Questionable (Hand). Every
  // change after that would have been computed against a position that never
  // existed.
  const all = steps().filter(s => /build-history\.js/.test(s.body));
  assert.strictEqual(all.length, 2,
    'build-history should appear twice: the full series build, and --events-only for light refreshes');

  // Matched on the `run:` line, not the whole body: the comment above the full
  // step explains the events-only one, so a body-wide match finds the flag in
  // both and the full step vanishes from the comparison.
  const runLine = (s) => (s.body.match(/run: .*build-history\.js.*/) || [''])[0];
  const full = all.find(s => !/--events-only/.test(runLine(s)));
  const light = all.find(s => /--events-only/.test(runLine(s)));
  assert.ok(full && light, 'one of the two build-history steps has gone');
  assert.match(full.body, /tier == 'full'/,
    'the series build is no longer full-only — the days will stop being sampled at the same hour');
  assert.match(light.body, /tier == 'light'/,
    'the events-only run is not gated to light refreshes');

  // And the flag has to actually do something.
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build-history.js'), 'utf8');
  assert.match(src, /--events-only/, 'build-history does not know the flag the workflow passes it');
  assert.match(src, /dry \|\| eventsOnly/,
    'the events-only flag no longer suppresses the series writes, so a light refresh samples them off-hour');
});

test('the statuses and the boards built from them do run in a light refresh', () => {
  // The point of the exercise. If these get gated to the full build there is
  // no reason for the extra schedules to exist at all.
  for (const script of ['update-data', 'build-rankings', 'build-wire']) {
    const step = steps().find(s => new RegExp(`run: node scripts/${script}\\.js`).test(s.body));
    assert.ok(step, `${script} is not in the workflow`);
    assert.match(step.body, /tier != 'none'/,
      `${script} no longer runs in a light refresh, which is the only thing the extra schedules are for`);
  }
});

test('the commit message says which kind of run it was', () => {
  // A light refresh touches no nflverse file. A commit claiming "stats synced
  // from nflverse" on a Sunday afternoon sends whoever reads the log looking
  // for a change that is not in it.
  const commit = YML.slice(YML.indexOf('Commit and push'));
  assert.match(commit, /steps\.plan\.outputs\.tier.*=.*"light"/s,
    'the commit message no longer branches on the tier');
  assert.match(commit, /No nflverse data touched/,
    'the light commit message no longer says what it did not do');
});
