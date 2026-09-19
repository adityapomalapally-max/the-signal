/**
 * The policy, and the thing that used to make it pointless.
 *
 * The August audit found a live XSS in the feed rendering and proved it
 * exploitable WITH CSP ENFORCED — because the policy said
 * `script-src 'self' 'unsafe-inline'`, and a policy that allows inline script
 * cannot stop an injected payload from running. The directive was not there by
 * choice: index.html carried 108 inline event handlers and assets/*.js
 * generated about sixty more, and every one of them needs it.
 *
 * There were never any inline <script> BLOCKS. The handlers alone were buying
 * it. They are gone now — markup declares data-click and app-actions.js
 * decides what that means — and the policy no longer allows inline anything.
 *
 * ONE `onclick=` ANYWHERE PUTS THE DIRECTIVE BACK. That is what these tests are
 * for: the failure is not that the handler stops working, it is that somebody
 * "fixes" the broken button by restoring 'unsafe-inline' and the site quietly
 * returns to a policy that protects nothing.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
const js = fs.readdirSync(path.join(ROOT, 'assets')).filter(f => f.endsWith('.js'));

// `on` followed by letters and an equals sign, inside markup. Matches both the
// hand-written attributes and the ones generated into template strings.
const INLINE = /\bon(click|change|input|submit|error|keydown|keyup|keypress|focus|blur|load|mouseover|mouseout|mouseenter|mouseleave|submit)\s*=\s*["']/g;

test('no page carries an inline event handler', () => {
  for (const f of html) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const hits = src.match(INLINE) || [];
    assert.strictEqual(hits.length, 0,
      `${f} has ${hits.length} inline handler(s) — every one of them requires 'unsafe-inline' in the CSP, `
      + `which is what made the August XSS exploitable. Use data-click and an action in assets/app-actions.js.`);
  }
});

test('no script generates an inline event handler either', () => {
  for (const f of js) {
    const src = fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const hits = src.match(INLINE) || [];
    assert.strictEqual(hits.length, 0,
      `assets/${f} writes ${hits.length} inline handler(s) into markup. Emit data-click attributes instead.`);
  }
});

test("the policy does not allow inline script", () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const csp = cfg.headers
    .flatMap(h => h.headers)
    .filter(h => h.key.toLowerCase() === 'content-security-policy')
    .map(h => h.value)
    .find(v => v.includes('script-src'));
  assert.ok(csp, 'no CSP with a script-src is being served');

  const scriptSrc = csp.split(';').map(s => s.trim()).find(s => s.startsWith('script-src'));
  assert.ok(!scriptSrc.includes("'unsafe-inline'"),
    `script-src allows inline script again: "${scriptSrc}". If a handler needed it, the handler is the bug.`);
  assert.ok(!scriptSrc.includes("'unsafe-eval'"), 'nothing here needs eval');
});

test('the deployment serves the site, not the repository', () => {
  // /CLAUDE.md, /scripts/build-scheme.js, /tests/csp.test.js and
  // /.github/workflows/daily-update.yml all answered 200 in production. The
  // repo is public, so nothing was disclosed — the problem is the day it is
  // not, when the deployment would go on serving what the repository had
  // stopped sharing and nothing would say so.
  //
  // .vercelignore DOES NOT DO THIS on a Git deployment. That was measured
  // rather than read: pushed, waited for the deploy to carry an unrelated
  // change from the same commit, asked again, still 200. Redirects are
  // evaluated ahead of the filesystem, which is why they win where a rewrite
  // loses — the filesystem is checked first and these files exist.
  //
  // THE RULES ARE RUN, NOT MATCHED AS TEXT, so any rewording that still covers
  // the paths keeps passing.
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const rules = (cfg.redirects || []).map(r => new RegExp(`^${r.source}$`));
  const covered = (p) => rules.some(re => re.test(p));

  for (const p of ['/CLAUDE.md', '/scripts/build-scheme.js', '/scripts/lib/season.js',
                   '/tests/csp.test.js', '/.github/workflows/daily-update.yml']) {
    assert.ok(covered(p), `${p} is served as part of the website`);
  }
  // And the site itself still reaches the site.
  for (const p of ['/', '/players', '/data/rankings.json', '/assets/app-core.js',
                   '/player/nabers', '/season/startsit']) {
    assert.ok(!covered(p), `${p} is redirected away — the exclusion is too wide`);
  }
});

test('every action the markup asks for exists', () => {
  // A data-click naming an action nobody wrote is a button that does nothing,
  // and unlike a broken onclick it throws no error in the console.
  const actions = fs.readFileSync(path.join(ROOT, 'assets', 'app-actions.js'), 'utf8');
  const declared = new Set([...actions.matchAll(/^\s*'([a-z0-9-]+)':/gm)].map(m => m[1]));

  const used = new Set();
  for (const f of html) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/data-(?:click|input|change|submit|hover)="([a-z0-9-]+)"/g)) used.add(m[1]);
  }
  for (const f of js) {
    const src = fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8');
    for (const m of src.matchAll(/data-(?:click|input|change|submit|hover)="([a-z0-9-]+)"/g)) used.add(m[1]);
  }

  const missing = [...used].filter(a => !declared.has(a));
  assert.deepStrictEqual(missing, [],
    `markup asks for action(s) that app-actions.js does not define: ${missing.join(', ')}`);
  assert.ok(used.size > 20, `only ${used.size} actions found in markup — the scan is not finding them`);
});
