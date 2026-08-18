/**
 * Projection bands. The median is the analyst's and is never generated; the
 * band around it is, and these guard the properties that make it honest.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const proj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'projections-2026.json'), 'utf8'));
const all = Object.values(proj.projections).flat();
const banded = all.filter(p => typeof p.floor === 'number');

test('the file still has every position', () => {
  for (const pos of ['qb', 'rb', 'wr', 'te']) {
    assert.ok(Array.isArray(proj.projections[pos]) && proj.projections[pos].length, `${pos} is missing or empty`);
  }
});

test('floor < median < ceiling, always', () => {
  for (const p of banded) {
    assert.ok(p.floor < p.median, `${p.name}: floor ${p.floor} is not below median ${p.median}`);
    assert.ok(p.ceiling > p.median, `${p.name}: ceiling ${p.ceiling} is not above median ${p.median}`);
    assert.ok(p.floor > 0, `${p.name}: floor ${p.floor} is not a positive score`);
  }
});

test('no band claims an outcome nobody has ever had', () => {
  // A ceiling far above the best season ever recorded at the position is the
  // symptom of pooling a promoted backup's upside onto a projected starter.
  // It produced a 512-point running back before the model was made local.
  for (const p of banded) {
    const ratio = p.ceiling / p.median;
    assert.ok(ratio <= 1.75, `${p.name}: ceiling is ${ratio.toFixed(2)}x his median (${p.median} -> ${p.ceiling})`);
    assert.ok(p.ceiling < 520, `${p.name}: ceiling ${p.ceiling} exceeds any season on record`);
  }
});

test('the downside is a real downside', () => {
  for (const p of banded) {
    const ratio = p.floor / p.median;
    assert.ok(ratio >= 0.35 && ratio <= 0.95, `${p.name}: floor is ${ratio.toFixed(2)}x his median`);
  }
});

test('baseline-only entries are left without a band, not given an invented one', () => {
  // The file withholds a range for these deliberately. Generating one would
  // assert confidence that was explicitly not claimed.
  for (const p of all.filter(x => x.baselineOnly)) {
    assert.strictEqual(p.floor, undefined, `${p.name} is baselineOnly but has a floor`);
    assert.strictEqual(p.ceiling, undefined, `${p.name} is baselineOnly but has a ceiling`);
    assert.strictEqual(typeof p.median, 'number', `${p.name} is baselineOnly with no median`);
  }
});

test('the band records its own method, sample and caveats', () => {
  const b = proj.meta && proj.meta.bands;
  assert.ok(b, 'meta.bands is missing — the bands would be unattributable');
  for (const key of ['method', 'perGame', 'level', 'medianIsHandSet', 'sample', 'caveats']) {
    assert.ok(b[key], `meta.bands.${key} is missing`);
  }
  // Survivorship is the one caveat a reader most needs; it must stay stated.
  assert.match(b.caveats, /survivorship/i);
});

test('the sampled curve tightens as the projected level rises', () => {
  // This is the finding the local model exists to encode. If a position ever
  // stops showing it, the neighbourhood is no longer doing anything.
  const rb = proj.meta.bands.sample.RB.curve;
  assert.ok(rb['6ppg'].ceiling > rb['15ppg'].ceiling,
    `RB upside should shrink with level: 6ppg ${rb['6ppg'].ceiling} vs 15ppg ${rb['15ppg'].ceiling}`);
});

test('every position was modelled on enough seasons to read a percentile', () => {
  for (const [pos, s] of Object.entries(proj.meta.bands.sample)) {
    assert.ok(s.pairs >= 40, `${pos}: only ${s.pairs} season pairs behind the band`);
  }
});
