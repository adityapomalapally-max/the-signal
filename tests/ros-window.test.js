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
 * Both now ask the data instead: the game logs for ros, the schedule feed's own
 * results for sos. The window and the games come from one source in each case,
 * so they cannot come apart.
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

// The last week anybody in the pool has a game on file for, computed here the
// long way so the test is not reading back the same helper it is checking.
function lastPlayedWeek(season) {
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

test('the projection is through the last week PLAYED, not the week on the calendar', () => {
  const played = lastPlayedWeek(ros.meta.season);
  assert.strictEqual(ros.meta.throughWeek, played,
    `ros.json says it is through week ${ros.meta.throughWeek} and the game logs end at week ${played}`);
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
