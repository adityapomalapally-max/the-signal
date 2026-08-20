/**
 * The two navigations.
 *
 * There are two of them — the desktop bar and the mobile drawer — and they are
 * separate markup, so they drift. They had: the drawer still said "Leaders"
 * long after the section was renamed to Stats & Charts, and it carried a Film
 * Room link the desktop bar did not, so one section was reachable on a phone
 * and invisible on a laptop.
 *
 * They are also the site's PRIMARY navigation, and they were `<a onclick>` with
 * no href — not keyboard focusable, not openable in a new tab, not a link to
 * anything reading the HTML. This repo's own rule is that anything worth
 * reading is worth linking.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function nav(cls) {
  const re = new RegExp(`<a class="${cls}[^"]*"([^>]*)>([^<]*)</a>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(HTML))) {
    const attrs = m[1];
    const page = (attrs.match(/data-page="([^"]+)"/) || [])[1] || null;
    const href = (attrs.match(/href="([^"]+)"/) || [])[1] || null;
    out.push({ page, href, label: m[2].trim(), attrs });
  }
  return out;
}

test('the desktop bar and the mobile drawer list the same sections', () => {
  const desktop = nav('nav-item');
  const mobile = nav('mobile-nav-link');
  assert.ok(desktop.length >= 8, `only ${desktop.length} desktop nav items found`);
  assert.deepStrictEqual(
    mobile.map(x => x.page), desktop.map(x => x.page),
    'the drawer and the bar disagree about which sections exist, or about their order');
});

test('and they call them the same thing', () => {
  // The drawer said "Leaders" for a section the bar called "Stats & Charts".
  const desktop = nav('nav-item');
  const mobile = nav('mobile-nav-link');
  for (let i = 0; i < desktop.length; i++) {
    assert.strictEqual(mobile[i].label, desktop[i].label,
      `${desktop[i].page}: the bar says "${desktop[i].label}", the drawer says "${mobile[i].label}"`);
  }
});

test('every nav item is a real link', () => {
  for (const cls of ['nav-item', 'mobile-nav-link']) {
    for (const item of nav(cls)) {
      assert.ok(item.href, `${cls} "${item.label}" has no href — it cannot be focused, opened in a new tab, or followed`);
      assert.match(item.href, /^\//, `${cls} "${item.label}" href should be root-relative, got "${item.href}"`);
      // The SPA still has to handle the click itself, or every nav click is a
      // full page load that throws away the loaded data.
      assert.match(item.attrs, /preventDefault/,
        `${cls} "${item.label}" would fall through to a full page load`);
    }
  }
});

test('every nav destination is a page the router knows', () => {
  const feeds = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-feeds.js'), 'utf8');
  const known = (feeds.match(/const ROUTE_PAGES = \[([^\]]*)\]/) || [])[1];
  assert.ok(known, 'ROUTE_PAGES not found in app-feeds.js');
  const pages = known.match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
  for (const item of nav('nav-item')) {
    if (item.page === 'home') continue;   // home is the bare route
    assert.ok(pages.includes(item.page),
      `the nav offers "${item.page}" but the router does not list it in ROUTE_PAGES`);
  }
});

test('a nav href matches the page it switches to', () => {
  // An href of /teams beside a handler that opens the players page is a link
  // that lies about where it goes — and the two only diverge silently.
  for (const cls of ['nav-item', 'mobile-nav-link']) {
    for (const item of nav(cls)) {
      const called = (item.attrs.match(/switchPage\('([^']+)'\)/) || [])[1];
      assert.strictEqual(called, item.page,
        `${cls} "${item.label}": data-page is "${item.page}" but the handler opens "${called}"`);
      const expected = item.page === 'home' ? '/' : `/${item.page}`;
      assert.strictEqual(item.href, expected,
        `${cls} "${item.label}": href "${item.href}" does not match the page it opens`);
    }
  }
});

test('the bar collapses before it stops fitting', () => {
  // This has broken twice, both times by adding a section: the ninth item
  // squeezed the search until its label wrapped into the subscribe button, and
  // the tenth pushed the whole bar past the viewport so the DOCUMENT scrolled
  // sideways between 768px and about 990px.
  //
  // The width is estimable from the labels, because the nav is one row of text
  // at a known size. Calibrated against the browser: ten items measured 731px
  // and this estimate puts them at 755 — deliberately over, so the guard trips
  // early rather than late.
  const CSS = fs.readFileSync(path.join(__dirname, '..', 'assets', 'styles.css'), 'utf8');
  const items = nav('nav-item');
  const PER_ITEM_PADDING = 20, PER_CHAR = 7.5;
  const LOGO = 107, SUBSCRIBE = 98, CHROME = 68;

  const label = t => t.replace(/&amp;/g, '&');
  const navWidth = items.reduce((sum, i) => sum + PER_ITEM_PADDING + label(i.label).length * PER_CHAR, 0);
  const needed = Math.ceil(LOGO + navWidth + SUBSCRIBE + CHROME);

  // The breakpoint at which .nav-center stops being displayed.
  const blocks = [...CSS.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/g)];
  const collapses = blocks
    .filter(([, , body]) => /\.nav-center\s*\{[^}]*display:\s*none/.test(body))
    .map(([, px]) => Number(px));
  assert.ok(collapses.length, 'nothing hides .nav-center — the bar never collapses to the drawer');

  const widest = Math.max(...collapses);
  assert.ok(widest >= needed,
    `the bar needs about ${needed}px for ${items.length} sections but only collapses at ${widest}px — `
    + `between those two widths it overflows and scrolls the whole page sideways`);
});

test('each step of the header ladder sits above what the step below needs', () => {
  // The search is hidden in stages. If a stage fires too late the bar is
  // already too wide by the time it helps.
  const CSS = fs.readFileSync(path.join(__dirname, '..', 'assets', 'styles.css'), 'utf8');
  const at = (re) => {
    const blocks = [...CSS.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/g)];
    const hit = blocks.filter(([, , body]) => re.test(body)).map(([, px]) => Number(px));
    return hit.length ? Math.max(...hit) : null;
  };
  const collapse = at(/\.nav-center\s*\{[^}]*display:\s*none/);
  const hideSearch = at(/\.nav-search\s*\{[^}]*display:\s*none/);
  const dropLabel = at(/\.nav-search span\s*\{[^}]*display:\s*none/);
  assert.ok(collapse && hideSearch && dropLabel, 'the ladder is missing a step');
  assert.ok(hideSearch > collapse,
    `the search is hidden at ${hideSearch}px but the sections survive to ${collapse}px — the search should go first`);
  assert.ok(dropLabel > hideSearch,
    `the search label drops at ${dropLabel}px, at or below where the whole search goes (${hideSearch}px)`);
});

test('the profile dialog announces which player it is', () => {
  // aria-modal scopes a screen reader to the dialog, so the page h1 behind it
  // is not the problem — the dialog's own name is. It carried a fixed
  // "Player profile", which is the same announcement for all 350 of them.
  const HTML_ = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const overlay = HTML_.match(/<div class="profile-overlay"[^>]*>/);
  assert.ok(overlay, 'the profile overlay is missing');
  const tag = overlay[0];
  assert.match(tag, /role="dialog"/);
  assert.match(tag, /aria-modal="true"/);
  const labelledBy = (tag.match(/aria-labelledby="([^"]+)"/) || [])[1];
  assert.ok(labelledBy, `the dialog has no aria-labelledby: ${tag}`);
  assert.ok(!/aria-label="/.test(tag),
    'a static aria-label wins over aria-labelledby and would put the fixed name back');
  // And the element it points at must be the one the render fills in.
  assert.ok(HTML_.includes(`id="${labelledBy}"`), `nothing on the page has id="${labelledBy}"`);
  const profileJs = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-profile.js'), 'utf8');
  assert.match(profileJs, new RegExp(`getElementById\\('${labelledBy}'\\)\\.textContent = player\\.name`),
    `${labelledBy} is not filled with the player's name, so the dialog would announce whatever was there last`);
});
