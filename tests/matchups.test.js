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
  const { shapeCell, MIN_GAMES, MIN_PLAYER_GAMES } = require('../scripts/build-matchups.js');

  const oneWeek = { weeks: new Set([1]), points: 42, playerGames: 3, delta: 18, deltaN: 3 };
  const thin = shapeCell(oneWeek);
  assert.strictEqual(thin.thin, true, 'one game must not produce a rate');
  assert.strictEqual(thin.pointsAllowedPerGame, undefined);
  assert.strictEqual(thin.vsBaseline, undefined);
  assert.strictEqual(thin.playerGames, 3, 'the count is still published — it is real');
  assert.strictEqual(thin.gamesPlayed, 1, 'and so is the number of games behind it');

  // THE SAMPLE IS GAMES, NOT PLAYER-GAMES. A defence that faced one very busy
  // week has plenty of observations and one observation of ITSELF. The old
  // player-game floor let that through, and demanded 7.5 games of a quarterback
  // board while asking 3.3 of a receiver one.
  const busyButBrief = { weeks: new Set([1, 2, 3]), points: 300, playerGames: 20, delta: 40, deltaN: 20 };
  assert.strictEqual(shapeCell(busyButBrief).thin, true,
    `20 player-games across only 3 weeks is one short of the ${MIN_GAMES}-game floor and must not publish`);

  const enough = { weeks: new Set([1, 2, 3, 4]), points: 120, playerGames: 8, delta: 16, deltaN: 8 };
  const fat = shapeCell(enough);
  assert.strictEqual(fat.thin, undefined, 'exactly at the games floor the rate publishes');
  assert.strictEqual(fat.pointsAllowedPerGame, 15, '120 points over 8 player-games');
  assert.strictEqual(fat.vsBaseline, 2, '16 over 8');
  assert.strictEqual(fat.gamesPlayed, 4);

  // And the baseline has its own floor: enough games for a rate is not
  // automatically enough players with a season behind them.
  const fewBaselines = { weeks: new Set([1, 2, 3, 4]), points: 120, playerGames: 8, delta: 30, deltaN: 2 };
  assert.strictEqual(shapeCell(fewBaselines).vsBaseline, null,
    'a baseline computed from two players must not be published as if it were the cell');
});

test('the floor asks the same of every position', () => {
  // The calibration that made this change necessary. Measured across 2025 a
  // defence faces 2.39 pool receivers a game and 1.07 quarterbacks, so a flat
  // player-game floor is not an even-handed standard — it is a receiver
  // standard applied to everyone, and it kept the QB board empty until week 10.
  if (!M) return;
  assert.match(M.meta.qualifiers.games, /GAMES, not player-games/i,
    'the qualifier must state that the sample is games');
  assert.match(M.meta.qualifiers.games, /2\.4|2\.39/,
    'and carry the measurement that motivated it, or it reads as an arbitrary choice');
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
  assert.match(M.meta.readThis, /vsBaseline is the sounder/i);
  assert.match(M.meta.readThis, /conflates|happened to face/i,
    'the file has to state WHY the familiar number is the weaker one');
  // The sign convention is the thing a reader will get backwards, so it is
  // asserted rather than assumed: some defences must be on each side of zero.
  const year = Object.keys(M.seasons).pop();
  const wr = Object.values(M.seasons[year].defenses).map(d => d.WR).filter(c => c && typeof c.vsBaseline === 'number');
  assert.ok(wr.some(c => c.vsBaseline < 0), 'no defence held receivers below their own average — implausible');
  assert.ok(wr.some(c => c.vsBaseline > 0), 'no defence was beaten — implausible');
});

test('the file says it is a record rather than a forecast', () => {
  // Every reader will use this to predict. Measured, a defence's rating over the
  // first weeks of a season correlates with its rest-of-season rating at r=0.05
  // to 0.32 for QB, RB and WR, and does not improve with more games. That gap
  // between what the board says and what it will be used for has to be on the
  // page, because no reader can infer it from the numbers.
  if (!M) return;
  assert.match(M.meta.readThis, /DESCRIPTIVE|not a forecast/i,
    'the board must not present itself as predictive');
  assert.ok(M.meta.predictiveness, 'the measured predictiveness is missing from the file');
  assert.match(M.meta.predictiveness, /r = 0\.\d+ to 0\.\d+/,
    'the caveat has to carry the measured range, not just the word "weak"');
  assert.match(M.meta.predictiveness, /research-matchup-stability/,
    'and it has to name the script that reproduces it, or the finding gets re-litigated from memory');
});

test('the research script exists and writes nothing', () => {
  const f = path.join(__dirname, '..', 'scripts', 'research-matchup-stability.js');
  assert.ok(fs.existsSync(f), 'the measurement behind the caveat is not reproducible');
  const src = fs.readFileSync(f, 'utf8');
  assert.ok(!/writeFileSync/.test(src), 'a research script must not write a data file');
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily-update.yml'), 'utf8');
  assert.ok(!yml.includes('research-matchup-stability'),
    'research is not a build and does not belong in the daily Action');
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
