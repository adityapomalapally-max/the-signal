/**
 * WHERE on the field a player works, and how well he does it there.
 *
 * Everything here comes out of nflverse pbp — `pass_location` crossed with
 * `air_yards` for throws, `run_location` crossed with `run_gap` for carries.
 * It is a pure function of the CSV so the band boundaries and the sample
 * floors can be tested without a network.
 *
 * THE GRID SIZE WAS MEASURED, NOT CHOSEN. On 2025:
 *   - a quarterback at 200+ attempts fills all twelve cells, median 8 to 84
 *   - a RECEIVER at 50+ targets does NOT: middle-deep has a median of 1 and
 *     116 of 132 qualified receivers sit under five targets there
 * So quarterbacks get a real 3x4 heatmap and receivers get two one-dimensional
 * strips instead — depth, and side. A 3x4 receiver map would be mostly cells
 * built on one or two throws, which is the exact shape of a number that looks
 * authoritative and means nothing.
 *
 * WHAT IS NOT HERE, AND WHY:
 *   - RUN BLOCKING SCHEME. Wide zone against inside zone is the split people
 *     actually want and it is NOT in nflverse, or in any free feed. `run_gap`
 *     is WHERE the ball went, which is a different question from HOW it was
 *     blocked — a wide-zone run can hit anywhere. Naming a gap chart "zone vs
 *     gap" would be inventing the one column nobody has.
 */

const { parseCSVLine } = require('./match.js');

// Air-yard bands. Behind the line is its own thing rather than the bottom of
// "short": a screen and a five-yard hook are different plays with different
// people throwing them.
const DEPTH_BANDS = [
  { key: 'behind', label: 'Behind LOS', test: ay => ay < 0 },
  { key: 'short', label: 'Short (0-9)', test: ay => ay >= 0 && ay < 10 },
  { key: 'inter', label: 'Intermediate (10-19)', test: ay => ay >= 10 && ay < 20 },
  { key: 'deep', label: 'Deep (20+)', test: ay => ay >= 20 },
];
const SIDES = ['left', 'middle', 'right'];

// The seven gaps as the play-by-play records them. A middle run carries no gap
// — there is no "middle guard" — so it is its own column rather than being
// dropped for having a blank field.
const GAPS = [
  { key: 'left-end', label: 'Left End', loc: 'left', gap: 'end' },
  { key: 'left-tackle', label: 'Left Tackle', loc: 'left', gap: 'tackle' },
  { key: 'left-guard', label: 'Left Guard', loc: 'left', gap: 'guard' },
  { key: 'middle', label: 'Middle', loc: 'middle', gap: null },
  { key: 'right-guard', label: 'Right Guard', loc: 'right', gap: 'guard' },
  { key: 'right-tackle', label: 'Right Tackle', loc: 'right', gap: 'tackle' },
  { key: 'right-end', label: 'Right End', loc: 'right', gap: 'end' },
];

// Season totals a player must clear to appear at all.
const MIN_ATTEMPTS = 200;
const MIN_TARGETS = 50;
const MIN_CARRIES = 100;

// And the floor for a RATE inside one cell. The distinction matters and is the
// reason this file has two numbers instead of one: a SHARE ("14% of his
// targets were deep") is computed against a well-sampled season total and is
// sound at any cell size, while a RATE inside the cell ("he completes 31% of
// them") is built on that cell alone. So the distribution always renders and
// the rate goes null under the floor, rather than the whole cell disappearing.
const MIN_CELL = 10;
const MIN_CELL_STRIP = 8;

function depthOf(ay) {
  for (const b of DEPTH_BANDS) if (b.test(ay)) return b.key;
  return null;
}

function blankCell() {
  return { n: 0, comp: 0, yards: 0, td: 0, epa: 0, cpoe: 0, cpoeN: 0, success: 0 };
}

function addPass(cell, r) {
  cell.n++;
  if (r.complete) cell.comp++;
  cell.yards += r.yards;
  if (r.td) cell.td++;
  if (r.epa !== null) cell.epa += r.epa;
  if (r.cpoe !== null) { cell.cpoe += r.cpoe; cell.cpoeN++; }
  if (r.success) cell.success++;
}

// A rate is published only above the floor; the count and the share are not
// gated, because they are read against the season total rather than the cell.
function finishPass(cell, total, floor) {
  const out = {
    n: cell.n,
    share: total ? round(cell.n / total * 100, 1) : null,
  };
  if (cell.n >= floor) {
    out.compPct = round(cell.comp / cell.n * 100, 1);
    out.ypa = round(cell.yards / cell.n, 2);
    out.epa = round(cell.epa / cell.n, 3);
    out.tdRate = round(cell.td / cell.n * 100, 1);
    out.success = round(cell.success / cell.n * 100, 1);
    if (cell.cpoeN >= floor) out.cpoe = round(cell.cpoe / cell.cpoeN, 1);
  } else {
    out.thin = true;   // stated, not silent — the reader is told why it is blank
  }
  return out;
}

function round(v, p) {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  const m = Math.pow(10, p);
  return Math.round(v * m) / m;
}

/**
 * Read one season of pbp into per-player field maps.
 * Returns { passers, receivers, rushers, meta } keyed by GSIS id.
 */
function buildFieldMap(pbpCsv) {
  const lines = pbpCsv.split('\n');
  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const I = {};
  header.forEach((h, i) => { I[h] = i; });

  // These are the columns the whole file rests on. If nflverse renames one the
  // run must fail rather than quietly produce an empty map — the same bargain
  // the stats fetch makes, and for the same reason it exists.
  for (const need of ['pass_attempt', 'play_type', 'pass_location', 'air_yards',
                      'run_location', 'run_gap', 'rusher_player_id', 'receiver_player_id',
                      'passer_player_id', 'yards_gained', 'epa', 'rush']) {
    if (I[need] === undefined) throw new Error(`pbp is missing ${need} — the schema moved`);
  }

  const passers = new Map(), receivers = new Map(), rushers = new Map();
  const get = (v, c) => (I[c] === undefined || v[I[c]] === undefined)
    ? '' : v[I[c]].replace(/"/g, '').trim();
  const num = (v, c) => { const s = get(v, c); if (s === '' || s === 'NA') return null; const n = parseFloat(s); return Number.isNaN(n) ? null : n; };

  let attempts = 0, located = 0, carries = 0, gapped = 0;

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const v = parseCSVLine(lines[i]);
    const isPass = get(v, 'pass_attempt') === '1' && get(v, 'play_type') === 'pass';
    const isRush = get(v, 'rush') === '1' && get(v, 'play_type') === 'run';

    if (isPass) {
      attempts++;
      const loc = get(v, 'pass_location');
      const ay = num(v, 'air_yards');
      if (!loc || ay === null) continue;      // throwaways and batted balls
      located++;
      const depth = depthOf(ay);
      if (!depth) continue;
      const r = {
        complete: get(v, 'complete_pass') === '1',
        yards: num(v, 'yards_gained') || 0,
        td: get(v, 'pass_touchdown') === '1',
        epa: num(v, 'epa'),
        cpoe: num(v, 'cpoe'),
        success: get(v, 'success') === '1',
      };
      const cell = `${loc}-${depth}`;
      const qb = get(v, 'passer_player_id');
      if (qb) {
        if (!passers.has(qb)) passers.set(qb, { cells: {}, depth: {}, side: {}, total: 0 });
        const p = passers.get(qb);
        p.total++;
        for (const [bag, key] of [[p.cells, cell], [p.depth, depth], [p.side, loc]]) {
          if (!bag[key]) bag[key] = blankCell();
          addPass(bag[key], r);
        }
      }
      const rec = get(v, 'receiver_player_id');
      if (rec) {
        if (!receivers.has(rec)) receivers.set(rec, { depth: {}, side: {}, total: 0 });
        const p = receivers.get(rec);
        p.total++;
        for (const [bag, key] of [[p.depth, depth], [p.side, loc]]) {
          if (!bag[key]) bag[key] = blankCell();
          addPass(bag[key], r);
        }
      }
    }

    if (isRush) {
      const loc = get(v, 'run_location');
      if (!loc) continue;
      carries++;
      const gapCol = get(v, 'run_gap');
      const key = loc === 'middle' ? 'middle' : (gapCol ? `${loc}-${gapCol}` : null);
      if (!key) continue;            // a left/right run with no gap recorded
      if (loc !== 'middle') gapped++;
      const id = get(v, 'rusher_player_id');
      if (!id) continue;
      if (!rushers.has(id)) rushers.set(id, { gaps: {}, situations: {}, total: 0 });
      const p = rushers.get(id);
      p.total++;
      const yards = num(v, 'yards_gained') || 0;
      const bump = (bag, k) => {
        if (!bag[k]) bag[k] = { n: 0, yards: 0, td: 0, epa: 0, success: 0, stuff: 0, ten: 0 };
        const c = bag[k];
        c.n++; c.yards += yards;
        if (get(v, 'rush_touchdown') === '1') c.td++;
        const e = num(v, 'epa'); if (e !== null) c.epa += e;
        if (get(v, 'success') === '1') c.success++;
        if (yards <= 0) c.stuff++;
        if (yards >= 10) c.ten++;
      };
      bump(p.gaps, key);
      // Situational splits, which are the other half of "where does he work".
      const yl = num(v, 'yardline_100');
      const togo = num(v, 'ydstogo');
      const down = num(v, 'down');
      if (yl !== null && yl <= 5) bump(p.situations, 'goalline');
      if (togo !== null && togo <= 2 && down !== null && down >= 3) bump(p.situations, 'shortYardage');
      if (yl !== null && yl > 20) bump(p.situations, 'openField');
    }
  }

  return {
    passers, receivers, rushers,
    coverage: {
      attempts, located,
      locatedPct: attempts ? round(located / attempts * 100, 1) : null,
      carries, gapped,
    },
  };
}

function finishRush(cell, total, floor) {
  const out = { n: cell.n, share: total ? round(cell.n / total * 100, 1) : null };
  if (cell.n >= floor) {
    out.ypc = round(cell.yards / cell.n, 2);
    out.epa = round(cell.epa / cell.n, 3);
    out.success = round(cell.success / cell.n * 100, 1);
    out.stuffPct = round(cell.stuff / cell.n * 100, 1);
    out.tenPct = round(cell.ten / cell.n * 100, 1);
    out.td = cell.td;
  } else {
    out.thin = true;
  }
  return out;
}

/**
 * Turn the raw per-player bags into what gets published: qualified players
 * only, rates gated by the cell floor, everything keyed by GSIS id so the site
 * can join it to the pool the same way every other layer does.
 *
 * `keep` decides which ids survive — the pool, so the file does not carry 1,800
 * players the site will never render.
 */
function finishFieldMap(raw, keep) {
  const wanted = id => !keep || keep.has(id);
  const out = { passers: {}, receivers: {}, rushers: {} };

  for (const [id, p] of raw.passers) {
    if (!wanted(id) || p.total < MIN_ATTEMPTS) continue;
    const cells = {};
    for (const side of SIDES) {
      for (const b of DEPTH_BANDS) {
        const k = `${side}-${b.key}`;
        cells[k] = finishPass(p.cells[k] || blankCell(), p.total, MIN_CELL);
      }
    }
    const depth = {}, side = {};
    for (const b of DEPTH_BANDS) depth[b.key] = finishPass(p.depth[b.key] || blankCell(), p.total, MIN_CELL_STRIP);
    for (const s of SIDES) side[s] = finishPass(p.side[s] || blankCell(), p.total, MIN_CELL_STRIP);
    out.passers[id] = { attempts: p.total, cells, depth, side };
  }

  for (const [id, p] of raw.receivers) {
    if (!wanted(id) || p.total < MIN_TARGETS) continue;
    const depth = {}, side = {};
    for (const b of DEPTH_BANDS) depth[b.key] = finishPass(p.depth[b.key] || blankCell(), p.total, MIN_CELL_STRIP);
    for (const s of SIDES) side[s] = finishPass(p.side[s] || blankCell(), p.total, MIN_CELL_STRIP);
    // No `cells` here on purpose. See the header: a 3x4 receiver map is mostly
    // cells built on one or two throws.
    out.receivers[id] = { targets: p.total, depth, side };
  }

  for (const [id, p] of raw.rushers) {
    if (!wanted(id) || p.total < MIN_CARRIES) continue;
    const gaps = {}, situations = {};
    for (const g of GAPS) gaps[g.key] = finishRush(p.gaps[g.key] || { n: 0, yards: 0, td: 0, epa: 0, success: 0, stuff: 0, ten: 0 }, p.total, MIN_CELL_STRIP);
    for (const k of ['goalline', 'shortYardage', 'openField']) {
      if (p.situations[k]) situations[k] = finishRush(p.situations[k], p.total, MIN_CELL_STRIP);
    }
    out.rushers[id] = { carries: p.total, gaps, situations };
  }

  return out;
}

module.exports = {
  buildFieldMap, finishFieldMap, finishRush, DEPTH_BANDS, SIDES, GAPS,
  MIN_ATTEMPTS, MIN_TARGETS, MIN_CARRIES, MIN_CELL, MIN_CELL_STRIP,
  depthOf, finishPass, blankCell, addPass, round,
};
