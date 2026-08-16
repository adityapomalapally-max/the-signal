#!/usr/bin/env node

/**
 * The Signal — Stats Pipeline
 * 
 * Fetches player stats from nflverse (GitHub-hosted CSVs).
 * Produces data/stats.json with per-player season + weekly stats.
 * 
 * Run manually: node scripts/fetch-stats.js
 * Runs as part of daily GitHub Action.
 */

const fs = require('fs');
const path = require('path');
const { fetchCSV, parseCSV, buildMatchIndex, matchRow } = require('./lib/match');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SEASONS = [2023, 2024, 2025]; // extend as needed — keep in step with fetch-ngs.js

function log(msg) {
  console.log(`[stats] ${msg}`);
}

// ===== PLAYER MATCHING (shared logic lives in lib/match.js) =====
function loadOurPlayers() {
  const players = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'players.json'), 'utf8'));
  return players.map(p => ({
    id: p.id,
    name: p.name,
    pos: p.pos,
    team: p.team,
    gsisId: p.gsisId || null
  }));
}

// nflverse stats rows: player_id IS the GSIS id.
function matchPlayer(row, index) {
  return matchRow(index, { gsis: row.player_id, name: row.player_display_name, pos: row.position });
}

// ===== STAT AGGREGATION =====
function round(n, d = 1) {
  if (n === null || n === undefined || isNaN(n)) return null;
  return Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
}

function pct(num, den) {
  if (!den || den === 0) return null;
  return round((num / den) * 100, 1);
}

function aggregateQB(weeks) {
  const games = weeks.filter(w => (w.attempts > 0 || w.carries > 0) && w.season_type === 'REG');
  if (games.length === 0) return null;
  const s = {
    games: games.length,
    completions: games.reduce((a, w) => a + (w.completions || 0), 0),
    attempts: games.reduce((a, w) => a + (w.attempts || 0), 0),
    passYds: games.reduce((a, w) => a + (w.passing_yards || 0), 0),
    passTD: games.reduce((a, w) => a + (w.passing_tds || 0), 0),
    int: games.reduce((a, w) => a + (w.passing_interceptions || 0), 0),
    sacks: games.reduce((a, w) => a + (w.sacks_suffered || 0), 0),
    passAirYds: games.reduce((a, w) => a + (w.passing_air_yards || 0), 0),
    passEPA: round(games.reduce((a, w) => a + (w.passing_epa || 0), 0), 1),
    carries: games.reduce((a, w) => a + (w.carries || 0), 0),
    rushYds: games.reduce((a, w) => a + (w.rushing_yards || 0), 0),
    rushTD: games.reduce((a, w) => a + (w.rushing_tds || 0), 0),
    rushEPA: round(games.reduce((a, w) => a + (w.rushing_epa || 0), 0), 1),
    fantasyPPR: round(games.reduce((a, w) => a + (w.fantasy_points_ppr || 0), 0), 1)
  };
  s.compPct = pct(s.completions, s.attempts);
  s.ypa = round(s.passYds / (s.attempts || 1), 1);
  s.sackPct = pct(s.sacks, s.attempts + s.sacks);
  s.passYPG = round(s.passYds / s.games, 1);
  s.rushYPG = round(s.rushYds / s.games, 1);
  s.fantasyPPG = round(s.fantasyPPR / s.games, 1);
  return s;
}

function aggregateRB(weeks) {
  const games = weeks.filter(w => (w.carries > 0 || w.targets > 0) && w.season_type === 'REG');
  if (games.length === 0) return null;
  const s = {
    games: games.length,
    carries: games.reduce((a, w) => a + (w.carries || 0), 0),
    rushYds: games.reduce((a, w) => a + (w.rushing_yards || 0), 0),
    rushTD: games.reduce((a, w) => a + (w.rushing_tds || 0), 0),
    rushEPA: round(games.reduce((a, w) => a + (w.rushing_epa || 0), 0), 1),
    targets: games.reduce((a, w) => a + (w.targets || 0), 0),
    rec: games.reduce((a, w) => a + (w.receptions || 0), 0),
    recYds: games.reduce((a, w) => a + (w.receiving_yards || 0), 0),
    recTD: games.reduce((a, w) => a + (w.receiving_tds || 0), 0),
    recAirYds: games.reduce((a, w) => a + (w.receiving_air_yards || 0), 0),
    recYAC: games.reduce((a, w) => a + (w.receiving_yards_after_catch || 0), 0),
    recEPA: round(games.reduce((a, w) => a + (w.receiving_epa || 0), 0), 1),
    fantasyPPR: round(games.reduce((a, w) => a + (w.fantasy_points_ppr || 0), 0), 1)
  };
  s.ypc = round(s.rushYds / (s.carries || 1), 1);
  s.rushYPG = round(s.rushYds / s.games, 1);
  s.recYPG = round(s.recYds / s.games, 1);
  s.catchPct = pct(s.rec, s.targets);
  s.aDOT = round(s.recAirYds / (s.targets || 1), 1);
  s.tgtShare = round(games.reduce((a, w) => a + (w.target_share || 0), 0) / games.length * 100, 1);
  s.fantasyPPG = round(s.fantasyPPR / s.games, 1);
  return s;
}

function aggregateWRTE(weeks) {
  const games = weeks.filter(w => (w.targets > 0 || w.carries > 0) && w.season_type === 'REG');
  if (games.length === 0) return null;
  const s = {
    games: games.length,
    targets: games.reduce((a, w) => a + (w.targets || 0), 0),
    rec: games.reduce((a, w) => a + (w.receptions || 0), 0),
    recYds: games.reduce((a, w) => a + (w.receiving_yards || 0), 0),
    recTD: games.reduce((a, w) => a + (w.receiving_tds || 0), 0),
    recAirYds: games.reduce((a, w) => a + (w.receiving_air_yards || 0), 0),
    recYAC: games.reduce((a, w) => a + (w.receiving_yards_after_catch || 0), 0),
    recEPA: round(games.reduce((a, w) => a + (w.receiving_epa || 0), 0), 1),
    carries: games.reduce((a, w) => a + (w.carries || 0), 0),
    rushYds: games.reduce((a, w) => a + (w.rushing_yards || 0), 0),
    rushTD: games.reduce((a, w) => a + (w.rushing_tds || 0), 0),
    fantasyPPR: round(games.reduce((a, w) => a + (w.fantasy_points_ppr || 0), 0), 1)
  };
  s.ypr = round(s.recYds / (s.rec || 1), 1);
  s.recYPG = round(s.recYds / s.games, 1);
  s.catchPct = pct(s.rec, s.targets);
  s.aDOT = round(s.recAirYds / (s.targets || 1), 1);
  s.yacPerRec = round(s.recYAC / (s.rec || 1), 1);
  s.tgtShare = round(games.reduce((a, w) => a + (w.target_share || 0), 0) / games.length * 100, 1);
  s.airYardShare = round(games.reduce((a, w) => a + (w.air_yards_share || 0), 0) / games.length * 100, 1);
  s.fantasyPPG = round(s.fantasyPPR / s.games, 1);
  return s;
}

function buildWeeklyLog(weeks, pos) {
  return weeks
    .filter(w => w.season_type === 'REG' && (w.attempts > 0 || w.carries > 0 || w.targets > 0))
    .sort((a, b) => a.week - b.week)
    .map(w => {
      const base = { week: w.week, opp: w.opponent_team, fpts: round(w.fantasy_points_ppr, 1) };
      if (pos === 'QB') {
        return { ...base,
          cmp: w.completions, att: w.attempts, passYds: w.passing_yards,
          passTD: w.passing_tds, int: w.passing_interceptions, rushYds: w.rushing_yards,
          rushTD: w.rushing_tds, passEPA: round(w.passing_epa, 1)
        };
      } else if (pos === 'RB') {
        return { ...base,
          car: w.carries, rushYds: w.rushing_yards, rushTD: w.rushing_tds,
          tgt: w.targets, rec: w.receptions, recYds: w.receiving_yards,
          recTD: w.receiving_tds, rushEPA: round(w.rushing_epa, 1)
        };
      } else {
        return { ...base,
          tgt: w.targets, rec: w.receptions, recYds: w.receiving_yards,
          recTD: w.receiving_tds, aDOT: round(w.receiving_air_yards / (w.targets || 1), 1),
          yac: w.receiving_yards_after_catch, recEPA: round(w.receiving_epa, 1)
        };
      }
    });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== VOLATILITY =====
// Everything below measures WEEK-TO-WEEK consistency: how reliable a player was
// start-to-start. This is NOT the same object as a season-long outcome band —
// weekly noise partially cancels over 17 games. Kept deliberately separate from
// projection ranges so the two never get conflated.

const FANTASY_POS = ['QB', 'RB', 'WR', 'TE'];

// Boom = finished the week as a top-N option at the position, i.e. a week where
// starting him won you the slot. Bust = fell outside the range of players a
// 12-team league would realistically start there.
// Starter counts assume 12-team, 1QB, ~2.5 RB / 3 WR / 1 TE.
const THRESHOLDS = {
  QB: { boom: 6, bust: 18 },   // top-6 week vs outside QB18
  RB: { boom: 12, bust: 36 },  // RB1 week vs outside RB3 range
  WR: { boom: 12, bust: 42 },  // WR1 week vs outside WR3.5 range
  TE: { boom: 6, bust: 18 }    // top-6 week vs outside TE18
};

// A distribution built from a handful of games is noise wearing a number's
// clothes. Below this, we report nothing rather than something false.
const MIN_GAMES_FOR_VOLATILITY = 8;

function buildWeeklyRanks(rows, season, out) {
  if (!out[season]) out[season] = {};
  for (const row of rows) {
    if (row.season_type !== 'REG') continue;
    if (!FANTASY_POS.includes(row.position)) continue;
    const pts = row.fantasy_points_ppr;
    if (pts === null || pts === undefined) continue;
    // Only count players who were actually involved — a healthy scratch at 0
    // points would otherwise inflate everyone's rank.
    const touched = (row.attempts > 0 || row.carries > 0 || row.targets > 0);
    if (!touched) continue;

    const wk = row.week;
    if (!out[season][wk]) out[season][wk] = {};
    if (!out[season][wk][row.position]) out[season][wk][row.position] = [];
    out[season][wk][row.position].push(pts);
  }
}

function finalizeWeeklyRanks(out) {
  for (const season of Object.keys(out)) {
    for (const wk of Object.keys(out[season])) {
      for (const pos of Object.keys(out[season][wk])) {
        out[season][wk][pos].sort((a, b) => b - a);
      }
    }
  }
}

// Rank of `pts` within that week's position leaderboard (1 = best).
function weeklyRankOf(weeklyRanks, season, week, pos, pts) {
  const board = weeklyRanks[season] && weeklyRanks[season][week] && weeklyRanks[season][week][pos];
  if (!board || !board.length) return null;
  let rank = 1;
  for (const v of board) {
    if (v > pts) rank++;
    else break;
  }
  return rank;
}

// Linear-interpolated percentile, matching the usual "type 7" definition.
function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function computeVolatility(weeklyLog, pos, season, weeklyRanks) {
  const games = weeklyLog.length;
  if (games < MIN_GAMES_FOR_VOLATILITY) {
    return { games, insufficient: true };
  }

  const pts = weeklyLog.map(w => w.fpts).filter(v => v !== null && v !== undefined);
  if (pts.length < MIN_GAMES_FOR_VOLATILITY) return { games, insufficient: true };

  const sorted = [...pts].sort((a, b) => a - b);
  const mean = pts.reduce((a, b) => a + b, 0) / pts.length;
  const variance = pts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / pts.length;
  const sd = Math.sqrt(variance);

  const p10 = percentile(sorted, 10);
  const p25 = percentile(sorted, 25);
  const median = percentile(sorted, 50);
  const p75 = percentile(sorted, 75);
  const p90 = percentile(sorted, 90);

  // Positional finish each week
  const th = THRESHOLDS[pos] || THRESHOLDS.WR;
  let boom = 0, bust = 0, ranked = 0;
  const ranks = [];
  for (const w of weeklyLog) {
    const r = weeklyRankOf(weeklyRanks, season, w.week, pos, w.fpts);
    if (r === null) continue;
    ranked++;
    ranks.push(r);
    if (r <= th.boom) boom++;
    if (r > th.bust) bust++;
  }

  // Is the upside tail actually longer than the downside tail? This is the
  // asymmetry question directly — measured, not assumed.
  const upGap = p90 - median;
  const downGap = median - p10;
  const skewRatio = downGap > 0 ? upGap / downGap : null;

  return {
    games,
    mean: round(mean, 1),
    median: round(median, 1),
    sd: round(sd, 1),
    // Coefficient of variation: spread relative to level, so a 20-PPG player
    // and a 10-PPG player can be compared on consistency.
    cv: mean > 0 ? round(sd / mean, 2) : null,
    p10: round(p10, 1),
    p25: round(p25, 1),
    p75: round(p75, 1),
    p90: round(p90, 1),
    boomRate: ranked ? round((boom / ranked) * 100, 0) : null,
    bustRate: ranked ? round((bust / ranked) * 100, 0) : null,
    boomThreshold: th.boom,
    bustThreshold: th.bust,
    bestRank: ranks.length ? Math.min(...ranks) : null,
    worstRank: ranks.length ? Math.max(...ranks) : null,
    medianRank: ranks.length ? Math.round(percentile([...ranks].sort((a, b) => a - b), 50)) : null,
    upGap: round(upGap, 1),
    downGap: round(downGap, 1),
    skewRatio: skewRatio === null ? null : round(skewRatio, 2)
  };
}

// ===== MAIN =====
async function main() {
  log('=== Stats Pipeline Start ===');
  const ourPlayers = loadOurPlayers();
  log(`Loaded ${ourPlayers.length} players from players.json`);
  const matchIndex = buildMatchIndex(ourPlayers, log);

  // Collect all weekly rows per player across seasons
  const playerWeeks = {}; // { playerId: { 2023: [rows], 2024: [rows] } }
  // League-wide weekly leaderboards, for positional rank / boom / bust
  const weeklyRanks = {}; // { season: { week: { pos: [sorted fpts desc] } } }

  for (let i = 0; i < SEASONS.length; i++) {
    const season = SEASONS[i];
    if (i > 0) await delay(3000); // rate limit courtesy
    log(`Fetching ${season} stats from nflverse...`);
    try {
      // nflverse retired the player_stats release in 2025; stats_player is the
      // current home and carries all seasons with a uniform schema.
      const url = `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
      const csv = await fetchCSV(url);
      const rows = parseCSV(csv);
      log(`  Parsed ${rows.length} rows for ${season}`);

      let matched = 0;
      for (const row of rows) {
        const player = matchPlayer(row, matchIndex);
        if (!player) continue;
        if (!playerWeeks[player.id]) playerWeeks[player.id] = {};
        if (!playerWeeks[player.id][season]) playerWeeks[player.id][season] = [];
        playerWeeks[player.id][season].push(row);
        matched++;
      }
      log(`  Matched ${matched} rows to our players`);

      // Build league-wide weekly leaderboards. Boom/bust has to be measured
      // against everyone who played that week at that position, not against
      // our 31-player subset — otherwise "top 12" means nothing.
      buildWeeklyRanks(rows, season, weeklyRanks);
    } catch (e) {
      // A season that fails must fail the RUN, not just log. The 2025 season
      // 404'd quietly for months after nflverse moved the release — every
      // profile silently showed a year-old picture and nothing said so.
      log(`ABORT: ${season} fetch failed (${e.message}). Keeping existing files.`);
      process.exit(1);
    }
  }

  finalizeWeeklyRanks(weeklyRanks);

  // Build stats object
  const stats = {};
  for (const player of ourPlayers) {
    const weeks = playerWeeks[player.id];
    if (!weeks) { log(`  No stats found for ${player.name}`); continue; }

    const seasons = {};
    for (const [yr, wks] of Object.entries(weeks)) {
      const agg = player.pos === 'QB' ? aggregateQB(wks)
        : player.pos === 'RB' ? aggregateRB(wks)
        : aggregateWRTE(wks);
      if (agg) {
        agg.season = parseInt(yr);
        agg.weeklyLog = buildWeeklyLog(wks, player.pos);
        agg.volatility = computeVolatility(agg.weeklyLog, player.pos, parseInt(yr), weeklyRanks);
        seasons[yr] = agg;
      }
    }

    if (Object.keys(seasons).length > 0) {
      stats[player.id] = {
        name: player.name,
        pos: player.pos,
        seasons
      };
    }
  }

  // Guard: a transient fetch failure must never wipe good data. If this run
  // produced nothing, or lost a large share of players versus what is already
  // on disk, keep the existing files and exit non-zero so CI surfaces it.
  const existingPath = path.join(DATA_DIR, 'stats.json');
  let existingCount = 0;
  if (fs.existsSync(existingPath)) {
    try { existingCount = Object.keys(JSON.parse(fs.readFileSync(existingPath, 'utf8'))).length; }
    catch (e) { existingCount = 0; }
  }
  const newCount = Object.keys(stats).length;

  if (newCount === 0) {
    log(`ABORT: produced 0 players (${existingCount} already on disk). Keeping existing files.`);
    process.exit(1);
  }
  if (existingCount > 0 && newCount < existingCount * 0.8) {
    log(`ABORT: produced ${newCount} players vs ${existingCount} on disk — looks like a partial fetch. Keeping existing files.`);
    process.exit(1);
  }

  // Write output — split into two files.
  // Season totals load on init; weekly logs only render inside an open profile
  // modal, so they are fetched lazily. This keeps the initial payload small.
  const seasonOnly = {};
  const weeklyOnly = {};

  for (const [pid, p] of Object.entries(stats)) {
    seasonOnly[pid] = { name: p.name, pos: p.pos, seasons: {} };
    weeklyOnly[pid] = {};
    for (const [yr, s] of Object.entries(p.seasons)) {
      const { weeklyLog, ...totals } = s;
      seasonOnly[pid].seasons[yr] = totals;
      if (weeklyLog && weeklyLog.length) weeklyOnly[pid][yr] = weeklyLog;
    }
  }

  fs.writeFileSync(path.join(DATA_DIR, 'stats.json'), JSON.stringify(seasonOnly, null, 2) + '\n');

  // The home page drew two small charts out of the full 450KB stats file,
  // which meant every visitor downloaded the league's season totals to see
  // five bars. This is the same numbers, precomputed, so stats.json can load
  // lazily behind the pages that actually need it.
  const HOME_SEASON = String(SEASONS[SEASONS.length - 1]);
  const HOME_FEATURED = 'CeeDee Lamb';
  const tgt = [];
  for (const p of Object.values(seasonOnly)) {
    const s = p.seasons[HOME_SEASON];
    if (s && typeof s.tgtShare === 'number' && s.games >= 8) {
      tgt.push({ name: p.name, value: s.tgtShare });
    }
  }
  tgt.sort((a, b) => b.value - a.value);

  const featured = Object.values(seasonOnly).find(p => p.name === HOME_FEATURED);
  const homeSummary = {
    season: Number(HOME_SEASON),
    builtBy: 'scripts/fetch-stats.js',
    targetShareLeaders: tgt.slice(0, 5),
    featured: featured ? {
      name: featured.name,
      seasons: Object.entries(featured.seasons)
        .filter(([, s]) => typeof s.fantasyPPG === 'number')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([yr, s]) => ({ season: Number(yr), ppg: s.fantasyPPG }))
    } : null
  };
  fs.writeFileSync(path.join(DATA_DIR, 'home-summary.json'), JSON.stringify(homeSummary, null, 2) + '\n');

  // Weekly logs shard per player: opening a profile fetches one ~8KB file
  // instead of the whole league's logs (the single file had reached 1.4MB).
  // Safe to wipe and rewrite — every abort guard has already run by here.
  const weeklyDir = path.join(DATA_DIR, 'weekly');
  fs.rmSync(weeklyDir, { recursive: true, force: true });
  fs.mkdirSync(weeklyDir, { recursive: true });
  let shardCount = 0;
  for (const [pid, seasons] of Object.entries(weeklyOnly)) {
    if (Object.keys(seasons).length) {
      fs.writeFileSync(path.join(weeklyDir, `${pid}.json`), JSON.stringify(seasons, null, 2) + '\n');
      shardCount++;
    }
  }
  // The old monolith must not linger as a stale duplicate source of truth.
  fs.rmSync(path.join(DATA_DIR, 'stats-weekly.json'), { force: true });

  const kb = f => (fs.statSync(path.join(DATA_DIR, f)).size / 1024).toFixed(0);
  log(`Wrote stats for ${Object.keys(stats).length} players`);
  log(`  data/stats.json  ${kb('stats.json')}KB (season totals, lazy — Leaders/profile/compare)`);
  log(`  data/home-summary.json ${kb('home-summary.json')}KB (home mini-charts, on init)`);
  log(`  data/weekly/     ${shardCount} per-player game-log shards (lazy-loaded per profile)`);
  log('=== Stats Pipeline Complete ===');
}

main().catch(e => {
  console.error('Stats pipeline fatal error:', e);
  process.exit(1);
});
