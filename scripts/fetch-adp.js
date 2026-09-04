#!/usr/bin/env node

/**
 * The Signal — Average draft position
 *
 * Produces data/adp.json from Fantasy Football Calculator's public API.
 *
 * The format is pinned to the one the projection set already declares —
 * Half-PPR, 12 team — because comparing a rank built for that format
 * against ADP from a different one is a comparison of nothing.
 *
 * This is ONE site's consensus, not "the market". It is thousands of real
 * mock drafts, which is the best free signal available, but it skews toward
 * people who mock draft in August. The page says so.
 *
 * Runs daily — ADP moves every day of draft season, which is the whole
 * point of the board it feeds.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { USER_AGENT } = require('./lib/agent');
const seasonLib = require('./lib/season');
const { writeJSONIfChanged } = require('./lib/write');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA_DIR, 'adp.json');
const TEAMS = 12;
const FORMAT = 'half-ppr';
let SEASON = 2026;   // set from the live calendar in main()

// ADP IS A DRAFT ARTEFACT. Once the season starts the mock-draft feed stops
// describing anything a reader can act on: the drafts are done, the market has
// closed, and a Value Board still comparing ranks to it is describing an
// argument nobody is having any more. Rather than keep overwriting the file
// with a feed that is now meaningless, the last preseason board is FROZEN and
// stamped as historical, so the page can label it honestly instead of implying
// it is live.
// Below this the feed has changed shape or the season has not started; a
// near-empty board is worse than yesterday's.
const MIN_PLAYERS = 100;
// A player drafted in only a handful of mocks has an ADP built on noise.
const MIN_DRAFTS = 5;

const log = (m) => console.log(`[adp] ${m}`);

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(`bad JSON: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  const st = await seasonLib.state();
  SEASON = st.season;
  // THE MARKET CLOSES AT KICKOFF, NOT AT THE CALENDAR FLAG. `phase` turns
  // "regular" up to eleven days before anyone plays, and people draft right up
  // to the first game — freezing on the flag threw away the most active week of
  // the mock-draft market and stamped the board "drafts are over" while they
  // were still going on. This was the last script reading the flag directly;
  // see gamesHaveStarted() in lib/season.js for what the rest of them ask.
  if (await seasonLib.isInSeason()) {
    const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
    if (existing) {
      existing.meta.historical = true;
      existing.meta.closedAt = existing.meta.closedAt || new Date().toISOString();
      existing.meta.closedNote = `Drafts are over. This board is the last preseason snapshot and `
        + `is kept as history, not as a live market. Season ${st.season} began before this run.`;
      writeJSONIfChanged(OUT, existing);
      log('season has started — froze the board and marked it historical. Not refetching.');
    } else {
      log('season has started and there is no board on file; nothing to freeze.');
    }
    return;
  }

  const url = `https://fantasyfootballcalculator.com/api/v1/adp/${FORMAT}?teams=${TEAMS}&year=${SEASON}`;
  log(`Fetching ${FORMAT} / ${TEAMS}-team / ${SEASON}...`);
  let json;
  try {
    json = await fetchJSON(url);
  } catch (e) {
    log(`ABORT: fetch failed (${e.message}). Keeping existing adp.json.`);
    process.exit(1);
  }

  const src = Array.isArray(json.players) ? json.players : [];
  const players = src
    .filter(p => p && p.name && typeof p.adp === 'number'
      && (p.times_drafted || 0) >= MIN_DRAFTS
      && ['QB', 'RB', 'WR', 'TE'].includes(p.position))
    .map(p => ({
      name: p.name,
      pos: p.position,
      team: p.team || null,
      adp: Math.round(p.adp * 10) / 10,
      stdev: typeof p.stdev === 'number' ? Math.round(p.stdev * 10) / 10 : null,
      timesDrafted: p.times_drafted || 0
    }))
    .sort((a, b) => a.adp - b.adp);

  if (players.length < MIN_PLAYERS) {
    log(`ABORT: only ${players.length} usable players (need ${MIN_PLAYERS}). Keeping existing adp.json.`);
    process.exit(1);
  }

  const meta = json.meta || {};
  const out = {
    meta: {
      source: 'Fantasy Football Calculator',
      sourceUrl: 'https://fantasyfootballcalculator.com/adp',
      format: meta.type || 'Half-PPR',
      teams: meta.teams || TEAMS,
      season: SEASON,
      totalDrafts: meta.total_drafts || null,
      windowStart: meta.start_date || null,
      fetchedAt: new Date().toISOString(),
      minDrafts: MIN_DRAFTS,
      note: 'Consensus from one site\'s mock drafts, not the whole market.'
    },
    players
  };

  writeJSONIfChanged(OUT, out);
  log(`Wrote data/adp.json: ${players.length} players from ${out.meta.totalDrafts || '?'} drafts ` +
      `since ${out.meta.windowStart || '?'}`);
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
