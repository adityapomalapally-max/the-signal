#!/usr/bin/env node

/**
 * RESEARCH — does a player's history against ONE SPECIFIC OPPONENT predict
 * his next game against them?
 *
 * This is the bettor's oldest read and it is everywhere in fantasy coverage:
 * "he always goes off against this team". It is also the single most likely
 * thing on this site to be noise wearing a number's clothes, because the
 * sample is one or two games against a roster and a coaching staff that have
 * both since changed.
 *
 * WRITES NO FILE AND IS NOT IN THE ACTION, same bargain as
 * research-vegas-weather.js and research-matchup-stability.js. It exists so the
 * question is settled by a measurement rather than reopened from memory, and so
 * nothing weights a card column on a hunch.
 *
 * THE TEST IS INCREMENTAL, NOT CORRELATIONAL — the lesson from the Vegas work.
 * A player who ran for 90 against this team is usually just a good runner, so
 * raw correlation flatters the read badly. The only question that decides
 * anything is whether knowing the opponent history improves a forecast that
 * ALREADY knows the player's recent form.
 *
 * AND THERE IS A THIRD MODEL, WHICH IS THE ONE THAT MATTERS. A player's
 * history against a team partly just records that the team is bad at defending
 * his position — which is a real, actionable signal, and NOT the same claim as
 * "he owns them". So the ladder is:
 *
 *   M0  form alone                        (his own trailing average)
 *   M1  form x how leaky that defence is  (the general matchup, which
 *                                          matchups.json already publishes)
 *   M2  M1 blended with his own history against that opponent
 *
 * If M2 beats M1 the player-specific read is real. If it does not, the edge was
 * "I am finding soft defences" all along — still worth having, and already on
 * the site under a number with a much bigger sample behind it.
 *
 *   node scripts/research-opponent-history.js [--seasons 12] [--min-meetings 2] [--through 2025]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { fetchCSV, parseCSV } = require('./lib/match');
const { teamKey } = require('./lib/teams');

// NAMED ON PURPOSE, NOT READ OFF THE CALENDAR. This script asked
// lib/season.js for lastCompletedSeason(), which is harmless in itself — that
// value can never be an unpublished season — but it put the file in the
// category of scripts that can be surprised by a rollover, and
// tests/rollover.test.js flagged it correctly on that signature alone. The
// alternative was a notPublishedYet() branch that could never run, which the
// test's own comment names as dead code written to satisfy a regex.
//
// So this pins its window the way research-xfp-carryover.js does. A research
// window is a judgement made once — like build-draft-outcomes' class bounds —
// and `--through` moves it without editing anything.
const LAST_FINISHED_SEASON = 2025;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const log = (m) => console.log(`[opp-history] ${m}`);

const URL = (s) => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${s}.csv`;
// Cached between runs. These are 8MB a season and the analysis gets re-run
// while the questions change; re-downloading 100MB to re-ask is waste.
const CACHE = path.join(os.tmpdir(), 'signal-opp-history');

// The markets this is actually about. Adi bets anytime touchdown and
// quarterback / running-back rushing yards; receiving yards is here because it
// is the one market the props model already covers, so it is the control.
const MARKETS = [
  { key: 'qbRush',  label: 'QB rushing yards',  pos: ['QB'],       stat: (r) => num(r.rushing_yards),   floor: 1 },
  { key: 'rbRush',  label: 'RB rushing yards',  pos: ['RB'],       stat: (r) => num(r.rushing_yards),   floor: 1 },
  { key: 'recYds',  label: 'WR/TE rec yards',   pos: ['WR', 'TE'], stat: (r) => num(r.receiving_yards), floor: 1 },
];

const num = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const rmse = (pairs) => Math.sqrt(mean(pairs.map(([p, a]) => (p - a) ** 2)));
const mae = (pairs) => mean(pairs.map(([p, a]) => Math.abs(p - a)));

async function seasonRows(season) {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, `${season}.csv`);
  let csv;
  if (fs.existsSync(f)) {
    csv = fs.readFileSync(f, 'utf8');
  } else {
    csv = await fetchCSV(URL(season));
    fs.writeFileSync(f, csv);
  }
  return parseCSV(csv).filter(r => r.season_type === 'REG');
}

/**
 * One row per player-game, in chronological order, with the three predictors
 * built ONLY from games strictly earlier than the one being predicted. Any
 * leakage here would manufacture the finding.
 */
function buildFrames(rows, market, minMeetings) {
  const games = [];
  for (const r of rows) {
    if (!market.pos.includes(r.position)) continue;
    const v = market.stat(r);
    if (v === null) continue;
    const id = r.player_id || r.gsis_id || r.player_display_name;
    if (!id) continue;
    const opp = teamKey(r.opponent_team);
    if (!opp) continue;
    games.push({
      id, name: r.player_display_name, pos: r.position,
      season: Number(r.season), week: Number(r.week),
      opp, v,
    });
  }
  games.sort((a, b) => a.season - b.season || a.week - b.week);

  const byPlayer = new Map();        // id -> [games so far]
  const vsOppHist = new Map();       // id|opp -> [values so far]
  const defHist = new Map();         // opp -> [values conceded so far]
  const leagueHist = [];             // every value so far, for the league mean

  const frames = [];
  for (const g of games) {
    const own = byPlayer.get(g.id) || [];
    const vs = vsOppHist.get(`${g.id}|${g.opp}`) || [];
    const def = defHist.get(g.opp) || [];

    // Form: his last 8 games, needing at least 4. Fewer than four and there is
    // no baseline to improve on, which is a different question.
    const last8 = own.slice(-8);
    const form = last8.length >= 4 ? mean(last8) : null;

    // The defence's general leak, as a RATIO to the league mean at this
    // position. A ratio travels across eras; an absolute average does not.
    const lgMean = leagueHist.length >= 500 ? mean(leagueHist) : null;
    const defMean = def.length >= 50 ? mean(def) : null;
    const defRatio = (lgMean && defMean && lgMean > 0) ? defMean / lgMean : null;

    // His own history against THIS opponent. The read under test.
    const vsOpp = vs.length >= minMeetings ? mean(vs) : null;

    if (form !== null && defRatio !== null && vsOpp !== null && form >= market.floor) {
      // THE PLACEBO. His average against a DIFFERENT opponent he has faced just
      // as often — deterministically the one whose meeting count is nearest, so
      // the two reads rest on samples of the same size. Everything about this
      // number is identical to vsOpp except the one thing under test: that it is
      // the team he is about to play.
      let vsOther = null;
      let bestGap = Infinity;
      for (const [k, arr] of vsOppHist) {
        if (!k.startsWith(`${g.id}|`)) continue;
        if (k === `${g.id}|${g.opp}`) continue;
        if (arr.length < minMeetings) continue;
        const gap = Math.abs(arr.length - vs.length);
        if (gap < bestGap) { bestGap = gap; vsOther = mean(arr); }
      }
      // THE RIVAL EXPLANATION, and the placebo is what forced it into the
      // script. If a high history-against-anybody beats form just as often as a
      // high history against THIS team, then the trigger is not reading the
      // opponent at all — it is reading a player whose last eight games sit
      // below his own longer-run level. Those regress upward whoever they play.
      const longRun = own.length >= 16 ? mean(own) : null;
      frames.push({ ...g, form, defRatio, vsOpp, vsOther, longRun, meetings: vs.length });
    }

    own.push(g.v); byPlayer.set(g.id, own);
    vs.push(g.v);  vsOppHist.set(`${g.id}|${g.opp}`, vs);
    def.push(g.v); defHist.set(g.opp, def);
    leagueHist.push(g.v);
  }
  return frames;
}

/** Best blend weight on a grid, reported with the curve so a flat optimum shows. */
function bestBlend(frames, baseOf) {
  let best = { w: 0, rmse: Infinity };
  const curve = [];
  for (let w = 0; w <= 0.8; w += 0.05) {
    const r = rmse(frames.map(f => [(1 - w) * baseOf(f) + w * f.vsOpp, f.v]));
    curve.push([Number(w.toFixed(2)), Number(r.toFixed(3))]);
    if (r < best.rmse) best = { w: Number(w.toFixed(2)), rmse: r };
  }
  return { best, curve };
}

/**
 * THE DECISION TEST, because the RMSE answer is not the one he acts on. He only
 * bets when the opponent history STANDS OUT, so the question is whether that
 * trigger beats the line in the cases where he would actually pull it.
 *
 * NOTE the base rate is not 50%. These stats are right-skewed, so predicting a
 * mean is beaten less than half the time by construction; what matters is the
 * trigger group against the base rate, which carries the same skew.
 *
 * THE LINE IS PROXIED BY FORM ALONE, not by form x the defence's leak. That was
 * the first version and the measurement rejected it: M1 is WORSE than M0 in all
 * three markets, which is consistent with this site's own finding that a
 * defensive rating barely predicts its own future (r = 0.09 to 0.54). Proxying
 * the line with the weaker forecast would have credited the opponent read with
 * beating a baseline nobody would use.
 *
 * `field` is the predictor being triggered on, so the identical test can be run
 * against a PLACEBO — his history against a DIFFERENT opponent. If the placebo
 * shows the same edge then the trigger is not about opponent identity at all;
 * it is selecting players whose recent form sits below their own longer-run
 * level, and those regress upward whoever they are playing.
 */
function triggerTest(frames, thresholds, field = 'vsOpp') {
  const proxy = (f) => f.form;
  const usable = frames.filter(f => f[field] !== null && f[field] !== undefined);
  const base = usable.filter(f => f.v > proxy(f)).length / usable.length;
  const out = [];
  for (const t of thresholds) {
    const hit = usable.filter(f => f[field] >= t * f.form);
    if (hit.length < 40) { out.push({ t, n: hit.length, rate: null, base }); continue; }
    const over = hit.filter(f => f.v > proxy(f)).length;
    out.push({ t, n: hit.length, rate: over / hit.length, base });
  }
  return out;
}

async function main() {
  const nSeasons = Number(arg('seasons', '12'));
  const minMeetings = Number(arg('min-meetings', '2'));
  const last = Number(arg('through', String(LAST_FINISHED_SEASON)));
  const seasons = [];
  for (let s = last - nSeasons + 1; s <= last; s++) seasons.push(s);

  log(`seasons ${seasons[0]}-${seasons[seasons.length - 1]} · a prior meeting count of ${minMeetings}+ to form the read`);
  log(`cache: ${CACHE}`);

  let rows = [];
  for (const s of seasons) {
    const r = await seasonRows(s);
    rows = rows.concat(r);
    log(`  ${s}: ${r.length} regular-season player-games`);
  }
  log(`${rows.length} player-games total`);

  for (const m of MARKETS) {
    const frames = buildFrames(rows, m, minMeetings);
    console.log(`\n═══ ${m.label} ═══`);
    if (frames.length < 200) { console.log(`  only ${frames.length} usable frames — not enough to say anything`); continue; }

    const avgMeet = mean(frames.map(f => f.meetings));
    console.log(`  ${frames.length} player-games with form, a defensive read and ${minMeetings}+ prior meetings`);
    console.log(`  median prior meetings: ${avgMeet.toFixed(1)} · mean actual ${mean(frames.map(f => f.v)).toFixed(1)}`);

    // M0 — form alone.
    const m0 = rmse(frames.map(f => [f.form, f.v]));
    // M1 — form scaled by the defence's general leak.
    const m1 = rmse(frames.map(f => [f.form * f.defRatio, f.v]));
    // M2 — M1 blended with his own history against this opponent.
    const { best, curve } = bestBlend(frames, (f) => f.form * f.defRatio);

    const pc = (a, b) => `${(((a - b) / a) * 100).toFixed(2)}%`;
    console.log(`\n  M0  form alone .................... RMSE ${m0.toFixed(3)}  MAE ${mae(frames.map(f => [f.form, f.v])).toFixed(3)}`);
    console.log(`  M1  form x defence leak ........... RMSE ${m1.toFixed(3)}   improves on M0 by ${pc(m0, m1)}`);
    console.log(`  M2  + his history vs this opponent  RMSE ${best.rmse.toFixed(3)}   improves on M1 by ${pc(m1, best.rmse)}  (best weight ${best.w})`);

    // A flat curve near zero is the tell that the term is doing nothing.
    const w0 = curve.find(c => c[0] === 0)[1];
    const w30 = curve.find(c => c[0] === 0.30)[1];
    console.log(`  blend curve: w=0 ${w0} · w=0.15 ${curve.find(c => c[0] === 0.15)[1]} · w=0.30 ${w30} · w=0.50 ${curve.find(c => c[0] === 0.50)[1]}`);

    console.log(`  M2 against the baseline anybody would actually use (M0): ${pc(m0, best.rmse)}`);

    console.log(`\n  THE TRIGGER — when his record vs this opponent stands out, does he beat his form?`);
    const TH = [1.0, 1.25, 1.5, 2.0];
    const tt = triggerTest(frames, TH, 'vsOpp');
    const pl = triggerTest(frames, TH, 'vsOther');
    const lr = triggerTest(frames, TH, 'longRun');
    console.log(`  base rate of beating form: ${(tt[0].base * 100).toFixed(1)}%  (under 50% because these stats are right-skewed)`);
    console.log(`    threshold   REAL opponent history          PLACEBO other opponent        difference`);
    for (let i = 0; i < TH.length; i++) {
      const r = tt[i], q = pl[i];
      const fmt = (x) => x.rate === null ? `only ${x.n} cases`.padEnd(28)
        : `${String(x.n).padStart(5)} cases · ${(x.rate * 100).toFixed(1)}% · ${((x.rate - x.base) * 100) >= 0 ? '+' : ''}${((x.rate - x.base) * 100).toFixed(1)}pts`.padEnd(28);
      const diff = (r.rate !== null && q.rate !== null)
        ? `${((r.rate - q.rate) * 100) >= 0 ? '+' : ''}${((r.rate - q.rate) * 100).toFixed(1)}pts` : '—';
      console.log(`    >= ${r.t.toFixed(2)}x     ${fmt(r)}  ${fmt(q)}  ${diff}`);
    }

    // The rival explanation, on the SAME frames so the comparison is fair.
    console.log(`\n  THE RIVAL READ — his long-run level above his current form (no opponent involved):`);
    for (const r of lr) {
      if (r.rate === null) { console.log(`    >= ${r.t.toFixed(2)}x form: only ${r.n} cases — withheld`); continue; }
      const edge = (r.rate - r.base) * 100;
      console.log(`    >= ${r.t.toFixed(2)}x form: ${String(r.n).padStart(5)} cases · beat form ${(r.rate * 100).toFixed(1)}% · ${edge >= 0 ? '+' : ''}${edge.toFixed(1)}pts vs base`);
    }
  }

  console.log(`\n[opp-history] Nothing was written. This script answers a question; it is not a build.`);
}

if (require.main === module) {
  main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
}

module.exports = { buildFrames, triggerTest, bestBlend };
