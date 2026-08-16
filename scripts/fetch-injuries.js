#!/usr/bin/env node

/**
 * The Signal — Official injury report history
 *
 * Produces data/injuries.json from nflverse's `injuries` release, which is
 * the NFL's own weekly injury report: practice participation, game status,
 * and body part, per player per week.
 *
 * Why this exists: the hand-written medical database covers ~30 players and
 * will never cover 200. This is the generated layer underneath it — every
 * player in the pool gets a real, sourced injury history, and the curated
 * profiles stay the deep reporting on top. It is a RECORD, not analysis: it
 * says what the team reported, nothing more.
 *
 * Matching uses the shared matcher (GSIS id first, then normalized name +
 * position). Sleeper only supplies a gsis_id for about a fifth of the pool,
 * so the name fallback is doing most of the work here, same as fetch-stats.
 *
 * Runs in the daily Action after fetch-stats.
 *   node scripts/fetch-injuries.js
 */

const fs = require('fs');
const path = require('path');
const { fetchCSV, parseCSV, buildMatchIndex, matchRow } = require('./lib/match');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SEASONS = [2023, 2024, 2025];   // keep in step with fetch-stats.js
const OUT = path.join(DATA_DIR, 'injuries.json');
// Below this the feed or the schema has moved and the file would be a
// quietly emptied version of something real.
const MATCH_FLOOR = 60;
// Every season must contribute. Checking only the total let 2023 and 2024
// match zero rows while the run still reported success.
const SEASON_MATCH_FLOOR = 100;

const URL = s => `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${s}.csv`;

function log(msg) { console.log(`[injuries] ${msg}`); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// The report and the practice sheet each name a body part; the report is the
// authoritative one, so it wins where both are present.
function bodyPart(row) {
  const v = (row.report_primary_injury || row.practice_primary_injury || '').trim();
  return v || null;
}

// Weeks are grouped into episodes by body part: consecutive report weeks
// naming the same part are one injury, a gap or a different part starts a
// new one. A player listed for a shoulder in weeks 4-6 reads as one episode,
// not three.
function buildEpisodes(weeks) {
  const sorted = [...weeks].sort((a, b) => a.week - b.week);
  const episodes = [];
  let cur = null;
  for (const w of sorted) {
    const part = w.part || 'Undisclosed';
    if (cur && cur.part === part && w.week <= cur.lastWeek + 1) {
      cur.lastWeek = w.week;
      cur.weeks.push(w.week);
    } else {
      cur = { part, firstWeek: w.week, lastWeek: w.week, weeks: [w.week], out: 0, statuses: new Set() };
      episodes.push(cur);
    }
    if (w.status) cur.statuses.add(w.status);
    if (w.status === 'Out') cur.out++;
  }
  return episodes.map(e => ({
    part: e.part,
    firstWeek: e.firstWeek,
    lastWeek: e.lastWeek,
    weeks: e.weeks.length,
    // Weeks the team declared him Out. Distinct from weeks listed: most
    // report appearances are a Questionable tag he plays through.
    gamesOut: e.out,
    statuses: [...e.statuses]
  }));
}

async function main() {
  log('=== Injury Report Pipeline Start ===');
  const players = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'players.json'), 'utf8'));
  const index = buildMatchIndex(
    players.map(p => ({ id: p.id, name: p.name, pos: p.pos, gsisId: p.gsisId || null })), log);

  const perPlayer = {};   // id -> season -> { weeks: [] }
  let matchedRows = 0;

  for (let i = 0; i < SEASONS.length; i++) {
    const season = SEASONS[i];
    if (i > 0) await delay(2000);
    log(`Fetching ${season} injury reports...`);
    let rows;
    try {
      rows = parseCSV(await fetchCSV(URL(season)));
    } catch (e) {
      // A season that vanishes must fail the run. A per-season catch here is
      // exactly how the 2025 stats file stayed a year stale for months.
      log(`ABORT: ${season} fetch failed (${e.message}). Keeping existing injuries.json.`);
      process.exit(1);
    }

    let used = 0;
    for (const r of rows) {
      // The schema is not stable across seasons: 2025 carries season_type,
      // 2024 and earlier only carry game_type. Reading one of them alone
      // silently drops every row of the other years — it dropped 2023 and
      // 2024 entirely on the first run and still wrote a plausible file.
      const kind = r.season_type || r.game_type;
      if (kind !== 'REG') continue;
      const p = matchRow(index, { gsis: r.gsis_id, name: r.full_name, pos: r.position });
      if (!p) continue;
      const status = (r.report_status || '').trim() || null;
      const part = bodyPart(r);
      // A row with neither a status nor a body part carries no information.
      if (!status && !part) continue;
      if (!perPlayer[p.id]) perPlayer[p.id] = {};
      if (!perPlayer[p.id][season]) perPlayer[p.id][season] = [];
      perPlayer[p.id][season].push({ week: r.week, part, status });
      used++;
    }
    log(`  ${rows.length} rows, ${used} matched to the pool`);
    // Per-season, not just in total: a whole season matching nothing is a
    // schema change, and a total-only check happily passes while two thirds
    // of the history is missing.
    if (used < SEASON_MATCH_FLOOR) {
      log(`ABORT: ${season} matched only ${used} rows (expected at least ${SEASON_MATCH_FLOOR}). ` +
          `The schema for that season has moved. Keeping existing injuries.json.`);
      process.exit(1);
    }
    matchedRows += used;
  }

  const out = {};
  for (const [pid, seasons] of Object.entries(perPlayer)) {
    out[pid] = {};
    for (const [season, weeks] of Object.entries(seasons)) {
      const episodes = buildEpisodes(weeks);
      out[pid][season] = {
        weeksListed: weeks.length,
        gamesOut: weeks.filter(w => w.status === 'Out').length,
        episodes
      };
    }
  }

  const players_with = Object.keys(out).length;
  if (players_with < MATCH_FLOOR || matchedRows === 0) {
    log(`ABORT: only ${players_with} players / ${matchedRows} rows matched — a feed or schema moved. Keeping existing injuries.json.`);
    process.exit(1);
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  log(`Wrote data/injuries.json: ${players_with} players, ${kb}KB`);
  log('=== Injury Report Pipeline Complete ===');
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
