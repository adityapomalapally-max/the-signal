/**
 * THE SEASON A SHAPE CAN BE ASSERTED OF.
 *
 * Several tests here assert what a season LOOKS like: a team throws 200-plus
 * dropbacks, receivers are the first read far more often than backs, a
 * qualified back has 100 carries. Every one of those is false in September for
 * reasons that are not bugs — and on the morning the in-season layers first
 * built for a live season, six of them went red at once, all of them correct
 * about the data and wrong about what it meant.
 *
 * It is the same failure as the six tests pinned to the preseason on
 * 2026-09-10: a test that encodes a full season as a rule. The split is the
 * fix. A young season is not exempt from being CONSISTENT — rates still have
 * to be their numerator over their denominator, buckets still have to sum to
 * the total, nobody may have more drops than targets — it is exempt only from
 * being BIG, and the assertions about size ask a season that finished.
 *
 * The boundary is lib/season.js's, because there is one definition of it here
 * and this is not allowed to be a second. It resolves off the calendar when
 * Sleeper is unreachable, so this needs no network.
 */

const season = require('../../scripts/lib/season');

/**
 * The newest FINISHED season present in `seasons`, or null if a file holds
 * nothing but the season being played — in which case a scale assertion has
 * nothing honest to run against and the caller should say so rather than
 * quietly pass.
 */
async function completedSeason(seasons) {
  const last = await season.lastCompletedSeason();
  const years = [...seasons].map(Number).filter(y => y <= last).sort((a, b) => b - a);
  return years.length ? years[0] : null;
}

module.exports = { completedSeason };
