/**
 * One global scope, five files.
 *
 * These are classic scripts sharing a single global scope on purpose — the
 * markup carries ~108 inline onclick handlers and an inline handler can only
 * see globals. The cost of that choice is that a duplicated top-level `let` or
 * `const` is a SyntaxError, and the way it fails is worse than a crash:
 *
 *   FUNCTION DECLARATIONS STILL HOIST. The offending file's functions all
 *   appear on window, so the site looks loaded. Its `let` bindings never
 *   initialise, so the first thing that reads one throws ReferenceError from
 *   somewhere unrelated — and the router, which reads currentProfileId on every
 *   navigation, falls back to the home page for every deep link on the site.
 *
 * That is what `let usagePromise` in app-pages.js did: app-profile.js already
 * owned the name, app-profile.js died, and /season/usage rendered the home page
 * with no error visible in the console.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// The load order the browser actually uses, read from the markup rather than
// assumed — a reordering has to move this test with it.
const FILES = [...HTML.matchAll(/<script src="\/assets\/(app-[\w-]+\.js)"/g)].map(m => m[1]);

// Top-level declarations only: column zero, so nothing inside a function body.
// Comma-separated declarators all count — `let a = 1, b = 2;` declares BOTH,
// and the version of this check that only caught `a` is what let the collision
// through in the first place.
function topLevelNames(src) {
  const out = [];
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    const m = line.match(/^(let|const|var|function|class)\s+(.*)$/);
    if (!m) return;
    const kind = m[1];
    if (kind === 'function' || kind === 'class') {
      const n = m[2].match(/^([A-Za-z_$][\w$]*)/);
      if (n) out.push({ name: n[1], line: i + 1, kind });
      return;
    }
    // Strip a trailing initialiser from each declarator, then take the names.
    // Only splits on commas at depth zero so `let a = f(1, 2), b` still works.
    let depth = 0, buf = '', parts = [];
    for (const ch of m[2]) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; continue; }
      buf += ch;
    }
    parts.push(buf);
    for (const part of parts) {
      const n = part.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (n) out.push({ name: n[1], line: i + 1, kind });
    }
  });
  return out;
}

test('the scripts are read in the order the markup loads them', () => {
  assert.ok(FILES.length >= 5, `found ${FILES.length} app scripts in index.html`);
  assert.strictEqual(FILES[0], 'app-core.js', 'app-core must load first — everything else uses its bindings');
});

test('no top-level name is declared in two files', () => {
  const seen = new Map();
  const clashes = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8');
    for (const d of topLevelNames(src)) {
      const key = d.name;
      if (seen.has(key)) {
        // A duplicated function declaration is legal and merely shadows; a
        // duplicated let/const is fatal. Both are worth knowing about, and the
        // fatal one fails.
        clashes.push({ ...d, file: f, first: seen.get(key), fatal: d.kind !== 'function' || seen.get(key).kind !== 'function' });
      } else {
        seen.set(key, { ...d, file: f });
      }
    }
  }
  const fatal = clashes.filter(c => c.fatal);
  assert.deepStrictEqual(fatal.map(c => `${c.name} (${c.first.file}:${c.first.line} vs ${c.file}:${c.line})`), [],
    'a redeclared top-level binding is a SyntaxError that kills the whole file — its functions still hoist, so the site looks loaded while every deep link falls back to the home page');
});

test('the multi-declarator case is actually parsed', () => {
  // The check that missed the real collision only read the first name in
  // `let a = null, b = null;`. This asserts the parser sees both, so the guard
  // cannot silently narrow again.
  const names = topLevelNames('let alpha = null, beta = null, gamma;\nfunction delta() {}\n')
    .map(d => d.name);
  assert.deepStrictEqual(names, ['alpha', 'beta', 'gamma', 'delta']);
  // And that a comma inside a call does not split a declarator.
  const tricky = topLevelNames('const one = fn(1, 2), two = 3;\n').map(d => d.name);
  assert.deepStrictEqual(tricky, ['one', 'two']);
  // Indented declarations are inside something and must not be counted.
  assert.deepStrictEqual(topLevelNames('  let inner = 1;\n').map(d => d.name), []);
});

test('every file still parses on its own', () => {
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8');
    assert.doesNotThrow(() => new Function(src), `${f} does not parse`);
  }
});
