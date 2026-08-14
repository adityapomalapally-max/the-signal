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

// ===== STATUS PROVENANCE =====
// A status is "manual" only when players.json says so explicitly.
//
// This used to be inferred from punctuation — `status.includes('(')` — which
// meant any hand-written status was frozen permanently. "Rehab (Turf Toe)"
// contains a parenthesis, so Burrow could never be auto-cleared and sat at
// status-out for ten months after he was healthy. Punctuation is not
// provenance. A manual flag is.
//
// Manual statuses are also not immortal. One that hasn't been touched in
// MANUAL_STALE_DAYS is reported as stale rather than silently held, so a
// forgotten hand-edit surfaces instead of quietly going wrong on the site.
const MANUAL_STALE_DAYS = 21;

// Feed statuses that outrank a manual note regardless of freshness. Never
// under-report an injury because someone typed something optimistic in July.
const ESCALATIONS = new Set(['IR', 'Out', 'PUP', 'NFI', 'Suspended', 'Doubtful']);

// Generational suffixes are inconsistently placed across sources — sometimes in
// last_name, sometimes a separate field, sometimes absent. They carry no
// identifying information here, so they come out on both sides.
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.'\u2019`]/g, '')   // periods and apostrophes: "St." / "Ja'Marr"
    .replace(/[-\u2010-\u2015]/g, ' ') // hyphens: "Amon-Ra"
    .split(/\s+/)
    .filter(t => t && !NAME_SUFFIXES.has(t))
    .join(' ')
    .trim();
}

function daysSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

// ===== UPDATE PLAYER STATUSES =====
async function updatePlayerStatuses(sleeperPlayers) {
  if (!sleeperPlayers) {
    log('  ABORT: no Sleeper player DB — statuses left untouched');
    return { updated: 0, diagnostics: { fetchFailed: true } };
  }

  const players = readJSON('players.json');
  if (!players) { log('ERROR: players.json not found'); return { updated: 0 }; }

  let updated = 0;
  // Why the run did or didn't act, per player. A run that changes nothing is
  // indistinguishable from a run that failed unless it says which it was —
  // meta.json read `playerStatusesUpdated: 0` for weeks with no way to tell.
  const diagnostics = { unmatched: [], ambiguous: [], manualHeld: [], staleManual: [], feedSilent: 0 };
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

  // Index Sleeper by normalized full name + position. The old matcher compared
  // the first and last *whitespace tokens* of our name against Sleeper's
  // first_name/last_name, which fails in both directions:
  //   "Amon-Ra St. Brown" -> last token "Brown", Sleeper stores "St. Brown"
  //   "James Cook III"    -> last token "III",   Sleeper stores "Cook"
  // A player who never matches is never evaluated at all, so his status is
  // frozen just as hard as a bad guard would freeze it, and silently.
  const nameIndex = new Map();
  for (const sp of Object.values(sleeperPlayers)) {
    if (!sp || !sp.position) continue;
    const full = sp.full_name || `${sp.first_name || ''} ${sp.last_name || ''}`;
    const key = `${normalizeName(full)}|${sp.position}`;
    if (!key.startsWith('|')) {
      if (!nameIndex.has(key)) nameIndex.set(key, []);
      nameIndex.get(key).push(sp);
    }
  }

  players.forEach(player => {
    // A confirmed Sleeper ID is stable and beats name matching outright, so a
    // player only has to be matched by name once.
    let match = null;
    if (player.sleeperId && sleeperPlayers[player.sleeperId]) {
      const byId = sleeperPlayers[player.sleeperId];
      if (byId.position === player.pos) match = byId;
    }

    if (!match) {
      const candidates = nameIndex.get(`${normalizeName(player.name)}|${player.pos}`) || [];
      if (candidates.length === 1) {
        match = candidates[0];
      } else if (candidates.length > 1) {
        const byTeam = candidates.filter(sp => sp.team === player.team);
        if (byTeam.length === 1) {
          match = byTeam[0];
        } else {
          // Two players, same name and position. Picking one at random would
          // write someone else's injury onto this profile.
          diagnostics.ambiguous.push(`${player.name} (${player.pos}) — ${candidates.length} candidates`);
        }
      }
    }

    if (match) {
      // Persist the Sleeper ID so the site can build headshot URLs without
      // fetching the full ~5MB player DB at runtime.
      if (player.sleeperId !== match.player_id) {
        player.sleeperId = match.player_id;
        updated++;
      }

      const injuryStatus = match.injury_status;
      const manual = player.manualOverride === true;
      const age = manual ? daysSince(player.statusSetAt) : null;
      const manualStale = manual && (age === null || age > MANUAL_STALE_DAYS);

      const apply = (status, statusClass, source, why) => {
        log(`  ${player.name}: ${player.status} → ${status} (${why})`);
        player.status = status;
        player.statusClass = statusClass;
        player.statusSource = source;
        player.statusUpdated = new Date().toISOString();
        if (source === 'sleeper') {
          player.manualOverride = false;
          delete player.statusSetAt;
        }
        updated++;
      };

      if (injuryStatus && statusMap[injuryStatus]) {
        const next = statusMap[injuryStatus];
        // The feed wins when it escalates, when the manual note has gone stale,
        // or when there is no manual note at all. A fresh manual note otherwise
        // holds, because it carries detail the feed's one-word status doesn't.
        const feedWins = !manual || manualStale || ESCALATIONS.has(injuryStatus);
        if (!feedWins) {
          diagnostics.manualHeld.push(`${player.name} (feed: ${injuryStatus}, manual ${age}d old)`);
        } else if (player.status !== next.status || player.statusClass !== next.statusClass) {
          apply(next.status, next.statusClass, 'sleeper', `sleeper: ${injuryStatus}`);
        }
      } else if (!injuryStatus) {
        if (!manual) {
          if (player.statusClass !== 'status-healthy') {
            apply('Healthy', 'status-healthy', 'sleeper', 'cleared — feed reports no injury');
          }
        } else if (manualStale) {
          // Do not auto-clear a manual note, but do not hide it either.
          diagnostics.staleManual.push(
            `${player.name}: "${player.status}" set ${age === null ? 'at an unknown date' : age + 'd ago'} — needs review`
          );
        } else {
          diagnostics.manualHeld.push(`${player.name} (manual, ${age}d old)`);
        }
      }

      // Update team if changed
      if (match.team && match.team !== player.team) {
        log(`  ${player.name}: team ${player.team} → ${match.team}`);
        player.team = match.team;
        updated++;
      }
    } else {
      // A name that never matches gets its status frozen just as effectively as
      // a bad guard did — it simply never enters the decision at all.
      diagnostics.unmatched.push(`${player.name} (${player.pos})`);
    }
  });

  diagnostics.feedSilent = players.filter(p => p.statusClass !== 'status-healthy').length;

  writeJSON('players.json', players);
  log(`Updated ${updated} player statuses`);
  if (diagnostics.unmatched.length) log(`  UNMATCHED in Sleeper DB (${diagnostics.unmatched.length}): ${diagnostics.unmatched.join(', ')}`);
  if (diagnostics.ambiguous.length) log(`  AMBIGUOUS, skipped (${diagnostics.ambiguous.length}): ${diagnostics.ambiguous.join(', ')}`);
  if (diagnostics.staleManual.length) {
    log(`  STALE manual statuses (${diagnostics.staleManual.length}) — review these:`);
    diagnostics.staleManual.forEach(s => log(`    ${s}`));
  }
  if (diagnostics.manualHeld.length) log(`  Manual holds (${diagnostics.manualHeld.length}): ${diagnostics.manualHeld.join(', ')}`);
  return { updated, diagnostics };
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
  meta.statusDiagnostics = statusResult.diagnostics || null;
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
