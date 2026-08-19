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
