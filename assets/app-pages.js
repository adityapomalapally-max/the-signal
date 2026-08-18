/*
 * The Signal — Leaders, Teams, Draft Lab, Value Board, Players, Medicals
 *
 * LOAD ORDER MATTERS. These files are plain classic scripts, concatenated by
 * the browser in the order index.html lists them, and they share one global
 * scope on purpose: the markup carries ~108 inline onclick handlers, and an
 * inline handler can only see globals. Converting these to type="module"
 * would scope every function and silently break every one of those handlers.
 *
 * Split out of index.html without reordering a single statement.
 */

// ===== LEADERS (leaderboards) =====
// Every board declares a qualifier. A rate stat off three targets is noise
// wearing a number's clothes, so players under the bar are excluded from
// the board rather than ranked — same principle as the volatility panels.
let labExportBoard = null, labExportScatter = null, rankExportSpec = null;
let labPos = 'WR';
let labSeason = null;      // set from the data on first render
let labMetricKey = null;
let labView = 'chart';

const LAB_SEASONS = ['2023', '2024', '2025'];

// stat: reads data/stats.json season object · ngs: reads data/ngs.json season object
// lower: smaller value ranks first · unit: appended to the printed value
const LAB_METRICS = {
  WR: [
    { key: 'ppg', label: 'Fantasy PPG', stat: s => s.fantasyPPG, unit: '', minGames: 8, note: 'PPR points per game played.' },
    { key: 'tgtShare', label: 'Target Share', stat: s => s.tgtShare, unit: '%', minGames: 8, note: "Share of the team's targets, averaged over games played." },
    { key: 'airShare', label: 'Air Yards Share', stat: s => s.airYardShare, unit: '%', minGames: 8, note: "Share of the team's air yards — how much of the passing game runs through him." },
    { key: 'recEPA', label: 'Receiving EPA', stat: s => s.recEPA, unit: '', minGames: 8, note: 'Total expected points added on targets. Values below zero are real and shown as such.' },
    { key: 'sep', label: 'Avg Separation', ngs: n => n.rec && n.rec.separation, unit: ' yd', minGames: 8, minTargets: 40, note: 'Yards from the nearest defender at pass arrival (Next Gen Stats).' },
    { key: 'yacOE', label: 'YAC Over Expected', ngs: n => n.rec && n.rec.yacOE, unit: '', minGames: 8, minTargets: 40, note: 'Yards after catch beyond what the tracking model expected — creation, not situation.' },
    { key: 'adot', label: 'aDOT', stat: s => s.aDOT, unit: ' yd', minGames: 8, minTargets: 40, note: 'Average depth of target. High is a field-stretcher, low is a volume/YAC role.' },
    { key: 'catchPct', label: 'Catch %', stat: s => s.catchPct, unit: '%', minGames: 8, minTargets: 40, note: 'Receptions per target. Reads alongside aDOT — deep roles catch a lower share.' },
    { key: 'snapPct', label: 'Snap Share', ngs: n => n.snapPct, unit: '%', minGames: 8, note: 'Share of team offensive snaps, snap-weighted across games played.' }
  ],
  RB: [
    { key: 'ppg', label: 'Fantasy PPG', stat: s => s.fantasyPPG, unit: '', minGames: 8, note: 'PPR points per game played.' },
    { key: 'rushEPA', label: 'Rushing EPA', stat: s => s.rushEPA, unit: '', minGames: 8, note: 'Total expected points added on carries. Most backs land near or below zero — the bar is honest about it.' },
    { key: 'ypc', label: 'Yards per Carry', stat: s => s.ypc, unit: '', minGames: 8, minCarries: 80, note: 'Rushing yards per attempt.' },
    { key: 'eightBox', label: 'Loaded Box Rate', ngs: n => n.rush && n.rush.eightBoxPct, unit: '%', minGames: 8, minCarries: 80, note: 'Share of carries against 8+ defenders in the box — the difficulty of the run environment.' },
    { key: 'eff', label: 'Rush Efficiency', ngs: n => n.rush && n.rush.efficiency, unit: '', lower: true, minGames: 8, minCarries: 80, note: 'Distance travelled per yard gained. Lower is more north/south; higher means more east/west searching.' },
    { key: 'tgtShare', label: 'Target Share', stat: s => s.tgtShare, unit: '%', minGames: 8, note: "Share of the team's targets — the passing-down role." },
    { key: 'recEPA', label: 'Receiving EPA', stat: s => s.recEPA, unit: '', minGames: 8, note: 'Total expected points added as a receiver.' },
    { key: 'snapPct', label: 'Snap Share', ngs: n => n.snapPct, unit: '%', minGames: 8, note: 'Share of team offensive snaps — the workload signal behind the touches.' }
  ],
  QB: [
    { key: 'ppg', label: 'Fantasy PPG', stat: s => s.fantasyPPG, unit: '', minGames: 8, note: 'PPR points per game played.' },
    { key: 'passEPA', label: 'Passing EPA', stat: s => s.passEPA, unit: '', minGames: 8, note: 'Total expected points added through the air.' },
    { key: 'cpoe', label: 'CPOE', ngs: n => n.pass && n.pass.cpoe, unit: '%', minGames: 8, minAttempts: 200, note: 'Completion percentage over expected — accuracy after adjusting for the difficulty of each throw.' },
    { key: 'ypa', label: 'Yards per Attempt', stat: s => s.ypa, unit: '', minGames: 8, minAttempts: 200, note: 'Passing yards per attempt.' },
    { key: 'agg', label: 'Aggressiveness', ngs: n => n.pass && n.pass.aggressiveness, unit: '%', minGames: 8, minAttempts: 200, note: 'Share of throws into tight windows (defender within a yard).' },
    { key: 'ttt', label: 'Time to Throw', ngs: n => n.pass && n.pass.timeToThrow, unit: 's', lower: true, minGames: 8, minAttempts: 200, note: 'Seconds from snap to release. Lower is a quick-game operator; higher means holding it.' },
    { key: 'sackPct', label: 'Sack Rate', stat: s => s.sackPct, unit: '%', lower: true, minGames: 8, minAttempts: 200, note: 'Sacks per dropback. Lower is better, and it is as much line and scheme as quarterback.' },
    { key: 'rushYds', label: 'Rushing Yards', stat: s => s.rushYds, unit: '', minGames: 8, note: 'Regular-season rushing yards — the fantasy cheat code at the position.' }
  ]
};
LAB_METRICS.TE = LAB_METRICS.WR;

// x/y pairings that type a player rather than rank him.
const LAB_SCATTER = {
  WR: {
    title: 'How He Earns His Yards',
    sub: 'Average depth of target against yards after the catch. Up and to the left is a manufactured-touch YAC weapon; down and to the right is a pure field-stretcher; up and to the right is the rare receiver doing both.',
    x: { label: 'aDOT (yd)', get: (s) => s.aDOT }, y: { label: 'YAC per reception (yd)', get: (s) => s.yacPerRec },
    minGames: 8, minTargets: 40
  },
  RB: {
    title: 'Run Environment vs Production',
    sub: 'Yards per carry against the share of carries facing eight or more defenders. Up and to the right is production earned against loaded boxes; down and to the left is a soft environment without the output.',
    x: { label: 'Loaded box rate (%)', ngs: true, get: (s, n) => n.rush && n.rush.eightBoxPct }, y: { label: 'Yards per carry', get: (s) => s.ypc },
    minGames: 8, minCarries: 80
  },
  QB: {
    title: 'Pocket Clock vs Accuracy',
    sub: 'Time to throw against completion percentage over expected. Up and to the left is quick-game precision; up and to the right is accuracy while holding the ball; anything below the line is throwing worse than the situation warranted.',
    x: { label: 'Time to throw (s)', ngs: true, get: (s, n) => n.pass && n.pass.timeToThrow }, y: { label: 'CPOE (%)', ngs: true, get: (s, n) => n.pass && n.pass.cpoe },
    minGames: 8, minAttempts: 200
  }
};
LAB_SCATTER.TE = LAB_SCATTER.WR;

function labQualifies(m, s) {
  if (!s) return false;
  if (m.minGames && !(s.games >= m.minGames)) return false;
  if (m.minTargets && !(s.targets >= m.minTargets)) return false;
  if (m.minCarries && !(s.carries >= m.minCarries)) return false;
  if (m.minAttempts && !(s.attempts >= m.minAttempts)) return false;
  return true;
}

function labQualText(m) {
  const parts = [];
  if (m.minGames) parts.push(`${m.minGames}+ games`);
  if (m.minTargets) parts.push(`${m.minTargets}+ targets`);
  if (m.minCarries) parts.push(`${m.minCarries}+ carries`);
  if (m.minAttempts) parts.push(`${m.minAttempts}+ attempts`);
  return parts.length ? `QUALIFIER: ${parts.join(' · ')}` : '';
}

// Joins pool + season stats + tracking data for the active position/season.
function labRows(valueOf, m) {
  const rows = [];
  for (const p of playersDB) {
    if (p.pos !== labPos) continue;
    const ps = playerStats[p.id];
    const s = ps && ps.seasons && ps.seasons[labSeason];
    const n = (labNgs[p.id] && labNgs[p.id][labSeason]) || {};
    if (!labQualifies(m, s)) continue;
    const v = valueOf(s, n);
    if (typeof v !== 'number' || isNaN(v)) continue;
    rows.push({ id: p.id, name: p.name, team: p.team, value: v });
  }
  return rows;
}

let labNgs = {};

function setLabPos(pos, btn) {
  labPos = pos;
  labMetricKey = null;
  document.querySelectorAll('#labPosFilter .pos-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLabPage();
}
function setLabSeason(season, btn) {
  labSeason = season;
  document.querySelectorAll('#labSeasonFilter .pos-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLabPage();
}
function setLabMetric(key) {
  labMetricKey = key;
  renderLabPage();
}
function setLabView(view, btn) {
  labView = view;
  document.querySelectorAll('#labViewToggle .pos-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLabPage();
}

function labBarBoard(rows, m) {
  const vals = rows.map(r => r.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);

  // A bar from zero only tells the story when zero is a meaningful floor for
  // the measure. On a clustered ratio (rush efficiency runs 3.18–3.56) every
  // bar is the same length and the differences vanish, so the field's own
  // range becomes the scale and a dot marks the value.
  if (lo >= 0 && hi > 0 && (hi - lo) / hi < 0.35) return labDotBoard(rows, m, lo, hi);

  const maxV = Math.max(hi, 0);
  const minV = Math.min(lo, 0);
  const span = (maxV - minV) || 1;
  const zeroPct = ((0 - minV) / span) * 100;
  const hasNeg = minV < 0;

  // position:relative makes the card the offset parent for the zero rule —
  // without it the line resolves against the page and drifts off the chart.
  let h = `<div class="medical-card" style="padding:20px;position:relative;">`;
  if (hasNeg) h += `<div class="lab-zero" style="left:calc(20px + 200px + (100% - 40px - 200px - 62px) * ${(zeroPct / 100).toFixed(4)});"></div>`;
  h += rows.map((r, i) => {
    const pos = r.value >= 0;
    const w = (Math.abs(r.value) / span) * 100;
    const left = pos ? zeroPct : zeroPct - w;
    const tip = `${r.name} (${r.team}) — ${m.label}: ${r.value}${m.unit}`;
    return `<div class="lab-row" tabindex="0" role="button" data-tip="${rankEsc(tip)}" aria-label="${rankEsc(tip)}" onclick="openProfile('${r.id}')">
      <div class="lab-name"><span class="lab-rank">${i + 1}</span><span class="lab-player">${rankEsc(r.name)}</span><span class="lab-team">${rankEsc(r.team || '')}</span></div>
      <div class="lab-track"><div style="position:absolute;left:${left.toFixed(2)}%;width:${Math.max(w, 0.4).toFixed(2)}%;"><div class="lab-bar${pos ? '' : ' neg'}"></div></div></div>
      <div class="lab-val">${r.value}${m.unit}</div>
    </div>`;
  }).join('');
  h += `</div>`;
  return h;
}

// Dot-on-range form: the axis spans what the qualified field actually did,
// so the reader sees separation instead of twenty identical bars.
function labDotBoard(rows, m, lo, hi) {
  const padAmt = (hi - lo) * 0.12 || 0.5;
  const a = lo - padAmt, b = hi + padAmt;
  const X = v => ((v - a) / (b - a)) * 100;
  const fmt = v => Math.round(v * 100) / 100;

  let h = `<div class="lab-scale"><div class="lab-scale-inner">`
    + `<span>${fmt(a)}${m.unit}</span>`
    + `<span style="letter-spacing:1px;">RANGE ACROSS QUALIFIED ${labPos}s</span>`
    + `<span>${fmt(b)}${m.unit}</span></div></div>`;
  h += `<div class="medical-card" style="padding:20px;position:relative;">`;
  h += rows.map((r, i) => {
    const tip = `${r.name} (${r.team}) — ${m.label}: ${r.value}${m.unit}`;
    return `<div class="lab-row" tabindex="0" role="button" data-tip="${rankEsc(tip)}" aria-label="${rankEsc(tip)}" onclick="openProfile('${r.id}')">
      <div class="lab-name"><span class="lab-rank">${i + 1}</span><span class="lab-player">${rankEsc(r.name)}</span><span class="lab-team">${rankEsc(r.team || '')}</span></div>
      <div class="lab-track"><div class="lab-rule"></div><div class="lab-dot" style="left:${X(r.value).toFixed(2)}%;"></div></div>
      <div class="lab-val">${r.value}${m.unit}</div>
    </div>`;
  }).join('');
  return h + `</div>`;
}

function labTable(rows, m) {
  let h = `<div class="table-scroll"><table class="players-table rank-table"><thead><tr><th>#</th><th>Player</th><th>Team</th><th>${rankEsc(m.label)}</th></tr></thead><tbody>`;
  h += rows.map((r, i) => `<tr onclick="openProfile('${r.id}')"><td>${i + 1}</td><td>${rankEsc(r.name)}</td><td>${rankEsc(r.team || '')}</td><td>${r.value}${m.unit}</td></tr>`).join('');
  return h + '</tbody></table></div>';
}

// Median-crosshair scatter. One series, so no legend — the axis titles and
// the quadrant hint in the subtitle carry the read. Only the four most
// extreme players are labelled; the rest are hover/focus + the table view.
function labScatterChart(pts, spec) {
  const W = 720, H = 420, PAD = { t: 18, r: 24, b: 46, l: 58 };
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const pad = (arr) => { const lo = Math.min(...arr), hi = Math.max(...arr), m = (hi - lo) * 0.08 || 1; return [lo - m, hi + m]; };
  const [x0, x1] = pad(xs), [y0, y1] = pad(ys);
  const X = v => PAD.l + ((v - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const Y = v => H - PAD.b - ((v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const med = arr => { const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mx = med(xs), my = med(ys);

  const tick = (lo, hi) => { const step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 3))); const s = ((hi - lo) / 3) / step > 5 ? step * 5 : ((hi - lo) / 3) / step > 2 ? step * 2 : step; const out = []; for (let v = Math.ceil(lo / s) * s; v <= hi; v += s) out.push(Math.round(v * 100) / 100); return out; };

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;overflow:visible;" role="img" aria-label="${rankEsc(spec.title)} — scatter of ${spec.x.label} against ${spec.y.label}">`;
  // axes + gridlines (solid hairlines, recessive)
  tick(x0, x1).forEach(v => {
    svg += `<line x1="${X(v)}" y1="${PAD.t}" x2="${X(v)}" y2="${H - PAD.b}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
    svg += `<text x="${X(v)}" y="${H - PAD.b + 16}" text-anchor="middle" fill="#5c5955" font-family="var(--mono)" font-size="9">${v}</text>`;
  });
  tick(y0, y1).forEach(v => {
    svg += `<line x1="${PAD.l}" y1="${Y(v)}" x2="${W - PAD.r}" y2="${Y(v)}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
    svg += `<text x="${PAD.l - 8}" y="${Y(v) + 3}" text-anchor="end" fill="#5c5955" font-family="var(--mono)" font-size="9">${v}</text>`;
  });
  // median reference lines — a threshold, so dashed reads correctly here
  svg += `<line x1="${X(mx)}" y1="${PAD.t}" x2="${X(mx)}" y2="${H - PAD.b}" stroke="rgba(27,168,155,0.5)" stroke-width="1" stroke-dasharray="4 4"/>`;
  svg += `<line x1="${PAD.l}" y1="${Y(my)}" x2="${W - PAD.r}" y2="${Y(my)}" stroke="rgba(27,168,155,0.5)" stroke-width="1" stroke-dasharray="4 4"/>`;
  svg += `<text x="${X(mx) + 5}" y="${PAD.t + 10}" fill="#1ba89b" font-family="var(--mono)" font-size="8.5">MEDIAN ${Math.round(mx * 100) / 100}</text>`;
  svg += `<text x="${W - PAD.r}" y="${Y(my) - 5}" text-anchor="end" fill="#1ba89b" font-family="var(--mono)" font-size="8.5">MEDIAN ${Math.round(my * 100) / 100}</text>`;
  // axis titles
  svg += `<text x="${(PAD.l + W - PAD.r) / 2}" y="${H - 6}" text-anchor="middle" fill="#8a8780" font-family="var(--mono)" font-size="9.5" letter-spacing="1">${rankEsc(spec.x.label.toUpperCase())}</text>`;
  svg += `<text transform="translate(13,${(PAD.t + H - PAD.b) / 2}) rotate(-90)" text-anchor="middle" fill="#8a8780" font-family="var(--mono)" font-size="9.5" letter-spacing="1">${rankEsc(spec.y.label.toUpperCase())}</text>`;

  // Label the four most distinctive players — furthest from the medians in
  // normalized space. A name on every dot would be unreadable.
  const dist = p => Math.hypot((p.x - mx) / ((x1 - x0) || 1), (p.y - my) / ((y1 - y0) || 1));
  const labelled = new Set([...pts].sort((a, b) => dist(b) - dist(a)).slice(0, 4).map(p => p.id));

  pts.forEach(p => {
    const cx = X(p.x), cy = Y(p.y);
    const tip = `${p.name} (${p.team}) — ${spec.x.label}: ${p.x} · ${spec.y.label}: ${p.y}`;
    svg += `<g class="scatter-dot" tabindex="0" role="button" data-tip="${rankEsc(tip)}" aria-label="${rankEsc(tip)}" onclick="openProfile('${p.id}')">`;
    svg += `<circle cx="${cx}" cy="${cy}" r="10" fill="transparent"/>`;
    svg += `<circle cx="${cx}" cy="${cy}" r="5" fill="#a8893a" stroke="#161a23" stroke-width="2"/>`;
    if (labelled.has(p.id)) {
      const flip = cx > W - PAD.r - 90;
      svg += `<text x="${cx + (flip ? -9 : 9)}" y="${cy + 3.5}" text-anchor="${flip ? 'end' : 'start'}" fill="#e2e0dc" font-family="var(--mono)" font-size="9.5">${rankEsc(p.name)}</text>`;
    }
    svg += `</g>`;
  });
  svg += `</svg>`;
  return svg;
}

function renderLabPage() {
  const board = document.getElementById('labBoard');
  if (!board || !playersDB.length) return;

  // Season buttons, built from what the stats actually contain.
  const seasonRow = document.getElementById('labSeasonFilter');
  if (!labSeason) labSeason = LAB_SEASONS[LAB_SEASONS.length - 1];
  if (seasonRow && !seasonRow.children.length) {
    seasonRow.innerHTML = LAB_SEASONS.map(y =>
      `<button class="pos-btn${y === labSeason ? ' active' : ''}" onclick="setLabSeason('${y}', this)">${y}</button>`).join('');
  }

  const metrics = LAB_METRICS[labPos] || [];
  if (!labMetricKey || !metrics.some(m => m.key === labMetricKey)) labMetricKey = metrics[0] && metrics[0].key;
  // Keep the address bar pointing at exactly this board, so it can be shared.
  setRoute(`lab/${labPos.toLowerCase()}/${labSeason}/${labMetricKey}`);
  // A deep link sets the state directly, so the filter buttons have to be
  // told what is active — they only track their own clicks otherwise.
  document.querySelectorAll('#labPosFilter .pos-btn').forEach(b =>
    b.classList.toggle('active', b.textContent.trim() === labPos));
  document.querySelectorAll('#labSeasonFilter .pos-btn').forEach(b =>
    b.classList.toggle('active', b.textContent.trim() === labSeason));
  const m = metrics.find(x => x.key === labMetricKey);
  document.getElementById('labMetricRow').innerHTML = metrics.map(x =>
    `<button class="lab-metric${x.key === labMetricKey ? ' active' : ''}" onclick="setLabMetric('${x.key}')">${rankEsc(x.label)}</button>`).join('');
  if (!m) { board.innerHTML = ''; return; }

  const valueOf = m.ngs ? ((s, n) => m.ngs(n)) : ((s) => m.stat(s));
  const rows = labRows(valueOf, m).sort((a, b) => m.lower ? a.value - b.value : b.value - a.value).slice(0, 20);

  const boardTitle = `${m.label} — ${labPos}, ${labSeason}`;
  labExportBoard = rows.length ? {
    title: boardTitle,
    subtitle: m.note,
    source: `${labQualText(m)} · nflverse${m.ngs ? ' · NFL Next Gen Stats' : ''}`,
    unit: m.unit,
    mode: rows.length && Math.min(...rows.map(r => r.value)) >= 0
      && (Math.max(...rows.map(r => r.value)) - Math.min(...rows.map(r => r.value))) / Math.max(...rows.map(r => r.value)) < 0.35
      ? 'dots' : 'bars',
    rows: rows.map((r, i) => ({ rank: i + 1, name: r.name, team: r.team, value: r.value }))
  } : null;

  let h = `<div class="lab-head"><span class="lab-title">${rankEsc(boardTitle)}</span>`
    + `<span class="lab-qual">${rankEsc(labQualText(m))}${m.lower ? ' · LOWER RANKS FIRST' : ''}`
    + (rows.length ? ` <button class="export-btn" onclick="runExport(() => exportRowChart(labExportBoard), labExportBoard.title, this)">Export PNG</button>` : '')
    + `</span></div>`;
  h += `<div class="lab-sub">${rankEsc(m.note)}</div>`;
  if (!rows.length) {
    h += `<div class="medical-card"><div class="medical-detail">No player in the pool clears this board's qualifier for ${labSeason}. Nothing is shown rather than ranking on partial seasons.</div></div>`;
  } else {
    h += labView === 'chart' ? labBarBoard(rows, m) : labTable(rows, m);
    h += `<div class="rank-note">Top ${rows.length} of the ${labPos} pool. Click any player for the full profile. Source: nflverse${m.ngs ? ' · NFL Next Gen Stats' : ''} · REG season only.</div>`;
  }
  board.innerHTML = h;

  // ---- Scatter ----
  const spec = LAB_SCATTER[labPos];
  const scatterEl = document.getElementById('labScatter');
  if (!spec) { scatterEl.innerHTML = ''; return; }
  const pts = [];
  for (const p of playersDB) {
    if (p.pos !== labPos) continue;
    const ps = playerStats[p.id];
    const s = ps && ps.seasons && ps.seasons[labSeason];
    const n = (labNgs[p.id] && labNgs[p.id][labSeason]) || {};
    if (!labQualifies(spec, s)) continue;
    const x = spec.x.get(s, n), y = spec.y.get(s, n);
    if (typeof x !== 'number' || typeof y !== 'number' || isNaN(x) || isNaN(y)) continue;
    pts.push({ id: p.id, name: p.name, team: p.team, x, y });
  }
  if (pts.length < 5) { scatterEl.innerHTML = ''; return; }

  const scatterTitle = `${spec.title} — ${labPos}, ${labSeason}`;
  labExportScatter = {
    title: scatterTitle, subtitle: spec.sub,
    source: `${labQualText(spec)} · ${pts.length} qualified · nflverse · NFL Next Gen Stats`,
    xLabel: spec.x.label, yLabel: spec.y.label, points: pts
  };

  let sh = `<div class="scatter-wrap">`;
  sh += `<div class="lab-head"><span class="lab-title">${rankEsc(scatterTitle)}</span>`
    + `<span class="lab-qual">${rankEsc(labQualText(spec))} · ${pts.length} QUALIFIED`
    + ` <button class="export-btn" onclick="runExport(() => exportScatterChart(labExportScatter), labExportScatter.title, this)">Export PNG</button>`
    + `</span></div>`;
  sh += `<div class="lab-sub">${rankEsc(spec.sub)}</div>`;
  if (labView === 'chart') {
    sh += `<div class="medical-card" style="padding:20px;">${labScatterChart(pts, spec)}</div>`;
  } else {
    sh += `<div class="table-scroll"><table class="players-table rank-table"><thead><tr><th>Player</th><th>Team</th><th>${rankEsc(spec.x.label)}</th><th>${rankEsc(spec.y.label)}</th></tr></thead><tbody>`
      + [...pts].sort((a, b) => b.y - a.y).map(p =>
        `<tr onclick="openProfile('${p.id}')"><td>${rankEsc(p.name)}</td><td>${rankEsc(p.team || '')}</td><td>${p.x}</td><td>${p.y}</td></tr>`).join('')
      + '</tbody></table></div>';
  }
  sh += `</div>`;
  scatterEl.innerHTML = sh;
}

// ===== TEAMS =====
// Rosters are current; production is last season. A player who moved carries
// the numbers he earned elsewhere, and every one of those is marked — the
// alternative is a page quietly claiming a receiver did that here.
let teamsData = null, currentTeam = null, sosData = null, sosPos = 'WR';
let teamsPromise = null;
// Scheme is 216KB and only the Teams page reads it, so it is fetched when that
// page opens and never on first paint.
let schemePromise = null, schemeData = null;
function ensureScheme() {
  if (!schemePromise) schemePromise = loadJSON('/data/scheme.json').then(d => (schemeData = d));
  return schemePromise;
}

function ensureTeams() {
  if (!teamsPromise) teamsPromise = loadJSON('/data/teams.json').then(d => (teamsData = d));
  return teamsPromise;
}
let sosPromise = null;
function ensureSos() {
  if (!sosPromise) sosPromise = loadJSON('/data/sos.json').then(d => (sosData = d));
  return sosPromise;
}
function setSosPos(pos, btn) {
  sosPos = pos;
  document.querySelectorAll('#sosPosFilter .pos-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderTeamPage();
}
// Matchup difficulty as a diverging scale around the median defence (16.5).
// Gold is a soft matchup, blue a hard one — the same validated pair the rest
// of the site uses for a two-sided value.
function sosCellStyle(oppRank) {
  if (typeof oppRank !== 'number') return '';
  const d = (oppRank - 16.5) / 15.5;             // -1 hardest .. +1 softest
  const a = (Math.min(Math.abs(d), 1) * 0.42).toFixed(2);
  return d >= 0 ? `background:rgba(168,137,58,${a});` : `background:rgba(42,120,214,${a});`;
}

const DIVISION_ORDER = ['AFC East', 'AFC North', 'AFC South', 'AFC West',
  'NFC East', 'NFC North', 'NFC South', 'NFC West'];

function setTeam(abbr) {
  currentTeam = abbr;
  setRoute('teams/' + abbr.toLowerCase());
  renderTeamPage();
}

// One usage row: name, the bar, the number. Shares are already percentages.
function teamUsageRows(list, valueOf, unitLabel, max) {
  return list.map(p => {
    const v = valueOf(p);
    const w = (typeof v === 'number' && max > 0) ? (v / max) * 100 : 0;
    const tip = `${p.name}${p.producedFor ? ` — these numbers are from ${p.producedFor}` : ''}`
      + (p.games ? ` · ${p.games} games` : '') + (p.ppg ? ` · ${p.ppg} PPG` : '');
    return `<div class="tm-row" tabindex="0" role="button" data-tip="${rankEsc(tip)}" onclick="openProfile('${p.id}')">
      <span class="tm-name">
        <span class="tm-player">${rankEsc(p.name)}</span>
        ${p.producedFor ? `<span class="tm-moved" title="Produced for ${rankEsc(p.producedFor)}">${rankEsc(p.producedFor)}</span>` : ''}
        ${p.statusClass && p.statusClass !== 'status-healthy' ? `<span class="tm-status ${p.statusClass}">${rankEsc(p.status)}</span>` : ''}
      </span>
      <span class="tm-track"><span class="tm-bar" style="width:${Math.max(w, 0.5).toFixed(1)}%"></span></span>
      <span class="tm-val">${typeof v === 'number' ? v : '—'}${typeof v === 'number' ? unitLabel : ''}</span>
    </div>`;
  }).join('');
}

function teamBlock(title, sub, list, valueOf, unitLabel) {
  const vals = list.map(valueOf).filter(v => typeof v === 'number');
  if (!vals.length) {
    return `<div class="medical-card" style="padding:18px;"><div style="font-family:var(--serif);font-size:17px;font-weight:700;margin-bottom:6px;">${rankEsc(title)}</div>
      <div class="medical-detail">No ${rankEsc(title.toLowerCase())} on record for this group last season.</div></div>`;
  }
  const max = Math.max(...vals);
  // Sort by the value actually being charted. The roster arrives ordered by
  // raw volume, which put a 12% share below a 7% one.
  const sorted = [...list].sort((a, b) => (valueOf(b) ?? -Infinity) - (valueOf(a) ?? -Infinity));
  return `<div class="medical-card" style="padding:18px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:2px;">
      <span style="font-family:var(--serif);font-size:17px;font-weight:700;">${rankEsc(title)}</span></div>
    <div style="font-family:var(--mono);font-size:9.5px;color:var(--text-muted);letter-spacing:0.5px;margin-bottom:12px;">${rankEsc(sub)}</div>
    ${teamUsageRows(sorted, valueOf, unitLabel, max)}</div>`;
}

function renderTeamPicker() {
  const el = document.getElementById('teamPicker');
  if (!el || !teamsData) return;
  const byDiv = {};
  for (const t of Object.values(teamsData.teams)) (byDiv[t.division || 'Other'] ||= []).push(t);
  const divs = DIVISION_ORDER.filter(d => byDiv[d]).concat(Object.keys(byDiv).filter(d => !DIVISION_ORDER.includes(d)));
  el.innerHTML = divs.map(d => `<div class="team-div">
    <div class="team-div-label">${rankEsc(d)}</div>
    <div class="team-div-chips">${byDiv[d].sort((a, b) => a.abbr.localeCompare(b.abbr)).map(t =>
      `<button class="team-chip${t.abbr === currentTeam ? ' active' : ''}" onclick="setTeam('${t.abbr}')" title="${rankEsc(t.name)}">${rankEsc(t.abbr)}</button>`).join('')}</div>
  </div>`).join('');
}

function renderTeamPage() {
  const body = document.getElementById('teamBody');
  if (!body) return;
  if (!teamsData) { body.innerHTML = `<div class="medical-card"><div class="medical-detail">Loading teams…</div></div>`; return; }
  if (!currentTeam || !teamsData.teams[currentTeam]) currentTeam = Object.keys(teamsData.teams).sort()[0];
  renderTeamPicker();

  const t = teamsData.teams[currentTeam];
  const m = teamsData.meta;
  const intro = document.getElementById('teamsIntro');
  if (intro) intro.textContent = m.note;

  // The live week. Before kickoff this is week 1, which is what a reader
  // wants to see in August anyway.
  const wk = m.currentWeek;
  const game = t.schedule.find(g => g.week === wk);
  let h = `<div class="tm-head">
    <div><div class="tm-team">${rankEsc(t.name)}</div>
      <div class="tm-meta">${rankEsc(t.division || '')}${t.bye ? ` · BYE WEEK ${t.bye}` : ''}</div></div>
    <div class="tm-week">`;
  if (game) {
    h += `<div class="tm-week-label">${m.seasonStarted ? 'WEEK ' + wk : 'OPENS WEEK ' + wk}</div>
      <div class="tm-week-game">${game.home ? 'vs' : '@'} ${rankEsc(game.opp)}</div>
      <div class="tm-week-date">${rankEsc(game.date || '')}${game.result !== null ? ` · ${game.result > 0 ? 'W' : game.result < 0 ? 'L' : 'T'} by ${Math.abs(game.result)}` : ''}</div>`;
  } else {
    h += `<div class="tm-week-label">WEEK ${wk}</div><div class="tm-week-game">BYE</div>`;
  }
  h += `</div></div>`;

  const pass = t.roster.filter(p => (p.pos === 'WR' || p.pos === 'TE'));
  const backs = t.roster.filter(p => p.pos === 'RB');
  const qbs = t.roster.filter(p => p.pos === 'QB');

  h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:14px;margin-bottom:14px;">`;
  h += teamBlock('Target share', `WHO THE PASSES GO TO · ${m.statsSeason}`, pass.filter(p => typeof p.tgtShare === 'number'), p => p.tgtShare, '%');
  h += teamBlock('Air yards share', `WHO THE OFFENSE THROWS TO DOWNFIELD · ${m.statsSeason}`, pass.filter(p => typeof p.airYardShare === 'number'), p => p.airYardShare, '%');
  h += teamBlock('Backfield carries', `HOW THE RUN GAME SPLIT · ${m.statsSeason}`, backs.filter(p => typeof p.carries === 'number' && p.carries > 0), p => p.carries, '');
  h += teamBlock('Snap share', `WHO WAS ON THE FIELD · ${m.statsSeason}`,
    t.roster.filter(p => typeof p.snapPct === 'number').sort((a, b) => b.snapPct - a.snapPct).slice(0, 10), p => p.snapPct, '%');
  h += `</div>`;

  if (qbs.length) {
    h += `<div class="medical-card" style="padding:18px;margin-bottom:14px;">
      <div style="font-family:var(--serif);font-size:17px;font-weight:700;margin-bottom:10px;">Quarterbacks</div>`
      + qbs.map(q => `<div class="tm-row" tabindex="0" role="button" onclick="openProfile('${q.id}')">
          <span class="tm-name"><span class="tm-player">${rankEsc(q.name)}</span>
          ${q.producedFor ? `<span class="tm-moved">${rankEsc(q.producedFor)}</span>` : ''}
          ${q.statusClass && q.statusClass !== 'status-healthy' ? `<span class="tm-status ${q.statusClass}">${rankEsc(q.status)}</span>` : ''}</span>
          <span class="tm-track"></span>
          <span class="tm-val">${q.games ? q.games + ' g' : '—'}</span></div>`).join('')
      + `</div>`;
  }

  // Full schedule strip — the bye shows as a gap, which is the point.
  h += schemeHtml(currentTeam);

  const sosTeam = sosData && sosData.teams[currentTeam] && sosData.teams[currentTeam][sosPos];
  h += `<div class="medical-card" style="padding:18px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:2px;">
      <span style="font-family:var(--serif);font-size:17px;font-weight:700;">${m.season} Schedule</span>
      <div class="position-filter" id="sosPosFilter">${['QB','RB','WR','TE'].map(x =>
        `<button class="pos-btn${x === sosPos ? ' active' : ''}" onclick="setSosPos('${x}', this)">${x}</button>`).join('')}</div>
    </div>
    <div style="font-family:var(--mono);font-size:9.5px;color:var(--text-muted);letter-spacing:0.5px;margin-bottom:10px;">
      18 WEEKS · BYE IN WEEK ${t.bye || '—'}${sosTeam && sosTeam.season ?
        ` · ${sosPos} SLATE: ${ordinalWord(sosTeam.seasonEaseRank)} EASIEST · OPENING MONTH ${sosTeam.early ? sosTeam.early.avgRank : '—'} · PLAYOFF WEEKS ${sosTeam.playoffs ? sosTeam.playoffs.avgRank : '—'}` : ''}</div>
    <div class="tm-sched">`;
  const weeks = {};
  t.schedule.forEach(g => { weeks[g.week] = g; });
  const lastWeek = Math.max(...t.schedule.map(g => g.week));
  for (let w = 1; w <= lastWeek; w++) {
    const g = weeks[w];
    if (!g) { h += `<div class="tm-sched-cell tm-bye"><span>${w}</span><b>BYE</b></div>`; continue; }
    const cls = w === wk ? ' tm-now' : '';
    const dRank = sosData && sosData.defense[g.opp] && sosData.defense[g.opp][sosPos];
    const tip = `Week ${w} ${g.home ? 'vs' : 'at'} ${g.opp}${g.date ? ' · ' + g.date : ''}`
      + (dRank ? ` — ${g.opp} was ${ordinalWord(dRank.rank)} stingiest to ${sosPos}s in ${sosData.meta.defenseSeason}, ${dRank.perGame} pts/gm` : '');
    h += `<div class="tm-sched-cell${cls}" style="${dRank ? sosCellStyle(dRank.rank) : ''}" data-tip="${rankEsc(tip)}">
      <span>${w}</span><b>${g.home ? '' : '@'}${rankEsc(g.opp)}</b></div>`;
  }
  h += `</div>`;
  if (sosData) {
    h += `<div class="rank-legend" style="margin-top:12px;">
      <span><i style="background:rgba(42,120,214,0.42);"></i>Hard matchup</span>
      <span><i style="background:rgba(168,137,58,0.42);"></i>Soft matchup</span>
      <span>Shading is how many fantasy points that defence conceded to ${rankEsc(sosPos)}s in ${sosData.meta.defenseSeason}</span></div>`;
    h += `<div style="font-size:11px;color:var(--text-muted);font-style:italic;line-height:1.7;margin-top:10px;">${rankEsc(sosData.meta.caveats)}</div>`;
  }
  h += `</div>`;

  body.innerHTML = h;
}

// 12 -> "12th". Used for defensive and slate ranks.
function ordinalWord(n) {
  if (typeof n !== 'number') return '—';
  const r = n % 100;
  if (r >= 11 && r <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}

// ===== DRAFT OUTCOMES =====
// What draft capital produced on its own, 2018–2023. This is deliberately
// NOT a validation of the POE model: validating a model needs its
// predictions, which are not published here. It is the base rate the model
// claims to beat, and printing it next to the claim is what lets a reader
// judge the claim instead of taking it on faith.
let draftPromise = null;
function ensureDraftOutcomes() {
  if (!draftPromise) draftPromise = loadJSON('/data/draft-outcomes.json').then(d => d || null);
  return draftPromise;
}

async function renderDraftOutcomes() {
  const el = document.getElementById('draftOutcomes');
  if (!el) return;
  const data = await ensureDraftOutcomes();
  if (!data || !data.positions) { el.innerHTML = ''; return; }
  const m = data.meta;

  let h = `<div class="section-divider" style="padding:0;margin:0 0 16px;">
    <span class="section-divider-label">What Draft Capital Actually Produced</span>
    <span class="section-divider-line"></span></div>`;
  h += `<div style="font-size:13.5px;color:var(--text-secondary);line-height:1.7;max-width:900px;margin-bottom:20px;">
    Every skill player drafted ${m.classes[0]}–${m.classes[1]}, and whether he ever cleared this page's own success
    bar — ${rankEsc(m.successRule.toLowerCase())}. Round one is where the hit rate lives, and at receiver the drop
    after it is a cliff, not a slope.</div>`;

  h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:14px;">`;
  for (const pos of ['RB', 'WR', 'TE']) {
    const p = data.positions[pos];
    if (!p) continue;
    const max = Math.max(...p.byRound.map(r => r.pct), 10);
    h += `<div class="medical-card" style="padding:18px;">`;
    h += `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
      <span style="font-family:var(--serif);font-size:18px;font-weight:700;">${pos}</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-muted);">${p.hits} OF ${p.total} EVER HIT · ${p.pct}%</span></div>`;
    h += `<div style="font-family:var(--mono);font-size:9.5px;color:var(--gold);letter-spacing:0.5px;margin-bottom:14px;">HIT RATE BY ROUND</div>`;
    h += `<div style="display:flex;align-items:flex-end;gap:5px;height:92px;border-bottom:1px solid var(--border);">`;
    h += p.byRound.map(r => {
      const hh = Math.max((r.pct / max) * 82, 2);
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;"
        data-tip="${rankEsc(`Round ${r.round}: ${r.hits} of ${r.n} ${pos}s drafted ever finished top-12 inside three seasons`)}">
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-secondary);margin-bottom:3px;">${r.pct}</div>
        <div style="width:78%;height:${hh.toFixed(1)}px;border-radius:3px 3px 0 0;background:#a8893a;"></div>
      </div>`;
    }).join('');
    h += `</div><div style="display:flex;gap:5px;margin-top:5px;">`
      + p.byRound.map(r => `<div style="flex:1;text-align:center;font-family:var(--mono);font-size:8px;color:var(--text-muted);line-height:1.3;">R${r.round}<br>n=${r.n}</div>`).join('')
      + `</div>`;

    if (p.lateHits && p.lateHits.length) {
      h += `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border-subtle);">
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:0.5px;margin-bottom:6px;">FOUND AFTER ROUND 2</div>
        <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">`
        + p.lateHits.slice(0, 4).map(x => `${rankEsc(x.name)} <span style="color:var(--text-muted);font-family:var(--mono);font-size:10px;">R${x.round}</span>`).join(' · ')
        + `</div></div>`;
    }
    if (p.firstRoundMisses && p.firstRoundMisses.length) {
      h += `<div style="margin-top:10px;">
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:0.5px;margin-bottom:6px;">ROUND ONE, NEVER HIT</div>
        <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">`
        + p.firstRoundMisses.slice(0, 4).map(x => `${rankEsc(x.name)} <span style="color:var(--text-muted);font-family:var(--mono);font-size:10px;">${x.season}</span>`).join(' · ')
        + `</div></div>`;
    }
    h += `</div>`;
  }
  h += `</div>`;

  h += `<div style="font-size:11.5px;color:var(--text-muted);font-style:italic;line-height:1.7;margin-top:16px;max-width:900px;">
    ${rankEsc(m.scope)}</div>`;
  h += `<div style="font-size:11.5px;color:var(--text-muted);font-style:italic;line-height:1.7;margin-top:8px;max-width:900px;">
    ${rankEsc(m.caveats)} Source: ${rankEsc(m.source)}.</div>`;
  el.innerHTML = h;
}

// ===== VALUE BOARD =====
// The ranks against what the room is actually doing. The Signal rank is an
// ordering, ADP is a pick number, and the gap between them is the only
// number a drafter can act on.
//
// Edge = ADP − Signal rank. Positive means he falls past where we have him,
// so you get him later than we value him. Negative means the room is higher
// on him than we are.
let vbPos = 'all', vbView = 'values';
let adpPromise = null;
function ensureAdp() {
  if (!adpPromise) adpPromise = loadJSON('/data/adp.json').then(d => d || null);
  return adpPromise;
}

function setVbPos(pos, btn) {
  vbPos = pos;
  document.querySelectorAll('#vbPosFilter .pos-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderValueBoard();
}
function setVbView(v, btn) {
  vbView = v;
  document.querySelectorAll('#vbViewFilter .pos-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderValueBoard();
}

// Same normalization the pipeline scripts use, so a name that joins in the
// build joins here too.
function vbNorm(s) {
  return String(s || '').toLowerCase()
    .replace(/\s+(iii|ii|iv|jr\.?|sr\.?)$/i, '')
    .replace(/[''`’]/g, '').replace(/\./g, '').trim();
}

function valueBoardRows() {
  if (!vbAdp || !rankingsData.qb) return [];
  const adpByKey = new Map(vbAdp.players.map(p => [vbNorm(p.name) + '|' + p.pos, p]));

  // Positional rank on both sides, deliberately.
  //
  // The first version compared an overall Signal rank to the ADP pick
  // number, and the board came back saying almost every tight end and
  // quarterback was a screaming value. That was an artifact, not a finding:
  // the ranks cover 88 players and ADP covers 184, so anyone deep in a
  // shorter list is automatically "falling" against a longer one. Two
  // positional ranks are the same scale on both sides, and they are how a
  // drafter actually argues — "he's my TE5 and he's going TE8".
  const adpPosRank = new Map();
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    vbAdp.players.filter(p => p.pos === pos).sort((a, b) => a.adp - b.adp)
      .forEach((p, i) => adpPosRank.set(vbNorm(p.name) + '|' + pos, i + 1));
  }

  const rows = [];
  for (const tab of ['qb', 'rb', 'wr', 'te']) {
    for (const r of (rankingsData[tab] || [])) {
      const key = vbNorm(r.name) + '|' + r.pos;
      const a = adpByKey.get(key);
      const posRank = adpPosRank.get(key);
      // No ADP means no comparison to draw. Skipped, never guessed.
      if (!a || !posRank || typeof r.rank !== 'number') continue;
      rows.push({
        name: r.name, team: r.team, pos: r.pos,
        signalPos: r.rank, adpPos: posRank, pick: a.adp,
        stdev: a.stdev, drafts: a.timesDrafted,
        edge: posRank - r.rank,
        availability: r.availability || null
      });
    }
  }
  return rows;
}

let vbAdp = null;

function renderValueBoard() {
  const body = document.getElementById('valueBoardBody');
  if (!body) return;
  const metaEl = document.getElementById('valueBoardMeta');
  const noteEl = document.getElementById('valueBoardNote');

  if (!vbAdp) {
    body.innerHTML = `<div class="medical-card"><div class="medical-detail">Loading average draft position…</div></div>`;
    return;
  }
  const m = vbAdp.meta;
  if (metaEl) metaEl.textContent = `${m.format} · ${m.teams}-TEAM · ${m.totalDrafts ? m.totalDrafts.toLocaleString() + ' DRAFTS' : ''}`;

  let rows = valueBoardRows();
  if (vbPos !== 'all') rows = rows.filter(r => r.pos === vbPos);
  if (!rows.length) { body.innerHTML = `<div class="medical-card"><div class="medical-detail">No overlap between the ranks and the ADP board here.</div></div>`; return; }

  const total = rows.length;
  let shown;
  if (vbView === 'values') shown = [...rows].sort((a, b) => b.edge - a.edge).slice(0, 20);
  else if (vbView === 'reaches') shown = [...rows].sort((a, b) => a.edge - b.edge).slice(0, 20);
  else shown = [...rows].sort((a, b) => a.pick - b.pick);

  const maxAbs = Math.max(...shown.map(r => Math.abs(r.edge)), 1);

  let h = `<div class="medical-card" style="padding:20px;position:relative;">`;
  h += `<div class="vb-row vb-head"><span>Player</span><span>Signal</span><span>By ADP</span><span>Pick</span>`
    + `<span class="vb-track-head">← room is higher · he falls to you →</span><span>Edge</span></div>`;
  h += shown.map(r => {
    const pos = r.edge >= 0;
    const w = (Math.abs(r.edge) / maxAbs) * 50;   // half the track each way
    const tip = `${r.name} — The Signal has him ${r.pos}${r.signalPos}; the room drafts him as ${r.pos}${r.adpPos}, `
      + `around pick ${r.pick}${r.stdev ? ` (±${r.stdev})` : ''}. `
      + `${r.edge > 0 ? `Falls ${r.edge} spot${r.edge === 1 ? '' : 's'} past where we have him.`
        : r.edge < 0 ? `The room takes him ${Math.abs(r.edge)} spot${Math.abs(r.edge) === 1 ? '' : 's'} earlier than we would.`
        : 'The room agrees exactly.'}`
      + (r.availability ? ` Available ${r.availability.pct}% of games.` : '');
    return `<div class="vb-row" tabindex="0" data-tip="${rankEsc(tip)}" aria-label="${rankEsc(tip)}">
      <span class="vb-name"><span class="ticker-pos" data-p="${rankEsc(r.pos)}">${rankEsc(r.pos)}</span>
        <span class="vb-player">${rankEsc(r.name)}</span>
        <span class="rank-team">${rankEsc(r.team || '')}</span></span>
      <span class="vb-num">${r.pos}${r.signalPos}</span>
      <span class="vb-num">${r.pos}${r.adpPos}</span>
      <span class="vb-num vb-pick">${r.pick}</span>
      <span class="vb-track"><span class="vb-zero"></span>
        <span class="vb-bar" style="${pos ? `left:50%;width:${w.toFixed(1)}%;background:#a8893a;`
          : `right:50%;width:${w.toFixed(1)}%;background:#2a78d6;`}"></span></span>
      <span class="vb-edge" style="color:${pos ? 'var(--gold)' : 'var(--blue)'};">${r.edge > 0 ? '+' : ''}${r.edge}</span>
    </div>`;
  }).join('');
  h += `</div>`;
  body.innerHTML = h;

  noteEl.textContent =
    `Showing ${shown.length} of ${total} ranked players with an ADP. Both sides are positional ranks — his rank here `
    + `against his rank among players at his position by ADP — because that is the same scale on both sides and it is how `
    + `a drafter argues. Comparing an overall rank to a pick number does not work: these ranks cover ${total} players and `
    + `the ADP board covers ${vbAdp.players.length}, so anyone deep in the shorter list looks like a bargain automatically. `
    + `Pick is the average draft slot, for knowing when he actually goes. ADP is ${m.source}'s consensus over `
    + `${m.totalDrafts ? m.totalDrafts.toLocaleString() : 'thousands of'} ${m.format} ${m.teams}-team mock drafts since `
    + `${m.windowStart || 'recently'} — one site's rooms, not the whole market, and mock drafters are not your league. `
    + `A player needs ${m.minDrafts}+ drafts to appear. The edge is a disagreement, not a projection: it says where we `
    + `differ from the room, never who is right.`;
}

// ===== HOME MINI-CHARTS =====
// The analysis-card side panels used to hold decorative bars with hardcoded
// widths. Real data only now: a card whose data is missing renders empty.
function renderMiniBars(id, items, color) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!items || !items.length) { el.innerHTML = ''; return; }
  const max = Math.max(...items.map(i => i.value));
  if (!(max > 0)) { el.innerHTML = ''; return; }
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', items.map(i => i.label).join('; '));
  el.innerHTML = items.map(i =>
    `<div class="chart-bar" style="width:${Math.max((i.value / max) * 100, 4).toFixed(1)}%;background:${color};opacity:0.55;" title="${rankEsc(i.label)}"></div>`
  ).join('');
}

function renderHomeMinis() {
  // Reads the precomputed summary, not the full stats file — see ensureStats.
  const hs = homeSummaryData;
  const tgtRows = (hs && hs.targetShareLeaders ? hs.targetShareLeaders : []).map(r =>
    ({ label: `${r.name}: ${r.value}% target share (${hs.season})`, value: r.value }));
  renderMiniBars('miniTgtShare', tgtRows, 'var(--gold)');

  // Return-to-play rates by injury type, from the medical research file.
  const injRows = Object.values(injuryResearch || {})
    .filter(i => i && typeof i.returnRate === 'number' && i.name)
    .map(i => ({ label: `${i.name}: ${i.returnRateLabel || i.returnRate + '% return'}`, value: i.returnRate }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);
  renderMiniBars('miniInjury', injRows, 'var(--red)');

  // Top of the overall board by value over replacement.
  const vorpRows = (rankingsData.overall || [])
    .filter(p => typeof p.vorp === 'number')
    .slice(0, 5)
    .map(p => ({ label: `${p.name}: VORP ${p.vorp}`, value: p.vorp }));
  renderMiniBars('miniVorp', vorpRows, 'var(--blue)');

  // Featured player's PPG by season, for the route-tree piece.
  const feat = hs && hs.featured;
  renderMiniBars('miniLamb', feat && feat.seasons
    ? feat.seasons.map(s => ({ label: `${s.season}: ${s.ppg} PPR PPG`, value: s.ppg }))
    : [], '#a78bfa');
}

// ===== PAGE SWITCHING =====
function switchPage(page) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
  window.scrollTo(0, 0);
  // The hash IS the address of what you are looking at, so a page switch
  // rewrites it rather than clearing it. Leaders and Rankings then refine it
  // further with their own filters, so a specific board can be linked.
  // Only reset the address when the PAGE actually changes. The router calls us
  // back with a deeper route already in the bar — /medicals/kittle, /teams/sea,
  // /rankings/wr — and a bare setRoute(page) here threw away the part that said
  // which one, leaving the reader on the right page at the wrong URL.
  if (page !== 'article') {
    const target = page === 'home' ? '' : page;
    if (currentRoute().split('/')[0] !== target) setRoute(target);
  }
  // The address just changed, so the document's claim about itself has to
  // change with it — title, description and canonical all follow the route.
  applyRouteMeta();
  if (page === 'players') renderPlayersTable();
  if (page === 'medicals') {
    renderMedicals(medSearch);
    renderInjuryTypeGrid();
    renderInjuryCurves();
    // 269 players of report history, fetched once and only when this page is
    // actually opened. The page renders the hand-written layer immediately and
    // fills in the generated one when it lands.
    ensureInjuries().then(d => {
      medInjuries = d;
      if (document.getElementById('page-medicals').classList.contains('active')) renderMedicals(medSearch);
    });
  }
  if (page === 'draft') renderDraftOutcomes();
  if (page === 'teams') {
    const redrawTeams = () => { if (document.getElementById('page-teams').classList.contains('active')) renderTeamPage(); };
    renderTeamPage();
    ensureTeams().then(redrawTeams);
    ensureSos().then(redrawTeams);
    ensureScheme().then(redrawTeams);
  }
  if (page === 'fantasy') {
    renderValueBoard();
    ensureAdp().then(d => {
      vbAdp = d;
      if (document.getElementById('page-fantasy').classList.contains('active')) renderValueBoard();
    });
  }
  if (page === 'rankings') renderRankingsPage();
  // These three are the ones that genuinely need the season totals, so they
  // are also the ones that pay for loading them.
  if (page === 'compare') {
    renderComparePage();
    ensureStats().then(() => {
      if (document.getElementById('page-compare').classList.contains('active')) renderComparePage();
    });
  }
  if (page === 'lab') {
    // Leaders needs both the season totals and the tracking data; render as
    // each arrives rather than blocking on the pair.
    const redraw = () => {
      if (document.getElementById('page-lab').classList.contains('active')) renderLabPage();
    };
    renderLabPage();
    ensureStats().then(redraw);
    ensureNgs().then(d => { labNgs = d; redraw(); });
  }
}

// ===== PLAYERS TABLE =====
let currentPosFilter = 'all';

function renderPlayersTable(search = '') {
  const tbody = document.getElementById('playersTableBody');
  let filtered = playersDB;
  if (currentPosFilter !== 'all') filtered = filtered.filter(p => p.pos === currentPosFilter);
  if (search) filtered = filtered.filter(p => (p.name + p.team + p.pos).toLowerCase().includes(search.toLowerCase()));
  tbody.innerHTML = filtered.map(p => `
    <tr onclick="openProfile('${p.id}')">
      <td><div class="player-cell">${renderAvatar(p, 36, 12)}<div><div class="player-cell-name">${p.name}</div></div></div></td>
      <td><span style="font-family:var(--mono);font-size:12px;color:var(--text-muted);">${p.pos}</span></td>
      <td>${p.team || '—'}</td>
      <td>${p.age ?? '—'}</td>
      <td><span class="player-quick-status ${p.statusClass}">${p.status}</span></td>
      <td><span style="font-family:var(--mono);font-size:12px;color:var(--gold);">${p.fRank || '—'}</span></td>
    </tr>
  `).join('');
}

function filterPlayers(val) { renderPlayersTable(val); }
function filterByPos(pos, btn) {
  currentPosFilter = pos;
  document.querySelectorAll('.pos-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderPlayersTable(document.getElementById('playerSearchGlobal').value);
}

// ===== MEDICALS =====
// ===== MEDICALS =====
// The page has TWO layers and says which is which on every card.
//   medicals.json   — 31 hand-written, sourced narratives
//   injuries.json   — 269 players of generated official-injury-report history
// The generated layer used to be invisible here, so a page called Medical
// Intelligence covered 9% of the pool while the other 91% sat in the repo.
//
// Severity and impact are DIFFERENT axes and both already exist in the data:
// `severity` is how bad the injury was, `impact` is how much it still costs
// him. "Resolved — Career Start" is severity high, impact 10, and reading
// either one as the other gets a healthy player flagged. The page shows both.
// `severityLabel` is prose — 48 distinct strings across 73 injuries, one per
// injury, near enough — so it reads as a caption and never as a category.
const MED_SEVERITY_RANK = { high: 3, moderate: 2, low: 1 };
const MED_SORTS = {
  severity: 'Severity',
  impact: 'Career impact',
  missed: 'Games missed',
  name: 'Name',
};
const MED_FILTERS = {
  all: 'All',
  injured: 'Currently injured',
  sourced: 'Sourced profiles',
  history: 'Injury history',
};

let medSort = 'severity';
let medFilter = 'all';
let medSearch = '';
let medInjuries = null; // injuries.json once it lands; null until then

// Trim on a word boundary. `substring(150) + '...'` cut mid-word and, when the
// cut landed just after a sentence, printed four dots.
function medTrim(s, max) {
  const t = String(s || '').trim();
  if (t.length <= max) return rankEsc(t);
  const cut = t.slice(0, max).replace(/\s+\S*$/, '').replace(/[\s.,;:—–-]+$/, '');
  return rankEsc(cut) + '…';
}

// The injury that defines the profile — the costliest one, not whichever
// happens to sit first in the file. `injuries[0]` also threw outright on an
// empty array, which is a valid shape for a player with a clean history.
function medWorstInjury(profile) {
  const list = (profile && profile.injuries) || [];
  if (!list.length) return null;
  return list.reduce((worst, i) => {
    const a = (i.impact || 0) + (MED_SEVERITY_RANK[i.severity] || 0) * 0.1;
    const b = (worst.impact || 0) + (MED_SEVERITY_RANK[worst.severity] || 0) * 0.1;
    return a > b ? i : worst;
  }, list[0]);
}

function medSeasonTotals(seasons) {
  const years = Object.keys(seasons || {}).sort();
  let weeksListed = 0, gamesOut = 0;
  years.forEach(y => {
    weeksListed += seasons[y].weeksListed || 0;
    gamesOut += seasons[y].gamesOut || 0;
  });
  return { years, weeksListed, gamesOut };
}

// One row per player, from all three sources: the hand-written profile, the
// generated report history, and the live status. A player can appear because
// of any one of them — someone hurt in camp with no history on file still
// belongs on this page.
function medRows() {
  const rows = new Map();
  const pool = {};
  playersDB.forEach(p => { pool[p.id] = p; });

  const touch = id => {
    if (!rows.has(id)) {
      const p = pool[id];
      const profile = medicalDB[id];
      rows.set(id, {
        id, player: p || null, profile: profile || null,
        name: (p && p.name) || (profile && profile.name) || id,
        pos: (p && p.pos) || '', team: (p && p.team) || '',
        seasons: null, injured: false,
      });
    }
    return rows.get(id);
  };

  Object.keys(medicalDB).forEach(touch);
  Object.keys(medInjuries || {}).forEach(id => { touch(id).seasons = medInjuries[id]; });
  playersDB.forEach(p => {
    if (p.statusClass && p.statusClass !== 'status-healthy') touch(p.id).injured = true;
  });

  return [...rows.values()].map(r => {
    const worst = medWorstInjury(r.profile);
    const totals = medSeasonTotals(r.seasons);
    return {
      ...r, worst,
      severityRank: worst ? (MED_SEVERITY_RANK[worst.severity] || 0) : 0,
      impact: worst ? (worst.impact || 0) : 0,
      gamesOut: totals.gamesOut, weeksListed: totals.weeksListed, years: totals.years,
    };
  });
}

function medSortRows(rows) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const cmp = {
    severity: (a, b) => b.severityRank - a.severityRank || b.impact - a.impact || byName(a, b),
    impact: (a, b) => b.impact - a.impact || byName(a, b),
    missed: (a, b) => b.gamesOut - a.gamesOut || b.weeksListed - a.weeksListed || byName(a, b),
    name: byName,
  };
  return rows.sort(cmp[medSort] || cmp.severity);
}

function medMatchesFilter(r) {
  if (medFilter === 'sourced') return !!r.profile;
  if (medFilter === 'injured') return r.injured;
  if (medFilter === 'history') return !!r.seasons;
  return true;
}

function setMedSort(v) { medSort = v; renderMedicals(medSearch); }
function setMedFilter(v) { medFilter = v; renderMedicals(medSearch); }

// A medical profile is a thing you can send someone. It used to be reachable
// only by typing into a search box, which meant no URL, no back button, and
// nothing to link to.
// navigate() pushes a history entry and then renders through the router — the
// same path an incoming link takes, so a shared URL and a click produce
// identical markup, and the back button returns to the list instead of walking
// off the site.
function openMedical(id) { navigate('medicals/' + id); }
function closeMedical() { navigate('medicals'); }

let medDetailId = null;

function renderMedicals(search = '') {
  medSearch = search;
  const container = document.getElementById('medicalsContent');
  if (!container) return;

  if (medDetailId) { container.innerHTML = medDetailHtml(medDetailId); return; }

  const all = medRows();
  const q = search.trim().toLowerCase();
  let rows = all.filter(medMatchesFilter);
  if (q) {
    rows = rows.filter(r =>
      (r.name + ' ' + r.team + ' ' + r.pos + ' ' +
        ((r.profile && r.profile.injuries.map(i => i.title).join(' ')) || '')
      ).toLowerCase().includes(q)
    );
  }
  medSortRows(rows);

  const counts = {
    all: all.length,
    injured: all.filter(r => r.injured).length,
    sourced: all.filter(r => r.profile).length,
    history: all.filter(r => r.seasons).length,
  };

  let html = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">`;
  Object.entries(MED_FILTERS).forEach(([key, label]) => {
    html += `<button class="pos-btn${medFilter === key ? ' active' : ''}" onclick="setMedFilter('${key}')">${label} ${counts[key]}</button>`;
  });
  html += `<span style="margin-left:auto;display:flex;align-items:center;gap:8px;">`
    + `<span style="font-family:var(--mono);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);">Sort</span>`
    + `<select onchange="setMedSort(this.value)" style="background:var(--bg-card);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-family:var(--mono);font-size:11px;">`
    + Object.entries(MED_SORTS).map(([k, l]) => `<option value="${k}"${medSort === k ? ' selected' : ''}>${l}</option>`).join('')
    + `</select></span></div>`;

  html += `<div style="font-size:12px;color:var(--text-muted);line-height:1.6;margin-bottom:20px;">`
    + `${counts.sourced} sourced narrative profiles · ${counts.history} players with official injury-report history, 2023–2025. `
    + `A player on injured reserve drops off the weekly report, so the report counts appearances, not games missed.`
    + `</div>`;

  if (!rows.length) {
    html += `<div style="text-align:center;padding:48px 0;">
      <p style="font-family:var(--serif);font-size:20px;color:var(--text-secondary);margin-bottom:8px;">No medical records${q ? ` for "${rankEsc(search)}"` : ''}</p>
      <p style="font-size:13px;color:var(--text-muted);">Try a different name, or widen the filter.</p>
    </div>`;
    container.innerHTML = html;
    return;
  }

  // min(320px,100%), not a bare 320px: this page keeps 48px of padding on each
  // side, so a 375px phone leaves 279px of content and a hard 320px track
  // pushes the whole document sideways.
  html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr));gap:16px;">`;
  rows.forEach(r => { html += medCardHtml(r); });
  html += `</div>`;

  container.innerHTML = html;
}

// The avatar takes the POOL player, not the medical entry. Medical entries
// carry no sleeperId, so passing one to renderAvatar could only ever produce
// the initials fallback — every face on this page was a grey box while the
// rest of the site showed headshots.
function medAvatar(r, size, fontSize) {
  return renderAvatar(r.player || { name: r.name, ...(r.profile || {}) }, size, fontSize);
}

function medCardHtml(r) {
  // Exactly one coloured chip, and it always means the same thing: how he is
  // TODAY. Severity is a different axis about a past injury, and rendering
  // both as red badges side by side made a healthy man with an old ACL look
  // like a scratch. Severity goes to the meta line as plain text.
  const status = r.injured && r.player
    ? `<span class="player-quick-status ${r.player.statusClass}" style="font-size:10px;">${rankEsc(r.player.status)}</span>`
    : '';

  let body;
  if (r.worst) {
    body = `<h4 style="font-size:13px;font-weight:600;margin-bottom:6px;">${rankEsc(r.worst.title)}</h4>`
      + `<p style="font-size:12px;color:var(--text-secondary);line-height:1.5;">${medTrim(r.worst.detail, 150)}</p>`;
  } else if (r.seasons) {
    const spanYears = r.years.length ? `${r.years[0]}–${r.years[r.years.length - 1].slice(2)}` : '';
    body = `<h4 style="font-size:13px;font-weight:600;margin-bottom:6px;">${r.weeksListed} week${r.weeksListed === 1 ? '' : 's'} on the injury report</h4>`
      + `<p style="font-size:12px;color:var(--text-secondary);line-height:1.5;">`
      + (r.gamesOut ? `Ruled out of ${r.gamesOut} game${r.gamesOut === 1 ? '' : 's'} across ${spanYears}.` : `Never ruled out across ${spanYears} — every listing was a tag he played through.`)
      + `</p>`;
  } else {
    body = `<p style="font-size:12px;color:var(--text-secondary);line-height:1.5;">No injury history on file. Listed here because he is not healthy right now.</p>`;
  }

  const meta = [];
  if (r.profile) meta.push('Sourced profile');
  if (r.worst) meta.push(`${r.worst.severity.charAt(0).toUpperCase() + r.worst.severity.slice(1)} severity`);
  if (r.worst) meta.push(`Career impact ${r.worst.impact}`);
  if (r.seasons && r.gamesOut) meta.push(`${r.gamesOut} ruled out`);

  return `<div class="medical-card" style="cursor:pointer;transition:background 0.2s;" onclick="openMedical('${jsAttr(r.id)}')" onmouseover="this.style.background='var(--bg-card-hover)'" onmouseout="this.style.background=''">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
      ${medAvatar(r, 40, 12)}
      <div style="min-width:0;">
        <div style="font-weight:600;font-size:14px;">${rankEsc(r.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);">${rankEsc([r.pos, r.team].filter(Boolean).join(' · '))}</div>
      </div>
      <span style="margin-left:auto;text-align:right;">${status}</span>
    </div>
    ${body}
    ${meta.length ? `<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);margin-top:10px;">${meta.map(rankEsc).join(' · ')}</div>` : ''}
  </div>`;
}

function medDetailHtml(id) {
  const r = medRows().find(x => x.id === id);
  if (!r) return `<div class="medical-card"><div class="medical-detail">No medical record for this player.</div></div>`;

  const sub = (r.profile && r.profile.team) || [r.pos, r.team].filter(Boolean).join(' · ');
  let html = `<div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
      ${medAvatar(r, 48, 15)}
      <div style="flex:1;min-width:0;">
        <div style="font-family:var(--serif);font-size:24px;font-weight:600;">${rankEsc(r.name)}</div>
        <div style="font-size:13px;color:var(--text-secondary);">${rankEsc(sub)}</div>
      </div>
      <span style="display:flex;gap:8px;align-items:center;">
        ${r.player ? `<span style="font-family:var(--mono);font-size:10px;color:var(--text-muted);cursor:pointer;" onclick="openProfile('${jsAttr(r.id)}')">Full profile →</span>` : ''}
        <span style="font-family:var(--mono);font-size:10px;color:var(--text-muted);cursor:pointer;" onclick="closeMedical()">✕ Close</span>
      </span>
    </div>`;

  // The live status comes from the feed and the override layer, so it is the
  // one thing on this page that is current as of this morning.
  if (r.player) {
    html += `<div class="medical-card" style="margin-bottom:20px;display:flex;align-items:center;gap:12px;">
      <span style="font-family:var(--mono);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);">Today</span>
      <span class="player-quick-status ${r.player.statusClass}">${rankEsc(r.player.status)}</span>
      <span style="font-size:11px;color:var(--text-muted);margin-left:auto;">${r.player.statusSource === 'override' ? 'Hand-entered, sourced' : 'NFL / Sleeper injury feed'}</span>
    </div>`;
  }

  if (r.profile && r.profile.currentStatus) {
    html += `<div class="medical-card" style="border-left:3px solid var(--gold);margin-bottom:20px;">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold);margin-bottom:8px;">Assessment</div>
      <div class="medical-detail" style="margin-bottom:0;">${rankEsc(r.profile.currentStatus)}</div>
    </div>`;
  }

  ((r.profile && r.profile.injuries) || []).forEach(inj => {
    html += `<div class="medical-card">
      <div class="medical-card-header"><h4>${rankEsc(inj.title)}</h4><span class="severity ${inj.severity}">${rankEsc(inj.severityLabel)}</span></div>
      <div class="medical-detail">${rankEsc(inj.detail)}</div>
      <div class="impact-meter"><div class="impact-label">Career Impact</div><div class="impact-bar"><div class="impact-fill ${inj.impactClass}" style="width:${Number(inj.impact) || 0}%"></div></div></div>
      <div class="medical-source">Source: <span class="source-verified">✓ ${rankEsc(inj.source)}</span></div>
    </div>`;
  });

  html += injuryReportHtml(r.seasons);

  if (!r.profile && !r.seasons) {
    html += `<div class="medical-card"><div class="medical-detail">No injury history on file for this player.</div></div>`;
  }
  return html;
}

// Typing in the search box means "show me the list again", so it leaves an
// open profile rather than filtering a page that isn't a list.
function filterMedicals(val) {
  if (medDetailId) { medDetailId = null; setRoute('medicals'); }
  renderMedicals(val);
}


// ===== SCHEME & IDENTITY =====
// Personnel is the one public number that shows a coach's INTENT rather than
// his results, and it is the rare case where the whole causal chain is
// measurable: heavier personnel draws defenders into the box, a loaded box is
// short a man in coverage, and the explosive rate moves. The page shows all
// three links and lets the reader judge the last one, instead of asserting it.
//
// Every figure is compared against the league in the SAME season. A team's 12
// personnel rate means nothing without knowing what everyone else did that year.
const SCHEME_LABELS = {
  '11': '11 — 1 back, 1 TE, 3 WR',
  '12': '12 — 1 back, 2 TE, 2 WR',
  '13': '13 — 1 back, 3 TE, 1 WR',
  '21': '21 — 2 backs, 1 TE, 2 WR',
  '22': '22 — 2 backs, 2 TE, 1 WR',
  '10': '10 — 1 back, 0 TE, 4 WR',
  '20': '20 — 2 backs, 0 TE, 3 WR',
  '23': '23 — 2 backs, 3 TE',
  '01': '01 — no back, 1 TE, 4 WR',
  '02': '02 — no back, 2 TE, 3 WR',
  '00': '00 — empty, 5 WR',
};

// A grouping has to be a real part of the diet before a shift in it is worth
// reporting. Below this, one game plan moves the number several points.
const SCHEME_MIN_RATE = 5;
const SCHEME_SHIFT_PTS = 6;

function schemeLabel(g) {
  return SCHEME_LABELS[g] || `${g} personnel`;
}

// Always one decimal. toFixed(1) on a whole number gives "11.0" but the value
// arrives already rounded, so 11 and 9.9 sat in the same column looking ragged.
function schemePct(v) {
  return (v === null || v === undefined) ? '—' : `${Number(v).toFixed(1)}%`;
}

function schemeDelta(now, before) {
  if (now === null || now === undefined || before === null || before === undefined) return null;
  return +(now - before).toFixed(1);
}

function schemeArrow(d) {
  if (d === null || Math.abs(d) < 0.05) return '';
  const up = d > 0;
  const color = up ? 'var(--teal)' : 'var(--blue)';
  return `<span style="font-family:var(--mono);font-size:10px;color:${color};">${up ? '▲' : '▼'}${Math.abs(d).toFixed(1)}</span>`;
}

function schemeHtml(team) {
  if (!schemeData || !schemeData.seasons) return '';
  const years = (schemeData.meta.seasons || []).slice().sort();
  const latest = years[years.length - 1];
  const cur = schemeData.seasons[latest] && schemeData.seasons[latest][team];
  if (!cur) return '';
  const prevYear = years[years.length - 2];
  const prev = prevYear && schemeData.seasons[prevYear] && schemeData.seasons[prevYear][team];
  const lg = schemeData.league[latest];

  const mix = Object.entries(cur.personnel).sort((a, b) => b[1].rate - a[1].rate);
  const top = mix.filter(([, d]) => d.rate >= 1);

  let h = `<div class="medical-card" style="padding:18px;margin-bottom:14px;">`;
  h += `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;">
    <span style="font-family:var(--serif);font-size:17px;font-weight:700;">Scheme &amp; Identity</span>
    <span style="font-family:var(--mono);font-size:9.5px;color:var(--text-muted);letter-spacing:0.5px;">${latest} · ${cur.plays} SNAPS${cur.coach ? ` · ${rankEsc(cur.coach.toUpperCase())}` : ''}</span>
  </div>`;

  // Did the identity change? This is the headline, so it goes first and only
  // appears when there is genuinely something to report.
  if (prev) {
    const shifts = [];
    for (const [g, d] of mix) {
      const before = prev.personnel[g] ? prev.personnel[g].rate : 0;
      const delta = schemeDelta(d.rate, before);
      if (delta === null) continue;
      if (Math.abs(delta) >= SCHEME_SHIFT_PTS && (d.rate >= SCHEME_MIN_RATE || before >= SCHEME_MIN_RATE)) {
        shifts.push({ g, delta, before, now: d.rate });
      }
    }
    shifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const coachChanged = prev.coach && cur.coach && prev.coach !== cur.coach;

    if (shifts.length || coachChanged) {
      h += `<div style="border-left:3px solid var(--gold);padding:10px 0 10px 14px;margin:14px 0 4px;">`;
      h += `<div style="font-family:var(--mono);font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold);margin-bottom:6px;">What changed from ${prevYear}</div>`;
      if (coachChanged) {
        h += `<div style="font-size:13.5px;line-height:1.7;color:var(--text-secondary);">${rankEsc(prev.coach)} → <strong style="color:var(--text);">${rankEsc(cur.coach)}</strong>. A new head coach is the most likely reason any of the below moved.</div>`;
      }
      for (const s of shifts.slice(0, 3)) {
        h += `<div style="font-size:13.5px;line-height:1.7;color:var(--text-secondary);">`
          + `<strong style="color:var(--text);">${schemeLabel(s.g).split(' — ')[0]} personnel ${s.delta > 0 ? 'up' : 'down'} ${Math.abs(s.delta).toFixed(1)} points</strong>`
          + ` — ${s.before.toFixed(1)}% of snaps in ${prevYear}, ${s.now.toFixed(1)}% in ${latest}.</div>`;
      }
      h += `</div>`;
    } else {
      h += `<div style="font-size:13px;color:var(--text-muted);line-height:1.7;margin:12px 0 4px;">No personnel grouping moved more than ${SCHEME_SHIFT_PTS} points from ${prevYear}. This offence is who it was.</div>`;
    }
  }

  // The mechanism, one row per grouping: how often, what it draws, what it produced.
  h += `<div class="table-scroll" style="margin-top:14px;"><table class="scheme-table">
    <thead><tr>
      <th>Personnel</th><th>Snaps</th><th>vs league</th><th>Box</th><th>7+ box</th><th>Explosive</th><th>EPA/play</th>
    </tr></thead><tbody>`;
  for (const [g, d] of top) {
    const lgG = lg && lg.personnel[g];
    const vsLeague = lgG ? schemeDelta(d.rate, lgG.rate) : null;
    const prevRate = prev && prev.personnel[g] ? prev.personnel[g].rate : null;
    const yoy = prevRate === null ? null : schemeDelta(d.rate, prevRate);
    h += `<tr>
      <td style="white-space:nowrap;">${rankEsc(schemeLabel(g))}</td>
      <td class="scheme-num">${schemePct(d.rate)} ${schemeArrow(yoy)}</td>
      <td class="scheme-num" style="color:var(--text-muted);">${vsLeague === null ? '—' : (vsLeague > 0 ? '+' : '') + vsLeague}</td>
      <td class="scheme-num">${d.boxAvg === null ? '—' : d.boxAvg}</td>
      <td class="scheme-num">${schemePct(d.heavyBoxRate)}</td>
      <td class="scheme-num">${schemePct(d.explosiveRate)}</td>
      <td class="scheme-num">${d.epaPerPlay === undefined || d.epaPerPlay === null ? '—' : (d.epaPerPlay > 0 ? '+' : '') + d.epaPerPlay}</td>
    </tr>`;
  }
  h += `</tbody></table></div>`;

  // The league row is the reference the whole table is read against.
  if (lg) {
    const l11 = lg.personnel['11'], l12 = lg.personnel['12'];
    if (l11 && l12) {
      h += `<div style="font-size:12.5px;color:var(--text-secondary);line-height:1.7;margin-top:12px;">
        League ${latest}: 11 personnel drew a loaded box on <strong style="color:var(--text);">${schemePct(l11.heavyBoxRate)}</strong> of snaps and went explosive on ${schemePct(l11.explosiveRate)}.
        12 personnel drew one on <strong style="color:var(--text);">${schemePct(l12.heavyBoxRate)}</strong> and went explosive on ${schemePct(l12.explosiveRate)}, at ${l12.epaPerPlay > 0 ? '+' : ''}${l12.epaPerPlay} EPA against ${l11.epaPerPlay > 0 ? '+' : ''}${l11.epaPerPlay}.
        Going heavy buys a lighter secondary and costs efficiency — which way that trade lands is a team-by-team question, and it is what this table is for.</div>`;
    }
  }

  // Formation and what defences answered with.
  const formTop = Object.entries(cur.formation || {}).sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= 1).slice(0, 4);
  const covTop = Object.entries(cur.coverageFaced || {}).sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= 3).slice(0, 5);
  if (formTop.length || covTop.length) {
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:16px;margin-top:16px;">`;
    if (formTop.length) {
      h += `<div><div style="font-family:var(--mono);font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;">Formation</div>`
        + formTop.map(([k, v]) => `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0;color:var(--text-secondary);"><span>${rankEsc(k.replace(/_/g, ' '))}</span><span style="font-family:var(--mono);">${v}%</span></div>`).join('')
        + `</div>`;
    }
    if (covTop.length) {
      h += `<div><div style="font-family:var(--mono);font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;">Coverage faced</div>`
        + covTop.map(([k, v]) => `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0;color:var(--text-secondary);"><span>${rankEsc(k.replace(/_/g, ' '))}</span><span style="font-family:var(--mono);">${v}%</span></div>`).join('')
        + `</div>`;
    }
    h += `</div>`;
  }

  h += `<div style="font-size:11px;color:var(--text-muted);font-style:italic;line-height:1.7;margin-top:14px;">`
    + `Explosive is ${rankEsc(schemeData.meta.explosive)}; a loaded box is ${rankEsc(schemeData.meta.heavyBox)}. `
    + `${rankEsc(schemeData.meta.qualifier)}. ${rankEsc(schemeData.meta.caveats)}`
    + `</div>`;

  h += `</div>`;
  return h;
}
