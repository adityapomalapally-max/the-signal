#!/usr/bin/env node
/**
 * Every number on this site, said as a rank.
 *
 * A profile page full of bare values asks the reader to supply the scale from
 * memory. 8.9 targets a game is a lot; 5.3 yards after the catch is a lot; 4.5
 * yards of separation is average and looks like a lot. Nobody carries all three
 * scales, so the numbers get read as "big" or "small" against nothing, and the
 * page's authority is borrowed from its typography rather than from its data.
 *
 * This file supplies the scale. For each position it builds the distribution of
 * every metric the site already collects, and gives each tracked player his
 * percentile and his rank inside it. Nothing here is fetched and nothing is
 * modelled — it is a second reading of files that are already on disk.
 *
 * THREE THINGS IT REFUSES TO DO, because each is how a percentile lies:
 *
 *   A rank means nothing without its pool, so the pool is stated. This one is
 *   The Signal's tracked players — 102 WRs, not the 190 who caught a pass in
 *   2025 — which is the right population for a fantasy page and is NOT the
 *   whole league. meta.pools carries the size and the floor for every position
 *   and the page prints them.
 *
 *   A rank means nothing without a volume floor. A receiver with four targets
 *   and three catches is not the 96th-percentile catch rate in football. The
 *   floor is the same shape the rest of the industry uses — a share of the pool
 *   leader's volume — so it scales with the season instead of being a constant
 *   somebody has to remember to change in week 3.
 *
 *   NOT EVERY METRIC HAS A GOOD END. Percentile bars imply one: green is high,
 *   and high is better. That is true of yards after the catch and false of
 *   average depth of target, which says where a player is used and not how well.
 *   Every metric here declares `dir`, and the neutral ones are published with a
 *   percentile and no verdict, rendered in a colour that makes no claim.
 *
 *   node scripts/build-percentiles.js
 */

const fs = require('fs');
const path = require('path');
const seasonLib = require('./lib/season');
const { writeJSONIfChanged } = require('./lib/write');

const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA, 'percentiles.json');

// The floor, as a share of the pool leader's volume. 20% of the leader is the
// convention the public advanced-stats pages use, and it has the property a
// hand-typed constant does not: in week 2 it is 20% of a two-game leader, so it
// admits roughly the same fraction of the position all season instead of
// admitting nobody until November.
const FLOOR_SHARE = 0.20;

// Below this the distribution is noise dressed as a percentile. On the Tuesday
// of week 2 a "78th percentile catch rate" is four catches, and publishing it
// with the same confidence as a 17-game figure is the lie this whole file is
// supposed to be preventing. When the newest season is this thin the previous
// one is used, and the page says which season it is reading.
const MIN_MEDIAN_GAMES = 4;

// A distribution needs a population. Under this there is no meaningful
// percentile to compute and the position is published empty rather than wrong.
const MIN_POOL = 12;

const log = (m) => console.log(`[percentiles] ${m}`);

/**
 * The metrics, per position, in the order the page shows them.
 *
 * `dir` is the honest half of this file:
 *   high    — more is better (yards, shares, boom rate)
 *   low     — less is better (drops, sacks, bust rate)
 *   neutral — the value describes a role, not a quality. aDOT is the type case:
 *             a 4.1 aDOT slot receiver and a 14.8 aDOT field-stretcher are two
 *             jobs, not a better and a worse player. Published with a percentile
 *             so the reader can see where he sits, and with no verdict attached.
 *
 * `get` receives every source row for one player and returns a number or null.
 * Null is a real answer — it means "not measured for him" — and is carried as
 * an absent metric rather than as a zero, which would rank him last at it.
 */
const RECEIVING = [
  { key: 'tgtPerG',    group: 'Opportunity', label: 'Targets / game',        dir: 'high',    fmt: 1, get: s => per(s.st.targets, s.st.games) },
  { key: 'tgtShare',   group: 'Opportunity', label: 'Target share',          dir: 'high',    fmt: 1, unit: '%', get: s => num(s.st.tgtShare) },
  { key: 'airShare',   group: 'Opportunity', label: 'Air yards share',       dir: 'high',    fmt: 1, unit: '%', get: s => num(s.st.airYardShare) },
  { key: 'snapPct',    group: 'Opportunity', label: 'Snap share',            dir: 'high',    fmt: 1, unit: '%', get: s => num(s.ngs && s.ngs.snapPct) },
  { key: 'firstReadG', group: 'Opportunity', label: 'First-read looks / game', dir: 'high',  fmt: 1, get: s => per(s.ch && s.ch.firstRead, s.st.games) },

  { key: 'catchPct',   group: 'Efficiency',  label: 'Catch rate',            dir: 'high',    fmt: 1, unit: '%', get: s => num(s.st.catchPct) },
  { key: 'firstRead',  group: 'Efficiency',  label: 'First-read target rate', dir: 'high',   fmt: 1, unit: '%', get: s => num(s.ch && s.ch.firstReadRate), note: 'share of his targets the play was designed to produce' },
  { key: 'yacPerRec',  group: 'Efficiency',  label: 'Yards after catch / rec', dir: 'high',  fmt: 2, get: s => num(s.st.yacPerRec) },
  { key: 'yacOE',      group: 'Efficiency',  label: 'YAC over expected',     dir: 'high',    fmt: 2, get: s => num(s.ngs && s.ngs.rec && s.ngs.rec.yacOE) },
  { key: 'separation', group: 'Efficiency',  label: 'Separation at catch',   dir: 'high',    fmt: 2, unit: ' yd', get: s => num(s.ngs && s.ngs.rec && s.ngs.rec.separation) },
  { key: 'dropPct',    group: 'Efficiency',  label: 'Drop rate',             dir: 'low',     fmt: 1, unit: '%', get: s => pct100(s.adv && s.adv.receiving && s.adv.receiving.dropPct) },
  { key: 'aDOT',       group: 'Efficiency',  label: 'Average depth of target', dir: 'neutral', fmt: 1, get: s => num(s.st.aDOT), note: 'where he is used, not how well' },

  { key: 'ppg',        group: 'Production',  label: 'Fantasy points / game',  dir: 'high',   fmt: 2, get: s => num(s.st.fantasyPPG) },
  { key: 'ypg',        group: 'Production',  label: 'Receiving yards / game', dir: 'high',   fmt: 1, get: s => num(s.st.recYPG) },
  { key: 'tdPerG',     group: 'Production',  label: 'Touchdowns / game',      dir: 'high',   fmt: 2, get: s => per(s.st.recTD, s.st.games) },
  { key: 'boomRate',   group: 'Production',  label: 'Boom rate',              dir: 'high',   fmt: 0, unit: '%', get: s => num(s.vol && s.vol.boomRate) },
  { key: 'bustRate',   group: 'Production',  label: 'Bust rate',              dir: 'low',    fmt: 0, unit: '%', get: s => num(s.vol && s.vol.bustRate) },
];

const RUSHING = [
  { key: 'touchPerG',  group: 'Opportunity', label: 'Touches / game',        dir: 'high',    fmt: 1, get: s => per(add(s.st.carries, s.st.targets), s.st.games) },
  { key: 'carryPerG',  group: 'Opportunity', label: 'Carries / game',        dir: 'high',    fmt: 1, get: s => per(s.st.carries, s.st.games) },
  { key: 'tgtPerG',    group: 'Opportunity', label: 'Targets / game',        dir: 'high',    fmt: 1, get: s => per(s.st.targets, s.st.games) },
  { key: 'tgtShare',   group: 'Opportunity', label: 'Target share',          dir: 'high',    fmt: 1, unit: '%', get: s => num(s.st.tgtShare) },
  { key: 'snapPct',    group: 'Opportunity', label: 'Snap share',            dir: 'high',    fmt: 1, unit: '%', get: s => num(s.ngs && s.ngs.snapPct) },

  { key: 'ypc',        group: 'Efficiency',  label: 'Yards per carry',       dir: 'high',    fmt: 2, get: s => num(s.st.ypc) },
  { key: 'ybc',        group: 'Efficiency',  label: 'Yards before contact / att', dir: 'high', fmt: 2, get: s => num(s.adv && s.adv.rushing && s.adv.rushing.ybcPerAttempt), note: 'his blocking' },
  { key: 'yac',        group: 'Efficiency',  label: 'Yards after contact / att', dir: 'high', fmt: 2, get: s => num(s.adv && s.adv.rushing && s.adv.rushing.yacPerAttempt), note: 'him' },
  { key: 'brokenPerA', group: 'Efficiency',  label: 'Broken tackles / att',  dir: 'high',    fmt: 3, get: s => per(s.adv && s.adv.rushing && s.adv.rushing.brokenTackles, s.st.carries) },
  { key: 'catchPct',   group: 'Efficiency',  label: 'Catch rate',            dir: 'high',    fmt: 1, unit: '%', get: s => num(s.st.catchPct) },

  { key: 'ppg',        group: 'Production',  label: 'Fantasy points / game', dir: 'high',    fmt: 2, get: s => num(s.st.fantasyPPG) },
  { key: 'ypg',        group: 'Production',  label: 'Rushing yards / game',  dir: 'high',    fmt: 1, get: s => num(s.st.rushYPG) },
  { key: 'tdPerG',     group: 'Production',  label: 'Touchdowns / game',     dir: 'high',    fmt: 2, get: s => per(add(s.st.rushTD, s.st.recTD), s.st.games) },
  { key: 'boomRate',   group: 'Production',  label: 'Boom rate',             dir: 'high',    fmt: 0, unit: '%', get: s => num(s.vol && s.vol.boomRate) },
  { key: 'bustRate',   group: 'Production',  label: 'Bust rate',             dir: 'low',     fmt: 0, unit: '%', get: s => num(s.vol && s.vol.bustRate) },
];

const PASSING = [
  { key: 'attPerG',    group: 'Opportunity', label: 'Attempts / game',       dir: 'high',    fmt: 1, get: s => per(s.st.attempts, s.st.games) },
  { key: 'carryPerG',  group: 'Opportunity', label: 'Carries / game',        dir: 'high',    fmt: 1, get: s => per(s.st.carries, s.st.games) },

  { key: 'compPct',    group: 'Efficiency',  label: 'Completion rate',       dir: 'high',    fmt: 1, unit: '%', get: s => num(s.st.compPct) },
  { key: 'ypa',        group: 'Efficiency',  label: 'Yards per attempt',     dir: 'high',    fmt: 2, get: s => num(s.st.ypa) },
  { key: 'sackPct',    group: 'Efficiency',  label: 'Sack rate',             dir: 'low',     fmt: 1, unit: '%', get: s => num(s.st.sackPct) },
  { key: 'pressPct',   group: 'Efficiency',  label: 'Pressured on',          dir: 'low',     fmt: 1, unit: '%', get: s => num(s.adv && s.adv.passing && s.adv.passing.pressurePct), note: 'of his dropbacks' },
  { key: 'onTarget',   group: 'Efficiency',  label: 'On-target throws',      dir: 'high',    fmt: 1, unit: '%', get: s => num(s.adv && s.adv.passing && s.adv.passing.onTargetPct), note: 'accuracy, minus his receivers’ hands' },
  { key: 'pocket',     group: 'Efficiency',  label: 'Time in the pocket',    dir: 'neutral', fmt: 2, unit: 's', get: s => num(s.adv && s.adv.passing && s.adv.passing.pocketTime), note: 'a style, not a grade' },

  { key: 'ppg',        group: 'Production',  label: 'Fantasy points / game', dir: 'high',    fmt: 2, get: s => num(s.st.fantasyPPG) },
  { key: 'ypg',        group: 'Production',  label: 'Passing yards / game',  dir: 'high',    fmt: 1, get: s => num(s.st.passYPG) },
  { key: 'tdPerG',     group: 'Production',  label: 'Touchdowns / game',     dir: 'high',    fmt: 2, get: s => per(add(s.st.passTD, s.st.rushTD), s.st.games) },
  { key: 'intPerG',    group: 'Production',  label: 'Interceptions / game',  dir: 'low',     fmt: 2, get: s => per(s.st.int, s.st.games) },
  { key: 'boomRate',   group: 'Production',  label: 'Boom rate',             dir: 'high',    fmt: 0, unit: '%', get: s => num(s.vol && s.vol.boomRate) },
  { key: 'bustRate',   group: 'Production',  label: 'Bust rate',             dir: 'low',     fmt: 0, unit: '%', get: s => num(s.vol && s.vol.bustRate) },
];

// What counts as volume, per position, and what the floor is measured against.
const SPEC = {
  QB: { metrics: PASSING,   volume: s => num(s.st.attempts), volumeLabel: 'pass attempts' },
  RB: { metrics: RUSHING,   volume: s => add(s.st.carries, s.st.targets), volumeLabel: 'touches' },
  WR: { metrics: RECEIVING, volume: s => num(s.st.targets), volumeLabel: 'targets' },
  TE: { metrics: RECEIVING, volume: s => num(s.st.targets), volumeLabel: 'targets' },
};

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function add(a, b) {
  const x = num(a), y = num(b);
  if (x === null && y === null) return null;
  return (x || 0) + (y || 0);
}
// A rate needs a denominator. Zero games is not "zero per game", it is no
// answer, and returning 0 would rank him last at a thing he never did.
function per(top, bottom) {
  const t = num(top), b = num(bottom);
  if (t === null || b === null || b === 0) return null;
  return t / b;
}
// PFR publishes drop rate as a fraction; the page prints percentages.
function pct100(v) {
  const n = num(v);
  return n === null ? null : n * 100;
}

// The published number, and therefore the number that gets ranked. Both sides
// have to use this or the file disagrees with itself.
function round(v, fmt) {
  return +Number(v).toFixed(fmt);
}

function median(nums) {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Percentile and rank for one value inside one distribution.
 *
 * TIES SHARE A RANK AND A PERCENTILE. Eleven receivers caught 100% of two
 * targets; ordering them by array position would hand one of them 99th and
 * another 91st for identical seasons. The midpoint convention — half the ties
 * counted as below — is what makes the number reproducible.
 *
 * `dir: 'low'` inverts, so 100 always reads as "the good end" and the bar is
 * never a trick. Drop rate is the case: the best drop rate is the lowest, and
 * publishing it as the 4th percentile beside a green bar would be a lie in two
 * directions at once.
 */
function place(value, sorted, dir) {
  const n = sorted.length;
  let below = 0, equal = 0;
  for (const v of sorted) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  const ascending = (below + equal / 2) / n;          // share of the pool at or under him
  const share = dir === 'low' ? 1 - ascending : ascending;
  const pct = Math.round(share * 100);
  // Rank counts everyone strictly better, so ties share the best rank of the
  // group — the same convention every leaderboard on the site already uses.
  let better = 0;
  for (const v of sorted) {
    if (dir === 'low' ? v < value : v > value) better++;
  }
  return { p: Math.max(0, Math.min(100, pct)), r: better + 1 };
}

async function main() {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
  const pool = read('players.json');
  const stats = read('stats.json');
  const advstats = read('advstats.json');
  const ngs = read('ngs.json');
  const charting = read('charting.json');

  // The season this is ABOUT, which is not always the newest season on file.
  // Same distinction player-usage.json now carries: `live` is what the league
  // is playing, `season` is what there is enough data to describe.
  //
  // THROUGH THE SHARED HELPER, NOT off the calendar. Deriving it here from
  // fromDate() was the first version and it published live: 2025 on the opening
  // day of 2026 — the date fallback is deliberately conservative and only
  // concedes a season has started on September 11th. player-usage.json, built
  // an hour earlier off latestDataSeason(), said 2026 in the same tree. Two
  // files disagreeing about what year it is is the exact shape of every
  // rollover bug this pipeline has had.
  const live = await seasonLib.latestDataSeason();
  log(`league is in ${await seasonLib.describe()}`);

  const seasonsOnFile = new Set();
  for (const id of Object.keys(stats)) {
    const row = stats[id];
    if (row && row.seasons) for (const y of Object.keys(row.seasons)) seasonsOnFile.add(Number(y));
  }
  const years = [...seasonsOnFile].sort((a, b) => b - a);
  if (!years.length) throw new Error('stats.json carries no seasons');

  // THE NEWEST SEASON IS NOT AUTOMATICALLY THE RIGHT ONE. In week 2 it holds one
  // game per player, and a percentile drawn over one game is a coin flip with a
  // decimal point. Walk back until there is a season worth ranking, and say
  // which one was chosen.
  let season = null, medianGames = null;
  for (const y of years) {
    const games = [];
    for (const id of Object.keys(stats)) {
      const s = stats[id] && stats[id].seasons && stats[id].seasons[y];
      if (s && num(s.games)) games.push(num(s.games));
    }
    const med = median(games);
    if (med !== null && med >= MIN_MEDIAN_GAMES) { season = y; medianGames = med; break; }
    log(`${y} has a median of ${med === null ? 'no' : med} games per player — too thin to rank, looking further back`);
  }
  if (season === null) {
    season = years[0];
    medianGames = 0;
    log(`no season reaches ${MIN_MEDIAN_GAMES} games; publishing ${season} and marking it thin`);
  }

  const poolPos = new Map(pool.map(p => [p.id, p.pos]));
  const poolName = new Map(pool.map(p => [p.id, p.name]));

  // Everything one player contributes, gathered once.
  const rows = new Map();
  for (const id of Object.keys(stats)) {
    const pos = poolPos.get(id);
    if (!pos || !SPEC[pos]) continue;                 // not in the pool, or not a scoring position
    const st = stats[id] && stats[id].seasons && stats[id].seasons[season];
    if (!st) continue;
    const advPlayer = advstats.players && advstats.players[id];
    rows.set(id, {
      pos,
      st,
      vol: (st.volatility && typeof st.volatility === 'object') ? st.volatility : null,
      adv: (advPlayer && advPlayer.seasons && advPlayer.seasons[season]) || null,
      ngs: (ngs[id] && ngs[id][season]) || null,
      ch: (charting.seasons && charting.seasons[season] && charting.seasons[season].players
        && charting.seasons[season].players[id]) || null,
    });
  }

  const groups = {};
  const pools = {};
  const players = {};

  for (const pos of Object.keys(SPEC)) {
    const spec = SPEC[pos];
    const eligible = [...rows.entries()].filter(([, r]) => r.pos === pos);

    // The floor, as a share of the pool leader. Stated in meta so the page can
    // print the actual number rather than the rule.
    const volumes = eligible.map(([, r]) => spec.volume(r)).filter(v => v !== null);
    const maxVol = volumes.length ? Math.max(...volumes) : 0;
    const floor = Math.round(maxVol * FLOOR_SHARE);
    const qualified = eligible.filter(([, r]) => (spec.volume(r) || 0) >= floor);

    pools[pos] = {
      qualified: qualified.length,
      eligible: eligible.length,
      floor,
      floorLabel: `${floor}+ ${spec.volumeLabel} (${Math.round(FLOOR_SHARE * 100)}% of the pool leader's ${maxVol})`,
    };

    groups[pos] = spec.metrics.map(m => ({
      key: m.key, group: m.group, label: m.label, dir: m.dir,
      fmt: m.fmt, unit: m.unit || '', note: m.note || '',
    }));

    if (qualified.length < MIN_POOL) {
      log(`${pos}: ${qualified.length} qualified of ${eligible.length} — under the ${MIN_POOL} needed for a distribution, publishing none`);
      pools[pos].qualified = qualified.length;
      pools[pos].tooSmall = true;
      continue;
    }

    // One sorted distribution per metric, built from the qualified pool only.
    // A player under the floor is measured against it but is never IN it —
    // otherwise the four-target receiver both distorts the scale and gets a
    // percentile off a scale he distorted.
    //
    // ROUNDED FIRST, THEN RANKED. The value is published to `fmt` decimals and
    // the rank was being computed on the full-precision number underneath it —
    // so two quarterbacks on 26.94 and 26.87 attempts a game both printed 26.9
    // and ranked #29 and #30. Nothing is out of range and nothing errors; the
    // file simply shows a reader two identical numbers and tells him one of
    // them is better. Ranking the number that is actually published makes the
    // two agree by construction rather than by luck of the decimals.
    const dists = {};
    for (const m of spec.metrics) {
      const vals = [];
      for (const [, r] of qualified) {
        const v = m.get(r);
        if (v !== null) vals.push(round(v, m.fmt));
      }
      dists[m.key] = vals.sort((a, b) => a - b);
    }

    const floorOf = new Set(qualified.map(([id]) => id));
    for (const [id, r] of eligible) {
      const out = {};
      for (const m of spec.metrics) {
        const raw = m.get(r);
        if (raw === null) continue;                   // absent, not zero
        const dist = dists[m.key];
        if (dist.length < MIN_POOL) continue;         // this metric is too sparse even if the pool is not
        const v = round(raw, m.fmt);
        const { p, r: rank } = place(v, dist, m.dir);
        out[m.key] = { v, p, r: rank };
      }
      if (!Object.keys(out).length) continue;
      players[id] = {
        pos,
        name: poolName.get(id) || (stats[id] && stats[id].name) || id,
        games: num(r.st.games),
        qualified: floorOf.has(id),
        stats: out,
      };
    }
    log(`${pos}: ${qualified.length} qualified of ${eligible.length} tracked · floor ${pools[pos].floorLabel}`);
  }

  const out = {
    meta: {
      generated: new Date().toISOString(),
      season,
      // The same season, as the array every generic guard over data/*.json
      // looks for. tests/no-simulated-data.test.js walks the directory checking
      // meta.seasons for a year the league has not played; a file that names
      // its season under a key of its own invention is simply not checked, and
      // "not checked" is indistinguishable from "passing" in a green run.
      seasons: [season],
      live,
      medianGames,
      thin: medianGames < MIN_MEDIAN_GAMES,
      source: 'a second reading of stats.json, advstats.json, ngs.json and charting.json — nothing is fetched and nothing is modelled',
      pools,
      pool: 'The Signal’s tracked players, not the whole league. A rank of #12 here means twelfth of the receivers on this site who cleared the volume floor.',
      caveats: [
        'A percentile is a position in a distribution, not a grade. Metrics marked neutral describe a role — where a player is used — and carry no good end.',
        'Ties share a rank and a percentile, so two identical seasons are never separated by array order.',
        'A metric a player has no measurement for is absent rather than zero: an unmeasured thing must not rank him last at it.',
        'Players under the floor keep their percentile against the qualified pool but are marked unqualified, because a rate over four targets is not a season.',
      ],
    },
    groups,
    players,
  };

  const wrote = writeJSONIfChanged(OUT, out);
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  log(`${wrote ? 'wrote' : 'unchanged —'} percentiles.json: ${Object.keys(players).length} players over ${season}${out.meta.thin ? ' (THIN)' : ''} — ${kb}KB`);
}

main().catch(e => { console.error(`[percentiles] ${e.stack || e.message}`); process.exit(1); });
