#!/usr/bin/env node
/**
 * build-environment.js — what a skill player is running into → data/environment.json
 *
 * THE QUESTION. Every board on this site measures a PLAYER. None of them
 * measures what he was handed: the line in front of him, the pressure his
 * quarterback plays under, the personnel his coordinator calls. Two backs with
 * identical numbers are not identical if one of them is running behind a top
 * five line, and nothing here said so.
 *
 * TWO READINGS OF THE LINE, AND THEY DO NOT AGREE. That is the finding this
 * file is built around, so it is stated rather than blended away:
 *
 *   Next Gen Stats computes an EXPECTED yards figure for every carry from the
 *   position, speed and direction of all 22 players at the handoff. The
 *   blocking is priced INTO that bar rather than subtracted afterwards, so a
 *   team's average expected yards per carry behaves like a line rating.
 *
 *   Pro Football Reference charts YARDS BEFORE CONTACT by watching the play.
 *   Cruder, but it splits the line's contribution from the back's at the point
 *   of contact, which is the split everyone actually wants.
 *
 *   Measured over 220 team-seasons, they agree at r = 0.32. That is two
 *   vendors, two methods, and only moderate agreement about which lines are
 *   good — so this file publishes BOTH and refuses to average them into one
 *   number that would hide the disagreement. Where they disagree most is the
 *   interesting cell, the same way the matchup board's two columns are.
 *
 * (Deliberately not PFF: their run-blocking grade is the number most often
 * quoted for this and it is a paid, hand-graded product that cannot be checked.
 * Everything here is free, reproducible, and carries its own source.)
 *
 * WHAT PERSISTS AND WHAT DOES NOT. The measurements are computed here rather
 * than quoted from memory, and they travel in meta so the page can print them:
 * the team expectation repeats year over year at about r = 0.44, which is what
 * makes it an environment rather than a result. A back's own RYOE repeats at
 * about 0.22, and as a percentage at 0.09 — which is why RYOE belongs on a
 * player page as a description of what happened and never as a projection.
 *
 * THE TEAM IS THE ONE HE PLAYED FOR THAT SEASON. Both source CSVs carry it per
 * row. Reading it from today's pool instead attributes a 2023 season to
 * whoever employs him now — that single mistake moved the vendor agreement
 * from 0.32 to 0.15 while this was being written.
 *
 * Run: node scripts/build-environment.js
 */

const fs = require('fs');
const path = require('path');
const { fetchCSV, parseCSV } = require('./lib/match');
const { teamKey, isTeam } = require('./lib/teams');
const { writeJSONIfChanged } = require('./lib/write');
const season = require('./lib/season');

const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA, 'environment.json');

const DEPTH = (y) => `https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_${y}.csv`;
const OL = ['LT', 'LG', 'C', 'RG', 'RT'];
const NGS_RUSH = 'https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_rushing.csv.gz';
const PFR = 'https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats';

// NGS publishes the expectation from 2018; the columns exist and are empty
// before that, which is a different thing from a season of zeroes.
const FIRST_RYOE_SEASON = 2018;
// A team-season needs enough carries before an average over them means
// anything. Below this the number is one back's good month.
const MIN_TEAM_CARRIES = 150;
// Same for the passing side.
const MIN_DROPBACKS = 150;

const log = (m) => console.log(`[environment] ${m}`);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const r1 = (n) => (typeof n === 'number' && isFinite(n) ? Math.round(n * 100) / 100 : null);
const readJSON = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; }
function correlation(pairs) {
  if (pairs.length < 3) return null;
  const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
  let n = 0, dx = 0, dy = 0;
  for (const [x, y] of pairs) { n += (x - mx) * (y - my); dx += (x - mx) ** 2; dy += (y - my) ** 2; }
  return dx && dy ? Math.round((n / Math.sqrt(dx * dy)) * 100) / 100 : null;
}

// A traded player's combined PFR line is filed under 2TM/3TM, which is not a
// team. Counting it would put his yards on a franchise that does not exist.
const isRealTeam = (tm) => {
  const t = String(tm || '').toUpperCase();
  // Boolean, not a truthy chain: with `t &&` an empty team code answered with
  // the empty string, which is falsy enough to work and wrong enough to fail a
  // test that asks the question directly. A predicate returns a predicate.
  return Boolean(t) && !/^\d?TM$/.test(t) && Boolean(isTeam(teamKey(t)));
};

/** Rank a map of team → value. Higher is better unless `asc`. */
function rankTeams(byTeam, asc = false) {
  const rows = [...byTeam.entries()].filter(([, v]) => v !== null && isFinite(v));
  rows.sort((a, b) => (asc ? a[1] - b[1] : b[1] - a[1]));
  const out = new Map();
  rows.forEach(([team], i) => out.set(team, i + 1));
  return out;
}

async function main() {
  log(`league is in ${await season.describe()}`);

  // ---- the expectation, from tracking --------------------------------------
  const ngs = parseCSV(await fetchCSV(NGS_RUSH))
    .filter((r) => String(r.week) === '0' && r.season_type === 'REG'
      && Number(r.season) >= FIRST_RYOE_SEASON && num(r.expected_rush_yards) !== null);

  const expByTeam = new Map();   // season -> team -> {att, exp, act}
  for (const r of ngs) {
    const att = num(r.rush_attempts), exp = num(r.expected_rush_yards), act = num(r.rush_yards);
    if (!att || exp === null || !isRealTeam(r.team_abbr)) continue;
    const s = Number(r.season), team = teamKey(r.team_abbr);
    if (!expByTeam.has(s)) expByTeam.set(s, new Map());
    const cur = expByTeam.get(s).get(team) || { att: 0, exp: 0, act: 0 };
    cur.att += att; cur.exp += exp; cur.act += act;
    expByTeam.get(s).set(team, cur);
  }

  // ---- yards before contact, from charting ---------------------------------
  const rush = parseCSV(await fetchCSV(`${PFR}/advstats_season_rush.csv`));
  const ybcByTeam = new Map();
  for (const r of rush) {
    const att = num(r.att), ybc = num(r.ybc), s = Number(r.season);
    if (!att || ybc === null || s < FIRST_RYOE_SEASON || !isRealTeam(r.tm)) continue;
    const team = teamKey(r.tm);
    if (!ybcByTeam.has(s)) ybcByTeam.set(s, new Map());
    const cur = ybcByTeam.get(s).get(team) || { att: 0, ybc: 0, yac: 0 };
    cur.att += att; cur.ybc += ybc; cur.yac += num(r.yac) || 0;
    ybcByTeam.get(s).set(team, cur);
  }

  // ---- what the quarterback plays under ------------------------------------
  const pass = parseCSV(await fetchCSV(`${PFR}/advstats_season_pass.csv`));
  const pressByTeam = new Map();
  // THE PASSING FILE USES DIFFERENT COLUMN NAMES FROM THE RUSHING ONE — `team`
  // not `tm`, `pass_attempts` not `att`, `times_pressured` not `prss`. Reading
  // it with the rushing names produced a complete, silent set of nulls: every
  // team's pressure rate was absent and the board still rendered.
  for (const r of pass) {
    const att = num(r.pass_attempts), pressed = num(r.times_pressured), s = Number(r.season);
    if (!att || pressed === null || s < FIRST_RYOE_SEASON || !isRealTeam(r.team)) continue;
    const team = teamKey(r.team);
    if (!pressByTeam.has(s)) pressByTeam.set(s, new Map());
    const cur = pressByTeam.get(s).get(team) || { att: 0, pressed: 0, pocket: 0, pocketAtt: 0, blitzed: 0 };
    cur.att += att; cur.pressed += pressed;
    cur.blitzed += num(r.times_blitzed) || 0;
    // Pocket time is a per-dropback average, so it is weighted by attempts
    // rather than added — a backup's three games must not count as a season.
    const pt = num(r.pocket_time);
    if (pt !== null) { cur.pocket += pt * att; cur.pocketAtt += att; }
    pressByTeam.get(s).set(team, cur);
  }

  // ---- IS IT STILL THE SAME LINE? -----------------------------------------
  // Everything above measures a season that has been played. The reader is
  // looking at a team about to play a different one, and a line is five men who
  // may or may not still be there — the same problem the matchup board states
  // about defensive personnel, and it applies here with more force, because a
  // single replaced tackle changes what a back is handed.
  //
  // The published depth chart names a starter at each of the five spots before
  // a snap is taken, so the two charts can be compared directly. Joined on the
  // GSIS id, never the name: an offensive lineman is exactly the kind of player
  // whose name is written three ways.
  const currentSeason = await season.targetSeason();
  const startersFor = (rows, team) => {
    const latest = {};
    for (const r of rows) {
      if (teamKey(r.team) !== team) continue;
      const pos = String(r.pos_abb || '').toUpperCase();
      if (!OL.includes(pos)) continue;
      if (String(r.pos_rank) !== '1') continue;
      if (!latest[pos] || String(r.dt) > String(latest[pos].dt)) latest[pos] = r;
    }
    return latest;
  };
  let continuity = new Map();
  try {
    const measuredSeason = Math.max(...[...expByTeam.keys()]);
    const [prevRows, nowRows] = await Promise.all([
      parseCSV(await fetchCSV(DEPTH(measuredSeason))),
      parseCSV(await fetchCSV(DEPTH(currentSeason))),
    ]);
    for (const team of new Set([...prevRows, ...nowRows].map((r) => teamKey(r.team)).filter(isRealTeam))) {
      const before = startersFor(prevRows, team);
      const now = startersFor(nowRows, team);
      const beforeIds = new Set(Object.values(before).map((r) => r.gsis_id).filter(Boolean));
      const spots = Object.keys(now).length;
      if (!spots || !beforeIds.size) continue;
      const returning = Object.values(now).filter((r) => r.gsis_id && beforeIds.has(r.gsis_id));
      continuity.set(team, {
        from: measuredSeason,
        to: Number(currentSeason),
        returning: returning.length,
        of: spots,
        spots: returning.map((r) => String(r.pos_abb).toUpperCase()).sort(),
      });
    }
    log(`line continuity ${measuredSeason} → ${currentSeason}: ${continuity.size} teams compared`);
  } catch (e) {
    // A missing chart for a season that has not started is not a failure; the
    // card simply says nothing about continuity rather than implying none.
    log(`line continuity unavailable: ${e.message}`);
  }

  // ---- scheme and the person calling it ------------------------------------
  const scheme = readJSON('scheme.json');
  const callers = readJSON('playcallers.json').entries || {};
  const callerFor = (team, s) => {
    const hit = Object.values(callers).find((e) => e && e.team === team && Number(e.season) === Number(s));
    if (!hit) return null;
    return {
      headCoach: hit.headCoach || null,
      playCaller: hit.playCaller || null,
      callerIsHeadCoach: hit.callerIsHeadCoach,
      source: hit.source || null,
    };
  };

  // ---- DID THE OFFENCE ITSELF CHANGE? --------------------------------------
  // The one thing about coaching this data can honestly measure. Not whether a
  // coordinator is good — nothing free supports that — but how far the offence
  // MOVED, which is a fact about snaps rather than a grade.
  //
  // Personnel is the measure because it is the clearest statement of intent a
  // coach makes: 11 personnel and 12 personnel are different offences. The
  // number is the share of snaps that moved to a different grouping — half the
  // summed absolute change across groupings, which is the total variation
  // between two distributions.
  //
  // MEASURED, AND THE RESULT IS A WARNING: a change of head coach does NOT
  // predict a change of offence. Median shift with a new coach is about 14
  // points of snaps against about 11 with the same one, on fourteen coaching
  // changes — a difference well inside the noise. Atlanta moved 71 points of
  // snaps when Arthur Smith gave way to Raheem Morris, and then another 42 the
  // following year with Morris still there. So the shift is published per team
  // and the comparison is published beside it, rather than the site implying
  // that a new name means a new offence.
  //
  // AND THE COORDINATOR IS INVISIBLE HERE. playcallers.json is hand-kept and
  // currently empty, so only a HEAD COACH change can be seen — which is likely
  // where the weak signal comes from, because the play-caller is the person who
  // would actually explain it.
  const mixOf = (t) => {
    const out = {};
    for (const [grp, v] of Object.entries((t && t.personnel) || {})) {
      if (v && typeof v.rate === 'number') out[grp] = v.rate;
    }
    return out;
  };
  const identity = new Map();     // `${team}|${season}` -> shift record
  const shiftsSame = [], shiftsChanged = [];
  const schemeYears = (scheme.meta.seasons || []).map(Number).sort((a, b) => a - b);
  for (let i = 1; i < schemeYears.length; i++) {
    const prev = schemeYears[i - 1], now = schemeYears[i];
    for (const [team, cur] of Object.entries(scheme.seasons[now] || {})) {
      const before = (scheme.seasons[prev] || {})[team];
      if (!before) continue;
      const a = mixOf(before), b = mixOf(cur);
      if (!Object.keys(a).length || !Object.keys(b).length) continue;
      let moved = 0;
      const byGroup = [];
      for (const grp of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const delta = (b[grp] || 0) - (a[grp] || 0);
        moved += Math.abs(delta);
        if (Math.abs(delta) >= 3) byGroup.push({ grouping: grp, delta: Math.round(delta * 10) / 10 });
      }
      moved = Math.round((moved / 2) * 10) / 10;
      const coachChanged = Boolean(before.coach && cur.coach && before.coach !== cur.coach);
      (coachChanged ? shiftsChanged : shiftsSame).push(moved);
      identity.set(`${team}|${now}`, {
        from: prev, to: now, snapsMoved: moved, coachChanged,
        fromCoach: before.coach || null, toCoach: cur.coach || null,
        passRateMove: typeof cur.passRate === 'number' && typeof before.passRate === 'number'
          ? Math.round((cur.passRate - before.passRate) * 10) / 10 : null,
        byGroup: byGroup.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 3),
      });
    }
  }
  const median = (arr) => {
    if (!arr.length) return null;
    const s2 = [...arr].sort((x, y) => x - y);
    const mid = Math.floor(s2.length / 2);
    return Math.round((s2.length % 2 ? s2[mid] : (s2[mid - 1] + s2[mid]) / 2) * 10) / 10;
  };

  // ---- assemble ------------------------------------------------------------
  const seasons = {};
  const agreement = [];
  const persistence = [];

  for (const [s, teams] of [...expByTeam.entries()].sort((a, b) => a[0] - b[0])) {
    const expPer = new Map(), ybcPer = new Map(), pressPct = new Map();
    for (const [team, v] of teams) {
      if (v.att >= MIN_TEAM_CARRIES) expPer.set(team, v.exp / v.att);
    }
    for (const [team, v] of (ybcByTeam.get(s) || new Map())) {
      if (v.att >= MIN_TEAM_CARRIES) ybcPer.set(team, v.ybc / v.att);
    }
    for (const [team, v] of (pressByTeam.get(s) || new Map())) {
      if (v.att >= MIN_DROPBACKS) pressPct.set(team, (v.pressed / v.att) * 100);
    }

    const expRank = rankTeams(expPer);
    const ybcRank = rankTeams(ybcPer);
    // Pressure: less is better, so it ranks ascending.
    const pressRank = rankTeams(pressPct, true);

    const teamsOut = {};
    for (const team of new Set([...expPer.keys(), ...ybcPer.keys(), ...pressPct.keys()])) {
      const st = ((scheme.seasons || {})[s] || {})[team] || null;
      const press = pressByTeam.get(s)?.get(team);
      const eR = expRank.get(team) ?? null, yR = ybcRank.get(team) ?? null;
      teamsOut[team] = {
        run: {
          expPerAtt: r1(expPer.get(team) ?? null),
          expRank: eR,
          ybcPerAtt: r1(ybcPer.get(team) ?? null),
          ybcRank: yR,
          // How far apart the two vendors put this line. The interesting cell.
          rankGap: eR !== null && yR !== null ? Math.abs(eR - yR) : null,
          carries: teams.get(team)?.att ?? null,
        },
        pass: {
          pressurePct: r1(pressPct.get(team) ?? null),
          pressureRank: pressRank.get(team) ?? null,
          pocketTime: press && press.pocketAtt ? r1(press.pocket / press.pocketAtt) : null,
          dropbacks: press?.att ?? null,
        },
        // WHO IS THERE NOW, not who was there when the numbers were measured. The
      // card sat on a team page naming a head coach a year after he left.
      continuity: continuity.get(team) || null,
      identity: identity.get(`${team}|${s}`) || null,
      scheme: st ? {
          epaPerPlay: st.epaPerPlay ?? null,
          passRate: st.passRate ?? null,
          boxAvg: st.boxAvg ?? null,
          heavyBoxRate: st.heavyBoxRate ?? null,
          explosiveRate: st.explosiveRate ?? null,
        } : null,
        caller: callerFor(team, currentSeason) || callerFor(team, s),
        callerSeason: callerFor(team, currentSeason) ? Number(currentSeason) : Number(s),
      };
      if (eR !== null && yR !== null) agreement.push([expPer.get(team), ybcPer.get(team)]);
    }
    seasons[s] = teamsOut;
  }

  // Does a team's expectation repeat? Computed here so the page never quotes a
  // number somebody measured once and wrote down.
  const byTeamSeries = new Map();
  for (const [s, teams] of expByTeam) {
    for (const [team, v] of teams) {
      if (v.att < MIN_TEAM_CARRIES) continue;
      const arr = byTeamSeries.get(team) || [];
      arr.push({ season: s, v: v.exp / v.att });
      byTeamSeries.set(team, arr);
    }
  }
  for (const arr of byTeamSeries.values()) {
    arr.sort((a, b) => a.season - b.season);
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].season === arr[i - 1].season + 1) persistence.push([arr[i - 1].v, arr[i].v]);
    }
  }

  const out = {
    meta: {
      generated: new Date().toISOString(),
      builtBy: 'scripts/build-environment.js',
      seasons: Object.keys(seasons).map(Number),
      sources: {
        expected: 'Next Gen Stats expected rush yards — player tracking at the handoff, via nflverse',
        ybc: 'Pro Football Reference advanced rushing — yards before contact, charted',
        pressure: 'Pro Football Reference advanced passing — pressures faced',
        scheme: 'data/scheme.json, built from play-by-play participation',
        caller: 'data/playcallers.json, hand-kept and sourced',
      },
      measured: {
        // What a change of head coach is worth as a predictor of a change of
        // offence: on this evidence, very little.
        identityShiftSameCoach: median(shiftsSame),
        identityShiftNewCoach: median(shiftsChanged),
        identityShiftPairs: { sameCoach: shiftsSame.length, newCoach: shiftsChanged.length },
        vendorAgreement: correlation(agreement),
        vendorAgreementPairs: agreement.length,
        expectationPersistence: correlation(persistence),
        expectationPersistencePairs: persistence.length,
      },
      caveats: [
        'How far an offence moved is measured in personnel — the share of snaps that changed grouping from one season to the next. It is a fact about snaps, not a judgement about coaching, and nothing free supports the judgement.',
        'A change of head coach does not predict it. Atlanta moved 71 points of snaps when the coach changed and 42 the following year when he did not, and across the seasons on file the medians are close enough to be the same number.',
        'Only a HEAD COACH change is visible. The play-caller file is hand-kept and empty, so a coordinator arriving under the same coach — which is where the real explanation usually lives — cannot be seen here at all.',
        'The two readings of a line are not the same measurement and do not agree closely. Expected yards comes from tracking every player at the handoff; yards before contact is charted by watching the play. They are published side by side, and the gap between a team\'s two ranks is shown rather than averaged away.',
        'The expectation is the picture at the handoff, so blocking that develops after it — second level, downfield — leaks into the back\'s number rather than the line\'s.',
        'This describes what a team\'s carries ran into, not what its five linemen are worth. Personnel, defensive attention and game script are all inside it.',
        'Pressure faced is not the line alone either: a quarterback who holds the ball creates some of it, and a quick game hides some of it. Pocket time is published beside it for that reason.',
        'Deliberately not PFF. Their run-blocking grade is the number usually quoted here, and it is a paid hand-graded product nobody outside can check or reproduce.',
      ],
    },
    seasons,
  };

  // A LAYER THAT JOINED NOTHING MUST NOT SHIP. The passing columns are named
  // differently from the rushing ones and reading them with the wrong names
  // produced a full set of nulls that rendered perfectly — every team's
  // pressure rate simply absent, and no error anywhere.
  const latestSeason = Math.max(...Object.keys(seasons).map(Number));
  const withPressure = Object.values(seasons[latestSeason]).filter((t) => t.pass.pressurePct !== null).length;
  if (withPressure < 20) {
    throw new Error(`only ${withPressure} teams have a pressure rate in ${latestSeason} — the passing join has moved`);
  }

  const wrote = writeJSONIfChanged(OUT, out);
  const latest = Math.max(...Object.keys(seasons).map(Number));
  const board = Object.entries(seasons[latest]).filter(([, v]) => v.run.expRank).sort((a, b) => a[1].run.expRank - b[1].run.expRank);
  log(`vendors agree at r=${out.meta.measured.vendorAgreement} over ${agreement.length} team-seasons`);
  log(`the expectation repeats at r=${out.meta.measured.expectationPersistence} over ${persistence.length} pairs`);
  log(`${latest} best blocking picture: ${board.slice(0, 3).map(([t, v]) => `${t} ${v.run.expPerAtt}`).join(', ')}`);
  const gaps = board.filter(([, v]) => v.run.rankGap !== null).sort((a, b) => b[1].run.rankGap - a[1].run.rankGap);
  log(`the vendors disagree most about: ${gaps.slice(0, 3).map(([t, v]) => `${t} (${v.run.expRank} vs ${v.run.ybcRank})`).join(', ')}`);
  log(wrote ? `wrote data/environment.json (${Math.round(fs.statSync(OUT).size / 1024)}KB)` : 'unchanged — not rewritten');
}

// Exported so the guard can be tested on the inputs that actually break it,
// rather than by checking that a function with this name still appears in the
// file. A mutation that gutted it to `return true` passed that check.
module.exports = { isRealTeam, rankTeams, correlation };

if (require.main === module) {
  main().catch((e) => { console.error(`[environment] FATAL: ${e.message}`); process.exit(1); });
}
