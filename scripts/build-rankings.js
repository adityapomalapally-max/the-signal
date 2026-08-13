#!/usr/bin/env node
/**
 * build-rankings.js — generate data/rankings.json from data/projections-2026.json
 *
 * The ticker used to read from a hand-typed list of names with no methodology
 * behind it, which is why the ordering looked arbitrary: nothing generated it.
 * This derives every tab from one projection source, so changing a projection
 * changes the site and the two can never drift apart.
 *
 * Positional tabs are ordered by projected median season total.
 *
 * The overall tab is ordered by VORP, not by raw points. Raw points across
 * positions is meaningless — every QB1 outscores every WR1 and it tells you
 * nothing about draft order. VORP asks the only question that matters in a
 * draft: how many points does this player give you over the guy you could have
 * had for free at the same position?
 *
 * Replacement baselines, for 12-team / 1QB / 2RB / 3WR / 1TE / 1FLEX:
 *   QB12  — 12 starting QBs, so the 13th is free.
 *   RB30  — 24 locked RB starters plus roughly half the 12 flex spots.
 *   WR40  — 36 locked WR starters plus most of the remaining flex.
 *   TE12  — 12 starting TEs; flex almost never goes TE without a premium.
 * These are stated rather than tuned. Change them here and the board moves.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SRC = path.join(DATA_DIR, 'projections-2026.json');
const MANUAL = path.join(DATA_DIR, 'rankings-manual.json');
const OUT = path.join(DATA_DIR, 'rankings.json');

// Rank of the replacement-level player at each position (1-indexed).
const BASELINE_RANK = { qb: 12, rb: 30, wr: 40, te: 12 };

// How many rows each tab publishes.
const TAB_SIZE = { overall: 24, qb: 20, rb: 24, wr: 32, te: 16 };

const log = (m) => console.log(`[rankings] ${m}`);

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`[rankings] ABORT: ${SRC} not found`);
    process.exit(1);
  }
  const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const proj = src.projections;

  const baselines = {};
  const pools = {};

  for (const pos of ['qb', 'rb', 'wr', 'te']) {
    const pool = [...(proj[pos] || [])].sort((a, b) => b.median - a.median);
    if (!pool.length) {
      console.error(`[rankings] ABORT: no ${pos.toUpperCase()} projections`);
      process.exit(1);
    }
    const idx = BASELINE_RANK[pos] - 1;
    if (idx >= pool.length) {
      // Refuse to guess. A baseline deeper than the pool would silently inflate
      // every VORP at that position and quietly reorder the whole overall board.
      console.error(
        `[rankings] ABORT: ${pos.toUpperCase()} baseline is rank ${BASELINE_RANK[pos]} ` +
        `but only ${pool.length} are projected. Extend the pool or lower the baseline.`
      );
      process.exit(1);
    }
    baselines[pos] = pool[idx].median;
    pools[pos] = pool;
    log(`${pos.toUpperCase()} baseline = ${pos.toUpperCase()}${BASELINE_RANK[pos]} (${pool[idx].name}, ${pool[idx].median} pts)`);
  }

  const round1 = (n) => Math.round(n * 10) / 10;

  const row = (p, rank, pos) => {
    const r = {
      rank,
      name: p.name,
      team: p.team,
      pos: p.pos || pos.toUpperCase(),
      median: p.median,
      ppg: round1(p.median / 17),
      vorp: Math.round(p.median - baselines[pos])
    };
    // Only publish a band where a real one exists — depth players carry a
    // median for baseline purposes and nothing else. Empty beats invented.
    if (typeof p.floor === 'number') r.floor = p.floor;
    if (typeof p.ceiling === 'number') r.ceiling = p.ceiling;
    return r;
  };

  const out = {
    meta: {
      ...src.meta,
      builtBy: 'scripts/build-rankings.js',
      builtAt: new Date().toISOString(),
      overallMethod:
        'Ordered by VORP (median minus replacement-level median at the same position), not raw points.',
      baselines: Object.fromEntries(
        Object.keys(BASELINE_RANK).map((p) => [
          p,
          { rank: BASELINE_RANK[p], points: baselines[p], player: pools[p][BASELINE_RANK[p] - 1].name }
        ])
      )
    }
  };

  // Positional tabs — ranked by median.
  for (const pos of ['qb', 'rb', 'wr', 'te']) {
    out[pos] = pools[pos]
      .filter((p) => !p.baselineOnly)
      .slice(0, TAB_SIZE[pos])
      .map((p, i) => row(p, i + 1, pos));
  }

  // Overall — ranked by VORP across positions.
  const all = [];
  for (const pos of ['qb', 'rb', 'wr', 'te']) {
    pools[pos].filter((p) => !p.baselineOnly).forEach((p) => all.push({ p, pos }));
  }
  all.sort((a, b) => (b.p.median - baselines[b.pos]) - (a.p.median - baselines[a.pos]));
  out.overall = all.slice(0, TAB_SIZE.overall).map(({ p, pos }, i) => row(p, i + 1, pos));

  // ===== MANUAL OVERRIDE =====
  // Any tab listed in rankings-manual.json takes Adi's order verbatim. Tabs
  // left out or emptied fall back to the generated order, so this file can hold
  // one tab or all five. Projections still supply team and PPG where the name
  // matches, so a hand-ordered board keeps the same information density.
  let manual = {};
  if (fs.existsSync(MANUAL)) {
    try {
      manual = JSON.parse(fs.readFileSync(MANUAL, 'utf8'));
    } catch (e) {
      // A typo here should not silently publish the wrong board.
      console.error(`[rankings] ABORT: ${MANUAL} is not valid JSON — ${e.message}`);
      process.exit(1);
    }
  }

  const byName = new Map();
  for (const pos of ['qb', 'rb', 'wr', 'te']) {
    for (const p of pools[pos]) byName.set(p.name.toLowerCase(), { p, pos });
  }

  function applyManual(tab, generated) {
    const list = manual[tab];
    if (!Array.isArray(list) || !list.length) return generated;

    const rows = [];
    const missing = [];
    list.forEach((entry, i) => {
      const name = typeof entry === 'string' ? entry : entry && entry.name;
      if (!name) return;
      const hit = byName.get(String(name).trim().toLowerCase());
      if (hit) {
        const r = row(hit.p, i + 1, hit.pos);
        if (typeof entry === 'object' && entry.team) r.team = entry.team;
        rows.push(r);
      } else {
        // Rank a player with no projection and you still get the rank — you
        // just don't get invented numbers next to it.
        missing.push(name);
        rows.push({
          rank: i + 1,
          name: String(name).trim(),
          team: (typeof entry === 'object' && entry.team) || '',
          pos: ((typeof entry === 'object' && entry.pos) || tab).toUpperCase()
        });
      }
    });
    if (missing.length) {
      log(`  ${tab}: ${missing.length} name(s) not in projections, shown without PPG: ${missing.join(', ')}`);
    }
    log(`  ${tab}: MANUAL order, ${rows.length} rows`);
    out.meta.manualTabs = [...(out.meta.manualTabs || []), tab];
    return rows;
  }

  for (const tab of ['qb', 'rb', 'wr', 'te']) {
    out[tab] = applyManual(tab, out[tab]);
  }

  // ===== OVERALL =====
  // Precedence: a hand-written overall list wins. Otherwise, if any positional
  // tab is hand-ordered, the overall board is derived from those instead of
  // from the model's own order — publishing a VORP board that contradicts the
  // positional tabs sitting next to it would be worse than either alone.
  //
  // Slot inheritance: a player takes the projected median of the SLOT he was
  // ranked into, not his own projection. Rank someone RB5 and he is valued as
  // the 5th-best RB, because that is what the ranking asserts. This keeps the
  // ordering entirely Adi's while the replacement math stays real, and it means
  // players with no projection of their own still get a defensible value.
  const manualPositional = ['qb', 'rb', 'wr', 'te'].filter(
    (t) => Array.isArray(manual[t]) && manual[t].length
  );

  if (Array.isArray(manual.overall) && manual.overall.length) {
    out.overall = applyManual('overall', out.overall);
  } else if (manualPositional.length) {
    const slotMedians = {};
    for (const pos of ['qb', 'rb', 'wr', 'te']) {
      slotMedians[pos] = pools[pos].filter((p) => !p.baselineOnly).map((p) => p.median);
    }

    const board = [];
    for (const pos of ['qb', 'rb', 'wr', 'te']) {
      // A tab left to the model still contributes, using the model's order.
      out[pos].forEach((r, i) => {
        const slots = slotMedians[pos];
        // Past the end of the projected pool there is no slot value to inherit.
        // Fall back to replacement level rather than inventing one: it puts the
        // player at VORP 0 instead of somewhere flattering and arbitrary.
        const slotMedian = i < slots.length ? slots[i] : baselines[pos];
        board.push({ r, pos, slotMedian, vorp: slotMedian - baselines[pos] });
      });
    }
    board.sort((a, b) => b.vorp - a.vorp);

    out.overall = board.slice(0, TAB_SIZE.overall).map((e, i) => {
      const o = { ...e.r, rank: i + 1, vorp: Math.round(e.vorp) };
      // The overall tab is a value board, so every row is shown on the same
      // slot basis. A player's own projection is kept alongside rather than
      // dropped — where the two disagree, that gap is the ranking's actual
      // claim about him, and it should stay visible.
      if (typeof e.r.ppg === 'number') o.ownPpg = e.r.ppg;
      if (typeof e.r.median === 'number') o.ownMedian = e.r.median;
      o.median = e.slotMedian;
      o.ppg = round1(e.slotMedian / 17);
      return o;
    });

    out.meta.overallMethod =
      'Derived from the hand-ordered positional tabs. Each player inherits the projected median of the slot he was ranked into, then VORP is taken against replacement level. Ordering is the analyst\'s; the replacement math is the model\'s.';
    out.meta.overallDerivedFrom = manualPositional;
    log(`  overall: DERIVED from manual tabs (${manualPositional.join(', ')}) via slot-inherited VORP`);
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  log(`Wrote ${OUT}`);
  for (const tab of ['overall', 'qb', 'rb', 'wr', 'te']) log(`  ${tab}: ${out[tab].length} rows`);
}

main();
