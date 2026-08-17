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

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA_DIR, 'adp.json');
const TEAMS = 12;
const FORMAT = 'half-ppr';
const SEASON = 2026;
// Below this the feed has changed shape or the season has not started; a
// near-empty board is worse than yesterday's.
const MIN_PLAYERS = 100;
// A player drafted in only a handful of mocks has an ADP built on noise.
const MIN_DRAFTS = 5;

const log = (m) => console.log(`[adp] ${m}`);

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'TheSignal/1.0' } }, (res) => {
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

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  log(`Wrote data/adp.json: ${players.length} players from ${out.meta.totalDrafts || '?'} drafts ` +
      `since ${out.meta.windowStart || '?'}`);
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
