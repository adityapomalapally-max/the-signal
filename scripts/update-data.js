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
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
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
    recordFetchFailure('Sleeper player DB', e.message);
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
// A manual flag in players.json is no longer provenance either, because it
// records only THAT a human typed something, never when or on what evidence.
// data/injury-overrides.json is now the one place a status is hand-set, and
// every entry there is dated, sourced, and expiring — see lib/overrides.js.
// A manualOverride left in players.json with no live entry behind it is an
// orphan from before that file existed and gets handed back to the feed.
const { ESCALATIONS, formatStatus } = require('./lib/status');
const { readOverrides, validateOverrides, parseDate, daysAgo } = require('./lib/overrides');

// Generational suffixes are inconsistently placed across sources — sometimes in
// last_name, sometimes a separate field, sometimes absent. They carry no
// identifying information here, so they come out on both sides. It lives in the
// matcher lib next to its nflverse sibling: one definition of each, and the two
// are documented as not interchangeable.
const { normalizeSleeperName: normalizeName } = require('./lib/match');
const { USER_AGENT } = require('./lib/agent');

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
  const diagnostics = {
    unmatched: [], ambiguous: [], overridesApplied: [], overridesOutranked: [],
    overridesExpired: [], overridesOrphaned: [], overrideErrors: [], feedSilent: 0,
  };

  const overrideIndex = buildOverrideIndex(diagnostics);

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

      const apply = (status, statusClass, source, why, setAt) => {
        if (player.status === status && player.statusClass === statusClass && player.statusSource === source) return;
        log(`  ${player.name}: ${player.status} → ${status} (${why})`);
        player.status = status;
        player.statusClass = statusClass;
        player.statusSource = source;
        player.statusUpdated = new Date().toISOString();
        if (source === 'override') {
          player.manualOverride = true;
          player.statusSetAt = setAt;
        } else {
          player.manualOverride = false;
          delete player.statusSetAt;
        }
        updated++;
      };

      // What the feed says, body part and all. No injury_status means healthy —
      // the feed clears a player by going quiet about him.
      const feed = (injuryStatus && formatStatus(injuryStatus, match.injury_body_part))
        || { status: 'Healthy', statusClass: 'status-healthy' };

      const ov = takeOverride(overrideIndex, player);

      if (injuryStatus && ESCALATIONS.has(injuryStatus)) {
        // Never let a hand note talk a player down from IR.
        if (ov) diagnostics.overridesOutranked.push(`${player.name}: "${ov.status}" outranked by feed ${injuryStatus}`);
        apply(feed.status, feed.statusClass, 'sleeper', `sleeper: ${injuryStatus}`);
      } else if (ov) {
        diagnostics.overridesApplied.push(`${player.name}: "${ov.status}" (set ${daysAgo(parseDate(ov.setAt))}d ago, ${ov.source})`);
        apply(ov.status, ov.statusClass, 'override', `override: ${ov.source}`, ov.setAt);
      } else {
        if (player.manualOverride === true) {
          // A hand-set status with nothing live behind it. It had its run.
          diagnostics.overridesOrphaned.push(`${player.name}: "${player.status}" had no live override — returned to the feed`);
        }
        apply(feed.status, feed.statusClass, 'sleeper',
          injuryStatus ? `sleeper: ${injuryStatus}` : 'cleared — feed reports no injury');
      }

      // Update team if changed
      if (match.team && match.team !== player.team) {
        log(`  ${player.name}: team ${player.team} → ${match.team}`);
        player.team = match.team;
        updated++;
      }
    } else {
      // A name that never matches gets its status frozen just as effectively as
      // a bad guard did — it simply never enters the decision at all. An
      // override still applies: not being in Sleeper's DB is exactly the kind
      // of gap a human is filling in by hand.
      diagnostics.unmatched.push(`${player.name} (${player.pos})`);
      const ov = takeOverride(overrideIndex, player);
      if (ov) {
        diagnostics.overridesApplied.push(`${player.name}: "${ov.status}" (no Sleeper match, ${ov.source})`);
        if (player.status !== ov.status || player.statusClass !== ov.statusClass) {
          log(`  ${player.name}: ${player.status} → ${ov.status} (override: ${ov.source})`);
          player.status = ov.status;
          player.statusClass = ov.statusClass;
          player.statusSource = 'override';
          player.statusUpdated = new Date().toISOString();
          player.manualOverride = true;
          player.statusSetAt = ov.setAt;
          updated++;
        }
      }
    }
  });

  // An override nobody claimed is a typo'd name, a traded player, or someone who
  // fell out of the pool. It reads as "handled" in the file while doing nothing,
  // which is the exact failure this whole layer exists to prevent.
  for (const [, row] of overrideIndex.byKey) {
    if (!row.claimed) {
      diagnostics.overrideErrors.push(`${row.entry.player} (${row.entry.pos}): no player in the pool matches this override`);
    }
  }

  diagnostics.feedSilent = players.filter(p => p.statusClass !== 'status-healthy').length;

  writeJSON('players.json', players);
  log(`Updated ${updated} player statuses`);
  if (diagnostics.unmatched.length) log(`  UNMATCHED in Sleeper DB (${diagnostics.unmatched.length}): ${diagnostics.unmatched.join(', ')}`);
  if (diagnostics.ambiguous.length) log(`  AMBIGUOUS, skipped (${diagnostics.ambiguous.length}): ${diagnostics.ambiguous.join(', ')}`);
  if (diagnostics.overridesApplied.length) {
    log(`  Overrides applied (${diagnostics.overridesApplied.length}):`);
    diagnostics.overridesApplied.forEach(s => log(`    ${s}`));
  }
  if (diagnostics.overridesOutranked.length) log(`  Overrides outranked by the feed (${diagnostics.overridesOutranked.length}): ${diagnostics.overridesOutranked.join(', ')}`);
  if (diagnostics.overridesExpired.length) {
    log(`  EXPIRED overrides (${diagnostics.overridesExpired.length}) — refresh or delete them:`);
    diagnostics.overridesExpired.forEach(s => log(`    ${s}`));
  }
  if (diagnostics.overridesOrphaned.length) {
    log(`  Orphaned manual statuses returned to the feed (${diagnostics.overridesOrphaned.length}):`);
    diagnostics.overridesOrphaned.forEach(s => log(`    ${s}`));
  }
  if (diagnostics.overrideErrors.length) {
    log(`  OVERRIDE ERRORS (${diagnostics.overrideErrors.length}) — these entries did NOTHING:`);
    diagnostics.overrideErrors.forEach(s => log(`    ${s}`));
  }
  return { updated, diagnostics };
}

// ===== HAND-WRITTEN OVERRIDES =====
// Indexed the same way the Sleeper match is: a pinned sleeperId beats a
// normalized name+position, and an ambiguous name is skipped rather than
// guessed at. Same rule, same reason — a wrong match writes one player's
// injury onto another's profile.
function buildOverrideIndex(diagnostics) {
  const byKey = new Map();
  const bySleeperId = new Map();

  let file;
  try {
    file = readOverrides();
  } catch (e) {
    diagnostics.overrideErrors.push(`injury-overrides.json is not valid JSON: ${e.message}`);
    return { byKey, bySleeperId };
  }

  const { fileError, rows } = validateOverrides(file);
  if (fileError) {
    diagnostics.overrideErrors.push(fileError);
    return { byKey, bySleeperId };
  }

  for (const row of rows) {
    if (row.errors.length) {
      row.errors.forEach(e => diagnostics.overrideErrors.push(e));
      continue;
    }
    if (row.expired) {
      diagnostics.overridesExpired.push(
        `${row.entry.player}: "${row.entry.status}" expired ${daysAgo(row.expiresAt)}d ago — the feed has him back`
      );
      continue;
    }
    const record = { entry: row.entry, claimed: false };
    const key = `${normalizeName(row.entry.player)}|${row.entry.pos}`;
    // The validator dedupes on the raw name; two spellings of one name
    // ("Amon-Ra St. Brown" / "AmonRa St Brown") pass it and collide only here.
    if (byKey.has(key)) {
      diagnostics.overrideErrors.push(`${row.entry.player} (${row.entry.pos}): a second live override resolves to the same player`);
      continue;
    }
    byKey.set(key, record);
    if (row.entry.sleeperId) bySleeperId.set(String(row.entry.sleeperId), record);
  }

  return { byKey, bySleeperId };
}

function takeOverride(index, player) {
  const record = (player.sleeperId && index.bySleeperId.get(String(player.sleeperId)))
    || index.byKey.get(`${normalizeName(player.name)}|${player.pos}`);
  if (!record) return null;
  record.claimed = true;
  return record.entry;
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
    recordFetchFailure('Sleeper trending', e.message);
    return null;
  }
}

// ===== FETCH FAILURES =====
// A source that fails must not leave the run looking successful. ESPN started
// 403ing this script and every run afterwards reported "News articles cached:
// 0" and exited zero, so the news feed was frozen for weeks with nothing
// anywhere saying so. Failures are recorded here, written to meta.json, and
// turned into a red run by scripts/check-feeds.js at the end of the Action —
// late enough that a dead news API cannot block the day's stats.
const fetchFailures = [];
function recordFetchFailure(source, message) {
  log(`ERROR fetching ${source}: ${message}`);
  fetchFailures.push({ source, message, at: new Date().toISOString() });
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
    recordFetchFailure('ESPN news', e.message);
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
  meta.fetchFailures = fetchFailures;
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
