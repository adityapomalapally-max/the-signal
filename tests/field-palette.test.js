/**
 * The field map's colour ramp.
 *
 * This repo's rule is "NEVER eyeball a chart color" — a hand-picked red for
 * negative bars once failed the normal-vision floor and looked completely fine
 * on the page. The heatmap is the place that rule matters most, because it is
 * ALL colour: a reader takes the shade as the finding.
 *
 * So the validated steps are pinned here. Changing one without re-running the
 * dataviz validator turns this red. The values came from:
 *   - each arm a single hue at three intensities, lightness monotone, adjacent
 *     dL >= 0.06, single-hue spread 1 degree
 *   - every step >= 2:1 against the card surface #161a23, or it is not a mark
 *   - the cell ink #f0efec >= 4.5:1 on EVERY step, which is the ceiling that
 *     decides how bright the ramp may go
 *
 * The contrast maths is reimplemented here rather than imported, because the
 * skill that produced the ramp is not a dependency of this repo and the numbers
 * have to stay checkable without it.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-pages.js'), 'utf8');

const SURFACE = '#161a23';
const INK = '#f0efec';
const COOL = ['#1a4c87', '#205ca5', '#266dc3'];
const WARM = ['#882c2b', '#a53534', '#c23e3e'];
const NEUTRAL = '#20242e';

const srgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const relLum = h => { const [r, g, b] = srgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('the ramp in the source is the ramp that was validated', () => {
  // Read the arrays out of app-pages.js rather than trusting a comment.
  const grab = (name) => {
    const m = SRC.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
    assert.ok(m, `${name} is not defined in app-pages.js`);
    return m[1].match(/#[0-9a-f]{6}/gi).map(s => s.toLowerCase());
  };
  assert.deepStrictEqual(grab('FIELD_COOL'), COOL, 'the cool arm moved without re-validating');
  assert.deepStrictEqual(grab('FIELD_WARM'), WARM, 'the warm arm moved without re-validating');
  const n = SRC.match(/const FIELD_NEUTRAL = '(#[0-9a-f]{6})'/i);
  assert.ok(n && n[1].toLowerCase() === NEUTRAL, 'the neutral midpoint moved');
});

test('the cell ink clears 4.5:1 on every step', () => {
  // The number sits INSIDE the coloured cell, so this is normal-size body text
  // and 4.5 is the bar. It is also what caps the ramp's brightness — gold was
  // tried as the warm pole and could not fit three steps under this ceiling.
  for (const c of [...COOL, ...WARM, NEUTRAL]) {
    const r = contrast(INK, c);
    assert.ok(r >= 4.5, `ink ${INK} on ${c} is only ${r.toFixed(2)}:1 — the figure in the cell is unreadable`);
  }
});

test('every coloured step reads as a mark against the card', () => {
  for (const c of [...COOL, ...WARM]) {
    const r = contrast(c, SURFACE);
    assert.ok(r >= 2.0, `${c} is only ${r.toFixed(2)}:1 against ${SURFACE} — it disappears into the card`);
  }
});

test('the neutral midpoint recedes instead of reading as a value', () => {
  // The opposite requirement to the arms: the middle of a diverging scale is
  // "nothing to report" and must not look like a finding. The relief channel is
  // the figure printed in every cell, which is why this may sit under 2:1.
  const r = contrast(NEUTRAL, SURFACE);
  assert.ok(r < 1.6, `the neutral is ${r.toFixed(2)}:1 against the card — too loud for a zero point`);
});

test('each arm is monotone in lightness, so it reads as a ramp', () => {
  for (const [name, arm] of [['cool', COOL], ['warm', WARM]]) {
    const Ls = arm.map(relLum);
    for (let i = 1; i < Ls.length; i++) {
      assert.ok(Ls[i] > Ls[i - 1], `${name} step ${i} is not lighter than the one before — the ramp does not read as ordered`);
    }
  }
});

test('the two arms are opposite poles, not two shades of one idea', () => {
  // A diverging pair has to read as opposite. Cool arm must be bluer than red
  // at every step and the warm arm redder than blue, or the scale means nothing.
  for (let i = 0; i < 3; i++) {
    const [cr, cg, cb] = srgb(COOL[i]);
    const [wr, wg, wb] = srgb(WARM[i]);
    assert.ok(cb > cr, `cool step ${i} (${COOL[i]}) is not blue-dominant`);
    assert.ok(wr > wb, `warm step ${i} (${WARM[i]}) is not red-dominant`);
  }
});

test('a thin cell is drawn neutral, never as a value', () => {
  // The one rendering rule that would silently lie: a cell with no published
  // rate must not be coloured as though it had one. Checked by RUNNING the
  // function rather than by reading it — the first version of this test matched
  // the source text and passed a mutant that had dropped the isFinite guard
  // entirely, because the words it was looking for were still there.
  const vm = require('node:vm');
  const pick = (re, what) => { const m = SRC.match(re); assert.ok(m, `${what} not found`); return m[0]; };
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    pick(/const FIELD_COOL = \[[^\]]*\];/, 'FIELD_COOL')
    + pick(/const FIELD_WARM = \[[^\]]*\];/, 'FIELD_WARM')
    + pick(/const FIELD_NEUTRAL = '[^']*';/, 'FIELD_NEUTRAL')
    + pick(/function fieldColour\(v, scale\) \{[\s\S]*?\n\}/, 'fieldColour')
    + 'globalThis.out = fieldColour;', ctx);
  const f = ctx.out;
  const scale = { mid: 50, spread: 10 };

  for (const missing of [null, undefined, NaN, Infinity, -Infinity, '']) {
    assert.strictEqual(f(missing, scale), NEUTRAL,
      `a cell holding ${String(missing)} must be drawn neutral, not scaled`);
  }
  // A real value still colours, or the guard has swallowed everything.
  assert.strictEqual(f(50, scale), NEUTRAL, 'a value at the midpoint is the zero point');
  assert.ok(WARM.includes(f(90, scale)), 'well above the midpoint must be warm');
  assert.ok(COOL.includes(f(10, scale)), 'well below the midpoint must be cool');
  // And with no scale at all (a column too sparse to scale), nothing is claimed.
  assert.strictEqual(f(90, null), NEUTRAL, 'a column that could not be scaled must not be coloured');
});
