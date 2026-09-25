/**
 * lib/schedule.js — the season's clock, asked of the schedule rather than a calendar
 *
 * There are three clocks in this repo and only one of them is the truth.
 *
 *   Sleeper's `week`        the week ABOUT to be played. Turns over on the
 *                           Tuesday, and ran eleven days ahead of kickoff in
 *                           2026. Never a count of football played.
 *   the weekly game logs    whichever week nflverse has published a row for.
 *                           On a Friday that is the Thursday night game — ONE
 *                           game out of sixteen — so the maximum week on file
 *                           runs a week ahead of the football all weekend.
 *   the schedule's results  which games have a final score. This one.
 *
 * Both readings of the first two shipped wrong numbers. build-sos asked this
 * file's question and got it right; build-ros asked the game logs "has anybody
 * played week N", and on Friday 2026-09-25 — one Thursday game into week 3 —
 * answered 3. It then handed every player the weight fitted for three games of
 * evidence, cut a week off every rest-of-season total, and told the start/sit
 * page to decide week 4 while week 3 was still being played.
 *
 * So the definition lives here once and both of them ask it.
 */

const { fetchCSV, parseCSV } = require('./match');

const SCHEDULE_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';

/**
 * Whether a game is in the books.
 *
 * `result` is the home margin, so A TIE IS 0 AND 0 IS FALSY — a truthiness test
 * reads a drawn game as never played, which would pin the clock below that week
 * for the rest of the season. One tie a year is enough for that to matter, and
 * it is the same mistake as reading a 0-point week as a week not played.
 */
function hasResult(g) {
  return g && g.result !== null && g.result !== undefined && String(g.result).trim() !== '';
}

/**
 * How many weeks of a season are in the books, from the schedule's own rows.
 *
 * A WEEK IS FINISHED WHEN NOTHING IN IT IS STILL TO COME, which is why this
 * counts up to the first unplayed game rather than counting played ones: on a
 * Tuesday the Monday night game has a result and the week is over; on a Sunday
 * evening half the week has results and the week is not. Counting rows with
 * results would call that half-week a week.
 *
 * A postponement moves the floor DOWN rather than up, which is the safe
 * direction: it means building on less rather than on a week nobody finished.
 */
function weeksPlayedFrom(games) {
  const open = games.filter(g => !hasResult(g)).map(g => Number(g.week)).filter(Number.isFinite);
  if (!open.length) return games.length ? Math.max(...games.map(g => Number(g.week) || 0)) : 0;
  return Math.max(0, Math.min(...open) - 1);
}

/** The regular-season rows for one season, off the nflverse schedule feed. */
async function regularSeasonGames(season) {
  const rows = parseCSV(await fetchCSV(SCHEDULE_URL));
  return rows.filter(g => Number(g.season) === Number(season) && g.game_type === 'REG');
}

/** Completed weeks of `season`, straight from the feed. One fetch. */
async function weeksPlayed(season) {
  return weeksPlayedFrom(await regularSeasonGames(season));
}

module.exports = { SCHEDULE_URL, hasResult, weeksPlayedFrom, regularSeasonGames, weeksPlayed };
