/**
 * The field map's phone layout.
 *
 * Measured before this existed: at 375px the table was 1,275px wide and
 * exactly TWO columns were on screen, because the player column alone took
 * 207px. A heat map you can see two cells of is not a heat map.
 *
 * The fix has one fragile part, and it is not the widths. The group header row
 * originally spanned the three leading columns with a single colspan="3". A
 * colspan cannot be taken apart by CSS, so hiding the Team column on a phone
 * would have shifted "By gap" and "By situation" one column left, and every
 * group label would have sat over the wrong run of data — silently, and only
 * on phones. That is what this file guards.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'assets', 'app-pages.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'assets', 'styles.css'), 'utf8');

// The block of CSS that only applies on a phone.
function mobileBlocks() {
  const out = [];
  const re = /@media\s*\(max-width:\s*768px\)\s*\{/g;
  let m;
  while ((m = re.exec(CSS))) {
    let depth = 1, i = re.lastIndex;
    for (; i < CSS.length && depth; i++) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}') depth--;
    }
    out.push(CSS.slice(re.lastIndex, i));
  }
  return out.join('\n');
}
const MOBILE = mobileBlocks();

test('the group header does not span the leading columns with one cell', () => {
  // The whole reason the labels stay aligned when Team is hidden.
  const table = JS.slice(JS.indexOf('function labFieldTable'), JS.indexOf('function fieldLegend'));
  assert.ok(!/field-group-row"><th colspan="3"/.test(table),
    'the lead columns are back to a single colspan="3" — hiding Team will slide every group label one column left');
  const leads = (table.match(/class="field-lead/g) || []).length;
  assert.strictEqual(leads, 3,
    `expected 3 individual lead header cells, found ${leads} — one per leading column is what lets CSS hide one`);
});

test('the team column is addressable on both the header and the body', () => {
  // Hiding it needs the class in three places: the group row, the header, and
  // every body cell. Miss one and the column half-disappears, which is worse
  // than not hiding it at all.
  const table = JS.slice(JS.indexOf('function labFieldTable'), JS.indexOf('function fieldLegend'));
  assert.match(table, /class="field-lead field-team"/, 'the group row has no hideable Team cell');
  assert.match(table, /sortTh\(tid, 'team', 'Team', \{ cls: 'field-team' \}\)/, 'the Team header carries no class');
  assert.match(table, /<td class="field-team">/, 'the Team body cells carry no class');
});

test('the phone layout actually hides the team column', () => {
  assert.match(MOBILE, /\.field-table th\.field-team[^{]*\{[^}]*display:\s*none/,
    'the Team column is not hidden on a phone, so the 207px name column still leaves room for two columns');
});

test('the name column sticks, so a scrolled row is still identified', () => {
  // Without this, scrolling right loses whose row it is — which on a board
  // ranking 46 backs makes every number unattributable.
  assert.match(CSS, /\.field-table (th\.field-name-col|td\.field-name)[^{]*\{[\s\S]{0,200}?position:\s*sticky/,
    'the player column does not stick');
  assert.match(CSS, /\.field-table th\.field-name-col[\s\S]{0,300}?background:/,
    'a sticky cell needs an opaque background or the data scrolls visibly underneath it');
});

test('a capped column is capped, not merely floored', () => {
  // min-width alone did not work: the long headers ("3rd/4th & short") pushed
  // the columns to 93px anyway, because a floor does not stop growth.
  const col = MOBILE.match(/\.field-table th\.field-col\s*\{([^}]*)\}/);
  assert.ok(col, 'no phone rule for the data columns');
  assert.match(col[1], /max-width/, 'the data columns have a min-width but no max-width — they will grow to fit the header text');
  assert.match(col[1], /white-space:\s*normal/,
    'capping the width without letting the label wrap just clips the header');
});
