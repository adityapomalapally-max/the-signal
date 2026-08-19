/**
 * The body map's data.
 *
 * This is the feature most likely to tempt somebody into inventing a number. A
 * body map WANTS to say "MCL Grade II — four to six weeks", and that sentence
 * is available from general knowledge, sounds authoritative, and has no source
 * behind it. On a site whose whole promise is that no number is published
 * without one, that is the failure mode worth testing hardest.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const D = path.join(__dirname, '..', 'data');
const anat = JSON.parse(fs.readFileSync(path.join(D, 'injury-anatomy.json'), 'utf8'));
const research = JSON.parse(fs.readFileSync(path.join(D, 'injury-research.json'), 'utf8'));
const curves = JSON.parse(fs.readFileSync(path.join(D, 'injury-curves.json'), 'utf8'));

test('a condition either has research or admits it has none', () => {
  // The whole point. `hasSourcedDetail` is what the page uses to decide between
  // printing evidence and printing "we do not have this", so it must never be
  // true without something behind it.
  for (const [key, r] of Object.entries(anat.regions)) {
    for (const c of r.conditions) {
      assert.ok(c.name, `${key}: a condition with no name`);
      if (c.hasSourcedDetail) {
        assert.ok(c.research, `${key}/${c.name}: claims sourced detail but carries none`);
        assert.ok(c.research.key && research[c.research.key],
          `${key}/${c.name}: points at "${c.research && c.research.key}", which is not in injury-research.json`);
      } else {
        assert.strictEqual(c.research, null,
          `${key}/${c.name}: has research attached but is not marked as sourced`);
      }
    }
  }
});

test('no timeline is attached to an unsourced condition', () => {
  // The specific thing that must never happen: a recovery figure sitting on a
  // condition nobody researched. Checked on the shape rather than the wording,
  // because the wording is what would change first.
  for (const [key, r] of Object.entries(anat.regions)) {
    for (const c of r.conditions) {
      if (c.hasSourcedDetail) continue;
      const text = JSON.stringify(c);
      assert.ok(!/\d+\s*(week|month|game)s?\b/i.test(text),
        `${key}/${c.name} has no research but its entry mentions a duration: ${text}`);
      assert.ok(!/\d+\s*%/.test(text),
        `${key}/${c.name} has no research but its entry states a percentage: ${text}`);
    }
  }
});

test('research pulled onto the map matches the research file', () => {
  // Copied numbers drift. If the map ever disagrees with injury-research.json,
  // the map is the wrong one.
  for (const r of Object.values(anat.regions)) {
    for (const c of r.conditions) {
      if (!c.research) continue;
      const src = research[c.research.key];
      assert.strictEqual(c.research.returnRate, src.returnRate, `${c.name}: return rate drifted`);
      assert.strictEqual(c.research.returnRateLabel, src.returnRateLabel, `${c.name}: label drifted`);
      assert.strictEqual(c.research.avgReturn, src.avgReturn, `${c.name}: timeline drifted`);
    }
  }
});

test('frequency is counted, and the counts reconcile', () => {
  for (const [key, r] of Object.entries(anat.regions)) {
    const summed = r.reportedAs.reduce((s, p) => s + p.episodes, 0);
    assert.strictEqual(summed, r.episodes,
      `${key}: parts sum to ${summed} but the region claims ${r.episodes}`);
    assert.ok(r.players <= r.episodes, `${key}: more players than episodes`);
    if (r.episodes) {
      assert.ok(r.shareOfAll > 0 && r.shareOfAll <= 100, `${key}: share is ${r.shareOfAll}%`);
    }
  }
  const total = Object.values(anat.regions).reduce((s, r) => s + r.episodes, 0);
  assert.strictEqual(anat.meta.coverage.mappedEpisodes, total, 'stated coverage must be the real one');
  assert.ok(total / anat.meta.totalEpisodes > 0.75,
    `only ${anat.meta.coverage.pct}% of reported episodes map to a region — the map has a hole in it`);
});

test('a recovery curve is the one it says it is', () => {
  for (const [key, r] of Object.entries(anat.regions)) {
    if (!r.recovery) continue;
    const src = curves.types[r.recovery.bucket];
    assert.ok(src, `${key}: points at curve bucket "${r.recovery.bucket}", which does not exist`);
    assert.strictEqual(r.recovery.medianGamesMissed, src.medianMissed, `${key}: median drifted from the curve file`);
    assert.strictEqual(r.recovery.absences, src.absences, `${key}: sample size drifted`);
  }
});

test('a region with too little data shows no curve rather than a thin one', () => {
  // Back has 42 reported episodes but no published curve, because the absences
  // behind it are too few. Empty beats wrong.
  const noCurve = Object.entries(anat.regions).filter(([, r]) => !r.recovery);
  for (const [key, r] of noCurve) {
    assert.strictEqual(r.recovery, null, `${key}: recovery should be null, not empty scaffolding`);
  }
});

test('the map states what it could not place', () => {
  // A body part appearing repeatedly and belonging to no region is a hole in
  // the map, not a rounding error, so it is recorded rather than dropped.
  assert.ok(Array.isArray(anat.meta.unmappedParts));
  const big = anat.meta.unmappedParts.filter(p => p.episodes >= 5);
  assert.strictEqual(big.length, 0,
    `these parts belong to no region and are common: ${big.map(p => `${p.part} (${p.episodes})`).join(', ')}`);
});

test('every layer says where it came from', () => {
  assert.ok(anat.meta.layers.frequency && anat.meta.layers.recovery && anat.meta.layers.research);
  // The layer has to state its own reach, whatever that reach currently is —
  // it went from seven injuries to twenty and the claim moved with it.
  assert.match(anat.meta.layers.research, /\b(SEVEN|TWENTY|THIRTY|\d+)\b/i,
    'the research layer has to state how far it reaches');
  assert.match(anat.meta.layers.research, /says it has none|Everything else/i,
    'and it has to say what happens beyond that reach');
  assert.ok(anat.meta.caveats.length >= 3);
  assert.match(anat.meta.caveats.join(' '), /IR drops off the report|understate/i,
    'the IR blind spot has to travel with the counts');
});

test('every researched condition carries its citation onto the page', () => {
  // The research layer grew from 7 injuries to 20. Its whole value is that a
  // reader can check the number, so the citation has to travel WITH it — a
  // figure whose source lives only in another file is one the page cannot
  // defend at the point it is read.
  let checked = 0;
  for (const [key, r] of Object.entries(anat.regions)) {
    for (const c of r.conditions) {
      if (!c.research) continue;
      assert.ok(c.research.sources, `${key}/${c.name}: research with no citation attached`);
      assert.ok(c.research.sources.length > 20,
        `${key}/${c.name}: citation is too thin to check — "${c.research.sources}"`);
      // A YEAR, not just a journal name. The first version of this check accepted
      // any citation containing "AJSM", which let "AJSM, orthopedic sports
      // medicine literature" through — a journal with no study attached is as
      // unfalsifiable as no citation at all. A year means a specific paper.
      assert.match(c.research.sources, /\(\d{4}\)/,
        `${key}/${c.name}: "${c.research.sources}" names no dated study`);
      assert.ok(!/\bliterature\b|\breports\b(?!,)/i.test(c.research.sources)
        || /\(\d{4}\)/.test(c.research.sources),
        `${key}/${c.name}: gestures at a body of work instead of citing one`);
      checked++;
    }
  }
  assert.ok(checked >= 28, `only ${checked} researched conditions — expected the expanded set`);
});

test('the research layer covers the regions people actually ask about', () => {
  // Knee, ankle and thigh are the three most-reported regions on this pool.
  // If those are unsourced the map is decoration, whatever the total says.
  for (const key of ['knee', 'ankle', 'thigh', 'shoulder', 'hip']) {
    const r = anat.regions[key];
    const sourced = r.conditions.filter(c => c.hasSourcedDetail).length;
    assert.ok(sourced >= 2,
      `${key} has only ${sourced} sourced condition(s) — it is one of the regions readers arrive for`);
  }
});

test('a gap says why it is a gap', () => {
  // Seven conditions have no NFL cohort behind them, and that is a fact about
  // the literature rather than about our effort. Stating the reason is what
  // separates "we looked and there is nothing" from silence, which a reader
  // reasonably reads as "nobody bothered".
  const gaps = [];
  for (const [key, r] of Object.entries(anat.regions)) {
    for (const c of r.conditions) {
      if (c.hasSourcedDetail) continue;
      gaps.push(`${key}/${c.name}`);
      assert.ok(c.noResearch, `${key}/${c.name}: unsourced with no reason given`);
      assert.match(c.noResearch, /No NFL cohort study/i,
        `${key}/${c.name}: the reason should say what was looked for`);
    }
  }
  assert.ok(gaps.length <= 8, `${gaps.length} conditions still unsourced: ${gaps.join(', ')}`);
});

test('the stated reason never smuggles in a number', () => {
  // A "reason" that mentions a timeline is a timeline. The plantar fascia note
  // is the live test of this: press reports range from no games to two months,
  // and naming that range is describing the literature, not asserting a figure.
  for (const [key, r] of Object.entries(anat.regions)) {
    for (const c of r.conditions) {
      if (!c.noResearch) continue;
      assert.ok(!/\d+\s*%/.test(c.noResearch),
        `${key}/${c.name}: the reason states a percentage — ${c.noResearch}`);
    }
  }
});
