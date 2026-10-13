/**
 * teams.js — one team vocabulary
 *
 * nflverse calls the Rams `LA`. Every other file here calls them `LAR`. Left
 * unaliased, a new dataset keys the Rams differently from teams.json and their
 * entire section renders as nothing — silent, not an error, which is what makes
 * it dangerous. That already cost one debugging session in build-scheme.js, and
 * fetch-advstats.js walked into the identical trap the first time it ran: 34
 * "teams", of which one was `LA` and two were PFR's multi-team markers.
 *
 * So the alias lives here now rather than inside whichever script found it
 * first. A second copy is a copy that will drift.
 */

// Historic and alternate abbreviations → the abbreviation this site uses.
const TEAM_ALIAS = { LA: 'LAR', OAK: 'LV', SD: 'LAC', STL: 'LAR', WSH: 'WAS', JAC: 'JAX' };

// Pro Football Reference writes these when a player appeared for more than one
// team in a season. They are not teams, and summing them into a team's totals
// double-counts players who were traded.
const NOT_A_TEAM = new Set(['2TM', '3TM', '4TM', 'TOT', '']);

const NFL_TEAMS = new Set([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB',
  'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
]);

/** Normalise any abbreviation to this site's vocabulary. */
const teamKey = (abbr) => {
  const s = String(abbr || '').trim().toUpperCase();
  return TEAM_ALIAS[s] || s;
};

/** True for a real, current franchise — false for 2TM, TOT, blanks and typos. */
const isTeam = (abbr) => {
  const k = teamKey(abbr);
  return !NOT_A_TEAM.has(k) && NFL_TEAMS.has(k);
};

/**
 * CANONICAL IS NOT THE SAME AS VALID, AND THE DIFFERENCE IS THE WHOLE BUG.
 *
 * `LA` is a real team — `isTeam('LA')` is true and always was. What it is not
 * is the code this site writes. build-teams.js and build-sos.js keyed their
 * schedules straight off the feed, so the Rams landed under `LA` while every
 * other layer looked for `LAR`, and the result was not an error anywhere: the
 * Rams simply had no schedule, which the bye computation then read as a bye in
 * week 1, and seventeen opponents got an `opp` that resolved to nothing.
 *
 * So a validity check would have passed all season. This is the check that
 * fails: a code is canonical when passing it through the alias changes it into
 * itself. Anything a feed renames in future is caught the first morning.
 */
const isCanonical = (abbr) => {
  const s = String(abbr || '').trim().toUpperCase();
  return isTeam(s) && teamKey(s) === s;
};

/**
 * Throw unless every code is canonical, and — when `within` is given — unless
 * every one of them is a key that actually exists in the thing being built.
 * The second half is what catches an `opp` pointing at a team the output does
 * not contain, which is the form this bug took on the matchup board.
 *
 * It throws rather than logging, because a missing team does not read as
 * missing. "Empty beats wrong" assumes the reader can see the hole; here the
 * hole rendered as a bye week, which is a confident false statement.
 */
function assertCanonicalTeams(codes, where, within) {
  const seen = [...new Set([...codes].map(c => String(c == null ? '' : c).trim().toUpperCase()))].filter(Boolean);
  const bad = seen.filter(c => !isCanonical(c));
  if (bad.length) {
    throw new Error(`${where}: ${bad.length} non-canonical team code(s) — ${bad.join(', ')}. `
      + 'Pass every code a feed hands you through teamKey() before it becomes a key or an opponent.');
  }
  if (within) {
    const have = new Set(within);
    const missing = seen.filter(c => !have.has(c));
    if (missing.length) {
      throw new Error(`${where}: ${missing.length} team code(s) not present in the output — ${missing.join(', ')}. `
        + 'An opponent nothing can resolve renders as absent, which reads as a bye.');
    }
  }
}

module.exports = { TEAM_ALIAS, NOT_A_TEAM, NFL_TEAMS, teamKey, isTeam, isCanonical, assertCanonicalTeams };
