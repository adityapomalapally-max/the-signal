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

test('the team card shows both readings and never a single blended score', () => {
  // The card is the reason the disagreement is published at all. If it ever
  // renders one number for "the line", the file behind it stops mattering.
  const pages = fs.readFileSync(path.join(ROOT, 'assets', 'app-pages.js'), 'utf8');
  const card = pages.slice(pages.indexOf('function environmentCard'), pages.indexOf('function renderTeamPage'));
  assert.ok(card.length > 500, 'environmentCard is gone');
  assert.match(card, /Expected yards per carry/, 'the tracking reading is no longer shown');
  assert.match(card, /Yards before contact/, 'the charted reading is no longer shown');
  assert.match(card, /Pressure faced/, 'pass protection is no longer shown');
  // NOT just the variable name. A mutation that changed the wording to "a
  // single line score of ${measured.vendorAgreement}" kept the token and
  // inverted the meaning — the number would have been presented as the thing
  // the card exists to refuse.
  assert.match(card, /the two readings agree at r = \$\{measured\.vendorAgreement/,
    'the card no longer frames the correlation as agreement between two readings');
  assert.ok(!/single .*score|line score|overall score/i.test(card.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the card is presenting a single score for the line, which is the thing two columns exist to avoid');
  assert.match(card, /rankGap/, 'the gap between a team\'s two ranks is no longer surfaced');
  // The caveats have to travel onto the page, not sit in the file unread.
  assert.match(card, /caveatHtml\(m\.caveats\)/, 'the caveats no longer render with the card');
});

test('a missing environment file renders nothing rather than an empty shell', () => {
  const pages = fs.readFileSync(path.join(ROOT, 'assets', 'app-pages.js'), 'utf8');
  const card = pages.slice(pages.indexOf('function environmentCard'), pages.indexOf('function renderTeamPage'));
  assert.match(card, /if \(!env\) return '';/, 'the card no longer bows out when the file is absent');
  assert.match(card, /if \(!row\) return '';/, 'a team with no environment row would render an empty card');
  // And the loader latches, or the re-render it schedules re-enters itself.
  assert.match(pages, /envPromise = loadJSON\('\/data\/environment\.json'\)\.then\(d => \{ envData = d \|\| \{\}; \}\)/,
    'the environment loader no longer latches on failure, so a failed fetch loops the team page');
});

test('the card is dated, and says how much of that line still exists', () => {
  // The measurements are last season's — Next Gen Stats and PFR publish nothing
  // for a season nobody has played — and a line is five men who may not still
  // be there. Saying "from 2025" in a subtitle was not enough: the card sat on a
  // team page and read as a description of the team now.
  const pages = fs.readFileSync(path.join(ROOT, 'assets', 'app-pages.js'), 'utf8');
  const card = pages.slice(pages.indexOf('function environmentCard'), pages.indexOf('function renderTeamPage'));
  // The season has to be named ON the card. It was in the title; it now sits on
  // the line above the figures, because continuity took the headline. Either is
  // fine — what is not fine is a card of last season's numbers with no year on
  // it, which is what it shipped as the first time.
  assert.match(card, /What that line produced in \$\{year\}/,
    'the figures are no longer labelled with the season they come from');
  assert.match(card, /starters back for/,
    'continuity no longer leads the card');
  assert.match(card, /row\.continuity/, 'the card no longer says how much of the line returns');
  assert.match(card, /callerSeason/,
    'the coach is no longer tied to the season he is actually in charge of');
});

test('continuity is joined on the id, and counts a real five', () => {
  const withCont = Object.entries(board).filter(([, t]) => t.continuity);
  assert.ok(withCont.length >= 28, `only ${withCont.length} teams carry line continuity`);
  for (const [team, t] of withCont) {
    const c = t.continuity;
    assert.ok(c.of >= 4 && c.of <= 5, `${team}: ${c.of} line spots, which is not a line`);
    assert.ok(c.returning >= 0 && c.returning <= c.of, `${team}: ${c.returning} of ${c.of} returning`);
    assert.strictEqual(c.to, c.from + 1, `${team}: comparing ${c.from} against ${c.to}`);
  }
  // An offensive lineman is exactly the player whose name is written three
  // ways, so the comparison has to be on the id.
  assert.match(SRC, /r\.gsis_id/, 'line continuity is no longer joined on the GSIS id');
  // And it must not report the whole league as unchanged, which is what a
  // broken join looks like.
  const allSame = withCont.every(([, t]) => t.continuity.returning === t.continuity.of);
  assert.ok(!allSame, 'every team returns its whole line, which means the comparison matched nothing');
});

test('the coach named is the one in charge now', () => {
  // The card showed Mike McDaniel on Miami's page a year after he left, because
  // the coach was read from the same season as the measurements.
  const current = Math.max(...Object.values(board).map((t) => t.callerSeason || 0));
  assert.ok(current > latest,
    `the newest coaching row is ${current} and the measurements are ${latest} — the card would name last season's coach`);
  const named = Object.values(board).filter((t) => t.caller && t.caller.headCoach).length;
  assert.ok(named >= 30, `only ${named} teams have a head coach for ${current}`);
});

test('how far an offence moved is measured, and not sold as a coaching grade', () => {
  // The only thing about coaching this data can honestly carry: the share of
  // snaps that changed personnel grouping. A fact about snaps, not a judgement.
  const withIdentity = Object.entries(board).filter(([, t]) => t.identity);
  assert.ok(withIdentity.length >= 25, `only ${withIdentity.length} teams carry an identity shift`);
  for (const [team, t] of withIdentity) {
    const i = t.identity;
    assert.ok(i.snapsMoved >= 0 && i.snapsMoved <= 100, `${team}: ${i.snapsMoved} points of snaps moved`);
    assert.strictEqual(i.to, i.from + 1, `${team}: comparing ${i.from} with ${i.to}`);
    assert.strictEqual(typeof i.coachChanged, 'boolean', `${team}: coachChanged unanswered`);
  }
  // Nothing here may read as a rating.
  const src = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/coachingScore|coachGrade|schemeScore|callerRating/i.test(src),
    'something is grading coaching, which this data cannot support');
});

test('the site states that a new coach does not predict a new offence', () => {
  // The measurement that stops the number being over-read: the medians are
  // close enough to be the same, on fourteen coaching changes.
  const m = env.meta.measured;
  assert.ok(typeof m.identityShiftSameCoach === 'number' && typeof m.identityShiftNewCoach === 'number',
    'the comparison between a new coach and the same one is no longer computed');
  assert.ok(m.identityShiftPairs.newCoach >= 5, `only ${m.identityShiftPairs.newCoach} coaching changes behind the claim`);
  const gap = Math.abs(m.identityShiftNewCoach - m.identityShiftSameCoach);
  assert.ok(gap < m.identityShiftSameCoach,
    `a new coach now moves the offence ${m.identityShiftNewCoach} against ${m.identityShiftSameCoach} — `
    + 'if that gap has become large, the page must stop saying a coaching change does not predict this');

  const c = JSON.stringify(env.meta.caveats);
  assert.match(c, /does not predict/i, 'the caveat that a coaching change does not predict the shift is gone');
  assert.match(c, /play-caller file is hand-kept and empty|coordinator/i,
    'nothing says a coordinator change is invisible, which is where the explanation probably lives');
});
