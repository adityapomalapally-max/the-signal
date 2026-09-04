/**
 * season.js — one place that knows what season it is
 *
 * THE PROBLEM THIS EXISTS FOR
 * Nine scripts each carried their own hand-typed season boundary, several with
 * comments telling the next person to keep them in step with each other by
 * remembering:
 *
 *   fetch-stats.js       SEASONS = [2023, 2024, 2025]   "keep in step with fetch-ngs"
 *   fetch-ngs.js         SEASONS = [2023, 2024, 2025]   "keep in step with fetch-stats"
 *   fetch-injuries.js    SEASONS = [2023, 2024, 2025]   "keep in step with fetch-stats"
 *   build-scheme.js      HISTORY = [2023, 2024, 2025]
 *   build-injury-curves  SEASONS = [2023, 2024, 2025]
 *   build-rankings.js    AVAIL_SEASONS = [2023, 2024, 2025]
 *   build-teams.js       SEASON = 2026, STATS_SEASON = 2025
 *   build-sos.js         SEASON = 2026, DEF_SEASON = 2025
 *   fetch-adp.js         SEASON = 2026
 *
 * On the first Sunday of the regular season, 2026 stats begin to exist and not
 * one of those scripts asks for them. Nothing errors. The site simply goes on
 * publishing last season's numbers under this season's heading, for as long as
 * it takes somebody to notice — which is the same failure as the nflverse stats
 * file moving, and that one went unnoticed for months.
 *
 * A boundary that has to be remembered is a boundary that will be forgotten, so
 * it is derived here instead, from a feed that already knows.
 *
 * ALL NINE ARE MIGRATED NOW — and five of them were, for months, while this
 * block went on describing the problem as though it were solved. The last four
 * (build-scheme, build-teams, build-rankings, build-injury-curves) were only
 * found because scripts/dry-run-rollover.js rehearsed the rollover and caught
 * build-scheme fetching last season while being told it was this one. A list of
 * things to fix, left in place after some of them are fixed, reads as a list of
 * things still broken; tests/rollover.test.js is what actually keeps this true
 * now, and it fails on any daily script holding a year that nothing can move.
 *
 * THE SOURCE
 * Sleeper's /state/nfl is free, unauthenticated, and already a dependency of the
 * daily Action. It carries season, week, and season_type ("pre" | "regular" |
 * "post" | "off"), which is exactly the question.
 *
 * If it is unreachable the date-based fallback takes over. That fallback is
 * DELIBERATELY CONSERVATIVE: it will call the season "pre" for a few days longer
 * than it should rather than declare a regular season that has not started, on
 * the principle that publishing last week's data late beats publishing this
 * week's data that does not exist yet.
 */

const STATE_URL = 'https://api.sleeper.app/v1/state/nfl';

let cached = null;

/**
 * DRIVING THE CALENDAR FROM OUTSIDE, for the rollover dry run.
 *
 * The rollover is a failure with no symptom — the fetches go on asking for the
 * season they were told about, every build succeeds, the site renders — so the
 * only way to find out what the pipeline does on the first Sunday in September
 * is to tell it that day has come and watch. `__setState` does that inside a
 * test, but every script here is a separate process, and this is what reaches
 * them:
 *
 *   SIGNAL_SEASON_STATE='{"season":2026,"week":1,"phase":"regular"}' node scripts/...
 *
 * IT REFUSES TO RUN IN CI. A simulated calendar that reached the daily Action
 * would publish a file built for a season the league has not played, which is
 * the exact thing scripts/../tests/no-simulated-data.test.js exists to catch —
 * and catching it after the commit is later than refusing it before. It is also
 * announced on every single read, because a quiet override is a lie about where
 * a number came from.
 */
function fromEnv() {
  const raw = process.env.SIGNAL_SEASON_STATE;
  if (!raw) return null;
  if (process.env.GITHUB_ACTIONS || process.env.CI) {
    console.error('[season] ABORT: SIGNAL_SEASON_STATE is set in CI. A simulated calendar must never build a file that ships.');
    process.exit(1);
  }
  let s;
  try {
    s = JSON.parse(raw);
  } catch (e) {
    console.error(`[season] ABORT: SIGNAL_SEASON_STATE is not valid JSON — ${e.message}`);
    process.exit(1);
  }
  if (!s || !s.season) {
    console.error('[season] ABORT: SIGNAL_SEASON_STATE has no season in it');
    process.exit(1);
  }
  const out = {
    season: Number(s.season),
    previousSeason: Number(s.previousSeason || Number(s.season) - 1),
    week: Number(s.week || 0),
    phase: normalizePhase(s.phase || s.season_type),
    seasonStartDate: s.seasonStartDate || s.season_start_date || null,
    source: 'SIMULATED via SIGNAL_SEASON_STATE',
  };
  console.error(`[season] *** SIMULATED CALENDAR: ${out.season} ${out.phase} week ${out.week} — nothing built under this may be committed ***`);
  return out;
}

/** The NFL calendar, from the feed if it answers and from the date if it does not. */
async function state() {
  if (cached) return cached;
  const forced = fromEnv();
  if (forced) { cached = forced; return cached; }
  try {
    const res = await fetch(STATE_URL);
    if (!res.ok) throw new Error(`state/nfl returned ${res.status}`);
    const s = await res.json();
    if (!s || !s.season) throw new Error('state/nfl returned no season');
    cached = {
      season: Number(s.season),
      previousSeason: Number(s.previous_season || Number(s.season) - 1),
      week: Number(s.week || 0),
      phase: normalizePhase(s.season_type),
      // THE FIELD THAT SAYS WHETHER ANY OF THIS HAS BEEN PLAYED. It was in the
      // payload all along and thrown away here; gamesHaveStarted() reads it.
      seasonStartDate: s.season_start_date || null,
      source: 'sleeper/state/nfl',
    };
    return cached;
  } catch (e) {
    cached = fromDate(new Date());
    cached.source = `date fallback (${e.message})`;
    return cached;
  }
}

function normalizePhase(t) {
  const s = String(t || '').toLowerCase();
  if (s === 'regular') return 'regular';
  if (s === 'post') return 'post';
  if (s === 'pre') return 'pre';
  return 'off';
}

/**
 * The league year rolls over in March, not January: a season is named for the
 * calendar year it starts in, so January's playoffs still belong to last year.
 */
function fromDate(now) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;   // 1-12
  const season = m >= 3 ? y : y - 1;
  let phase = 'off';
  if (m >= 8 && m <= 8) phase = 'pre';
  else if (m >= 9 && m <= 12) phase = 'regular';
  else if (m === 1 || m === 2) phase = 'post';
  return { season, previousSeason: season - 1, week: 0, phase };
}

/**
 * Has the league actually played any of this season yet?
 *
 * SLEEPER SAYS "regular" BEFORE ANYBODY HAS PLAYED. On 2026-08-29 /state/nfl
 * began reporting season_type "regular", week 1 — while the same payload said
 * season_start_date 2026-09-09, eleven days out. Everything downstream believed
 * the flag: the fetch window opened to include 2026, nflverse 404'd
 * stats_player_week_2026.csv because no 2026 game had been played, fetch-stats
 * exited 1, and every step after it in the daily Action — the commit included —
 * was skipped. Eleven consecutive daily runs pushed nothing, and the history
 * series lost eleven days of ADP, depth-chart and ranking snapshots that cannot
 * be backfilled from anywhere.
 *
 * `phase` answers "which part of the calendar is it", which is NOT the question
 * the fetches are asking. This is that question, asked in one place.
 */
function gamesHaveStarted(s, now = new Date()) {
  if (s.phase === 'post') return true;
  if (s.phase !== 'regular') return false;

  // Sleeper publishes the date of the first game. Before it, "regular" is a
  // label on a season nobody has played.
  const start = s.seasonStartDate ? new Date(`${s.seasonStartDate}T00:00:00Z`) : null;
  if (start && !Number.isNaN(start.getTime())) return now >= start;

  // No start date — the feed's schema moved, or this is the date fallback.
  // TWO INDEPENDENT CORROBORATORS, because the failure to avoid here is the
  // silent one: one missing field must never leave the pipeline quietly a year
  // stale in November. Week 2 means week 1 was played, and the NFL has never
  // opened a season later than the second week of September.
  return (s.week || 0) >= 2 || now >= new Date(Date.UTC(s.season, 8, 11));
}

/**
 * The most recent season that has actual game data in it.
 *
 * This is the distinction every one of those hand-typed constants was really
 * reaching for. During the preseason, "the latest season with numbers in it" is
 * LAST season — asking nflverse for a 2026 stats file in August gets a 404 or,
 * worse, an empty file that looks like every player scored zero.
 */
async function latestDataSeason() {
  const s = await state();
  return gamesHaveStarted(s) ? s.season : s.previousSeason;
}

/** The most recent COMPLETED season — never the one in progress. */
async function lastCompletedSeason() {
  const s = await state();
  return s.phase === 'post' || s.phase === 'off' ? s.season : s.previousSeason;
}

/**
 * The window of seasons to fetch: the n most recent that have data, oldest
 * first. Replaces every hand-typed [2023, 2024, 2025] and rolls itself over on
 * the day the first regular-season game is played.
 */
async function dataSeasons(count = 3) {
  const latest = await latestDataSeason();
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(latest - i);
  return out;
}

/** The season being played or prepared for — what a projection is ABOUT. */
async function targetSeason() {
  const s = await state();
  return s.season;
}

/**
 * True once real games count, which is when preseason-built data starts aging.
 * This always MEANT "games have been played" — it just asked `phase`, which
 * turns true up to eleven days early. See gamesHaveStarted().
 */
async function isInSeason() {
  return gamesHaveStarted(await state());
}

/** For logging. Every script that reads a season should say which one it read. */
async function describe() {
  const s = await state();
  return `${s.season} ${s.phase}${s.week ? ` week ${s.week}` : ''} (via ${s.source})`;
}

// Tests need to drive the calendar without a network or a time machine.
function __setState(s) { cached = s; }
function __reset() { cached = null; }

module.exports = {
  state, dataSeasons, latestDataSeason, lastCompletedSeason,
  targetSeason, isInSeason, describe, fromDate, gamesHaveStarted,
  __setState, __reset,
};
