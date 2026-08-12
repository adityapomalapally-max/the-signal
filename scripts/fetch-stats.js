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
const https = require('https');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SEASONS = [2023, 2024, 2025]; // extend as needed

function log(msg) {
  console.log(`[stats] ${msg}`);
}

// ===== CSV FETCH + PARSE =====
function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    const doFetch = (u, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      https.get(u, { headers: { 'User-Agent': 'TheSignal/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doFetch(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    };
    doFetch(url);
  });
}

function parseCSV(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    if (vals.length !== headers.length) continue;
    const row = {};
    headers.forEach((h, j) => {
      const v = vals[j].replace(/^"|"$/g, '').trim();
      row[h] = v === '' || v === 'NA' ? null : isNaN(v) ? v : parseFloat(v);
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; }
    else if (c === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += c; }
  }
  result.push(current);
  return result;
}

// ===== PLAYER MATCHING =====
function loadOurPlayers() {
  const players = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'players.json'), 'utf8'));
  return players.map(p => ({
    id: p.id,
    name: p.name,
    pos: p.pos,
    team: p.team
  }));
}

function normalizeName(name) {
  return name
    .replace(/\s+(III|II|IV|Jr\.?|Sr\.?)$/i, '')
    .replace(/[''`]/g, '')  // strip apostrophes/smart quotes
    .toLowerCase()
    .trim();
}

function matchPlayer(row, ourPlayers) {
  const displayName = normalizeName(row.player_display_name || '');
  return ourPlayers.find(p => normalizeName(p.name) === displayName && p.pos === row.position);
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
    int: games.reduce((a, w) => a + (w.interceptions || 0), 0),
    sacks: games.reduce((a, w) => a + (w.sacks || 0), 0),
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
          passTD: w.passing_tds, int: w.interceptions, rushYds: w.rushing_yards,
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

// ===== MAIN =====
async function main() {
  log('=== Stats Pipeline Start ===');
  const ourPlayers = loadOurPlayers();
  log(`Loaded ${ourPlayers.length} players from players.json`);

  // Collect all weekly rows per player across seasons
  const playerWeeks = {}; // { playerId: { 2023: [rows], 2024: [rows] } }

  for (let i = 0; i < SEASONS.length; i++) {
    const season = SEASONS[i];
    if (i > 0) await delay(3000); // rate limit courtesy
    log(`Fetching ${season} stats from nflverse...`);
    try {
      const url = `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${season}.csv`;
      const csv = await fetchCSV(url);
      const rows = parseCSV(csv);
      log(`  Parsed ${rows.length} rows for ${season}`);

      let matched = 0;
      for (const row of rows) {
        const player = matchPlayer(row, ourPlayers);
        if (!player) continue;
        if (!playerWeeks[player.id]) playerWeeks[player.id] = {};
        if (!playerWeeks[player.id][season]) playerWeeks[player.id][season] = [];
        playerWeeks[player.id][season].push(row);
        matched++;
      }
      log(`  Matched ${matched} rows to our players`);
    } catch (e) {
      log(`  ERROR fetching ${season}: ${e.message}`);
    }
  }

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
  fs.writeFileSync(path.join(DATA_DIR, 'stats-weekly.json'), JSON.stringify(weeklyOnly, null, 2) + '\n');

  const kb = f => (fs.statSync(path.join(DATA_DIR, f)).size / 1024).toFixed(0);
  log(`Wrote stats for ${Object.keys(stats).length} players`);
  log(`  data/stats.json        ${kb('stats.json')}KB (season totals, loaded on init)`);
  log(`  data/stats-weekly.json ${kb('stats-weekly.json')}KB (game logs, lazy-loaded)`);
  log('=== Stats Pipeline Complete ===');
}

main().catch(e => {
  console.error('Stats pipeline fatal error:', e);
  process.exit(1);
});
