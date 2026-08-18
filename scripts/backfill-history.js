#!/usr/bin/env node
/**
 * backfill-history.js — the history we already have and did not know it
 *
 * The daily Action has been overwriting data/*.json and committing the result
 * since May. Every one of those commits is a dated snapshot sitting in git, so
 * the series build-history.js starts collecting today can be extended backwards
 * for free — no refetching, no third-party archive, just reading our own repo.
 *
 * Coverage is uneven and that is honest: players.json goes back to 2026-05-27,
 * adp.json only to 2026-08-16 because that is when it was added. The backfill
 * writes what exists and says what it could not reach.
 *
 * ONE-OFF, and deliberately not in the daily Action: it rewrites whole files
 * from git rather than appending, so running it daily would be a slow no-op that
 * could clobber a good series if git history were ever rewritten.
 *
 *   node scripts/backfill-history.js --dry
 *   node scripts/backfill-history.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HIST = path.join(ROOT, 'data', 'history');

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 }).toString();
}

function normalize(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.'’-]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}

/** Every commit that touched a file, oldest first, one per calendar day. */
function snapshots(file) {
  const log = git(['log', '--format=%H|%ad', '--date=short', '--reverse', '--', file])
    .trim().split('\n').filter(Boolean);
  const byDate = new Map();
  for (const line of log) {
    const [sha, date] = line.split('|');
    byDate.set(date, sha);   // last commit of a day wins — it is the day's final state
  }
  return [...byDate.entries()].map(([date, sha]) => ({ date, sha }));
}

function readAt(sha, file) {
  try {
    return JSON.parse(git(['show', `${sha}:${file}`]));
  } catch (e) {
    return null;   // the file may not have existed at that commit
  }
}

function write(file, rows, dry) {
  if (dry) return;
  fs.mkdirSync(HIST, { recursive: true });
  fs.writeFileSync(path.join(HIST, file), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
}

function main() {
  const dry = process.argv.includes('--dry');
  console.log(`[backfill] reading the repo's own history${dry ? ' (dry run)' : ''}\n`);

  // ---- Status changes, from players.json ---------------------------------
  const poolSnaps = snapshots('data/players.json');
  console.log(`players.json: ${poolSnaps.length} daily snapshots, ${poolSnaps[0]?.date} → ${poolSnaps[poolSnaps.length - 1]?.date}`);

  const statusRows = [];
  const state = new Map();
  let poolRead = 0;
  for (const { date, sha } of poolSnaps) {
    const pool = readAt(sha, 'data/players.json');
    if (!Array.isArray(pool)) continue;
    poolRead++;
    const seen = new Set();
    for (const p of pool) {
      seen.add(p.id);
      const prev = state.get(p.id);
      if (prev === p.status) continue;
      statusRows.push({
        date, id: p.id, name: p.name, team: p.team,
        from: prev === undefined ? null : prev,
        to: p.status,
        statusClass: p.statusClass,
        provenance: p.statusSource === 'override' ? 'override' : 'feed',
        first: prev === undefined || undefined,
        backfilled: true,
      });
      state.set(p.id, p.status);
    }
    for (const id of [...state.keys()]) {
      if (!seen.has(id) && state.get(id) !== '__left__') {
        statusRows.push({ date, id, from: state.get(id), to: '__left__', note: 'dropped out of the pool', backfilled: true });
        state.set(id, '__left__');
      }
    }
  }
  const realChanges = statusRows.filter(r => !r.first && r.to !== '__left__').length;
  console.log(`  → ${statusRows.length} entries (${realChanges} real status changes) from ${poolRead} readable snapshots`);
  write('status.jsonl', statusRows, dry);

  // ---- Numeric series -----------------------------------------------------
  // The pool at each commit is the name→id map for that same day. Using today's
  // pool for a May snapshot would drop everyone who has since left it.
  const series = [
    {
      file: 'data/adp.json', out: 'adp.jsonl',
      extract: (json, byName) => {
        const values = {};
        for (const row of json.players || []) {
          const id = byName.get(normalize(row.name));
          if (id) values[id] = Number(row.adp);
        }
        return Object.keys(values).length ? { source: json.meta && json.meta.source, values } : null;
      },
    },
    {
      file: 'data/rankings.json', out: 'rankings.jsonl',
      extract: (json, byName) => {
        const values = {};
        for (const pos of ['qb', 'rb', 'wr', 'te']) {
          for (const row of json[pos] || []) {
            const id = byName.get(normalize(row.name));
            if (id) values[id] = [row.rank, row.median, row.floor, row.ceiling];
          }
        }
        return Object.keys(values).length
          ? { format: json.meta && json.meta.format, fields: ['rank', 'median', 'floor', 'ceiling'], values }
          : null;
      },
    },
  ];

  for (const s of series) {
    const snaps = snapshots(s.file);
    const rows = [];
    for (const { date, sha } of snaps) {
      const json = readAt(sha, s.file);
      if (!json) continue;
      const pool = readAt(sha, 'data/players.json');
      if (!Array.isArray(pool)) continue;
      const byName = new Map(pool.map(p => [normalize(p.name), p.id]));
      const line = s.extract(json, byName);
      if (line) rows.push({ date, ...line, backfilled: true });
    }
    console.log(`${s.file}: ${snaps.length} snapshots → ${rows.length} days recovered`
      + (rows.length ? ` (${rows[0].date} → ${rows[rows.length - 1].date})` : ''));
    write(s.out, rows, dry);
  }

  console.log('\nFrom here build-history.js appends one line a day. The gaps above are'
    + '\npermanent — they are days that were overwritten before anyone kept them.');
}

main();
