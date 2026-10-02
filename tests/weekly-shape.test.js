/**
 * The weekly log's shape, and the one field whose absence was a contradiction.
 *
 * `buildWeeklyLog` gives each position the columns its position is read on. For
 * a quarterback that meant passing, plus rushYds and rushTD — his rushing
 * PRODUCTION without the carries that produced it. Anything asking how he got
 * those yards read a man who gained 40 on the ground on no attempts.
 *
 * It surfaced on 2026-10-02 against a rushing-yards prop board, the one market
 * where a quarterback's volume IS the question: Lamar Jackson's line was 31.5
 * and his log said 40/34/50 yards on nothing at all.
 *
 *   node --test tests/weekly-shape.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const { buildWeeklyLog } = require('../scripts/fetch-stats.js');

const qbWeek = (over = {}) => ({
  season_type: 'REG', week: 1, opponent_team: 'IND', fantasy_points_ppr: 25,
  completions: 17, attempts: 25, passing_yards: 324, passing_tds: 1,
  passing_interceptions: 0, carries: 9, rushing_yards: 40, rushing_tds: 1,
  passing_epa: 10.3, ...over,
});

const rbWeek = (over = {}) => ({
  season_type: 'REG', week: 1, opponent_team: 'LV', fantasy_points_ppr: 10.6,
  carries: 11, rushing_yards: 36, rushing_tds: 0, targets: 5, receptions: 4,
  receiving_yards: 30, receiving_tds: 0, rushing_epa: -2.7, ...over,
});

test('a quarterback who ran the ball is published with the carries he ran it on', () => {
  const [row] = buildWeeklyLog([qbWeek()], 'QB');
  assert.strictEqual(row.car, 9);
  assert.strictEqual(row.rushYds, 40);
});

test('no position publishes rushing production without the volume behind it', () => {
  // THE PROPERTY, not the field. A future shape that adds rushing yards to
  // receivers would fail here for the same reason the QB shape did, which is the
  // point of asserting it this way round.
  for (const [pos, week] of [['QB', qbWeek()], ['RB', rbWeek()],
                             ['WR', { ...rbWeek(), rushing_yards: 12, carries: 2 }]]) {
    const [row] = buildWeeklyLog([week], pos);
    if (row.rushYds === undefined) continue;        // not a rushing shape: nothing to check
    assert.notStrictEqual(row.car, undefined,
      `${pos} publishes rushYds with no car — the yards have no volume behind them`);
  }
});

test('a quarterback who never ran is still shaped, with a zero rather than a gap', () => {
  // Zero carries is a measurement; a missing key is not, and a reader cannot
  // tell the difference downstream.
  const [row] = buildWeeklyLog([qbWeek({ carries: 0, rushing_yards: 0, rushing_tds: 0 })], 'QB');
  assert.strictEqual(row.car, 0);
});

test('a game nobody played in is not in the log', () => {
  // The filter is attempts, carries or targets — a quarterback inactive all week
  // has none of them and belongs absent rather than as a row of zeroes.
  const idle = { season_type: 'REG', week: 2, opponent_team: 'NO', fantasy_points_ppr: 0,
                 attempts: 0, carries: 0, targets: 0 };
  assert.deepStrictEqual(buildWeeklyLog([idle], 'QB'), []);
});

test('the playoffs are not in a weekly log the site reads as the season', () => {
  const post = qbWeek({ season_type: 'POST', week: 19 });
  assert.deepStrictEqual(buildWeeklyLog([post], 'QB'), []);
});

test('requiring fetch-stats does not fetch three seasons of stats', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fetch-stats.js'), 'utf8');
  assert.match(src, /require\.main === module/, 'requiring fetch-stats.js runs the whole pipeline');
  assert.match(src, /require\.main === module\s*\)\s*\{[\s\S]{0,80}main\(\)/,
    'the guard exists but main() is called outside it');
});
