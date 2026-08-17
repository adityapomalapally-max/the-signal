/**
 * The hand-written status layer.
 *
 * Sleeper's injury_status is the only automatic source of a player's current
 * availability, and its vocabulary is eight words long. It cannot say "PUP,
 * Achilles, tracking Week 1", it cannot say "veteran rest day, ignore the
 * Questionable", and in camp it says "Questionable (Undisclosed)" for both the
 * torn ACL and the guy who tweaked something in a walkthrough.
 *
 * data/injury-overrides.json is where a human says the thing the feed can't.
 * Every entry is DATED and SOURCED, and every entry EXPIRES. That last part is
 * the whole point: the previous hand-written status ("Monitor (Concussion Hx)")
 * carried no date, no source, and nothing in the pipeline could ever retire it,
 * so it outlived the injury it described by two seasons. A hand note that
 * cannot expire is not a note, it is a permanent edit to the data.
 *
 * Precedence, highest first:
 *   1. A live feed ESCALATION (IR / Out / PUP / NFI / Suspended / Doubtful)
 *   2. A live override
 *   3. The feed
 * An override may therefore quiet a "Questionable" the feed is shouting, but it
 * can never talk one down from IR.
 */

const fs = require('fs');
const path = require('path');
const { STATUS_CLASSES, ESCALATIONS } = require('./status');

const OVERRIDES_FILE = path.join(__dirname, '..', '..', 'data', 'injury-overrides.json');

// How long an entry lives when it doesn't set its own `expires`. Camp news goes
// stale fast; three weeks is about how long a "he's being held out" report is
// worth anything without a fresh report behind it.
const DEFAULT_DURATION_DAYS = 21;

const REQUIRED = ['player', 'pos', 'status', 'statusClass', 'setAt', 'source'];
const ALLOWED = new Set([...REQUIRED, 'sleeperId', 'expires', 'note']);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(s) {
  if (!DATE_RE.test(String(s || ''))) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

function addDays(ms, days) {
  return ms + days * 86400000;
}

function readOverrides() {
  if (!fs.existsSync(OVERRIDES_FILE)) return { overrides: [] };
  return JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));
}

/**
 * Shape and date checks only — no player matching, so this runs anywhere.
 * Returns { entry, errors[], expiresAt, live } per row.
 */
function validateOverrides(file, now = Date.now()) {
  const rows = Array.isArray(file && file.overrides) ? file.overrides : null;
  if (!rows) {
    return { fileError: 'injury-overrides.json must have an "overrides" array', rows: [] };
  }

  const seen = new Map();
  const results = rows.map((entry, i) => {
    const errors = [];
    const label = entry && entry.player ? `${entry.player}` : `entry #${i + 1}`;

    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { entry, label, errors: [`${label}: not an object`], live: false };
    }

    for (const field of REQUIRED) {
      const v = entry[field];
      if (v === undefined || v === null || String(v).trim() === '') {
        errors.push(`${label}: missing required field "${field}"`);
      }
    }
    // A typo'd key is silent data loss — "expiry" instead of "expires" would
    // hand the entry an unintended three more weeks of life.
    for (const key of Object.keys(entry)) {
      if (!ALLOWED.has(key)) errors.push(`${label}: unknown field "${key}"`);
    }

    if (entry.statusClass && !STATUS_CLASSES.has(entry.statusClass)) {
      errors.push(`${label}: statusClass "${entry.statusClass}" is not one of ${[...STATUS_CLASSES].join(', ')}`);
    }

    const setAt = parseDate(entry.setAt);
    if (entry.setAt !== undefined && setAt === null) {
      errors.push(`${label}: setAt "${entry.setAt}" is not a YYYY-MM-DD date`);
    }
    if (setAt !== null && setAt > now) {
      errors.push(`${label}: setAt "${entry.setAt}" is in the future`);
    }

    let expiresAt = null;
    if (entry.expires !== undefined) {
      expiresAt = parseDate(entry.expires);
      if (expiresAt === null) {
        errors.push(`${label}: expires "${entry.expires}" is not a YYYY-MM-DD date`);
      } else if (setAt !== null && expiresAt <= setAt) {
        errors.push(`${label}: expires "${entry.expires}" is not after setAt "${entry.setAt}"`);
      }
    } else if (setAt !== null) {
      expiresAt = addDays(setAt, DEFAULT_DURATION_DAYS);
    }

    // Two live entries for one player is an unresolvable instruction, not a
    // precedence puzzle to guess at.
    const key = `${String(entry.player || '').toLowerCase()}|${entry.pos || ''}`;
    if (seen.has(key)) {
      errors.push(`${label}: duplicate entry (also at #${seen.get(key) + 1})`);
    } else {
      seen.set(key, i);
    }

    const expired = expiresAt !== null && expiresAt <= now;
    return {
      entry,
      label,
      errors,
      expiresAt,
      expired,
      live: errors.length === 0 && !expired,
    };
  });

  return { fileError: null, rows: results };
}

function daysAgo(ms, now = Date.now()) {
  return Math.floor((now - ms) / 86400000);
}

module.exports = {
  OVERRIDES_FILE,
  DEFAULT_DURATION_DAYS,
  readOverrides,
  validateOverrides,
  parseDate,
  addDays,
  daysAgo,
  ESCALATIONS,
};
