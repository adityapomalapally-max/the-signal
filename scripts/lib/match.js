/**
 * Shared CSV fetching + player matching for the nflverse pipeline scripts.
 *
 * One matcher, required by every script that maps nflverse rows onto our
 * players.json pool — two hand-copied matchers WILL drift (update-data.js
 * vs fetch-stats.js already did once, over name suffixes and periods).
 *
 * Matching contract:
 *   1. GSIS id, when both sides have one — exact, no position check
 *      (a GSIS id identifies one human; position guards exist only to keep
 *      same-NAME strangers apart, and they wrongly reject two-way players).
 *   2. Normalized name + position. Two pool players who collapse to the
 *      same key poison it: matching neither beats guessing.
 */

const https = require('https');
const zlib = require('zlib');
const { USER_AGENT } = require('./agent');

/**
 * THE SEAM, the same shape as lib/season's `__setState` and lib/feeds'
 * `__setPublished`.
 *
 * Every nflverse fetch in this repo goes through the function below and NOTHING
 * tested it — tests/ never mentioned this file. That was invisible until the
 * mutation ratchet reported itself getting stronger on 2026-09-25: the extra
 * kill was `statusCode < 400` here, and it died only because build-ros had begun
 * asking the schedule feed and GitHub happened to answer 302. A kill that rests
 * on a CDN's behaviour is not a test, and it would have come undone the day the
 * release URL stopped redirecting.
 *
 * So the transport is injectable and the redirect rules are asserted offline.
 */
let transport = null;
function __setTransport(fn) { transport = fn; }
function __resetTransport() { transport = null; }

// A 500 IS NOT A 404, AND THE DIFFERENCE IS A DAY'S DATA.
//
// On 2026-09-30 nflverse answered advstats_season_pass.csv with an HTTP 500 for
// a few minutes. fetch-advstats exited 1, every build step below it was skipped,
// the commit never happened, and the whole day was lost. The next morning the
// same URL was fine. Nothing was broken except the timing of one request.
//
// THE HARD FAILURE ON 404 STAYS, and deliberately: fetch-advstats' own header
// records why — nflverse moved that file once and a per-season try/catch
// swallowed the 404 for months. A 4xx means the thing we asked for is not there
// any more and somebody has to know. A 5xx means the server is having a moment,
// and so does a dropped socket. Those are worth asking again about; a moved file
// is not.
//
// Retries are announced rather than silent. A retry that quietly saves the run
// every morning is a feed degrading where nobody can see it.
const RETRY_ATTEMPTS = 3;
let backoffMs = [1500, 4000];
function __setBackoff(ms) { backoffMs = ms; }       // tests do not wait 5.5 seconds

const retriable = (err) => /^HTTP 5\d\d/.test(err.message) || err.transportError === true;

function fetchOnce(url) {
  return new Promise((resolve, reject) => {
    const doFetch = (u, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      const get = transport || https.get.bind(https);
      get(u, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doFetch(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          try {
            resolve(url.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8'));
          } catch (e) {
            reject(new Error(`gunzip failed for ${u}: ${e.message}`));
          }
        });
      }).on('error', (e) => {
        // A dropped socket is the same kind of accident as a 502 and gets the
        // same second chance. Tagged rather than string-matched: 'socket hang up'
        // and ECONNRESET and ETIMEDOUT are all this, spelled differently.
        e.transportError = true;
        reject(e);
      });
    };
    doFetch(url);
  });
}

async function fetchCSV(url) {
  let last = null;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fetchOnce(url);
    } catch (e) {
      last = e;
      if (!retriable(e) || attempt === RETRY_ATTEMPTS) break;
      const wait = backoffMs[attempt - 1] !== undefined ? backoffMs[attempt - 1] : 4000;
      console.error(`[fetch] ${e.message} — asking again in ${wait}ms (attempt ${attempt + 1} of ${RETRY_ATTEMPTS})`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw last;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; }
    else if (c === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += c; }
  }
  result.push(current);
  return result;
}

function parseCSV(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    if (vals.length !== headers.length) continue;
    const row = {};
    headers.forEach((h, j) => {
      const v = vals[j].replace(/^"|"$/g, '').trim();
      row[h] = v === '' || v === 'NA' ? null : isNaN(v) ? v : parseFloat(v);
    });
    rows.push(row);
  }
  return rows;
}

function normalizeName(name) {
  return String(name || '')
    .replace(/\s+(III|II|IV|Jr\.?|Sr\.?)$/i, '')
    .replace(/[''`]/g, '')  // apostrophes/smart quotes
    .replace(/\./g, '')     // periods: "A.J. Barner" vs Sleeper's "AJ Barner"
    .toLowerCase()
    .trim();
}

// The Sleeper flavour. It is NOT the same normalizer as above and the
// difference is load-bearing: nflverse writes "Amon-Ra St. Brown" with the
// hyphen intact, Sleeper splits the name across first_name/last_name and the
// reassembled spelling varies, so the Sleeper side has to collapse hyphens to
// spaces and strip suffixes anywhere in the name rather than only at the end.
// Run either normalizer against the other's source and matches vanish.
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
function normalizeSleeperName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')       // periods and apostrophes: "St." / "Ja'Marr"
    .replace(/[-‐-―]/g, ' ') // hyphens: "Amon-Ra"
    .split(/\s+/)
    .filter(t => t && !NAME_SUFFIXES.has(t))
    .join(' ')
    .trim();
}

function buildMatchIndex(ourPlayers, log) {
  const byGsis = new Map();
  const byName = new Map();
  for (const p of ourPlayers) {
    if (p.gsisId) byGsis.set(p.gsisId, p);
    const key = `${normalizeName(p.name)}|${p.pos}`;
    if (byName.has(key)) {
      if (log) log(`  AMBIGUOUS pool name — name-matching disabled for both: ${p.name} (${p.pos})`);
      byName.set(key, null);
    } else {
      byName.set(key, p);
    }
  }
  return { byGsis, byName };
}

// fields: { gsis, name, pos } — pass whatever the source row has.
function matchRow(index, fields) {
  if (fields.gsis) {
    const byId = index.byGsis.get(fields.gsis);
    if (byId) return byId;
  }
  return index.byName.get(`${normalizeName(fields.name || '')}|${fields.pos}`) || null;
}

module.exports = { fetchCSV, parseCSV, parseCSVLine, normalizeName, normalizeSleeperName, buildMatchIndex, matchRow,
  __setTransport, __resetTransport, __setBackoff, RETRY_ATTEMPTS };
