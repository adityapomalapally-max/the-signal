/**
 * Text from a feed is text, never markup.
 *
 * THREE THINGS ON THIS SITE ARE WRITTEN BY SOMEBODY ELSE and rendered into the
 * page: ESPN's news payload (fetched live, client-side, on every page load),
 * the Substack feed as relayed by api.rss2json.com — a free proxy, not
 * Substack — and Sleeper's trending board. All three were interpolated into
 * innerHTML raw, and their links became hrefs unchecked.
 *
 * Verified in a browser before the fix, against the template as it then stood:
 * a headline of `<img src=x onerror=...>` EXECUTED, and `javascript:` survived
 * into the href. This was a live hole, not a theoretical one.
 *
 * THE CSP DOES NOT COVER THIS AND CANNOT. The markup carries ~108 inline
 * onclick handlers, so script-src needs 'unsafe-inline', which is precisely
 * what an injected `onerror` needs too — confirmed in the browser, the payload
 * ran with the CSP enforced. Escaping at the render site is the whole defence;
 * there is no second layer behind it.
 *
 * So this file asserts both halves: that the escapers do what they claim, and
 * that the render sites still call them. The second half is the one that rots —
 * a new field added to a card is the shape this comes back in.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const A = path.join(__dirname, '..', 'assets');
const core = fs.readFileSync(path.join(A, 'app-core.js'), 'utf8');
const feeds = fs.readFileSync(path.join(A, 'app-feeds.js'), 'utf8');
const profile = fs.readFileSync(path.join(A, 'app-profile.js'), 'utf8');

// Lift a single function out of the browser bundle and make it callable here.
// The assets are classic scripts that run top-level code against a DOM, so the
// file cannot simply be required; the function under test can.
function lift(src, name) {
  const re = new RegExp('function ' + name + '\\s*\\([\\s\\S]*?\\n}', 'm');
  const m = src.match(re);
  assert.ok(m, `${name} not found — it was renamed or removed`);
  return new Function(m[0] + `; return ${name};`)();
}

const safeUrl = lift(core, 'safeUrl');
const rankEsc = lift(core, 'rankEsc');
const jsAttr = lift(profile, 'jsAttr');

/* ── The escapers ───────────────────────────────────────────────────────── */

test('rankEsc neutralises every character that can open a tag or leave an attribute', () => {
  assert.equal(rankEsc('<img src=x onerror="go()">'), '&lt;img src=x onerror=&quot;go()&quot;&gt;');
  assert.equal(rankEsc('a & b'), 'a &amp; b');
  // The ampersand must be escaped FIRST or the escapes escape each other.
  assert.equal(rankEsc('<'), '&lt;');
  assert.ok(!rankEsc('</script><script>x</script>').includes('<'));
});

test('safeUrl passes http(s) through and refuses everything else', () => {
  assert.equal(safeUrl('https://espn.com/a'), 'https://espn.com/a');
  assert.equal(safeUrl('http://espn.com/a'), 'http://espn.com/a');
  for (const hostile of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '//evil.example/x',
    '',
    null,
    undefined,
  ]) {
    assert.equal(safeUrl(hostile), '#', `safeUrl let through: ${String(hostile)}`);
  }
});

test('safeUrl escapes a url that would otherwise leave its attribute', () => {
  const out = safeUrl('https://e.com/?a=1&b=2"><img src=x onerror=go()>');
  assert.ok(!out.includes('"'), 'a quote survived and can close the attribute');
  assert.ok(!out.includes('<'), 'an angle bracket survived and can open a tag');
  assert.ok(out.includes('&amp;'), 'the ampersand should be encoded, not dropped');
});

test('jsAttr closes the JS string AND the attribute around it', () => {
  // The original escaped only \ and ' — enough for the inner JS string and
  // nothing for the double-quoted attribute it sits inside.
  assert.ok(!jsAttr('a"onmouseover="go()').includes('"'), 'a quote escapes the attribute');
  assert.ok(!jsAttr('a<script>').includes('<'), 'an angle bracket opens a tag');
  assert.ok(jsAttr("Ja'Marr").includes("\\'"), 'the apostrophe case it was written for still works');
});

/* ── The render sites still call them ───────────────────────────────────── */

// Comments quote the code they explain, so a scan of the raw file passes on a
// paragraph describing a line that has been deleted. Same rule the CSS and
// render-loop tests learned.
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const feedsCode = stripComments(feeds);

// The WHOLE function, not a fixed slice. A window sized to today's code stops
// covering the lines that get added to the end of it, which is where a new
// unescaped field would go.
function block(name) {
  const i = feedsCode.indexOf('function ' + name);
  assert.ok(i >= 0, `${name} not found`);
  const body = feedsCode.slice(i);
  const open = body.indexOf('{');
  let depth = 0;
  for (let j = open; j < body.length; j++) {
    if (body[j] === '{') depth++;
    else if (body[j] === '}' && --depth === 0) return body.slice(0, j + 1);
  }
  throw new Error(`${name} never closes`);
}

test('the ESPN news card escapes every field and checks its link', () => {
  const b = block('renderNewsCards');
  assert.ok(/href="\$\{safeUrl\(article\.link\)\}"/.test(b), 'the news card href is not checked');
  for (const f of ['headline', 'description', 'date']) {
    assert.ok(
      new RegExp('\\$\\{rankEsc\\(article\\.' + f + '\\)\\}').test(b),
      `article.${f} is interpolated raw`
    );
    assert.ok(
      !new RegExp('\\$\\{article\\.' + f + '\\}').test(b),
      `article.${f} still has an unescaped interpolation`
    );
  }
  assert.ok(/rel="noopener noreferrer"/.test(b), 'the external link has no rel');
});

test('the Substack sidebar treats the proxy payload as text', () => {
  const b = block('loadSubstack');
  assert.ok(/href="\$\{safeUrl\(item\.link\)\}"/.test(b), 'the sidebar href is not checked');
  assert.ok(/\$\{rankEsc\(item\.title\)\}/.test(b), 'item.title is interpolated raw');
  assert.ok(!/\$\{item\.title\}/.test(b), 'item.title still has an unescaped interpolation');
});

test('no feed link is opened from script without being checked first', () => {
  // window.open does NOT imply noopener the way target=_blank now does, and it
  // took a javascript: url before openExternal existed.
  const bad = feedsCode.match(/window\.open\([^)]*\.link[^)]*\)/g);
  assert.equal(bad, null, `a feed link goes straight to window.open: ${bad}`);
});

test('the Sleeper trending rows escape the feed and the id in the handler', () => {
  const b = block('loadSleeperTrending');
  assert.ok(!/\$\{t\.name\}/.test(b), 't.name is interpolated raw');
  assert.ok(!/\$\{t\.injury_status\}/.test(b), 't.injury_status is interpolated raw');
  assert.ok(!/\$\{injStatus\}/.test(b), 'injStatus is interpolated raw');
  assert.ok(!/openProfile\('\$\{ourPlayer\.id\}'\)/.test(b), 'the id reaches an onclick unescaped');
});

/* ── The cache that could never have worked ─────────────────────────────── */

test('the Sleeper player DB is slimmed before it is cached', () => {
  // The payload is 14.6MB and localStorage holds ~5, so setItem threw every
  // time and the cache never populated — which looks exactly like a working
  // cache except that the 14.6MB is refetched on every single page load.
  assert.ok(/function slimSleeperDB/.test(feedsCode), 'the slimming step is gone');
  const b = block('loadSleeperPlayerDB');
  assert.ok(/setItem\(cacheKey, JSON\.stringify\(sleeperPlayers\)\)/.test(b),
    'the raw 14.6MB response is being stored again');
  assert.ok(!/setItem\(cacheKey, JSON\.stringify\(data\)\)/.test(b),
    'the unslimmed response is being stored');
});

test('reading the cache cannot take the page down', () => {
  const b = block('loadSleeperPlayerDB');
  const parseAt = b.indexOf('JSON.parse(cached)');
  const tryAt = b.indexOf('try {');
  assert.ok(parseAt > 0 && tryAt > 0 && tryAt < parseAt,
    'JSON.parse of the cached value is outside a try — corrupt storage rejects the promise');
});
