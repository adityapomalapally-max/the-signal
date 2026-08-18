/**
 * PFR advanced splits, and the two libraries that made pulling them cheap.
 *
 * The whole reason seventeen of nflverse's twenty-five buckets were never used
 * is that most are not keyed on GSIS. The crosswalk removes that barrier — so
 * the tests that matter here are about the JOIN, because a join that silently
 * half-works produces a page that looks complete and is wrong.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const D = path.join(__dirname, '..', 'data');
const adv = JSON.parse(fs.readFileSync(path.join(D, 'advstats.json'), 'utf8'));
const pool = JSON.parse(fs.readFileSync(path.join(D, 'players.json'), 'utf8'));
const { teamKey, isTeam, NFL_TEAMS } = require('../scripts/lib/teams');

test('the Rams are LAR here, whatever the source called them', () => {
  // nflverse says LA, PFR says LA, this site says LAR. Unaliased, the Rams key
  // differently from every other file and their section renders as nothing —
  // silent, not an error. fetch-advstats walked into this on its first run and
  // produced 34 "teams".
  assert.strictEqual(teamKey('LA'), 'LAR');
  assert.strictEqual(teamKey('la'), 'LAR');
  assert.strictEqual(teamKey('STL'), 'LAR');
  assert.strictEqual(teamKey('OAK'), 'LV');
  assert.strictEqual(teamKey('SD'), 'LAC');
  assert.strictEqual(teamKey('KC'), 'KC', 'a real code passes through untouched');
});

test("PFR's multi-team markers are not teams", () => {
  // 2TM is what PFR writes for a traded player. Summed into a team's totals it
  // double-counts him against a defence he did not play for.
  for (const fake of ['2TM', '3TM', 'TOT', '']) {
    assert.strictEqual(isTeam(fake), false, `${fake} must not count as a team`);
  }
  assert.strictEqual(isTeam('LA'), true, 'an alias of a real team is still a real team');
});

test('the defence aggregate covers all 32 and only 32', () => {
  const keys = Object.keys(adv.defenseByTeam);
  assert.strictEqual(keys.length, 32, `expected 32 teams, got ${keys.length}: ${keys.sort().join(' ')}`);
  for (const k of keys) assert.ok(NFL_TEAMS.has(k), `"${k}" is not a franchise`);
});

test('defensive rates are recomputed from totals, not averaged across players', () => {
  // Averaging percentages over players weights a nickel corner's twelve targets
  // the same as a No.1's season. The stored rate has to reconcile to the counts.
  for (const [team, seasons] of Object.entries(adv.defenseByTeam)) {
    for (const [year, s] of Object.entries(seasons)) {
      if (!s.targets) continue;
      const expected = +(100 * s.completions / s.targets).toFixed(1);
      assert.strictEqual(s.completionPctAllowed, expected,
        `${team} ${year}: stored ${s.completionPctAllowed}% does not reconcile to ${s.completions}/${s.targets}`);
    }
  }
});

test('every player row joins to somebody in the pool', () => {
  // The join is by id. If it ever silently falls back to names, ids that are not
  // ours start appearing here.
  const ids = new Set(pool.map(p => p.id));
  for (const id of Object.keys(adv.players)) {
    assert.ok(ids.has(id), `advstats has "${id}", who is not in the pool`);
  }
});

test('coverage is stated and matches what is actually in the file', () => {
  const actual = Object.keys(adv.players).length;
  assert.strictEqual(adv.meta.coverage.players, actual, 'the stated coverage must be the real one');
  assert.strictEqual(adv.meta.coverage.of, pool.length);
  // Below this the join has broken rather than the data being thin.
  assert.ok(actual / pool.length > 0.7, `only ${actual}/${pool.length} players matched — the crosswalk is failing`);
});

test('a split carries numbers, never empty scaffolding', () => {
  // "Empty beats wrong" applies to shape too: a season key with an empty
  // receiving object reads as "we checked and he caught nothing".
  let checked = 0;
  for (const [id, p] of Object.entries(adv.players)) {
    for (const [year, splits] of Object.entries(p.seasons)) {
      assert.ok(Object.keys(splits).length > 0, `${id} ${year}: a season with no splits should not exist`);
      for (const [name, vals] of Object.entries(splits)) {
        assert.ok(Object.keys(vals).length > 0, `${id} ${year} ${name}: empty split object`);
        checked++;
      }
    }
  }
  assert.ok(checked > 100, `expected plenty of splits, saw ${checked}`);
});

test('the file says where it came from and how it was joined', () => {
  assert.match(adv.meta.source, /Pro Football Reference/i);
  assert.match(adv.meta.join, /ID to ID|no name matching/i,
    'the join method is the thing most worth recording — it is what the whole moat rests on');
  assert.ok(Array.isArray(adv.meta.caveats) && adv.meta.caveats.length >= 2);
  assert.ok(adv.meta.seasons.length === 3);
});

test('receiving splits are internally consistent', () => {
  // ybc + yac should reconcile to total yards. A mismatch means columns were
  // mapped to the wrong names, which is the easiest mistake to make here and
  // the hardest to see on a rendered page.
  let checked = 0;
  for (const [id, p] of Object.entries(adv.players)) {
    for (const [year, splits] of Object.entries(p.seasons)) {
      const r = splits.receiving;
      if (!r || !r.yards || r.yardsBeforeCatch == null || r.yardsAfterCatch == null) continue;
      const sum = r.yardsBeforeCatch + r.yardsAfterCatch;
      assert.ok(Math.abs(sum - r.yards) <= 2,
        `${id} ${year}: ybc ${r.yardsBeforeCatch} + yac ${r.yardsAfterCatch} = ${sum}, but yards = ${r.yards}`);
      checked++;
    }
  }
  assert.ok(checked > 50, `expected to reconcile plenty of receiving lines, did ${checked}`);
});

test('yards BEFORE the catch are not yards AFTER it', () => {
  // The sum check above cannot see a swap — ybc + yac is the same either way,
  // and a mutation that exchanged the two columns passed it. Which matters: the
  // entire point of this split is separating what the quarterback earned him
  // from what he made himself, and swapped it says the exact opposite.
  //
  // The per-reception rates are the asymmetric witness. They come from their own
  // columns, so they only agree with the totals if both were mapped correctly.
  let checked = 0;
  for (const [id, p] of Object.entries(adv.players)) {
    for (const [year, splits] of Object.entries(p.seasons)) {
      const r = splits.receiving;
      if (!r || !r.rec || r.ybcPerRec == null || r.yacPerRec == null) continue;
      if (r.yardsBeforeCatch == null || r.yardsAfterCatch == null) continue;
      const ybc = r.yardsBeforeCatch / r.rec;
      const yac = r.yardsAfterCatch / r.rec;
      assert.ok(Math.abs(ybc - r.ybcPerRec) <= 0.15,
        `${id} ${year}: yardsBeforeCatch/rec = ${ybc.toFixed(2)} but ybcPerRec says ${r.ybcPerRec} — the columns are crossed`);
      assert.ok(Math.abs(yac - r.yacPerRec) <= 0.15,
        `${id} ${year}: yardsAfterCatch/rec = ${yac.toFixed(2)} but yacPerRec says ${r.yacPerRec} — the columns are crossed`);
      checked++;
    }
  }
  assert.ok(checked > 50, `expected plenty of receiving lines to cross-check, did ${checked}`);
});
