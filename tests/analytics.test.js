/**
 * Counting readers without giving up the policy that protects them.
 *
 * Three ways this goes wrong, and none of them break a page visibly:
 *
 *   THE VENDOR SNIPPET IS AN INLINE SCRIPT. Vercel's HTML instructions put the
 *   queue in an inline <script>, which `script-src 'self'` refuses. The failure
 *   mode is not the missing count — it is somebody restoring 'unsafe-inline' to
 *   make the count work, and handing back the directive that made the August
 *   XSS exploitable. Same reason tests/csp.test.js exists.
 *
 *   THE SPA REWRITE ANSWERS EVERYTHING. vercel.json rewrites every path to
 *   index.html, so before this the collector's own URL returned the home page —
 *   51KB of HTML, served to a <script> tag, parsed as JavaScript. The site
 *   already learned this with data files: a bare path resolves somewhere
 *   unexpected, the rewrite answers with index.html, and the page gets HTML
 *   where it expected something else.
 *
 *   THE QUEUE ARRIVES AFTER THE CALLS. The collector is deferred; anything
 *   recorded before it loads is dropped unless window.va exists first.
 *
 *   node --test tests/analytics.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('nothing executable is inlined into a page', () => {
  // The rule the CSP already enforces in production, asserted here so it fails
  // at the commit rather than in a reader's console. JSON-LD is data, not
  // script, and CSP does not govern it — anything else with no src does.
  for (const f of html) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const [tag] of src.matchAll(/<script\b[^>]*>/g)) {
      const hasSrc = /\ssrc\s*=/.test(tag);
      const isData = /type\s*=\s*["']application\/(ld\+json|json)["']/.test(tag);
      assert.ok(hasSrc || isData,
        `${f} carries an inline script (${tag.trim()}). script-src is 'self' with no 'unsafe-inline', `
        + `so it will not run — and putting the directive back to fix it is how the August XSS became exploitable. `
        + `Move the code into assets/ and load it by src.`);
    }
  }
});

test('the queue exists before the collector that drains it', () => {
  const stub = index.indexOf('/assets/analytics.js');
  const collector = index.indexOf('/_vercel/insights/script.js');
  assert.ok(stub > -1, 'the analytics queue is not loaded at all');
  assert.ok(collector > -1, 'nothing collects anything');
  assert.ok(stub < collector,
    'the collector is loaded before the queue it drains, so anything recorded during boot is lost');

  const src = fs.readFileSync(path.join(ROOT, 'assets', 'analytics.js'), 'utf8');
  assert.match(src, /window\.va\s*=\s*window\.va\s*\|\|/, 'the stub no longer defines the call surface');
  assert.match(src, /window\.vaq\s*=\s*window\.vaq\s*\|\|/, 'the stub no longer queues, so early calls are dropped');
});

test('the SPA rewrite does not answer the collector with the home page', () => {
  // THE PROPERTY, NOT THE SPELLING. What matters is that the catch-all does not
  // match a platform path — asserted by running its own regex, so any rewrite
  // of the exclusion that still works keeps passing and any that does not goes
  // red. Measured before the fix: /_vercel/insights/script.js returned 51,496
  // bytes of index.html with a 200.
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const catchAll = cfg.rewrites.find(r => r.destination === '/index.html' && r.source.includes('(?!'));
  assert.ok(catchAll, 'the SPA catch-all rewrite has gone, or no longer excludes anything');

  const re = new RegExp(`^${catchAll.source}$`);
  for (const platformPath of ['/_vercel/insights/script.js', '/_vercel/insights/view', '/_vercel/speed-insights/script.js']) {
    assert.ok(!re.test(platformPath),
      `${platformPath} is rewritten to index.html, so the browser loads a 51KB HTML document as JavaScript`);
  }
  // And it still does its actual job.
  for (const appPath of ['/player/nabers', '/teams/sea', '/lab/charts/wr/2025/firstRead']) {
    assert.ok(re.test(appPath), `${appPath} no longer reaches the app — the exclusion is too wide`);
  }
});

test('every section shell counts too', () => {
  // The shells are whole copies of the page. One built before the tags were
  // added would serve a section that silently records nothing — and the
  // byte-identical check below the head is what keeps them in step, so this is
  // really a check that they were rebuilt.
  for (const f of html.filter(f => f !== 'index.html')) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(src, /\/assets\/analytics\.js/, `${f} was built before counting existed — re-run build-page-shells.js`);
  }
});
