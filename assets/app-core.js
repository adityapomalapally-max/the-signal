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

  // The Sleeper player DB is 14.6MB on the wire (measured 2026-08-28; it was
  // ~5MB when this was written, which is why the cache behind it was sized
  // wrong for a year). Headshots normally come from the sleeperId
  // baked into players.json by the daily Action, so we only pay for this fetch
  // when some player is missing an ID — and never block first paint on it.
  if (playersDB.some(p => !p.sleeperId)) {
    loadSleeperPlayerDB().then(() => {
      // Re-render anything that draws an avatar, now that IDs resolve.
      renderInjuryWatch();
      if (document.getElementById('page-players').classList.contains('active')) renderPlayersTable();
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
      renderDataHealth(meta);
    }
  } catch (e) {}

  // Fade-in observer
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
}


/* ── Is the data actually current? ──────────────────────────────────────────
   THE SILENT FAILURE THIS SITE IS BUILT AROUND. If the daily job breaks on a
   Tuesday, nothing errors: every build that did run succeeded, every page
   renders, and every number quietly belongs to last week. The footer already
   printed "Data updated: 18 Aug" — in the same grey, at the same size, whether
   that was six hours ago or six days.

   So the reading has to be an AGE, not a date, and it has to be loud only when
   it should be. A banner on a healthy morning is noise that trains people to
   ignore banners; the whole value is that its appearance means something.

   The job runs daily at about 11:30 UTC, so a normal age is under a day. The
   thresholds sit above that with room for a late run rather than at it. */

const STALE_HOURS = 36;      // missed a day
const VERY_STALE_HOURS = 96; // missed three, and the boards are a week out

function dataHealth(meta, now) {
  if (!meta || !meta.lastUpdate) {
    return { level: 'unknown', hours: null, message: 'The site cannot tell when its data was last built.' };
  }
  const then = new Date(meta.lastUpdate).getTime();
  const hours = (((now || Date.now()) - then) / 36e5);
  const failures = Array.isArray(meta.fetchFailures) ? meta.fetchFailures : [];

  // A failed source is worth saying even when the run itself was recent — it
  // means one layer is older than the rest, which is harder to spot than a
  // whole site being behind.
  if (hours >= VERY_STALE_HOURS) {
    return { level: 'very-stale', hours, failures,
      message: `The data on this site has not been rebuilt for ${describeAge(hours)}. Every figure below is that old.` };
  }
  if (hours >= STALE_HOURS) {
    return { level: 'stale', hours, failures,
      message: `The daily build has not run for ${describeAge(hours)}. Numbers here may be behind.` };
  }
  if (failures.length) {
    return { level: 'partial', hours, failures,
      message: `The last build completed, but ${failures.length} source${failures.length === 1 ? '' : 's'} `
        + `failed to fetch: ${failures.map(f => f.source).join(', ')}. Those layers are older than the rest.` };
  }
  return { level: 'ok', hours, failures: [] };
}

function describeAge(hours) {
  if (hours < 48) return `${Math.round(hours)} hours`;
  const days = Math.floor(hours / 24);
  return `${days} days`;
}

// Rendered above the page content rather than in the footer, because the point
// is to be seen before the numbers are read, not after.
function renderDataHealth(meta) {
  const host = document.getElementById('dataHealth');
  if (!host) return;
  const h = dataHealth(meta);
  if (h.level === 'ok') { host.innerHTML = ''; host.hidden = true; return; }
  host.hidden = false;
  host.innerHTML = `<div class="data-health data-health-${h.level}" role="status">`
    + `<span class="data-health-tag">${h.level === 'partial' ? 'Partial' : 'Stale'}</span>`
    + `<span>${rankEsc(h.message)}</span></div>`;
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

// Caveats are a LIST and they render as one. Every data file here keeps its
// caveats as separate entries — each one is a different thing the reader has to
// know — and three separate render sites were joining them back together with a
// space, producing 100-to-150-word blocks that nobody finishes. The Rankings
// page had the worst of it at 280 words.
//
// Takes an array or a single string, so a file that has not been migrated to an
// array yet still renders sensibly; a string is split on sentence boundaries
// rather than dumped whole.
function caveatHtml(caveats, cls) {
  if (!caveats) return '';
  let parts = Array.isArray(caveats) ? caveats.slice() : [String(caveats)];
  if (parts.length === 1 && parts[0].split(/\s+/).length > 60) {
    // One long string: break it at sentence ends, then regroup into chunks of
    // roughly two sentences so the result is paragraphs rather than a list.
    const sentences = parts[0].match(/[^.!?]+[.!?]+(\s|$)/g) || [parts[0]];
    parts = [];
    for (let i = 0; i < sentences.length; i += 2) {
      parts.push(sentences.slice(i, i + 2).join('').trim());
    }
  }
  return parts.filter(Boolean).map(c => `<p class="caveat-p">${rankEsc(c)}</p>`).join('');
}

function rankEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A URL THAT CAME FROM A FEED IS NOT A URL UNTIL IT HAS BEEN CHECKED.
//
// Three links on this site are chosen by somebody else: ESPN's news payload,
// the Substack RSS proxy, and whatever either of them is standing in front of.
// An href beginning `javascript:` executes in THIS origin, with the same
// access to the page as the code that wrote it, and nothing about the string
// looks wrong until it is clicked.
//
// So a link is either plainly http(s) or it is '#'. A dead link is a visible
// nuisance; a live one pointing somewhere we did not choose is not visible at
// all, which is the whole problem. The escaping afterwards is the same bargain
// as rankEsc: the value lands inside a double-quoted attribute and must not be
// able to leave it.
function safeUrl(u) {
  const s = String(u == null ? '' : u).trim();
  if (!/^https?:\/\//i.test(s)) return '#';
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The same check for a link opened from script rather than written into an
// href. `noopener` is explicit here because window.open does NOT imply it the
// way a target="_blank" anchor now does — the opened page would keep a handle
// on this one.
function openExternal(u) {
  const s = String(u == null ? '' : u).trim();
  if (!/^https?:\/\//i.test(s)) return;
  window.open(s, '_blank', 'noopener,noreferrer');
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

/* ═══════════════════════════════════════════════════════════════════════════
   REST OF SEASON

   The board on this page is built in August and answers a seventeen-game
   question. From the first Sunday it keeps answering it, which is the wrong
   question: by Week 8 nobody is deciding anything about a season that is half
   gone, they are deciding about the nine games left.

   THE TOGGLE ONLY EXISTS WHEN THE FILE DOES. build-ros.js writes nothing until
   games have been played, so out of season there is no second view to offer and
   nothing here pretends otherwise.

   AND IT IS NOT A RE-RANKING OF THE BOARD. rankings.json is untouched; the
   medians there are the analyst's. This answers a different question, which is
   exactly why it is allowed to put players in a different order — and why it
   lives behind its own toggle rather than quietly replacing what he wrote.
   ═══════════════════════════════════════════════════════════════════════════ */

let rosPromise = null, rosData = null, rosChecked = false;
function ensureRos() {
  if (!rosPromise) {
    // NOT loadJSON. This file is ABSENT for half the year, and an absent file
    // here does not 404 — vercel.json rewrites anything unmatched to
    // index.html, so the fetch comes back 200 with a page of HTML. loadJSON
    // would try to parse it, fail, and warn on the console for every visitor to
    // the rankings all summer, with "not in season yet" and "the file is
    // corrupt" looking identical.
    //
    // The content type is the honest signal, and Vercel sends nosniff, so it
    // can be trusted: application/json is a real file, text/html is the
    // catch-all answering for something that is not there.
    rosPromise = fetch('/data/ros.json?v=' + Date.now())
      .then(res => {
        const type = res.headers.get('content-type') || '';
        if (!res.ok || !type.includes('json')) return null;   // not in season
        return res.json();
      })
      .catch(() => null)
      .then(d => {
        rosData = d;
        rosChecked = true;
        return d;
      });
  }
  return rosPromise;
}

let rankingsView = 'preseason';   // 'preseason' | 'ros'

function setRankingsView(view) {
  if (rankingsView === view) return;
  rankingsView = view;
  renderRankingsPage();
}

// The toggle is drawn only when there is something to toggle to.
function renderRankingsViewToggle() {
  const host = document.getElementById('rankingsViewMode');
  if (!host) return;
  if (!rosData || !rosData.players) { host.innerHTML = ''; return; }
  host.innerHTML = [['preseason', 'Preseason'], ['ros', 'Rest of season']].map(([k, label]) =>
    `<button class="pos-btn${rankingsView === k ? ' active' : ''}" onclick="setRankingsView('${k}')">${label}</button>`).join('');
}

function rosRows(tab) {
  if (!rosData || !rosData.players) return [];
  const rows = Object.entries(rosData.players)
    .map(([id, r]) => ({ id, ...r }))
    .filter(r => tab === 'overall' ? true : r.pos && r.pos.toLowerCase() === tab);
  // Ordered by what is LEFT, which is the entire point of the view.
  return rows.sort((a, b) => b.restOfSeasonPoints - a.restOfSeasonPoints);
}

function rosBoardHtml(tab) {
  const rows = rosRows(tab);
  const m = rosData.meta || {};
  if (!rows.length) {
    return `<div class="medical-card"><div class="medical-detail">No rest-of-season projection for this group yet.</div></div>`;
  }

  const max = Math.max(...rows.map(r => r.restOfSeasonPoints), 1);
  let h = `<div class="ros-head">
      <span class="lab-title">Rest of season — through week ${rankEsc(String(m.throughWeek))}</span>
      <span class="lab-qual">${rankEsc(String(m.gamesRemaining))} GAMES LEFT · ${rows.length} PLAYERS</span>
    </div>`;

  h += `<div class="table-scroll"><table class="players-table ros-table"><thead><tr>
      <th>#</th><th>Player</th><th>Rest of season</th><th>Per game</th><th>vs preseason</th><th>So far</th>
    </tr></thead><tbody>`;
  rows.slice(0, 60).forEach((r, i) => {
    const w = Math.max(2, (r.restOfSeasonPoints / max) * 100);
    // A rise means the season has changed our mind upward. The arrow is the
    // sign written out, because a bare "+3.2" beside a points total is easy to
    // read as more points rather than a change of view.
    const up = r.ppgDelta > 0.05, down = r.ppgDelta < -0.05;
    const deltaColour = up ? 'var(--teal)' : down ? 'var(--blue)' : 'var(--text-muted)';
    h += `<tr onclick="openProfile('${jsAttr(r.id)}')">
      <td class="ros-rank">${i + 1}</td>
      <td><div class="player-cell-name">${rankEsc(r.name)}</div>
        <div class="ros-sub">${rankEsc(r.pos)} · ${rankEsc(r.team || '')}</div></td>
      <td class="ros-num">
        <div class="ros-bar"><div class="ros-bar-fill" style="width:${w.toFixed(1)}%;"></div></div>
        <span>${r.restOfSeasonPoints}</span>
      </td>
      <td class="ros-num">${r.projectedPpg}</td>
      <td class="ros-num" style="color:${deltaColour};">${up ? '▲' : down ? '▼' : '='} ${Math.abs(r.ppgDelta).toFixed(2)}/g</td>
      <td class="ros-num ros-dim">${r.pointsSoFar} in ${r.gamesPlayed}</td>
    </tr>`;
  });
  h += `</tbody></table></div>`;

  // The method, in the reader's language, and the caveats that come with it.
  const sample = rows[0];
  h += `<div class="rank-note">Each player's remaining games at a blend of what he has actually
    averaged and what he was projected for in August. The weight on the season so far is
    <strong>derived, not chosen</strong> — fitted against past seasons, it is about a third after two
    games and rises past a half around week seven, because three good games is a sample of three.
    ${sample ? `At week ${rankEsc(String(m.throughWeek))} it is ${Math.round(sample.weightOnActual * 100)}% for a ${rankEsc(sample.pos)}.` : ''}
    ${rankEsc(m.isNot || '')}</div>`;
  if (Array.isArray(m.caveats)) {
    h += `<div class="rank-note" style="font-style:italic;">${m.caveats.map(c => rankEsc(c)).join(' ')}</div>`;
  }
  if (m.simulated) {
    h += `<div class="medical-card" style="border-left:3px solid var(--red);margin-top:14px;">
      <div class="medical-detail"><strong>This is simulated data.</strong> ${rankEsc(m.simulated)}</div></div>`;
  }
  return h;
}

function renderRankingsPage() {
  const body = document.getElementById('rankingsBody');
  if (!body) return;
  const meta = rankingsData.meta || {};
  const showPos = currentRankTab === 'overall';

  // Checked once. Out of season the file is absent and the answer is "there is
  // no second view", which is correct rather than an error.
  if (!rosChecked) {
    ensureRos().then(() => {
      renderRankingsViewToggle();
      if (rankingsView === 'ros') renderRankingsPage();
    });
  }
  renderRankingsViewToggle();
  if (rankingsView === 'ros' && !rosData) rankingsView = 'preseason';

  setRoute(`rankings/${currentRankTab}`);

  // The band and view toggles belong to the preseason chart — missed-time risk
  // draws a second downside on a whisker that does not exist here, and there is
  // no chart to switch to. Left on screen they invite a click that changes
  // nothing, which is the same mistake the Teams page made with its division
  // picker in league view.
  const bandToggles = ['rankAvailToggle', 'rankViewToggle'];
  bandToggles.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = rankingsView === 'ros' ? 'none' : '';
  });

  if (rankingsView === 'ros') {
    const methodElRos = document.getElementById('rankingsMethod');
    if (methodElRos) {
      methodElRos.textContent = `${rosData.meta.season} rest of season — the games that are left, not the ones already played.`;
    }
    document.querySelectorAll('#rankTabs .pos-btn').forEach(b =>
      b.classList.toggle('active', b.textContent.trim() === (currentRankTab === 'overall' ? 'Overall' : currentRankTab.toUpperCase())));
    body.innerHTML = rosBoardHtml(currentRankTab);
    const caveatEl = document.getElementById('rankingsCaveat');
    if (caveatEl) caveatEl.textContent = '';
    return;
  }
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

  // THESE ARE FOUR SEPARATE NOTES AND THEY WERE JOINED WITH A SPACE. The result
  // was a single 280-word paragraph covering bands, health, availability and the
  // missed-time case in one unbroken block — the longest piece of prose on the
  // site, sitting above the thing people came to read. The data already keeps
  // them apart; only the rendering flattened them.
  //
  // The band and health notes stay visible, because they are the qualifier on
  // the numbers directly below and this site does not hide qualifiers. The
  // availability method is 136 words of derivation, which is reference material
  // rather than a caveat, so it goes behind a disclosure that says what is in it.
  const caveat = document.getElementById('rankingsCaveat');
  const para = t => `<p class="rank-caveat-p">${rankEsc(t)}</p>`;
  let ch = [meta.bandCaveat, meta.healthNote].filter(Boolean).map(para).join('');
  if (rankShowAvail) {
    const deeper = [meta.availabilityMethod, meta.availabilityCaveat].filter(Boolean);
    if (deeper.length) {
      ch += `<details class="rank-method"><summary>How availability is priced</summary>`
        + deeper.map(para).join('') + `</details>`;
    }
  }
  caveat.innerHTML = ch;
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


/* ═══════════════════════════════════════════════════════════════════════════
   SORTABLE TABLES

   One sorting pattern for every table on the site, because three rules kept
   being got wrong a table at a time:

   1. A MISSING VALUE SORTS LAST IN BOTH DIRECTIONS. "Empty beats wrong" applies
      to order too — ascending by age must not open with the seven players whose
      age we do not know. A null is not a zero and it is not an empty string.
   2. TIES BREAK ON A STABLE KEY. Sorting 350 players by position leaves runs of
      129 ties; with nothing behind them the rows reshuffle on every keystroke in
      the search box, which reads as a rendering bug rather than as a sort.
   3. THE FIRST CLICK GOES THE USEFUL WAY. A rank column opens at #1, a rate
      column opens at the highest, a name column opens at A. Defaulting every
      column to ascending makes the reader click a fantasy-rank header twice,
      every single time.

   The header is a real <button> inside the <th> so it is reachable by keyboard,
   and the <th> carries aria-sort so the order is announced rather than left to
   an arrow glyph nobody can see.
   ═══════════════════════════════════════════════════════════════════════════ */

const TABLE_DEFS = {};   // id -> { cols, tie, render }
const TABLE_SORT = {};   // id -> { key, dir } | null

// cols: { key: { get(row), type: 'num'|'text', dir?: 'asc'|'desc' } }
// tie:  a column spec used to break equal values, before falling back to input order
function defineTable(id, def) {
  TABLE_DEFS[id] = def;
  if (!(id in TABLE_SORT)) {
    TABLE_SORT[id] = def.initial ? { key: def.initial.key, dir: def.initial.dir } : null;
  }
}

function tableSortState(id) { return TABLE_SORT[id] || null; }

// Same column twice flips the direction; a new column starts at its own useful end.
function setTableSort(id, key) {
  const def = TABLE_DEFS[id];
  if (!def || !def.cols[key]) return;
  const cur = TABLE_SORT[id];
  if (cur && cur.key === key) {
    TABLE_SORT[id] = { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  } else {
    const col = def.cols[key];
    TABLE_SORT[id] = { key, dir: col.dir || (col.type === 'text' ? 'asc' : 'desc') };
  }
  if (def.render) def.render();
}

function clearTableSort(id) {
  const def = TABLE_DEFS[id];
  TABLE_SORT[id] = def && def.initial ? { key: def.initial.key, dir: def.initial.dir } : null;
}

function sortIsEmpty(v) {
  return v === null || v === undefined || v === ''
    || (typeof v === 'number' && !isFinite(v));
}

// Rule 1 lives here: emptiness is decided before direction is, so a null lands
// at the bottom whichever way the arrow points.
function sortCompare(a, b, dir, type) {
  const ae = sortIsEmpty(a), be = sortIsEmpty(b);
  if (ae && be) return 0;
  if (ae) return 1;
  if (be) return -1;
  let c;
  if (type === 'text') c = String(a).localeCompare(String(b), 'en', { sensitivity: 'base' });
  else c = a < b ? -1 : a > b ? 1 : 0;
  return dir === 'asc' ? c : -c;
}

function sortTableRows(id, rows) {
  const def = TABLE_DEFS[id];
  const st = TABLE_SORT[id];
  if (!def || !st || !def.cols[st.key]) return rows.slice();
  const col = def.cols[st.key];
  const tie = col.tie || def.tie;   // a column may break its own ties
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      const c = sortCompare(col.get(x.r), col.get(y.r), st.dir, col.type);
      if (c) return c;
      if (tie) {
        const t = sortCompare(tie.get(x.r), tie.get(y.r), 'asc', tie.type || 'text');
        if (t) return t;
      }
      return x.i - y.i;   // input order last, so the same list always renders the same way
    })
    .map(w => w.r);
}

// A <th> that sorts. `cls` and `attrs` pass through for the tables that need
// their own alignment or a colspan.
function sortTh(id, key, label, opts) {
  const o = opts || {};
  const def = TABLE_DEFS[id];
  const col = def && def.cols[key];
  const cls = o.cls ? ` ${o.cls}` : '';
  if (!col) return `<th class="${(o.cls || '').trim()}"${o.attrs || ''}>${rankEsc(label)}</th>`;
  const st = TABLE_SORT[id];
  const on = st && st.key === key;
  const aria = on ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const arrow = on ? (st.dir === 'asc' ? '↑' : '↓') : '↕';
  const nextDir = on ? (st.dir === 'asc' ? 'descending' : 'ascending')
    : (col.dir || (col.type === 'text' ? 'asc' : 'desc')) === 'asc' ? 'ascending' : 'descending';
  return `<th class="th-sort${on ? ' on' : ''}${cls}" aria-sort="${aria}"${o.attrs || ''}>`
    + `<button type="button" class="th-sort-btn" onclick="setTableSort('${id}','${key}')"`
    + ` title="Sort by ${rankEsc(o.title || label)}, ${nextDir}">`
    // The arrow is inline, inside the text flow, so a label that wraps to two
    // lines keeps its arrow beside the last word instead of stranding it at the
    // far edge of the cell — which is what a flex row did to "Fantasy Rank".
    + `${rankEsc(label)}&nbsp;<span class="th-arrow" aria-hidden="true">${arrow}</span>`
    + `</button></th>`;
}

/* Status is written by scripts/lib/status.js as "Word (Detail)" — the word is
   the vocabulary, the parenthesis is the body part. The profile badge already
   splits there; the filter and the sort need the same split, so it lives in one
   place now rather than in three. */
function statusBase(status) {
  return String(status || '').split('(')[0].trim();
}

// Sorting by status should surface the hurt, not run the alphabet. The order
// comes from data we already own — statusClass first, which the pipeline sets
// and the stylesheet validates — and only then from the vocabulary word, so a
// status nobody has seen before still lands in the right band instead of first.
const STATUS_CLASS_ORDER = { 'status-healthy': 0, 'status-quest': 1, 'status-out': 2 };
const STATUS_WORD_ORDER = {
  'Healthy': 0, 'Probable': 1, 'Questionable': 2, 'Doubtful': 3,
  'Out': 4, 'NFI': 5, 'PUP': 6, 'IR': 7, 'Suspended': 8,
};
function statusRank(p) {
  const cls = STATUS_CLASS_ORDER[p && p.statusClass];
  const word = STATUS_WORD_ORDER[statusBase(p && p.status)];
  return (cls === undefined ? 9 : cls) * 10 + (word === undefined ? 9 : word);
}

// fRank is "RB2", "WR14" — a position and a number in one string. Sorted as
// text it puts RB10 ahead of RB2, which is the wrong answer in the one column
// a fantasy reader is most likely to sort by.
function fRankValue(fRank) {
  const m = /(\d+)\s*$/.exec(String(fRank || ''));
  return m ? Number(m[1]) : null;
}
function fRankPos(fRank) {
  const m = /^([A-Za-z]+)/.exec(String(fRank || ''));
  return m ? m[1].toUpperCase() : '';
}

/**
 * The share of a receiver's yards that came AFTER the catch.
 *
 * Not as simple as yac / (ybc + yac), which is what this was, and which produced
 * "146% of his receiving yards came after the catch" on the live page.
 *
 * A back who catches the ball BEHIND the line of scrimmage has NEGATIVE yards
 * before the catch. That is not a data error, it is the job: 145 of 555
 * receiving seasons on file are negative, which is a quarter of the pool and
 * essentially every pass-catching back in the league. Put a negative in the
 * denominator and the share runs past 100%, which is impossible on its face and
 * discredits every other number beside it.
 *
 * So a share is only computed where a share EXISTS — both parts non-negative.
 * When the ball is caught behind the line the honest statement is a different
 * one, and it is a better fact anyway: he was not thrown open downfield at all.
 */
function yacShare(receiving) {
  if (!receiving) return null;
  const ybc = receiving.ybcPerRec, yac = receiving.yacPerRec;
  if (typeof ybc !== 'number' || typeof yac !== 'number') return null;
  if (yac <= 0) return null;
  if (ybc < 0) {
    return {
      share: 100,
      behindLine: true,
      note: 'caught behind the line of scrimmage on average — every receiving yard was made after the catch',
    };
  }
  const total = ybc + yac;
  if (total <= 0) return null;
  return { share: Math.min(100, 100 * yac / total), behindLine: false };
}

/**
 * JSONL — one JSON object per line.
 *
 * The history series is written a line a day so that a year of it is a year of
 * one-line git diffs rather than 365 rewrites of a growing file. That makes it
 * cheap to keep and cheap to append, at the cost of not being parseable by
 * JSON.parse in one go.
 *
 * A single bad line does not lose the file: it is skipped and counted, because
 * a truncated write at the end of the log should not take the eleven months in
 * front of it with it.
 */
async function loadJSONL(path) {
  try {
    const res = await fetch(path + '?v=' + Date.now());
    if (!res.ok) throw new Error(`${res.status}`);
    const text = await res.text();
    const rows = [];
    let skipped = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch (e) { skipped++; }
    }
    if (skipped) console.warn(`${path}: skipped ${skipped} unparseable line(s)`);
    return rows;
  } catch (e) {
    console.warn('Failed to load ' + path + ':', e);
    return null;
  }
}
