/**
 * Running the page scripts under node.
 *
 * app-pages.js holds the render logic for six sections and had no tests, for
 * the honest reason that it is browser code — but most of what it does is
 * decide WHICH numbers reach the page, and that part is ordinary logic that
 * happens to sit next to some DOM calls.
 *
 * This loads app-core.js and app-pages.js into one vm context, in the order
 * index.html loads them, with a DOM thin enough that anything genuinely needing
 * a browser throws here rather than in a reader's tab.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');

function stubElement() {
  return {
    style: {}, dataset: {}, className: '', textContent: '', innerHTML: '',
    children: [], classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, removeChild() {}, addEventListener() {}, removeAttribute() {},
    setAttribute() {}, getAttribute: () => null, closest: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
    focus() {},
  };
}

function loadPages(globals = {}) {
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    requestIdleCallback: () => {}, requestAnimationFrame: () => {},
    fetch: () => Promise.resolve({ ok: false, headers: { get: () => null }, json: () => Promise.resolve(null) }),
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: stubElement,
      addEventListener() {},
      body: stubElement(),
      documentElement: stubElement(),
    },
    window: {
      addEventListener() {}, removeEventListener() {},
      location: { pathname: '/', search: '' },
      innerWidth: 1200, innerHeight: 800,
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      history: { pushState() {}, replaceState() {} },
      getComputedStyle: () => ({ display: '', paddingLeft: '0px' }),
    },
    MutationObserver: class { observe() {} disconnect() {} },
    KeyboardEvent: class {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);

  for (const f of ['app-core.js', 'app-pages.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8'), ctx, { filename: f });
  }
  // Seeded AFTER evaluation, so a `let x = null` in the source does not undo it.
  // These land as context properties, which is enough for `var`-like reads.
  for (const [k, v] of Object.entries(globals)) ctx[k] = v;
  return ctx;
}

/**
 * Read or run an expression INSIDE the context.
 *
 * Necessary, not convenience: a top-level `let` in a vm script goes into that
 * context's global LEXICAL environment, which is not reachable as a property of
 * the context object. `ctx.labMode` is undefined while `evalIn(ctx, 'labMode')`
 * returns it. This is the same distinction that hides a dead script in the
 * browser — its functions appear on window, its lets do not exist.
 */
function evalIn(ctx, expr) {
  return vm.runInContext(expr, ctx);
}

/** Assign to a top-level binding the same way. */
function setIn(ctx, name, value) {
  ctx.__inject = value;
  vm.runInContext(`${name} = __inject;`, ctx);
  delete ctx.__inject;
}

module.exports = { loadPages, evalIn, setIn, stubElement, ROOT };
