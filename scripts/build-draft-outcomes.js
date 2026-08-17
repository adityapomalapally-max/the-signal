#!/usr/bin/env node

/**
 * The Signal — What draft capital actually produced
 *
 * Produces data/draft-outcomes.json: for every skill player drafted
 * 2018–2023, whether he ever finished top-12 at his position by scrimmage
 * yards inside his first three seasons — the exact success bar the Draft Lab
 * page already states.
 *
 * This is NOT a validation of the POE model. It cannot be: validating a
 * model needs its predictions, and those live in Adi's spreadsheet, not in
 * any public feed. This is the BASELINE the model is claiming to beat —
 * what a round-one receiver is worth before anyone evaluates him. Publishing
 * the base rate next to the claim is what lets a reader judge the claim at
 * all; publishing the claim alone asks them to take it on faith.
 *
 * Classes stop at 2023 because a class needs three complete seasons and
 * 2025 is the last one finished.
 *
 * Run manually or daily; the inputs only move once a year.
 *   node scripts/build-draft-outcomes.js
 */

const fs = require('fs');
const path = require('path');
const { fetchCSV, parseCSV } = require('./lib/match');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA_DIR, 'draft-outcomes.json');

const FIRST_CLASS = 2018;
const LAST_CLASS = 2023;          // needs 2023+2024+2025 all complete
const WINDOW = 3;                 // seasons counted after the draft
const SUCCESS_RANK = 12;          // top-12 at the position
const POSITIONS = ['RB', 'WR', 'TE'];   // scrimmage yards is meaningless for QB
const LAST_STAT_SEASON = LAST_CLASS + WINDOW - 1;

const DRAFT_URL = 'https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv';
const STATS_URL = s => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${s}.csv`;

const log = (m) => console.log(`[draft] ${m}`);
const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  log('=== Draft Outcomes Start ===');

  log('Fetching draft picks...');
  const picks = parseCSV(await fetchCSV(DRAFT_URL))
    .filter(p => p.season >= FIRST_CLASS && p.season <= LAST_CLASS
      && POSITIONS.includes(p.position) && p.gsis_id && p.round);
  if (picks.length < 300) {
    log(`ABORT: only ${picks.length} skill-position picks found for ${FIRST_CLASS}–${LAST_CLASS}. Feed moved.`);
    process.exit(1);
  }
  log(`  ${picks.length} skill-position picks, ${FIRST_CLASS}–${LAST_CLASS}`);

  // Positional finish by scrimmage yards, per season.
  const finish = new Map();   // "season|gsisId" -> rank within position
  for (let s = FIRST_CLASS; s <= LAST_STAT_SEASON; s++) {
    await delay(1200);
    log(`Fetching ${s} season totals...`);
    let rows;
    try {
      rows = parseCSV(await fetchCSV(STATS_URL(s)));
    } catch (e) {
      // A missing season silently deflates every hit rate that depends on
      // it, so the run stops instead of publishing a low number.
      log(`ABORT: ${s} fetch failed (${e.message}). Keeping existing file.`);
      process.exit(1);
    }
    const byPos = {};
    for (const r of rows) {
      if (!POSITIONS.includes(r.position) || !r.player_id) continue;
      const scrimmage = (r.rushing_yards || 0) + (r.receiving_yards || 0);
      (byPos[r.position] ||= []).push({ id: r.player_id, scrimmage });
    }
    let ranked = 0;
    for (const pos of POSITIONS) {
      (byPos[pos] || []).sort((a, b) => b.scrimmage - a.scrimmage)
        .forEach((p, i) => { finish.set(`${s}|${p.id}`, i + 1); ranked++; });
    }
    log(`  ${ranked} player-seasons ranked`);
    if (ranked < 200) {
      log(`ABORT: ${s} produced only ${ranked} ranked players. Schema moved.`);
      process.exit(1);
    }
  }

  const positions = {};
  for (const pos of POSITIONS) {
    const list = picks.filter(p => p.position === pos);
    const rounds = {};
    let hits = 0;
    const hitExamples = [], missExamples = [];

    for (const p of list) {
      let best = null;
      for (let s = p.season; s < p.season + WINDOW; s++) {
        const r = finish.get(`${s}|${p.gsis_id}`);
        if (r && (best === null || r < best)) best = r;
      }
      const hit = best !== null && best <= SUCCESS_RANK;
      if (hit) hits++;
      const rd = Math.min(p.round, 7);
      (rounds[rd] ||= { round: rd, n: 0, hits: 0 });
      rounds[rd].n++;
      if (hit) rounds[rd].hits++;
      const rec = { name: p.pfr_player_name || p.gsis_id, season: p.season, round: p.round, pick: p.pick, best };
      if (hit && p.round >= 3) hitExamples.push(rec);
      if (!hit && p.round === 1) missExamples.push(rec);
    }

    positions[pos] = {
      total: list.length,
      hits,
      pct: Math.round((hits / list.length) * 100),
      byRound: Object.values(rounds).sort((a, b) => a.round - b.round)
        .map(r => ({ ...r, pct: Math.round((r.hits / r.n) * 100) })),
      // Late-round hits and first-round misses are the two things that make
      // the base rate feel real rather than abstract.
      lateHits: hitExamples.sort((a, b) => (a.best - b.best) || (b.round - a.round)).slice(0, 6),
      firstRoundMisses: missExamples.sort((a, b) => a.pick - b.pick).slice(0, 6)
    };
  }

  const out = {
    meta: {
      builtBy: 'scripts/build-draft-outcomes.js',
      builtAt: new Date().toISOString(),
      classes: [FIRST_CLASS, LAST_CLASS],
      window: WINDOW,
      successRule: `Top-${SUCCESS_RANK} at his position by scrimmage yards in any of his first ${WINDOW} seasons`,
      source: 'nflverse draft picks + season totals',
      scope: 'This is the base rate draft capital produces on its own. It is NOT a validation of the POE model — ' +
        'validating a model requires its predictions, which are not published here. Read it as the bar any ' +
        'evaluation has to clear.',
      caveats: 'Scrimmage yards is the stated bar, so a touchdown-dependent or target-hog receiver can miss it while ' +
        'still helping a fantasy roster. A player who never got the ball counts as a miss whether that was talent or ' +
        'situation, and situation is most of it in the later rounds. Quarterbacks are excluded because scrimmage ' +
        'yards does not measure them.'
    },
    positions
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  log(`Wrote data/draft-outcomes.json`);
  for (const pos of POSITIONS) {
    const p = positions[pos];
    log(`  ${pos}: ${p.hits}/${p.total} (${p.pct}%) — ` +
        p.byRound.map(r => `R${r.round} ${r.pct}%`).join(' '));
  }
  log('=== Draft Outcomes Complete ===');
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
