/**
 * The status vocabulary. build-players.js and update-data.js both write statuses
 * and used to keep their own copies of this map; the copies were identical only
 * because nobody had edited one yet.
 */

// Sleeper's one-word injury status → the site's status vocabulary.
const STATUS_MAP = {
  'IR': { status: 'IR', statusClass: 'status-out' },
  'Out': { status: 'Out', statusClass: 'status-out' },
  'Doubtful': { status: 'Doubtful', statusClass: 'status-out' },
  'Questionable': { status: 'Questionable', statusClass: 'status-quest' },
  'Probable': { status: 'Probable', statusClass: 'status-quest' },
  'PUP': { status: 'PUP', statusClass: 'status-out' },
  'Suspended': { status: 'Suspended', statusClass: 'status-out' },
  'NFI': { status: 'NFI', statusClass: 'status-out' },
};

// The only three classes the stylesheet defines. A typo in a hand-written
// override would otherwise render an unstyled badge.
const STATUS_CLASSES = new Set(['status-healthy', 'status-quest', 'status-out']);

// Feed statuses that outrank a hand-written override regardless of its date.
// Never under-report an injury because someone typed something optimistic in July.
const ESCALATIONS = new Set(['IR', 'Out', 'PUP', 'NFI', 'Suspended', 'Doubtful']);

// Body parts that carry no information. Sleeper uses several spellings of
// "we won't say", and appending any of them to a status is pure noise.
const EMPTY_BODY_PARTS = new Set(['undisclosed', 'not injury related', 'unknown', 'n/a', 'none']);

/**
 * Sleeper ships `injury_body_part` alongside `injury_status` and we spent a
 * season discarding it. In camp especially, the one-word status is nearly
 * contentless — seven of our players sat on "Knee - ACL" while the site
 * rendered them as plain "Questionable", indistinguishable from a rest day.
 *
 * The detail goes in parentheses because that is already the site's convention
 * for it, and the compact profile badge already strips at the paren.
 */
function formatStatus(injuryStatus, bodyPart) {
  const mapped = STATUS_MAP[injuryStatus];
  if (!mapped) return null;
  const part = String(bodyPart || '').trim();
  if (!part || EMPTY_BODY_PARTS.has(part.toLowerCase())) return { ...mapped };
  return { status: `${mapped.status} (${part})`, statusClass: mapped.statusClass };
}

module.exports = { STATUS_MAP, STATUS_CLASSES, ESCALATIONS, formatStatus };
