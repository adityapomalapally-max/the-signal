/**
 * ONE VOCABULARY, ENFORCED AT THE FILES RATHER THAN AT THE FUNCTION.
 *
 * tests/advstats.test.js already pinned `teamKey('LA') === 'LAR'`, and it
 * passed every day of the season this bug was live. That is the lesson here:
 * the alias was correct, tested, and simply never called. build-teams.js and
 * build-sos.js keyed their schedules straight off the feed, so the Rams landed
 * under `LA` in two files and `LAR` in every other one.
 *
 * Nothing rang. The team count was 32. The roster was full. The name, nick,
 * conference and division all resolved, because the ROSTER feed says `LAR` and
 * only the SCHEDULE feed says `LA`. All that was missing was seventeen games,
 * and a team with no games reads as a team on a bye — teams.json published
 * `bye: 1` for a team that played in week 1.
 *
 * So these tests assert the property the site actually depends on — every team
 * code in every published file is canonical, and every opponent resolves to a
 * team that exists — rather than asserting that some function was called.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const D = path.join(__dirname, '..', 'data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
const { teamKey, isTeam, isCanonical, assertCanonicalTeams, NFL_TEAMS } = require('../scripts/lib/teams');

// ===== the distinction the bug turned on =====

test('canonical is a stricter test than valid, and LA is the proof', () => {
  // Both of these were true all season. Only the second one would have failed.
  assert.strictEqual(isTeam('LA'), true, 'LA is a real franchise');
  assert.strictEqual(isCanonical('LA'), false, 'LA is not the code this site writes');

  assert.strictEqual(isCanonical('LAR'), true);
  assert.strictEqual(isCanonical('KC'), true);
  for (const alias of ['LA', 'OAK', 'SD', 'STL', 'WSH', 'JAC']) {
    assert.strictEqual(isCanonical(alias), false, `${alias} is an alias, not canonical`);
    assert.strictEqual(isCanonical(teamKey(alias)), true, `${alias} must canonicalise to something canonical`);
  }
});

test('every canonical code is exactly the 32 franchises', () => {
  for (const t of NFL_TEAMS) assert.strictEqual(isCanonical(t), true, `${t} must be canonical`);
  for (const fake of ['2TM', '3TM', 'TOT', '', 'XXX']) {
    assert.strictEqual(isCanonical(fake), false, `${fake} must not be canonical`);
  }
});

test('the guard names what is wrong and refuses to pass it', () => {
  assert.doesNotThrow(() => assertCanonicalTeams(['KC', 'LAR'], 'ok'));

  assert.throws(() => assertCanonicalTeams(['KC', 'LA'], 'somewhere'),
    /somewhere.*LA/s, 'an un-aliased code must be named in the error');

  // The second half: a code that is canonical but absent from the thing being
  // built. This is the form the bug took on the matchup board — `opp: "LA"`
  // pointed at a team the file did not contain.
  assert.throws(() => assertCanonicalTeams(['KC', 'LAR'], 'board', ['KC']),
    /not present in the output.*LAR/s);
  assert.doesNotThrow(() => assertCanonicalTeams(['KC'], 'board', ['KC', 'LAR']));

  // Blanks are not codes and must not be reported as broken ones.
  assert.doesNotThrow(() => assertCanonicalTeams(['KC', '', null, undefined], 'ok'));
});

// ===== the published files =====

test('teams.json: every key canonical, every opponent resolvable', () => {
  const teams = read('teams.json').teams;
  const keys = Object.keys(teams);
  assert.strictEqual(keys.length, 32);
  assertCanonicalTeams(keys, 'teams.json keys');
  assertCanonicalTeams(Object.values(teams).flatMap(t => t.schedule.map(g => g.opp)),
    'teams.json opponents', keys);
});

test('teams.json: no team has an empty schedule', () => {
  // THE EXACT SHAPE OF THE BUG. Every other check passed while this was false
  // for the Rams: 32 teams, full roster, real name, and no games at all.
  const teams = read('teams.json').teams;
  const empty = Object.entries(teams).filter(([, t]) => !t.schedule.length).map(([k]) => k);
  assert.deepStrictEqual(empty, [], 'a team with no schedule renders as a team on a bye');
});

test('teams.json: a bye is one week, and it is a week the team really sits', () => {
  // `bye: 1` was published for a team that played in week 1, because the bye
  // was derived from an empty schedule — and "week 1 is not in an empty set"
  // is true, so the obvious assertion here passes on the broken file. The
  // property that actually holds is that every team plays the SAME NUMBER of
  // games, which is false the moment one of them has none.
  const teams = read('teams.json').teams;
  const counts = new Set(Object.values(teams).map(t => t.schedule.length));
  assert.strictEqual(counts.size, 1,
    `teams play different numbers of games: ${[...counts].sort((a, b) => a - b).join(', ')}`);

  for (const [abbr, t] of Object.entries(teams)) {
    const weeks = new Set(t.schedule.map(g => g.week));
    assert.ok(t.bye === null || !weeks.has(t.bye),
      `${abbr} has a bye in week ${t.bye} and also a game that week`);
    if (t.bye !== null) assert.ok(t.bye >= 1, `${abbr} bye must be a real week`);
  }
});

test('teams.json: a schedule is symmetric — if A plays B, B plays A', () => {
  // The Rams were missing from seventeen opponents' pages and those pages were
  // missing from theirs. Symmetry catches a one-sided join from either end.
  const teams = read('teams.json').teams;
  for (const [abbr, t] of Object.entries(teams)) {
    for (const g of t.schedule) {
      const other = teams[g.opp];
      assert.ok(other, `${abbr} week ${g.week} faces ${g.opp}, which is not a team in this file`);
      const back = other.schedule.find(x => x.week === g.week && x.opp === abbr);
      assert.ok(back, `${abbr} plays ${g.opp} in week ${g.week} but ${g.opp} does not play ${abbr}`);
      assert.strictEqual(back.home, !g.home, `${abbr} and ${g.opp} both claim the same side of week ${g.week}`);
    }
  }
});

test('sos.json is keyed the same way teams.json is read', () => {
  // app-pages.js does `sosData.defense[g.opp]`, where g.opp comes from
  // teams.json. Two files, one lookup — so one vocabulary or the tooltip is
  // silently blank for every game against the odd one out.
  const sos = read('sos.json');
  assertCanonicalTeams(Object.keys(sos.defense), 'sos.json defense');
  assertCanonicalTeams(Object.keys(sos.teams), 'sos.json teams');

  const teams = read('teams.json').teams;
  for (const abbr of Object.keys(teams)) {
    assert.ok(sos.defense[abbr], `${abbr} is in teams.json and has no sos.defense entry`);
    assert.ok(sos.teams[abbr], `${abbr} is in teams.json and has no sos.teams entry`);
  }
});

test('matchups.json and the player pool share the vocabulary too', () => {
  const mu = read('matchups.json');
  const pool = read('players.json');
  const arr = Array.isArray(pool) ? pool : (pool.players || []);
  for (const season of Object.values(mu.seasons)) {
    assertCanonicalTeams(Object.keys(season.defenses), 'matchups.json defenses');
  }
  assertCanonicalTeams(arr.map(p => p.team).filter(Boolean), 'players.json teams');
});

test('no published file spells a team any way but this one', () => {
  // THE SWEEP, because naming the files was how this lasted a season. Every
  // fix so far was aimed at a file somebody had thought of: teams.json and
  // sos.json were found by reading the page, weekly-usage and rushing only
  // turned up in a grep afterwards, and xfp's was in a season no rebuild had
  // touched since the alias was written. The ones nobody thinks of are the
  // point of a sweep.
  //
  // `team` and `opp` are the team-coded fields in these shapes; a few files
  // also key a map by team. Checked by VALUE rather than by walking blind, so
  // this cannot be fooled by a field that merely looks like a code.
  const offenders = [];
  const check = (where, code) => {
    if (typeof code === 'string' && code && !isCanonical(code) && isTeam(code)) {
      offenders.push(`${where} = ${code} (should be ${teamKey(code)})`);
    }
  };
  const walk = (node, where, depth) => {
    if (depth > 12 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${where}[${i}]`, depth + 1)); return; }
    for (const f of ['team', 'opp']) check(`${where}.${f}`, node[f]);
    for (const [k, v] of Object.entries(node)) walk(v, `${where}.${k}`, depth + 1);
  };

  const files = fs.readdirSync(D).filter(f => f.endsWith('.json'));
  assert.ok(files.length > 20, 'expected the full data directory');
  for (const f of files) {
    const json = JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
    walk(json, f, 0);
    // Team-keyed maps: the code is the KEY, which the walk above cannot see.
    for (const season of Object.values(json.seasons || {})) {
      if (season && season.teams && !Array.isArray(season.teams)) {
        for (const k of Object.keys(season.teams)) check(`${f} seasons.*.teams[${k}]`, k);
      }
    }
  }
  assert.deepStrictEqual(offenders, [], `non-canonical team codes published:\n  ${offenders.join('\n  ')}`);
});

test('the game logs carry a canonical opponent', () => {
  // These are a join key: build-teams reads them to work out which team a
  // player produced for, and build-matchups attributes every point to them.
  // Both alias on read, which is belt and braces — this pins the braces.
  const dir = path.join(D, 'weekly');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  assert.ok(files.length > 100, 'expected a real pool of game logs');
  const bad = new Map();
  for (const f of files) {
    const log = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const games of Object.values(log)) {
      if (!Array.isArray(games)) continue;
      for (const g of games) {
        if (g.opp && !isCanonical(g.opp)) bad.set(g.opp, (bad.get(g.opp) || 0) + 1);
      }
    }
  }
  assert.deepStrictEqual([...bad.keys()], [],
    `non-canonical opponents in data/weekly: ${[...bad].map(([k, n]) => `${k} x${n}`).join(', ')}`);
});
