#!/usr/bin/env node

/**
 * The Signal — Aggregate return-to-play curves
 *
 * The per-player Return to Play panels answer "how did HE come back". This
 * answers the question underneath them: what does coming back from this
 * injury look like across everyone in the pool who has done it.
 *
 * How an absence is found, and why each step is needed:
 *   1. The schedule says which weeks a player's TEAM played, so a bye is
 *      never mistaken for a missed game. Without this every player picks up
 *      a fake one-week absence.
 *   2. The game logs say which of those weeks he recorded a stat line.
 *   3. The gap between the two is a missed run.
 *   4. The official injury report says what was wrong in that window. A run
 *      with NO injury-report entry is dropped, not guessed — that is how
 *      suspensions, benchings and healthy scratches stay out of a medical
 *      chart. Rice's six-game suspension is exactly this case.
 *
 * Production is indexed to each player's OWN pre-injury median week, so a
 * WR1 and a committee back can sit on the same axis. The curve reports the
 * median across players at each game since return, with the sample size at
 * every point, and refuses to publish a point that rests on too few players.
 *
 * Runs after fetch-injuries in the daily Action.
 *   node scripts/build-injury-curves.js
 */

const fs = require('fs');
const path = require('path');
const { fetchCSV, parseCSV } = require('./lib/match');
const { writeJSONIfChanged } = require('./lib/write');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA_DIR, 'injury-curves.json');
const SEASONS = [2023, 2024, 2025];
const SCHEDULE_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';

// A one-week gap is as often a rest day or a late scratch as an injury, and
// it carries no recovery curve worth reading.
const MIN_MISSED = 2;
// Fewer games than this before the injury and there is no honest baseline
// to index the return against.
const MIN_BASELINE_GAMES = 4;
// Weekly fantasy scoring is far too volatile to read one game at a time: a
// per-game curve off ~20 players came out 90/110/76/106/91/117/129/74, which
// is noise wearing a trend's clothes. Production is bucketed instead, and
// each player contributes his median within a bucket before the medians are
// taken across players — so one 30-point week cannot carry a bucket.
const CURVE_LENGTH = 8;
const BUCKETS = [
  { label: 'Games 1–2 back', from: 1, to: 2 },
  { label: 'Games 3–5', from: 3, to: 5 },
  { label: 'Games 6–8', from: 6, to: 8 }
];
const MIN_PLAYERS_PER_BUCKET = 6;
// An injury type needs this many distinct absences before a median means
// anything at all.
const MIN_ABSENCES_PER_TYPE = 6;

const log = (m) => console.log(`[curves] ${m}`);

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const round1 = (n) => (n === null ? null : Math.round(n * 10) / 10);

// Body parts are reported at a finer grain than anyone reasons about, and
// splitting Knee from "Knee, Ankle" would leave every bucket too small to
// publish. This groups to the level a reader actually thinks in.
function normalizePart(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s || /not injury related|resting|coach|personal|illness|rest/.test(s)) return null;
  if (/achilles/.test(s)) return 'Achilles';
  if (/hamstring/.test(s)) return 'Hamstring';
  if (/\bacl\b|\bmcl\b|\bpcl\b|meniscus|\bknee\b/.test(s)) return 'Knee';
  if (/ankle/.test(s)) return 'Ankle';
  if (/concussion|head/.test(s)) return 'Concussion';
  if (/shoulder|clavicle|collarbone|\bac joint\b/.test(s)) return 'Shoulder';
  if (/groin|hip|abductor|adductor/.test(s)) return 'Hip / Groin';
  if (/foot|toe|plantar|heel/.test(s)) return 'Foot / Toe';
  if (/calf|quad|thigh|\bleg\b/.test(s)) return 'Calf / Quad';
  if (/back|spine|neck/.test(s)) return 'Back / Neck';
  if (/rib|chest|abdomen|oblique|pectoral/.test(s)) return 'Ribs / Core';
  if (/hand|wrist|finger|thumb|elbow|arm|forearm|biceps|triceps/.test(s)) return 'Arm / Hand';
  return null;   // unrecognised stays out rather than landing in a wrong bucket
}

async function teamWeeksBySeason() {
  log('Fetching schedules...');
  const rows = parseCSV(await fetchCSV(SCHEDULE_URL));
  const map = new Map();          // "season|TEAM" -> Set(weeks)
  const opponent = new Map();     // "season|week|TEAM" -> opponent
  let used = 0;
  for (const r of rows) {
    if (r.game_type !== 'REG' || !SEASONS.includes(r.season)) continue;
    for (const [t, o] of [[r.away_team, r.home_team], [r.home_team, r.away_team]]) {
      if (!t || !o) continue;
      const k = `${r.season}|${t}`;
      if (!map.has(k)) map.set(k, new Set());
      map.get(k).add(r.week);
      opponent.set(`${r.season}|${r.week}|${o}`, t);
    }
    used++;
  }
  if (used < 200) {
    log(`ABORT: only ${used} regular-season games parsed from the schedule. The feed or schema moved.`);
    process.exit(1);
  }
  log(`  ${used} games, ${map.size} team-seasons`);
  return { map, opponent };
}

// The pool carries a player's CURRENT team, which is wrong for past seasons.
// His opponent each week identifies who he was playing for at the time.
function teamForSeason(weekly, season, opponent) {
  const votes = {};
  for (const g of (weekly[season] || [])) {
    const t = opponent.get(`${season}|${g.week}|${g.opp}`);
    if (t) votes[t] = (votes[t] || 0) + 1;
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

async function main() {
  log('=== Injury Curves Start ===');
  const players = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'players.json'), 'utf8'));
  const injuries = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'injuries.json'), 'utf8'));
  const { map: teamWeeks, opponent } = await teamWeeksBySeason();

  const absences = [];
  let noReport = 0, thinBaseline = 0, noReturn = 0;

  for (const p of players) {
    let weekly;
    try {
      weekly = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'weekly', `${p.id}.json`), 'utf8'));
    } catch (e) { continue; }

    // One ordered career timeline, so a return that lands in the next season
    // is still a return rather than a dead end.
    const timeline = [];
    for (const season of SEASONS) {
      const team = teamForSeason(weekly, season, opponent);
      if (!team) continue;
      const weeks = teamWeeks.get(`${season}|${team}`);
      if (!weeks) continue;
      const played = new Map((weekly[season] || []).map(g => [g.week, g]));
      for (const w of [...weeks].sort((a, b) => a - b)) {
        timeline.push({ season, week: w, game: played.get(w) || null });
      }
    }
    if (!timeline.length) continue;

    // Runs of missed team games, never crossing a season boundary.
    let i = 0;
    while (i < timeline.length) {
      if (timeline[i].game) { i++; continue; }
      let j = i;
      while (j + 1 < timeline.length && !timeline[j + 1].game
             && timeline[j + 1].season === timeline[i].season) j++;
      const start = i, end = j;
      i = j + 1;

      const missed = end - start + 1;
      if (missed < MIN_MISSED) continue;

      // Attribute it. The report window runs from the week before the gap
      // through the gap itself — teams list a player before he sits.
      const season = timeline[start].season;
      const inj = injuries[p.id] && injuries[p.id][season];
      const lowWeek = timeline[start].week - 1, highWeek = timeline[end].week;
      const parts = {};
      if (inj) {
        for (const ep of inj.episodes) {
          if (ep.lastWeek < lowWeek || ep.firstWeek > highWeek) continue;
          const part = normalizePart(ep.part);
          if (part) parts[part] = (parts[part] || 0) + ep.weeks;
        }
      }
      const ranked = Object.entries(parts).sort((a, b) => b[1] - a[1]);
      if (!ranked.length) { noReport++; continue; }
      const part = ranked[0][0];

      const before = timeline.slice(0, start).filter(t => t.game).map(t => t.game.fpts)
        .filter(v => typeof v === 'number');
      const after = timeline.slice(end + 1).filter(t => t.game).map(t => t.game.fpts)
        .filter(v => typeof v === 'number');
      if (before.length < MIN_BASELINE_GAMES) { thinBaseline++; continue; }
      if (!after.length) { noReturn++; continue; }

      const baseline = median(before);
      if (!baseline || baseline <= 0) { thinBaseline++; continue; }

      absences.push({
        id: p.id, name: p.name, pos: p.pos, season, part,
        missed, baseline: round1(baseline),
        returns: after.slice(0, CURVE_LENGTH).map(v => Math.round((v / baseline) * 100))
      });
    }
  }

  log(`absences kept: ${absences.length} (dropped — no injury report: ${noReport}, ` +
      `thin baseline: ${thinBaseline}, never returned: ${noReturn})`);
  if (absences.length < 40) {
    log('ABORT: too few attributable absences to publish anything. Keeping existing file.');
    process.exit(1);
  }

  const types = {};
  for (const a of absences) {
    (types[a.part] ||= []).push(a);
  }

  const out = { meta: {
    builtBy: 'scripts/build-injury-curves.js',
    builtAt: new Date().toISOString(),
    seasons: SEASONS,
    method: 'An absence is a run of games a player missed while his team played, attributed to whatever ' +
      'his team reported on the official injury report in that window. A run with no injury-report entry is ' +
      'dropped rather than guessed, which is what keeps suspensions and healthy scratches out. Each return ' +
      'game is indexed to that player\'s own median week before the injury, so players of different quality ' +
      'sit on one axis; the line is the median across players at each game back.',
    // AN ARRAY, like every other file here. As one string it rendered as a
    // 132-word block on the Medicals page, and these are four separate things a
    // reader has to know rather than one long thought.
    caveats: [
      'Descriptive, not causal — role, age, scheme and the reason for the absence all move alongside '
      + 'the injury.',
      'The pool is the top 200 fantasy players over three seasons, so these are the injuries that '
      + 'happened to good players recently, not the league at large.',
      'Two biases both push the later numbers up and neither is corrected here. A player who never '
      + 'came back contributes nothing, so the worst outcomes are missing by construction, and the '
      + 'sample thins across the buckets as the players who got hurt again drop out.',
      'The games just before an absence often include games he was already playing hurt, which lowers '
      + 'the baseline every return is measured against.',
      'Read the games-missed figure as the solid one and the production line as a shape, not a forecast.',
    ],
    thresholds: { minMissedGames: MIN_MISSED, minBaselineGames: MIN_BASELINE_GAMES,
      minPlayersPerBucket: MIN_PLAYERS_PER_BUCKET, minAbsencesPerType: MIN_ABSENCES_PER_TYPE }
  }, types: {} };

  for (const [part, list] of Object.entries(types).sort((a, b) => b[1].length - a[1].length)) {
    if (list.length < MIN_ABSENCES_PER_TYPE) continue;
    const curve = [];
    for (const b of BUCKETS) {
      // One value per player per bucket, so a player with more games back
      // does not outweigh one with fewer.
      const perPlayer = list
        .map(a => median(a.returns.slice(b.from - 1, b.to).filter(v => typeof v === 'number')))
        .filter(v => v !== null);
      if (perPlayer.length < MIN_PLAYERS_PER_BUCKET) continue;
      curve.push({ label: b.label, n: perPlayer.length, pct: Math.round(median(perPlayer)) });
    }
    if (!curve.length) continue;
    out.types[part] = {
      absences: list.length,
      players: new Set(list.map(a => a.id)).size,
      medianMissed: median(list.map(a => a.missed)),
      medianBaseline: round1(median(list.map(a => a.baseline))),
      curve,
      examples: list.sort((a, b) => b.missed - a.missed).slice(0, 6)
        .map(a => ({ id: a.id, name: a.name, season: a.season, missed: a.missed }))
    };
  }

  const wrote = writeJSONIfChanged(OUT, out);
  const kinds = Object.keys(out.types);
  log(wrote
    ? `Wrote data/injury-curves.json: ${kinds.length} injury types — ${kinds.join(', ')}`
    : `data/injury-curves.json unchanged — ${kinds.length} injury types, not rewritten`);
  log('=== Injury Curves Complete ===');
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
