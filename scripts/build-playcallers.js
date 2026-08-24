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
const { writeJSONIfChanged } = require('./lib/write');
const { fetchCSV, parseCSV } = require('./lib/match');
const { teamKey } = require('./lib/teams');
const season = require('./lib/season');

const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA, 'playcallers.json');
const SCHEME = path.join(DATA, 'scheme.json');
const SCHEDULE_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';

const log = (m) => console.log(`[playcallers] ${m}`);

async function main() {
  if (!fs.existsSync(SCHEME)) {
    console.error('data/scheme.json not found — run build-scheme.js first');
    process.exit(1);
  }
  const scheme = JSON.parse(fs.readFileSync(SCHEME, 'utf8'));
  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { entries: {} };
  const entries = existing.entries || {};

  // ---- THE SEASON NOBODY HAS PLAYED YET ------------------------------------
  // Scheme only knows the seasons with play-by-play behind them, so in August
  // the newest row here was last season's — and the site went on naming last
  // season's head coach as though he were still in the building. Miami's card
  // said Mike McDaniel a year after he left.
  //
  // The schedule feed carries the coach for every 2026 game before a snap is
  // taken, so the current league year is scaffolded from there. The generated
  // half (the head coach) fills itself; the play-caller stays blank and blank
  // stays honest — the page falls back to the head coach rather than guessing.
  let added = 0;
  try {
    const target = await season.targetSeason();
    if (!scheme.meta.seasons.map(Number).includes(Number(target))) {
      const games = parseCSV(await fetchCSV(SCHEDULE_URL))
        .filter((g) => Number(g.season) === Number(target));
      const coachOf = new Map();
      for (const g of games) {
        if (g.home_team && g.home_coach) coachOf.set(teamKey(g.home_team), g.home_coach);
        if (g.away_team && g.away_coach) coachOf.set(teamKey(g.away_team), g.away_coach);
      }
      for (const [team, coach] of coachOf) {
        const key = `${target}|${team}`;
        if (entries[key]) { entries[key].headCoach = coach || entries[key].headCoach; continue; }
        entries[key] = {
          season: Number(target), team, headCoach: coach || null,
          playCaller: null, callerIsHeadCoach: null, source: '', note: '',
        };
        added++;
      }
      log(`scaffolded ${coachOf.size} teams for ${target} from the schedule — no games played yet`);
    }
  } catch (e) {
    // A missing schedule is not a reason to lose the seasons that do exist.
    log(`could not scaffold the current season: ${e.message}`);
  }

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
  const wrote = writeJSONIfChanged(OUT, out);
  if (!wrote) console.log('[playcallers] unchanged — not rewritten');

  const total = Object.keys(entries).length;
  const filled = Object.values(entries).filter(e => e.playCaller).length;
  console.log(`[playcallers] ${total} rows (${added} new), ${filled} filled, ${total - filled} awaiting a name`);
}

main().catch((e) => { console.error(`[playcallers] FATAL: ${e.message}`); process.exit(1); });
