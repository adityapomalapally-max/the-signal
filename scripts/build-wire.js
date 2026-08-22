#!/usr/bin/env node
/**
 * build-wire.js — the waiver wire → data/wire.json
 *
 * WHAT THIS ANSWERS THAT A TRENDING LIST DOES NOT. Sleeper's add counts are a
 * leaderboard of names: 326,641 people added Xavier Hutchinson, and nothing
 * about whether that is a reason to do the same. The two questions a reader
 * actually has are where he sits on his own team, and whether the room is
 * still piling in or already cooling — one is a depth chart, the other is a
 * series, and this site now keeps both.
 *
 * THE POOL IS THE WRONG PLACE TO LOOK HIM UP. The 350 are the fantasy-relevant
 * players, which is to say the ones already rostered; a waiver page is about
 * the others. That is why the depth layer here is data/depth-league.json — the
 * whole league at the four skill positions — and not the pool-only chart in
 * context.json.
 *
 * WHAT IT REFUSES TO DO
 *  - No id is guessed. The room speculates on players outside the pool, and a
 *    free agent added 60,000 times is worth listing; attaching him to the wrong
 *    player is not. An unmatched name keeps its count and no link.
 *  - No momentum off one morning. A direction needs two readings, and the
 *    series began on the day it began — it says how many mornings it has
 *    rather than drawing a trend through one point.
 *  - No depth line invented. A player the chart does not carry gets no line
 *    saying where he sits, rather than a plausible one.
 *  - A depth chart is a CLAIM, not a snap count. It is what a team published,
 *    and the caveat travels with it.
 *
 * Run: node scripts/build-wire.js
 */

const fs = require('fs');
const path = require('path');
const { normalizeName } = require('./lib/match');
const { writeJSONIfChanged } = require('./lib/write');

const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA, 'wire.json');
const HISTORY = path.join(DATA, 'history', 'trending.jsonl');
const DEPTH_LOG = path.join(DATA, 'history', 'depth.jsonl');

// How much of the series a reader can hold in their head. Two weeks is also
// about as far back as an add count means anything: the room forgets.
const SERIES_DAYS = 14;
// Depth chart moves worth showing. A promotion three weeks ago is roster news,
// not wire news.
const MOVE_DAYS = 21;
// A direction needs two readings — today's and yesterday's. Stated as a
// constant so the fallback below is obviously tied to it rather than to a
// hidden assumption.
const MIN_DAYS_FOR_DIRECTION = 2;
// Below this the day-over-day move is noise in a number that swings on one
// beat writer's tweet.
const DIRECTION_PCT = 15;

const log = (m) => console.log(`[wire] ${m}`);
const readJSON = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fallback; }
};
const readJSONL = (f) => {
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch (e) { return null; }
  }).filter(Boolean);
};

// "A", "A and B", "A, B and C" — a chain of ands past two reads as a list
// somebody forgot to punctuate.
function andList(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ===== WHERE HE SITS =====
// team + name, because the league chart carries no site id and the pool
// crosswalk does not reach the players this page is about.
function depthIndex(league) {
  const byKey = new Map();
  for (const [team, byPos] of Object.entries(league.teams || {})) {
    for (const [pos, list] of Object.entries(byPos)) {
      list.forEach((row, i) => {
        byKey.set(`${team}|${normalizeName(row.name)}`, { team, pos, list, i, row });
      });
    }
  }
  return byKey;
}

function depthFor(index, team, name) {
  const hit = index.get(`${team}|${normalizeName(name)}`);
  if (!hit) return null;
  const ahead = hit.list.slice(0, hit.i).map(r => r.name);
  return {
    position: hit.pos,
    rank: hit.row.rank || hit.i + 1,
    of: hit.list.length,
    // The names, not the count. "Third at his spot" is a number; "behind Nico
    // Collins and Jayden Higgins" is the reason.
    behind: ahead,
    // NO DENOMINATOR. "3 of 16 at WR" reads as better than it is: in August a
    // published chart lists the whole 90-man camp roster, so the 16 is a
    // headcount of everyone who has a locker, not of anyone competing for the
    // ball. The rank and the names ahead of him are the true parts.
    reading: hit.i === 0
      ? `listed first at ${hit.pos} on the published chart`
      : `listed ${ordinal(hit.row.rank || hit.i + 1)} at ${hit.pos}, behind ${andList(ahead)}`,
  };
}

// ===== IS THE ROOM STILL PILING IN? =====
// The series is keyed by whatever the history layer wrote: a site id when the
// name matched the pool, a bare name when it did not. Both are looked up.
function seriesFor(history, key, name) {
  const out = [];
  for (const day of history) {
    const hit = (day.adds || []).find(a => (a.id && a.id === key) || (a.name && normalizeName(a.name) === normalizeName(name)));
    if (hit) out.push({ date: day.date, count: hit.count });
  }
  return out;
}

// THE LIST IS A TOP FIFTEEN AND ITS MEMBERSHIP CHURNS. A player can be on it
// on Monday, off it on Tuesday and back on Wednesday, so two readings in a
// player's series are not necessarily two consecutive days — and the board says
// "this morning against yesterday". Comparing Wednesday with Monday under that
// sentence is a false statement about a real number, which is worse than having
// no arrow at all.
//
// So a direction needs today's live count AND a reading dated yesterday.
// Anything else is a player who was not on the list yesterday, and the honest
// thing to say about him is that, not a percentage.
function directionOf(liveCount, series, yesterdayDate) {
  if (!liveCount || !yesterdayDate) return null;
  const then = series.find((s) => s.date === yesterdayDate);
  if (!then || !then.count) return null;
  const pct = Math.round(((liveCount - then.count) / then.count) * 100);
  if (Math.abs(pct) < DIRECTION_PCT) return { move: 'steady', pct };
  return { move: pct > 0 ? 'rising' : 'cooling', pct };
}

function main() {
  const trending = readJSON(path.join(DATA, 'trending.json'), null);
  if (!trending || !Array.isArray(trending.adds)) {
    console.error('[wire] ABORT: data/trending.json is missing or has no adds. update-data.js writes it.');
    process.exit(1);
  }
  const league = readJSON(path.join(DATA, 'depth-league.json'), { teams: {} });
  if (!Object.keys(league.teams || {}).length) {
    console.error('[wire] ABORT: data/depth-league.json is empty — fetch-context.js builds it, and without it '
      + 'this page is a leaderboard of names with no reason attached to any of them.');
    process.exit(1);
  }
  const players = readJSON(path.join(DATA, 'players.json'), []);
  const rankings = readJSON(path.join(DATA, 'rankings.json'), {});

  const index = depthIndex(league);
  const history = readJSONL(HISTORY).slice(-SERIES_DAYS);
  const days = history.length;

  // The pool, for "we already have a page on him".
  const poolByName = new Map();
  for (const p of players) poolByName.set(`${p.team}|${normalizeName(p.name)}`, p);
  const rankOf = new Map();
  for (const tab of ['qb', 'rb', 'wr', 'te']) {
    (rankings[tab] || []).forEach((r, i) => rankOf.set(normalizeName(r.name), `${tab.toUpperCase()}${i + 1}`));
  }

  // TODAY'S READING IS trending.json, NOT THE SERIES. The full build writes one
  // history line a morning; the light in-season refreshes run four more times a
  // week and do not, because a series sampled at 11:00 on some days and 22:30
  // on others has a time-of-day wobble baked into every delta computed from it.
  // But the COUNT on screen comes from trending.json, which those refreshes do
  // update — so reading today's number out of the series would print a fresh
  // count beside an arrow computed from the morning's, which is two different
  // days' arithmetic in one row.
  //
  // So: today is now and its reading is the live one; yesterday is yesterday
  // and its reading comes from the log. If yesterday's line is missing — a
  // morning the Action did not run — there is no comparison to make and no
  // sentence that would be true about one.
  // AND THE READING IS DATED BY THE DATA, NOT BY THE CLOCK. trending.json is
  // written by update-data; if that has not run since yesterday then "today's
  // count" is yesterday's count, and dating it today compares a number with
  // itself and prints "steady, 0%" over a board where plenty moved. The
  // timestamp in the file is when the room was actually counted.
  const liveDate = (trending.updated ? new Date(trending.updated) : new Date()).toISOString().slice(0, 10);
  const prevDate = new Date(Date.parse(liveDate) - 86400000).toISOString().slice(0, 10);
  const havePrev = history.some((d) => d.date === prevDate);

  const shape = (row) => {
    const team = row.team || null;
    const pooled = team ? poolByName.get(`${team}|${normalizeName(row.name)}`) : null;
    const series = seriesFor(history, pooled ? pooled.id : null, row.name);
    return {
      name: row.name,
      team,
      pos: row.position || (pooled && pooled.pos) || null,
      count: Number(row.count) || 0,
      // A link only when we are certain who he is. No id is guessed.
      id: pooled ? pooled.id : null,
      inPool: Boolean(pooled),
      rank: rankOf.get(normalizeName(row.name)) || null,
      status: (pooled && pooled.status) || row.injury_status || null,
      depth: team ? depthFor(index, team, row.name) : null,
      // The series as the reader sees it: the log for every day before today,
      // and the live count for today.
      series: [...series.filter((s) => s.date < liveDate), { date: liveDate, count: Number(row.count) || 0 }],
      direction: directionOf(Number(row.count) || 0, series, prevDate),
      // He is on the list today and was not yesterday. That is a fact worth
      // printing, and the only true thing available when there is nothing to
      // compare against — but it can only be said when yesterday was recorded
      // at all, which is why a missed morning produces neither.
      newToday: Boolean(havePrev && !series.some((s) => s.date === prevDate)),
    };
  };

  const adds = trending.adds.map(shape);
  const drops = (trending.drops || []).map(shape);

  // ===== WHO ACTUALLY MOVED =====
  // First sightings are not moves. The log records them so the series has a
  // starting point, and on the first run every entry is one.
  const since = new Date(Date.now() - MOVE_DAYS * 86400000).toISOString().slice(0, 10);
  const moves = readJSONL(DEPTH_LOG)
    .filter(m => !m.first && m.date >= since && m.from && m.to)
    .map(m => ({
      date: m.date,
      id: m.id || null,
      name: m.name,
      team: (m.to && m.to.team) || (m.from && m.from.team) || null,
      position: (m.to && m.to.position) || null,
      fromRank: m.from.positionRank,
      toRank: m.to.positionRank,
      // A trade is a move with an identical rank on both sides of it, so the
      // direction is read from the team as well as the number.
      kind: m.from.team !== m.to.team ? 'traded'
        : m.to.positionRank < m.from.positionRank ? 'promoted'
        : m.to.positionRank > m.from.positionRank ? 'demoted' : 'changed',
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const out = {
    meta: {
      generated: new Date().toISOString(),
      window: trending.updated || null,
      source: 'Sleeper adds and drops over the last 24 hours, across every Sleeper league',
      daysOnFile: days,
      // The LOGGED range — mornings the history layer actually holds. It is not
      // the same thing as the live reading below and must not be named as
      // though it were: the last logged morning is written once a day by the
      // full build, while the count on screen is refreshed four more times a
      // week in season.
      seriesFrom: days ? history[0].date : null,
      seriesTo: days ? history[days - 1].date : null,
      // When the room was actually counted, which in a light refresh is minutes
      // ago and in a stale one is yesterday. The board prints it, because "adds
      // today" means nothing without saying which moment it counted.
      countedAt: trending.updated || null,
      liveDate,
      comparedWith: prevDate,
      moveWindowDays: MOVE_DAYS,
      // What the reader has to know to read the numbers, each a separate thing.
      caveats: [
        'Add counts are Sleeper-wide. They say what the rooms are doing, not what your room is doing, and a player already rostered in your league cannot be added out of them.',
        days < MIN_DAYS_FOR_DIRECTION
          ? `The series has ${days} morning${days === 1 ? '' : 's'} on file, so no player carries a direction yet. A direction needs two readings.`
          : `Direction compares this morning against yesterday, over ${days} mornings on file. A move under ${DIRECTION_PCT}% reads as steady.`,
        'A depth chart is what a team published, not what it does. It is a claim about intent, and a coach who lists a rookie second is not obliged to play him second.',
        'A player outside the 350-player pool carries a count and a depth line and nothing else. The rest of this site is about the players already rostered.',
        'Before the roster cutdown a published chart lists the whole camp roster, so a low rank is competing with players who will not be on the team in September.',
      ],
    },
    adds,
    drops,
    depthMoves: moves,
  };

  const wrote = writeJSONIfChanged(OUT, out);
  const withDepth = adds.filter(a => a.depth).length;
  const inPool = adds.filter(a => a.inPool).length;
  log(`${adds.length} adds, ${drops.length} drops — ${withDepth} placed on a depth chart, ${inPool} in the pool`);
  log(`series: ${days} morning(s) on file${days ? ` (${out.meta.seriesFrom} → ${out.meta.seriesTo})` : ''}`);
  log(`depth moves in the last ${MOVE_DAYS} days: ${moves.length}`);
  log(wrote ? `wrote data/wire.json` : 'data/wire.json unchanged — not rewritten');
}

// Extracted and exported for the same reason depthChangesFor and shapeCell
// were: the paths that matter are the ones the day's data does not exercise.
// With two mornings on file every player has two readings, so a rule about
// what happens when he has one cannot be reached by running this and looking.
module.exports = { directionOf, depthFor, depthIndex, andList, ordinal };

if (require.main === module) main();
