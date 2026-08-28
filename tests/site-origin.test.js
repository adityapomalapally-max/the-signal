/**
 * One host, and every copy of it says the same thing.
 *
 * THE DOMAIN WAS IN SIX HAND-MAINTAINED PLACES and the comment beside one of
 * them said three. Three build scripts each held a copy, app-feeds.js held
 * SITE_ORIGIN, app-export.js painted the host onto exported charts as a bare
 * literal, and index.html's head carried it seven times. Nothing compared them.
 *
 * THE FAILURE THAT MATTERS IS THE PARTIAL MOVE. Change five of six and the site
 * still builds, still renders, and still serves — while some fraction of its
 * canonical tags, og:urls and sitemap entries point at a host that is not the
 * site. Google reads exactly those. Nothing errors, so nothing tells anyone,
 * which is the shape of every silent failure this repo has a rule about.
 *
 * The node side reads scripts/lib/site.js. The browser side cannot — the assets
 * are classic scripts with no module system — and index.html's head is written
 * by hand. So the copies that cannot be eliminated are made unable to drift
 * quietly instead.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const site = require('../scripts/lib/site.js');
const core = fs.readFileSync(path.join(ROOT, 'assets', 'app-core.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const ORIGIN = site.ORIGIN;

test('the shared origin is a bare https root with no trailing slash', () => {
  assert.match(ORIGIN, /^https:\/\/[a-z0-9.-]+$/,
    'ORIGIN must be scheme + host only — every caller appends its own path');
});

test('the browser copy agrees with the node one', () => {
  const m = core.match(/const SITE_ORIGIN = '([^']+)'/);
  assert.ok(m, 'SITE_ORIGIN is gone from app-core.js');
  assert.equal(m[1], ORIGIN,
    'assets/app-core.js and scripts/lib/site.js disagree about where this site lives');
});

test("index.html's head agrees, in every tag that carries the host", () => {
  const head = indexHtml.slice(0, indexHtml.indexOf('</head>'));
  const hosts = new Set();
  for (const m of head.matchAll(/https:\/\/([a-z0-9.-]*(?:vercel\.app|thesignalfootball\.com|thesignal[a-z.]*))/gi)) {
    hosts.add(m[1].toLowerCase());
  }
  assert.ok(hosts.size > 0, 'no canonical-shaped host found in the head at all');
  for (const h of hosts) {
    assert.equal('https://' + h, ORIGIN,
      `index.html's head still points at ${h}; the move was left half-done`);
  }
});

test('the canonical tag specifically, because it is the one Google reads', () => {
  const m = indexHtml.match(/<link rel="canonical" href="([^"]+)"/);
  assert.ok(m, 'index.html has no canonical tag');
  assert.equal(m[1], ORIGIN + '/', 'the canonical does not match the shared origin');
});

test('no build script holds its own copy of the host any more', () => {
  for (const f of ['build-sitemap.js', 'build-page-shells.js', 'build-og-image.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8');
    assert.ok(/require\(['"]\.\/lib\/site\.js['"]\)/.test(src),
      `${f} does not read the shared origin`);
    assert.ok(!/const (ORIGIN|SITE_HOST) = ['"]https?:/.test(src),
      `${f} has gone back to holding its own host`);
  }
});

test('the exported chart paints the host from the constant, not a literal', () => {
  const ex = fs.readFileSync(path.join(ROOT, 'assets', 'app-export.js'), 'utf8');
  assert.ok(/fillText\(SITE_HOST,/.test(ex), 'the export footer no longer uses SITE_HOST');
  assert.ok(!/fillText\(['"][a-z0-9.-]+\.(vercel\.app|com)['"]/.test(ex),
    'a hardcoded host is being painted onto exports again');
});

test('the generated files were rebuilt after the last move', () => {
  // sitemap.xml and robots.txt are generated, so they are the evidence that the
  // three builders were actually re-run rather than only the constants edited.
  const host = ORIGIN.replace(/^https:\/\//, '');
  for (const f of ['sitemap.xml', 'robots.txt']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    const stale = src.match(/https:\/\/([a-z0-9.-]+)\//g) || [];
    const wrong = [...new Set(stale)].filter(u => !u.includes(host) && !u.includes('www.w3.org')
      && !u.includes('sitemaps.org') && !u.includes('google.com'));
    assert.deepEqual(wrong, [],
      `${f} still lists ${wrong.join(', ')} — re-run build-sitemap.js`);
  }
});
