#!/usr/bin/env node

/**
 * Validate data/injury-overrides.json — run it after editing the file, and as
 * the last step of the daily Action.
 *
 *   node scripts/check-overrides.js
 *
 * Exits non-zero on a broken or unmatched entry. That matters because a bad
 * override fails SILENTLY at the site level: the file says a player is on PUP,
 * nothing applies it, and the page shows him healthy. The run has to go red or
 * nobody finds out. It runs LAST in the Action, after the data has been
 * committed, so a typo in a hand file can't block the day's real data.
 *
 * Expired entries are reported, not failed — expiry is the file working as
 * designed. Fix them by refreshing the report behind the entry or deleting it.
 */

const fs = require('fs');
const path = require('path');
const {
  OVERRIDES_FILE, DEFAULT_DURATION_DAYS, readOverrides, validateOverrides,
  parseDate, addDays, daysAgo,
} = require('./lib/overrides');
// The same normalizer update-data.js matches with, so this script agrees with
// the pipeline about what "matches" means instead of having its own opinion.
const { normalizeSleeperName: norm } = require('./lib/match');

const SCHEMA = `
data/injury-overrides.json

{
  "updated": "YYYY-MM-DD",
  "overrides": [
    {
      "player":      "Chris Olave",              // required, must match a player in the pool
      "pos":         "WR",                       // required
      "sleeperId":   "8144",                     // optional; pins the match, beats the name
      "status":      "PUP (Achilles)",           // required, shown on the site verbatim
      "statusClass": "status-out",               // required: status-healthy | status-quest | status-out
      "setAt":       "2026-08-17",               // required, the date the REPORT is from
      "expires":     "2026-09-07",               // optional, defaults to setAt + ${DEFAULT_DURATION_DAYS} days
      "source":      "ESPN, Aug 17 2026",        // required, no data without a source
      "note":        "why this beats the feed"   // optional, for the next human
    }
  ]
}

An override loses to a live feed escalation (IR / Out / PUP / NFI / Suspended /
Doubtful) and beats the feed otherwise.
`;

function main() {
  if (process.argv.includes('--schema') || process.argv.includes('--help')) {
    console.log(SCHEMA);
    return 0;
  }

  if (!fs.existsSync(OVERRIDES_FILE)) {
    console.error(`MISSING: ${OVERRIDES_FILE}`);
    console.error(SCHEMA);
    return 1;
  }

  let file;
  try {
    file = readOverrides();
  } catch (e) {
    console.error(`INVALID JSON: ${e.message}`);
    return 1;
  }

  const { fileError, rows } = validateOverrides(file);
  if (fileError) {
    console.error(`ERROR: ${fileError}`);
    return 1;
  }

  const errors = [];
  const expired = [];
  const live = [];

  for (const row of rows) {
    if (row.errors.length) { errors.push(...row.errors); continue; }
    if (row.expired) { expired.push(row); continue; }
    live.push(row);
  }

  // Cross-check every live entry against the actual pool. An entry that matches
  // nobody is the failure mode this script exists for.
  const playersPath = path.join(__dirname, '..', 'data', 'players.json');
  const players = fs.existsSync(playersPath) ? JSON.parse(fs.readFileSync(playersPath, 'utf8')) : null;
  if (!players) {
    errors.push('data/players.json not found — cannot check overrides against the pool');
  } else {
    for (const row of live) {
      const e = row.entry;
      const byId = e.sleeperId && players.find(p => String(p.sleeperId) === String(e.sleeperId));
      const byName = players.filter(p => norm(p.name) === norm(e.player) && p.pos === e.pos);
      if (byId) {
        if (byId.pos !== e.pos) errors.push(`${e.player}: sleeperId ${e.sleeperId} is ${byId.name} (${byId.pos}), not a ${e.pos}`);
        row.matched = byId;
      } else if (e.sleeperId) {
        errors.push(`${e.player}: sleeperId ${e.sleeperId} is not in the pool`);
      } else if (byName.length === 1) {
        row.matched = byName[0];
      } else if (byName.length === 0) {
        errors.push(`${e.player} (${e.pos}): no player in the pool matches — check the spelling, or pin a sleeperId`);
      } else {
        errors.push(`${e.player} (${e.pos}): ${byName.length} players match — pin a sleeperId`);
      }
    }
  }

  console.log(`injury-overrides.json — ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}\n`);

  for (const row of live) {
    const e = row.entry;
    const until = row.expiresAt !== null
      ? new Date(row.expiresAt).toISOString().slice(0, 10)
      : new Date(addDays(parseDate(e.setAt), DEFAULT_DURATION_DAYS)).toISOString().slice(0, 10);
    const who = row.matched ? `${row.matched.name} ${row.matched.team}` : `${e.player} — MATCHES NOBODY`;
    console.log(`  ${row.matched ? 'LIVE   ' : 'BROKEN '}  ${e.status}  →  ${who}`);
    console.log(`           set ${e.setAt} (${daysAgo(parseDate(e.setAt))}d ago), expires ${until}, source: ${e.source}`);
  }

  for (const row of expired) {
    console.log(`  EXPIRED  ${row.entry.player}: "${row.entry.status}" lapsed ${daysAgo(row.expiresAt)}d ago — the feed has him back`);
  }

  if (!rows.length) console.log('  (empty — every status is coming from the feed)');

  if (errors.length) {
    console.error(`\n${errors.length} ERROR${errors.length === 1 ? '' : 'S'} — ${errors.length === 1 ? 'this entry does' : 'these entries do'} nothing on the site:`);
    errors.forEach(e => console.error(`  ✗ ${e}`));
    console.error(SCHEMA);
    return 1;
  }

  console.log(`\nOK — ${live.length} live, ${expired.length} expired.`);
  return 0;
}

process.exit(main());
