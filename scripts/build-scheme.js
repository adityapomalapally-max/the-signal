#!/usr/bin/env node

/**
 * The Signal — Scheme & Identity Builder
 *
 * Generates data/scheme.json: how each team actually lines up, what that draws
 * from the defense, and what it produces.
 *
 * Two nflverse sources, joined per play:
 *   pbp_participation — offense_personnel, offense_formation, defenders_in_box,
 *                       defense_personnel, coverage, pressure
 *   pbp               — play_type, yards_gained, epa
 * The join is game_id + play_id and it is exact: 45,184 of 45,184 rows in 2025.
 *
 * WHY THIS EXISTS. Personnel is the one public number that shows a coach's
 * intent rather than his results. It is also the rare case where the causal
 * story is measurable end to end: heavier personnel draws more defenders into
 * the box, a heavier box is easier to throw over, and the explosive rate moves.
 * The site can show all three links instead of asserting the last one.
 *
 * Run: node scripts/build-scheme.js                 (current season only)
 *      node scripts/build-scheme.js --all           (rebuild every season)
 *      node scripts/build-scheme.js --seasons 2024,2025
 *
 * Past seasons never change, so the default run refreshes only the live one and
 * keeps the rest from the committed file. That is what keeps this affordable in
 * the daily Action: one season is ~70MB, all of them is not.
 */

const fs = require('fs');
const path = require('path');
const { fetchCSV, parseCSV, parseCSVLine } = require('./lib/match');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA_DIR, 'scheme.json');
const OUT_USAGE = path.join(DATA_DIR, 'player-usage.json');
const OUT_CHARTING = path.join(DATA_DIR, 'charting.json');

// The seasons participation data covers well. 2016-2022 exists but the schema
// and the league both moved; three seasons is enough to read a trend and short
// enough that every number on the page is about the current game.
const HISTORY = [2023, 2024, 2025];

// An NFL season is named for the year it starts, and starts in September.
function currentSeason(now = new Date()) {
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

// Explosive play, stated so nobody has to guess: 20+ yards passing, 10+ rushing.
// These are the conventional thresholds; the number moves a lot if you change
// them, so the page prints the definition next to the figure.
const EXPLOSIVE_PASS = 20;
const EXPLOSIVE_RUSH = 10;

// A box of 7+ is "loaded" — the defense has committed an extra man to the run
// and is short a defender in coverage.
const HEAVY_BOX = 7;

// Below this a grouping's splits are noise wearing a number's clothes. Reported
// as present in the mix, but no EPA or explosive rate is drawn for it.
const MIN_GROUPING_PLAYS = 40;

// A player's mix off a handful of snaps describes one game plan, not a role.
const MIN_USAGE_SNAPS = 100;

function log(msg) { console.log(`[scheme] ${msg}`); }

// nflverse calls the Rams LA; every other file on this site calls them LAR.
// Unaliased, scheme.json is keyed differently from teams.json and the Rams'
// whole section renders as nothing — a silent join failure, not an error.
// The alias lives in lib/teams.js now — fetch-advstats.js hit the identical
// Rams trap, and a second copy is a copy that will drift.
const { TEAM_ALIAS, teamKey } = require('./lib/teams');

// Zero defenders in the box is not a reading, it is an unrecorded value — it
// occurs on 9,093 of 45,184 rows in 2025. Averaged in as a zero it drags every
// box figure on the page down. Empty beats wrong.
function boxOrNull(raw) {
  const n = parseFloat(raw);
  return (Number.isNaN(n) || n <= 0) ? null : n;
}

// Positions that mean this is not an offensive scrimmage snap. Participation
// includes punts and kickoffs, whose "offense personnel" is a coverage unit.
const NON_OFFENSE = /\b(CB|FS|SS|DB|LB|ILB|OLB|MLB|DE|DT|NT|K|P|LS)\b/;

/**
 * "1 RB, 2 TE, 2 WR" -> "12". First digit backs, second tight ends, which is
 * how everyone in football says it. FB counts as a back, so 21 personnel is
 * two backs and one tight end.
 */
function grouping(personnel) {
  if (!personnel || NON_OFFENSE.test(personnel)) return null;
  const counts = {};
  for (const part of personnel.split(',')) {
    const m = part.trim().match(/^(\d+)\s+([A-Z]+)$/);
    if (m) counts[m[2]] = Number(m[1]);
  }
  const backs = (counts.RB || 0) + (counts.FB || 0);
  const tes = counts.TE || 0;
  // A snap with no skill players at all is a spike, kneel or bad row.
  if (!counts.WR && !tes && !backs) return null;
  return `${backs}${tes}`;
}

// pbp is ~380 columns and we need six. Building full objects for 48k rows of
// that is minutes of work and a lot of memory for nothing.
function leanPbp(csv) {
  const lines = csv.split('\n');
  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const idx = {};
  for (const col of ['game_id', 'play_id', 'play_type', 'yards_gained', 'epa', 'pass', 'rush']) {
    idx[col] = header.indexOf(col);
    if (idx[col] === -1) throw new Error(`pbp is missing the ${col} column — the schema moved`);
  }
  // The charting layer needs to know WHO a charted pass went to. These are
  // optional on purpose: if nflverse renames one, scheme still builds and only
  // the charting output goes thin, which is the right failure for a layer that
  // rides along on somebody else's download.
  for (const col of ['receiver_player_id', 'passer_player_id', 'posteam', 'complete_pass']) {
    idx[col] = header.indexOf(col);
  }
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const v = parseCSVLine(lines[i]);
    const num = c => { const n = parseFloat(v[idx[c]]); return Number.isNaN(n) ? null : n; };
    const str = c => (idx[c] === -1 || v[idx[c]] === undefined) ? null : (v[idx[c]].replace(/"/g, '').trim() || null);
    map.set(`${v[idx.game_id].replace(/"/g, '')}|${v[idx.play_id]}`, {
      playType: v[idx.play_type].replace(/"/g, ''),
      yards: num('yards_gained'),
      epa: num('epa'),
      isPass: num('pass') === 1,
      isRush: num('rush') === 1,
      receiver: str('receiver_player_id'),
      passer: str('passer_player_id'),
      posteam: str('posteam'),
      complete: num('complete_pass') === 1,
    });
  }
  return map;
}

// The defence is the team in the game that is not in possession. The game id
// is season_week_away_home, so both are on every row.
function defenseOf(gameId, offense) {
  const parts = String(gameId || '').split('_');
  if (parts.length !== 4) return null;
  const [, , away, home] = parts;
  const off = teamKey(offense);
  const a = teamKey(away), h = teamKey(home);
  if (off === a) return h;
  if (off === h) return a;
  return null;
}

// Defensive personnel by defensive-back count, which is how coaches name it:
// five backs is nickel, six is dime, four is base. Anything else is a package.
function shellOf(personnel) {
  if (!personnel || /\b(K|P|LS)\b/.test(personnel)) return null;
  const counts = {};
  for (const part of personnel.split(',')) {
    const m = part.trim().match(/^(\d+)\s+([A-Z]+)$/);
    if (m) counts[m[2]] = Number(m[1]);
  }
  const dbs = (counts.CB || 0) + (counts.FS || 0) + (counts.SS || 0) + (counts.DB || 0) + (counts.S || 0);
  if (!dbs) return null;
  if (dbs <= 4) return 'Base';
  if (dbs === 5) return 'Nickel';
  if (dbs === 6) return 'Dime';
  return 'Quarter';
}

function blankDefense() {
  return { snaps: 0, pass: 0, man: 0, zone: 0, blitz: 0, pressure: 0, coverage: {}, shell: {} };
}

function blank() {
  return {
    plays: 0, boxSum: 0, boxN: 0, heavyBox: 0,
    epaSum: 0, epaN: 0, explosive: 0, explosiveN: 0, pass: 0,
  };
}

function tally(bucket, row, play) {
  bucket.plays++;
  if (row.box !== null) {
    bucket.boxSum += row.box;
    bucket.boxN++;
    if (row.box >= HEAVY_BOX) bucket.heavyBox++;
  }
  if (!play) return;
  if (play.epa !== null) { bucket.epaSum += play.epa; bucket.epaN++; }
  if (play.isPass || play.isRush) {
    bucket.explosiveN++;
    if (play.isPass) bucket.pass++;
    const bar = play.isPass ? EXPLOSIVE_PASS : EXPLOSIVE_RUSH;
    if (play.yards !== null && play.yards >= bar) bucket.explosive++;
  }
}

const rate = (n, d) => (d ? +(n / d * 100).toFixed(1) : null);
const mean = (sum, n) => (n ? +(sum / n).toFixed(2) : null);

function summarise(b, { withSplits = true } = {}) {
  const out = { plays: b.plays };
  // The box figures carry the whole mechanism argument, so they answer to the
  // same qualifier as everything else. A 1.0 box average off four snaps is not
  // a finding, and gating the EPA while publishing that was inconsistent.
  if (b.boxN >= MIN_GROUPING_PLAYS) {
    out.boxAvg = mean(b.boxSum, b.boxN);
    out.heavyBoxRate = rate(b.heavyBox, b.boxN);
  } else {
    out.boxAvg = null;
    out.heavyBoxRate = null;
  }
  // Empty beats wrong: under the qualifier the splits are simply absent.
  if (withSplits && b.plays >= MIN_GROUPING_PLAYS) {
    out.epaPerPlay = b.epaN ? +(b.epaSum / b.epaN).toFixed(3) : null;
    out.explosiveRate = rate(b.explosive, b.explosiveN);
    out.passRate = rate(b.pass, b.explosiveN);
  }
  return out;
}

async function coachesBySeason() {
  // Head coach per game. The play-caller is usually the coordinator and is not
  // in any public dataset — see data/playcallers.json for the hand-kept layer.
  const csv = await fetchCSV('https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv');
  const rows = parseCSV(csv);
  const out = {};
  for (const r of rows) {
    const season = Number(r.season);
    if (!season) continue;
    for (const side of ['home', 'away']) {
      const team = teamKey(r[`${side}_team`]);
      const coach = r[`${side}_coach`];
      if (!team || !coach) continue;
      out[season] = out[season] || {};
      out[season][team] = out[season][team] || {};
      out[season][team][coach] = (out[season][team][coach] || 0) + 1;
    }
  }
  // A team that changed coaches mid-season gets the one who coached the most
  // games, and the fact that it changed is recorded alongside.
  const resolved = {};
  for (const [season, teams] of Object.entries(out)) {
    resolved[season] = {};
    for (const [team, tally] of Object.entries(teams)) {
      const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
      resolved[season][team] = { coach: ranked[0][0], games: ranked[0][1] };
      if (ranked.length > 1) {
        resolved[season][team].alsoCoachedBy = ranked.slice(1).map(([name, games]) => ({ name, games }));
      }
    }
  }
  return resolved;
}

// Which personnel a PLAYER is on the field for. participation lists every
// player on every snap by GSIS id, so once the pool carries those ids this is
// a direct count rather than an inference. It is the bridge between a team's
// scheme and one player's job: a tight end who only appears in 12 personnel has
// a different outlook from one his offence trusts in 11.
function tallyUsage(usage, row, group, gsisIndex) {
  if (!row.players) return;
  for (const raw of row.players.split(';')) {
    const player = gsisIndex.get(raw.trim());
    if (!player) continue;
    const u = usage[player.id] = usage[player.id] || { name: player.name, pos: player.pos, snaps: 0, groupings: {}, teams: {} };
    u.snaps++;
    u.groupings[group] = (u.groupings[group] || 0) + 1;
    // The team he played these snaps FOR, which is not necessarily the team he
    // is on now. Comparing a 2025 season to his 2026 employer's scheme reads a
    // traded player against an offence he never took a snap in.
    if (row.team) u.teams[row.team] = (u.teams[row.team] || 0) + 1;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   FTN CHARTING — who was the READ, not just who was on the field

   player-usage.json answers which personnel package a player is on the field
   for. It cannot answer the question a fantasy manager is actually asking,
   which is whether the offence is trying to get him the ball. FTN charts that
   directly: `read_thrown` records WHICH READ the quarterback threw to.

   The values are not a plain count and reading them as one would be wrong:
     1    the first read — the throw the play was designed to produce
     2    the second read
     CHK  a checkdown, which is a target that means the play broke down
     SD   scramble drill, an improvised target
     DES  a designed throw, screens and the like
     0    not a charted dropback at all (runs, kneels, spikes)

   A receiver on 90 targets of which 60 are first reads is the centre of an
   offence. One on 90 targets of which 45 are checkdowns is a safety valve, and
   volume alone cannot tell them apart.

   THIS RIDES ALONG ON THE pbp DOWNLOAD. FTN is charted per PLAY and carries no
   player id, so attributing a drop or a first read to a person needs pbp's
   receiver_player_id — 93MB that build-scheme already pays for. A separate
   script would double the daily cost of the most expensive step in the Action
   for no reason. One download, three outputs.
   ═══════════════════════════════════════════════════════════════════════════ */

const READ_LABELS = { 1: 'firstRead', 2: 'secondRead', CHK: 'checkdown', SD: 'scrambleDrill', DES: 'designed' };
const truthy = (v) => { const s = String(v).trim().toUpperCase(); return s === 'TRUE' || s === '1'; };

function blankCharting() {
  return {
    chartedTargets: 0, firstRead: 0, secondRead: 0, checkdown: 0, scrambleDrill: 0, designed: 0,
    catchable: 0, contested: 0, created: 0, drops: 0,
  };
}

function blankTeamCharting() {
  return {
    dropbacks: 0, playAction: 0, screen: 0, rpo: 0, noHuddle: 0, motion: 0,
    blitzFaced: 0, rushersFaced: 0, rushersCounted: 0, outOfPocket: 0,
  };
}

async function buildCharting(season, plays, gsisIndex) {
  const base = 'https://github.com/nflverse/nflverse-data/releases/download';
  let rows;
  try {
    rows = parseCSV(await fetchCSV(`${base}/ftn_charting/ftn_charting_${season}.csv`));
  } catch (e) {
    // Charting only exists for recent seasons. A missing year is a real answer,
    // not a failure — but a year that SHOULD be there failing is caught by the
    // join-rate check below.
    log(`  no FTN charting for ${season} (${e.message})`);
    return null;
  }

  const players = {};
  const teams = {};
  let joined = 0, dropbacks = 0, attributed = 0;

  for (const r of rows) {
    const play = plays.get(`${r.nflverse_game_id}|${r.nflverse_play_id}`);
    if (!play) continue;
    joined++;

    // read_thrown is 0 on everything that is not a charted dropback, so it is
    // the cheapest correct filter for "was this a pass attempt".
    const read = r.read_thrown;
    const isDropback = read !== 0 && read !== '0' && read !== null && read !== undefined;
    if (!isDropback) continue;
    dropbacks++;

    const team = play.posteam ? teamKey(play.posteam) : null;
    if (team) {
      const tc = teams[team] = teams[team] || blankTeamCharting();
      tc.dropbacks++;
      if (truthy(r.is_play_action)) tc.playAction++;
      if (truthy(r.is_screen_pass)) tc.screen++;
      if (truthy(r.is_rpo)) tc.rpo++;
      if (truthy(r.is_no_huddle)) tc.noHuddle++;
      if (truthy(r.is_motion)) tc.motion++;
      if (truthy(r.is_qb_out_of_pocket)) tc.outOfPocket++;
      const rushers = Number(r.n_pass_rushers);
      if (Number.isFinite(rushers) && rushers > 0) {
        tc.rushersFaced += rushers;
        tc.rushersCounted++;
        if (rushers >= 5) tc.blitzFaced++;
      }
    }

    // Attribution needs pbp's receiver id — FTN charts the PLAY and never says
    // who it was thrown to.
    const target = play.receiver ? gsisIndex.get(play.receiver) : null;
    if (!target) continue;
    attributed++;
    const pc = players[target.id] = players[target.id] || { name: target.name, pos: target.pos, ...blankCharting() };
    pc.chartedTargets++;
    const label = READ_LABELS[read];
    if (label) pc[label]++;
    if (truthy(r.is_catchable_ball)) pc.catchable++;
    if (truthy(r.is_contested_ball)) pc.contested++;
    if (truthy(r.is_created_reception)) pc.created++;
    if (truthy(r.is_drop)) pc.drops++;
  }

  const rate = rows.length ? joined / rows.length : 0;
  log(`  charting: ${rows.length} rows, ${joined} joined to pbp (${(rate * 100).toFixed(1)}%), `
    + `${dropbacks} dropbacks, ${attributed} attributed to the pool`);
  if (rate < 0.99) {
    throw new Error(`only ${(rate * 100).toFixed(1)}% of FTN rows joined to pbp — the join key moved`);
  }
  if (!attributed) {
    throw new Error('no charted target attributed to any player — receiver_player_id is missing from pbp');
  }

  // Rates last, from the totals. A share of dropbacks, never of all snaps:
  // dividing play-action by every play halves it and reads a play-action
  // offence as a conventional one.
  for (const tc of Object.values(teams)) {
    const d = tc.dropbacks || 1;
    tc.playActionRate = +(100 * tc.playAction / d).toFixed(1);
    tc.screenRate = +(100 * tc.screen / d).toFixed(1);
    tc.rpoRate = +(100 * tc.rpo / d).toFixed(1);
    tc.noHuddleRate = +(100 * tc.noHuddle / d).toFixed(1);
    tc.motionRate = +(100 * tc.motion / d).toFixed(1);
    tc.blitzFacedRate = +(100 * tc.blitzFaced / d).toFixed(1);
    tc.avgRushersFaced = tc.rushersCounted ? +(tc.rushersFaced / tc.rushersCounted).toFixed(2) : null;
  }
  for (const pc of Object.values(players)) {
    const t = pc.chartedTargets || 1;
    pc.firstReadRate = +(100 * pc.firstRead / t).toFixed(1);
    pc.checkdownRate = +(100 * pc.checkdown / t).toFixed(1);
    pc.catchableRate = +(100 * pc.catchable / t).toFixed(1);
    pc.contestedRate = +(100 * pc.contested / t).toFixed(1);
  }

  return { players, teams };
}

async function buildSeason(season) {
  log(`fetching ${season}...`);
  const base = 'https://github.com/nflverse/nflverse-data/releases/download';
  const [partCsv, pbpCsv] = await Promise.all([
    // participation ships uncompressed only — there is no .csv.gz asset.
    fetchCSV(`${base}/pbp_participation/pbp_participation_${season}.csv`),
    fetchCSV(`${base}/pbp/play_by_play_${season}.csv.gz`),
  ]);

  const plays = leanPbp(pbpCsv);
  const part = parseCSV(partCsv);
  log(`  ${part.length} participation rows, ${plays.size} plays`);

  const pool = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'players.json'), 'utf8'));
  const gsisIndex = new Map(pool.filter(p => p.gsisId).map(p => [p.gsisId, p]));

  const teams = {};
  const defenses = {};
  const usage = {};
  const league = { overall: blank(), byGrouping: {}, formation: {}, coverage: {}, manZone: {} };
  let joined = 0, counted = 0, skipped = 0;

  for (const r of part) {
    const team = r.possession_team;
    const group = grouping(r.offense_personnel);
    if (!team || !group) { skipped++; continue; }

    const row = { box: boxOrNull(r.defenders_in_box) };
    const play = plays.get(`${r.nflverse_game_id}|${r.play_id}`) || null;
    // Kneels and spikes are not scheme.
    if (play && (play.playType === 'qb_kneel' || play.playType === 'qb_spike')) { skipped++; continue; }

    const t = teams[teamKey(team)] = teams[teamKey(team)] || {
      overall: blank(), byGrouping: {}, formation: {}, coverage: {}, manZone: {},
    };

    counted++;
    if (play) joined++;
    tally(t.overall, row, play);
    tallyUsage(usage, { players: r.offense_players, team: teamKey(team) }, group, gsisIndex);
    t.byGrouping[group] = t.byGrouping[group] || blank();
    tally(t.byGrouping[group], row, play);

    tally(league.overall, row, play);
    league.byGrouping[group] = league.byGrouping[group] || blank();
    tally(league.byGrouping[group], row, play);

    // ===== THE DEFENCE THAT FACED THIS SNAP =====
    const defTeam = defenseOf(r.nflverse_game_id, team);
    if (defTeam) {
      const d = defenses[defTeam] = defenses[defTeam] || blankDefense();
      d.snaps++;
      if (String(r.was_pressure).toLowerCase() === 'true' || r.was_pressure === '1') d.pressure++;
      const shell = shellOf(r.defense_personnel);
      if (shell) d.shell[shell] = (d.shell[shell] || 0) + 1;
      // Coverage is only charted on dropbacks, so its rates are a share of
      // PASS snaps. Dividing by every snap would halve every number and call
      // an aggressive defence a passive one.
      const mz = (r.defense_man_zone_type || '').trim();
      const cov = (r.defense_coverage_type || '').trim();
      if (mz || cov) {
        d.pass++;
        if (mz === 'MAN_COVERAGE') d.man++;
        if (mz === 'ZONE_COVERAGE') d.zone++;
        if (cov) d.coverage[cov] = (d.coverage[cov] || 0) + 1;
        const rushers = parseFloat(r.number_of_pass_rushers);
        if (!Number.isNaN(rushers) && rushers >= 5) d.blitz++;
      }
    }

    const form = (r.offense_formation || '').trim();
    if (form) {
      t.formation[form] = (t.formation[form] || 0) + 1;
      league.formation[form] = (league.formation[form] || 0) + 1;
    }
    const cov = (r.defense_coverage_type || '').trim();
    if (cov) {
      t.coverage[cov] = (t.coverage[cov] || 0) + 1;
      league.coverage[cov] = (league.coverage[cov] || 0) + 1;
    }
    const mz = (r.defense_man_zone_type || '').trim();
    if (mz) {
      t.manZone[mz] = (t.manZone[mz] || 0) + 1;
      league.manZone[mz] = (league.manZone[mz] || 0) + 1;
    }
  }

  // Every counted snap should find its play. A gap here means the join key moved.
  log(`  ${counted} scrimmage snaps, ${joined} joined to pbp (${(joined / counted * 100).toFixed(1)}%), ${skipped} skipped as non-offense`);
  if (joined / counted < 0.99) throw new Error(`only ${(joined / counted * 100).toFixed(1)}% of snaps joined to pbp — the join key moved`);

  // Rides along on the pbp map already in memory — see the FTN block above.
  const charting = await buildCharting(season, plays, gsisIndex);

  return { teams, league, usage, defenses, charting };
}

function shapeDefense(d) {
  const share = (obj, denom) => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = rate(v, denom);
    return out;
  };
  return {
    snaps: d.snaps,
    passSnaps: d.pass,
    // Of pass snaps, because that is when coverage exists.
    manRate: rate(d.man, d.pass),
    zoneRate: rate(d.zone, d.pass),
    blitzRate: rate(d.blitz, d.pass),
    pressureRate: rate(d.pressure, d.snaps),
    coverage: share(d.coverage, d.pass),
    shell: share(d.shell, d.snaps),
  };
}

function shapeTeam(raw) {
  const total = raw.overall.plays;
  const personnel = {};
  for (const [g, b] of Object.entries(raw.byGrouping)) {
    personnel[g] = { rate: rate(b.plays, total), ...summarise(b) };
  }
  const distribution = (obj) => {
    const sum = Object.values(obj).reduce((a, b) => a + b, 0);
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = rate(v, sum);
    return out;
  };
  return {
    plays: total,
    ...summarise(raw.overall, { withSplits: true }),
    personnel,
    formation: distribution(raw.formation),
    coverageFaced: distribution(raw.coverage),
    manZoneFaced: distribution(raw.manZone),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const explicit = args.includes('--seasons') ? args[args.indexOf('--seasons') + 1].split(',').map(Number) : null;

  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { seasons: {} };
  const live = currentSeason();
  const wanted = explicit || (all ? HISTORY : [live]);

  const existingUsage = fs.existsSync(OUT_USAGE) ? JSON.parse(fs.readFileSync(OUT_USAGE, 'utf8')) : { seasons: {} };
  const existingCharting = fs.existsSync(OUT_CHARTING) ? JSON.parse(fs.readFileSync(OUT_CHARTING, 'utf8')) : { seasons: {} };
  const seasons = { ...(existing.seasons || {}) };
  const league = { ...(existing.league || {}) };
  const usageSeasons = { ...(existingUsage.seasons || {}) };
  const chartingSeasons = { ...(existingCharting.seasons || {}) };
  const failures = [];

  for (const season of wanted) {
    try {
      const { teams, league: lg, usage, defenses, charting } = await buildSeason(season);
      if (!Object.keys(teams).length) throw new Error('no team rows produced');
      const shaped = {};
      for (const [team, raw] of Object.entries(teams)) shaped[team] = shapeTeam(raw);
      const leagueDef = blankDefense();
      for (const [team, d] of Object.entries(defenses)) {
        if (shaped[team]) shaped[team].defense = shapeDefense(d);
        // A league baseline, so every team figure can be read as more or less
        // than everyone else. Without it "18.8% man" is a number with nothing
        // to be measured against.
        leagueDef.snaps += d.snaps; leagueDef.pass += d.pass;
        leagueDef.man += d.man; leagueDef.zone += d.zone;
        leagueDef.blitz += d.blitz; leagueDef.pressure += d.pressure;
        for (const [k, v] of Object.entries(d.coverage)) leagueDef.coverage[k] = (leagueDef.coverage[k] || 0) + v;
        for (const [k, v] of Object.entries(d.shell)) leagueDef.shell[k] = (leagueDef.shell[k] || 0) + v;
      }
      seasons[season] = shaped;
      if (charting) chartingSeasons[season] = charting;
      league[season] = shapeTeam(lg);
      league[season].defense = shapeDefense(leagueDef);
      // Share of his own snaps, per grouping. A raw count says how much he
      // played; the share says what he was used FOR.
      const shapedUsage = {};
      for (const [id, u] of Object.entries(usage)) {
        if (u.snaps < MIN_USAGE_SNAPS) continue;
        const mix = {};
        for (const [g, n] of Object.entries(u.groupings)) {
          const share = +(n / u.snaps * 100).toFixed(1);
          if (share >= 1) mix[g] = share;
        }
        const teams = Object.entries(u.teams).sort((a, b) => b[1] - a[1]);
        shapedUsage[id] = {
          name: u.name, pos: u.pos, snaps: u.snaps, mix,
          team: teams.length ? teams[0][0] : null,
          ...(teams.length > 1 ? { alsoWith: teams.slice(1).map(([t, n]) => ({ team: t, snaps: n })) } : {}),
        };
      }
      usageSeasons[season] = shapedUsage;
      log(`  ${season}: ${Object.keys(shaped).length} teams`);
    } catch (e) {
      // A season that has not kicked off yet is not a failure. A past season
      // that disappeared is — nflverse moved a file on us once already.
      // Only a season that has not happened yet is allowed to be missing.
      if (season > live) log(`  ${season} has not started yet (${e.message})`);
      else failures.push(`${season}: ${e.message}`);
    }
  }

  if (failures.length) {
    console.error('[scheme] FAILED — a past season should never stop resolving:');
    failures.forEach(f => console.error(`  ${f}`));
    process.exit(1);
  }

  const coaches = await coachesBySeason();
  for (const [season, teams] of Object.entries(seasons)) {
    for (const [team, data] of Object.entries(teams)) {
      const c = coaches[season] && coaches[season][team];
      if (c) { data.coach = c.coach; if (c.alsoCoachedBy) data.alsoCoachedBy = c.alsoCoachedBy; }
    }
  }

  const years = Object.keys(seasons).map(Number).sort();
  const out = {
    meta: {
      generated: new Date().toISOString(),
      seasons: years,
      source: 'nflverse pbp_participation joined to pbp on game_id + play_id; head coaches from nflverse schedules',
      explosive: `${EXPLOSIVE_PASS}+ yards on a pass, ${EXPLOSIVE_RUSH}+ on a run`,
      heavyBox: `${HEAVY_BOX} or more defenders in the box`,
      qualifier: `EPA and explosive splits are drawn only for groupings with ${MIN_GROUPING_PLAYS}+ snaps`,
      caveats: 'Personnel is the offense as charted, and charting misses exist. Kneels and spikes are excluded. A grouping under the qualifier appears in the mix with no splits rather than a number built on nothing.',
    },
    league,
    seasons,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  log(`wrote scheme.json: ${years.join(', ')} — ${kb}KB`);

  const usageOut = {
    meta: {
      generated: new Date().toISOString(),
      seasons: Object.keys(usageSeasons).map(Number).sort(),
      source: 'nflverse pbp_participation offense_players, joined to the pool on GSIS id',
      qualifier: `Players with at least ${MIN_USAGE_SNAPS} charted snaps in a season`,
      caveats: 'Share of the player\'s OWN snaps, not his team\'s. A player is only counted on snaps where the offensive personnel could be read, and only if the pool carries his GSIS id.',
    },
    seasons: usageSeasons,
  };
  fs.writeFileSync(OUT_USAGE, JSON.stringify(usageOut, null, 2) + '\n');
  const latestUsage = usageSeasons[years[years.length - 1]] || {};
  log(`wrote player-usage.json: ${Object.keys(latestUsage).length} players in ${years[years.length - 1]} — ${Math.round(fs.statSync(OUT_USAGE).size / 1024)}KB`);

  // The third output of the one pbp download. Only written when a season
  // actually produced charting — FTN does not cover every year, and an empty
  // file would read as "nobody was ever the first read".
  const chartYears = Object.keys(chartingSeasons).map(Number).sort();
  if (chartYears.length) {
    const chartingOut = {
      meta: {
        generated: new Date().toISOString(),
        seasons: chartYears,
        source: 'FTN charting joined to nflverse pbp on game_id + play_id; targets attributed via pbp receiver_player_id',
        readValues: {
          firstRead: 'the throw the play was designed to produce',
          secondRead: 'the quarterback came off his first look',
          checkdown: 'a target that means the play broke down',
          scrambleDrill: 'improvised after the pocket moved',
          designed: 'screens and other designed throws',
        },
        caveats: [
          'Rates are a share of DROPBACKS, never of all snaps — dividing play-action by every '
          + 'play halves it and reads a play-action offence as a conventional one.',
          'FTN charting is done by humans and the standard is not identical across seasons.',
          'A target is attributed through pbp\'s receiver_player_id, so a charted pass with no '
          + 'recorded receiver counts for the team and for nobody in particular.',
        ],
      },
      seasons: chartingSeasons,
    };
    fs.writeFileSync(OUT_CHARTING, JSON.stringify(chartingOut, null, 2) + '\n');
    const latestChart = chartingSeasons[chartYears[chartYears.length - 1]] || { players: {} };
    log(`wrote charting.json: ${Object.keys(latestChart.players).length} players in ${chartYears[chartYears.length - 1]} — ${Math.round(fs.statSync(OUT_CHARTING).size / 1024)}KB`);
  }
}

main().catch(e => { console.error('[scheme] fatal:', e.message); process.exit(1); });
