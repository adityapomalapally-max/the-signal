#!/usr/bin/env node
/**
 * research-rushing-environment.js — is the expectation a team signal, and is
 * RYOE worth projecting from?
 *
 * RESEARCH, NOT A BUILD. It writes no data file and is not in the Action, the
 * same bargain as research-vegas-weather.js and research-matchup-stability.js.
 * It exists so two claims get answered by a measurement rather than repeated
 * from a magazine, and so the answer can be reproduced rather than remembered.
 *
 * THE TWO QUESTIONS
 *
 * 1. Next Gen Stats computes an EXPECTED yards figure for every carry from the
 *    position, speed and direction of all 22 players at the handoff. The claim
 *    that makes it interesting for a team environment score is that the
 *    expectation is mostly about the picture the blocking created — so a team's
 *    average expected yards per carry ought to behave like an offensive-line
 *    rating, and ought to persist year over year the way a line does and a
 *    running back does not.
 *
 * 2. RYOE is widely quoted as a talent measure. If it is going to sit on a page
 *    here it has to carry its own stickiness, because a number that does not
 *    repeat is a description of last season and not a forecast.
 *
 * Run: node scripts/research-rushing-environment.js
 */

const { fetchCSV, parseCSV } = require('./lib/match');
const { teamKey } = require('./lib/teams');

const NGS = 'https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_rushing.csv.gz';

// RYOE is null before 2018 in this release; the columns exist and are empty.
const FIRST_RYOE_SEASON = 2018;
// A back needs enough carries in BOTH seasons before a year-over-year figure
// means anything. 100 is the threshold the public writing uses.
const MIN_ATT = 100;

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

function correlation(pairs) {
  if (pairs.length < 3) return null;
  const xs = pairs.map((p) => p[0]), ys = pairs.map((p) => p[1]);
  const mx = mean(xs), my = mean(ys);
  let num2 = 0, dx = 0, dy = 0;
  for (const [x, y] of pairs) { num2 += (x - mx) * (y - my); dx += (x - mx) ** 2; dy += (y - my) ** 2; }
  return dx && dy ? num2 / Math.sqrt(dx * dy) : null;
}

async function main() {
  const rows = parseCSV(await fetchCSV(NGS));
  // week 0 rows are the regular-season aggregate per player-season.
  const seasons = rows.filter((r) => String(r.week) === '0' && r.season_type === 'REG'
    && Number(r.season) >= FIRST_RYOE_SEASON && num(r.rush_yards_over_expected) !== null);

  console.log(`[research] ${seasons.length} player-seasons with RYOE, ${FIRST_RYOE_SEASON}-2025\n`);

  // ---- 1. the expectation as a team signal ---------------------------------
  // Attempt-weighted, because a team's environment is the average over its
  // carries and not the average over the backs who took them.
  const teamSeason = new Map();   // `${team}|${season}` -> {att, expYards, actual}
  for (const r of seasons) {
    const att = num(r.rush_attempts), exp = num(r.expected_rush_yards), act = num(r.rush_yards);
    if (!att || exp === null) continue;
    const key = `${teamKey(r.team_abbr)}|${r.season}`;
    const cur = teamSeason.get(key) || { att: 0, exp: 0, act: 0 };
    cur.att += att; cur.exp += exp; cur.act += act;
    teamSeason.set(key, cur);
  }
  const teamExp = [...teamSeason.entries()]
    .filter(([, v]) => v.att >= 200)          // a team-season of real volume
    .map(([k, v]) => {
      const [team, season] = k.split('|');
      return { team, season: Number(season), expPerAtt: v.exp / v.att, actPerAtt: v.act / v.att, att: v.att };
    });

  const latest = Math.max(...teamExp.map((t) => t.season));
  const board = teamExp.filter((t) => t.season === latest).sort((a, b) => b.expPerAtt - a.expPerAtt);
  console.log(`EXPECTED YARDS PER CARRY BY TEAM — ${latest} (the blocking picture at handoff)`);
  board.slice(0, 6).forEach((t, i) => console.log(`  ${String(i + 1).padStart(2)}. ${t.team}  ${t.expPerAtt.toFixed(2)}  (${t.att} carries)`));
  console.log('  ...');
  board.slice(-4).forEach((t, i) => console.log(`  ${String(board.length - 3 + i).padStart(2)}. ${t.team}  ${t.expPerAtt.toFixed(2)}  (${t.att} carries)`));
  const spread = board[0].expPerAtt - board[board.length - 1].expPerAtt;
  console.log(`  spread top to bottom: ${spread.toFixed(2)} yards per carry\n`);

  // Does a team's expectation persist? A line is a unit that mostly returns.
  const byTeam = new Map();
  for (const t of teamExp) {
    const arr = byTeam.get(t.team) || [];
    arr.push(t); byTeam.set(t.team, arr);
  }
  const teamPairs = [];
  for (const arr of byTeam.values()) {
    arr.sort((a, b) => a.season - b.season);
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].season === arr[i - 1].season + 1) teamPairs.push([arr[i - 1].expPerAtt, arr[i].expPerAtt]);
    }
  }
  console.log(`TEAM EXPECTATION, YEAR OVER YEAR: r = ${correlation(teamPairs).toFixed(2)} over ${teamPairs.length} team-season pairs`);

  // ---- 2. is RYOE sticky for the PLAYER? -----------------------------------
  const byPlayer = new Map();
  for (const r of seasons) {
    const att = num(r.rush_attempts);
    if (!att || att < MIN_ATT) continue;
    const id = r.player_gsis_id || r.player_display_name;
    const arr = byPlayer.get(id) || [];
    arr.push({
      season: Number(r.season), att,
      ryoePerAtt: num(r.rush_yards_over_expected_per_att),
      pctOE: num(r.rush_pct_over_expected),
      ypc: num(r.avg_rush_yards),
      expPerAtt: num(r.expected_rush_yards) / att,
    });
    byPlayer.set(id, arr);
  }
  const metrics = { ryoePerAtt: [], pctOE: [], ypc: [], expPerAtt: [] };
  for (const arr of byPlayer.values()) {
    arr.sort((a, b) => a.season - b.season);
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].season !== arr[i - 1].season + 1) continue;
      for (const m of Object.keys(metrics)) {
        if (arr[i - 1][m] !== null && arr[i][m] !== null) metrics[m].push([arr[i - 1][m], arr[i][m]]);
      }
    }
  }
  console.log(`\nYEAR OVER YEAR FOR A BACK (${MIN_ATT}+ carries in both seasons)`);
  for (const [m, pairs] of Object.entries(metrics)) {
    const r = correlation(pairs);
    console.log(`  ${m.padEnd(11)} r = ${r === null ? 'n/a' : r.toFixed(2)}  over ${pairs.length} pairs`);
  }

  // ---- 2b. does an INDEPENDENT source say the same thing about the line? ---
  // NGS builds its expectation from tracking at the handoff. Pro Football
  // Reference charts yards before contact by watching the play. They are
  // different measurements from different vendors, so if the team ordering
  // agrees, the expectation is picking up blocking rather than an artefact of
  // the model. (PFR, deliberately — not PFF.)
  // THE TEAM HAS TO BE THE ONE HE PLAYED FOR THAT SEASON. The first version of
  // this read advstats.json and took each player's team from the current pool,
  // which attributes a 2023 season to whoever employs him today — the traded
  // player trap this repo already has a rule about. It put the agreement at
  // r = 0.15 and made the two vendors look like they were measuring different
  // sports. The source CSV carries `tm` per season, so it is read directly.
  const PFR = 'https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats/advstats_season_rush.csv';
  const pfr = parseCSV(await fetchCSV(PFR));
  const ybcTeam = new Map();   // `${team}|${season}` -> {att, ybc}
  for (const r of pfr) {
    const att = num(r.att), ybc = num(r.ybc), season = Number(r.season);
    if (!att || ybc === null || season < FIRST_RYOE_SEASON) continue;
    // PFR marks a traded player's combined line 2TM/3TM, which is not a team.
    const tm = String(r.tm || '').toUpperCase();
    if (!tm || /^\dTM$/.test(tm)) continue;
    const key = `${teamKey(tm)}|${season}`;
    const cur = ybcTeam.get(key) || { att: 0, ybc: 0 };
    cur.att += att; cur.ybc += ybc;
    ybcTeam.set(key, cur);
  }
  const agree = [];
  for (const t of teamExp) {
    const hit = ybcTeam.get(`${t.team}|${t.season}`);
    if (!hit || hit.att < 150) continue;
    agree.push([t.expPerAtt, hit.ybc / hit.att]);
  }
  const rAgree = correlation(agree);
  console.log(`\nTHE SAME LINE, TWO VENDORS: NGS expected yards/att against PFR yards before contact/att`);
  console.log(`  r = ${rAgree === null ? 'n/a' : rAgree.toFixed(2)} over ${agree.length} team-seasons`);
  console.log('  (tracking at the handoff versus a human charting the play — they do not share a model)');

  // ---- 2c. what else is inside the expectation? ---------------------------
  // A high expectation could be good blocking or it could be light boxes, and
  // light boxes are mostly a fact about game script and the passing game. If
  // the two move together the score is not purely a line rating and must not
  // be sold as one.
  try {
    const scheme = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'scheme.json'), 'utf8'));
    const boxPairs = [];
    for (const t of teamExp) {
      const st = ((scheme.seasons || {})[t.season] || {})[t.team];
      const box = st && (st.boxAvg ?? st.defendersInBox ?? (st.run && st.run.boxAvg));
      if (typeof box === 'number') boxPairs.push([t.expPerAtt, box]);
    }
    if (boxPairs.length > 10) {
      console.log(`\nWHAT ELSE IS IN IT: expected yards/att against defenders in the box`);
      console.log(`  r = ${correlation(boxPairs).toFixed(2)} over ${boxPairs.length} team-seasons`);
    } else {
      console.log(`\nWHAT ELSE IS IN IT: only ${boxPairs.length} team-seasons carried a box figure — check scheme.json's shape`);
    }
  } catch (e) {
    console.log(`\nWHAT ELSE IS IN IT: scheme.json unreadable (${e.message})`);
  }

  // ---- 3. how much of a season's RYOE is a handful of runs? ----------------
  // The distribution matters: if it is explosion-driven then a small sample is
  // not a small measurement, it is a different measurement.
  console.log('\nSHAPE OF THE NUMBER');
  const perAtt = seasons.map((r) => num(r.rush_yards_over_expected_per_att)).filter((v) => v !== null).sort((a, b) => a - b);
  const q = (p) => perAtt[Math.floor((perAtt.length - 1) * p)];
  console.log(`  RYOE/att across ${perAtt.length} player-seasons: p10 ${q(0.1).toFixed(2)}, median ${q(0.5).toFixed(2)}, p90 ${q(0.9).toFixed(2)}, max ${perAtt[perAtt.length - 1].toFixed(2)}`);
  const m = mean(perAtt);
  const sd = Math.sqrt(mean(perAtt.map((v) => (v - m) ** 2)));
  const skew = mean(perAtt.map((v) => ((v - m) / sd) ** 3));
  console.log(`  mean ${m.toFixed(2)}, sd ${sd.toFixed(2)}, skew ${skew.toFixed(2)} (0 would be symmetric)`);
}

main().catch((e) => { console.error(`[research] FATAL: ${e.message}`); process.exit(1); });
