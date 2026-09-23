/**
 * A link is its address.
 *
 * TWO WAYS A LINK LIES, and the site had both in its footer, on every page.
 *
 *   IT GOES NOWHERE. "Twitter / X" and "Instagram" were `href="#"`. They looked
 *   like somewhere to go, hovered like it, and did nothing — and "Trade
 *   Analyzer" was worse, because it DID navigate, to a page that has never had
 *   a trade analyzer on it. A promise the site does not keep is the same
 *   failure as a number it cannot support.
 *
 *   IT WORKS BUT HAS NO ADDRESS. The nav has carried real paths since routing
 *   moved off hashes; the footer was still `href="#"` with data-click doing the
 *   work. That is no middle-click, no open-in-new-tab, nothing for a crawler to
 *   follow, and an empty status bar on hover. The handler is the transition;
 *   the href is what the link IS.
 *
 *   node --test tests/links.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

// Every address the site answers to, derived from the same lists the router
// uses rather than typed here a second time.
const feeds = fs.readFileSync(path.join(ROOT, 'assets', 'app-feeds.js'), 'utf8');
const pages = fs.readFileSync(path.join(ROOT, 'assets', 'app-pages.js'), 'utf8');
const ROUTE_PAGES = JSON.parse(
  (feeds.match(/const ROUTE_PAGES = (\[[^\]]+\])/) || [])[1].replace(/'/g, '"'));
const SEASON_VIEWS = JSON.parse(
  (pages.match(/const SEASON_VIEWS = (\[[^\]]+\])/) || [])[1].replace(/'/g, '"'));

test('no anchor in the markup goes nowhere', () => {
  for (const f of html) {
    const src = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const dead = [...src.matchAll(/<a\b[^>]*href="#"[^>]*>([^<]*)</g)].map(m => m[1].trim());
    assert.deepStrictEqual(dead, [],
      `${f}: link(s) with href="#" — ${dead.join(', ')}. Give it the address it goes to, or remove it.`);
  }
});

test('every internal link carries the path it navigates to', () => {
  // The data-click is the SPA transition. The href is the link.
  for (const f of html) {
    const src = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    for (const m of src.matchAll(/<a\b([^>]*data-click="(?:page|nav)"[^>]*)>/g)) {
      const attrs = m[1];
      const href = (attrs.match(/href="([^"]*)"/) || [])[1];
      const arg = (attrs.match(/data-arg="([^"]*)"/) || [])[1];
      assert.ok(href && href !== '#', `${f}: a data-click="${arg}" link has no href`);
      assert.ok(href.startsWith('/'),
        `${f}: href="${href}" is not root-relative — from /player/x it resolves under the player`);
      const expected = arg === 'home' ? '/' : `/${arg}`;
      assert.strictEqual(href, expected,
        `${f}: href="${href}" and data-arg="${arg}" point at different places`);
    }
  }
});

test('every place the footer sends a reader is a place that exists', () => {
  // "Trade Analyzer" pointed at /fantasy, which has never had one. A link that
  // arrives somewhere real and WRONG is the harder of the two to notice.
  const src = strip(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  const footer = src.slice(src.lastIndexOf('<footer') >= 0 ? src.lastIndexOf('<footer') : src.indexOf('footer-col'));
  const targets = [...footer.matchAll(/href="(\/[^"]*)"/g)].map(m => m[1]);
  assert.ok(targets.length >= 8, `only ${targets.length} internal footer links found — has the footer moved?`);

  for (const t of targets) {
    const parts = t.split('/').filter(Boolean);
    if (!parts.length) continue;                       // "/" is the home page
    assert.ok(ROUTE_PAGES.includes(parts[0]), `the footer links to /${parts[0]}, which is not a page`);
    if (parts[0] === 'season' && parts[1]) {
      assert.ok(SEASON_VIEWS.includes(parts[1]), `the footer links to a season view that does not exist: ${t}`);
    }
  }
});

test('an external link cannot reach back through the tab it opened', () => {
  for (const f of html) {
    const src = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    for (const m of src.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
      assert.match(m[0], /rel="[^"]*noopener/,
        `${f}: a target="_blank" link has no rel=noopener — ${m[0].slice(0, 90)}`);
    }
  }
});

test('the fantasy page leads with the season it is in', () => {
  // It led with a draft board against a market that closed on September 9th,
  // for three weeks of football, because nothing moved it.
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const page = src.slice(src.indexOf('id="page-fantasy"'), src.indexOf('id="page-draft"'));
  const strip2 = strip(page);
  const tools = [...strip2.matchAll(/<h4>([^<]+)<\/h4>/g)].map(m => m[1].trim());
  assert.ok(tools.length >= 4, `only ${tools.length} tools on the fantasy page`);
  assert.ok(tools.indexOf('Value Board') === tools.length - 1,
    `the draft board is not last in the strip — it is: ${tools.join(', ')}`);
  assert.ok(tools.includes('Start / Sit') && tools.includes('Waiver Wire'),
    `the in-season tools are not on the fantasy page: ${tools.join(', ')}`);

  // AND THE BADGE HAS TO SAY WHICH IT IS. A green "live" dot on a closed market
  // is the same lie the caveats were telling in the present tense.
  const vb = strip2.slice(strip2.indexOf('Value Board'));
  assert.match(vb, /badge-archive/, 'the Value Board still wears a live badge');
  assert.doesNotMatch(vb.slice(0, 400), /badge-live/, 'the Value Board still wears a live badge');
});

test('the value board says the market closed, and reads it off the file', () => {
  // Not a sentence typed here: fetch-adp stamps meta.historical and
  // meta.closedAt when the market shuts, and the board reads them back. A date
  // written into the renderer would be right for one season.
  assert.match(pages, /m\.historical/, 'the value board no longer checks whether the market is closed');
  assert.match(pages, /RECORD, NOT A LIVE MARKET/, 'nothing tells the reader the board has stopped moving');
  assert.match(pages, /m\.closedAt/, 'the closing date is not read from the file');

  const adp = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'adp.json'), 'utf8'));
  if (adp.meta.historical) {
    assert.ok(adp.meta.closedAt, 'the file says the market is closed and does not say when');
  }
});
