/**
 * What a skill player is running into.
 *
 * THE FINDING THIS FILE PROTECTS. There are two ways to measure what a line
 * gave a back and they do not agree. Next Gen Stats computes an expected yards
 * figure from the position, speed and direction of all 22 players at the
 * handoff; Pro Football Reference charts yards before contact by watching the
 * play. Measured over 238 team-seasons they correlate at r = 0.32 — two
 * vendors, two methods, only moderate agreement about which lines are good.
 *
 * So both are published and the gap between a team's two ranks is shown. The
 * temptation this guards against is averaging them into one "O-line score",
 * which would hide exactly the disagreement that makes the pair worth having:
 * in 2025 Miami is first by tracking and 28th by charting.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const env = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'environment.json'), 'utf8'));
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'build-environment.js'), 'utf8');
const latest = Math.max(...Object.keys(env.seasons).map(Number));
const board = env.seasons[String(latest)];

test('both readings of the line are published, and neither is averaged away', () => {
  const teams = Object.values(board);
  assert.ok(teams.length >= 30, `only ${teams.length} teams in ${latest}`);
  const withBoth = teams.filter((t) => t.run.expPerAtt !== null && t.run.ybcPerAtt !== null);
  assert.ok(withBoth.length >= 28,
    `only ${withBoth.length} teams carry both readings — one of the two joins has broken`);
  // No blended score anywhere: the disagreement is the point.
  assert.ok(!/blend|composite|overallScore|lineScore/i.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')),
    'something is combining the two line readings into one number, which hides where they disagree');
});

test('the agreement between the vendors is measured, not asserted', () => {
  const m = env.meta.measured;
  assert.ok(typeof m.vendorAgreement === 'number', 'the vendor agreement is no longer computed');
  assert.ok(m.vendorAgreementPairs > 100, `only ${m.vendorAgreementPairs} pairs behind the agreement figure`);
  // If they ever agree closely, publishing both stops being necessary — and if
  // they diverge completely, something has broken. Either is worth noticing.
  assert.ok(m.vendorAgreement > 0 && m.vendorAgreement < 0.8,
    `the two readings now correlate at ${m.vendorAgreement}; that changes whether both are needed`);
  assert.ok(typeof m.expectationPersistence === 'number' && m.expectationPersistence > 0.2,
    'the expectation no longer repeats year over year, which is what made it an environment rather than a result');
});

test('a team gets the season it actually played', () => {
  // PFR files a traded player's combined line under 2TM or 3TM. Counted as a
  // team it invents a franchise; attributed from the current pool it puts a
  // 2023 season on whoever employs him now — that single mistake moved the
  // vendor agreement from 0.32 to 0.15 while this was being written.
  for (const season of Object.keys(env.seasons)) {
    for (const team of Object.keys(env.seasons[season])) {
      assert.ok(!/^\d?TM$/.test(team), `${team} is a traded-player marker, not a team`);
      assert.match(team, /^[A-Z]{2,3}$/, `${team} does not look like a team code`);
    }
  }
  // And the guard is tested on the inputs that break it, not by checking that
  // a function of that name still exists — a mutation that gutted it to
  // `return true` passed exactly that check.
  const { isRealTeam } = require('../scripts/build-environment');
  for (const bad of ['2TM', '3TM', '4TM', '', null, undefined]) {
    assert.strictEqual(isRealTeam(bad), false, `${JSON.stringify(bad)} was accepted as a team`);
  }
  for (const good of ['PHI', 'KC', 'LA', 'LAR', 'sf']) {
    assert.strictEqual(isRealTeam(good), true, `${good} was rejected as a team`);
  }
});

test('pressure is joined on the passing file\'s own column names', () => {
  // The passing CSV uses `team`, `pass_attempts` and `times_pressured` where
  // the rushing one uses `tm` and `att`. Read with the rushing names it
  // produced a complete set of nulls that rendered perfectly.
  const withPressure = Object.values(board).filter((t) => t.pass.pressurePct !== null);
  assert.ok(withPressure.length >= 30,
    `only ${withPressure.length} teams have a pressure rate — the passing join has moved`);
  assert.match(SRC, /only \$\{withPressure\} teams have a pressure rate/,
    'the guard against a silently empty passing join is gone');
});

test('every published rate has a sample behind it', () => {
  for (const [team, t] of Object.entries(board)) {
    if (t.run.expPerAtt !== null) assert.ok(t.run.carries >= 150, `${team}: ${t.run.carries} carries behind a rushing figure`);
    if (t.pass.pressurePct !== null) assert.ok(t.pass.dropbacks >= 150, `${team}: ${t.pass.dropbacks} dropbacks behind a pressure figure`);
  }
});

test('the file says what it is not', () => {
  const c = JSON.stringify(env.meta.caveats);
  assert.match(c, /do not agree closely/i, 'the disagreement between the two readings is no longer stated');
  assert.match(c, /second level|after it/i, 'nothing says blocking after the handoff leaks into the back\'s number');
  assert.match(c, /PFF/, 'nothing records that the usual source for this was deliberately not used');
  assert.match(c, /not what its five linemen are worth/i,
    'nothing says this describes what the carries ran into rather than the linemen themselves');
});
