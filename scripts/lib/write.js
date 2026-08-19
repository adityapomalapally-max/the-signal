/**
 * Writing a generated file only when it actually changed.
 *
 * Every build here stamps `meta.generated` with the moment it ran, so a file
 * whose data is byte-identical to yesterday's still lands as a fresh commit
 * every morning. The bot runs daily, which means the largest artefacts in the
 * repo were being rewritten on days when nothing happened — 61 commits touched
 * data/ in a fortnight, and fieldmap.json alone is 1.25MB.
 *
 * THE RULE ALREADY EXISTS HERE. build-history.js is deliberately idempotent —
 * "a second run replaces the day rather than appending it" — because a doubled
 * day skews every average computed over the series later. This is the same
 * rule applied to the files that are rewritten whole: if the only difference
 * between what we are about to write and what is on disk is the timestamp we
 * just generated, then nothing happened, and saying otherwise is noise.
 *
 * THE TIMESTAMP IS NOT DISCARDED, IT IS DEFERRED. When the data does move, the
 * new file carries the moment it moved. What it never carries is a moment when
 * only the clock moved. That makes `generated` mean "when this data last
 * changed", which is the more useful of the two readings and the one people
 * assume it already has.
 */

const fs = require('fs');

// Fields whose value is the current time and therefore always differs. They
// are compared as absent rather than as equal, so a change anywhere else still
// counts. Add to this list rather than special-casing at a call site.
const VOLATILE = ['generated', 'generatedAt', 'builtAt', 'lastRun', 'fetchedAt'];

function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      if (VOLATILE.includes(k)) continue;
      out[k] = stripVolatile(value[k]);
    }
    return out;
  }
  return value;
}

// Key order is not meaningful in these files but IS meaningful to a byte
// comparison, so the comparison is made on a canonical form. Without this a
// build that happens to enumerate a map in a different order reads as a change
// every time, which is the bug this file exists to remove.
function canonical(obj) {
  return JSON.stringify(stripVolatile(obj));
}

/**
 * Write `obj` as JSON to `file`, unless the only thing that changed is a
 * timestamp. Returns true if it wrote, false if it left the file alone.
 */
function writeJSONIfChanged(file, obj, opts) {
  const o = opts || {};
  const indent = o.indent === undefined ? 2 : o.indent;
  const next = JSON.stringify(obj, null, indent) + '\n';

  if (fs.existsSync(file)) {
    let prev = null;
    try {
      prev = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      // A corrupt file on disk is a reason to write, not a reason to fail.
      prev = null;
    }
    if (prev !== null && canonical(prev) === canonical(obj)) {
      return false;
    }
  }

  fs.writeFileSync(file, next);
  return true;
}

module.exports = { writeJSONIfChanged, canonical, stripVolatile, VOLATILE };
