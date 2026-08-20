/**
 * Simulated data must never ship.
 *
 * The in-season layers cannot be exercised before September, so the only way to
 * check that the pages behave in week 1 is to build a week-1 season and look.
 * That capability has to exist, and it must not be able to reach the site: a
 * stamped file looks exactly like a real one to every page that reads it, and a
 * matchup board quietly serving invented defences is worse than one that is
 * empty.
 *
 * ros.json already had this guard. It now covers every generated file, because
 * the simulation trick is no longer unique to that one.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DATA = path.join(__dirname, '..', 'data');

test('no committed data file is stamped as simulated', () => {
  const offenders = [];
  for (const f of fs.readdirSync(DATA)) {
    if (!f.endsWith('.json')) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { continue; }
    if (!j || typeof j !== 'object') continue;
    const meta = j.meta || {};
    if (meta.simulated || meta.simulation || j.simulated) offenders.push(f);
  }
  assert.deepStrictEqual(offenders, [],
    'these files carry a simulation stamp and would serve invented numbers to readers');
});

test('a season nobody has played yet is not in a data file', () => {
  // The other shape of the same mistake: a file claiming rows for a season the
  // league has not started. Caught by comparing against the calendar rather
  // than against a hardcoded year, so this keeps working next August.
  const now = new Date();
  // The league year turns over in March; before that, January still belongs to
  // the season that began the previous September.
  const leagueYear = now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const impossible = leagueYear + 1;
  const offenders = [];
  for (const f of fs.readdirSync(DATA)) {
    if (!f.endsWith('.json')) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { continue; }
    const seasons = (j && j.meta && j.meta.seasons) || null;
    if (!Array.isArray(seasons)) continue;
    if (seasons.map(Number).some(y => y >= impossible)) offenders.push(`${f} (${seasons.join(', ')})`);
  }
  assert.deepStrictEqual(offenders, [],
    `a data file carries rows for ${impossible}, which has not been played`);
});
