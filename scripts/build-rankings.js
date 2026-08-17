#!/usr/bin/env node
/**
 * build-rankings.js — generate data/rankings.json from data/projections-2026.json
 *
 * The ticker used to read from a hand-typed list of names with no methodology
 * behind it, which is why the ordering looked arbitrary: nothing generated it.
 * This derives every tab from one projection source, so changing a projection
 * changes the site and the two can never drift apart.
 *
 * Positional tabs are ordered by projected median season total.
 *
 * The overall tab is ordered by VORP, not by raw points. Raw points across
 * positions is meaningless — every QB1 outscores every WR1 and it tells you
 * nothing about draft order. VORP asks the only question that matters in a
 * draft: how many points does this player give you over the guy you could have
 * had for free at the same position?
 *
 * Replacement baselines, for 12-team / 1QB / 2RB / 3WR / 1TE / 1FLEX:
 *   QB12  — 12 starting QBs, so the 13th is free.
 *   RB30  — 24 locked RB starters plus roughly half the 12 flex spots.
 *   WR40  — 36 locked WR starters plus most of the remaining flex.
 *   TE12  — 12 starting TEs; flex almost never goes TE without a premium.
 * These are stated rather than tuned. Change them here and the board moves.
 */

const fs = require('fs');
const path = require('path');
const { normalizeName } = require('./lib/match');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SRC = path.join(DATA_DIR, 'projections-2026.json');
const MANUAL = path.join(DATA_DIR, 'rankings-manual.json');
const OUT = path.join(DATA_DIR, 'rankings.json');

// ===== AVAILABILITY =====
// The projections assume 17 games and say so; the floor is where injury
// history is supposed to live. This computes that floor from what actually
// happened rather than leaving it to judgment.
//
// It measures AVAILABILITY, not durability: a game missed to suspension
// counts the same as a game missed to a knee, because the question being
// answered is "how often was he not in your lineup". Rice's 2025 is six
// games of suspension and the number says so.
//
// Seasons are historical and complete, so this is stable between runs — it
// only moves when a projection or the pool changes.
const AVAIL_SEASONS = [2023, 2024, 2025];
const GAMES_PER_SEASON = 17;
// The projections define their floor as roughly a 15th-percentile outcome,
// so the league-wide availability floor is read at the same percentile.
const FLOOR_PERCENTILE = 15;
// If the derived baseline lands outside this range the inputs have moved
// under us and the number would be quietly wrong, so the run stops.
const FLOOR_GAMES_SANE = [6, 14];
// Bounds on the per-player figure. The upper bound exists because nobody is
// injury-proof, so no record should imply a full-season floor; the lower one
// stops a two-season sample of bad luck implying a near-zero season.
const FLOOR_GAMES_CLAMP = [5, 14];

// "3rd Year" in 2026 means he entered in 2024, so 2023 was never his to miss.
// Sleeper's experience is not reliable enough to use alone — it lists Rashee
// Rice and Puka Nacua, both 2023 draftees, as 3rd Year — so a season we hold
// a game log for always counts as eligible. Presence of a log proves he was
// in the league; absence proves nothing, so the label still sets the start
// when it is the earlier of the two.
function entrySeason(experience, season, loggedSeasons) {
  let derived = null;
  if (experience) {
    if (/rookie/i.test(experience)) derived = season;
    else {
      const m = String(experience).match(/^(\d+)/);
      if (m) derived = season - (Number(m[1]) - 1);
    }
  }
  const earliestLogged = loggedSeasons.length ? Math.min(...loggedSeasons) : null;
  if (derived === null) return earliestLogged;
  if (earliestLogged === null) return derived;
  return Math.min(derived, earliestLogged);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// `isRanked` decides who counts toward the LEAGUE baseline — not who gets a
// record. Every player still gets his own availability; the baseline is
// estimated only from projected players.
//
// This matters because the pool is deliberately deeper than the ranked set.
// When it grew from 200 to 350 the extra 150 were backups and third-string
// quarterbacks who play two or three games a year, and the 15th-percentile
// season fell from 11 games to 5. That is not a low-availability starter,
// that is a backup — and it would have quietly made every floor on the site
// far more pessimistic. The sanity guard caught it. The baseline now comes
// from the same population the number is applied to.
function loadAvailability(projSeason, isRanked) {
  const playersPath = path.join(DATA_DIR, 'players.json');
  if (!fs.existsSync(playersPath)) return null;
  const players = JSON.parse(fs.readFileSync(playersPath, 'utf8'));

  const byPlayer = new Map();   // "name|POS" -> record
  const allSeasonGames = [];

  for (const p of players) {
    let weekly = null;
    try {
      weekly = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'weekly', `${p.id}.json`), 'utf8'));
    } catch (e) { continue; }

    const logged = Object.keys(weekly).map(Number).filter(s => AVAIL_SEASONS.includes(s));
    const entry = entrySeason(p.experience, projSeason, logged);
    if (entry === null) continue;

    const eligible = AVAIL_SEASONS.filter(s => s >= entry);
    if (!eligible.length) continue;
    // A game log can carry a duplicate week for a mid-season trade, so cap.
    const games = eligible.map(s => Math.min(weekly[s] ? weekly[s].length : 0, GAMES_PER_SEASON));
    const key = `${normalizeName(p.name)}|${p.pos}`;
    if (isRanked(key)) games.forEach(g => allSeasonGames.push(g));

    // Two pool players collapsing to one key would attach one man's record
    // to another, so poison it rather than guess.
    byPlayer.set(key, byPlayer.has(key) ? null : {
      seasons: eligible, games,
      played: games.reduce((a, b) => a + b, 0),
      possible: eligible.length * GAMES_PER_SEASON,
      worst: Math.min(...games),
      status: p.status || null,
      healthy: p.statusClass === 'status-healthy'
    });
  }

  allSeasonGames.sort((a, b) => a - b);
  const leagueFloorGames = Math.round(percentile(allSeasonGames, FLOOR_PERCENTILE));
  const leagueRate = (allSeasonGames.reduce((a, b) => a + b, 0) / allSeasonGames.length) / GAMES_PER_SEASON;
  if (!(leagueFloorGames >= FLOOR_GAMES_SANE[0] && leagueFloorGames <= FLOOR_GAMES_SANE[1])) {
    console.error(
      `[rankings] ABORT: league availability floor computed as ${leagueFloorGames} games from ` +
      `${allSeasonGames.length} player-seasons, outside the sane range ` +
      `${FLOOR_GAMES_SANE.join('-')}. The weekly logs or the pool have moved.`
    );
    process.exit(1);
  }
  return { byPlayer, leagueFloorGames, leagueRate, sampleSize: allSeasonGames.length };
}

// Attaches the availability picture and the floor it implies.
function availabilityFor(avail, p) {
  if (!avail) return null;
  const rec = avail.byPlayer.get(`${normalizeName(p.name)}|${p.pos}`);
  if (!rec || typeof p.median !== 'number') return null;

  // Everyone carries the league-wide risk. A player's own record then scales
  // it by how available he has been relative to the league.
  //
  // The earlier draft used his single worst season, which let one wrecked
  // year define a player permanently and swung wildly on a sample of three —
  // Rice's 3-game 2024 implied a 39-point floor on a 220-point projection.
  // Scaling the whole record is steadier and still separates the durable
  // from the fragile. His worst season is reported alongside, so the extreme
  // is visible without being the number.
  const rate = rec.played / rec.possible;
  const shortRecord = rec.seasons.length < 2;
  const scaled = Math.round(avail.leagueFloorGames * (rate / avail.leagueRate));
  const floorGames = shortRecord
    ? avail.leagueFloorGames
    : Math.max(FLOOR_GAMES_CLAMP[0], Math.min(FLOOR_GAMES_CLAMP[1], scaled));

  return {
    pct: Math.round(rate * 100),
    seasons: rec.seasons,
    games: rec.games,
    worst: rec.worst,
    floorGames,
    basis: shortRecord ? 'league-short-record'
      : (floorGames < avail.leagueFloorGames ? 'below-league' : floorGames > avail.leagueFloorGames ? 'above-league' : 'league'),
    floor: Math.round((p.median / GAMES_PER_SEASON) * floorGames),
    // History cannot see a knock he is carrying right now, so the number is
    // flagged rather than adjusted — inventing a games-missed figure from a
    // one-word status is exactly the guess this project does not make.
    statusFlag: rec.healthy ? null : rec.status
  };
}

// Rank of the replacement-level player at each position (1-indexed).
const BASELINE_RANK = { qb: 12, rb: 30, wr: 40, te: 12 };

// How many rows each tab publishes.
const TAB_SIZE = { overall: 24, qb: 20, rb: 24, wr: 32, te: 16 };

const log = (m) => console.log(`[rankings] ${m}`);

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`[rankings] ABORT: ${SRC} not found`);
    process.exit(1);
  }
  const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const proj = src.projections;

  const rankedKeys = new Set();
  for (const pos of ['qb', 'rb', 'wr', 'te']) {
    for (const p of (proj[pos] || [])) rankedKeys.add(`${normalizeName(p.name)}|${(p.pos || pos).toUpperCase()}`);
  }
  const availability = loadAvailability(
    src.meta && src.meta.season ? src.meta.season : 2026,
    (key) => rankedKeys.has(key));
  if (availability) {
    log(`availability: league floor = ${availability.leagueFloorGames}/${GAMES_PER_SEASON} games ` +
        `(p${FLOOR_PERCENTILE} of ${availability.sampleSize} projected-player seasons)`);
  } else {
    log('availability: players.json not found — floors stay health-assumed only');
  }

  const baselines = {};
  const pools = {};

  for (const pos of ['qb', 'rb', 'wr', 'te']) {
    const pool = [...(proj[pos] || [])].sort((a, b) => b.median - a.median);
    if (!pool.length) {
      console.error(`[rankings] ABORT: no ${pos.toUpperCase()} projections`);
      process.exit(1);
    }
    const idx = BASELINE_RANK[pos] - 1;
    if (idx >= pool.length) {
      // Refuse to guess. A baseline deeper than the pool would silently inflate
      // every VORP at that position and quietly reorder the whole overall board.
      console.error(
        `[rankings] ABORT: ${pos.toUpperCase()} baseline is rank ${BASELINE_RANK[pos]} ` +
        `but only ${pool.length} are projected. Extend the pool or lower the baseline.`
      );
      process.exit(1);
    }
    baselines[pos] = pool[idx].median;
    pools[pos] = pool;
    log(`${pos.toUpperCase()} baseline = ${pos.toUpperCase()}${BASELINE_RANK[pos]} (${pool[idx].name}, ${pool[idx].median} pts)`);
  }

  const round1 = (n) => Math.round(n * 10) / 10;

  const row = (p, rank, pos) => {
    const r = {
      rank,
      name: p.name,
      team: p.team,
      pos: p.pos || pos.toUpperCase(),
      median: p.median,
      ppg: round1(p.median / 17),
      vorp: Math.round(p.median - baselines[pos])
    };
    // Only publish a band where a real one exists — depth players carry a
    // median for baseline purposes and nothing else. Empty beats invented.
    if (typeof p.floor === 'number') r.floor = p.floor;
    if (typeof p.ceiling === 'number') r.ceiling = p.ceiling;
    const av = availabilityFor(availability, p);
    if (av) r.availability = av;
    return r;
  };

  const out = {
    meta: {
      ...src.meta,
      builtBy: 'scripts/build-rankings.js',
      builtAt: new Date().toISOString(),
      overallMethod:
        'Ordered by VORP (median minus replacement-level median at the same position), not raw points.',
      availabilityMethod: availability
        ? `The missed-time case is a different downside from the floor beside it. The floor is a cold season played out in full; ` +
          `this is a normal season cut short. It holds the projected per-game rate flat and applies it to a low-availability year. ` +
          `League-wide that year is ${availability.leagueFloorGames} of ${GAMES_PER_SEASON} games — the ${FLOOR_PERCENTILE}th percentile of ` +
          `${availability.sampleSize} player-seasons across ${AVAIL_SEASONS[0]}–${AVAIL_SEASONS[AVAIL_SEASONS.length - 1]}, the same percentile the projection set uses for its floor — ` +
          `then scaled by how available the player himself has been against the league average of ${Math.round(availability.leagueRate * 100)}%. ` +
          `It counts every missed game regardless of cause, suspensions included, because the question is how often he was not in your lineup. ` +
          `The per-game rate is deliberately NOT reduced: this prices availability only, never diminished play on return. ` +
          `Ordering is untouched — it moves the downside, never the rank.`
        : undefined,
      availabilityCaveat: availability
        ? 'A record of one or two seasons is too short to read a player-specific floor from, so those fall back to the league figure. ' +
          'A player who is not currently healthy is flagged, not adjusted: history cannot see the knock he is carrying now, and a games-missed number inferred from a one-word status would be invented.'
        : undefined,
      baselines: Object.fromEntries(
        Object.keys(BASELINE_RANK).map((p) => [
          p,
          { rank: BASELINE_RANK[p], points: baselines[p], player: pools[p][BASELINE_RANK[p] - 1].name }
        ])
      )
    }
  };

  // Positional tabs — ranked by median.
  for (const pos of ['qb', 'rb', 'wr', 'te']) {
    out[pos] = pools[pos]
      .filter((p) => !p.baselineOnly)
      .slice(0, TAB_SIZE[pos])
      .map((p, i) => row(p, i + 1, pos));
  }

  // Overall — ranked by VORP across positions.
  const all = [];
  for (const pos of ['qb', 'rb', 'wr', 'te']) {
    pools[pos].filter((p) => !p.baselineOnly).forEach((p) => all.push({ p, pos }));
  }
  all.sort((a, b) => (b.p.median - baselines[b.pos]) - (a.p.median - baselines[a.pos]));
  out.overall = all.slice(0, TAB_SIZE.overall).map(({ p, pos }, i) => row(p, i + 1, pos));

  // ===== MANUAL OVERRIDE =====
  // Any tab listed in rankings-manual.json takes Adi's order verbatim. Tabs
  // left out or emptied fall back to the generated order, so this file can hold
  // one tab or all five. Projections still supply team and PPG where the name
  // matches, so a hand-ordered board keeps the same information density.
  let manual = {};
  if (fs.existsSync(MANUAL)) {
    try {
      manual = JSON.parse(fs.readFileSync(MANUAL, 'utf8'));
    } catch (e) {
      // A typo here should not silently publish the wrong board.
      console.error(`[rankings] ABORT: ${MANUAL} is not valid JSON — ${e.message}`);
      process.exit(1);
    }
  }

  const byName = new Map();
  for (const pos of ['qb', 'rb', 'wr', 'te']) {
    for (const p of pools[pos]) byName.set(p.name.toLowerCase(), { p, pos });
  }

  function applyManual(tab, generated) {
    const list = manual[tab];
    if (!Array.isArray(list) || !list.length) return generated;

    const rows = [];
    const missing = [];
    list.forEach((entry, i) => {
      const name = typeof entry === 'string' ? entry : entry && entry.name;
      if (!name) return;
      const hit = byName.get(String(name).trim().toLowerCase());
      if (hit) {
        const r = row(hit.p, i + 1, hit.pos);
        if (typeof entry === 'object' && entry.team) r.team = entry.team;
        rows.push(r);
      } else {
        // Rank a player with no projection and you still get the rank — you
        // just don't get invented numbers next to it.
        missing.push(name);
        rows.push({
          rank: i + 1,
          name: String(name).trim(),
          team: (typeof entry === 'object' && entry.team) || '',
          pos: ((typeof entry === 'object' && entry.pos) || tab).toUpperCase()
        });
      }
    });
    if (missing.length) {
      log(`  ${tab}: ${missing.length} name(s) not in projections, shown without PPG: ${missing.join(', ')}`);
    }
    log(`  ${tab}: MANUAL order, ${rows.length} rows`);
    out.meta.manualTabs = [...(out.meta.manualTabs || []), tab];
    return rows;
  }

  for (const tab of ['qb', 'rb', 'wr', 'te']) {
    out[tab] = applyManual(tab, out[tab]);
  }

  // ===== OVERALL =====
  // Precedence: a hand-written overall list wins. Otherwise, if any positional
  // tab is hand-ordered, the overall board is derived from those instead of
  // from the model's own order — publishing a VORP board that contradicts the
  // positional tabs sitting next to it would be worse than either alone.
  //
  // Slot inheritance: a player takes the projected median of the SLOT he was
  // ranked into, not his own projection. Rank someone RB5 and he is valued as
  // the 5th-best RB, because that is what the ranking asserts. This keeps the
  // ordering entirely Adi's while the replacement math stays real, and it means
  // players with no projection of their own still get a defensible value.
  const manualPositional = ['qb', 'rb', 'wr', 'te'].filter(
    (t) => Array.isArray(manual[t]) && manual[t].length
  );

  if (Array.isArray(manual.overall) && manual.overall.length) {
    out.overall = applyManual('overall', out.overall);
  } else if (manualPositional.length) {
    const slotMedians = {};
    for (const pos of ['qb', 'rb', 'wr', 'te']) {
      slotMedians[pos] = pools[pos].filter((p) => !p.baselineOnly).map((p) => p.median);
    }

    const board = [];
    for (const pos of ['qb', 'rb', 'wr', 'te']) {
      // A tab left to the model still contributes, using the model's order.
      out[pos].forEach((r, i) => {
        const slots = slotMedians[pos];
        // Past the end of the projected pool there is no slot value to inherit.
        // Fall back to replacement level rather than inventing one: it puts the
        // player at VORP 0 instead of somewhere flattering and arbitrary.
        const slotMedian = i < slots.length ? slots[i] : baselines[pos];
        board.push({ r, pos, slotMedian, vorp: slotMedian - baselines[pos] });
      });
    }
    board.sort((a, b) => b.vorp - a.vorp);

    out.overall = board.slice(0, TAB_SIZE.overall).map((e, i) => {
      const o = { ...e.r, rank: i + 1, vorp: Math.round(e.vorp) };
      // The overall tab is a value board, so every row is shown on the same
      // slot basis. A player's own projection is kept alongside rather than
      // dropped — where the two disagree, that gap is the ranking's actual
      // claim about him, and it should stay visible.
      if (typeof e.r.ppg === 'number') o.ownPpg = e.r.ppg;
      if (typeof e.r.median === 'number') o.ownMedian = e.r.median;
      o.median = e.slotMedian;
      o.ppg = round1(e.slotMedian / 17);
      return o;
    });

    out.meta.overallMethod =
      'Derived from the hand-ordered positional tabs. Each player inherits the projected median of the slot he was ranked into, then VORP is taken against replacement level. Ordering is the analyst\'s; the replacement math is the model\'s.';
    out.meta.overallDerivedFrom = manualPositional;
    log(`  overall: DERIVED from manual tabs (${manualPositional.join(', ')}) via slot-inherited VORP`);
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  log(`Wrote ${OUT}`);
  for (const tab of ['overall', 'qb', 'rb', 'wr', 'te']) log(`  ${tab}: ${out[tab].length} rows`);
}

main();
