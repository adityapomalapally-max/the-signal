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
const seasonLib = require('./lib/season');

const DATA_DIR = path.join(__dirname, '..', 'data');
// Derived, never typed. These used to be a hand-written [2023, 2024, 2025] in each of
// three files, each with a comment asking the next person to keep them in step by
// remembering. On the first Sunday of the regular season none of them would have asked
// for the new year's data, nothing would have errored, and every profile would quietly
// have been a season stale. scripts/lib/season.js reads the NFL calendar instead.
let SEASONS = [];   // filled in main() from the live season
// If we match fewer players than this, a feed or schema moved under us.
const MATCH_FLOOR = 50;

function log(msg) { console.log(`[ngs] ${msg}`); }

function round(n, d = 1) {
  if (n === null || n === undefined || isNaN(n)) return null;
  return Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// RYOE as a share of the expectation. Guarded because a back with no carries
// has no expectation to beat, and dividing by it would produce Infinity rather
// than the honest answer, which is nothing.
const pct = (over, expected) => {
  const o = Number(over), e = Number(expected);
  if (!isFinite(o) || !isFinite(e) || e <= 0) return null;
  return Math.round((o / e) * 1000) / 10;
};

const NGS_URL = t => `https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_${t}.csv.gz`;
const SNAP_URL = s => `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${s}.csv`;

async function main() {
  SEASONS = await seasonLib.dataSeasons(3);
  console.log(`[seasons] ${SEASONS.join(', ')} — league is in ${await seasonLib.describe()}`);

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
      timeToLos: round(r.avg_time_to_los, 2),
      // RUSH YARDS OVER EXPECTED. These four columns were being downloaded and
      // thrown away. The expectation is the interesting one: at the handoff the
      // model reads the position, speed and direction of all 22 players and
      // says what an average back gains from that picture, so the blocking is
      // priced INTO the bar rather than subtracted from the result afterwards.
      //
      // Null before 2018 — the columns exist and are empty — so this carries
      // whatever is there rather than defaulting a season of zeroes.
      attempts: round(r.rush_attempts, 0),
      expYards: round(r.expected_rush_yards, 1),
      ryoe: round(r.rush_yards_over_expected, 1),
      ryoePerAtt: round(r.rush_yards_over_expected_per_att, 2),
      // THE PERCENTAGE FORM IS DERIVED, because nothing published gives it:
      // how far above the bar he ran, as a share of the bar. It is the reading
      // that survives a change of workload — a back with 300 carries and one
      // with 150 can be compared on it, which is the whole reason to quote a
      // percentage instead of a per-carry figure.
      ryoePct: pct(r.rush_yards_over_expected, r.expected_rush_yards),
      // NOT THE PERCENTAGE FORM, WHATEVER ITS NAME SAYS. `rush_pct_over_expected`
      // runs 0.34 to 0.49 across qualified backs — it is the SHARE OF CARRIES
      // that beat their expectation, which is a consistency measure and a
      // genuinely useful one. Read as "RYOE as a percentage" it would have put
      // 0.4% beside James Cook's 2025, a season he ran 28% above the bar.
      beatRate: round(r.rush_pct_over_expected, 3),
      ypc: round(r.avg_rush_yards, 2)
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
