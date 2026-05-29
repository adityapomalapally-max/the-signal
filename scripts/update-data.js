#!/usr/bin/env node

/**
 * The Signal — Automated Data Update Script
 * 
 * Fetches from ESPN + Sleeper APIs and updates JSON data files.
 * Run manually: node scripts/update-data.js
 * Run via GitHub Action: .github/workflows/daily-update.yml
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_DIR = path.join(__dirname, '..', 'data');

// ===== HELPERS =====
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'TheSignal/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error from ${url}: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

function readJSON(filename) {
  const filepath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

function writeJSON(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2) + '\n');
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ===== SLEEPER PLAYER DB =====
async function fetchSleeperPlayers() {
  log('Fetching Sleeper player database...');
  try {
    const players = await fetchJSON('https://api.sleeper.app/v1/players/nfl');
    const count = Object.keys(players).length;
    log(`Fetched ${count} players from Sleeper`);
    return players;
  } catch (e) {
    log(`ERROR fetching Sleeper players: ${e.message}`);
    return null;
  }
}

// ===== UPDATE PLAYER STATUSES =====
async function updatePlayerStatuses(sleeperPlayers) {
  if (!sleeperPlayers) return { updated: 0 };

  const players = readJSON('players.json');
  if (!players) { log('ERROR: players.json not found'); return { updated: 0 }; }

  let updated = 0;
  const statusMap = {
    'IR': { status: 'IR', statusClass: 'status-out' },
    'Out': { status: 'Out', statusClass: 'status-out' },
    'Doubtful': { status: 'Doubtful', statusClass: 'status-out' },
    'Questionable': { status: 'Questionable', statusClass: 'status-quest' },
    'Probable': { status: 'Probable', statusClass: 'status-quest' },
    'PUP': { status: 'PUP', statusClass: 'status-out' },
    'Suspended': { status: 'Suspended', statusClass: 'status-out' },
    'NFI': { status: 'NFI', statusClass: 'status-out' },
  };

  players.forEach(player => {
    // Find matching Sleeper player
    const lastName = player.name.split(' ').pop().toLowerCase();
    const firstName = player.name.split(' ')[0].toLowerCase();
    const match = Object.values(sleeperPlayers).find(sp =>
      sp && sp.last_name && sp.first_name &&
      sp.last_name.toLowerCase() === lastName &&
      sp.first_name.toLowerCase() === firstName &&
      sp.position === player.pos
    );

    if (match) {
      const injuryStatus = match.injury_status;
      
      // Don't overwrite manually-set statuses like "Rehab (ACL)" with just "Healthy"
      const isManualStatus = player.status.includes('(') || player.status.includes('Rehab');
      
      if (injuryStatus && statusMap[injuryStatus]) {
        const newStatus = statusMap[injuryStatus];
        if (player.statusClass !== newStatus.statusClass) {
          log(`  ${player.name}: ${player.status} → ${newStatus.status} (${injuryStatus})`);
          player.status = newStatus.status;
          player.statusClass = newStatus.statusClass;
          updated++;
        }
      } else if (!injuryStatus && !isManualStatus && player.statusClass !== 'status-healthy') {
        log(`  ${player.name}: ${player.status} → Healthy (cleared)`);
        player.status = 'Healthy';
        player.statusClass = 'status-healthy';
        updated++;
      }

      // Update team if changed
      if (match.team && match.team !== player.team) {
        log(`  ${player.name}: team ${player.team} → ${match.team}`);
        player.team = match.team;
        updated++;
      }
    }
  });

  writeJSON('players.json', players);
  log(`Updated ${updated} player statuses`);
  return { updated };
}

// ===== SLEEPER TRENDING =====
async function fetchTrending(sleeperPlayers) {
  log('Fetching Sleeper trending players...');
  try {
    const [adds, drops] = await Promise.all([
      fetchJSON('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=15'),
      fetchJSON('https://api.sleeper.app/v1/players/nfl/trending/drop?lookback_hours=48&limit=15')
    ]);

    const resolvePlayers = (list) => list.map(t => {
      const p = sleeperPlayers ? sleeperPlayers[t.player_id] : null;
      return {
        player_id: t.player_id,
        count: t.count,
        name: p ? `${p.first_name} ${p.last_name}` : `Player ${t.player_id}`,
        position: p ? p.position : '',
        team: p ? (p.team || 'FA') : '',
        injury_status: p ? (p.injury_status || '') : ''
      };
    });

    const trending = {
      adds: resolvePlayers(adds || []),
      drops: resolvePlayers(drops || []),
      updated: new Date().toISOString()
    };

    writeJSON('trending.json', trending);
    log(`Saved ${trending.adds.length} trending adds, ${trending.drops.length} drops`);
    return trending;
  } catch (e) {
    log(`ERROR fetching trending: ${e.message}`);
    return null;
  }
}

// ===== ESPN NEWS =====
async function fetchESPNNews() {
  log('Fetching ESPN NFL news...');
  try {
    const data = await fetchJSON('https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=20');
    if (!data.articles) { log('No articles in ESPN response'); return null; }

    const articles = data.articles.map(a => {
      const headline = a.headline || '';
      const desc = a.description || '';
      const h = (headline + ' ' + desc).toLowerCase();

      let category = 'news';
      if (h.includes('injur') || h.includes('concuss') || h.includes('acl') || h.includes('hamstring') || h.includes('out for') || h.includes('miss') || h.includes('surgery') || h.includes('ir ') || h.includes('sprain') || h.includes('fracture') || h.includes('tear') || h.includes('strain')) category = 'injury';
      else if (h.includes('fantasy') || h.includes('trade') || h.includes('sign') || h.includes('contract') || h.includes('extension') || h.includes('waiv') || h.includes('roster') || h.includes('cut') || h.includes('release') || h.includes('draft')) category = 'fantasy';

      return {
        headline,
        description: desc.substring(0, 200),
        link: a.links && a.links.web ? a.links.web.href : '',
        date: a.published || '',
        category
      };
    });

    const news = { articles, updated: new Date().toISOString() };
    writeJSON('news-cache.json', news);
    log(`Cached ${articles.length} ESPN articles (${articles.filter(a => a.category === 'injury').length} injury, ${articles.filter(a => a.category === 'fantasy').length} fantasy)`);
    return news;
  } catch (e) {
    log(`ERROR fetching ESPN news: ${e.message}`);
    return null;
  }
}

// ===== MAIN =====
async function main() {
  log('=== The Signal — Data Update ===');
  log('');

  // Step 1: Fetch Sleeper player DB
  const sleeperPlayers = await fetchSleeperPlayers();

  // Step 2: Update player statuses from Sleeper
  const statusResult = await updatePlayerStatuses(sleeperPlayers);

  // Step 3: Fetch trending
  const trending = await fetchTrending(sleeperPlayers);

  // Step 4: Fetch ESPN news
  const news = await fetchESPNNews();

  // Step 5: Update metadata
  const meta = readJSON('meta.json') || {};
  meta.lastUpdate = new Date().toISOString();
  meta.playerStatusesUpdated = statusResult.updated;
  meta.trendingAddCount = trending ? trending.adds.length : 0;
  meta.newsArticleCount = news ? news.articles.length : 0;
  writeJSON('meta.json', meta);

  log('');
  log('=== Update Complete ===');
  log(`  Player statuses updated: ${statusResult.updated}`);
  log(`  Trending players cached: ${trending ? trending.adds.length + trending.drops.length : 0}`);
  log(`  News articles cached: ${news ? news.articles.length : 0}`);
  log(`  Timestamp: ${meta.lastUpdate}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
