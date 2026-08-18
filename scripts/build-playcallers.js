#!/usr/bin/env node

/**
 * Scaffolds data/playcallers.json — the hand-kept layer for who actually calls
 * the plays.
 *
 * The head coach is generated from nflverse schedules and is always known. The
 * PLAY-CALLER is not in any public dataset, and he is the more predictive of
 * the two: a coordinator change explains more scheme movement than a head-coach
 * change, and plenty of head coaches do not call it at all.
 *
 * So this script does the boring 90%: it writes one row per team per season,
 * pre-filled with the head coach we already know, leaving the two fields only a
 * human can supply. Existing rows are never overwritten — re-running it only
 * adds rows for seasons that appeared since.
 *
 *   node scripts/build-playcallers.js      # add missing rows, keep all answers
 *   node scripts/check-playcallers.js      # what is still blank, and is it valid
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA, 'playcallers.json');
const SCHEME = path.join(DATA, 'scheme.json');

function main() {
  if (!fs.existsSync(SCHEME)) {
    console.error('data/scheme.json not found — run build-scheme.js first');
    process.exit(1);
  }
  const scheme = JSON.parse(fs.readFileSync(SCHEME, 'utf8'));
  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { entries: {} };
  const entries = existing.entries || {};

  let added = 0;
  for (const season of scheme.meta.seasons) {
    for (const [team, data] of Object.entries(scheme.seasons[season] || {})) {
      const key = `${season}|${team}`;
      if (entries[key]) {
        // Keep the human's answer; refresh only the generated half.
        entries[key].headCoach = data.coach || entries[key].headCoach;
        continue;
      }
      entries[key] = {
        season: Number(season),
        team,
        headCoach: data.coach || null,
        // ---- the two fields a human fills in ----
        playCaller: null,          // "Ben Johnson" — who actually called it
        callerIsHeadCoach: null,   // true / false
        source: '',                // required: where you read it
        note: '',                  // optional: mid-season change, etc.
      };
      added++;
    }
  }

  const out = {
    meta: {
      purpose: 'Who called the offensive plays. The head coach is generated; the play-caller is not in any public dataset and is kept by hand.',
      instructions: 'Fill playCaller, callerIsHeadCoach and source. Leave a row untouched and it is simply treated as unknown — the site shows the head coach alone rather than guessing.',
      updated: new Date().toISOString().slice(0, 10),
    },
    entries,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

  const total = Object.keys(entries).length;
  const filled = Object.values(entries).filter(e => e.playCaller).length;
  console.log(`[playcallers] ${total} rows (${added} new), ${filled} filled, ${total - filled} awaiting a name`);
}

main();
