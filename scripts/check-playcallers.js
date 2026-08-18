#!/usr/bin/env node

/**
 * Validates data/playcallers.json and reports what is still blank.
 *
 * A blank row is NOT an error — an unknown play-caller is an honest state, and
 * the site falls back to the head coach. What is an error is a row that claims
 * something without a source, or names a team-season that does not exist.
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA, 'playcallers.json');
const SCHEME = path.join(DATA, 'scheme.json');

function main() {
  if (!fs.existsSync(FILE)) {
    console.log('data/playcallers.json does not exist yet — run build-playcallers.js to scaffold it');
    return 0;
  }
  const file = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const scheme = fs.existsSync(SCHEME) ? JSON.parse(fs.readFileSync(SCHEME, 'utf8')) : null;
  const entries = file.entries || {};
  const errors = [];
  let filled = 0;
  const blankBySeason = {};

  for (const [key, e] of Object.entries(entries)) {
    const label = `${e.season} ${e.team}`;
    if (key !== `${e.season}|${e.team}`) errors.push(`${label}: key "${key}" disagrees with its own season/team`);
    if (scheme && !(scheme.seasons[e.season] && scheme.seasons[e.season][e.team])) {
      errors.push(`${label}: no such team-season in scheme.json`);
    }
    if (!e.playCaller) { (blankBySeason[e.season] ||= []).push(e.team); continue; }
    filled++;
    // A claim needs a source. Same standard as every other hand-kept file here.
    if (!e.source || !String(e.source).trim()) errors.push(`${label}: names ${e.playCaller} with no source`);
    if (e.callerIsHeadCoach === null || e.callerIsHeadCoach === undefined) {
      errors.push(`${label}: callerIsHeadCoach is unanswered`);
    }
    if (e.callerIsHeadCoach === true && e.headCoach && e.playCaller !== e.headCoach) {
      errors.push(`${label}: callerIsHeadCoach is true but ${e.playCaller} is not the head coach (${e.headCoach})`);
    }
    if (e.callerIsHeadCoach === false && e.headCoach && e.playCaller === e.headCoach) {
      errors.push(`${label}: callerIsHeadCoach is false but ${e.playCaller} IS the head coach`);
    }
  }

  const total = Object.keys(entries).length;
  console.log(`playcallers.json — ${total} rows, ${filled} filled, ${total - filled} unknown\n`);
  for (const [season, teams] of Object.entries(blankBySeason).sort()) {
    console.log(`  ${season} still needs (${teams.length}): ${teams.sort().join(' ')}`);
  }

  if (errors.length) {
    console.error(`\n${errors.length} ERROR${errors.length === 1 ? '' : 'S'}:`);
    errors.forEach(e => console.error(`  ✗ ${e}`));
    return 1;
  }
  console.log(`\nOK — every filled row is sourced and consistent.`);
  return 0;
}

process.exit(main());
