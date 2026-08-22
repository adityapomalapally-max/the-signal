/**
 * The phone.
 *
 * Measured at a 390px viewport before this file existed:
 *
 *   - Stats & Charts set the page width to 537px, because the mode switch is
 *     four pills in a flex row that could not wrap. The whole DOCUMENT scrolled
 *     sideways, which is the one thing this repo has a standing rule against.
 *   - Every form control on the site was under 16px, and mobile Safari zooms
 *     the viewport when a field smaller than that takes focus and does not
 *     zoom back out. Tapping the search box left the reader magnified, with
 *     no control that undoes it.
 *   - The players table ran 540px inside a 385px box with nothing pinned, so
 *     scrolling to a player's rank scrolled his name off the screen.
 *   - The hamburger — the only navigation a phone has — was a 30x24 target.
 *   - The closed nav drawer sat off-canvas but visible, so fourteen controls
 *     stayed in the keyboard's tab order on a desktop that cannot open it.
 *
 * These are the rules that keep those fixed. They are CSS assertions rather
 * than a rendered check because the numbers above came from a browser and the
 * cheap way to lose them is a later block quietly re-setting the property —
 * which is exactly how the last players-table padding fix was lost.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// COMMENTS COME OUT FIRST. Every rule in this stylesheet is explained in prose
// directly above it, and the prose quotes the declaration it is explaining — so
// a test that greps the raw file passes on the comment describing a rule that
// has been deleted. That is not hypothetical: deleting `visibility: hidden`
// from the drawer left the sentence "visibility:hidden takes it out of the tab
// order" sitting in the same block, and the assertion matched it.
const CSS = fs.readFileSync(path.join(ROOT, 'assets', 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const FEEDS = fs.readFileSync(path.join(ROOT, 'assets', 'app-feeds.js'), 'utf8');

// Every block that applies on a phone: the width queries and the touch ones.
function blocks(re) {
  const out = [];
  let m;
  const rx = new RegExp(re, 'g');
  while ((m = rx.exec(CSS))) {
    let depth = 1, i = rx.lastIndex;
    for (; i < CSS.length && depth; i++) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}') depth--;
    }
    out.push(CSS.slice(rx.lastIndex, i));
  }
  return out.join('\n');
}
// Every rule whose selector list contains this exact selector.
//
// This is a scanner rather than a regex because the obvious regex anchors each
// rule on the previous rule's closing brace — and having consumed that brace,
// it cannot anchor the rule immediately after it. The rule that went missing
// that way was the one the test existed to check.
function rulesFor(sel, css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const close = css.indexOf('}', open);
    if (close === -1) break;
    // Anything before the last closing brace belongs to the rule before this
    // one — block extraction leaves a stray brace at each block boundary, and
    // carrying it into the selector text makes every rule after a boundary
    // invisible to an exact-match comparison.
    const selectors = css.slice(i, open).split('}').pop().trim();
    const body = css.slice(open + 1, close);
    if (selectors.split(',').some(s => s.trim() === sel)) out.push(selectors + ' { ' + body.trim() + ' }');
    i = close + 1;
  }
  return out;
}

const NARROW = blocks('@media\\s*\\(max-width:\\s*768px\\)\\s*\\{');
const TOUCH = blocks('@media\\s*\\(pointer:\\s*coarse\\)[^{]*\\{');
const PHONE = NARROW + '\n' + TOUCH;

test('a flex row of pills wraps, so it cannot set the page width', () => {
  // 517px of mode switch against a 390px viewport. A row that cannot wrap is
  // as wide as its content, and a child wider than the viewport scrolls the
  // document — not the row.
  const rule = CSS.match(/\.position-filter\s*\{[^}]*\}/);
  assert.ok(rule, '.position-filter is gone');
  assert.match(rule[0], /flex-wrap:\s*wrap/,
    '.position-filter no longer wraps — the Stats & Charts mode switch will set the page width on a phone');
});

test('every form control on the site is 16px on a phone', () => {
  // The rule this replaced was `input, select, textarea`, which loses to
  // `.players-search-input` on specificity and therefore changed nothing.
  // So the test is not "a rule exists" — it is that the rule NAMES every
  // control the markup actually uses.
  const rule = NARROW.match(/([^{}]*)\{[^}]*font-size:\s*16px[^}]*\}/);
  assert.ok(rule, 'nothing sets a 16px font size on a phone');
  const covered = rule[1];

  const classes = new Set();
  const re = /<(input|select|textarea)\b[^>]*>/g;
  let m;
  while ((m = re.exec(HTML))) {
    const cls = (m[0].match(/class="([^"]+)"/) || [])[1];
    if (cls) cls.split(/\s+/).forEach(c => classes.add(c));
    else classes.add(`${m[1]} (no class)`);
  }
  assert.ok(classes.size >= 3, 'no form controls found — has the markup moved?');

  for (const cls of classes) {
    if (cls.endsWith('(no class)')) {
      // The drawer's search input is matched through its parent instead.
      assert.match(covered, /\.mobile-nav-search input/,
        'a control with no class of its own is not covered by the 16px rule');
      continue;
    }
    assert.match(covered, new RegExp(`\\.${cls.replace(/[-]/g, '\\-')}\\b`),
      `.${cls} is not in the 16px rule — focusing it zooms mobile Safari and nothing zooms back out`);
  }
});

test('the wide tables pin their first column on a phone', () => {
  // The field map settled this: the row has to stay identified while the data
  // scrolls under it. These two are the other tables that do not fit.
  //
  // Every matching rule is checked rather than the first, because a phone
  // block further up the file already styles the same cells (it sets their
  // padding), and asserting against whichever one the regex reached first is
  // how a test ends up green about a rule it never looked at.
  for (const sel of ['.players-table', '.scheme-table']) {
    const rules = rulesFor(sel + ' th:first-child', NARROW);
    assert.ok(rules.length, `${sel} has no phone rule for its first column`);
    const sticky = rules.filter(r => /position:\s*sticky/.test(r));
    assert.strictEqual(sticky.length, 1,
      `${sel} should stick its first column on a phone exactly once, found ${sticky.length}`);
    assert.match(sticky[0], /left:\s*0/, `${sel}'s sticky column has no offset to stick to`);
  }
});

test('a sticky cell repaints its own background, and the head is not the body', () => {
  // Without a background the scrolled columns show through it. With the WRONG
  // background the column head is a dark notch in a lighter header row: the
  // body sits on the page, the header carries a raised surface. Both were
  // seen at 390px before this test.
  const bg = (sel) => {
    for (const r of rulesFor(sel, NARROW)) {
      const m = r.match(/background:\s*var\((--[a-z-]+)\)/);
      if (m) return m[1];
    }
    return null;
  };
  const tdBg = bg('.players-table td:first-child');
  const thBg = bg('.players-table thead th:first-child');
  assert.ok(tdBg, 'the sticky body cell has no background — the scrolled columns will show through it');
  assert.ok(thBg, 'the sticky header cell has no background — the scrolled columns will show through it');
  assert.notStrictEqual(tdBg, thBg,
    'the sticky header cell uses the body background — it reads as a notch cut out of the header row');
});

test('the controls a thumb has to hit are at least 44px', () => {
  // The dense data controls were raised last pass. These are the ones that
  // were missed, and the hamburger is the one that matters most: it is the
  // only navigation a phone has.
  for (const sel of ['.hamburger', '.filter-select', '.profile-close', '.social-link', '.footer-col a']) {
    const rules = rulesFor(sel, PHONE);
    assert.ok(rules.length, `${sel} has no phone rule at all`);
    assert.ok(rules.some(r => /(min-height|height):\s*44px/.test(r)),
      `${sel} is under the 44px touch floor on a phone`);
  }
});

test('the closed drawer is gone, not merely off screen', () => {
  const base = CSS.match(/\.mobile-nav-drawer\s*\{[^}]*\}/);
  const open = CSS.match(/\.mobile-nav-drawer\.open\s*\{[^}]*\}/);
  assert.ok(base && open, 'the drawer rules have moved');
  assert.match(base[0], /visibility:\s*hidden/,
    'the closed drawer is visible — its controls stay in the tab order on a desktop that cannot open it');
  assert.match(open[0], /visibility:\s*visible/, 'the open drawer never becomes visible');

  // Visibility is DELAYED, not transitioned. Left to discrete interpolation it
  // flips at a moment that differs between engines, and in a throttled frame
  // it never flips at all — the drawer opens and stays invisible.
  assert.match(base[0], /visibility\s+0s\s+linear\s+0\.3s/,
    'the closed drawer transitions visibility instead of delaying it');
  assert.match(open[0], /visibility\s+0s/,
    'the open drawer does not switch visibility immediately');
});

test('a phone can search for a player', () => {
  // `.nav-search` is display:none under 768px, so without this the only route
  // to a player is the Players page's own box, two steps in.
  // (`.nav-search` is display:none under 768px; the assertion that matters is the drawer's.)
  const form = HTML.match(/<form class="mobile-nav-search"[\s\S]{0,400}?<\/form>/);
  assert.ok(form, 'the drawer has no search');
  assert.match(form[0], /<input[^>]*aria-label="[^"]+"/, 'the drawer search input has no accessible name');
  assert.match(form[0], /onsubmit="[^"]*mobileNavSearch\(/, 'the drawer search does not submit to mobileNavSearch');
  // A REAL input. The desktop affordance switches page and calls focus()
  // behind a timeout; iOS only raises the keyboard for a focus inside the tap
  // itself, so that pattern lands on a search box with no keyboard.
  assert.ok(!/mobile-nav-search[\s\S]{0,300}focus\(\)/.test(HTML),
    'the drawer search focuses another field instead of taking the typing itself');
});

test('the drawer search reuses the page filter rather than reimplementing it', () => {
  const fn = FEEDS.match(/function mobileNavSearch\([\s\S]*?\n\}/);
  assert.ok(fn, 'mobileNavSearch is gone');
  assert.match(fn[0], /filterPlayers\(/,
    'mobileNavSearch does its own filtering — there is now more than one search on this site');
  assert.match(fn[0], /switchPage\('players'\)/, 'mobileNavSearch does not open the results');
});
