/**
 * scoring.js — where touchdowns actually come from
 *
 * WHY THIS EXISTS. Anytime touchdown is the second-largest market on Sleeper's
 * board — 121 lines on 2026-10-01 against 161 for receiving yards — and nothing
 * on this site spoke to it. Every layer we had described volume and efficiency:
 * targets, air yards, EPA per carry, yards per route. None of them answers the
 * only question an anytime-TD bet asks, which is not "is he good" but:
 *
 *     does his team get inside the twenty, and is he the one who gets the ball
 *     when they do
 *
 * Those are two different facts and they fail independently. A back can own
 * 70% of his team's goal-line carries on an offence that reaches the red zone
 * twice a game, and a back on a good offence can be the one who leaves the field
 * at the five. Volume boards cannot tell those apart, and a projection built on
 * season-long carries silently averages them together.
 *
 * SO THIS PUBLISHES THE TWO HALVES SEPARATELY and never multiplies them into a
 * single score. The multiplication is a forecast, and a forecast here would be
 * an assertion nobody has measured — see the caveats. What it is for is the
 * comparative read a bettor actually makes: of two backs priced the same, whose
 * offence gets there more often, and who is on the field when it does.
 *
 * THE THREE ZONES, and why these:
 *   inside 5   — the goal-line shift. Short-yardage personnel is a different
 *                eleven, and this is where that shows up.
 *   inside 10  — where play-action and fades still exist; the passing game has
 *                not been compressed out yet.
 *   inside 20  — the red zone, the conventional cut, kept because every other
 *                source quotes it and a reader needs the number they can compare.
 *
 * IT RIDES THE pbp DOWNLOAD build-scheme ALREADY PAYS FOR, on the same bargain
 * as the field map, the weekly usage and the rushing legs. `yardline_100` has
 * been in that file the whole time and nothing had ever read it.
 */

const { parseCSVLine } = require('./match');
const { teamKey } = require('./teams');

// Inside-5, inside-10, red zone. `yardline_100` is distance to the opponent's
// goal line, so these are <= comparisons and the boundaries are inclusive: a
// carry FROM the 5 is a goal-line carry, which is how every source quotes it.
const ZONES = [
  ['i5', 5],
  ['i10', 10],
  ['rz', 20],
];

// A SCRIMMAGE PLAY, AND NOTHING ELSE COUNTS AS BEING THERE.
//
// The first version of this file counted any row with yardline_100 <= 20 and put
// the league at 4.80 red-zone trips a game against a real figure of about 3.5 —
// plausible enough to ship and wrong by a third. Three kinds of row were doing it:
//
//   extra_point  is snapped from the 15, so every touchdown from ANYWHERE handed
//                its drive a red-zone trip it may never have made. 36 of them.
//   (blank)      play_type is empty on end-of-half and administrative rows, which
//                carry a yardline from context and are not plays. 182 of them —
//                the biggest single source.
//   kickoff      four rows, same shape of error.
//
// `no_play` IS kept: a penalty inside the twenty is a drive that got inside the
// twenty, which is the question. field_goal and punt are kept for the same
// reason — the ball was there. Kneels and spikes are excluded above, by choice
// rather than by accident: a side killing the clock at the fifteen reached the
// red zone in the geometric sense and was not trying to score, and this board
// exists to answer the scoring question.
//
// THE LESSON, which is the one this repo keeps relearning: a number nobody
// compared with the outside world is not a measurement. 4.80 looked fine.
const SCRIMMAGE = new Set(['run', 'pass', 'no_play', 'field_goal', 'punt']);

const blankPlayer = (team) => ({
  team,
  gamesWithTouch: 0,
  i5Carries: 0, i10Carries: 0, rzCarries: 0,
  i5Targets: 0, i10Targets: 0, rzTargets: 0,
  rushTd: 0, recTd: 0,
  weeks: {},
});

const blankTeam = () => ({
  games: 0,
  rzTrips: 0,
  i5Carries: 0, i10Carries: 0, rzCarries: 0,
  i5Targets: 0, i10Targets: 0, rzTargets: 0,
  rushTd: 0, recTd: 0,
});

const blankWeek = () => ({
  i5Carries: 0, i10Carries: 0, rzCarries: 0,
  i5Targets: 0, i10Targets: 0, rzTargets: 0,
  rushTd: 0, recTd: 0,
});

/** Rates are recomputed from totals here, never averaged across players. */
function share(part, whole) {
  if (!whole) return null;           // no denominator is not a zero share
  return Math.round((part / whole) * 1000) / 1000;
}

/**
 * One pass over a season's play-by-play.
 *
 * @param {string} pbpCsv raw play-by-play for one season
 * @returns {{players: Object, teams: Object, meta: Object}} players keyed by GSIS id
 */
function scoringFromPbp(pbpCsv) {
  const lines = pbpCsv.split('\n');
  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const I = {};
  header.forEach((h, i) => { I[h] = i; });

  // REQUIRED. Without these the layer is not thin, it is wrong — a missing
  // yardline_100 would silently count every play as outside the red zone and
  // publish a board of zeroes that looks like a finding.
  for (const need of ['week', 'posteam', 'yardline_100', 'play_type', 'season_type', 'game_id']) {
    if (I[need] === undefined) throw new Error(`pbp is missing ${need} — the schema moved`);
  }
  // Optional: if nflverse renames one of these the layer goes thin in a way the
  // meta reports, rather than taking the whole pbp build down with it.
  const optional = ['rusher_player_id', 'receiver_player_id', 'rush_touchdown',
                    'pass_touchdown', 'two_point_attempt', 'fixed_drive', 'td_player_id'];

  const players = new Map();
  const teams = new Map();
  const seenTeamGames = new Set();
  const seenPlayerGames = new Set();
  const seenRzDrives = new Set();
  let plays = 0, inZone = 0, twoPointSkipped = 0, noYardline = 0, notScrimmage = 0;

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const v = parseCSVLine(lines[i]);
    const g = c => (I[c] === undefined || v[I[c]] === undefined) ? '' : v[I[c]].replace(/"/g, '').trim();

    // Regular season only, the same cut every other board on this site uses.
    const st = g('season_type');
    if (st && st !== 'REG') continue;

    const playType = g('play_type');
    // A kneel is not an attempt and a spike is not a target. Both happen inside
    // the twenty often enough to matter — a kneel at the one would otherwise
    // read as a goal-line carry for the quarterback.
    if (playType === 'qb_kneel' || playType === 'qb_spike') continue;
    // A TWO-POINT CONVERSION IS NOT A TOUCHDOWN. It is scored from the two, so
    // it would land in every zone bucket and inflate the goal-line share of
    // whoever happened to carry it — while paying nothing on an anytime-TD
    // ticket. Counted separately and excluded from both halves.
    if (g('two_point_attempt') === '1') { twoPointSkipped++; continue; }

    const week = Number(g('week'));
    const rawTeam = g('posteam');
    if (!Number.isFinite(week) || !rawTeam) continue;
    const team = teamKey(rawTeam);     // nflverse calls the Rams LA; everything here says LAR

    const yl = Number(g('yardline_100'));
    if (!Number.isFinite(yl)) { noYardline++; continue; }
    // Administrative rows, kicks and extra points are not plays from a spot.
    if (!SCRIMMAGE.has(playType)) { notScrimmage++; continue; }
    plays++;

    const gameId = g('game_id');
    if (!teams.has(team)) teams.set(team, blankTeam());
    const t = teams.get(team);
    const tg = `${team}|${gameId}`;
    if (gameId && !seenTeamGames.has(tg)) { seenTeamGames.add(tg); t.games++; }

    const zones = ZONES.filter(([, edge]) => yl <= edge).map(([key]) => key);
    if (!zones.length) continue;       // outside the twenty: nothing here counts it
    inZone++;

    // A RED-ZONE TRIP IS A DRIVE, NOT A PLAY. Four plays from the eight are one
    // trip, and counting plays instead would make a stalling offence look like
    // a prolific one — exactly backwards for the question being asked.
    const drive = g('fixed_drive');
    if (drive && gameId) {
      const dk = `${gameId}|${drive}`;
      if (!seenRzDrives.has(dk)) { seenRzDrives.add(dk); t.rzTrips++; }
    }

    const rusher = g('rusher_player_id');
    const receiver = g('receiver_player_id');
    const rushTd = g('rush_touchdown') === '1';
    const passTd = g('pass_touchdown') === '1';

    const touch = (id, kind) => {
      if (!id) return null;
      if (!players.has(id)) players.set(id, blankPlayer(team));
      const p = players.get(id);
      p.team = team;                   // a traded player belongs to where he last touched it
      const pg = `${id}|${gameId}`;
      if (gameId && !seenPlayerGames.has(pg)) { seenPlayerGames.add(pg); p.gamesWithTouch++; }
      if (!p.weeks[week]) p.weeks[week] = blankWeek();
      for (const z of zones) {
        p[`${z}${kind}`]++;
        p.weeks[week][`${z}${kind}`]++;
        t[`${z}${kind}`]++;
      }
      return p;
    };

    if (playType === 'run' && rusher) {
      const p = touch(rusher, 'Carries');
      if (p && rushTd) { p.rushTd++; p.weeks[week].rushTd++; t.rushTd++; }
    }
    // A TARGET, not a catch: an incomplete pass in the end zone is still the
    // play the offence chose to run and still the player it chose to throw at,
    // which is the thing being measured.
    if (playType === 'pass' && receiver) {
      const p = touch(receiver, 'Targets');
      if (p && passTd) { p.recTd++; p.weeks[week].recTd++; t.recTd++; }
    }
  }

  const outPlayers = {};
  for (const [id, p] of players) {
    const t = teams.get(p.team) || blankTeam();
    outPlayers[id] = {
      team: p.team,
      gamesWithTouch: p.gamesWithTouch,
      i5Carries: p.i5Carries, i10Carries: p.i10Carries, rzCarries: p.rzCarries,
      i5Targets: p.i5Targets, i10Targets: p.i10Targets, rzTargets: p.rzTargets,
      rushTd: p.rushTd, recTd: p.recTd,
      anyTd: p.rushTd + p.recTd,
      // THE HALF THAT IS ABOUT HIM: of the chances his team had, how many were his.
      i5CarryShare: share(p.i5Carries, t.i5Carries),
      rzCarryShare: share(p.rzCarries, t.rzCarries),
      i5TargetShare: share(p.i5Targets, t.i5Targets),
      rzTargetShare: share(p.rzTargets, t.rzTargets),
      weeks: Object.keys(p.weeks).map(Number).sort((a, b) => a - b)
        .map(w => ({ week: w, ...p.weeks[w] })),
    };
  }

  const outTeams = {};
  for (const [k, t] of teams) {
    outTeams[k] = {
      ...t,
      // THE HALF THAT IS ABOUT THE OFFENCE: how often it gets there at all.
      rzTripsPerGame: t.games ? Math.round((t.rzTrips / t.games) * 100) / 100 : null,
    };
  }

  return {
    players: outPlayers,
    teams: outTeams,
    meta: {
      plays,
      playsInZone: inZone,
      twoPointAttemptsExcluded: twoPointSkipped,
      playsWithoutYardline: noYardline,
      nonScrimmageRowsExcluded: notScrimmage,
      scrimmageTypes: [...SCRIMMAGE],
      zones: { i5: 'inside 5', i10: 'inside 10', rz: 'inside 20 (red zone)' },
      columnsMissing: optional.filter(c => I[c] === undefined),
    },
  };
}

module.exports = { scoringFromPbp, share, ZONES };
