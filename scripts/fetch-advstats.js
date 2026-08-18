#!/usr/bin/env node
/**
 * fetch-advstats.js — Pro Football Reference advanced stats → data/advstats.json
 *
 * WHAT THIS ADDS THAT WE DID NOT HAVE
 * Every receiving layer here so far answers volume: targets, catches, yards,
 * snaps, which personnel package he was on the field for. None of it separates
 * what a player DID from what was done to him. PFR's advanced splits do:
 *
 *   receiving  ybc / yac      yards the quarterback earned him before the catch
 *                             against yards he made himself after it
 *              brk_tkl        tackles broken — the same as yac but attributable
 *              drop, drop_pct the negative side, which no volume stat shows
 *              adot           how far downfield he is actually used
 *   rushing    ybc / yac      blocking versus back, the oldest argument in
 *                             fantasy, finally with a number on each side
 *   passing    pressure_pct   how often he plays under duress
 *              pocket_time    and how long he gets
 *              on_tgt_pct     accuracy separated from his receivers' hands
 *              bad_throw_pct
 *   defense    cmp_percent    how a defender fares WHEN TARGETED, plus rating
 *              yds_tgt        allowed, missed-tackle rate, pressure and blitz
 *                             counts. This is the matchup layer.
 *
 * THE JOIN IS BY ID, NOT BY NAME. PFR keys on pfr_id, we key on our own slug,
 * and lib/ids.js bridges them through nflverse's own crosswalk — 339 of 350.
 * Name matching a second data source would reintroduce exactly the hazard the
 * GSIS backfill was written to remove.
 *
 * A FAILED FETCH FAILS THE RUN. nflverse moved the stats file once and a
 * per-season try/catch swallowed the 404 for months.
 *
 *   node scripts/fetch-advstats.js
 *   node scripts/fetch-advstats.js --dry
 */

const fs = require('fs');
const path = require('path');
const { fetchCSV, parseCSV } = require('./lib/match');
const { poolCrosswalk } = require('./lib/ids');
const seasonLib = require('./lib/season');
const { teamKey, isTeam } = require('./lib/teams');

const DATA = path.join(__dirname, '..', 'data');
const BASE = 'https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats';

// Which columns are worth keeping, and what to call them. The raw files carry
// identity columns we already have (player, tm, age, pos, g, gs) — re-storing
// them would be a second copy of the pool that can drift from the first.
const SPLITS = {
  rec: {
    file: 'advstats_season_rec.csv',
    label: 'receiving',
    keep: {
      tgt: 'targets', rec: 'rec', yds: 'yards', td: 'td', x1d: 'firstDowns',
      ybc: 'yardsBeforeCatch', ybc_r: 'ybcPerRec', yac: 'yardsAfterCatch', yac_r: 'yacPerRec',
      adot: 'aDOT', brk_tkl: 'brokenTackles', rec_br: 'recPerBrokenTackle',
      drop: 'drops', drop_percent: 'dropPct', rat: 'passerRatingWhenTargeted',
    },
  },
  rush: {
    file: 'advstats_season_rush.csv',
    label: 'rushing',
    keep: {
      att: 'attempts', yds: 'yards', td: 'td', x1d: 'firstDowns',
      ybc: 'yardsBeforeContact', ybc_att: 'ybcPerAttempt',
      yac: 'yardsAfterContact', yac_att: 'yacPerAttempt',
      brk_tkl: 'brokenTackles', att_br: 'attPerBrokenTackle',
    },
  },
  pass: {
    file: 'advstats_season_pass.csv',
    label: 'passing',
    keep: {
      pass_attempts: 'attempts', throwaways: 'throwaways', spikes: 'spikes',
      drops: 'dropsByReceivers', drop_pct: 'dropPctByReceivers',
      bad_throws: 'badThrows', bad_throw_pct: 'badThrowPct',
      pocket_time: 'pocketTime', times_blitzed: 'timesBlitzed', times_hurried: 'timesHurried',
      times_hit: 'timesHit', times_pressured: 'timesPressured', pressure_pct: 'pressurePct',
      on_tgt_throws: 'onTargetThrows', on_tgt_pct: 'onTargetPct',
      rpo_plays: 'rpoPlays', rpo_yards: 'rpoYards', pa_pass_att: 'playActionAtt', pa_pass_yards: 'playActionYards',
    },
  },
  def: {
    file: 'advstats_season_def.csv',
    label: 'defense',
    keep: {
      int: 'int', tgt: 'targetedAt', cmp: 'completionsAllowed', cmp_percent: 'completionPctAllowed',
      yds: 'yardsAllowed', yds_cmp: 'yardsPerCompletionAllowed', yds_tgt: 'yardsPerTargetAllowed',
      td: 'tdAllowed', rat: 'passerRatingAllowed', dadot: 'averageDepthOfTargets',
      bltz: 'blitzes', hrry: 'hurries', qbkd: 'qbKnockdowns', sk: 'sacks', prss: 'pressures',
      comb: 'tacklesCombined', m_tkl: 'missedTackles', m_tkl_percent: 'missedTacklePct',
    },
  },
};

function pick(row, keep) {
  const out = {};
  for (const [from, to] of Object.entries(keep)) {
    const v = row[from];
    if (v !== null && v !== undefined && v !== '') out[to] = v;
  }
  return Object.keys(out).length ? out : null;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const seasons = await seasonLib.dataSeasons(3);
  console.log(`[advstats] seasons ${seasons.join(', ')} — league is in ${await seasonLib.describe()}`);

  const pool = JSON.parse(fs.readFileSync(path.join(DATA, 'players.json'), 'utf8'));
  const { fromForeign: fromPfr, toForeign, missing } = await poolCrosswalk(pool, 'pfr');
  console.log(`[advstats] crosswalk: ${toForeign.size}/${pool.length} of the pool carry a pfr_id`
    + (missing.length ? ` (${missing.length} without: ${missing.slice(0, 3).map(m => m.name).join(', ')}${missing.length > 3 ? '…' : ''})` : ''));

  const out = {
    meta: {
      builtBy: 'scripts/fetch-advstats.js',
      builtAt: new Date().toISOString(),
      seasons,
      source: 'Pro Football Reference via nflverse pfr_advstats',
      join: 'gsis_id → pfr_id through nflverse players.csv — ID to ID, no name matching',
      caveats: [
        'Yards before/after the catch split a receiver\'s production from his quarterback\'s; '
        + 'they are descriptive of what happened, not predictive on their own.',
        'Drop rate is charted by a human and the charting standard is not identical across seasons.',
        'Defensive rows are per PLAYER targeted, so a corner shadowing a WR1 and a safety '
        + 'cleaning up short throws are not comparable on rating allowed alone.',
      ],
    },
    players: {},
  };

  let anyRows = 0;
  for (const [key, spec] of Object.entries(SPLITS)) {
    if (key === 'def') continue;   // handled below, by team rather than by player
    // The season-level file carries every season in one download, which is one
    // request instead of three and the reason this is cheap to run daily.
    const url = `${BASE}/${spec.file}`;
    let rows;
    try {
      rows = parseCSV(await fetchCSV(url));
    } catch (e) {
      // Loud, not swallowed. A missing split is a real hole in the product.
      throw new Error(`${spec.label} split unavailable (${url}): ${e.message}`);
    }

    let matched = 0;
    for (const row of rows) {
      if (!seasons.includes(Number(row.season))) continue;
      const player = row.pfr_id ? fromPfr.get(String(row.pfr_id)) : null;
      if (!player) continue;
      const vals = pick(row, spec.keep);
      if (!vals) continue;
      matched++;
      const bucket = (out.players[player.id] = out.players[player.id] || { name: player.name, pos: player.pos, seasons: {} });
      const yr = (bucket.seasons[row.season] = bucket.seasons[row.season] || {});
      yr[spec.label] = vals;
    }
    anyRows += matched;
    console.log(`[advstats] ${spec.label.padEnd(9)} ${rows.length} rows → ${matched} matched to the pool`);
  }

  if (!anyRows) {
    throw new Error('every split matched zero players — the crosswalk or the file layout has changed');
  }

  // ---- Defence, by TEAM rather than by player -----------------------------
  //
  // Keyed by player this split matched 22 of our 350, and correctly so: the pool
  // is quarterbacks, backs, receivers and tight ends, and the people being
  // charted here are the defenders covering them. Stored per player it is
  // useless to us.
  //
  // Aggregated per team it becomes the thing the site does not have at all — a
  // matchup layer built on what defenders actually allow WHEN TARGETED, rather
  // than on points conceded, which is mostly a story about how often a defence
  // was on the field.
  //
  // Rates are recomputed from the totals, never averaged from the per-player
  // rates: averaging percentages across players with 12 and 120 targets weights
  // a nickel corner's afternoon the same as a No.1's season.
  const defSpec = SPLITS.def;
  const defRows = parseCSV(await fetchCSV(`${BASE}/${defSpec.file}`));
  const byTeam = {};
  let defUsed = 0;
  for (const row of defRows) {
    if (!seasons.includes(Number(row.season))) continue;
    // teamKey folds nflverse's `LA` into `LAR`; isTeam rejects PFR's 2TM/3TM
    // markers, which are not franchises and would double-count traded players.
    const team = teamKey(row.tm);
    if (!isTeam(team)) continue;
    defUsed++;
    const t = (byTeam[team] = byTeam[team] || {});
    const s = (t[row.season] = t[row.season] || {
      targets: 0, completions: 0, yards: 0, td: 0, int: 0,
      blitzes: 0, hurries: 0, pressures: 0, sacks: 0,
      tackles: 0, missedTackles: 0, charted: 0,
    });
    s.charted++;
    s.targets += row.tgt || 0;
    s.completions += row.cmp || 0;
    s.yards += row.yds || 0;
    s.td += row.td || 0;
    s.int += row.int || 0;
    s.blitzes += row.bltz || 0;
    s.hurries += row.hrry || 0;
    s.pressures += row.prss || 0;
    s.sacks += row.sk || 0;
    s.tackles += row.comb || 0;
    s.missedTackles += row.m_tkl || 0;
  }
  for (const seasonsOfTeam of Object.values(byTeam)) {
    for (const s of Object.values(seasonsOfTeam)) {
      s.completionPctAllowed = s.targets ? +(100 * s.completions / s.targets).toFixed(1) : null;
      s.yardsPerTargetAllowed = s.targets ? +(s.yards / s.targets).toFixed(2) : null;
      s.missedTacklePct = (s.tackles + s.missedTackles)
        ? +(100 * s.missedTackles / (s.tackles + s.missedTackles)).toFixed(1) : null;
    }
  }
  const teamCount = Object.keys(byTeam).length;
  if (teamCount < 30) {
    throw new Error(`defence aggregated to only ${teamCount} teams — expected 32`);
  }
  out.defenseByTeam = byTeam;
  out.meta.defenseNote = 'aggregated across every charted defender on the team; rates recomputed '
    + 'from totals rather than averaged across players, so a nickel corner\'s 12 targets do not '
    + 'weigh the same as a No.1 corner\'s season';
  console.log(`[advstats] defense   ${defRows.length} rows → ${defUsed} defenders aggregated into ${teamCount} teams`);

  const covered = Object.keys(out.players).length;
  out.meta.coverage = { players: covered, of: pool.length };
  console.log(`[advstats] ${covered}/${pool.length} players have at least one advanced split`);

  if (dry) { console.log('[advstats] dry run — nothing written'); return; }
  fs.writeFileSync(path.join(DATA, 'advstats.json'), JSON.stringify(out, null, 2));
  const kb = (fs.statSync(path.join(DATA, 'advstats.json')).size / 1024).toFixed(0);
  console.log(`[advstats] wrote data/advstats.json (${kb}KB)`);
}

main().catch(e => {
  console.error('[advstats] FAILED:', e.message);
  process.exit(1);
});
