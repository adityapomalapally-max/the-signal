/**
 * rushing.js — what a carry was worth, from play-by-play
 *
 * WHY THIS EXISTS. RYOE isolates the back from his blocking, which is the
 * hardest thing to measure and the easiest thing to over-read: it is
 * explosion-driven, right-skewed, and repeats year to year at about r = 0.22.
 * Quoted alone it invites a reader to project from a number that mostly does
 * not project.
 *
 * The method the analysts who use it well actually follow is a TRIANGULATION —
 * RYOE for talent isolation, EPA per carry for situational value, and yards per
 * carry as the raw check. The three disagree often, and where they disagree is
 * the finding: a back can lead in RYOE while losing on EPA because his good
 * runs came on first and ten with a lead, which is worth less than the same
 * yardage on third and two.
 *
 * EPA per carry is the leg this site did not have. It comes out of the same
 * play-by-play download build-scheme already pays for — the sixth output of one
 * 93MB fetch, on the same bargain as the field map and the weekly usage.
 *
 * SUCCESS RATE TRAVELS WITH IT, because EPA per carry is itself an average of a
 * skewed distribution and a single 70-yard touchdown moves it a long way.
 * Success rate — the share of carries with positive EPA — is the same question
 * asked in a way one run cannot dominate.
 */

const { parseCSV } = require('./match');

// A carry needs a real rusher and a real EPA. Kneels are filtered by play_type.
const MIN_CARRIES = 20;

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

/**
 * @param {string} csv raw play-by-play for one season
 * @returns {{players: Object, meta: Object}} keyed by GSIS id
 */
function buildRushing(csv) {
  const rows = parseCSV(csv);
  const by = new Map();
  let carries = 0, noEpa = 0;

  for (const r of rows) {
    if (String(r.play_type) !== 'run') continue;
    // Kneels and spikes are not carries. nflverse marks them, and counted in
    // they drag every leader's EPA down by a fixed amount that has nothing to
    // do with running the ball.
    if (String(r.qb_kneel) === '1' || String(r.qb_spike) === '1') continue;
    const id = r.rusher_player_id;
    if (!id) continue;
    const epa = num(r.epa);
    carries++;
    if (epa === null) { noEpa++; continue; }

    const cur = by.get(id) || { carries: 0, epaSum: 0, success: 0, yards: 0, team: null };
    cur.carries++;
    cur.epaSum += epa;
    if (epa > 0) cur.success++;
    cur.yards += num(r.yards_gained) || 0;
    // The team he was playing FOR on this carry, which is not necessarily the
    // team that employs him now.
    cur.team = r.posteam || cur.team;
    by.set(id, cur);
  }

  const players = {};
  for (const [id, v] of by) {
    if (v.carries < MIN_CARRIES) continue;
    players[id] = {
      carries: v.carries,
      team: v.team,
      epaPerCarry: Math.round((v.epaSum / v.carries) * 1000) / 1000,
      successRate: Math.round((v.success / v.carries) * 1000) / 10,
      ypc: Math.round((v.yards / v.carries) * 100) / 100,
    };
  }

  return {
    players,
    meta: {
      carries,
      rushersQualified: Object.keys(players).length,
      minCarries: MIN_CARRIES,
      // If play-by-play ever stops carrying EPA this is how it shows up: a
      // build that succeeds with an empty board.
      missingEpaPct: carries ? Math.round((noEpa / carries) * 1000) / 10 : null,
    },
  };
}

module.exports = { buildRushing, MIN_CARRIES };
