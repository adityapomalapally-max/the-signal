/**
 * The matchup board.
 *
 * Fantasy points allowed is the most-used matchup number in the sport and it
 * conflates two things: how good a defence is, and how good the offences it
 * happened to face were. This file publishes a corrected number beside the
 * familiar one, and the corrected number is only worth carrying if it actually
 * disagrees — a "better metric" that ranks everyone the same way is a second
 * column of the same data wearing a different name.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const F = path.join(__dirname, '..', 'data', 'matchups.json');
const M = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, 'utf8')) : null;
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];

test('every season carries all 32 defences, or says why not', () => {
  if (!M) return;
  for (const [year, s] of Object.entries(M.seasons)) {
    // In season a partial year is expected; a COMPLETED season missing
    // defences means the join dropped teams.
    const complete = Number(year) < (M.meta.latestSeasonWithGames || 9999);
    if (complete) {
      assert.strictEqual(s.defenseCount, 32,
        `${year} is a completed season with ${s.defenseCount} defences — the opponent join lost teams`);
    }
    assert.strictEqual(s.defenseCount, Object.keys(s.defenses).length, `${year}: stated count disagrees with the rows`);
  }
});

test('a thin cell publishes its sample and no rate', () => {
  if (!M) return;
  for (const [year, s] of Object.entries(M.seasons)) {
    for (const [team, byPos] of Object.entries(s.defenses)) {
      for (const [pos, c] of Object.entries(byPos)) {
        if (!c.thin) continue;
        assert.strictEqual(c.pointsAllowedPerGame, undefined,
          `${year} ${team} ${pos}: thin but carries a rate`);
        assert.strictEqual(c.vsBaseline, undefined, `${year} ${team} ${pos}: thin but carries a baseline`);
        assert.ok(typeof c.playerGames === 'number', `${year} ${team} ${pos}: thin with no sample size`);
      }
    }
  }
});

test('the sample floor withholds a rate, and Week 1 is where that matters', () => {
  // Not testable against a completed season — every cell there clears the floor
  // comfortably, which is why the mutation that deleted the floor passed. The
  // weeks it protects are 1 to 3, when one afternoon is the whole sample and a
  // board built on it looks exactly like a board built on seventeen games.
  const { shapeCell, MIN_PLAYER_GAMES } = require('../scripts/build-matchups.js');

  const oneWeek = { weeks: new Set([1]), points: 42, playerGames: 3, delta: 18, deltaN: 3 };
  const thin = shapeCell(oneWeek);
  assert.strictEqual(thin.thin, true, 'three player-games in Week 1 must not produce a rate');
  assert.strictEqual(thin.pointsAllowedPerGame, undefined);
  assert.strictEqual(thin.vsBaseline, undefined);
  assert.strictEqual(thin.playerGames, 3, 'the count is still published — it is real');

  const enough = { weeks: new Set([1, 2, 3]), points: 120, playerGames: MIN_PLAYER_GAMES, delta: 16, deltaN: MIN_PLAYER_GAMES };
  const fat = shapeCell(enough);
  assert.strictEqual(fat.thin, undefined, 'exactly at the floor the rate publishes');
  assert.strictEqual(fat.pointsAllowedPerGame, 15, '120 points over 8 player-games');
  assert.strictEqual(fat.vsBaseline, 2, '16 over 8');

  // And the baseline has its own floor: enough games for a rate is not
  // automatically enough players with a season behind them.
  const fewBaselines = { weeks: new Set([1, 2]), points: 120, playerGames: MIN_PLAYER_GAMES, delta: 30, deltaN: 2 };
  assert.strictEqual(shapeCell(fewBaselines).vsBaseline, null,
    'a baseline computed from two players must not be published as if it were the cell');
});

test('every published cell clears the floor the file states', () => {
  if (!M) return;
  const stated = Number((M.meta.qualifiers.playerGames.match(/(\d+)/) || [])[1]);
  assert.ok(stated > 0, 'the qualifier does not state a number');
  for (const [year, s] of Object.entries(M.seasons)) {
    for (const [team, byPos] of Object.entries(s.defenses)) {
      for (const [pos, c] of Object.entries(byPos)) {
        if (c.thin) continue;
        assert.ok(c.playerGames >= stated,
          `${year} ${team} ${pos}: published on ${c.playerGames} player-games, under the stated ${stated}`);
      }
    }
  }
});

test('the corrected metric disagrees with the naive one', () => {
  // The whole justification for computing it. Measured on 2025: twelve of
  // thirty-two defences move five or more places. If that ever collapses to
  // zero the correction is doing nothing and the column should go.
  if (!M) return;
  const year = String(M.meta.latestSeasonWithGames || Object.keys(M.seasons).pop());
  const s = M.seasons[year];
  if (!s) return;
  let anyDisagreement = false;
  for (const pos of POSITIONS) {
    const rows = Object.entries(s.defenses)
      .map(([team, byPos]) => ({ team, ...byPos[pos] }))
      .filter(r => typeof r.vsBaseline === 'number' && typeof r.pointsAllowedPerGame === 'number');
    if (rows.length < 20) continue;
    const byRaw = [...rows].sort((a, b) => a.pointsAllowedPerGame - b.pointsAllowedPerGame).map(r => r.team);
    const byAdj = [...rows].sort((a, b) => a.vsBaseline - b.vsBaseline).map(r => r.team);
    const moved = byAdj.filter((t, i) => Math.abs(byRaw.indexOf(t) - i) >= 5).length;
    if (moved > 0) anyDisagreement = true;
  }
  assert.ok(anyDisagreement,
    'the baseline-adjusted ranking is identical to the raw one at every position — the correction is not correcting anything');
});

test('a defence held below expectation is negative, and the file says which way is which', () => {
  if (!M) return;
  assert.match(M.meta.readThis, /vsBaseline is the number to trust/i);
  assert.match(M.meta.readThis, /conflates|happened to face/i,
    'the file has to state WHY the familiar number is the weaker one');
  // The sign convention is the thing a reader will get backwards, so it is
  // asserted rather than assumed: some defences must be on each side of zero.
  const year = Object.keys(M.seasons).pop();
  const wr = Object.values(M.seasons[year].defenses).map(d => d.WR).filter(c => c && typeof c.vsBaseline === 'number');
  assert.ok(wr.some(c => c.vsBaseline < 0), 'no defence held receivers below their own average — implausible');
  assert.ok(wr.some(c => c.vsBaseline > 0), 'no defence was beaten — implausible');
});

test('the file admits what its population is', () => {
  if (!M) return;
  const c = M.meta.caveats.join(' ');
  assert.match(c, /top-350|pool/i, 'the file must say it measures the fantasy pool, not the whole league');
  assert.match(c, /offseason|past season/i,
    'a defence from a past season is not the defence lining up on Sunday, and the file has to say so');
});

test('the build is in the daily action', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily-update.yml'), 'utf8');
  assert.match(yml, /node scripts\/build-matchups\.js/,
    'the matchup board is the thing that changes most week to week and it is not being rebuilt');
  // And it has to run after the weekly stats it reads.
  assert.ok(yml.indexOf('fetch-stats.js') < yml.indexOf('build-matchups.js'),
    'matchups are built before the weekly stats they read are refreshed');
});
