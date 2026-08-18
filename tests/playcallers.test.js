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

test('every row describes a team-season the scheme data actually has', () => {
  for (const [key, e] of entries) {
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
    if (e.headCoach && e.callerIsHeadCoach === true) {
      assert.strictEqual(e.playCaller, e.headCoach, `${key}: claims the HC calls it but names someone else`);
    }
    if (e.headCoach && e.callerIsHeadCoach === false) {
      assert.notStrictEqual(e.playCaller, e.headCoach, `${key}: claims the HC does not call it but names him`);
    }
  }
});

test('the generated half stays in step with scheme.json', () => {
  // build-playcallers refreshes headCoach on every run; a drift here means the
  // scaffold was hand-edited in the generated column.
  for (const [key, e] of entries) {
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
