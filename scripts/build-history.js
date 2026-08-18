#!/usr/bin/env node
/**
 * build-history.js — the part of the moat that only exists if we start keeping it
 *
 * Every other data file here answers "what is true today". The daily Action then
 * overwrites it, so nobody — including us — can answer "what did this look like
 * three weeks ago". That is the one question a competitor with the same public
 * feeds genuinely cannot answer, and the only thing standing between us and
 * owning it is remembering to append a line a day.
 *
 * WHY JSONL AND NOT A GROWING JSON OBJECT
 * A rewritten object makes the whole file a diff every morning, so the repo
 * carries a fresh copy of the entire series 365 times a year. One appended line
 * per day is one line of diff. The files are meant to be read with
 * readFileSync().trim().split('\n').map(JSON.parse), which is cheap at this size.
 *
 * WHAT IS RECORDED, AND WHAT IS NOT
 * Series that move continuously (ADP, ranks, projections) get one line a day.
 * Status is an EVENT, not a series: 286 of 350 players are healthy and writing
 * "still healthy" 350 times a day would bury the ten lines that matter. Only
 * changes are logged, against the state replayed from the log itself.
 *
 * IDEMPOTENT. A second run on the same day replaces that day's line rather than
 * appending a duplicate — the Action can be re-dispatched by hand and often is.
 *
 *   node scripts/build-history.js
 *   node scripts/build-history.js --dry
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const HIST = path.join(DATA, 'history');

// If a name-format change on either side breaks the join, the series would go
// on being written — just empty — and nobody would notice until the history was
// worthless. A collapse in match rate fails the run instead.
const MIN_MATCH_RATE = 0.7;

const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

function normalize(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.'’-]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}

function readLines(file) {
  const p = path.join(HIST, file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

/** Append, or replace today's line if the script already ran today. */
function upsertDay(file, date, line, dry) {
  const rows = readLines(file).filter(r => r.date !== date);
  rows.push(line);
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const out = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  if (!dry) {
    fs.mkdirSync(HIST, { recursive: true });
    fs.writeFileSync(path.join(HIST, file), out);
  }
  return rows.length;
}

function main() {
  const dry = process.argv.includes('--dry');
  const date = new Date().toISOString().slice(0, 10);

  const pool = read('players.json');
  const byName = new Map();
  for (const p of pool) byName.set(normalize(p.name), p.id);
  const inPool = new Set(pool.map(p => p.id));

  const report = [];

  // ---- ADP ----------------------------------------------------------------
  const adp = read('adp.json');
  const adpValues = {};
  let adpMatched = 0;
  for (const row of adp.players || []) {
    const id = byName.get(normalize(row.name));
    if (!id) continue;
    adpMatched++;
    // Two decimals is the precision the source publishes; keeping more would
    // record noise as if it were movement.
    adpValues[id] = Number(row.adp);
  }
  const adpRate = adp.players.length ? adpMatched / adp.players.length : 0;
  if (adpRate < MIN_MATCH_RATE) {
    throw new Error(`ADP join collapsed: ${adpMatched}/${adp.players.length} matched (${(adpRate * 100).toFixed(0)}%). `
      + 'A silently empty series is worse than a failed run.');
  }
  const adpCount = upsertDay('adp.jsonl', date, { date, source: adp.meta.source, values: adpValues }, dry);
  report.push(`adp        ${adpMatched}/${adp.players.length} players → ${adpCount} days on file`);

  // ---- Ranks and projections ---------------------------------------------
  // [rank, median, floor, ceiling] — an array, not an object, because the key
  // names would be 80% of the bytes at this width.
  const ranks = read('rankings.json');
  const rankValues = {};
  let rankMatched = 0, rankTotal = 0;
  for (const pos of ['qb', 'rb', 'wr', 'te']) {
    for (const row of ranks[pos] || []) {
      rankTotal++;
      const id = byName.get(normalize(row.name));
      if (!id) continue;
      rankMatched++;
      rankValues[id] = [row.rank, row.median, row.floor, row.ceiling];
    }
  }
  const rankRate = rankTotal ? rankMatched / rankTotal : 0;
  if (rankRate < MIN_MATCH_RATE) {
    throw new Error(`Rankings join collapsed: ${rankMatched}/${rankTotal} matched (${(rankRate * 100).toFixed(0)}%).`);
  }
  const rankCount = upsertDay('rankings.jsonl', date,
    { date, format: ranks.meta.format, fields: ['rank', 'median', 'floor', 'ceiling'], values: rankValues }, dry);
  report.push(`rankings   ${rankMatched}/${rankTotal} players → ${rankCount} days on file`);

  // ---- Status changes -----------------------------------------------------
  // Replayed from the log rather than kept in a side file: one artefact to keep
  // consistent instead of two, and the log is the thing we actually care about.
  const statusLog = readLines('status.jsonl');
  const state = new Map();
  for (const e of statusLog) {
    if (e.date === date) continue;   // today's entries get recomputed below
    state.set(e.id, e.to);
  }

  const changes = [];
  for (const p of pool) {
    const prev = state.get(p.id);
    if (prev === p.status) continue;
    changes.push({
      date, id: p.id, name: p.name, team: p.team,
      from: prev === undefined ? null : prev,
      to: p.status,
      statusClass: p.statusClass,
      provenance: p.statusSource === 'override' ? 'override' : 'feed',
      // A first sighting is not a status change — it is us starting to watch.
      first: prev === undefined || undefined,
    });
  }

  // Players who left the pool: recorded once so the series does not simply stop
  // with no explanation.
  for (const id of state.keys()) {
    if (!inPool.has(id) && state.get(id) !== '__left__') {
      changes.push({ date, id, from: state.get(id), to: '__left__', note: 'dropped out of the pool' });
    }
  }

  let statusCount = statusLog.length;
  if (changes.length) {
    const kept = statusLog.filter(e => e.date !== date);
    const rows = kept.concat(changes);
    statusCount = rows.length;
    if (!dry) {
      fs.mkdirSync(HIST, { recursive: true });
      fs.writeFileSync(path.join(HIST, 'status.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    }
  }
  const real = changes.filter(c => !c.first && c.to !== '__left__').length;
  report.push(`status     ${changes.length} entries today (${real} real changes, ${changes.length - real} first sightings/exits) → ${statusCount} total`);

  console.log(`[history] ${date}${dry ? ' (dry run — nothing written)' : ''}`);
  for (const line of report) console.log('  ' + line);
  if (real) {
    for (const c of changes.filter(x => !x.first && x.to !== '__left__').slice(0, 10)) {
      console.log(`    ${c.name}: ${c.from} → ${c.to}`);
    }
  }
}

try {
  main();
} catch (e) {
  console.error('[history] FAILED:', e.message);
  process.exit(1);
}
