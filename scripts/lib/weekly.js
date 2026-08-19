/**
 * Weekly opportunity: what a player was GIVEN, week by week.
 *
 * Production tells you what happened. Opportunity tells you what is likely to
 * keep happening, and the gap between the two is where a waiver claim lives. The
 * analysis community is unusually settled on which numbers carry: target share
 * and snap share are the stickiest inputs in fantasy, and WOPR — 1.5x target
 * share plus 0.7x air-yards share — is the standard combination of the two
 * halves of a receiver's role, volume and depth.
 *
 * SHARES NEED A TEAM DENOMINATOR AND THE POOL CANNOT PROVIDE ONE. The 350-player
 * pool holds the fantasy-relevant players, not every player, so team totals
 * computed from it would be short by whatever the unrostered receivers caught —
 * and every share would come out too high, by a different amount for every team.
 * The denominators therefore come from pbp, which has all of it.
 *
 * ROUTES RUN IS NOT HERE. Yards per route run is the other metric this layer
 * would want, and route participation is charted by PFF and FTN rather than
 * recorded in the play-by-play. Snap share is the closest free substitute and it
 * is a different thing — a receiver on the field for a run play ran no route.
 * Calling snap share a route share would be inventing the column.
 */

const { parseCSVLine } = require('./match');

// WOPR's weights are the published ones. Shares go in as DECIMALS, not
// percentages: a 25% target share is 0.25, and the result lands on roughly a
// 0-to-1.5 scale. Feeding percentages in produces a number a hundred times too
// large that still sorts correctly, which is how it survives review.
const WOPR_TARGET = 1.5;
const WOPR_AIR = 0.7;

function wopr(targetShare, airShare) {
  if (typeof targetShare !== 'number' || typeof airShare !== 'number') return null;
  return round(WOPR_TARGET * (targetShare / 100) + WOPR_AIR * (airShare / 100), 3);
}

function round(v, p = 1) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  const m = Math.pow(10, p);
  return Math.round(v * m) / m;
}

function share(part, whole) {
  if (!whole || typeof part !== 'number') return null;
  return round(part / whole * 100, 1);
}

/**
 * Per-week opportunity from the play-by-play. Returns team denominators and
 * per-player counts, both keyed by week.
 */
function usageFromPbp(pbpCsv) {
  const lines = pbpCsv.split('\n');
  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const I = {};
  header.forEach((h, i) => { I[h] = i; });
  for (const need of ['week', 'posteam', 'pass_attempt', 'rush_attempt', 'air_yards',
                      'receiver_player_id', 'rusher_player_id', 'season_type']) {
    if (I[need] === undefined) throw new Error(`pbp is missing ${need} — the schema moved`);
  }

  const teams = new Map();    // "week|team" -> { attempts, airYards, carries }
  const players = new Map();  // "week|gsis" -> { targets, airYards, carries, team }

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const v = parseCSVLine(lines[i]);
    const g = c => (I[c] === undefined || v[I[c]] === undefined) ? '' : v[I[c]].replace(/"/g, '').trim();
    // Regular season only, same as every other board on this site.
    if (g('season_type') && g('season_type') !== 'REG') continue;
    const week = g('week'), team = g('posteam');
    if (!week || !team) continue;

    const tk = `${week}|${team}`;
    if (!teams.has(tk)) teams.set(tk, { attempts: 0, airYards: 0, carries: 0 });
    const t = teams.get(tk);

    const ay = parseFloat(g('air_yards'));
    const hasAy = !Number.isNaN(ay);

    if (g('pass_attempt') === '1') {
      t.attempts++;
      if (hasAy) t.airYards += ay;
      const rec = g('receiver_player_id');
      if (rec) {
        const pk = `${week}|${rec}`;
        if (!players.has(pk)) players.set(pk, { targets: 0, airYards: 0, carries: 0, team });
        const p = players.get(pk);
        p.targets++;
        if (hasAy) p.airYards += ay;
      }
    }
    if (g('rush_attempt') === '1') {
      t.carries++;
      const ru = g('rusher_player_id');
      if (ru) {
        const pk = `${week}|${ru}`;
        if (!players.has(pk)) players.set(pk, { targets: 0, airYards: 0, carries: 0, team });
        players.get(pk).carries++;
      }
    }
  }
  return { teams, players };
}

/** Offensive snaps per player-week, keyed by PFR id — what snap_counts uses. */
function snapsFromCsv(snapCsv) {
  const lines = snapCsv.split('\n');
  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const I = {};
  header.forEach((h, i) => { I[h] = i; });
  for (const need of ['week', 'pfr_player_id', 'offense_snaps', 'offense_pct', 'game_type', 'opponent']) {
    if (I[need] === undefined) throw new Error(`snap_counts is missing ${need} — the schema moved`);
  }
  const out = new Map();   // "week|pfrId" -> { snaps, pct, opp }
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const v = parseCSVLine(lines[i]);
    const g = c => (v[I[c]] || '').replace(/"/g, '').trim();
    if (g('game_type') && g('game_type') !== 'REG') continue;
    const id = g('pfr_player_id');
    if (!id) continue;
    const snaps = parseInt(g('offense_snaps'), 10);
    if (!snaps) continue;
    // offense_pct arrives as a FRACTION (1 = every snap), not a percentage.
    const pct = parseFloat(g('offense_pct'));
    out.set(`${g('week')}|${id}`, {
      snaps,
      pct: Number.isNaN(pct) ? null : round(pct * 100, 1),
      opp: g('opponent') || null,
    });
  }
  return out;
}

/**
 * Join the two into one row per player-week.
 * `pool` entries need { id, name, pos, gsisId } and `toPfr` maps our id -> pfr id.
 */
function buildWeeklyUsage(pbpCsv, snapCsv, pool, toPfr) {
  const { teams, players } = usageFromPbp(pbpCsv);
  const snaps = snapsFromCsv(snapCsv);
  const out = {};
  let rows = 0, withSnaps = 0;

  for (const p of pool) {
    if (!p.gsisId) continue;
    const pfr = toPfr.get(p.id) || null;
    const weeks = [];
    for (let w = 1; w <= 22; w++) {
      const pk = `${w}|${p.gsisId}`;
      const use = players.get(pk);
      const snap = pfr ? snaps.get(`${w}|${pfr}`) : null;
      if (!use && !snap) continue;
      const team = (use && use.team) || null;
      const t = team ? teams.get(`${w}|${team}`) : null;
      const targets = use ? use.targets : 0;
      const airYards = use ? round(use.airYards, 1) : 0;
      const carries = use ? use.carries : 0;
      const tShare = t ? share(targets, t.attempts) : null;
      const aShare = t && t.airYards > 0 ? share(airYards, t.airYards) : null;
      const row = {
        week: w,
        team,
        opp: snap ? snap.opp : null,
        snaps: snap ? snap.snaps : null,
        snapPct: snap ? snap.pct : null,
        targets, targetShare: tShare,
        airYards, airYardsShare: aShare,
        wopr: wopr(tShare, aShare),
        carries,
        rushShare: t ? share(carries, t.carries) : null,
        touches: targets + carries,
      };
      weeks.push(row);
      rows++;
      if (snap) withSnaps++;
    }
    if (weeks.length) out[p.gsisId] = { name: p.name, pos: p.pos, weeks };
  }
  return { players: out, coverage: { rows, withSnaps, snapPct: rows ? round(withSnaps / rows * 100, 1) : null } };
}

module.exports = { buildWeeklyUsage, usageFromPbp, snapsFromCsv, wopr, share, round, WOPR_TARGET, WOPR_AIR };
