/**
 * Where touchdowns come from, and the plays that only look like chances.
 *
 * An anytime-TD read rests on two facts that fail independently — how often the
 * offence reaches the twenty, and whose hands the ball is in when it does — so
 * each is asserted on its own here, and the things that masquerade as goal-line
 * opportunity are asserted to be absent: a two-point conversion scored from the
 * two, a kneel at the one, a playoff game in a regular-season board.
 *
 *   node --test tests/scoring.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const { scoringFromPbp, share } = require('../scripts/lib/scoring');

const COLS = ['game_id', 'week', 'posteam', 'yardline_100', 'play_type', 'season_type',
              'rusher_player_id', 'receiver_player_id', 'rush_touchdown', 'pass_touchdown',
              'two_point_attempt', 'fixed_drive', 'td_player_id'];

/** A pbp CSV from row objects, so a test says only what it is about. */
function pbp(rows) {
  const line = (r) => COLS.map(c => {
    const v = r[c];
    if (v === undefined || v === null) return '';
    return String(v);
  }).join(',');
  const d = (r) => ({
    game_id: 'G1', week: 1, posteam: 'KC', season_type: 'REG', fixed_drive: 1, ...r,
  });
  return [COLS.join(','), ...rows.map(r => line(d(r)))].join('\n') + '\n';
}

const RUN = (y, extra = {}) => ({ play_type: 'run', yardline_100: y, rusher_player_id: 'RB1', ...extra });
const PASS = (y, extra = {}) => ({ play_type: 'pass', yardline_100: y, receiver_player_id: 'WR1', ...extra });

test('the zones nest: a carry from the 5 is also inside 10 and inside the red zone', () => {
  // They are not three separate buckets to be summed — they are three questions
  // about the same carry, and a reader comparing rzCarries with i5Carries is
  // comparing a total with a subset of itself.
  const s = scoringFromPbp(pbp([RUN(5)]));
  const p = s.players.RB1;
  assert.strictEqual(p.i5Carries, 1);
  assert.strictEqual(p.i10Carries, 1);
  assert.strictEqual(p.rzCarries, 1);
});

test('the boundaries are the boundaries', () => {
  // ON the line, not either side of it: a carry from the 5 is a goal-line carry
  // and a carry from the 6 is not, which is how every source quotes it.
  const s = scoringFromPbp(pbp([RUN(5, { rusher_player_id: 'A' }), RUN(6, { rusher_player_id: 'B' }),
                               RUN(20, { rusher_player_id: 'C' }), RUN(21, { rusher_player_id: 'D' })]));
  assert.strictEqual(s.players.A.i5Carries, 1, 'the 5 is inside 5');
  assert.strictEqual(s.players.B.i5Carries, 0, 'the 6 is not inside 5');
  assert.strictEqual(s.players.B.i10Carries, 1);
  assert.strictEqual(s.players.C.rzCarries, 1, 'the 20 is the red zone');
  assert.ok(!s.players.D, 'a carry from the 21 is not a scoring chance and he is absent, not zero');
});

test('a two-point conversion is not a touchdown and not a goal-line carry', () => {
  // IT IS SCORED FROM THE TWO, so it lands in every zone bucket if nothing stops
  // it — inflating the goal-line share of whoever carried it while paying
  // nothing on an anytime-TD ticket.
  const s = scoringFromPbp(pbp([RUN(2, { two_point_attempt: 1, rush_touchdown: 1 })]));
  assert.ok(!s.players.RB1, 'a two-point attempt was counted as a goal-line carry');
  assert.strictEqual(s.meta.twoPointAttemptsExcluded, 1, 'it was not even counted as excluded');
});

test('a kneel inside the twenty is not a red-zone trip', () => {
  // THIS TEST WAS DECORATION AND A MUTATION PROVED IT. It used to assert only
  // that the kneeler got no carry — which passes with the filter deleted, since
  // a kneel's play_type is never 'run' and could not have reached that branch.
  //
  // What the filter actually protects is the TEAM half: a side killing the clock
  // at the opponent's fifteen would otherwise register a red-zone trip it never
  // tried to score on, and rzTripsPerGame is the number a bettor reads first.
  const s = scoringFromPbp(pbp([
    { play_type: 'qb_kneel', yardline_100: 1, rusher_player_id: 'QB1' },
    { play_type: 'qb_spike', yardline_100: 8, receiver_player_id: 'WR9', fixed_drive: 2 },
  ]));
  assert.ok(!s.players.QB1, 'the kneeler was credited with a goal-line carry');
  assert.ok(!s.players.WR9, 'the spike was credited as a target');
  assert.strictEqual(s.teams.KC, undefined,
    'a drive that only knelt and spiked inside the twenty was counted as reaching it');
  assert.strictEqual(s.meta.plays, 0, 'a kneel counted as a play this board had seen');
});

test('a red-zone trip is a drive, not a play', () => {
  // Four plays from the eight are ONE trip. Counting plays would make an offence
  // that stalls at the fifteen look more prolific than one that scores on first
  // down, which is backwards for the question being asked.
  const s = scoringFromPbp(pbp([RUN(8), RUN(6), PASS(6), RUN(2)]));
  assert.strictEqual(s.teams.KC.rzTrips, 1);
  const two = scoringFromPbp(pbp([RUN(8), RUN(8, { fixed_drive: 2 })]));
  assert.strictEqual(two.teams.KC.rzTrips, 2, 'two drives inside the twenty are two trips');
});

test('the playoffs are not in a regular-season board', () => {
  const s = scoringFromPbp(pbp([RUN(3), RUN(3, { season_type: 'POST', rusher_player_id: 'RB2' })]));
  assert.strictEqual(s.players.RB1.i5Carries, 1);
  assert.ok(!s.players.RB2, 'a playoff carry reached a regular-season board');
});

test('nflverse calls the Rams LA and this board says LAR', () => {
  // A team vocabulary mismatch does not error, it just leaves every Rams player
  // with no share at all — the denominator is keyed on a team that never appears.
  const s = scoringFromPbp(pbp([RUN(4, { posteam: 'LA' })]));
  assert.ok(s.teams.LAR, 'posteam LA did not become LAR');
  assert.ok(!s.teams.LA);
  assert.strictEqual(s.players.RB1.team, 'LAR');
  assert.strictEqual(s.players.RB1.i5CarryShare, 1, 'the share found no denominator');
});

test('an incomplete pass in the end zone is still a chance that was given to him', () => {
  // The bet is about opportunity. A fade nobody caught is still the play the
  // offence chose and still the man it chose to throw at.
  const s = scoringFromPbp(pbp([PASS(3)]));
  assert.strictEqual(s.players.WR1.i5Targets, 1);
  assert.strictEqual(s.players.WR1.recTd, 0);
});

test('touchdowns land on the player who scored them, by type', () => {
  const s = scoringFromPbp(pbp([
    RUN(1, { rush_touchdown: 1 }),
    PASS(4, { pass_touchdown: 1 }),
  ]));
  assert.strictEqual(s.players.RB1.rushTd, 1);
  assert.strictEqual(s.players.RB1.recTd, 0);
  assert.strictEqual(s.players.WR1.recTd, 1);
  assert.strictEqual(s.players.WR1.anyTd, 1);
  assert.strictEqual(s.teams.KC.rushTd, 1);
  assert.strictEqual(s.teams.KC.recTd, 1);
});

test('shares come out of totals, and no denominator is not a zero', () => {
  // EMPTY BEATS WRONG. A back on an offence with no goal-line carries has an
  // UNKNOWN share, not a 0% one, and 0 would rank him below a back measured at 5%.
  const s = scoringFromPbp(pbp([RUN(3, { rusher_player_id: 'A' }), RUN(3, { rusher_player_id: 'A' }),
                                RUN(3, { rusher_player_id: 'B' }), PASS(15, { receiver_player_id: 'W' })]));
  assert.strictEqual(s.players.A.i5CarryShare, 0.667, '2 of 3 goal-line carries');
  assert.strictEqual(s.players.B.i5CarryShare, 0.333);
  assert.strictEqual(s.players.W.i5TargetShare, null, 'no inside-5 targets on this team is not a 0% share');
  assert.strictEqual(share(1, 0), null);
});

test('a week is a week, and the weekly series adds up to the season', () => {
  const s = scoringFromPbp(pbp([
    RUN(3), RUN(3, { week: 2, game_id: 'G2' }), RUN(12, { week: 2, game_id: 'G2' }),
  ]));
  const p = s.players.RB1;
  assert.deepStrictEqual(p.weeks.map(w => w.week), [1, 2]);
  assert.strictEqual(p.weeks.reduce((n, w) => n + w.i5Carries, 0), p.i5Carries);
  assert.strictEqual(p.weeks.reduce((n, w) => n + w.rzCarries, 0), p.rzCarries);
  assert.strictEqual(p.gamesWithTouch, 2, 'two games, counted once each');
});

test('a missing yardline_100 is a moved schema, not a board of zeroes', () => {
  // THE FAILURE THAT WOULD LOOK LIKE A FINDING. Without the column every play
  // reads as outside the twenty and the whole board publishes empty, which is
  // indistinguishable from an offence that never got there.
  const csv = 'game_id,week,posteam,play_type,season_type\nG1,1,KC,run,REG\n';
  assert.throws(() => scoringFromPbp(csv), /yardline_100/);
});

test('the meta says how much of the file it actually saw', () => {
  const s = scoringFromPbp(pbp([RUN(3), RUN(50), PASS(80)]));
  assert.strictEqual(s.meta.plays, 3);
  assert.strictEqual(s.meta.playsInZone, 1);
  assert.deepStrictEqual(s.meta.columnsMissing, []);
});

test('requiring build-scheme does not start a 93MB build', () => {
  // THE GUARD THAT WAS MISSING, and it cost a live fetch to find out: requiring
  // this file ran main(), which downloads a season of play-by-play and rewrites
  // nine files in data/. build-sos has had this guard and a test for it since
  // 2026-09-24 — the lesson was simply never carried to the script where running
  // it by accident costs the most.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-scheme.js'), 'utf8');
  assert.match(src, /require\.main === module/, 'requiring build-scheme.js runs the whole build');
  // And the guard has to be around the CALL, not merely present in the file.
  assert.match(src, /require\.main === module\s*\)\s*\{[\s\S]{0,200}main\(\)/,
    'the guard exists but main() is called outside it');
});

test('an extra point is not a red-zone trip, and neither is an administrative row', () => {
  // THE BUG THAT SHIPPED A PLAUSIBLE NUMBER. An extra point is snapped from the
  // 15, so counting it put every touchdown drive inside the twenty whether it
  // got there or not, and the league came out at 4.80 trips a game against a
  // real ~3.5. Blank play_type rows (end of half, administrative) did more
  // damage still: 182 drives.
  const s = scoringFromPbp(pbp([
    { play_type: 'extra_point', yardline_100: 15, fixed_drive: 1 },
    { play_type: '', yardline_100: 12, fixed_drive: 2 },
    { play_type: 'kickoff', yardline_100: 10, fixed_drive: 3 },
  ]));
  assert.strictEqual(s.teams.KC, undefined,
    'a kick or an administrative row was counted as reaching the red zone');
  assert.strictEqual(s.meta.plays, 0);
  assert.strictEqual(s.meta.nonScrimmageRowsExcluded, 3);
});

test('a penalty inside the twenty is still a drive that got inside the twenty', () => {
  // no_play is kept on purpose: the ball was there, which is the question being
  // asked. Dropping it would undercount the offences that stall on flags.
  const s = scoringFromPbp(pbp([{ play_type: 'no_play', yardline_100: 9 }]));
  assert.strictEqual(s.teams.KC.rzTrips, 1);
  const fg = scoringFromPbp(pbp([{ play_type: 'field_goal', yardline_100: 18 }]));
  assert.strictEqual(fg.teams.KC.rzTrips, 1, 'a field goal from the 18 means the ball was at the 18');
});

test('a team plays games, not plays — the denominator of every per-game figure', () => {
  // THE MUTATION THAT LIVED. `gameId && !seenTeamGames.has(tg)` survived the gate
  // because nothing here counted a team's games across more than one play, and
  // with `||` in place of `&&` the counter increments on EVERY play. That number
  // is the denominator of rzTripsPerGame — the figure this whole board was
  // validated against the league mean of 3.36 on — so inflating it silently
  // divides every offence's trips by its play count.
  const s = scoringFromPbp(pbp([
    RUN(8), RUN(6), PASS(4),                                        // game 1, one drive
    RUN(8, { game_id: 'G2', fixed_drive: 7 }),                      // game 2
    PASS(5, { game_id: 'G2', fixed_drive: 7 }),
    RUN(9, { game_id: 'G2', fixed_drive: 8 }),                      // a second drive in game 2
  ]));
  const t = s.teams.KC;
  assert.strictEqual(t.games, 2, 'games counted plays rather than games');
  assert.strictEqual(t.rzTrips, 3, 'three distinct drives reached the twenty');
  assert.strictEqual(t.rzTripsPerGame, 1.5, '3 trips over 2 games');
});

test('a player plays games, not plays, either', () => {
  const s = scoringFromPbp(pbp([
    RUN(8), RUN(6),
    RUN(8, { game_id: 'G2', fixed_drive: 7 }),
  ]));
  assert.strictEqual(s.players.RB1.gamesWithTouch, 2,
    'his games were counted per touch rather than per game');
});
