/**
 * Which week it is, and the two clocks that disagree about it.
 *
 * Sleeper's `week` is the one ABOUT to be played — it turns over on the Tuesday
 * — and both of these read it as the week just finished:
 *
 *   ros.json published `throughWeek: 3` on a Tuesday when week 3 kicked off on
 *   the Thursday, handed a player with two games the weight fitted for three
 *   (build-ros-weights fits week N as "before = g.week <= N", so N IS games of
 *   evidence), and counted the upcoming week as gone — which made every
 *   rest-of-season TOTAL one game short. About 7% at that point of a season,
 *   on the number a reader actually trades on.
 *
 *   build-sos then cut its rest-of-season window at the same number, so the
 *   remaining slate included a week nobody had played.
 *
 * The first fix moved ros onto the GAME LOGS — "the last week anybody has a row
 * for" — and that is a third clock, wrong in the same direction for four days of
 * every seven. On Friday 2026-09-25 one Thursday night game made the season
 * three weeks old with two weeks played: the weights came from the wrong row of
 * the fit, every rest-of-season total lost a game, and the start/sit page
 * (throughWeek + 1) offered a week-4 call while week 3 was being played. It is
 * what turned the daily run red, in this test, from the sos side.
 *
 * Both now ask ONE definition — lib/schedule.js, "a week is through when nothing
 * in it is still to come" — so the window, the games and the slate cannot come
 * apart. The game logs stay as the second source in a contradiction check: they
 * may lead by the week in progress and by no more than that.
 *
 *   node --test tests/ros-window.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const ros = read('ros.json');
const sos = read('sos.json');
const REGULAR_SEASON_WEEKS = 18;

// The last week anybody in the pool has a row on file for — NOT the clock, the
// second source. Computed here the long way so the test is not reading back the
// same helper it is checking.
function lastWeekOnFile(season) {
  const dir = path.join(ROOT, 'data', 'weekly');
  let last = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let log;
    try { log = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
    for (const g of (log[season] || [])) if (Number(g.week) > last) last = Number(g.week);
  }
  return last;
}

// The last week that is FINISHED, off a third file: teams.json carries every
// game with its result, and a null result is a game still to come. Asked here of
// a different file than build-ros reads, so agreeing is worth something.
//
// A TIE IS RESULT 0 and 0 is not "no result" — a truthiness test here would call
// a drawn week unfinished for the rest of the season.
function lastCompleteWeek() {
  const played = (g) => g.result !== null && g.result !== undefined && String(g.result).trim() !== '';
  const weeks = [];
  const open = [];
  for (const t of Object.values(read('teams.json').teams || {})) {
    for (const g of (t.schedule || [])) {
      const w = Number(g.week);
      if (!Number.isFinite(w)) continue;
      weeks.push(w);
      if (!played(g)) open.push(w);
    }
  }
  if (!weeks.length) return null;                     // no schedule to ask
  if (!open.length) return Math.max(...weeks);        // season over
  return Math.max(0, Math.min(...open) - 1);
}

test('the projection is through the last week FINISHED, not one in progress', () => {
  // THE TEST THAT AGREED WITH THE BUG. It asserted throughWeek === the last week
  // with a row in it, which is the same wrong question build-ros was asking, so
  // it stayed green through the Friday the numbers went out a game short. The
  // property is what to pin: the week the file is through must be one with no
  // football left in it.
  const complete = lastCompleteWeek();
  if (complete === null) return;   // no schedule on disk to ask
  assert.strictEqual(ros.meta.throughWeek, complete,
    `ros.json says it is through week ${ros.meta.throughWeek} and week ${complete} is the last one `
    + 'with every result in');
});

test('the week in progress is not counted, and its games are not in the blend', () => {
  const onFile = lastWeekOnFile(ros.meta.season);
  assert.ok(onFile - ros.meta.throughWeek <= 1,
    `the game logs reach week ${onFile} and the file is through week ${ros.meta.throughWeek} — `
    + 'more than the one week that can be in progress');

  // And the window was actually applied to the games, not just written in meta:
  // a player who played the Thursday night game of an unfinished week must not
  // be carrying it. Recomputed from his own log.
  const dir = path.join(ROOT, 'data', 'weekly');
  let checked = 0;
  for (const [id, p] of Object.entries(ros.players)) {
    const f = path.join(dir, `${id}.json`);
    if (!fs.existsSync(f)) continue;
    const games = (JSON.parse(fs.readFileSync(f, 'utf8'))[ros.meta.season] || [])
      .filter(g => Number(g.week) <= ros.meta.throughWeek);
    assert.strictEqual(p.gamesPlayed, games.length,
      `${id}: the file counts ${p.gamesPlayed} games and its log has ${games.length} through week ${ros.meta.throughWeek}`);
    const pts = +games.reduce((s, g) => s + (g.fpts || 0), 0).toFixed(1);
    assert.ok(Math.abs(p.pointsSoFar - pts) <= 0.15,
      `${id}: ${p.pointsSoFar} points on file, ${pts} in the log through week ${ros.meta.throughWeek}`);
    checked++;
  }
  assert.ok(checked > 20, `only ${checked} players could be checked against their own logs`);
});

test('nobody in the file has played more weeks than the file claims', () => {
  // The witness that needs no second source: a player with three games under a
  // header saying two would be the same bug pointing the other way.
  for (const [id, p] of Object.entries(ros.players)) {
    assert.ok(p.gamesPlayed <= ros.meta.throughWeek,
      `${id} has ${p.gamesPlayed} games and the file says the season is ${ros.meta.throughWeek} weeks old`);
  }
});

test('the weight is the one fitted for the evidence there is', () => {
  // build-ros-weights fits each week as N games of evidence. Handing a
  // two-game player the three-game weight trusts a small sample more than the
  // fit says to — invisible in the output, and it moves every projection.
  const weeks = [...new Set(Object.values(ros.players).map(p => Number((/week (\d+)/.exec(p.weightBasis) || [])[1])))]
    .filter(Number.isFinite);
  assert.ok(weeks.length, 'no player records which weekly weight it used');
  for (const w of weeks) {
    assert.ok(w <= ros.meta.throughWeek,
      `a weight fitted for week ${w} was used in a season ${ros.meta.throughWeek} weeks old`);
  }
});

test('the games still to come are the weeks still to come', () => {
  // weeks left = REGULAR_SEASON_WEEKS - played, less the one bye a season has.
  const left = REGULAR_SEASON_WEEKS - ros.meta.throughWeek;
  assert.ok(ros.meta.gamesRemaining === left - 1 || ros.meta.gamesRemaining === left,
    `${ros.meta.gamesRemaining} games remaining with ${left} weeks left after week ${ros.meta.throughWeek}`);

  // And the total is the per-game number times that count, or the headline
  // figure on the card is not the two numbers beside it.
  for (const [id, p] of Object.entries(ros.players).slice(0, 25)) {
    const expect = p.projectedPpg * ros.meta.gamesRemaining;
    assert.ok(Math.abs(p.restOfSeasonPoints - expect) <= 0.2,
      `${id}: ${p.restOfSeasonPoints} is not ${p.projectedPpg} x ${ros.meta.gamesRemaining}`);
  }
});

test('the schedule segments do not offer a window that is already over', () => {
  const segs = sos.meta.segments || {};
  assert.ok(Object.keys(segs).length, 'sos.json publishes no segments');

  if (sos.meta.headline === 'rest') {
    const rest = segs.rest;
    assert.ok(rest, 'the headline names a segment the file does not have');
    assert.ok(rest.from > ros.meta.throughWeek,
      `the rest-of-season window starts at week ${rest.from} and week ${ros.meta.throughWeek} has been played`);
    assert.strictEqual(rest.to, REGULAR_SEASON_WEEKS);
    assert.ok(!segs.early, 'the opening month is still published in season, and it is over');
  } else {
    assert.ok(segs.early, 'out of season the opening month is the useful cut and it is missing');
  }
});

test('the page reads the segments off the file rather than naming them', () => {
  // It said "OPENING MONTH" and read `.early` — its own copy of the words
  // "Weeks 1–4", which is how that label survived the season starting.
  //
  // SCANNED WITHOUT COMMENTS, because the comment explaining this fix quotes
  // the very string it removed — and an absence check that reads prose fails on
  // the paragraph describing the deletion. The feed-escaping tests learned the
  // same lesson from the other direction, where a comment kept a deleted line
  // looking alive.
  const raw = fs.readFileSync(path.join(ROOT, 'assets', 'app-pages.js'), 'utf8');
  const pages = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const fn = pages.slice(pages.indexOf('function sosSummary'), pages.indexOf('function sosSummary') + 1400);
  assert.ok(fn.length > 100, 'sosSummary is gone');
  assert.match(fn, /meta\.segments/, 'the summary no longer reads the segments from the file');
  assert.match(fn, /meta\.headline/, 'the summary decides for itself which figure leads');
  assert.ok(!/OPENING MONTH/.test(pages), 'the page still names a window of its own');
  assert.ok(!/sosTeam\.early/.test(pages), 'the page still reaches for a segment by name');
});

test('the defence season switches on games PLAYED, at the week it says it does', () => {
  // THE BRANCH THAT HAD NEVER RUN. build-sos moves from last season's defences
  // to this season's once the floor is cleared, and the switch read Sleeper's
  // week — the one about to be played — so it would have fired a week early, on
  // four games while the log said six. Same confusion that put ros a week ahead
  // and the rest-of-season slate on a week nobody had played.
  //
  // Exercised here at every week instead of on the one morning a year it fires.
  const { liveDefences, weeksPlayedFrom, MIN_WEEKS_FOR_LIVE, segmentsFor } = require('../scripts/build-sos.js');

  // THE COUNT IS THE HALF THAT CAN BE WRONG QUIETLY. A week is finished when
  // nothing in it is still to come — so this counts up to the first unplayed
  // game rather than counting played ones, or a Sunday evening with half the
  // results in would read as a completed week.
  const game = (week, played) => ({ week, result: played ? '3' : '' });
  const season = (playedWeeks, total = 6) => {
    const rows = [];
    for (let w = 1; w <= total; w++) for (let i = 0; i < 16; i++) rows.push(game(w, w <= playedWeeks));
    return rows;
  };
  assert.strictEqual(weeksPlayedFrom(season(0)), 0, 'before kickoff nothing has been played');
  assert.strictEqual(weeksPlayedFrom(season(2)), 2);
  assert.strictEqual(weeksPlayedFrom([]), 0, 'no schedule at all is not a played season');

  // A week half in the books is not a week.
  const halfWeek = season(2).concat([game(3, true), game(3, false)]);
  assert.strictEqual(weeksPlayedFrom(halfWeek), 2, 'a Sunday evening was counted as a finished week');

  // A postponed game drags the floor DOWN rather than up, which is the safe
  // direction: build on less, never on a week nobody finished.
  const postponed = season(5).map(g => (g.week === 3 ? game(3, false) : g));
  assert.strictEqual(weeksPlayedFrom(postponed), 2, 'a postponement let the count run past it');

  // A season with every result in is as many weeks as it has.
  assert.strictEqual(weeksPlayedFrom(season(6)), 6);

  // A TIE IS A PLAYED GAME. `result` is the home margin, so a draw is 0 — and a
  // truthiness test on it reads the week as never finished and pins the clock
  // below it for the rest of the season. One tie a year is enough.
  const drawn = season(2).map(g => (g.week === 2 ? { week: 2, result: 0 } : g));
  assert.strictEqual(weeksPlayedFrom(drawn), 2, 'a tied game was read as a game not played');

  assert.strictEqual(MIN_WEEKS_FOR_LIVE, 4, 'the floor moved; the measurement behind it is in the file');
  for (const played of [0, 1, 2, 3]) {
    assert.strictEqual(liveDefences(played), false, `${played} weeks played should still use last season`);
  }
  for (const played of [4, 5, 12]) {
    assert.strictEqual(liveDefences(played), true, `${played} weeks played should use this season`);
  }

  // And the segments follow the same clock: the window opens at the first week
  // nobody has played, so it can never contain one that is over.
  assert.ok(segmentsFor(0).early, 'before kickoff the opening month is the useful cut');
  assert.ok(!segmentsFor(0).rest, 'a rest-of-season window before any football is the season itself');
  const mid = segmentsFor(7);
  assert.strictEqual(mid.rest.from, 7);
  assert.ok(!mid.early, 'the opening month is still offered in week 7, and it is over');
});

test('building the script does not run it', () => {
  // The export exists so the switch can be tested. If requiring the file also
  // kicked off a 200MB fetch and wrote data/, every test run would rebuild the
  // site's schedule strength as a side effect.
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build-sos.js'), 'utf8');
  assert.match(src, /require\.main === module/, 'requiring build-sos.js runs the whole build');
});

test('every team the schedule board can show has a figure for the leading segment', () => {
  const lead = sos.meta.headline;
  const teams = Object.keys(sos.teams);
  assert.ok(teams.length >= 32, `only ${teams.length} teams in sos.json`);
  for (const t of teams) {
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      assert.ok(sos.teams[t][pos][lead],
        `${t} ${pos} has no ${lead} figure, so the headline on its page would be blank`);
    }
  }
});
