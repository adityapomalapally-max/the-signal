/*
 * The Signal — data layer, ticker, rankings board, lazy player detail
 *
 * LOAD ORDER MATTERS. These files are plain classic scripts, concatenated by
 * the browser in the order index.html lists them, and they share one global
 * scope on purpose: the markup carries ~108 inline onclick handlers, and an
 * inline handler can only see globals. Converting these to type="module"
 * would scope every function and silently break every one of those handlers.
 *
 * Split out of index.html without reordering a single statement.
 */

// ===== JSON-DRIVEN DATA ARCHITECTURE =====
// All data loaded from /data/*.json files
// To add players/medicals/articles: edit the JSON files and push to git

let rankingsData = {};
let playersDB = [];
let medicalDB = {};
let articlesDB = {};
let injuryResearch = {};
let playerStats = {};
let homeSummaryData = null;

// Season totals for the whole pool. Fetched once, on the first page that
// needs it, and warmed in the background after first paint so that page
// almost never actually waits.
let statsPromise = null;
let statsReady = false;
function ensureStats() {
  if (!statsPromise) {
    statsPromise = loadJSON('/data/stats.json').then(d => {
      if (d) playerStats = d;
      statsReady = true;
      return playerStats;
    });
  }
  return statsPromise;
}

// Every data path is ROOT-relative ('/data/x.json'), never bare ('data/x.json').
// The site serves real paths now — /player/nabers, /medicals/olave — and a
// relative fetch from one of those resolves against the route, asking for
// /player/data/players.json. The rewrite answers that with index.html, so the
// page gets HTML where it expected JSON and dies with no useful error.
// The same rule applies to the script and stylesheet tags in index.html.
async function loadJSON(path) {
  try {
    const res = await fetch(path + '?v=' + Date.now());
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('Failed to load ' + path + ':', e);
    return null;
  }
}

async function initData() {
  // stats.json is 664KB and nothing on first paint needs it — the home
  // mini-charts read a precomputed summary instead, and Leaders, the profile
  // Stats tab and Compare each await it when they actually render.
  const [rankings, players, medicals, articles, injuries, homeSummary] = await Promise.all([
    loadJSON('/data/rankings.json'),
    loadJSON('/data/players.json'),
    loadJSON('/data/medicals.json'),
    loadJSON('/data/articles.json'),
    loadJSON('/data/injury-research.json'),
    loadJSON('/data/home-summary.json')
  ]);

  if (rankings) rankingsData = rankings;
  if (players) playersDB = players;
  if (medicals) medicalDB = medicals;
  if (homeSummary) homeSummaryData = homeSummary;
  if (articles && articles.articles) {
    articles.articles.forEach(a => { articlesDB[a.slug] = a; });
  }
  if (injuries) injuryResearch = injuries;

  // Initialize UI after data loads
  renderTicker('overall');
  loadESPNNews();
  loadSubstack();
  loadSleeperTrending();
  renderInjuryWatch();
  renderHeroSidebar();
  renderHomeMinis();
  if (document.getElementById('page-rankings').classList.contains('active')) renderRankingsPage();
  // First paint is done; warm the season totals so the pages that need them
  // are ready by the time anyone clicks through. stats.json is 664KB — it was
  // ~450KB when this prefetch was written and it grows with every season — so
  // it is a real cost to spend speculatively on someone who came to read one
  // article. Skip it on a metered or slow connection and let the pages that
  // need it fetch it themselves; they all already await ensureStats().
  const conn = navigator.connection;
  const expensive = conn && (conn.saveData === true || /^(slow-)?2g$/.test(conn.effectiveType || ''));
  if (!expensive) {
    if (window.requestIdleCallback) requestIdleCallback(() => ensureStats(), { timeout: 4000 });
    else ensureStats();
  }

  // The Sleeper player DB is ~5MB. Headshots normally come from the sleeperId
  // baked into players.json by the daily Action, so we only pay for this fetch
  // when some player is missing an ID — and never block first paint on it.
  if (playersDB.some(p => !p.sleeperId)) {
    loadSleeperPlayerDB().then(() => {
      // Re-render anything that draws an avatar, now that IDs resolve.
      renderInjuryWatch();
      if (document.getElementById('page-players').classList.contains('active')) renderPlayersTable();
      if (document.getElementById('page-compare').classList.contains('active')) renderComparePage();
    });
  }

  // Load data freshness metadata
  try {
    const metaRes = await fetch('/data/meta.json?v=' + Date.now());
    if (metaRes.ok) {
      const meta = await metaRes.json();
      if (meta.lastUpdate) {
        const el = document.getElementById('footerLastUpdate');
        if (el) el.textContent = '· Data updated: ' + new Date(meta.lastUpdate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      }
    }
  } catch (e) {}

  // Fade-in observer
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
}

// ===== TICKER =====
// ===== TICKER =====
function renderTicker(pos) {
  const data = rankingsData[pos];
  const c = document.getElementById('tickerContent');
  if (!c) return;
  if (!Array.isArray(data) || !data.length) { c.innerHTML = ''; return; }

  const meta = rankingsData.meta || {};
  // The overall board is cross-positional, so the badge is doing real work
  // there; inside a position tab every badge would read the same.
  const showPos = pos === 'overall';
  const tip = showPos
    ? (meta.overallMethod || 'Ranked by value over replacement.')
    : (meta.method || 'Ranked by projected median season total.');

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const items = data.map(p => {
    const badge = showPos && p.pos
      ? `<span class="ticker-pos" data-p="${esc(p.pos)}">${esc(p.pos)}</span>` : '';
    // A projection that isn't there renders as nothing rather than "undefined".
    const ppg = (typeof p.ppg === 'number')
      ? `<span class="ticker-ppg">${p.ppg.toFixed(1)}</span>` : '';
    return `<div class="ticker-player" title="${esc(tip)}">`
      + `<span class="ticker-rank">#${esc(p.rank)}</span>`
      + badge
      + `<span class="ticker-name">${esc(p.name)}</span>`
      + `<span class="ticker-team">${esc(p.team)}</span>`
      + ppg
      + `</div>`;
  }).join('');
  c.innerHTML = items + items;
}

document.querySelectorAll('.ticker-tab[data-pos]').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.ticker-tab[data-pos]').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderTicker(tab.dataset.pos);
  });
});

// initData handles renderTicker('overall')

// ===== RANKINGS PAGE + CHART MODULE =====
// Dot-and-whisker board: floor→ceiling band, median dot, replacement-level
// reference line. Marks use darker steps of the site accents (gold #a8893a,
// teal #1ba89b) validated for contrast + CVD separation on the card surface.
// Every value shown in the chart is also reachable via the Table view.
let currentRankTab = 'overall';
let currentRankView = 'chart';
let rankShowAvail = true;
const RANK_CHART_CAP = 40;

function rankEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setRankTab(tab, btn) {
  currentRankTab = tab;
  document.querySelectorAll('#rankTabs .pos-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRankingsPage();
}

function setRankView(view, btn) {
  currentRankView = view;
  document.querySelectorAll('#rankViewToggle .pos-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRankingsPage();
}

function setRankAvail(on, btn) {
  rankShowAvail = on;
  document.querySelectorAll('#rankAvailToggle .pos-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRankingsPage();
}

// 4 even intervals on round-number bounds, so the gridline background
// (25% repeating) and the tick labels always agree.
function rankScale(lo, hi) {
  let step = Math.max(10, Math.ceil((hi - lo) / 4 / 10) * 10);
  let min = Math.floor(lo / step) * step;
  while (min + 4 * step < hi) {
    step += 10;
    min = Math.floor(lo / step) * step;
  }
  return { min, max: min + 4 * step, ticks: [0, 1, 2, 3, 4].map(i => min + i * step) };
}

// The availability extension is a SECOND downside, not a wider version of the
// first: the gold band is a cold season played in full, the extension is a
// normal season cut short. Different risks, so they get different marks.
const availFloorOf = (r) => (rankShowAvail && r.availability && typeof r.availability.floor === 'number'
  && r.availability.floor < r.floor) ? r.availability.floor : null;

function rankWhiskerChart(rows, baseline, showPos) {
  const lo = Math.min(
    ...rows.map(r => Math.min(r.floor, availFloorOf(r) === null ? Infinity : availFloorOf(r))),
    baseline ? baseline.points : Infinity);
  const hi = Math.max(...rows.map(r => r.ceiling), baseline ? baseline.points : -Infinity);
  const sc = rankScale(lo, hi);
  const X = v => Math.max(0, Math.min(100, ((v - sc.min) / (sc.max - sc.min)) * 100));

  let h = `<div class="rank-chart">`;
  h += `<div class="rank-axis"><div></div><div class="rank-axis-strip">`
    + sc.ticks.map((t, i) => `<span style="left:${i * 25}%">${t}</span>`).join('')
    + `</div><div class="rank-axis-unit">PROJ PTS</div></div>`;

  h += `<div class="rank-plot${baseline ? ' has-baseline' : ''}">`;
  if (baseline) {
    const f = X(baseline.points) / 100;
    h += `<div class="rank-baseline" style="left:calc(var(--gutL) + (100% - var(--gutL) - var(--gutR)) * ${f.toFixed(4)})">`
      + `<div class="rank-baseline-label">REPLACEMENT · ${rankEsc(baseline.label)} (${baseline.points})</div></div>`;
  }

  rows.forEach(r => {
    const bl = X(r.floor);
    const bw = Math.max(X(r.ceiling) - X(r.floor), 1);
    const mx = X(r.median);
    const af = availFloorOf(r);
    const a = r.availability;
    let tip = `${r.name} — floor ${r.floor} · median ${r.median} · ceiling ${r.ceiling}`
      + (typeof r.ppg === 'number' ? ` · ${r.ppg.toFixed(1)} PPG` : '')
      + (typeof r.vorp === 'number' ? ` · VORP ${r.vorp}` : '');
    if (a) {
      tip += ` — available ${a.pct}% of games (${a.games.join('/')}); a ${a.floorGames}-game season at this rate is ${a.floor}`;
      if (a.statusFlag) tip += `; currently ${a.statusFlag}, which this does not price in`;
    }
    h += `<div class="rank-row" tabindex="0" aria-label="${rankEsc(tip)}" data-tip="${rankEsc(tip)}">`
      + `<div class="rank-name"><span class="rank-num">${r.rank}</span>`
      + (showPos && r.pos ? `<span class="ticker-pos" data-p="${rankEsc(r.pos)}">${rankEsc(r.pos)}</span>` : '')
      + `<span class="rank-player">${rankEsc(r.name)}</span>`
      + `<span class="rank-team">${rankEsc(r.team || '')}</span></div>`
      + `<div class="rank-strip">`
      + (af !== null ? `<div class="rank-band-avail" style="left:${X(af).toFixed(2)}%;width:${Math.max(bl - X(af), 0.6).toFixed(2)}%"></div>` : '')
      + `<div class="rank-band" style="left:${bl.toFixed(2)}%;width:${bw.toFixed(2)}%"></div>`
      + `<div class="rank-dot" style="left:${mx.toFixed(2)}%"></div>`
      + (rankShowAvail && a && a.statusFlag ? `<div class="rank-flag" style="left:${X(af !== null ? af : r.floor).toFixed(2)}%"></div>` : '')
      + `</div>`
      + `<div class="rank-val">${r.median}</div></div>`;
  });
  h += `</div></div>`;
  return h;
}

function rankTable(rows, showPos) {
  let h = `<div class="table-scroll"><table class="players-table rank-table"><thead><tr>`
    + `<th>#</th><th>Player</th><th>Team</th>${showPos ? '<th>Pos</th>' : ''}`
    + `<th>Floor</th><th>Median</th><th>Ceiling</th><th>PPG</th><th>VORP</th>`
    + `<th data-tip="Share of his team's games played over the seasons he has been in the league. Counts every missed game, cause included." style="cursor:help;">Avail</th>`
    + `<th data-tip="Season total at his projected per-game rate across a low-availability year, scaled to his own record." style="cursor:help;">Missed-time</th>`
    + `</tr></thead><tbody>`;
  h += rows.map(r => {
    const a = r.availability;
    return `<tr><td>${r.rank}</td><td>${rankEsc(r.name)}</td><td>${rankEsc(r.team || '')}</td>`
      + (showPos ? `<td>${rankEsc(r.pos || '')}</td>` : '')
      + `<td>${r.floor ?? ''}</td><td>${r.median ?? ''}</td><td>${r.ceiling ?? ''}</td>`
      + `<td>${typeof r.ppg === 'number' ? r.ppg.toFixed(1) : ''}</td>`
      + `<td>${r.vorp ?? ''}</td>`
      + `<td>${a ? a.pct + '%' : '—'}</td>`
      + `<td>${a ? a.floor : '—'}${a && a.statusFlag ? ` <span style="color:var(--red);" title="Currently ${rankEsc(a.statusFlag)} — not priced in">•</span>` : ''}</td></tr>`;
  }).join('');
  return h + '</tbody></table></div>';
}

function renderRankingsPage() {
  const body = document.getElementById('rankingsBody');
  if (!body) return;
  const meta = rankingsData.meta || {};
  const showPos = currentRankTab === 'overall';
  setRoute(`rankings/${currentRankTab}`);
  const tabLabel = currentRankTab === 'overall' ? 'Overall' : currentRankTab.toUpperCase();
  document.querySelectorAll('#rankTabs .pos-btn').forEach(b =>
    b.classList.toggle('active', b.textContent.trim() === tabLabel));

  const methodEl = document.getElementById('rankingsMethod');
  if (methodEl) {
    const method = showPos ? (meta.overallMethod || '') : (meta.method || '');
    methodEl.textContent = [meta.format, method].filter(Boolean).join(' — ');
  }

  const list = rankingsData[currentRankTab];
  if (!Array.isArray(list) || !list.length) {
    body.innerHTML = `<div class="medical-card"><div class="medical-detail">No rankings available yet.</div></div>`;
    document.getElementById('rankingsCaveat').textContent = '';
    return;
  }

  // A row without a full band cannot be drawn honestly — it still appears in
  // the table, where missing numbers render as blanks instead of shapes.
  const bandRows = list.filter(r =>
    typeof r.floor === 'number' && typeof r.median === 'number' && typeof r.ceiling === 'number');

  if (currentRankView === 'chart' && bandRows.length) {
    const b = meta.baselines && meta.baselines[currentRankTab];
    const baseline = (b && typeof b.points === 'number')
      ? { points: b.points, label: `${currentRankTab.toUpperCase()}${b.rank}` } : null;
    const shown = bandRows.slice(0, RANK_CHART_CAP);
    const anyAvail = rankShowAvail && shown.some(r => availFloorOf(r) !== null);
    rankExportSpec = {
      title: `${currentRankTab === 'overall' ? 'Overall' : currentRankTab.toUpperCase()} Rankings — ${meta.season || ''}`.trim(),
      subtitle: meta.format || '',
      // The footer has ~85 characters before it truncates, so this stays short
      // on purpose; the full method lives on the page, not on the card.
      source: anyAvail
        ? 'Hand-set bands · missed-time = a low-availability season at the projected rate'
        : 'Floor / median / ceiling · hand-set bands, not simulated · The Signal',
      unit: '', band: true, showAvail: anyAvail,
      rows: shown.map(r => ({
        rank: r.rank, name: r.name, team: r.team, value: r.median,
        floor: r.floor, ceiling: r.ceiling,
        availFloor: rankShowAvail ? availFloorOf(r) : null,
        flagged: !!(rankShowAvail && r.availability && r.availability.statusFlag)
      }))
    };
    let h = `<div style="display:flex;justify-content:flex-end;margin-bottom:10px;">`
      + `<button class="export-btn" onclick="runExport(() => exportRowChart(rankExportSpec), rankExportSpec.title, this)">Export PNG</button></div>`;
    h += `<div class="medical-card" style="padding:22px 20px;">`
      + rankWhiskerChart(shown, baseline, showPos)
      + `<div class="rank-legend">`
      + `<span><i style="background:rgba(168,137,58,0.28);"></i>Floor → ceiling, health assumed</span>`
      + `<span><i style="background:#a8893a;border-radius:50%;width:9px;height:9px;"></i>Median</span>`
      + (rankShowAvail ? `<span><i style="background:repeating-linear-gradient(-45deg,rgba(42,120,214,0.55) 0 3px,rgba(42,120,214,0.15) 3px 6px);"></i>Missed-time case</span>`
        + `<span><i style="background:var(--red);border-radius:50%;width:5px;height:5px;"></i>Not currently healthy — not priced in</span>` : '')
      + `</div></div>`;
    if (bandRows.length > shown.length) {
      h += `<div class="rank-note">Chart shows the top ${shown.length} — the Table view has all ${bandRows.length}.</div>`;
    }
    body.innerHTML = h;
  } else {
    body.innerHTML = rankTable(list, showPos);
  }

  const caveat = document.getElementById('rankingsCaveat');
  caveat.textContent = [
    meta.bandCaveat,
    meta.healthNote,
    rankShowAvail ? meta.availabilityMethod : null,
    rankShowAvail ? meta.availabilityCaveat : null
  ].filter(Boolean).join(' ');
}

// Shared tooltip: hover or keyboard focus, same content either way. The
// aria-label carries identical text, and the Table view holds every value,
// so the tooltip enhances rather than gates.
function initRankTooltip() {
  const tip = document.createElement('div');
  tip.id = 'vizTooltip';
  document.body.appendChild(tip);
  const show = (text, x, y) => {
    tip.textContent = text;
    tip.style.display = 'block';
    const pad = 14;
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    tip.style.left = Math.min(x + pad, window.innerWidth - w - 8) + 'px';
    tip.style.top = (y + pad + hgt > window.innerHeight ? y - hgt - 6 : y + pad) + 'px';
  };
  // Delegated on document: any element carrying data-tip gets the shared
  // tooltip — rankings rows, profile chart columns, whatever comes next.
  document.addEventListener('pointermove', e => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el) show(el.dataset.tip, e.clientX, e.clientY);
    else if (tip.style.display !== 'none') tip.style.display = 'none';
  });
  document.addEventListener('focusin', e => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el) {
      const r = el.getBoundingClientRect();
      show(el.dataset.tip, r.left + 40, r.top);
    } else {
      tip.style.display = 'none';
    }
  });
}
initRankTooltip();

// ===== PLAYER DETAIL (lazy) =====
// players.json carries only what the site needs before a profile opens.
// Avatar colour and initials are derived here rather than stored, and the
// rich profile fields live in players-detail.json, fetched once on the
// first profile open. That is what lets the pool grow without the payload.
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#1e3a5f,#2563eb)', 'linear-gradient(135deg,#4a2c1a,#b45309)',
  'linear-gradient(135deg,#1a3a2c,#059669)', 'linear-gradient(135deg,#3b1f47,#7c3aed)',
  'linear-gradient(135deg,#451a1a,#dc2626)', 'linear-gradient(135deg,#1f3547,#0891b2)',
  'linear-gradient(135deg,#3d3517,#ca8a04)', 'linear-gradient(135deg,#2d2d35,#64748b)'
];
// Same hash as scripts/build-players.js, so a player keeps his colour.
function playerColor(p) {
  if (!p) return AVATAR_GRADIENTS[0];
  if (p.color) return p.color;
  let hash = 0; const str = String(p.sleeperId || p.id || '');
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}
function playerInitials(p) {
  if (!p) return '';
  if (p.initials) return p.initials;
  return String(p.name || '').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

let detailPromise = null;
function ensurePlayerDetail() {
  if (!detailPromise) {
    detailPromise = loadJSON('/data/players-detail.json').then(d => {
      if (d) for (const p of playersDB) if (d[p.id]) Object.assign(p, d[p.id]);
      return d || {};
    });
  }
  return detailPromise;
}

