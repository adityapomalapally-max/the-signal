/**
 * The status vocabulary. These are the exact behaviours that were wrong on the
 * live site: the body part discarded, and "Undisclosed" pasted onto a badge as
 * if it meant something.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
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
