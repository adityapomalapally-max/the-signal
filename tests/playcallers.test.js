/**
 * The hand-kept play-caller layer. A blank row is a legitimate state — unknown
 * is honest, and the site falls back to the head coach. What must never happen
 * is a claim without a source, or a row about a team-season that does not exist.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DATA = path.join(__dirname, '..', 'data');
const file = JSON.parse(fs.readFileSync(path.join(DATA, 'playcallers.json'), 'utf8'));
const scheme = JSON.parse(fs.readFileSync(path.join(DATA, 'scheme.json'), 'utf8'));
const entries = Object.entries(file.entries || {});

// The current league year has rows before it has plays. The schedule feed names
// every head coach months before kickoff, and without those rows the site went
// on naming last season's coach — Miami's card said Mike McDaniel a year after
// he left. So a row is legitimate if scheme knows the season OR it is the
// season the league is currently in.
const schemeSeasons = new Set(scheme.meta.seasons.map(Number));
const scaffoldSeasons = new Set(entries.map(([, e]) => Number(e.season)).filter((y) => !schemeSeasons.has(y)));

test('a scaffolded season is the one the league is in, and only one of them', () => {
  // A second unplayed season would mean the scaffold is inventing years.
  assert.ok(scaffoldSeasons.size <= 1,
    `rows exist for ${scaffoldSeasons.size} seasons with no play-by-play: ${[...scaffoldSeasons].join(', ')}`);
  if (scaffoldSeasons.size === 1) {
    const y = [...scaffoldSeasons][0];
    const newest = Math.max(...schemeSeasons);
    assert.strictEqual(y, newest + 1, `scaffolded ${y} when the newest played season is ${newest}`);
    // And it has to be the whole league, not a handful of teams.
    const teams = entries.filter(([, e]) => Number(e.season) === y).length;
    assert.ok(teams >= 30, `only ${teams} teams scaffolded for ${y}`);
  }
});

test('every row describes a team-season the scheme data actually has', () => {
  for (const [key, e] of entries) {
    if (scaffoldSeasons.has(Number(e.season))) continue;   // the unplayed year
    assert.ok(scheme.seasons[e.season] && scheme.seasons[e.season][e.team],
      `${key}: no such team-season in scheme.json`);
  }
});

test('the key always agrees with the row it points at', () => {
  for (const [key, e] of entries) {
    assert.strictEqual(key, `${e.season}|${e.team}`, `key "${key}" disagrees with its own fields`);
  }
});

test('a named play-caller always carries a source', () => {
  // Same standard as medicals.json: no data without a source.
  for (const [key, e] of entries) {
    if (!e.playCaller) continue;
    assert.ok(e.source && String(e.source).trim(), `${key}: names ${e.playCaller} with no source`);
  }
});

test('callerIsHeadCoach never contradicts the generated head coach', () => {
  for (const [key, e] of entries) {
    if (!e.playCaller) continue;
    assert.ok(e.callerIsHeadCoach === true || e.callerIsHeadCoach === false, `${key}: callerIsHeadCoach unanswered`);
    // A SOURCED HEAD COACH OUTRANKS THE GENERATED ONE, because the generated one
    // is not always right: nflverse's schedule carried Sean McDermott at Buffalo
    // in October 2026, nine months after he was fired, Jonathan Gannon at
    // Arizona, and "Klint Kubliak" at Las Vegas, which is a typo and not a man.
    // `headCoach` is left exactly as the feed wrote it so the disagreement stays
    // visible; the comparison answers to the sourced name where one exists.
    const hc = e.headCoachSourced || e.headCoach;
    if (e.headCoachSourced) {
      assert.ok(e.headCoachSource && String(e.headCoachSource).trim(),
        `${key}: overrides the head coach to ${e.headCoachSourced} with no source`);
    }
    if (hc && e.callerIsHeadCoach === true) {
      assert.strictEqual(e.playCaller, hc, `${key}: claims the HC calls it but names someone else`);
    }
    if (hc && e.callerIsHeadCoach === false) {
      assert.notStrictEqual(e.playCaller, hc, `${key}: claims the HC does not call it but names him`);
    }
  }
});

test('the generated half stays in step with scheme.json', () => {
  // build-playcallers refreshes headCoach on every run; a drift here means the
  // scaffold was hand-edited in the generated column.
  for (const [key, e] of entries) {
    // The scaffolded year has no scheme row to be in step with; its coach comes
    // from the schedule feed instead, and is checked below.
    if (scaffoldSeasons.has(Number(e.season))) continue;
    const truth = scheme.seasons[e.season][e.team].coach;
    if (truth) assert.strictEqual(e.headCoach, truth, `${key}: headCoach "${e.headCoach}" but scheme says "${truth}"`);
  }
});

test('every team-season in scheme has a row waiting for an answer', () => {
  for (const season of scheme.meta.seasons) {
    for (const team of Object.keys(scheme.seasons[season])) {
      assert.ok(file.entries[`${season}|${team}`], `${season} ${team} has no play-caller row`);
    }
  }
});

test('the unplayed season names a coach for every team, and a fresh one', () => {
  if (!scaffoldSeasons.size) return;              // out of season there is none
  const y = [...scaffoldSeasons][0];
  const rows = entries.filter(([, e]) => Number(e.season) === y);
  for (const [key, e] of rows) {
    assert.ok(e.headCoach, `${key}: scaffolded with no head coach, which is the whole reason the row exists`);
    // IT USED TO DEMAND playCaller === null HERE, and that was a statement about
    // effort rather than correctness. "Scaffolded" means nflverse has not
    // published PARTICIPATION for the season, which it does only after the
    // season ends — so the current year is scaffolded from kickoff to February
    // while the play-callers have been public knowledge since the previous
    // February. The assertion read "nobody has filled these in yet" as a rule
    // and went red the morning somebody did, on 2026-10-19 with six weeks played.
    // Same shape as the fieldmap scale assertion fixed that same morning.
    // What a filled row still owes is a SOURCE, and the test above enforces it.
  }
  // At least one team must have changed coach, or the scaffold is just copying
  // last year forward — which is the bug it was written to fix.
  const prev = new Map(entries.filter(([, e]) => Number(e.season) === y - 1).map(([, e]) => [e.team, e.headCoach]));
  const changed = rows.filter(([, e]) => prev.has(e.team) && prev.get(e.team) !== e.headCoach);
  assert.ok(changed.length > 0,
    `not one of ${rows.length} teams changed head coach between ${y - 1} and ${y}, which would be a first`);
});
