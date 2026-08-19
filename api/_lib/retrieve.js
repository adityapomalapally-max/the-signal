/**
 * Retrieval: turning a question into the slice of the site that answers it.
 *
 * This is the whole reason the chatbot is worth building. A general model can
 * already talk about football; what it cannot do is tell you that 52.8% of
 * Chase Brown's targets were checkdowns, because that number exists in three
 * places on earth and one of them is this repo. So the model is never asked to
 * recall anything — it is handed the rows and told to read them.
 *
 * THE RULE THAT MATTERS: what is not in the context does not get answered.
 * Every other layer of this site refuses to publish a number it cannot source,
 * and a chatbot that invents one undoes all of it at once — more thoroughly
 * than a bad chart, because prose sounds certain. The context therefore carries
 * ONLY what is on disk, and the prompt forbids going beyond it.
 *
 * NAME MATCHING IS DELIBERATELY UNGREEDY. `resolvePlayer('robinson')` on this
 * site once returned Bijan for a question about Demarcus, because the slugs are
 * surnames and the first match won. Here an ambiguous surname returns EVERY
 * player it could mean and the answer is required to say so. Guessing which
 * Robinson somebody meant is how a confident wrong answer gets made.
 */

const path = require('path');

// Lazily required, and cached by require() itself. A question about a knee
// should not pay to parse the 1.2MB field map.
const DATA = path.join(__dirname, '..', '..', 'data');
const cache = {};
function load(name) {
  if (!(name in cache)) {
    try { cache[name] = require(path.join(DATA, `${name}.json`)); }
    catch (e) { cache[name] = null; }   // an absent file is an answer, not a crash
  }
  return cache[name];
}

const STOP = new Set(['the', 'a', 'an', 'is', 'was', 'are', 'were', 'do', 'does', 'did', 'how',
  'what', 'who', 'when', 'why', 'which', 'should', 'i', 'my', 'me', 'you', 'he', 'his', 'him',
  'and', 'or', 'but', 'for', 'to', 'of', 'in', 'on', 'at', 'vs', 'versus', 'better', 'best',
  'worse', 'worst', 'more', 'less', 'than', 'that', 'this', 'it', 'be', 'been', 'has', 'have',
  'get', 'got', 'good', 'bad', 'about', 'with', 'from', 'over', 'under', 'draft', 'start', 'sit']);

// "James Cook III" has the surname Cook. A generational suffix is not a name to
// match on, and left in it becomes one — the pool contains three players whose
// apparent surname was "iii".
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
function surnameOf(normalizedName) {
  const parts = normalizedName.split(' ').map(x => x.replace(/\.$/, '')).filter(Boolean);
  while (parts.length > 1 && SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  return parts[parts.length - 1] || '';
}

function normalize(s) {
  return String(s || '').toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Players the question refers to. Full-name matches win outright; a bare
 * surname that fits more than one player returns all of them, flagged.
 */
function findPlayers(question, pool) {
  const q = ' ' + normalize(question) + ' ';
  const full = [];
  const bySurname = new Map();
  // Surnames the question already pinned with a first name. "Is Bijan Robinson
  // good" must NOT drag in Brian and Wan'Dale — the question was not ambiguous,
  // and offering three players as though it were is its own kind of wrong.
  const resolved = new Set();

  for (const p of pool) {
    const name = normalize(p.name);
    if (!name) continue;
    if (q.includes(' ' + name + ' ')) { full.push(p); resolved.add(surnameOf(name)); continue; }
    const surname = surnameOf(name);
    // Two letters is a coincidence waiting to happen. Three is not: Bo Nix and
    // Nazir Ali are both in the pool, and excluding them to be safe makes the
    // engine unable to answer about real players.
    if (surname.length < 3) continue;
    if (q.includes(' ' + surname + ' ')) {
      if (!bySurname.has(surname)) bySurname.set(surname, []);
      bySurname.get(surname).push(p);
    }
  }

  const out = [...full];
  const ambiguous = [];
  for (const [surname, players] of bySurname) {
    // Already pinned by a full-name match in the same question.
    if (resolved.has(surname)) continue;
    if (players.length === 1) out.push(players[0]);
    else {
      ambiguous.push({ surname, players: players.map(p => `${p.name} (${p.pos}, ${p.team})`) });
      for (const p of players) out.push(p);
    }
  }
  return { players: out.slice(0, 6), ambiguous };
}

// What the question is actually asking about, so the context carries the layer
// that answers it rather than everything the site knows.
const TOPICS = [
  { key: 'medical', re: /injur|hurt|health|acl|hamstring|concussion|achilles|ankle|knee|return|ir\b|questionable|doubtful|out\b/i },
  { key: 'field', re: /deep|intermediate|short|middle|left|right|red zone|goal ?line|gap|zone|field|target depth|adot|air yards/i },
  { key: 'charting', re: /first read|checkdown|read|contested|drop|separation|route|scheme|play ?action|pressure/i },
  { key: 'usage', re: /snap|usage|personnel|role|touches|workload|committee|share/i },
  { key: 'rank', re: /rank|draft|adp|value|sleeper|bust|breakout|tier|worth|pick|round/i },
  { key: 'stats', re: /yard|touchdown|td\b|catch|reception|carry|carries|target|point|ppg|score|stat|epa|efficien/i },
];

function detectTopics(question) {
  const hits = TOPICS.filter(t => t.re.test(question)).map(t => t.key);
  // A question with no recognisable topic still deserves the basics.
  return hits.length ? hits : ['stats', 'rank'];
}

function latestSeason(obj) {
  if (!obj) return null;
  const years = Object.keys(obj).filter(k => /^\d{4}$/.test(k)).sort();
  return years.length ? years[years.length - 1] : null;
}

function round(v, p = 1) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  const m = Math.pow(10, p);
  return Math.round(v * m) / m;
}

// Strip nulls so the model is never handed a field that looks answerable and
// is not. An absent key reads as "not on file"; a null reads as a value.
function compact(obj) {
  if (Array.isArray(obj)) return obj.map(compact).filter(v => v !== undefined && v !== null);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const c = compact(v);
      if (c === null || c === undefined) continue;
      if (typeof c === 'object' && !Array.isArray(c) && !Object.keys(c).length) continue;
      if (Array.isArray(c) && !c.length) continue;
      out[k] = c;
    }
    return out;
  }
  return obj;
}

module.exports = { load, normalize, findPlayers, detectTopics, latestSeason, round, compact, TOPICS, STOP };

/* ═══════════════════════════════════════════════════════════════════════════
   Building the context

   One object per player, carrying only the layers the question asked for. Every
   figure keeps its qualifier and its season, because a number without those is
   the thing this site spends its whole codebase refusing to publish.
   ═══════════════════════════════════════════════════════════════════════════ */

function rankOf(player, rankings) {
  if (!rankings) return null;
  for (const board of ['overall', 'qb', 'rb', 'wr', 'te']) {
    const list = rankings[board];
    if (!Array.isArray(list)) continue;
    const hit = list.find(r => r.name === player.name);
    if (hit && board === 'overall') {
      return compact({
        overallRank: hit.rank, projectedPoints: hit.median, projectedPPG: hit.ppg,
        floor: hit.floor, ceiling: hit.ceiling,
        availabilityPct: hit.availability && hit.availability.pct,
        note: 'Projections are the analyst\'s medians, not a simulation. Floor and ceiling are the 15th and 85th percentile of year-over-year change.',
      });
    }
  }
  return null;
}

function statsOf(player, season) {
  const s = load('stats');
  const node = s && s[player.id];
  if (!node || !node.seasons) return null;
  const yr = season || latestSeason(node.seasons);
  const row = yr && node.seasons[yr];
  if (!row) return null;
  return compact({ season: yr, ...row });
}

function chartingOf(player, chart) {
  if (!chart || !chart.seasons) return null;
  const yr = latestSeason(chart.seasons);
  const row = yr && chart.seasons[yr].players && chart.seasons[yr].players[player.id];
  if (!row) return null;
  return compact({
    season: yr, chartedTargets: row.chartedTargets,
    firstReadRate: row.firstReadRate, checkdownRate: row.checkdownRate,
    contested: row.contested, drops: row.drops, created: row.created,
    note: 'Rates are a share of charted targets. FTN charting, humans, standard not identical across seasons.',
  });
}

function fieldOf(player) {
  const fm = load('fieldmap');
  if (!fm || !fm.seasons) return null;
  const yr = latestSeason(fm.seasons);
  const s = yr && fm.seasons[yr];
  if (!s) return null;
  const bank = player.pos === 'QB' ? s.passers : player.pos === 'RB' ? s.rushers : s.receivers;
  const row = player.gsisId && bank && bank[player.gsisId];
  if (!row) return null;
  // Only the cells that published a rate. A `thin` cell has a count and no
  // rate, and handing the model a count it might read as a rate is the exact
  // failure this layer exists to prevent.
  const strip = (bag) => {
    const out = {};
    for (const [k, v] of Object.entries(bag || {})) {
      out[k] = v.thin
        ? { plays: v.n, share: v.share, rate: 'not published — under the sample floor' }
        : compact(v);
    }
    return out;
  };
  return compact({
    season: yr,
    attempts: row.attempts, targets: row.targets, carries: row.carries,
    byDepth: strip(row.depth), bySide: strip(row.side),
    // Quarterbacks carry the full 3x4 grid. Receivers do not, and that is a
    // measurement rather than an omission — see data/fieldmap.json caveats.
    byZone: row.cells ? strip(row.cells) : undefined,
    byGap: strip(row.gaps), bySituation: strip(row.situations),
    note: 'From nflverse play-by-play. A cell under the sample floor publishes its count but no rate.',
  });
}

function medicalOf(player) {
  const med = load('medicals');
  const row = med && med[player.id];
  const live = { status: player.status || 'No designation', source: player.statusSource || null };
  if (!row) return compact({ liveStatus: live, history: 'no hand-written medical file for this player' });
  return compact({
    liveStatus: live,
    currentStatus: row.currentStatus,
    injuries: (row.injuries || []).slice(0, 6).map(i => compact({
      title: i.title, severity: i.severity, impact: i.impact, source: i.source, detail: i.detail,
    })),
    note: 'A designation is what a team declared. It is never a prediction.',
  });
}

function usageOf(player) {
  const u = load('player-usage');
  if (!u || !u.seasons) return null;
  const yr = latestSeason(u.seasons);
  const row = yr && u.seasons[yr] && player.gsisId && u.seasons[yr][player.gsisId];
  if (!row) return null;
  return compact({
    season: yr, snaps: row.snaps, personnelMix: row.mix, team: row.team,
    note: 'Share of the player\'s OWN snaps, not the team\'s.',
  });
}

function adpOf(player) {
  const a = load('adp');
  const row = a && a.players && a.players.find(p => p.name === player.name);
  if (!row) return null;
  return compact({
    pick: row.pick, positionalRank: row.posRank,
    source: a.meta && a.meta.source,
    historical: a.meta && a.meta.historical ? 'the draft market has closed; this board is frozen' : null,
  });
}

/**
 * The full context object handed to the model. Nothing else reaches it.
 */
function buildContext(question, opts) {
  const pool = load('players') || [];
  const rankings = load('rankings');
  const { players, ambiguous } = findPlayers(question, pool);
  const topics = detectTopics(question);
  const chart = topics.includes('charting') ? load('charting') : null;

  const people = players.map(p => {
    const ctx = { name: p.name, position: p.pos, team: p.team, age: p.age, status: p.status || 'No designation' };
    ctx.ranking = rankOf(p, rankings);
    if (topics.includes('stats') || topics.includes('rank')) ctx.production = statsOf(p);
    if (topics.includes('charting')) ctx.charting = chartingOf(p, chart);
    if (topics.includes('field')) ctx.fieldMap = fieldOf(p);
    if (topics.includes('medical')) ctx.medical = medicalOf(p);
    if (topics.includes('usage')) ctx.usage = usageOf(p);
    if (topics.includes('rank')) ctx.adp = adpOf(p);
    return compact(ctx);
  });

  const meta = load('meta') || {};
  return compact({
    askedAbout: people,
    ambiguousNames: ambiguous.length ? ambiguous : null,
    topicsDetected: topics,
    dataAsOf: meta.lastUpdated || meta.generated || null,
    scoringFormat: 'Half-PPR, 1QB, 12-team redraft',
    noPlayerMatched: people.length ? null
      : 'No player in the 350-man pool matched this question. Say so rather than answering from general knowledge.',
  });
}

module.exports.buildContext = buildContext;
module.exports.rankOf = rankOf;
module.exports.fieldOf = fieldOf;
