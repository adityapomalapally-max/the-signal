/**
 * The re-render loop.
 *
 * This shape has cost two freezes. renderProfileTab called
 * ensureUsage().then(render) and locked the tab; renderLabPage called
 * ensureChartData().then(render) guarded on "the lab page is still open" —
 * true for as long as the reader is on it — and froze the renderer whole.
 *
 * The mechanism is always the same and invisible in review: ensureX() CACHES
 * its promise, so once the data is in hand it resolves on the next microtask,
 * and a callback that re-enters the function which scheduled it goes round
 * forever. loadJSON swallowing a failed fetch reaches the same loop a second
 * way, with the data never arriving at all.
 *
 * What makes it terminate is a condition that is TRUE on the first pass and
 * FALSE on the second. Two things qualify:
 *   - the callback tests the binding the fetch fills in (`if (labCharting)`)
 *   - a latch set inside ensureX gates the call site (`if (!rosChecked)`)
 * A DOM check is neither. The DOM is what the render is producing, so it
 * cannot distinguish the first pass from the thousandth.
 *
 * The latch is not a lesser form: out of season data/ros.json is legitimately
 * ABSENT, so rosData stays null forever and testing it would be the loop. When
 * "no data" is a permanent valid answer, the latch is the only correct guard.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const A = path.join(__dirname, '..', 'assets');
const FILES = fs.readdirSync(A).filter(f => /^app-.*\.js$/.test(f));
// The ensure* functions live in app-core.js and are called from app-profile.js
// and app-pages.js — these are classic scripts sharing one global scope, so the
// scanner has to read them as one program. Scoped per file it found nothing to
// check in the very file where the loop was first hit.
const ALL = FILES.map(f => fs.readFileSync(path.join(A, f), 'utf8')).join('\n');

// Walk from an opening bracket to its match, so nested ones do not end it early.
function matchFrom(src, open, oc, cc) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === oc) depth++;
    else if (src[i] === cc && --depth === 0) return i;
  }
  return src.length;
}

// The name of the function a given offset sits inside.
function enclosing(src, offset) {
  let found = null;
  for (const m of src.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
    const end = matchFrom(src, src.indexOf('{', m.index), '{', '}');
    if (m.index < offset && offset < end) found = m[1];
  }
  return found;
}

// What ensureX assigns, split by whether it can be trusted as a CALL-SITE latch.
//
// The distinction is the whole test. `statsReady = true` runs whatever the
// fetch returned, so `if (!statsReady)` is false on the second pass and the
// loop stops. `labCharting = d` is null when loadJSON swallows a failure, so
// `if (!labCharting)` is TRUE again on the second pass and re-enters forever —
// it reads exactly like a latch and is not one.
//
// The same binding is fine INSIDE the callback: `if (labCharting) render()`
// simply declines to re-render when the data never came.
function assignedIn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) return null;
  const open = src.indexOf('{', start);
  const body = src.slice(open, matchFrom(src, open, '{', '}'));
  const latches = new Set(), bindings = new Set();
  for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*true\b/g)) latches.add(m[1]);
  // `historyAdp = d || []` lands truthy whatever the fetch did, so a call-site
  // `if (!historyAdp)` DOES go false on the second pass. The empty fallback is
  // what makes it a latch — without it the same line is the loop.
  for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*d\s*\|\|\s*[[{]/g)) latches.add(m[1]);
  for (const re of [/\(([A-Za-z_$][\w$]*)\s*=\s*d\)/g, /\b([A-Za-z_$][\w$]*)\s*=\s*(?:d|data|json|await)\b/g]) {
    for (const m of body.matchAll(re)) bindings.add(m[1]);
  }
  for (const l of latches) bindings.delete(l);
  return { latches: [...latches], bindings: [...bindings], all: [...latches, ...bindings] };
}

// Comments are not guards. The check very nearly shipped satisfied by a COMMENT
// that happened to name the binding it was describing — deleting the actual
// `if (!usageData) return;` left the test green because the paragraph above it
// still said "usageData". Anything reading code for meaning has to read the
// code, not the prose around it.
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function thenSites(src) {
  const out = [];
  for (const m of src.matchAll(/\b(ensure[A-Za-z]*)\(\)\.then\(/g)) {
    const open = m.index + m[0].length - 1;
    out.push({
      ensure: m[1],
      at: m.index,
      body: stripComments(src.slice(open + 1, matchFrom(src, open, '(', ')'))),
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  return out;
}

test('a callback that re-enters its own scheduler can go false on the second pass', () => {
  let checked = 0;
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(A, f), 'utf8');
    for (const site of thenSites(src)) {
      const fn = enclosing(src, site.at);
      // Only a callback that calls the function it was scheduled from can loop.
      if (!fn || !new RegExp(`\\b${fn}\\s*\\(`).test(site.body)) continue;
      checked++;
      const names = assignedIn(ALL, site.ensure);
      assert.ok(names && names.all.length,
        `${f}:${site.line}: ${site.ensure} assigns nothing this test can see — teach it the shape, do not drop the check`);
      // Inside the callback, either kind terminates: a null binding declines to
      // re-render just as well as a latch does.
      const inCallback = names.all.some(n => new RegExp(`\\b${n}\\b`).test(site.body));
      // At the call site, ONLY an unconditional latch terminates.
      const before = stripComments(src.slice(Math.max(0, site.at - 400), site.at));
      const atCallSite = names.latches.some(n => new RegExp(`if\\s*\\(\\s*!\\s*${n}\\b`).test(before));
      assert.ok(inCallback || atCallSite,
        `${f}:${site.line}: ${site.ensure}().then(...) re-enters ${fn}() with no condition that can go false. `
        + `The promise is CACHED, so it resolves immediately every later call. Test what the fetch fills in `
        + `(${names.bindings.join(', ') || 'none'}) INSIDE the callback, or gate the call site on an `
        + `unconditional latch (${names.latches.join(', ') || 'none'}). A call-site test on a data binding is `
        + `NOT a latch — it is null again when the fetch fails, and that is the loop.`);
    }
  }
  assert.ok(checked >= 3, `only ${checked} self-re-entering callbacks seen — the scanner has stopped finding them`);
});

test('the page being open is never the thing that stops a loop', () => {
  // The guard that actually froze the Defence board.
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(A, f), 'utf8');
    for (const site of thenSites(src)) {
      const fn = enclosing(src, site.at);
      if (!fn || !new RegExp(`\\b${fn}\\s*\\(`).test(site.body)) continue;
      const names = (assignedIn(ALL, site.ensure) || { all: [] }).all;
      const stripped = site.body.replace(/getElementById\([^)]*\)/g, '');
      assert.ok(names.some(n => new RegExp(`\\b${n}\\b`).test(stripped))
        || !/classList\.contains\(['"]active['"]\)/.test(site.body),
        `${f}:${site.line}: ${fn}() re-enters itself guarded only on the page still being active, `
        + `which is true for as long as it is rendering`);
    }
  }
});
