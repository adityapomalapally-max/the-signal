/**
 * The scheme layer. These guard the two things that make it trustworthy: the
 * percentages describe a real distribution, and no split is drawn from a sample
 * too small to mean anything.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const scheme = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'scheme.json'), 'utf8'));
const players = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'players.json'), 'utf8'));
const seasons = scheme.meta.seasons;

test('every season has all 32 teams', () => {
  for (const yr of seasons) {
    const teams = Object.keys(scheme.seasons[yr] || {});
    assert.strictEqual(teams.length, 32, `${yr} has ${teams.length} teams`);
  }
});

test('personnel rates form a distribution, not a pile of unrelated numbers', () => {
  for (const yr of seasons) {
    for (const [team, d] of Object.entries(scheme.seasons[yr])) {
      const total = Object.values(d.personnel).reduce((a, g) => a + g.rate, 0);
      // Rounding to one decimal across ~10 groupings can drift a few tenths.
      assert.ok(Math.abs(total - 100) < 1.5, `${team} ${yr} personnel sums to ${total.toFixed(1)}%`);
    }
  }
});

test('formation and coverage distributions also sum to 100', () => {
  for (const yr of seasons) {
    for (const [team, d] of Object.entries(scheme.seasons[yr])) {
      for (const key of ['formation', 'coverageFaced', 'manZoneFaced']) {
        const vals = Object.values(d[key] || {});
        if (!vals.length) continue;
        const total = vals.reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(total - 100) < 1.5, `${team} ${yr} ${key} sums to ${total.toFixed(1)}%`);
      }
    }
  }
});

test('a box count is a plausible number of humans', () => {
  for (const yr of seasons) {
    for (const [team, d] of Object.entries(scheme.seasons[yr])) {
      for (const [g, s] of Object.entries(d.personnel)) {
        if (s.boxAvg === null) continue;
        assert.ok(s.boxAvg >= 3 && s.boxAvg <= 11, `${team} ${yr} ${g}: boxAvg ${s.boxAvg}`);
        assert.ok(s.heavyBoxRate >= 0 && s.heavyBoxRate <= 100, `${team} ${yr} ${g}: heavyBox ${s.heavyBoxRate}`);
      }
    }
  }
});

test('no split is drawn from a sample under the stated qualifier', () => {
  // The qualifier is the promise the page makes. A rate off a dozen snaps is
  // noise wearing a number's clothes.
  const min = Number(scheme.meta.qualifier.match(/(\d+)\+/)[1]);
  for (const yr of seasons) {
    for (const [team, d] of Object.entries(scheme.seasons[yr])) {
      for (const [g, s] of Object.entries(d.personnel)) {
        if (s.plays < min) {
          assert.strictEqual(s.explosiveRate, undefined, `${team} ${yr} ${g}: ${s.plays} snaps but an explosive rate`);
          assert.strictEqual(s.epaPerPlay, undefined, `${team} ${yr} ${g}: ${s.plays} snaps but an EPA`);
        }
      }
    }
  }
});

test('the meta block states every definition the page prints', () => {
  for (const key of ['explosive', 'heavyBox', 'qualifier', 'caveats', 'source']) {
    assert.ok(scheme.meta[key] && String(scheme.meta[key]).trim(), `meta.${key} is missing`);
  }
});

test('league baselines exist for every season, and are built from more plays than any one team', () => {
  for (const yr of seasons) {
    const lg = scheme.league[yr];
    assert.ok(lg, `no league baseline for ${yr}`);
    const biggest = Math.max(...Object.values(scheme.seasons[yr]).map(t => t.plays));
    assert.ok(lg.plays > biggest * 10, `${yr} league plays ${lg.plays} vs biggest team ${biggest}`);
  }
});

test('team abbreviations match the ones the rest of the site uses', () => {
  // scheme.json is keyed by nflverse abbreviation and joined to the team pages
  // by that key; a mismatch renders an empty section rather than an error.
  const known = new Set(players.map(p => p.team).filter(Boolean));
  const latest = seasons[seasons.length - 1];
  const unknown = Object.keys(scheme.seasons[latest]).filter(t => !known.has(t));
  // LAR/LA and similar aliases would show up here.
  assert.deepStrictEqual(unknown, [], `scheme teams absent from the player pool: ${unknown.join(', ')}`);
});

test('every team-season names its head coach', () => {
  for (const yr of seasons) {
    for (const [team, d] of Object.entries(scheme.seasons[yr])) {
      assert.ok(d.coach && d.coach.trim(), `${team} ${yr} has no coach`);
    }
  }
});

test('defensive rates are shares of the right denominator', () => {
  // Coverage only exists on a dropback. Dividing by every snap would halve
  // each number and read an aggressive defence as a passive one.
  for (const yr of seasons) {
    for (const [team, d] of Object.entries(scheme.seasons[yr])) {
      const def = d.defense;
      if (!def) continue;
      assert.ok(def.passSnaps <= def.snaps, `${team} ${yr}: more dropbacks than snaps`);
      for (const k of ['manRate', 'zoneRate', 'blitzRate', 'pressureRate']) {
        if (def[k] === null) continue;
        assert.ok(def[k] >= 0 && def[k] <= 100, `${team} ${yr} ${k} = ${def[k]}`);
      }
      if (def.manRate !== null && def.zoneRate !== null) {
        const total = def.manRate + def.zoneRate;
        assert.ok(Math.abs(total - 100) < 2, `${team} ${yr}: man + zone = ${total.toFixed(1)}%`);
      }
    }
  }
});

test('every season has a league defensive baseline to compare against', () => {
  for (const yr of seasons) {
    const def = scheme.league[yr] && scheme.league[yr].defense;
    assert.ok(def, `${yr} has no league defensive baseline`);
    assert.ok(def.manRate > 5 && def.manRate < 95, `${yr} league man rate is ${def.manRate}%`);
    const biggest = Math.max(...Object.values(scheme.seasons[yr]).filter(t => t.defense).map(t => t.defense.snaps));
    assert.ok(def.snaps > biggest * 10, `${yr} league snaps ${def.snaps} vs biggest defence ${biggest}`);
  }
});

test('a defensive shell distribution sums to 100', () => {
  for (const yr of seasons) {
    for (const [team, d] of Object.entries(scheme.seasons[yr])) {
      if (!d.defense || !Object.keys(d.defense.shell).length) continue;
      const total = Object.values(d.defense.shell).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(total - 100) < 1.5, `${team} ${yr}: shells sum to ${total.toFixed(1)}%`);
    }
  }
});
