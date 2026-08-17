#!/usr/bin/env node

/**
 * The Signal — Player Pool Builder
 *
 * Generates data/players.json (the site's player pool) from three layers:
 *
 *   1. GENERATED BASE — top ~200 fantasy-relevant players from the Sleeper
 *      player DB (QB/RB/WR/TE, active, on a roster, ranked by search_rank).
 *      Supplies: name, pos, team, age, height, weight, college, experience,
 *      sleeperId, gsisId, initials, color.
 *   2. STATUS CARRY-OVER — status fields from the CURRENT players.json.
 *      update-data.js owns statuses (including manualOverride notes);
 *      regeneration must never clobber what it wrote.
 *   3. CURATED OVERLAY — data/players-curated.json. Hand-written profiles
 *      (athletic percentiles, college production, pro comps) win on every
 *      field they define. Curated players stay in the pool forever.
 *
 * fRank comes from data/rankings.json (positional rank), matched by
 * normalized name + position. Ambiguous or missing → null, never guessed.
 *
 * Daily Action order: build-players → update-data → fetch-stats.
 * Run manually: node scripts/build-players.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_DIR = path.join(__dirname, '..', 'data');
const POOL_TARGET = 350;
// If the Sleeper feed returns something absurdly small, the feed is broken.
// Keep yesterday's file rather than shipping a gutted pool.
const POOL_FLOOR = 100;
// How many search_rank places being in yesterday's pool is worth. Big enough
// to absorb the day-to-day jitter at the cutoff, small enough that a player
// genuinely climbing still takes the spot.
const STICKY_RANKS = 40;
const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

function log(msg) {
  console.log(`[players] ${msg}`);
}

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
    req.setTimeout(60000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
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

// Same normalization as update-data.js — the two must agree or a player
// matched by one script is unmatched by the other.
function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/[-‐-―]/g, ' ')
    .split(/\s+/)
    .filter(t => t && !NAME_SUFFIXES.has(t))
    .join(' ')
    .trim();
}

// ===== GENERATED FIELDS =====

function formatHeight(h) {
  if (h === null || h === undefined || h === '') return null;
  const s = String(h).trim();
  if (/^\d{2,3}$/.test(s)) {           // inches, e.g. "74"
    const inches = parseInt(s, 10);
    if (inches < 60 || inches > 90) return null;
    return `${Math.floor(inches / 12)}-${inches % 12}`;
  }
  if (/^\d[-'′]\d{1,2}/.test(s)) {     // already feet-inches, e.g. "6-2"
    return s.replace(/['′]/, '-').replace(/"$/, '');
  }
  return null;                          // unparseable → empty beats wrong
}

function ordinal(n) {
  const rem = n % 100;
  if (rem >= 11 && rem <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

function experienceLabel(yearsExp) {
  if (yearsExp === null || yearsExp === undefined || isNaN(yearsExp)) return null;
  if (yearsExp === 0) return 'Rookie';
  return `${ordinal(yearsExp + 1)} Year`;
}

function initialsFor(name) {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

// Deterministic avatar gradient — same player, same color, every build.
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#1e3a5f,#2563eb)',
  'linear-gradient(135deg,#4a2c1a,#b45309)',
  'linear-gradient(135deg,#1a3a2c,#059669)',
  'linear-gradient(135deg,#3b1f47,#7c3aed)',
  'linear-gradient(135deg,#451a1a,#dc2626)',
  'linear-gradient(135deg,#1f3547,#0891b2)',
  'linear-gradient(135deg,#3d3517,#ca8a04)',
  'linear-gradient(135deg,#2d2d35,#64748b)'
];

function colorFor(sleeperId) {
  let hash = 0;
  const s = String(sleeperId);
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

// Sleeper's one-word injury status → the site's status vocabulary. Shared with
// update-data.js, which owns statuses from here on, so a brand-new player
// starts on exactly the wording the next run would give him.
const { formatStatus } = require('./lib/status');

// Fields update-data.js owns. Carried from the current players.json so a
// rebuild never erases a status, its provenance, or a manual note.
const STATUS_FIELDS = ['status', 'statusClass', 'statusSource', 'statusUpdated', 'manualOverride', 'statusSetAt'];

// Fields the curated overlay is NOT allowed to set — they drift (trades,
// birthdays, feed statuses) and freezing them in a hand file caused exactly
// the class of bug the CLAUDE.md rules exist to prevent.
// color and initials are DERIVED on the site from sleeperId and name, so a
// stored copy would only disagree with the derived one — and it did: a
// curated player rendered one gradient before players-detail.json loaded and
// a different one after.
const OVERLAY_BLOCKED = new Set([...STATUS_FIELDS, 'team', 'age', 'fRank', 'color', 'initials']);

// players.json is fetched on EVERY page view, so it carries only what the
// site needs before anyone opens a profile — plus the few fields the
// pipeline scripts join on (gsisId, experience). Everything else goes to
// players-detail.json, loaded once when a profile is actually opened.
// Splitting this is what lets the pool grow without the payload growing:
// 350 players of core costs about what 200 players of everything did.
const CORE_FIELDS = [
  'id', 'name', 'pos', 'team', 'age', 'fRank', 'sleeperId', 'gsisId', 'experience',
  ...STATUS_FIELDS
];

// ===== fRank FROM RANKINGS =====
function buildFRankIndex(rankings) {
  const index = new Map();   // "normalizedname|POS" -> "WR3" (or null if ambiguous)
  if (!rankings) return index;
  for (const tab of ['qb', 'rb', 'wr', 'te']) {
    const list = rankings[tab];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || !entry.name || typeof entry.rank !== 'number') continue;
      const pos = tab.toUpperCase();
      const key = `${normalizeName(entry.name)}|${pos}`;
      if (index.has(key)) {
        // Two ranked players collapse to the same key — rank neither.
        log(`  fRank ambiguous, skipping: ${entry.name} (${pos})`);
        index.set(key, null);
      } else {
        index.set(key, `${pos}${entry.rank}`);
      }
    }
  }
  return index;
}

// ===== ID ASSIGNMENT =====
function slugify(s) {
  return normalizeName(s).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function assignId(sp, takenIds) {
  const last = slugify(sp.last_name || '');
  const first = slugify(sp.first_name || '');
  const candidates = [
    last,
    `${last}-${first.charAt(0)}`,
    `${last}-${first}`,
    `${last}-${sp.player_id}`
  ].filter(Boolean);
  for (const c of candidates) {
    if (c && !takenIds.has(c)) { takenIds.add(c); return c; }
  }
  const fallback = `p${sp.player_id}`;
  takenIds.add(fallback);
  return fallback;
}

// ===== MAIN =====
async function main() {
  log('Fetching Sleeper player database...');
  let sleeperPlayers;
  try {
    sleeperPlayers = await fetchJSON('https://api.sleeper.app/v1/players/nfl');
  } catch (e) {
    log(`ABORT: Sleeper fetch failed (${e.message}) — players.json left untouched`);
    process.exit(1);
  }

  const current = readJSON('players.json') || [];
  const curatedFile = readJSON('players-curated.json');
  const curated = (curatedFile && Array.isArray(curatedFile.players)) ? curatedFile.players : [];
  const rankings = readJSON('rankings.json');
  const fRankIndex = buildFRankIndex(rankings);

  const currentBySleeperId = new Map(current.filter(p => p.sleeperId).map(p => [String(p.sleeperId), p]));
  const curatedBySleeperId = new Map(curated.filter(p => p.sleeperId).map(p => [String(p.sleeperId), p]));

  // --- Select the pool: top N by search_rank + every curated player ---
  // depth_chart_order is the "actually on a roster" check. Sleeper never
  // cleaned up some retired players (Roethlisberger: active, PIT, ranked 176,
  // last news 2022) — but only rostered players sit on a depth chart.
  const candidates = Object.values(sleeperPlayers).filter(sp =>
    sp && sp.player_id && POSITIONS.has(sp.position) && sp.team &&
    sp.active === true && typeof sp.search_rank === 'number' && sp.search_rank < 9999999 &&
    sp.depth_chart_order !== null && sp.depth_chart_order !== undefined
  );

  // Incumbency bonus. A hard cut at rank 350 means anyone hovering near the
  // boundary enters and leaves as Sleeper's search_rank jitters, and each
  // exit deletes his weekly shard and each return rebuilds it — one daily run
  // churned about twenty players for no real reason.
  //
  // Being in yesterday's pool is worth STICKY_RANKS places, so a player has
  // to fall meaningfully past the cutoff before he is dropped, while anyone
  // genuinely climbing still displaces him. The pool stays exactly
  // POOL_TARGET; this only changes who sits at the bottom of it.
  const incumbent = new Set(current.filter(p => p.sleeperId).map(p => String(p.sleeperId)));
  const effectiveRank = (sp) =>
    sp.search_rank - (incumbent.has(String(sp.player_id)) ? STICKY_RANKS : 0);
  candidates.sort((a, b) => effectiveRank(a) - effectiveRank(b) || a.search_rank - b.search_rank);

  const pool = new Map();  // sleeperId -> sleeper record
  for (const sp of candidates.slice(0, POOL_TARGET)) pool.set(String(sp.player_id), sp);
  for (const sleeperId of curatedBySleeperId.keys()) {
    if (!pool.has(sleeperId) && sleeperPlayers[sleeperId]) pool.set(sleeperId, sleeperPlayers[sleeperId]);
  }

  if (pool.size < POOL_FLOOR) {
    log(`ABORT: pool of ${pool.size} is below floor ${POOL_FLOOR} — feed looks broken, players.json left untouched`);
    process.exit(1);
  }

  const dropped = [...incumbent].filter(id => !pool.has(id));
  const gained = [...pool.keys()].filter(id => !incumbent.has(id));
  log(`pool churn: ${gained.length} in, ${dropped.length} out (incumbency worth ${STICKY_RANKS} ranks)`);

  // IDs already in use stay stable (profile links, medicals.json keys).
  const takenIds = new Set([...current.map(p => p.id), ...curated.map(p => p.id)]);

  let added = 0, carried = 0, ranked = 0;
  const players = [];

  for (const [sleeperId, sp] of pool) {
    const existing = currentBySleeperId.get(sleeperId);
    const overlay = curatedBySleeperId.get(sleeperId);
    const name = sp.full_name || `${sp.first_name || ''} ${sp.last_name || ''}`.trim();

    // 1. Generated base
    const base = {
      id: (overlay && overlay.id) || (existing && existing.id) || assignId(sp, takenIds),
      name,
      pos: sp.position,
      team: sp.team,
      age: (typeof sp.age === 'number' && sp.age > 0) ? sp.age : null,
      height: formatHeight(sp.height),
      weight: (sp.weight && !isNaN(parseInt(sp.weight, 10))) ? parseInt(sp.weight, 10) : null,
      college: sp.college || null,
      experience: experienceLabel(sp.years_exp),
      sleeperId,
      gsisId: (sp.gsis_id && String(sp.gsis_id).trim()) || null,
      fRank: null,
      // Status seed — overwritten below if update-data.js already owns one.
      status: 'Healthy',
      statusClass: 'status-healthy',
      statusSource: 'sleeper'
    };
    const seeded = sp.injury_status && formatStatus(sp.injury_status, sp.injury_body_part);
    if (seeded) {
      base.status = seeded.status;
      base.statusClass = seeded.statusClass;
    }

    // 2. Status carry-over from the current file
    if (existing) {
      for (const f of STATUS_FIELDS) {
        if (existing[f] !== undefined) base[f] = existing[f];
      }
      carried++;
    } else {
      added++;
    }

    // 3. Curated overlay wins on everything it defines (except drift fields)
    if (overlay) {
      for (const [k, v] of Object.entries(overlay)) {
        if (!OVERLAY_BLOCKED.has(k)) base[k] = v;
      }
    }

    // fRank from rankings — exact unique match or nothing
    const fRank = fRankIndex.get(`${normalizeName(name)}|${sp.position}`);
    if (fRank) { base.fRank = fRank; ranked++; }

    players.push({ player: base, searchRank: sp.search_rank });
  }

  players.sort((a, b) => a.searchRank - b.searchRank);
  const out = players.map(p => p.player);

  const core = out.map(p => Object.fromEntries(
    CORE_FIELDS.filter(k => p[k] !== undefined).map(k => [k, p[k]])));
  const detail = {};
  for (const p of out) {
    const d = Object.fromEntries(Object.entries(p).filter(([k]) => !CORE_FIELDS.includes(k)));
    if (Object.keys(d).length) detail[p.id] = d;
  }

  writeJSON('players.json', core);
  writeJSON('players-detail.json', detail);
  const kb = (f) => (fs.statSync(path.join(DATA_DIR, f)).size / 1024).toFixed(0);
  log(`Wrote players.json: ${core.length} players (${carried} carried over, ${added} new, ${ranked} with fRank, ${curated.length} curated overlays)`);
  log(`  players.json        ${kb('players.json')}KB (core, on init)`);
  log(`  players-detail.json ${kb('players-detail.json')}KB (profile fields, lazy)`);
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
