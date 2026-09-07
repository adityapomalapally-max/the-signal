/**
 * The status vocabulary. These are the exact behaviours that were wrong on the
 * live site: the body part discarded, and "Undisclosed" pasted onto a badge as
 * if it meant something.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { formatStatus, STATUS_CLASSES, ESCALATIONS } = require('../scripts/lib/status');

test('the body part rides along with the status', () => {
  assert.deepStrictEqual(formatStatus('IR', 'Knee - PCL'), {
    status: 'IR (Knee - PCL)', statusClass: 'status-out',
  });
  assert.deepStrictEqual(formatStatus('Questionable', 'Hamstring'), {
    status: 'Questionable (Hamstring)', statusClass: 'status-quest',
  });
});

test('a body part that says nothing is not appended', () => {
  // Sleeper has several spellings of "we will not say". Rendering
  // "Questionable (Undisclosed)" is noise wearing a detail's clothes.
  for (const empty of ['Undisclosed', 'undisclosed', 'UNKNOWN', 'N/A', 'None', '', null, undefined]) {
    const out = formatStatus('Questionable', empty);
    assert.strictEqual(out.status, 'Questionable', `body part ${JSON.stringify(empty)} should be dropped`);
  }
});

test('an unknown feed status maps to nothing rather than a guess', () => {
  // Empty beats wrong: an unrecognised status must not become a badge.
  assert.strictEqual(formatStatus('Frobnicated', 'Knee'), null);
  assert.strictEqual(formatStatus('', 'Knee'), null);
  assert.strictEqual(formatStatus(null, null), null);
});

test('every mapped status uses a class the stylesheet defines', () => {
  // A typo here renders an unstyled badge, which reads as "no status at all".
  for (const word of ['IR', 'Out', 'Doubtful', 'Questionable', 'Probable', 'PUP', 'Suspended', 'NFI']) {
    const out = formatStatus(word, null);
    assert.ok(out, `${word} should map`);
    assert.ok(STATUS_CLASSES.has(out.statusClass), `${word} -> ${out.statusClass} is not a real class`);
  }
});

test('everything that means "he is not playing" is an escalation', () => {
  // An override must never be able to talk a player down off one of these.
  for (const word of ['IR', 'Out', 'PUP', 'NFI', 'Suspended', 'Doubtful']) {
    assert.ok(ESCALATIONS.has(word), `${word} must outrank a hand-written note`);
  }
  // Questionable is NOT an escalation — that is what lets a sourced override
  // quiet a camp designation on a veteran rest day.
  assert.ok(!ESCALATIONS.has('Questionable'));
  assert.ok(!ESCALATIONS.has('Probable'));
});

test('a status-out word never resolves to a healthy class', () => {
  for (const word of ESCALATIONS) {
    const out = formatStatus(word, 'Knee');
    if (out) assert.notStrictEqual(out.statusClass, 'status-healthy', `${word} rendered as healthy`);
  }
});

test('an id that resolves IS the match, whatever the position says', () => {
  // TRAVIS HUNTER. Sleeper carries him as position "DB" with fantasy_positions
  // ["DB","WR"]; the board carries him as a WR, because that is the only way he
  // is ownable. His sleeperId resolved every day and was then thrown away
  // because the position strings disagreed, so his status was frozen and he was
  // reported "unmatched" in every run for weeks.
  //
  // The rule this broke is the repo's oldest: names are never a join key. A
  // position string is a name. The id is the key, and an id that resolves is
  // the match — a disagreement gets reported, not used to drop the player.
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'update-data.js'), 'utf8');
  const idBlock = src.slice(src.indexOf('if (player.sleeperId && sleeperPlayers[player.sleeperId])'),
                            src.indexOf('if (!match) {'));
  assert.ok(!/if\s*\(\s*byId\.position\s*===\s*player\.pos\s*\)\s*match\s*=/.test(idBlock),
    'the id match is gated on the position again — that is a name being used as a join key');
  assert.match(idBlock, /diagnostics\.positionMismatch/,
    'a position disagreement must still be reported, or a stale id becomes invisible');

  // And the name index has to file a two-way player under every position he is
  // listed at, or nothing looking for a receiver will ever find him.
  assert.match(src, /fantasy_positions/,
    'the name index ignores fantasy_positions, so a two-way player is filed under one position only');
});

test('nobody in the pool is left unmatched or ambiguous', () => {
  // The check that actually caught Hunter. It reads what the last real run
  // wrote, so it fails on the day a feed rename breaks a join rather than
  // whenever somebody next looks.
  const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'meta.json'), 'utf8'));
  const d = meta.statusDiagnostics || {};
  assert.deepStrictEqual(d.unmatched || [], [],
    'a player the status feed cannot match has a frozen status and nothing on the page says so');
  assert.deepStrictEqual(d.ambiguous || [], [],
    'an ambiguous name is skipped entirely — two players are sharing one identity');
});
