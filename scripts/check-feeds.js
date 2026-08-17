#!/usr/bin/env node

/**
 * Fail the run if any data source failed, or if the site's data has gone stale.
 *
 *   node scripts/check-feeds.js
 *
 * update-data.js catches its own fetch errors so that one dead API cannot stop
 * the rest of the pipeline. The cost of that is a run which fails and still
 * exits zero — ESPN 403'd this project for weeks while every Action run went
 * green with "News articles cached: 0". This script is the other half of that
 * bargain: the pipeline keeps going, and then the job goes red.
 *
 * It runs LAST in the Action, after the data has been committed and pushed, so
 * a broken feed never costs us the data that DID come in.
 */

const fs = require('fs');
const path = require('path');

// A feed nobody has touched in this long is stale whether or not it errored.
// Silence and success look identical from the outside, which is the whole
// problem this file exists to solve.
const STALE_HOURS = 36;

function main() {
  const metaPath = path.join(__dirname, '..', 'data', 'meta.json');
  if (!fs.existsSync(metaPath)) {
    console.error('MISSING: data/meta.json — the update script never wrote its report');
    return 1;
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (e) {
    console.error(`data/meta.json is not valid JSON: ${e.message}`);
    return 1;
  }

  const problems = [];

  const failures = Array.isArray(meta.fetchFailures) ? meta.fetchFailures : [];
  failures.forEach(f => problems.push(`${f.source} failed: ${f.message}`));

  const age = meta.lastUpdate ? (Date.now() - Date.parse(meta.lastUpdate)) / 3600000 : null;
  if (age === null || Number.isNaN(age)) {
    problems.push('meta.lastUpdate is missing or unparseable');
  } else if (age > STALE_HOURS) {
    problems.push(`data is ${Math.round(age)}h old — the daily update has not run since ${meta.lastUpdate}`);
  }

  console.log('Feed check');
  console.log(`  last update:   ${meta.lastUpdate || '(none)'}${age !== null && !Number.isNaN(age) ? ` (${Math.round(age)}h ago)` : ''}`);
  console.log(`  statuses:      ${meta.playerStatusesUpdated ?? '?'} updated`);
  console.log(`  news articles: ${meta.newsArticleCount ?? '?'}`);
  console.log(`  trending adds: ${meta.trendingAddCount ?? '?'}`);

  if (problems.length) {
    console.error(`\n${problems.length} PROBLEM${problems.length === 1 ? '' : 'S'}:`);
    problems.forEach(p => console.error(`  ✗ ${p}`));
    console.error('\nThe data that did come in has already been committed. Fix the source, do not silence the check.');
    return 1;
  }

  console.log('\nOK — every source reported in.');
  return 0;
}

process.exit(main());
