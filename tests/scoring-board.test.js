/**
 * The Scoring board — which rows reach the page, and which must not.
 *
 * The data layer is tested in scoring.test.js. What this covers is the half that
 * decides what a reader sees: the GSIS join, the position filter, and above all
 * the qualifier, because the failure mode of this particular board is a share
 * printed off one carry. 100% of one is a true statement and a useless one.
 *
 *   node --test tests/scoring-board.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPages, evalIn, setIn, ROOT } = require('./lib/pageharness.js');

const SRC = fs.readFileSync(path.join(ROOT, 'assets', 'app-pages.js'), 'utf8');

const SCORING = {
  meta: { seasons: [2026] },
  seasons: {
    2026: {
      players: {
        // A back who owns the goal line on a team that gets there often.
        'G-HENRY': { team: 'BAL', i5Carries: 9, i10Carries: 11, rzCarries: 14, i5Targets: 0,
                     i10Targets: 0, rzTargets: 1, rushTd: 5, recTd: 0, anyTd: 5,
                     i5CarryShare: 0.818, rzCarryShare: 0.7, i5TargetShare: null, rzTargetShare: 0.05, weeks: [] },
        // One carry, and it was the team's only one: a true 100% nobody should bet on.
        'G-THIN':  { team: 'NYJ', i5Carries: 1, i10Carries: 1, rzCarries: 1, i5Targets: 0,
                     i10Targets: 0, rzTargets: 0, rushTd: 1, recTd: 0, anyTd: 1,
                     i5CarryShare: 1, rzCarryShare: 1, i5TargetShare: null, rzTargetShare: null, weeks: [] },
        // A receiver, to prove the position filter and the target columns.
        'G-WR':    { team: 'BAL', i5Carries: 0, i10Carries: 0, rzCarries: 0, i5Targets: 2,
                     i10Targets: 4, rzTargets: 6, rushTd: 0, recTd: 3, anyTd: 3,
                     i5CarryShare: null, rzCarryShare: null, i5TargetShare: 0.4, rzTargetShare: 0.3, weeks: [] },
        // A player whose team is absent from the team table — the trips half
        // cannot be answered for him and must come back absent, not zero.
        'G-ORPHAN': { team: 'ZZZ', i5Carries: 4, i10Carries: 5, rzCarries: 6, i5Targets: 0,
                      i10Targets: 0, rzTargets: 0, rushTd: 2, recTd: 0, anyTd: 2,
                      i5CarryShare: 0.5, rzCarryShare: 0.5, i5TargetShare: null, rzTargetShare: null, weeks: [] },
      },
      teams: {
        BAL: { games: 4, rzTrips: 18, rzTripsPerGame: 4.5, i5Carries: 11, rzCarries: 20, i5Targets: 5, rzTargets: 20, rushTd: 7, recTd: 5 },
        NYJ: { games: 4, rzTrips: 7, rzTripsPerGame: 1.75, i5Carries: 1, rzCarries: 6, i5Targets: 2, rzTargets: 9, rushTd: 1, recTd: 2 },
      },
    },
  },
};

const PLAYERS = [
  { id: 'henry', name: 'Derrick Henry', pos: 'RB', team: 'BAL', gsisId: 'G-HENRY' },
  { id: 'thin', name: 'Thin Sample', pos: 'RB', team: 'NYJ', gsisId: 'G-THIN' },
  { id: 'wr', name: 'Zay Flowers', pos: 'WR', team: 'BAL', gsisId: 'G-WR' },
  { id: 'orphan', name: 'Orphan Back', pos: 'RB', team: 'ZZZ', gsisId: 'G-ORPHAN' },
  { id: 'nogsis', name: 'No Gsis', pos: 'RB', team: 'BAL' },
];

function board(pos, metricKey) {
  const ctx = loadPages();
  setIn(ctx, 'playersDB', PLAYERS);
  setIn(ctx, 'labScoring', SCORING);
  setIn(ctx, 'labMode', 'scoring');
  setIn(ctx, 'labPos', pos);
  setIn(ctx, 'labSeason', '2026');
  const metrics = evalIn(ctx, 'SCORING_METRICS');
  const m = metrics.find(x => x.key === metricKey);
  assert.ok(m, `no metric ${metricKey}`);
  ctx.__m = m;
  return evalIn(ctx, 'scoringRows(__m)');
}

test('a share is qualified on ITS OWN count, not on chances elsewhere', () => {
  // THE BUG THE REAL BOARD EXPOSED. The first qualifier counted total red-zone
  // chances, so a back with ONE goal-line carry and six red-zone carries cleared
  // a 3-chance floor and printed a 100% goal-line share — precisely the row the
  // floor exists to stop. A share has to be qualified on the count it divides.
  const ctx = loadPages();
  setIn(ctx, 'playersDB', [{ id: 'x', name: 'One Carry', pos: 'RB', team: 'BAL', gsisId: 'G-X' }]);
  setIn(ctx, 'labScoring', { meta: { seasons: [2026] }, seasons: { 2026: {
    players: { 'G-X': { team: 'BAL', i5Carries: 1, rzCarries: 6, i5Targets: 0, rzTargets: 2,
                        rushTd: 1, recTd: 0, anyTd: 1, i5CarryShare: 1, rzCarryShare: 0.3,
                        i5TargetShare: null, rzTargetShare: 0.1, weeks: [] } },
    teams: { BAL: { games: 4, rzTrips: 16, rzTripsPerGame: 4, i5Carries: 1, rzCarries: 20, i5Targets: 4, rzTargets: 20 } },
  } } });
  setIn(ctx, 'labMode', 'scoring'); setIn(ctx, 'labPos', 'RB'); setIn(ctx, 'labSeason', '2026');
  const m = evalIn(ctx, 'SCORING_METRICS').find(x => x.key === 'i5CarryShare');
  ctx.__m = m;
  assert.strictEqual([...evalIn(ctx, 'scoringRows(__m)')].length, 0,
    'a 100% goal-line share off a single carry reached the board because his OTHER chances cleared the floor');
});

test('a share off one carry does not reach the board, and the count does', () => {
  // THE WHOLE POINT OF THE QUALIFIER. 100% of one goal-line carry is true and
  // useless, and on a share board it outranks a back measured at 82% of eleven.
  const shares = board('RB', 'i5CarryShare').map(r => r.name);
  assert.ok(shares.includes('Derrick Henry'));
  assert.ok(!shares.includes('Thin Sample'), 'a one-chance share was published as a percentage');

  // But he is not hidden from the board entirely — on the COUNT he belongs,
  // because one goal-line carry is a fact about his week.
  const counts = board('RB', 'i5Carries').map(r => r.name);
  assert.ok(counts.includes('Thin Sample'), 'the count board hid a real carry');
});

test('the share is read in points, not as a fraction', () => {
  const [henry] = board('RB', 'i5CarryShare').filter(r => r.name === 'Derrick Henry');
  assert.strictEqual(henry.value, 81.8, 'a 0-1 share reached the page unconverted');
});

test('the position filter is the position, and a player with no GSIS id is absent', () => {
  const rbs = board('RB', 'rzCarries').map(r => r.name);
  assert.ok(!rbs.includes('Zay Flowers'), 'a receiver reached the RB board');
  assert.ok(!rbs.includes('No Gsis'), 'a player with no GSIS id was joined by something else');
  // SPREAD INTO A HOST ARRAY FIRST. Rows come back from the vm context, so their
  // Array prototype is the sandbox's and deepStrictEqual compares prototypes —
  // 'same structure but not reference-equal' is the harness talking, not the code.
  const wrs = [...board('WR', 'rzTargetShare').map(r => r.name)];
  assert.deepStrictEqual(wrs, ['Zay Flowers']);
});

test('the team half comes from the team table and is absent when the team is', () => {
  // The two halves of a touchdown fail independently, so one of them being
  // unanswerable must not invent a value for the other.
  const trips = board('RB', 'teamRzTrips');
  const byName = new Map(trips.map(r => [r.name, r.value]));
  assert.strictEqual(byName.get('Derrick Henry'), 4.5);
  assert.strictEqual(byName.get('Thin Sample'), 1.75);
  assert.ok(!byName.has('Orphan Back'), 'a player whose team is missing was given a trips figure anyway');
});

test('the board is wired end to end, not just defined', () => {
  // A mode button with no loader behind it is an empty board, and a loader with
  // no button is dead weight. Both halves asserted, because adding one without
  // the other is the mistake this is here to catch.
  assert.match(SRC, /\['scoring', 'Scoring'\]/, 'the mode has no button');
  assert.match(SRC, /scoring: \(\) => scoringRows\(m\)/, 'the mode has no row builder wired to it');
  assert.match(SRC, /loadJSON\('\/data\/scoring\.json'\)/, 'nothing loads scoring.json');
  assert.match(SRC, /labMode === 'scoring'[\s\S]{0,80}!labCharting/,
    'the load gate does not cover the scoring mode, so it renders before its data arrives');
  assert.match(SRC, /scoring: \(\) => \(\{ QB: SCORING_METRICS/, 'the mode is not in LAB_TABLES');
});

test('every metric says what it is, and the shares say what the count was', () => {
  const ctx = loadPages();
  const metrics = evalIn(ctx, 'SCORING_METRICS');
  for (const m of metrics) {
    assert.ok(m.note && m.note.length > 40, `${m.key} ships without an explanation`);
    assert.ok(m.label && m.key, 'a metric with no label or key');
  }
  // Every share metric must have a stricter qualifier than the raw count it is
  // computed from, or the thin rows arrive by the back door.
  const shares = metrics.filter(m => m.unit === '%');
  assert.ok(shares.length >= 3);
  for (const m of shares) {
    assert.ok((m.minChances || 1) > 1, `${m.key} publishes a share off a single chance`);
    assert.ok(typeof m.countedBy === 'function',
      `${m.key} has no countedBy, so its floor is measured against the wrong column`);
  }
});
