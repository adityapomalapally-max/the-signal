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

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    const doFetch = (u, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      https.get(u, { headers: { 'User-Agent': 'TheSignal/1.0' } }, (res) => {
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
      }).on('error', reject);
    };
    doFetch(url);
  });
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

module.exports = { fetchCSV, parseCSV, parseCSVLine, normalizeName, normalizeSleeperName, buildMatchIndex, matchRow };
