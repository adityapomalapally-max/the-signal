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
 * The most recent season that has actual game data in it.
 *
 * This is the distinction every one of those hand-typed constants was really
 * reaching for. During the preseason, "the latest season with numbers in it" is
 * LAST season — asking nflverse for a 2026 stats file in August gets a 404 or,
 * worse, an empty file that looks like every player scored zero.
 */
async function latestDataSeason() {
  const s = await state();
  return s.phase === 'regular' || s.phase === 'post' ? s.season : s.previousSeason;
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

/** True once real games count, which is when preseason-built data starts aging. */
async function isInSeason() {
  const s = await state();
  return s.phase === 'regular' || s.phase === 'post';
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
  targetSeason, isInSeason, describe, fromDate,
  __setState, __reset,
};
