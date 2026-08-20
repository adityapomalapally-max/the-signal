/**
 * Asking from where you already are.
 *
 * The answer engine worked and lived on a page nobody had a reason to visit. A
 * reader looking at a player's field map already has the question; these entry
 * points exist so they do not have to leave, retype his name, and describe the
 * board they were just looking at.
 *
 * THE ONE RULE THAT MATTERS: the question is PREFILLED, NEVER SENT. Every ask
 * costs money and burns a slot against a five-a-minute free tier, so a button
 * that fires an unseen question on one click is a button people press by
 * accident — and then again, wondering why nothing happened.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FEEDS = fs.readFileSync(path.join(ROOT, 'assets', 'app-feeds.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function askAboutBody() {
  const start = FEEDS.indexOf('function askAbout(');
  assert.ok(start > -1, 'askAbout is missing');
  let depth = 0, i = FEEDS.indexOf('{', start);
  const from = i;
  for (; i < FEEDS.length; i++) {
    if (FEEDS[i] === '{') depth++;
    else if (FEEDS[i] === '}' && --depth === 0) break;
  }
  return FEEDS.slice(from, i);
}

test('the question is prefilled and never sent', () => {
  const body = askAboutBody();
  assert.match(body, /input\.value = question/, 'the question is not placed in the box');
  assert.ok(!/submitAsk\s*\(/.test(body),
    'askAbout calls submitAsk — one click would spend a request on a question the reader has not seen');
  // And it should leave the cursor where editing continues the sentence.
  assert.match(body, /setSelectionRange/, 'the cursor is not placed at the end of the prefilled text');
});

test('both entry points exist in the markup and are real buttons', () => {
  const buttons = [...HTML.matchAll(/<button[^>]*class="ask-inline-btn"[^>]*>([^<]*)<\/button>/g)];
  assert.ok(buttons.length >= 2, `expected an entry point on the profile and on the lab, found ${buttons.length}`);
  for (const b of buttons) {
    assert.ok(b[1].trim().length > 3, 'an entry point with no readable label');
    assert.match(b[0], /onclick="askAbout\('(player|board)'\)"/, `unexpected handler: ${b[0]}`);
  }
  assert.ok(/id="profileAskBtn"/.test(HTML), 'the profile has no ask entry point');
});

test('a profile question names the player and follows the open tab', () => {
  const body = askAboutBody();
  assert.match(body, /player\.name/, 'the question does not name the player');
  // Four tabs, four questions. A single generic question would send the same
  // thing from the medical tab as from the stats one.
  const topics = body.match(/tab === '(\w+)'/g) || [];
  assert.ok(topics.length >= 3,
    `only ${topics.length} tab-specific questions — the prefill ignores what the reader is reading`);
  assert.match(body, /injury history/i, 'the medical tab should ask about the medical layer');
});

test('a board question names the metric, the position and the season', () => {
  const body = askAboutBody();
  // Defence and athletic boards carry different dimensions and need their own
  // phrasing — the same reason their routes differ.
  assert.match(body, /labMode === 'defense'/, 'the defence board would be asked about as if it ranked players');
  assert.match(body, /labMode === 'athletic'/, 'the athletic board has no season and would be asked about as if it did');

  // EVERY branch has to carry context, not just one of them. Checking the whole
  // function for `labPos` passes while the default branch says "Who led this
  // board?" — the other branches keep the token alive and the assertion green.
  const board = body.slice(body.indexOf("kind === 'board'"));
  const templates = [...board.matchAll(/`([^`]*)`/g)].map(m => m[1])
    .filter(t => t.length > 25);   // the question strings, not small fragments
  assert.ok(templates.length >= 3, `expected a question per board shape, found ${templates.length}`);
  for (const t of templates) {
    assert.match(t, /\$\{/, `a board question with nothing interpolated into it: "${t.slice(0, 60)}"`);
    assert.ok(/\$\{label\}|\$\{label\.toLowerCase\(\)\}/.test(t),
      `a board question that does not name the metric: "${t.slice(0, 60)}"`);
  }
  // And the two shapes that HAVE a season must say which one.
  const seasoned = templates.filter(t => /labSeason/.test(t));
  assert.ok(seasoned.length >= 2,
    'fewer than two board questions name the season — they are ambiguous across three years of data');
});

test('the profile closes behind the reader', () => {
  const body = askAboutBody();
  assert.match(body, /closeProfile\(\)/,
    'the modal stays open over the ask page, so the reader lands behind a dialog they cannot see past');
});
