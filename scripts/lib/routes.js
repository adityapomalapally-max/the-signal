/**
 * routes.js — which route the ball went to, and what that says about a job
 *
 * WHAT THIS IS, SAID PRECISELY, BECAUSE THE NAME INVITES A BIGGER CLAIM.
 * nflverse's participation file carries a `route` column, and it is ONE VALUE
 * PER PLAY: the concept of the route the pass was thrown to. It is not a list
 * of what all five eligible receivers ran. So this board is WHAT A PLAYER WAS
 * TARGETED ON — the shape of the throws that came his way — and it is not a
 * route tree in the PFF sense, which counts every route run whether or not the
 * ball arrived. Called a route tree it would overstate itself by a factor of
 * about five, and the file says so in its own caveats.
 *
 * That narrower thing is still worth having, and nobody publishes it free. A
 * target count says a receiver got ninety looks. This says whether they were
 * ninety screens or ninety posts, which is the difference between a player
 * whose production is capped by his role and one who is being used to win
 * games. The comparison to the league baseline is the point, exactly as it is
 * for personnel usage: 30% screens means nothing until you know the league
 * throws 9%.
 *
 * THE CONCEPTS VALIDATE THEMSELVES AGAINST DEPTH, which is the check that the
 * join is right. Measured on 2025, average depth of target by concept:
 * SCREEN -3.3 and SWING -3.2 (behind the line, caught 88% and 84% of the time),
 * QUICK OUT 2.7, SHALLOW CROSS 3.3, HITCH/CURL 5.9, SLANT 6.2, IN/DIG 12.8,
 * DEEP OUT 13.4, WHEEL 13.9, POST and CORNER 19.1, GO 24.6. Nothing in the code
 * produces that ordering — it falls out of the route label and the air yards
 * being read off the same play, and if it ever stops holding the join has moved.
 *
 * CORNER carries the highest touchdown rate of any concept at 14.4%, ahead of
 * POST at 11.8 and GO at 11.6, which is the fade to the back of the end zone
 * doing what everyone believes it does.
 */

// A player needs enough charted targets before a share of them means anything.
// Same discipline as every other board here: under this the mix is noise
// wearing a percentage.
const MIN_CHARTED_TARGETS = 25;

// Below this a concept is not published for a player at all — one wheel route
// is not "8% wheel".
const MIN_CONCEPT = 2;

function round(v, d) {
  return Math.round(v * 10 ** d) / 10 ** d;
}

function blank() {
  return { n: 0, comp: 0, yards: 0, td: 0, ay: 0, ayN: 0 };
}

function bump(cell, play) {
  cell.n++;
  if (play.complete) { cell.comp++; cell.yards += play.yards || 0; }
  if (play.passTd) cell.td++;
  if (Number.isFinite(play.airYards)) { cell.ay += play.airYards; cell.ayN++; }
}

function shape(cell) {
  return {
    targets: cell.n,
    catchRate: round(cell.comp / cell.n * 100, 1),
    yardsPerTarget: round(cell.yards / cell.n, 2),
    tdRate: round(cell.td / cell.n * 100, 1),
    aDOT: cell.ayN ? round(cell.ay / cell.ayN, 1) : null,
  };
}

/**
 * Accumulates one participation row. Called from build-scheme's existing loop,
 * so this costs no extra download and no second pass over 45,000 rows.
 *
 * @param {object} acc      the accumulator returned by blankRoutes()
 * @param {string} route    participation's `route` value for this play
 * @param {object} play     the lean pbp row for the same play
 * @param {Map}    gsisIndex GSIS id -> pool player
 */
function tallyRoute(acc, route, play, gsisIndex) {
  if (!play || !play.isPass) return;
  acc.passPlays++;
  const concept = (route || '').trim();
  if (!concept) return;                       // charted for 90% of pass plays
  acc.charted++;

  // THE LEAGUE BASELINE IS BUILT FROM EVERY CHARTED THROW, not only the ones
  // that reached a pool player. A baseline drawn from the 350 players this site
  // tracks would be the pool's own habits, and comparing a pool player against
  // it would flatter everybody toward the middle.
  acc.league[concept] = acc.league[concept] || blank();
  bump(acc.league[concept], play);

  if (!play.receiver) return;                 // charted, attributed to nobody
  const player = gsisIndex.get(play.receiver);
  if (!player) return;                        // not in the pool
  acc.attributed++;

  const p = acc.players[player.id] = acc.players[player.id]
    || { name: player.name, pos: player.pos, team: play.posteam || null, concepts: {} };
  p.team = play.posteam || p.team;
  p.concepts[concept] = p.concepts[concept] || blank();
  bump(p.concepts[concept], play);
}

function blankRoutes() {
  return { league: {}, players: {}, passPlays: 0, charted: 0, attributed: 0 };
}

/**
 * Turns the accumulator into the published shape.
 * @returns {{league: Object, players: Object, meta: Object}}
 */
function finishRoutes(acc) {
  const league = {};
  const leagueTotal = Object.values(acc.league).reduce((a, c) => a + c.n, 0);
  for (const [concept, cell] of Object.entries(acc.league)) {
    league[concept] = { ...shape(cell), share: round(cell.n / leagueTotal * 100, 1) };
  }

  const players = {};
  for (const [id, p] of Object.entries(acc.players)) {
    const total = Object.values(p.concepts).reduce((a, c) => a + c.n, 0);
    if (total < MIN_CHARTED_TARGETS) continue;
    const mix = {};
    // WHAT THE FLOOR DROPS IS STATED, NOT SWALLOWED. A player with 25 charted
    // targets spread across nine concepts has several seen once, and dropping
    // them silently left one mix summing to 73% — a page showing percentages
    // that account for three quarters of a player and say nothing about the
    // rest. The remainder is carried as its own figure so the shares always
    // close, the same discipline the field map follows with its thin cells.
    let belowFloorTargets = 0;
    for (const [concept, cell] of Object.entries(p.concepts)) {
      if (cell.n < MIN_CONCEPT) { belowFloorTargets += cell.n; continue; }
      mix[concept] = {
        share: round(cell.n / total * 100, 1),
        // What the league throws to this concept, carried alongside so the page
        // never has to look it up and can never quote a share without its
        // baseline. 30% screens means nothing until you know the league is 9%.
        leagueShare: league[concept] ? league[concept].share : null,
        ...shape(cell),
      };
    }
    if (!Object.keys(mix).length) continue;
    // The concept he sees most, and how far above the league that is. This is
    // the sentence a reader actually takes away.
    const lead = Object.entries(mix).sort((a, b) => b[1].share - a[1].share)[0];
    players[id] = {
      name: p.name, pos: p.pos, team: p.team,
      chartedTargets: total,
      belowFloor: belowFloorTargets
        ? { targets: belowFloorTargets, share: round(belowFloorTargets / total * 100, 1) }
        : null,
      lead: { concept: lead[0], share: lead[1].share, leagueShare: lead[1].leagueShare },
      mix,
    };
  }

  return {
    league,
    players,
    meta: {
      passPlays: acc.passPlays,
      charted: acc.charted,
      attributed: acc.attributed,
      chartedPct: acc.passPlays ? round(acc.charted / acc.passPlays * 100, 1) : null,
      minChartedTargets: MIN_CHARTED_TARGETS,
      minConcept: MIN_CONCEPT,
      concepts: Object.keys(league).sort(),
    },
  };
}

module.exports = {
  blankRoutes, tallyRoute, finishRoutes,
  MIN_CHARTED_TARGETS, MIN_CONCEPT, shape,
};
