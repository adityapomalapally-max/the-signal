#!/usr/bin/env node

/**
 * The Signal — Next Gen Stats + Snap Counts
 *
 * Produces data/ngs.json: per player, per season —
 *   rec:  avg separation, cushion, intended air yards + share, catch %,
 *         YAC vs expected YAC (the Reception Perception-adjacent numbers)
 *   pass: time to throw, aggressiveness, CPOE, completion % vs expected
 *   rush: efficiency (N/S ratio), % attempts vs 8+ box, time to LOS
 *   snaps: offensive snap % (snap-weighted across games), games counted
 *
 * Sources (verified live before this script was written — release names
 * move, and a moved file must fail the run, never silently skip):
 *   nextgen_stats/ngs_{passing,receiving,rushing}.csv.gz  (all seasons,
 *     one file each; week 0 = REG season aggregate, matched by GSIS id)
 *   snap_counts/snap_counts_{season}.csv  (per game; matched by name+pos)
 *
 * Runs after fetch-stats in the daily Action. Manual: node scripts/fetch-ngs.js
 */

const fs = require('fs');
const path = require('path');
const { fetchCSV, parseCSV, buildMatchIndex, matchRow } = require('./lib/match');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SEASONS = [2023, 2024, 2025]; // keep in step with fetch-stats.js
// If we match fewer players than this, a feed or schema moved under us.
const MATCH_FLOOR = 50;

function log(msg) { console.log(`[ngs] ${msg}`); }

function round(n, d = 1) {
  if (n === null || n === undefined || isNaN(n)) return null;
  return Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

const NGS_URL = t => `https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_${t}.csv.gz`;
const SNAP_URL = s => `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${s}.csv`;

async function main() {
  log('=== NGS Pipeline Start ===');
  const players = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'players.json'), 'utf8'));
  const index = buildMatchIndex(players.map(p => ({ id: p.id, name: p.name, pos: p.pos, gsisId: p.gsisId || null })), log);

  const out = {}; // playerId -> season -> { rec | pass | rush | snapPct ... }
  const slot = (pid, season) => {
    if (!out[pid]) out[pid] = {};
    if (!out[pid][season]) out[pid][season] = {};
    return out[pid][season];
  };

  // ---- NGS (week-0 rows are the REG-season aggregates) ----
  const ngsExtract = {
    receiving: (r) => ({
      separation: round(r.avg_separation),
      cushion: round(r.avg_cushion),
      iay: round(r.avg_intended_air_yards),
      iayShare: round(r.percent_share_of_intended_air_yards),
      catchPct: round(r.catch_percentage),
      yac: round(r.avg_yac),
      xYac: round(r.avg_expected_yac),
      yacOE: round(r.avg_yac_above_expectation)
    }),
    passing: (r) => ({
      timeToThrow: round(r.avg_time_to_throw, 2),
      aggressiveness: round(r.aggressiveness),
      iay: round(r.avg_intended_air_yards),
      compPct: round(r.completion_percentage),
      xCompPct: round(r.expected_completion_percentage),
      cpoe: round(r.completion_percentage_above_expectation)
    }),
    rushing: (r) => ({
      efficiency: round(r.efficiency, 2),
      eightBoxPct: round(r.percent_attempts_gte_eight_defenders),
      timeToLos: round(r.avg_time_to_los, 2)
    })
  };
  const ngsKey = { receiving: 'rec', passing: 'pass', rushing: 'rush' };

  let ngsMatched = 0;
  for (const type of ['receiving', 'passing', 'rushing']) {
    log(`Fetching NGS ${type}...`);
    const rows = parseCSV(await fetchCSV(NGS_URL(type)));
    let used = 0;
    for (const r of rows) {
      if (r.season_type !== 'REG' || r.week !== 0) continue;
      if (!SEASONS.includes(r.season)) continue;
      const p = matchRow(index, { gsis: r.player_gsis_id, name: r.player_display_name, pos: r.player_position });
      if (!p) continue;
      slot(p.id, r.season)[ngsKey[type]] = ngsExtract[type](r);
      used++;
    }
    log(`  ${rows.length} rows, ${used} season-aggregates matched`);
    ngsMatched += used;
    await delay(2000);
  }

  // ---- Snap counts (per game -> snap-weighted season offensive %) ----
  for (const season of SEASONS) {
    log(`Fetching ${season} snap counts...`);
    const rows = parseCSV(await fetchCSV(SNAP_URL(season)));
    const acc = {}; // playerId -> { snaps, teamSnaps, games }
    for (const r of rows) {
      if (r.game_type !== 'REG') continue;
      if (typeof r.offense_snaps !== 'number' || typeof r.offense_pct !== 'number') continue;
      if (r.offense_snaps <= 0 || r.offense_pct <= 0) continue;
      const p = matchRow(index, { gsis: null, name: r.player, pos: r.position });
      if (!p) continue;
      const a = acc[p.id] || (acc[p.id] = { snaps: 0, teamSnaps: 0, games: 0 });
      a.snaps += r.offense_snaps;
      a.teamSnaps += r.offense_snaps / r.offense_pct;
      a.games++;
    }
    let used = 0;
    for (const [pid, a] of Object.entries(acc)) {
      if (a.teamSnaps <= 0) continue;
      const s = slot(pid, season);
      s.snapPct = round((a.snaps / a.teamSnaps) * 100);
      s.offSnaps = a.snaps;
      s.snapGames = a.games;
      used++;
    }
    log(`  ${used} players with snap data`);
    await delay(2000);
  }

  const matchedPlayers = Object.keys(out).length;
  if (ngsMatched < MATCH_FLOOR || matchedPlayers < MATCH_FLOOR) {
    log(`ABORT: only ${matchedPlayers} players / ${ngsMatched} NGS aggregates matched — a feed or schema moved. Keeping existing ngs.json.`);
    process.exit(1);
  }

  fs.writeFileSync(path.join(DATA_DIR, 'ngs.json'), JSON.stringify(out, null, 2) + '\n');
  const kb = (fs.statSync(path.join(DATA_DIR, 'ngs.json')).size / 1024).toFixed(0);
  log(`Wrote data/ngs.json: ${matchedPlayers} players, ${kb}KB`);
  log('=== NGS Pipeline Complete ===');
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
