/**
 * The sitemap is a set of promises made to a crawler. These check we only
 * promise pages we actually have, and in the state we meant to publish.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const read = name => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name), 'utf8'));

test('the sitemap is well-formed and non-trivial', () => {
  assert.ok(xml.startsWith('<?xml'), 'missing XML declaration');
  assert.ok(xml.includes('http://www.sitemaps.org/schemas/sitemap/0.9'), 'missing urlset namespace');
  assert.ok(locs.length > 100, `only ${locs.length} URLs`);
});

test('every URL is absolute and on one host', () => {
  // A relative or wrong-host entry is silently ignored by crawlers.
  for (const loc of locs) {
    assert.ok(/^https:\/\//.test(loc), `not absolute: ${loc}`);
  }
  const hosts = new Set(locs.map(l => new URL(l).host));
  assert.strictEqual(hosts.size, 1, `mixed hosts: ${[...hosts].join(', ')}`);
});

test('no duplicate URLs', () => {
  const seen = new Set();
  const dupes = locs.filter(l => (seen.has(l) ? true : (seen.add(l), false)));
  assert.deepStrictEqual(dupes, [], `duplicates: ${dupes.slice(0, 3).join(', ')}`);
});

test('draft articles are never submitted for indexing', () => {
  // Submitting an unfinished page gets the unfinished version cached and shown.
  const articles = (read('articles.json') || {}).articles || [];
  for (const a of articles) {
    if (!a || !a.slug) continue;
    const url = locs.find(l => l.endsWith(`/article/${a.slug}`));
    if (a.status === 'published') {
      assert.ok(url, `published article "${a.slug}" is missing from the sitemap`);
    } else {
      assert.ok(!url, `draft article "${a.slug}" is in the sitemap`);
    }
  }
});

test('every player URL points at a player in the pool', () => {
  const ids = new Set(read('players.json').map(p => p.id));
  for (const loc of locs) {
    const m = loc.match(/\/player\/([^/]+)$/);
    if (m) assert.ok(ids.has(decodeURIComponent(m[1])), `sitemap lists /player/${m[1]}, not in the pool`);
  }
});

test('the pool is fully represented', () => {
  const players = read('players.json');
  const listed = new Set(locs.filter(l => l.includes('/player/')).map(l => decodeURIComponent(l.split('/player/')[1])));
  for (const p of players) {
    assert.ok(listed.has(p.id), `${p.name} (${p.id}) is missing from the sitemap`);
  }
});

test('/film is not offered while it says coming soon', () => {
  assert.ok(!locs.some(l => l.endsWith('/film')), '/film is in the sitemap but has no content');
});

test('robots.txt points at the sitemap and keeps raw data out of the index', () => {
  assert.match(robots, /^Sitemap: https:\/\/\S+\/sitemap\.xml$/m);
  assert.match(robots, /^Disallow: \/data\/$/m);
  assert.match(robots, /^User-agent: \*$/m);
});

test('robots.txt and the sitemap agree about the host', () => {
  const declared = robots.match(/^Sitemap: (https:\/\/[^/]+)\//m)[1];
  const host = new URL(locs[0]).origin;
  assert.strictEqual(declared, host, 'robots.txt and sitemap.xml disagree about the site host');
});
