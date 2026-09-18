/**
 * The waiver wire.
 *
 * A trending list is a leaderboard of names: 326,641 people added Xavier
 * Hutchinson, and nothing about whether that is a reason to do the same. The
 * two facts that turn one of those into a reason are where he sits on his own
 * team and which way the count is moving — a depth chart and a series.
 *
 * THE POOL CANNOT ANSWER THE FIRST. The 350 are the fantasy-relevant players,
 * which is to say the ones already rostered; a waiver page is about the
 * others. context.json's depth chart stops at the pool, so the layer this
 * reads is data/depth-league.json — the whole league at the four skill
 * positions, in its own file because the profile and Stats & Charts both load
 * context.json and neither needs 31 other teams' backup receivers.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'build-wire.js'), 'utf8');
const PAGES = fs.readFileSync(path.join(ROOT, 'assets', 'app-pages.js'), 'utf8');
const FEEDS = fs.readFileSync(path.join(ROOT, 'assets', 'app-feeds.js'), 'utf8');

const wire = read('data/wire.json');
const league = read('data/depth-league.json');

test('the depth layer reaches past the pool', () => {
  // The whole point. If this ever gets filtered back to the 350, the board
  // loses its reason column for exactly the players it is about.
  const players = read('data/players.json');
  const pooled = new Set(players.map(p => `${p.team}|${p.name.toLowerCase()}`));
  const listed = [];
  for (const [team, byPos] of Object.entries(league.teams)) {
    for (const list of Object.values(byPos)) {
      for (const row of list) listed.push(`${team}|${row.name.toLowerCase()}`);
    }
  }
  assert.ok(listed.length > 600, `only ${listed.length} players on the league chart — this looks pool-filtered again`);
  const outside = listed.filter(k => !pooled.has(k)).length;
  assert.ok(outside > listed.length / 2,
    `only ${outside} of ${listed.length} chart entries are outside the pool — a waiver board needs the players nobody has rostered`);
});

test('the league chart carries skill positions and nothing else', () => {
  // Every defender and specialist would be four times the file for a question
  // nobody asks a waiver board. This is the data assertion; it goes red the
  // first time the file is rebuilt without the filter.
  const positions = new Set();
  for (const byPos of Object.values(league.teams)) Object.keys(byPos).forEach(p => positions.add(p));
  assert.deepStrictEqual([...positions].sort(), ['QB', 'RB', 'TE', 'WR'],
    `depth-league.json carries ${[...positions].join(', ')} — the skill-position filter is gone`);
});

test('every add either carries a real id or none at all', () => {
  // The room speculates on players the site has never heard of. Their counts
  // are worth showing; attaching one to the wrong player is not.
  const players = read('data/players.json');
  const ids = new Set(players.map(p => p.id));
  for (const row of [...wire.adds, ...wire.drops]) {
    if (row.id === null) { assert.strictEqual(row.inPool, false); continue; }
    assert.ok(ids.has(row.id), `${row.name} carries id "${row.id}", which is not in the pool`);
    assert.strictEqual(row.inPool, true);
  }
});

test('a direction needs a reading dated the day before, or there is none', () => {
  // The data cannot test this while the series has two mornings in it: every
  // player has a reading on both, so the guard changes nothing on disk and a
  // data-only assertion goes green on a rule that is gone. These are the cases
  // that only exist on the days they matter.
  const { directionOf } = require('../scripts/build-wire');
  const series = [{ date: '2026-08-20', count: 100 }, { date: '2026-08-21', count: 200 }];

  assert.deepStrictEqual(directionOf(300, series, '2026-08-21'), { move: 'rising', pct: 50 },
    'a live count against yesterday should give a direction');
  assert.strictEqual(directionOf(300, series, '2026-08-22'), null,
    'there is no reading dated 08-22, so there is nothing to compare against');
  assert.strictEqual(directionOf(300, [], '2026-08-21'), null,
    'a player with no history at all cannot have a direction');
  assert.strictEqual(directionOf(0, series, '2026-08-21'), null,
    'no live count is not a 100% fall');
  assert.strictEqual(directionOf(300, [{ date: '2026-08-21', count: 0 }], '2026-08-21'), null,
    'a division by a zero count is not an infinite rise');
  // The gap case, which is the whole reason the date is checked rather than
  // the position: a player on the list Monday and Wednesday but not Tuesday.
  assert.strictEqual(directionOf(300, [{ date: '2026-08-19', count: 100 }], '2026-08-21'), null,
    'a reading from two days ago must not be compared as though it were yesterday');
  assert.deepStrictEqual(directionOf(205, series, '2026-08-21'), { move: 'steady', pct: 3 },
    'a small move reads as steady rather than as a trend');
});

test('a direction is never drawn through one point', () => {
  // The series began on the day it began. Sleeper publishes no history of its
  // own, so there is no way to backfill and no reason to pretend otherwise.
  const days = wire.meta.daysOnFile;
  for (const row of wire.adds) {
    if (row.series.length < 2) {
      assert.strictEqual(row.direction, null,
        `${row.name} has ${row.series.length} reading(s) and a direction anyway`);
    }
  }
  if (days < 2) {
    assert.ok(wire.adds.every(a => a.direction === null),
      'the series is one morning old and something carries a direction');
    assert.match(JSON.stringify(wire.meta.caveats), /direction/i,
      'nothing tells the reader why no player has a direction');
  }
});

test('a depth line is absent rather than invented', () => {
  for (const row of wire.adds) {
    if (!row.depth) continue;
    assert.ok(row.depth.reading, `${row.name} has a depth object with nothing in it`);
    // TIES ARE REAL AND THE FIRST VERSION OF THIS DID NOT ALLOW FOR THEM.
    // Atlanta listed Cooper Rush and Trevor Siemian both at QB3, so the man
    // published as QB4 genuinely has four names ahead of him. The published
    // rank and the number of players ahead are different facts and both are
    // true; the invariant is that the names cannot UNDERSTATE the rank.
    assert.ok(row.depth.behind.length >= Math.max(0, (row.depth.rank || 1) - 1),
      `${row.name}: listed ${row.depth.rank} with only ${row.depth.behind.length} names ahead of him`);
    assert.ok(row.depth.behind.every((n) => typeof n === 'string' && n.length),
      `${row.name}: a name ahead of him is not a name`);
  }
  assert.ok(!/behind (undefined|null)/.test(JSON.stringify(wire.adds)), 'a depth line names a player that is not there');
});

test('the logged range and the live reading are not the same field', () => {
  // In season the count is refreshed four more times a week than the history
  // series is written, so "the last morning on file" and "when this was
  // counted" are different moments — and seriesTo used to hold whichever of
  // them was written last, which is a field that means two things.
  const m = wire.meta;
  assert.ok(m.seriesFrom && m.seriesTo, 'the logged range is gone');
  assert.ok(m.liveDate, 'nothing records the date of the live reading');
  assert.ok(m.seriesTo <= m.liveDate,
    `the last logged morning (${m.seriesTo}) is after the live reading (${m.liveDate})`);
  assert.strictEqual(m.comparedWith, new Date(Date.parse(m.liveDate) - 86400000).toISOString().slice(0, 10),
    'the direction is compared against something other than the day before the live reading');
  // Every direction on the board has to be against that date and no other.
  for (const row of wire.adds) {
    if (!row.direction) continue;
    assert.ok(row.series.some(s => s.date === m.comparedWith),
      `${row.name} carries a direction with no reading dated ${m.comparedWith}`);
    assert.strictEqual(row.series[row.series.length - 1].date, m.liveDate,
      `${row.name}'s series does not end at the live reading`);
  }
});

test('the chart is described as a claim, not as a snap count', () => {
  const caveats = JSON.stringify(wire.meta.caveats);
  // NOT /published/i. A second caveat about camp-size charts also contains the
  // word, so the loose version passed with the claim itself deleted.
  assert.match(caveats, /claim about intent/i,
    'nothing says a depth chart is a claim about intent rather than a record of what the team does');
  assert.match(caveats, /Sleeper-wide|every Sleeper league/i,
    'nothing says the add counts are league-wide rather than about the reader\'s own league');
});

test('first sightings are not moves', () => {
  // On the first run every depth entry is a first sighting. Publishing those
  // as promotions would announce 354 players being promoted on day one.
  for (const m of wire.depthMoves) {
    assert.ok(m.fromRank !== undefined && m.toRank !== undefined,
      `${m.name} is in the moves list with nothing to have moved from`);
  }
  // And the filter itself: on the first run EVERY entry is a first sighting,
  // so a build that stopped excluding them would announce 354 promotions.
  assert.match(SRC, /!m\.first/,
    'the depth log is no longer filtered for first sightings — day one would publish as 354 promotions');
  const log = fs.readFileSync(path.join(ROOT, 'data', 'history', 'depth.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(JSON.parse);
  const firsts = log.filter(l => l.first).length;
  if (firsts) {
    assert.ok(wire.depthMoves.length < firsts,
      'the moves list is as long as the first-sighting log — it is republishing day one as news');
  }
});

test('a view only keeps the controls that reach it', () => {
  // One morning's adds have neither a position filter nor a season, and neither
  // has a two-player comparison. A control that changes nothing invites a click
  // that does nothing.
  //
  // THE PROPERTY, NOT THE SPELLING. This used to assert the exact line —
  // `pos.style.display = view === 'wire' ? 'none'` — and went red the moment a
  // second view needed the same treatment, on a change that kept every bit of
  // the behaviour it was guarding. It runs the real function now, so any
  // rewrite that still hides the right controls passes and any that stops
  // hiding them does not. Matchups and usage are the two boards that read a
  // position and a season; everything else on this page reads neither.
  const { loadPages, evalIn } = require('./lib/pageharness');
  const ctx = loadPages();
  const els = { muPosControl: { style: {} }, muSeasonControl: { style: {} } };
  ctx.document.getElementById = (id) => els[id] || null;

  const views = evalIn(ctx, 'SEASON_VIEWS');
  assert.ok(views.includes('wire'), 'the wire is no longer one of the season views');
  for (const view of views) {
    evalIn(ctx, `seasonControls(${JSON.stringify(view)})`);
    const reaches = view === 'matchups' || view === 'usage';
    for (const [id, el] of Object.entries(els)) {
      const hidden = el.style.display === 'none';
      assert.strictEqual(hidden, !reaches,
        `on the ${view} view, ${id} is ${hidden ? 'hidden' : 'shown'} and should be ${reaches ? 'shown' : 'hidden'}`);
    }
  }
});

test('the board-sample banner only runs on the boards it is about', () => {
  // It explains the matchup board's sample floor and the season selector under
  // it. On a list of this morning's adds, or a two-player comparison for this
  // week, it is a caveat about something not on screen — and those teach a
  // reader to skip the ones that matter.
  //
  // THE PROPERTY, NOT THE SPELLING: this used to match the exact condition in
  // renderSeasonPage and went red when a second view needed excluding, on a
  // change that kept the behaviour intact.
  const { loadPages, evalIn } = require('./lib/pageharness');
  const ctx = loadPages();
  const applies = evalIn(ctx, 'seasonBannerApplies');
  assert.strictEqual(applies('wire'), false, 'the banner renders on the wire, where it is not true');
  assert.strictEqual(applies('startsit'), false, 'the banner renders on start/sit, which has no sample floor to explain');
  assert.strictEqual(applies('matchups'), true, 'the banner stopped rendering on the board it describes');
  const render = PAGES.slice(PAGES.indexOf('function renderSeasonPage'), PAGES.indexOf('function renderSeasonPage') + 1200);
  assert.match(render, /seasonBannerApplies\(seasonView\)/,
    'the banner is no longer gated on which view is showing');
});

test('the banner says which of the three states the season is in', () => {
  // HARDCODED "No games have been played this year" was published through week
  // three of a season. Prose is tested by nothing, so a sentence written on a
  // true day stays on the page until somebody reads it carefully.
  const { loadPages, evalIn } = require('./lib/pageharness');
  const ctx = loadPages();
  const state = evalIn(ctx, 'seasonBoardState');
  const board = (cells) => ({ meta: { latestSeasonWithGames: 2026 }, seasons: { 2026: { defenses: { BUF: { WR: cells } } } } });

  assert.strictEqual(state(board({ gamesPlayed: 0, thin: true })).weeks, 0, 'no games played is still no games played');
  const young = state(board({ gamesPlayed: 2, thin: true }));
  assert.strictEqual(young.weeks, 2);
  assert.strictEqual(young.qualified, 0, 'a thin figure was counted as qualified');
  const ready = state(board({ gamesPlayed: 6, thin: false }));
  assert.strictEqual(ready.qualified, 1);

  const html = evalIn(ctx, 'seasonStateHtml');
  assert.match(html(board({ gamesPlayed: 0, thin: true })), /No games have been played/);
  assert.doesNotMatch(html(board({ gamesPlayed: 2, thin: true })), /No games have been played/,
    'week 2 of a season is still being described as the preseason');
  assert.match(html(board({ gamesPlayed: 2, thin: true })), /four games is the floor/);
});

test('a route key with a slash in it actually resolves', () => {
  // Three were written and none was ever looked up: metaForRoute read the
  // first segment and returned the parent's title, so /season/usage and
  // /draft/film shared a description with the pages they are not.
  const fn = FEEDS.slice(FEEDS.indexOf('function metaForRoute'), FEEDS.indexOf('function metaForRoute') + 900);
  assert.match(fn, /ROUTE_META\[joined\]/,
    'metaForRoute no longer looks up two-segment keys, so every one of them is dead config');
  const keys = [...FEEDS.matchAll(/^\s+'([a-z]+\/[a-z]+)':\s*\{/gm)].map(m => m[1]);
  assert.ok(keys.includes('season/wire'), 'the wire has no route metadata of its own');
});
