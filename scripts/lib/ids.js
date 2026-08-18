/**
 * ids.js — the crosswalk between every id the football world uses
 *
 * WHY THIS EXISTS
 * The moat is currently eight of nflverse's twenty-five data buckets, and the
 * reason the other seventeen were never pulled in is that most of them are not
 * keyed on GSIS. Pro Football Reference keys on `pfr_id`, PFF on `pff_id`, ESPN
 * on `espn_id`. Without a crosswalk the only way in is name matching — the exact
 * hazard the GSIS backfill was written to end, and it would be reintroduced once
 * per new dataset.
 *
 * nflverse publishes the crosswalk itself in the `players` release: one row per
 * player carrying gsis_id, pfr_id, pff_id, espn_id, esb_id and more. So joining
 * a new bucket becomes an ID-to-ID lookup, no name guessing, the same standard
 * the pool already holds itself to.
 *
 * MEASURED: 339 of our 350 carry a pfr_id and 298 a pff_id, through 343 that
 * have a GSIS id at all. The ones that do not are the rookies the league has not
 * assigned ids to yet, which is the honest answer rather than a guess.
 *
 * NEVER BLANK AN ID BECAUSE A FETCH FAILED. Same rule as the GSIS backfill: if
 * the crosswalk is unavailable, callers get an empty map and must skip the
 * enrichment, not overwrite what is already on file with nothing.
 */

const { fetchCSV, parseCSV } = require('./match');

const URL = 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv';

let cache = null;

/**
 * gsis_id -> { pfr, pff, espn, esb, position, birthDate, rookieSeason, ... }
 * Fetched once per process. The file is ~25k rows and is the smallest thing
 * that unlocks the other buckets.
 */
async function crosswalk() {
  if (cache) return cache;
  const rows = parseCSV(await fetchCSV(URL));
  const byGsis = new Map();
  const byPfr = new Map();
  for (const r of rows) {
    if (!r.gsis_id) continue;
    const entry = {
      gsis: String(r.gsis_id),
      // Every id here arrives from a CSV where a purely numeric id would have
      // been parsed into a Number. They are keys, not quantities — an espn_id of
      // 3139477 must never be compared as a float or formatted in exponential.
      pfr: r.pfr_id == null ? null : String(r.pfr_id),
      pff: r.pff_id == null ? null : String(r.pff_id),
      espn: r.espn_id == null ? null : String(r.espn_id),
      esb: r.esb_id == null ? null : String(r.esb_id),
      position: r.position || null,
      birthDate: r.birth_date || null,
      rookieSeason: r.rookie_season || null,
      draftYear: r.draft_year || null,
      draftRound: r.draft_round || null,
      draftPick: r.draft_pick || null,
      college: r.college_name || null,
    };
    byGsis.set(entry.gsis, entry);
    if (entry.pfr) byPfr.set(entry.pfr, entry);
  }
  cache = { byGsis, byPfr, rows: rows.length };
  return cache;
}

/**
 * Build the maps a fetch script actually needs: from our pool's ids to the
 * foreign id, and back again.
 *
 * Returns { toPfr, fromPfr, missing } where `missing` is the list of our players
 * with no crosswalk entry — reported rather than silently dropped, because a
 * bucket that covers 200 of 350 and a bucket that covers 340 of 350 are very
 * different products and the difference should never be invisible.
 */
async function poolCrosswalk(pool, key = 'pfr') {
  const { byGsis } = await crosswalk();
  const toForeign = new Map();   // our id -> foreign id
  const fromForeign = new Map(); // foreign id -> our player
  const missing = [];
  for (const p of pool) {
    const entry = p.gsisId ? byGsis.get(String(p.gsisId)) : null;
    const foreign = entry ? entry[key] : null;
    if (!foreign) { missing.push({ id: p.id, name: p.name, why: !p.gsisId ? 'no gsis id' : 'no ' + key + ' id' }); continue; }
    toForeign.set(p.id, foreign);
    fromForeign.set(foreign, p);
  }
  return { toForeign, fromForeign, missing };
}

module.exports = { crosswalk, poolCrosswalk, URL };
