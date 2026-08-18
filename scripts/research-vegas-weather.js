#!/usr/bin/env node
/**
 * research-vegas-weather.js — does the market, or the weather, tell us anything
 * we do not already know?
 *
 * RESEARCH, NOT A BUILD. It writes no data file and is not in the daily Action.
 * Its only job is to answer a question before we spend anything on it.
 *
 * THE QUESTION. Implied team total — half the game total, adjusted by the spread
 * — is widely held to be among the best weekly fantasy inputs, and it is not in
 * any of our current feeds going forward. Adding it would mean a live odds API:
 * a new key, a new rate limit, a new thing that fails at 6am. Weather is the
 * same bargain.
 *
 * So the honest order is to measure the value BEFORE buying the dependency. And
 * that measurement is free, because nflverse's schedules file already carries
 * `total_line`, `spread_line`, `temp`, `wind` and `roof` for every past game —
 * a small file build-sos already downloads.
 *
 * WHAT COUNTS AS VALUE. Not correlation with fantasy points: a good player
 * scores well in most games and plays in some high-total ones, so raw
 * correlation would flatter the market badly. The test is INCREMENTAL — does
 * knowing the implied total improve a forecast that already knows what the
 * player has been averaging? That is the only version of the question that
 * decides anything, because the season average is what we would otherwise use.
 *
 *   node scripts/research-vegas-weather.js
 */

const { fetchCSV, parseCSV } = require('./lib/match');
const { teamKey } = require('./lib/teams');
const seasonLib = require('./lib/season');

const BASE = 'https://github.com/nflverse/nflverse-data/releases/download';
const GAMES = `${BASE}/schedules/games.csv`;
const WEEK_STATS = (s) => `${BASE}/stats_player/stats_player_week_${s}.csv`;

const MIN_PRIOR_GAMES = 3;   // a trailing average needs something behind it

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }

function correlation(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

/** Least squares on one predictor, returning RMSE of the fit. */
function fit1(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const b = den ? num / den : 0;
  const a = my - b * mx;
  const err = xs.map((x, i) => (a + b * x - ys[i]) ** 2);
  return { a, b, rmse: Math.sqrt(mean(err)) };
}

/** Least squares on two predictors, via normal equations. */
function fit2(x1s, x2s, ys) {
  const n = ys.length;
  const s = (f) => { let t = 0; for (let i = 0; i < n; i++) t += f(i); return t; };
  const S11 = s(i => x1s[i] * x1s[i]), S22 = s(i => x2s[i] * x2s[i]), S12 = s(i => x1s[i] * x2s[i]);
  const S1 = s(i => x1s[i]), S2 = s(i => x2s[i]), Sy = s(i => ys[i]);
  const S1y = s(i => x1s[i] * ys[i]), S2y = s(i => x2s[i] * ys[i]);
  // Solve the 3x3 normal equations by elimination.
  const A = [[S11, S12, S1, S1y], [S12, S22, S2, S2y], [S1, S2, n, Sy]];
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    if (!A[c][c]) return null;
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k];
    }
  }
  const b1 = A[0][3] / A[0][0], b2 = A[1][3] / A[1][1], a = A[2][3] / A[2][2];
  const err = ys.map((y, i) => (a + b1 * x1s[i] + b2 * x2s[i] - y) ** 2);
  return { a, b1, b2, rmse: Math.sqrt(mean(err)) };
}

async function main() {
  const seasons = await seasonLib.dataSeasons(3);
  console.log(`[research] seasons ${seasons.join(', ')}\n`);

  const games = parseCSV(await fetchCSV(GAMES)).filter(g => seasons.includes(Number(g.season)));
  console.log(`[research] ${games.length} games with schedule rows`);

  // Implied team total. nflverse's spread_line is stated from the HOME side, but
  // rather than trust a remembered convention it is chosen empirically below:
  // whichever sign makes implied total agree with points actually scored is the
  // right one, and if neither does, that itself is the finding.
  const byTeamWeek = new Map();   // `${season}|${week}|${team}` -> { implied, temp, wind, roof, scored }
  let withLine = 0;
  for (const g of games) {
    if (g.total_line == null || g.spread_line == null) continue;
    withLine++;
    const put = (team, implied, scored) => {
      byTeamWeek.set(`${g.season}|${g.week}|${teamKey(team)}`, {
        implied, temp: g.temp, wind: g.wind, roof: g.roof, scored,
      });
    };
    // Home gets (total - spread)/2 under one convention and (total + spread)/2
    // under the other. Both are computed and the better one is picked below.
    put(g.home_team, { minus: (g.total_line - g.spread_line) / 2, plus: (g.total_line + g.spread_line) / 2 }, g.home_score);
    put(g.away_team, { minus: (g.total_line + g.spread_line) / 2, plus: (g.total_line - g.spread_line) / 2 }, g.away_score);
  }
  console.log(`[research] ${withLine} games carry a closing line`);

  // Which sign convention actually matches reality?
  const scored = [], impMinus = [], impPlus = [];
  for (const v of byTeamWeek.values()) {
    if (v.scored == null) continue;
    scored.push(v.scored); impMinus.push(v.implied.minus); impPlus.push(v.implied.plus);
  }
  const rMinus = correlation(impMinus, scored), rPlus = correlation(impPlus, scored);
  const useMinus = rMinus > rPlus;
  console.log(`[research] implied-total sign check: (total-spread)/2 r=${rMinus.toFixed(3)}, `
    + `(total+spread)/2 r=${rPlus.toFixed(3)} → using ${useMinus ? '(total-spread)/2' : '(total+spread)/2'} for home`);
  console.log(`[research] implied total vs points actually scored: r=${Math.max(rMinus, rPlus).toFixed(3)}\n`);

  // ---- Player weeks ------------------------------------------------------
  const rows = [];
  for (const season of seasons) {
    let weekly;
    try { weekly = parseCSV(await fetchCSV(WEEK_STATS(season))); }
    catch (e) { console.log(`[research] no weekly stats for ${season}: ${e.message}`); continue; }
    const history = new Map();   // player -> [fpts...]
    const sorted = weekly.filter(r => r.season_type === 'REG').sort((a, b) => a.week - b.week);
    for (const r of sorted) {
      const pts = r.fantasy_points_ppr;
      if (pts == null || !r.player_id) continue;
      const prior = history.get(r.player_id) || [];
      const team = teamKey(r.recent_team || r.team);
      const ctx = byTeamWeek.get(`${season}|${r.week}|${team}`);
      if (prior.length >= MIN_PRIOR_GAMES && ctx) {
        rows.push({
          pos: r.position,
          trailing: mean(prior),
          implied: useMinus ? ctx.implied.minus : ctx.implied.plus,
          temp: ctx.temp, wind: ctx.wind, roof: ctx.roof,
          actual: pts,
        });
      }
      prior.push(pts);
      history.set(r.player_id, prior);
    }
  }
  console.log(`[research] ${rows.length} player-weeks with a trailing average and a game line\n`);

  const skill = rows.filter(r => ['QB', 'RB', 'WR', 'TE'].includes(r.pos));

  // ---- Does the line add anything to the trailing average? ---------------
  console.log('=== IMPLIED TEAM TOTAL: incremental value over a trailing average ===');
  const report = (label, set) => {
    if (set.length < 200) { console.log(`  ${label.padEnd(6)} only ${set.length} rows — skipped`); return; }
    const base = fit1(set.map(r => r.trailing), set.map(r => r.actual));
    const both = fit2(set.map(r => r.trailing), set.map(r => r.implied), set.map(r => r.actual));
    if (!both) { console.log(`  ${label}: singular`); return; }
    const gain = 100 * (base.rmse - both.rmse) / base.rmse;
    console.log(`  ${label.padEnd(6)} n=${String(set.length).padStart(5)}  `
      + `RMSE ${base.rmse.toFixed(3)} → ${both.rmse.toFixed(3)}  (${gain >= 0 ? '+' : ''}${gain.toFixed(2)}% better)  `
      + `implied-total coefficient ${both.b2.toFixed(3)} pts per point of team total`);
  };
  report('ALL', skill);
  for (const pos of ['QB', 'RB', 'WR', 'TE']) report(pos, skill.filter(r => r.pos === pos));

  // ---- Weather -----------------------------------------------------------
  console.log('\n=== WEATHER: incremental value over a trailing average ===');
  const outdoor = skill.filter(r => r.roof && !/closed|dome/i.test(String(r.roof)) && r.wind != null && r.temp != null);
  console.log(`  outdoor player-weeks with a reading: ${outdoor.length} of ${skill.length}`);
  if (outdoor.length > 200) {
    const base = fit1(outdoor.map(r => r.trailing), outdoor.map(r => r.actual));
    for (const [label, key] of [['wind', 'wind'], ['temp', 'temp']]) {
      const both = fit2(outdoor.map(r => r.trailing), outdoor.map(r => r[key]), outdoor.map(r => r.actual));
      if (!both) continue;
      const gain = 100 * (base.rmse - both.rmse) / base.rmse;
      console.log(`  ${label.padEnd(6)} RMSE ${base.rmse.toFixed(3)} → ${both.rmse.toFixed(3)}  `
        + `(${gain >= 0 ? '+' : ''}${gain.toFixed(2)}% better)  coefficient ${both.b2.toFixed(4)}`);
    }
    const windy = outdoor.filter(r => r.wind >= 15);
    const calm = outdoor.filter(r => r.wind < 8);
    if (windy.length > 50 && calm.length > 50) {
      const resid = (set) => mean(set.map(r => r.actual - r.trailing));
      console.log(`  wind >= 15mph: ${windy.length} weeks, average ${resid(windy).toFixed(2)} pts vs trailing`);
      console.log(`  wind <  8mph:  ${calm.length} weeks, average ${resid(calm).toFixed(2)} pts vs trailing`);
    }
  }

  console.log('\n[research] A percentage here is the whole decision. A live odds or weather API is a '
    + 'key, a rate limit and a new way for the 6am run to fail; it has to buy more than it costs.');
}

main().catch(e => { console.error('[research] FAILED:', e.message); process.exit(1); });
