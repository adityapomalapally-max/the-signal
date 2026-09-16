/**
 * xfp.js — what an opportunity was WORTH, before anybody caught anything
 *
 * WHY THIS EXISTS. Fantasy points say what a player scored. They do not say
 * whether the chances he was given were any good, and those are different
 * questions with different answers: eight targets at the goal line and eight
 * screens behind the line are the same target count and not remotely the same
 * afternoon. A receiver whose season looks quiet may have been handed nothing
 * to work with; one having a career year may have caught four touchdowns on
 * throws that produce one.
 *
 * Expected fantasy points prices every opportunity by the SITUATION IT ARRIVED
 * IN, then adds them up. The gap between what a player scored and what his
 * chances were worth is the most useful single number in fantasy analysis, and
 * it is mostly a statement about touchdowns, which do not repeat.
 *
 * THIS IS A MODEL AND IT IS NOT FITTED. Every figure is an empirical mean over
 * the plays of that same season — no regression, no coefficients, no training.
 * The price of a short throw into the end zone is what short throws into the
 * end zone actually produced this year, which is a number anyone can recompute
 * from the same CSV and get the same answer.
 *
 * THE GRID WAS MEASURED, NOT CHOSEN. The first attempt crossed pass depth with
 * field position and produced `intermediate throw from inside the 10` — forty
 * plays, 4.00 expected points apiece, a cell whose value was noise and whose
 * geometry was almost impossible. The feature that actually decides what a
 * target is worth is WHERE THE BALL IS AIMED relative to the goal line
 * (`yardline_100 - air_yards`), because that is what makes a catch a
 * touchdown. Crossed with depth, which drives whether it is caught at all, it
 * gives 19 cells of which only two fall under the floor.
 *
 * The surface it produces is internally consistent in a way that is worth
 * stating, because it is the check that the arithmetic is right: IN THE END
 * ZONE CELLS THE CATCH RATE AND THE TOUCHDOWN RATE ARE THE SAME NUMBER
 * (46.9/46.9, 37.7/37.7, 30.2/30.2 in 2025) — a ball caught in the end zone is
 * a touchdown, so they cannot differ, and if they ever do the join is wrong.
 *
 * WHAT IT DOES NOT MODEL, and therefore who is not in it:
 *   - PASSING. A quarterback's fantasy points are overwhelmingly passing, and
 *     nothing here prices a dropback. Publishing a QB's rushing XFP beside his
 *     total FP would show every quarterback in the league 300 points "over
 *     expected". They are excluded rather than published wrong.
 *   - Fumbles lost and two-point conversions. Both are outcomes rather than
 *     opportunities, and neither has a situation to price. The actual-points
 *     figure here excludes them too, so the two sides of the comparison are
 *     built from exactly the same plays — a diff between numbers drawn from
 *     different play sets is not a diff.
 */

const { parseCSVLine } = require('./match.js');

// Full PPR, matching nflverse's own `fantasy_points_ppr`, which is what
// fetch-stats reads and therefore what every other points figure on this site
// already is. A different scoring here would make the diff meaningless.
const PPR = { rec: 1, yard: 0.1, td: 6 };

// Under this a cell is priced off noise. Measured on 2025: at 100 exactly two
// target cells and four carry cells fall back, together 0.5% of targets and
// 1.5% of carries. The fallback is the marginal over the SCORING dimension —
// target line for a throw, field position for a carry — because collapsing the
// other way would price a goal-line chance as an open-field one, which is the
// entire thing this file exists to tell apart.
const MIN_CELL = 100;

// A player needs enough of a season for a total to mean anything. Same order as
// the other per-player boards here.
const MIN_OPPORTUNITIES = 20;

// PASSERS ARE EXCLUDED, AND THE TEST FOUND THAT THE CAVEAT SAYING SO WAS THE
// ONLY PLACE IT WAS TRUE. Nothing here prices a dropback, so a quarterback's
// expected points would be his handful of carries set against his entire
// season — 28 of them published hundreds of points "over expected".
//
// Decided from the play-by-play rather than from the pool, because a passer
// outside the 350 is still a passer and a crosswalk that fails would silently
// let him back in. Twenty attempts is the line: it keeps the receiver who threw
// one trick-play pass, and drops anyone whose points are meaningfully passing.
// A wildcat quarterback near the boundary is genuinely ambiguous, and dropping
// him is the conservative direction — his unpriced passing points would show up
// as production he never earned.
const MIN_PASSER_ATTEMPTS = 20;

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** How far downfield the throw went — the site's existing depth vocabulary. */
function depthBand(airYards) {
  if (airYards < 0) return 'behind';
  if (airYards < 10) return 'short';
  if (airYards < 20) return 'inter';
  return 'deep';
}

/**
 * Where the ball is AIMED, as a distance from the goal line. Zero or less means
 * the target point is in the end zone. This is the scoring dimension, and it is
 * the one the first version of this grid did not have.
 */
function targetLineBand(yardsToGoalAtCatchPoint) {
  if (yardsToGoalAtCatchPoint <= 0) return 'endzone';
  if (yardsToGoalAtCatchPoint <= 5) return '1-5';
  if (yardsToGoalAtCatchPoint <= 10) return '6-10';
  if (yardsToGoalAtCatchPoint <= 20) return '11-20';
  return '21+';
}

/** Where the carry starts. For a run this is the whole scoring story. */
function fieldBand(yardline100) {
  if (yardline100 <= 5) return 'gl';
  if (yardline100 <= 10) return 'in10';
  if (yardline100 <= 20) return 'rz';
  if (yardline100 <= 50) return 'mid';
  return 'back';
}

/**
 * Down and distance, in the three states that change what a carry is for.
 * `early` is first or second down, where the run is part of a sequence;
 * `lateShort` is third or fourth and two or less, where it is a conversion
 * attempt against a loaded box; `lateLong` is the draw nobody expects.
 */
function downBand(down, toGo) {
  if (down === null || down <= 2) return 'early';
  return (toGo !== null && toGo <= 2) ? 'lateShort' : 'lateLong';
}

function blankCell() {
  return { n: 0, rec: 0, yards: 0, td: 0 };
}

// The price of one opportunity in a cell: the mean fantasy points it produced.
function priceOf(cell) {
  if (!cell || !cell.n) return null;
  return (cell.rec * PPR.rec + cell.yards * PPR.yard + cell.td * PPR.td) / cell.n;
}

/**
 * @param {string} csv raw play-by-play for one season
 * @param {{priceTable?: Object}} [opts] price the opportunities off a table
 *   built from ANOTHER season instead of this one's. A season builds its own
 *   prices from its own plays, which is right once there are enough of them and
 *   wrong in September: two weeks of 2026 priced 29.3% of opportunities off a
 *   marginal cell and put league expected 10.9% away from league actual. The
 *   table travels in the same shape it is published in — `cells` below — so the
 *   prices a reader can look up are the prices that were used.
 * @returns {{players: Object, cells: Object, meta: Object}} players keyed by GSIS id
 */
function buildXfp(csv, opts) {
  const supplied = (opts && opts.priceTable) || null;
  const lines = csv.split('\n');
  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const idx = {};
  for (const col of ['season_type', 'week', 'play_type', 'pass_attempt', 'air_yards',
                     'yardline_100', 'ydstogo', 'down', 'complete_pass', 'yards_gained',
                     'pass_touchdown', 'rush_touchdown', 'receiver_player_id', 'passer_player_id',
                     'rusher_player_id', 'qb_kneel', 'qb_spike', 'two_point_attempt', 'posteam']) {
    idx[col] = header.indexOf(col);
    if (idx[col] === -1) throw new Error(`pbp is missing the ${col} column — the schema moved`);
  }

  // PASS ONE: every opportunity, kept whole, so the second pass can price it
  // against a table built from all of them. Roughly 31,000 rows a season.
  const opps = [];
  const tgtCells = new Map();   // depth|targetLine
  const tgtMargin = new Map();  // targetLine — the fallback, always well sampled
  const carCells = new Map();   // field|downDistance
  const carMargin = new Map();  // field
  const passerAttempts = new Map();
  let skippedNoLine = 0;

  const bump = (map, key, o) => {
    let c = map.get(key);
    if (!c) { c = blankCell(); map.set(key, c); }
    c.n++;
    if (o.rec) c.rec++;
    c.yards += o.yards;
    if (o.td) c.td++;
  };

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const v = parseCSVLine(lines[i]);
    const g = (c) => { const s = v[idx[c]]; return s === undefined ? null : (s.replace(/"/g, '').trim() || null); };
    const n = (c) => num(g(c));

    // The regular season only. Playoff usage belongs to a different population
    // and the site's weekly figures are regular-season throughout.
    if (g('season_type') !== 'REG') continue;
    // A two-point conversion has no down, no yardage value and its own scoring.
    if (n('two_point_attempt') === 1) continue;

    const playType = g('play_type');
    const week = n('week');
    const yl = n('yardline_100');
    const team = g('posteam');

    if (playType === 'pass' && n('pass_attempt') === 1) {
      const thrower = g('passer_player_id');
      if (thrower) passerAttempts.set(thrower, (passerAttempts.get(thrower) || 0) + 1);
    }

    if (playType === 'pass' && n('pass_attempt') === 1 && g('receiver_player_id')) {
      const ay = n('air_yards');
      if (ay === null || yl === null) { skippedNoLine++; continue; }
      const o = {
        kind: 'target',
        id: g('receiver_player_id'),
        week, team,
        depth: depthBand(ay),
        line: targetLineBand(yl - ay),
        rec: n('complete_pass') === 1,
        yards: n('complete_pass') === 1 ? (n('yards_gained') || 0) : 0,
        td: n('pass_touchdown') === 1,
      };
      opps.push(o);
      bump(tgtCells, `${o.depth}|${o.line}`, o);
      bump(tgtMargin, o.line, o);
      continue;
    }

    if (playType === 'run' && g('rusher_player_id')) {
      if (n('qb_kneel') === 1 || n('qb_spike') === 1) continue;
      if (yl === null) { skippedNoLine++; continue; }
      const o = {
        kind: 'carry',
        id: g('rusher_player_id'),
        week, team,
        field: fieldBand(yl),
        situation: downBand(n('down'), n('ydstogo')),
        rec: false,
        yards: n('yards_gained') || 0,
        td: n('rush_touchdown') === 1,
      };
      opps.push(o);
      bump(carCells, `${o.field}|${o.situation}`, o);
      bump(carMargin, o.field, o);
    }
  }

  // PASS TWO: price each opportunity and attribute it to a player and a week.
  const by = new Map();
  let fellBack = 0;
  // An opportunity a supplied table has no cell for at all. Its own season
  // always has one — it was built from these plays — so this can only be
  // non-zero when pricing off another year, and it is reported rather than
  // silently dropped.
  let unpriced = 0;
  for (const o of opps) {
    let cell, price;
    // A SUPPLIED TABLE IS ALREADY PRICED. Its cells carry the mean they were
    // built from, so there is nothing to recompute — and the fallback rule is
    // the same rule, asked of the other season's sample.
    if (supplied) {
      const t = o.kind === 'target' ? supplied.targets : supplied.carries;
      const m = o.kind === 'target' ? supplied.targetsMarginal : supplied.carriesMarginal;
      const key = o.kind === 'target' ? `${o.depth}|${o.line}` : `${o.field}|${o.situation}`;
      const marginKey = o.kind === 'target' ? o.line : o.field;
      cell = (t && t[key]) || null;
      if (!cell || cell.n < MIN_CELL) { cell = (m && m[marginKey]) || null; fellBack++; }
      price = cell && Number.isFinite(cell.price) ? cell.price : null;
      if (price === null) { unpriced++; continue; }
    } else {
      if (o.kind === 'target') {
        cell = tgtCells.get(`${o.depth}|${o.line}`);
        if (!cell || cell.n < MIN_CELL) { cell = tgtMargin.get(o.line); fellBack++; }
      } else {
        cell = carCells.get(`${o.field}|${o.situation}`);
        if (!cell || cell.n < MIN_CELL) { cell = carMargin.get(o.field); fellBack++; }
      }
      price = priceOf(cell);
    }
    if (price === null) continue;

    // What he actually got from this same play, on the same scoring, so the two
    // sides of the diff are the same plays counted two ways.
    const actual = (o.rec ? PPR.rec : 0) + o.yards * PPR.yard + (o.td ? PPR.td : 0);

    let p = by.get(o.id);
    if (!p) { p = { targets: 0, carries: 0, xfp: 0, fp: 0, team: null, weeks: new Map() }; by.set(o.id, p); }
    if (o.kind === 'target') p.targets++; else p.carries++;
    p.xfp += price;
    p.fp += actual;
    p.team = o.team || p.team;
    if (o.week !== null) {
      let w = p.weeks.get(o.week);
      if (!w) { w = { week: o.week, fp: 0, xfp: 0, opps: 0 }; p.weeks.set(o.week, w); }
      w.fp += actual; w.xfp += price; w.opps++;
    }
  }

  const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
  const players = {};
  let passersDropped = 0;
  for (const [id, p] of by) {
    const opportunities = p.targets + p.carries;
    if (opportunities < MIN_OPPORTUNITIES) continue;
    if ((passerAttempts.get(id) || 0) >= MIN_PASSER_ATTEMPTS) { passersDropped++; continue; }
    const weeks = [...p.weeks.values()].sort((a, b) => a.week - b.week)
      .map(w => ({ week: w.week, fp: round(w.fp, 1), xfp: round(w.xfp, 1), opps: w.opps }));
    const games = weeks.length;
    players[id] = {
      team: p.team,
      games,
      targets: p.targets,
      carries: p.carries,
      fp: round(p.fp, 1),
      xfp: round(p.xfp, 1),
      diff: round(p.fp - p.xfp, 1),
      fpPerG: games ? round(p.fp / games, 2) : null,
      xfpPerG: games ? round(p.xfp / games, 2) : null,
      diffPerG: games ? round((p.fp - p.xfp) / games, 2) : null,
      weeks,
    };
  }

  // The cell table travels WITH the numbers it produced. A price nobody can
  // look up is a number a reader has to take on trust, and this whole file is
  // an argument against doing that.
  const shapeCells = (map, keyName) => {
    const out = {};
    for (const [k, c] of map) {
      out[k] = {
        n: c.n,
        catchRate: c.rec ? round(c.rec / c.n * 100, 1) : 0,
        yardsPer: round(c.yards / c.n, 2),
        tdRate: round(c.td / c.n * 100, 1),
        price: round(priceOf(c), 3),
        thin: c.n < MIN_CELL,
      };
    }
    return out;
  };

  // Over the PUBLISHED players, not over everyone priced. Summing `by` would
  // fold the dropped passers back into the check the file uses to prove its two
  // sides describe the same population.
  const leagueFp = Object.values(players).reduce((a, p) => a + p.fp, 0);
  const leagueXfp = Object.values(players).reduce((a, p) => a + p.xfp, 0);

  return {
    players,
    // THE CELL TABLE TRAVELS WITH THE NUMBERS IT PRODUCED, which means the
    // SUPPLIED one when there is one. A season priced off another year's
    // prices still builds its own cells in pass one, and publishing those
    // would hand a reader a table that priced nothing — every figure in the
    // file would be unlookupable, which is the failure this whole module is an
    // argument against.
    //
    // THE MARGINALS TRAVEL TOO. They are half the pricing rule — every thin
    // cell falls back to one — and a table published without them cannot price
    // a season on its own, which is exactly what a young season borrows it for.
    cells: supplied || {
      targets: shapeCells(tgtCells), carries: shapeCells(carCells),
      targetsMarginal: shapeCells(tgtMargin), carriesMarginal: shapeCells(carMargin),
    },
    meta: {
      opportunities: opps.length,
      targets: opps.filter(o => o.kind === 'target').length,
      carries: opps.filter(o => o.kind === 'carry').length,
      playersQualified: Object.keys(players).length,
      passersDropped,
      minPasserAttempts: MIN_PASSER_ATTEMPTS,
      minCell: MIN_CELL,
      minOpportunities: MIN_OPPORTUNITIES,
      // How much of the board was priced off a marginal rather than its own
      // cell. If this ever climbs, the grid has stopped fitting the data.
      fallbackPct: opps.length ? round(fellBack / opps.length * 100, 2) : null,
      skippedNoLine,
      ...(supplied ? { pricedFromSuppliedTable: true, unpriced } : {}),
      // The self-consistency check, in the file rather than only in a test:
      // every price is a mean over these same plays, so the two totals differ
      // only by what the fallback cells smoothed. Far apart means the pricing
      // and the attribution have come loose from each other.
      leagueFp: round(leagueFp, 1),
      leagueXfp: round(leagueXfp, 1),
      leagueRatio: leagueXfp ? round(leagueFp / leagueXfp, 4) : null,
    },
  };
}

/**
 * Can the table in a published xfp.json price a season that cannot price
 * itself? Returns { season, cells } or null, with `season` being the year whose
 * PLAYS produced the cells.
 *
 * THE SEASON A TABLE BELONGS TO IS NOT THE SEASON IT PRICED. On the first
 * borrowing morning the file carries last year's prices under a build that says
 * `season: 2026`, because 2026 is what they priced. Read as the table's own
 * season that makes it un-borrowable the next morning — the feature would have
 * worked exactly once, on a path no daily run repeats until the following
 * September.
 *
 * Three ways to be unborrowable, and each of them is a correct answer:
 *   - the cells came from a season that has not finished, which would be a
 *     young table pricing a young season: the problem wearing a different hat;
 *   - the file predates marginal cells being published, so it cannot resolve
 *     the fallback half of the pricing rule and would price part of a board and
 *     drop the rest;
 *   - there is no table at all.
 */
function borrowableTable(file, lastCompletedSeason) {
  const build = (file && file.meta && file.meta.build) || null;
  const cells = (file && file.cells) || null;
  if (!build || !cells) return null;
  if (!cells.targetsMarginal || !cells.carriesMarginal) return null;
  const season = Number(build.pricedFrom || build.season || 0);
  if (!season || season > Number(lastCompletedSeason)) return null;
  return { season, cells };
}

module.exports = {
  buildXfp, borrowableTable, MIN_CELL, MIN_OPPORTUNITIES, MIN_PASSER_ATTEMPTS, PPR,
  depthBand, targetLineBand, fieldBand, downBand, priceOf,
};
