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

module.exports = { TEAM_ALIAS, NOT_A_TEAM, NFL_TEAMS, teamKey, isTeam };
