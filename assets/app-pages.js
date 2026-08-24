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
// 'stats' = production (what happened), 'charts' = how it happened,
// 'athletic' = the combine (no season — a man's forty does not change in
// September), 'defense' = team defences (no position — it ranks 32 teams).
// The last two carry FEWER dimensions than the first two, which is why the
// route, the controls, the title and the table columns all have to ask the
// mode rather than assume a player in a season.
let labMode = 'stats';
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
/* The rushing board's rows. Two sources, joined ID TO ID on the GSIS key —
   Next Gen Stats for the expectation and what he beat it by, play-by-play for
   what the carries were worth. A back missing from either side is left out
   rather than shown with half a row: the whole point of the board is the
   comparison between the legs, and half of it compares nothing. */
/* WHERE THE THREE LEGS DISAGREE, named rather than left for the reader to find
   by flipping between boards.

   This is the whole argument for publishing three numbers instead of the one
   everybody quotes. RYOE asks how much of the run was the back rather than the
   blocking; EPA per carry asks what the run was worth in the situation it
   happened in. A back can lead the first and lose the second — his good runs
   came on early downs with a lead, where the same yardage is worth less — and
   in 2025 that is not a hypothetical, it is the top of the board.

   Computed from the data on screen, so it stays true as the seasons move. */
function rushDisagreement() {
  const byRyoe = rushRows({ key: 'ryoePct', get: r => r.ryoePct, minAtt: 100 });
  const byEpa = rushRows({ key: 'epaPerCarry', get: r => r.epaPerCarry, minAtt: 100 });
  const epaRank = new Map([...byEpa].sort((a, b) => b.value - a.value).map((r, i) => [r.id, i + 1]));
  const ryoeRank = new Map([...byRyoe].sort((a, b) => b.value - a.value).map((r, i) => [r.id, i + 1]));
  const both = byRyoe.filter(r => epaRank.has(r.id));
  if (both.length < 12) return '';

  const gaps = both.map(r => ({
    name: r.name,
    ryoe: ryoeRank.get(r.id),
    epa: epaRank.get(r.id),
    gap: Math.abs(ryoeRank.get(r.id) - epaRank.get(r.id)),
  })).sort((a, b) => b.gap - a.gap).slice(0, 2);
  if (!gaps.length || gaps[0].gap < 5) return '';

  const of = both.length;
  const say = (g) => `${g.name} is ${ordinalWord(g.ryoe)} in RYOE and ${ordinalWord(g.epa)} of ${of} in EPA per carry`;
  return `<div class="season-state" style="margin:14px 0 0;"><span class="season-state-tag">Read together</span>`
    + `<span>${rankEsc(say(gaps[0]))}${gaps[1] ? `, and ${rankEsc(say(gaps[1]))}` : ''}. `
    + `The two are not measuring the same thing: one asks how much of the run was the runner rather than the blocking, `
    + `the other what the run was worth in the situation it happened in. A board showing either alone names a different back.</span></div>`;
}


function rushRows(m) {
  const rows = [];
  const byGsis = (labRushing && labRushing.seasons && labRushing.seasons[labSeason]) || {};
  for (const p of playersDB) {
    if (p.pos !== 'RB') continue;                       // backs only
    const ngsRow = ((labNgs[p.id] || {})[labSeason] || {}).rush || null;
    const epaRow = p.gsisId ? byGsis[p.gsisId] : null;
    if (!ngsRow) continue;
    // The attempt floor is on the NGS side, which is where the expectation
    // lives. Below it a season is a handful of runs and RYOE is mostly one of
    // them — the metric is explosion-driven and the small sample is not a
    // small measurement, it is a different one.
    if (!ngsRow.attempts || ngsRow.attempts < (m.minAtt || 60)) continue;
    const merged = { ...ngsRow, ...(epaRow || {}) };
    const v = m.get(merged);
    if (typeof v !== 'number' || isNaN(v)) continue;
    rows.push({ id: p.id, name: p.name, team: p.team, value: v });
  }
  return rows;
}

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

function setLabMode(mode) {
  if (labMode === mode) return;
  labMode = mode;
  // The metric and the season both belong to the half that was showing, and
  // neither is guaranteed to exist in the other one.
  labMetricKey = null;
  labSeason = null;
  renderLabPage();
}

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

// Where a board row points. Player boards open a profile; the Defence board is
// team rows, and a team row calling openProfile(null) would be a control that
// looks live and does nothing.
function labRowAction(r) {
  if (r.id) return `openProfile('${jsAttr(r.id)}')`;
  const teamTarget = r.teamLink || r.team;
  if (teamTarget) return `navigate('teams/${jsAttr(String(teamTarget).toLowerCase())}')`;
  return '';
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
    return `<div class="lab-row" tabindex="0" role="button" data-tip="${rankEsc(tip)}" aria-label="${rankEsc(tip)}" onclick="${labRowAction(r)}">
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
    // The Defence board ranks TEAMS, and labPos is only the leftover default
    // there — the position picker is hidden precisely because it means nothing.
    // Printed unchecked it read "RANGE ACROSS QUALIFIED WRs" over a table of
    // 32 defences, which names a population the board does not contain.
    + `<span style="letter-spacing:1px;">RANGE ACROSS QUALIFIED ${labMode === 'defense' ? 'DEFENCES' : labPos + 's'}</span>`
    + `<span>${fmt(b)}${m.unit}</span></div></div>`;
  h += `<div class="medical-card" style="padding:20px;position:relative;">`;
  h += rows.map((r, i) => {
    // A defence row IS the team, so there is no second team to put in
    // brackets — unchecked it read "SEA () — Yards per Target Allowed".
    const tip = `${r.name}${r.team ? ` (${r.team})` : ''} — ${m.label}: ${r.value}${m.unit}`
      + (typeof r.pct === 'number' ? ` — ${r.pct}th percentile at his position` : '');
    return `<div class="lab-row" tabindex="0" role="button" data-tip="${rankEsc(tip)}" aria-label="${rankEsc(tip)}" onclick="${labRowAction(r)}">
      <div class="lab-name"><span class="lab-rank">${i + 1}</span><span class="lab-player">${rankEsc(r.name)}</span><span class="lab-team">${rankEsc(r.team || '')}</span></div>
      <div class="lab-track"><div class="lab-rule"></div><div class="lab-dot" style="left:${X(r.value).toFixed(2)}%;"></div></div>
      <div class="lab-val">${r.value}${m.unit}</div>
    </div>`;
  }).join('');
  return h + `</div>`;
}

function labTable(rows, m) {
  // The Defence board ranks teams, so "Player" heads a column of team codes and
  // "Team" heads an empty one. A column every row leaves blank is a column that
  // should not be there.
  const teams = labMode === 'defense';
  let h = `<div class="table-scroll"><table class="players-table rank-table"><thead><tr><th>#</th><th>${teams ? 'Defence' : 'Player'}</th>`
    + (teams ? '' : '<th>Team</th>')
    + `<th>${rankEsc(m.label)}</th></tr></thead><tbody>`;
  h += rows.map((r, i) => `<tr onclick="${labRowAction(r)}"><td>${i + 1}</td><td>${rankEsc(r.name)}</td>`
    + (teams ? '' : `<td>${rankEsc(r.team || '')}</td>`)
    + `<td>${r.value}${m.unit}</td></tr>`).join('');
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

/* ═══════════════════════════════════════════════════════════════════════════
   CHARTS — the boards you cannot build from a box score

   The Stats half of this page is production: targets, yards, EPA, snap share.
   All of it answers what happened. The Charts half answers how, out of the two
   layers that were added to the moat rather than derived from it — FTN's
   play-by-play charting and Pro Football Reference's advanced splits.

   The distinction that makes this worth a section of its own: a target count
   cannot tell a first read from a checkdown, and a receiving line cannot tell
   the yards a quarterback earned a man from the yards he made himself. These
   boards can, and nothing else on the site does.

   Every board still states its qualifier and excludes anyone under it — the
   same rule as the Stats half, and it matters more here, because a 100% first
   read rate on four charted targets is not a finding.
   ═══════════════════════════════════════════════════════════════════════════ */

const RECEIVER_CHARTS = [
  { key: 'firstRead', label: 'First-Read Rate', chart: c => c.firstReadRate, unit: '%', minTargets: 50,
    note: 'Share of his charted targets that were the quarterback\'s FIRST read — the throw the play was designed to produce. The clearest single measure of whether an offence is built around a player.' },
  { key: 'checkdown', label: 'Checkdown Rate', chart: c => c.checkdownRate, unit: '%', minTargets: 50,
    note: 'Share of targets that arrived because the play broke down rather than because it was meant to. High here means volume that is harder to rely on week to week.' },
  { key: 'contested', label: 'Contested Rate', chart: c => c.contestedRate, unit: '%', minTargets: 50,
    note: 'Share of targets thrown into coverage tight enough to be charted as contested.' },
  { key: 'catchable', label: 'Catchable Rate', chart: c => c.catchableRate, unit: '%', minTargets: 50,
    note: 'Share of his targets a charter judged catchable. Low is usually a story about the quarterback, not the receiver.' },
  { key: 'yacShare', label: 'YAC Share', adv: a => { const s = yacShare(a.receiving); return s ? s.share : null; }, unit: '%', minRec: 25,
    note: 'What share of his receiving yards he made AFTER the catch. High is a creator; low is a player his quarterback throws open.' },
  { key: 'yacPerRec', label: 'Yards After Catch', adv: a => a.receiving && a.receiving.yacPerRec, unit: ' /rec', minRec: 25,
    note: 'Yards after the catch per reception — his own contribution, separated from the throw.' },
  { key: 'brokenTackles', label: 'Broken Tackles', adv: a => a.receiving && a.receiving.brokenTackles, unit: '', minRec: 25,
    note: 'Tackles broken as a receiver.' },
  { key: 'dropPct', label: 'Drop Rate', adv: a => a.receiving && a.receiving.dropPct != null ? a.receiving.dropPct * 100 : null,
    unit: '%', lower: true, minRec: 25,
    note: 'Drops per target. Lower is better. Charted by a human, and the standard is not identical across seasons.' },
];

const CHART_METRICS = {
  WR: RECEIVER_CHARTS,
  TE: RECEIVER_CHARTS,
  RB: [
    { key: 'checkdown', label: 'Checkdown Rate', chart: c => c.checkdownRate, unit: '%', minTargets: 30,
      note: 'Share of his targets that arrived because the play broke down. Backs live here, and the ones who do not are being used as real receivers.' },
    { key: 'firstRead', label: 'First-Read Rate', chart: c => c.firstReadRate, unit: '%', minTargets: 30,
      note: 'Share of targets that were the quarterback\'s first read. Rare for a back, and a real signal about how an offence sees him.' },
    { key: 'yacPerAtt', label: 'Yards After Contact', adv: a => a.rushing && a.rushing.yacPerAttempt, unit: ' /att', minAtt: 100,
      note: 'Yards after contact per carry — the back\'s own work, separated from the blocking.' },
    { key: 'ybcPerAtt', label: 'Yards Before Contact', adv: a => a.rushing && a.rushing.ybcPerAttempt, unit: ' /att', minAtt: 100,
      note: 'Yards before contact per carry — mostly the offensive line, and the fairest thing we have to a blocking grade.' },
    { key: 'brokenTackles', label: 'Broken Tackles', adv: a => a.rushing && a.rushing.brokenTackles, unit: '', minAtt: 100,
      note: 'Tackles broken as a runner.' },
    { key: 'yacRec', label: 'Yards After Catch', adv: a => a.receiving && a.receiving.yacPerRec, unit: ' /rec', minRec: 20,
      note: 'Yards after the catch per reception — the receiving half of his job.' },
  ],
  QB: [
    { key: 'pressurePct', label: 'Pressure Rate Faced', adv: a => a.passing && a.passing.pressurePct, unit: '%', lower: true, minAttempts: 200,
      note: 'Share of dropbacks under pressure. As much line and scheme as quarterback, which is the point of showing it beside the rest.' },
    { key: 'pocketTime', label: 'Time in the Pocket', adv: a => a.passing && a.passing.pocketTime, unit: 's', minAttempts: 200,
      note: 'Average seconds before the throw, sack or scramble.' },
    { key: 'onTarget', label: 'On-Target Rate', adv: a => a.passing && a.passing.onTargetPct, unit: '%', minAttempts: 200,
      note: 'Share of throws charted on target — accuracy with his receivers\' hands taken out of it.' },
    { key: 'badThrow', label: 'Bad Throw Rate', adv: a => a.passing && a.passing.badThrowPct, unit: '%', lower: true, minAttempts: 200,
      note: 'Share of throws charted as bad. Lower is better.' },
    { key: 'receiverDrops', label: 'Dropped By Receivers', adv: a => a.passing && a.passing.dropPctByReceivers, unit: '%', lower: true, minAttempts: 200,
      note: 'Share of his throws his own receivers dropped — the part of a completion percentage that was never his fault.' },
  ],
};

let labCharting = null, labAdvstats = null, labContext = null, labRushing = null;
let chartsPromise = null;
function ensureChartData() {
  if (!chartsPromise) {
    chartsPromise = Promise.all([
      loadJSON('/data/charting.json').then(d => (labCharting = d)),
      loadJSON('/data/advstats.json').then(d => (labAdvstats = d)),
      loadJSON('/data/context.json').then(d => (labContext = d)),
      loadJSON('/data/fieldmap.json').then(d => (labFieldmap = d)),
      loadJSON('/data/rushing.json').then(d => (labRushing = d)),
    ]);
  }
  return chartsPromise;
}

// The charted seasons are not the same set as the stats seasons — FTN does not
// go as far back — so the season buttons follow whichever half is showing
// rather than claiming a year the data cannot fill.
function labSeasons() {
  // Combine testing is not a season. A man's forty does not change in
  // September, and offering a year picker over it would imply it might.
  if (labMode === 'athletic') return [];
  // The field map only goes back as far as it has been built, and it states
  // its own seasons — offering a year it cannot fill is an empty board with no
  // reason given, the same rule the charting half follows.
  if (labMode === 'field') {
    return labFieldmap && labFieldmap.meta ? (labFieldmap.meta.seasons || []).map(String) : LAB_SEASONS;
  }
  if (labMode === 'defense') {
    const any = labAdvstats && labAdvstats.defenseByTeam && Object.values(labAdvstats.defenseByTeam)[0];
    return any ? Object.keys(any).sort() : LAB_SEASONS;
  }
  if (labMode !== 'charts') return LAB_SEASONS;
  if (!labCharting || !labCharting.meta) return LAB_SEASONS;
  return (labCharting.meta.seasons || []).map(String);
}

/* ═══════════════════════════════════════════════════════════════════════════
   RUSHING — THREE READINGS OF THE SAME CARRY
   ═══════════════════════════════════════════════════════════════════════════
   Rush yards over expected is the most quoted rushing number and the one most
   likely to be over-read. Next Gen Stats prices the blocking INTO the bar: at
   the handoff it reads the position, speed and direction of all 22 players and
   says what an average back gains from that picture, so beating it is the part
   that was the runner. That is the appeal, and it is real.

   What it is not is repeatable. Measured on 2018-2025, a back's RYOE per
   attempt correlates with his next season at r = 0.22, and the PERCENTAGE form
   — the way it is usually quoted — at 0.09. Yards per carry does better at
   0.29. The distribution is right-skewed and explosion-driven: a handful of
   long runs carry a season.

   So the board publishes three legs and lets them disagree, because that is
   where the information is. 2025 makes the case on its own: Rhamondre Stevenson
   is FIRST in RYOE percentage and 41st of 46 in EPA per carry. He beat the
   tracking expectation by more than anyone in football and his carries were
   still worth less than almost everybody's — the runs came on early downs with
   a lead, where the same yardage is worth less. A board showing either number
   alone names the wrong back. */
const RUSH_METRICS = [
  { key: 'ryoePct', label: 'RYOE %', get: r => r.ryoePct, unit: '%', minAtt: 60,
    note: 'How far above the expectation he ran, as a share of it. The percentage travels across workloads in a way a per-carry figure does not — a 300-carry back and a 150-carry back can be read on the same scale. Repeats year to year at r = 0.09, so it describes the season that happened and forecasts almost nothing.' },
  { key: 'ryoePerAtt', label: 'RYOE per Carry', get: r => r.ryoePerAtt, unit: '', minAtt: 60,
    note: 'The same number in yards rather than as a share. Repeats at r = 0.22 — better than the percentage form and still not a projection.' },
  { key: 'epaPerCarry', label: 'EPA per Carry', get: r => r.epaPerCarry, unit: '', minAtt: 60,
    note: 'What the carries were worth in the situations they happened in. Eight yards on third and six is worth more than eight on first and ten with a lead, and this is the only leg that knows the difference.' },
  { key: 'successRate', label: 'Success Rate', get: r => r.successRate, unit: '%', minAtt: 60,
    note: 'The share of carries with positive EPA. EPA per carry is an average over a skewed distribution and one long touchdown moves it; this asks the same question in a way a single run cannot dominate.' },
  { key: 'ypc', label: 'Yards per Carry', get: r => r.ypc, unit: '', minAtt: 60,
    note: 'The raw check. It knows nothing about blocking or situation, which is exactly why it belongs beside two numbers that claim to.' },
  { key: 'beatRate', label: 'Carries Beating Expectation', get: r => (r.beatRate === null || r.beatRate === undefined ? null : Math.round(r.beatRate * 1000) / 10), unit: '%', minAtt: 60,
    note: 'How often he got more than the picture predicted, rather than how much. A back can lead in RYOE on four long runs while losing this one — it is the consistency half of the same question.' },
  { key: 'expPerAtt', label: 'Expected Yards per Carry', get: r => (r.expYards && r.attempts ? Math.round((r.expYards / r.attempts) * 100) / 100 : null), unit: '', minAtt: 60,
    note: 'The bar itself: what an average back gains from the pictures this one was handed. Read as an environment rather than a skill — it is the closest thing here to a blocking rating, and the team board publishes it beside a second, disagreeing reading.' },
];

const LAB_TABLES = {
  stats: () => LAB_METRICS,
  charts: () => CHART_METRICS,
  athletic: () => ({ QB: ATHLETIC_METRICS, RB: ATHLETIC_METRICS, WR: ATHLETIC_METRICS, TE: ATHLETIC_METRICS }),
  // Team-scoped, so every position resolves to the same board.
  defense: () => ({ QB: DEFENSE_METRICS, RB: DEFENSE_METRICS, WR: DEFENSE_METRICS, TE: DEFENSE_METRICS }),
  field: () => FIELD_METRICS,
  // Backs only. A rushing board offered for receivers is a control that
  // reaches nothing, so the position picker hides in this mode.
  rushing: () => ({ QB: RUSH_METRICS, RB: RUSH_METRICS, WR: RUSH_METRICS, TE: RUSH_METRICS }),
};

function chartRowFor(id, season) {
  const box = labCharting && labCharting.seasons && labCharting.seasons[season];
  return (box && box.players[id]) || null;
}
function advRowFor(id, season) {
  const row = labAdvstats && labAdvstats.players && labAdvstats.players[id];
  return (row && row.seasons && row.seasons[season]) || null;
}

/**
 * The qualifier for a charting board. Same principle as the stats half — a rate
 * off a handful of snaps is noise wearing a number's clothes — but the counts
 * live in different files, so it cannot reuse labQualifies.
 */
function chartQualifies(m, c, a) {
  if (m.minTargets && (!c || (c.chartedTargets || 0) < m.minTargets)) return false;
  if (m.minRec && (!a || !a.receiving || (a.receiving.rec || 0) < m.minRec)) return false;
  if (m.minAtt && (!a || !a.rushing || (a.rushing.attempts || 0) < m.minAtt)) return false;
  if (m.minAttempts && (!a || !a.passing || (a.passing.attempts || 0) < m.minAttempts)) return false;
  return true;
}

function chartQualText(m) {
  const parts = [];
  if (m.minTargets) parts.push(`${m.minTargets}+ charted targets`);
  if (m.minRec) parts.push(`${m.minRec}+ receptions`);
  if (m.minAtt) parts.push(`${m.minAtt}+ carries`);
  if (m.minAttempts) parts.push(`${m.minAttempts}+ pass attempts`);
  return parts.length ? `QUALIFIER: ${parts.join(' · ')}` : '';
}

function chartRows(m) {
  const rows = [];
  for (const p of playersDB) {
    if (p.pos !== labPos) continue;
    const c = chartRowFor(p.id, labSeason);
    const a = advRowFor(p.id, labSeason);
    if (!chartQualifies(m, c, a)) continue;
    const v = m.chart ? (c ? m.chart(c) : null) : (a ? m.adv(a) : null);
    if (typeof v !== 'number' || isNaN(v)) continue;
    rows.push({ id: p.id, name: p.name, team: p.team, value: +v.toFixed(1) });
  }
  return rows;
}


/* ═══════════════════════════════════════════════════════════════════════════
   FIELD MAP — where a player works, and how well he does it there

   Every other board here ranks players on ONE number. This one is a matrix:
   a row per player, a column per zone of the field, coloured by whichever
   metric is selected. That is the only shape that answers "where does he win",
   which a single-column leaderboard cannot.

   THE GRID IS NOT THE SAME SHAPE FOR EVERY POSITION, AND THAT IS MEASURED.
   Quarterbacks carry a real 3x4 spatial map because they fill it: at the
   200-attempt qualifier the median cell holds 8 to 84 throws. Receivers do NOT
   — the deep-middle cell has a MEDIAN OF ONE target and 116 of 132 qualified
   receivers sit under five — so they get two one-dimensional strips, depth and
   side, instead of a grid that would be mostly single throws wearing a
   percentage. See data/fieldmap.json meta.caveats.

   THE COLOUR RAMP WAS VALIDATED, NOT PICKED. Two arms, blue for below the
   position average and red for above it, each a single hue at three
   intensities, with a near-surface neutral at the middle. Checked with the
   dataviz skill's validator against this card surface (#161a23):
   lightness monotone, adjacent dL >= 0.06, single hue (1 degree spread), every
   step >= 2:1 against the card, and the cell ink (#f0efec) >= 4.5:1 on EVERY
   step — which is what caps how bright the ramp may go. Gold was tried first
   and cannot support three steps: it is intrinsically light, so the band
   between "clears the card" and "still takes light ink" is too narrow. Blue
   against red is also the pair the reference recommends, warm against cool.
   ═══════════════════════════════════════════════════════════════════════════ */

const FIELD_COOL = ['#1a4c87', '#205ca5', '#266dc3'];   // below the average
const FIELD_WARM = ['#882c2b', '#a53534', '#c23e3e'];   // above it
const FIELD_NEUTRAL = '#20242e';

let labFieldmap = null;
let labFieldPlayer = null;   // the row whose spatial grid is open, if any

// The zones each position is read on. Passers carry `cells` as well, which is
// what the spatial grid draws; nobody else does.
const FIELD_SHAPES = {
  QB: {
    source: 'passers', total: 'attempts', totalLabel: 'Att',
    groups: [
      { label: 'By depth', keys: ['behind', 'short', 'inter', 'deep'], bag: 'depth',
        labels: { behind: 'Behind LOS', short: 'Short 0-9', inter: 'Inter 10-19', deep: 'Deep 20+' } },
      { label: 'By side', keys: ['left', 'middle', 'right'], bag: 'side',
        labels: { left: 'Left', middle: 'Middle', right: 'Right' } },
    ],
    grid: true,
  },
  RB: {
    source: 'rushers', total: 'carries', totalLabel: 'Att',
    groups: [
      { label: 'By gap', keys: ['left-end', 'left-tackle', 'left-guard', 'middle', 'right-guard', 'right-tackle', 'right-end'], bag: 'gaps',
        labels: { 'left-end': 'LT End', 'left-tackle': 'LT', 'left-guard': 'LG', middle: 'Mid', 'right-guard': 'RG', 'right-tackle': 'RT', 'right-end': 'RT End' } },
      { label: 'By situation', keys: ['goalline', 'shortYardage', 'openField'], bag: 'situations',
        labels: { goalline: 'Goal line', shortYardage: '3rd/4th & short', openField: 'Open field' } },
    ],
    grid: false,
  },
};
FIELD_SHAPES.WR = {
  source: 'receivers', total: 'targets', totalLabel: 'Tgt',
  groups: FIELD_SHAPES.QB.groups,
  grid: false,   // measured: a 3x4 receiver map is mostly cells built on one throw
};
FIELD_SHAPES.TE = FIELD_SHAPES.WR;

// What the colour means. A metric names the field it reads and whether a
// bigger number is a better one — the ramp is about magnitude, but the legend
// has to be able to say which end is good.
const FIELD_PASS_METRICS = [
  { key: 'share', label: 'Share of Throws', field: 'share', unit: '%', always: true,
    note: 'How his attempts are distributed across the field. Always shown: a share is read against the season total, not against the cell.' },
  { key: 'compPct', label: 'Completion %', field: 'compPct', unit: '%', good: 'high',
    note: 'Completion rate in each zone. Deep zones run far lower everywhere — read a quarterback against the column, not against his own short numbers.' },
  { key: 'epa', label: 'EPA per Attempt', field: 'epa', unit: '', good: 'high',
    note: 'Expected points added per throw. This is where deep throws earn their keep: they complete far less often and are worth much more when they land.' },
  { key: 'cpoe', label: 'Completion % Over Expected', field: 'cpoe', unit: '%', good: 'high',
    note: "Completion rate against what the tracking model expected of the throw — accuracy with the difficulty of the attempt taken out." },
  { key: 'ypa', label: 'Yards per Attempt', field: 'ypa', unit: '', good: 'high', note: 'Yards gained per attempt in the zone, catch and run included.' },
  { key: 'success', label: 'Success Rate', field: 'success', unit: '%', good: 'high', note: 'Share of throws that gained enough for the down and distance.' },
];
const FIELD_REC_METRICS = [
  { key: 'share', label: 'Share of Targets', field: 'share', unit: '%', always: true,
    note: 'How his targets are distributed. Always shown — a share is read against his season total rather than the cell.' },
  { key: 'compPct', label: 'Catch Rate', field: 'compPct', unit: '%', good: 'high',
    note: 'Receptions per target in the zone. It falls with depth for everyone, so the column is the comparison.' },
  { key: 'epa', label: 'EPA per Target', field: 'epa', unit: '', good: 'high', note: 'Expected points added per target in the zone.' },
  { key: 'ypa', label: 'Yards per Target', field: 'ypa', unit: '', good: 'high', note: 'Yards per target, catch and run included.' },
  { key: 'success', label: 'Success Rate', field: 'success', unit: '%', good: 'high', note: 'Share of targets that gained enough for the down and distance.' },
];
const FIELD_RUSH_METRICS = [
  { key: 'share', label: 'Share of Carries', field: 'share', unit: '%', always: true,
    note: 'Where his carries go. Always shown — a share is read against his season total.' },
  { key: 'ypc', label: 'Yards per Carry', field: 'ypc', unit: '', good: 'high', note: 'Yards per carry through each gap.' },
  { key: 'success', label: 'Success Rate', field: 'success', unit: '%', good: 'high', note: 'Share of carries that gained enough for the down and distance — the number a yards-per-carry average hides.' },
  { key: 'stuffPct', label: 'Stuffed %', field: 'stuffPct', unit: '%', good: 'low', note: 'Carries stopped at or behind the line. LOWER IS BETTER, so the warm end of this board is the bad end.' },
  { key: 'tenPct', label: '10+ Yard Rate', field: 'tenPct', unit: '%', good: 'high', note: 'Share of carries that broke ten yards.' },
  { key: 'epa', label: 'EPA per Carry', field: 'epa', unit: '', good: 'high', note: 'Expected points added per carry.' },
];
const FIELD_METRICS = {
  QB: FIELD_PASS_METRICS, WR: FIELD_REC_METRICS, TE: FIELD_REC_METRICS, RB: FIELD_RUSH_METRICS,
};

// Why each column carries its own scale, said in terms of the position being
// read. The QB sentence was hardcoded and ran under the running-back board,
// explaining deep throws over a table of gaps.
function fieldScaleReason() {
  if (labPos === 'RB') {
    return 'a goal-line carry gains a fraction of an open-field one for everybody, so a shared scale '
      + 'would rank the situations instead of the backs.';
  }
  if (labPos === 'QB') {
    return 'every passer completes far more short throws than deep ones, so a shared scale would '
      + 'paint the deep column blue and say nothing about who is good at it.';
  }
  return 'catch rate falls with depth for everybody, so a shared scale would rank the zones instead '
    + 'of the players in them.';
}

function fieldQualifier() {
  const q = labFieldmap && labFieldmap.meta && labFieldmap.meta.qualifiers;
  if (!q) return '';
  const key = labPos === 'QB' ? 'passers' : labPos === 'RB' ? 'rushers' : 'receivers';
  return `QUALIFIER: ${q[key]}`;
}

function fieldFooter(n) {
  const cov = labFieldmap && labFieldmap.meta && labFieldmap.meta.coverage;
  return `${n} qualified ${labPos}${n === 1 ? '' : 's'}. `
    + (labPos === 'QB' ? 'Click any row for his field map. ' : 'Click any row for the full profile. ')
    + 'A cell under the sample floor shows a dash: the count is real, the rate would not be. '
    + (cov && cov.locatedPct ? `${cov.locatedPct}% of pass attempts carry a location — throwaways and batted balls are excluded rather than assigned to a zone. ` : '')
    + 'Source: nflverse play-by-play, REG season only.';
}

function fieldSeasonData() {
  if (!labFieldmap || !labFieldmap.seasons) return null;
  return labFieldmap.seasons[labSeason] || null;
}

// Every column the current position is read on, flattened with its group.
function fieldColumns() {
  const shape = FIELD_SHAPES[labPos];
  if (!shape) return [];
  const out = [];
  for (const g of shape.groups) {
    for (const k of g.keys) out.push({ key: `${g.bag}.${k}`, bag: g.bag, cell: k, label: g.labels[k], group: g.label });
  }
  return out;
}

function fieldRows(m) {
  const shape = FIELD_SHAPES[labPos];
  const season = fieldSeasonData();
  if (!shape || !season) return [];
  const bank = season[shape.source] || {};
  const cols = fieldColumns();
  const rows = [];
  for (const p of playersDB) {
    if (p.pos !== labPos) continue;
    const rec = p.gsisId && bank[p.gsisId];
    if (!rec) continue;
    const vals = {};
    for (const c of cols) {
      const cell = (rec[c.bag] || {})[c.cell];
      // A thin cell has a count but no rate. It renders as a dash rather than
      // as a number nobody should act on, and it is NOT treated as a zero —
      // sorting a missing rate to the bottom is the shared sorter's job.
      vals[c.key] = cell ? (cell[m.field] === undefined ? null : cell[m.field]) : null;
      vals[c.key + '.n'] = cell ? cell.n : null;
    }
    rows.push({ id: p.id, name: p.name, team: p.team, total: rec[shape.total], vals, rec });
  }
  return rows;
}

// The diverging scale is per COLUMN, because the columns are not comparable:
// every quarterback completes far more short throws than deep ones, so a scale
// shared across the table would paint the entire deep column blue and say
// nothing about who is good at it.
function fieldScale(rows, colKey) {
  const vals = rows.map(r => r.vals[colKey]).filter(v => typeof v === 'number' && isFinite(v));
  if (vals.length < 4) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  // A robust spread: the 90th percentile of absolute deviation. Using the max
  // lets one outlier compress everybody else into the neutral band.
  const devs = vals.map(v => Math.abs(v - mid)).sort((a, b) => a - b);
  const spread = devs[Math.floor(devs.length * 0.9)] || devs[devs.length - 1] || 1;
  return { mid, spread };
}

function fieldColour(v, scale) {
  if (scale === null || typeof v !== 'number' || !isFinite(v)) return FIELD_NEUTRAL;
  const z = (v - scale.mid) / (scale.spread || 1);
  const step = Math.min(3, Math.round(Math.abs(z) * 2.2));
  if (step === 0) return FIELD_NEUTRAL;
  return (z > 0 ? FIELD_WARM : FIELD_COOL)[step - 1];
}

function fieldFmt(v, m) {
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  const p = m.field === 'epa' ? 2 : m.unit === '%' ? 1 : 2;
  return v.toFixed(p) + (m.unit || '');
}

// The matrix is a real table with real sortable headers, so it inherits the
// shared sorter's rules for free: a missing rate sorts LAST in both directions
// (which is what a thin cell must do — it is unknown, not zero), and ties break
// on a stable key so a re-render cannot reshuffle the rows.
// THE SORT STATE IS PER POSITION, because the column sets are not the same.
// Sorting backs by "Mid" and then switching to receivers left the sorter
// holding `gaps.middle`, which does not exist among a receiver's columns — and
// sortTableRows correctly returns the rows UNSORTED when it cannot find the
// key, so the board silently lost its order instead of falling back to a
// sensible one. A table id per position keeps each one's sort where the reader
// left it and makes the mismatch impossible rather than handled.
function fieldTableId() { return `labField.${labPos}`; }

function fieldDefineTable(cols, m) {
  const defCols = {
    name: { get: r => r.name, type: 'text' },
    team: { get: r => r.team, type: 'text' },
    total: { get: r => r.total, type: 'num', dir: 'desc' },
  };
  for (const c of cols) defCols[c.key] = { get: r => r.vals[c.key], type: 'num', dir: m.good === 'low' ? 'asc' : 'desc' };
  defineTable(fieldTableId(), {
    cols: defCols,
    tie: { get: r => r.name, type: 'text' },
    initial: { key: 'total', dir: 'desc' },
    render: () => renderLabPage(),
  });
}

function labFieldTable(rows, m) {
  const cols = fieldColumns();
  const shape = FIELD_SHAPES[labPos];
  fieldDefineTable(cols, m);
  const tid = fieldTableId();
  const sorted = sortTableRows(fieldTableId(), rows);
  const scales = {};
  for (const c of cols) scales[c.key] = fieldScale(rows, c.key);

  // The group header row: the columns come in two runs that mean different
  // things, and without it "Mid" reads as ambiguous between a gap and a depth.
  //
  // The three leading columns get one empty header EACH rather than a single
  // colspan="3". A colspan cannot be taken apart by CSS, and the phone layout
  // needs to drop the Team column — with a colspan the group labels would
  // shift a column left and sit over the wrong run of data.
  let groupRow = '<tr class="field-group-row">'
    + '<th class="field-lead"></th><th class="field-lead field-team"></th><th class="field-lead"></th>';
  for (const g of shape.groups) groupRow += `<th colspan="${g.keys.length}" class="field-group">${rankEsc(g.label)}</th>`;
  groupRow += '</tr>';

  let head = '<tr>' + sortTh(tid, 'name', 'Player', { cls: 'field-name-col' })
    + sortTh(tid, 'team', 'Team', { cls: 'field-team' })
    + sortTh(tid, 'total', shape.totalLabel, { cls: 'field-total', title: `${shape.totalLabel}, season total` });
  for (const c of cols) head += sortTh(tid, c.key, c.label, { cls: 'field-col', title: `${c.label} — ${m.label}` });
  head += '</tr>';

  let body = '';
  for (const r of sorted) {
    // A quarterback row opens his field map, because that is the thing the
    // table is a way into. Everyone else has no grid, so the row goes where
    // every other board on this page goes.
    body += `<tr class="${labFieldPlayer === r.id ? 'field-open' : ''}" onclick="${shape.grid ? `openFieldGrid('${jsAttr(r.id)}')` : labRowAction(r)}">`
      + `<td class="field-name">${rankEsc(r.name)}</td>`
      + `<td class="field-team">${rankEsc(r.team || '')}</td><td class="field-total">${r.total}</td>`;
    for (const c of cols) {
      const v = r.vals[c.key];
      const n = r.vals[c.key + '.n'];
      const bg = fieldColour(v, scales[c.key]);
      const tip = `${r.name} — ${c.label}: ${fieldFmt(v, m)} on ${n === null ? 'no' : n} ${shape.source === 'rushers' ? 'carries' : shape.source === 'passers' ? 'attempts' : 'targets'}`
        + (v === null && n ? ' (under the sample floor, so no rate is published)' : '');
      body += `<td class="field-cell" style="background:${bg};" data-tip="${rankEsc(tip)}" aria-label="${rankEsc(tip)}">${fieldFmt(v, m)}</td>`;
    }
    body += '</tr>';
  }
  return `<div class="table-scroll"><table class="players-table rank-table field-table"><thead>${groupRow}${head}</thead><tbody>${body}</tbody></table></div>`;
}

// The legend has to say what the colour means, because the ramp encodes
// MAGNITUDE and whether a big number is a good one depends on the metric —
// "stuffed %" is the board where the warm end is the bad end.
function fieldLegend(m) {
  const swatch = (c) => `<span class="field-key" style="background:${c};"></span>`;
  const dir = m.always ? 'more of his work'
    : m.good === 'low' ? 'a HIGHER figure, which on this board is the worse one'
    : 'a higher figure';
  return `<div class="field-legend">`
    + `<span class="field-legend-label">Below the ${labPos} average</span>`
    + FIELD_COOL.slice().reverse().map(swatch).join('') + swatch(FIELD_NEUTRAL) + FIELD_WARM.map(swatch).join('')
    + `<span class="field-legend-label">Above it</span>`
    + `<span class="field-legend-note">Warm is ${rankEsc(dir)}. Each column is scaled on its own, because the columns are not comparable — ${rankEsc(fieldScaleReason())}</span>`
    + `</div>`;
}

// The spatial grid: quarterbacks only, and only because they fill it. Drawn for
// the player whose row is open, so the table stays the way in.
function labFieldGrid(row, m) {
  if (!row || !row.rec || !row.rec.cells) return '';
  const cells = row.rec.cells;
  const bands = [
    { key: 'deep', label: 'Deep 20+' },
    { key: 'inter', label: 'Intermediate 10-19' },
    { key: 'short', label: 'Short 0-9' },
    { key: 'behind', label: 'Behind the line' },
  ];
  const sides = [['left', 'Left'], ['middle', 'Middle'], ['right', 'Right']];
  // The grid is scaled against THIS quarterback's own cells: it answers "where
  // on the field is he best", which is a different question from the table's
  // "who is best in this zone".
  const own = [];
  for (const b of bands) for (const [s] of sides) {
    const c = cells[`${s}-${b.key}`];
    if (c && typeof c[m.field] === 'number') own.push(c[m.field]);
  }
  const scale = own.length >= 4 ? (() => {
    const st = [...own].sort((a, b) => a - b);
    const mid = st.length % 2 ? st[(st.length - 1) / 2] : (st[st.length / 2 - 1] + st[st.length / 2]) / 2;
    const devs = own.map(v => Math.abs(v - mid)).sort((a, b) => a - b);
    return { mid, spread: devs[Math.floor(devs.length * 0.9)] || 1 };
  })() : null;

  let h = `<div class="field-grid-wrap"><div class="field-grid-head">${rankEsc(row.name)} — ${rankEsc(m.label)} by field zone, ${labSeason}`
    + `<button class="field-close" onclick="closeFieldGrid()" aria-label="Close the field map">Close</button></div>`;
  h += `<div class="field-grid" role="img" aria-label="Field map for ${rankEsc(row.name)}">`;
  h += `<div class="field-grid-corner"></div>` + sides.map(([, l]) => `<div class="field-grid-side">${l}</div>`).join('');
  for (const b of bands) {
    h += `<div class="field-grid-band">${b.label}</div>`;
    for (const [s] of sides) {
      const c = cells[`${s}-${b.key}`];
      const v = c && typeof c[m.field] === 'number' ? c[m.field] : null;
      const n = c ? c.n : 0;
      const tip = `${b.label}, ${s} — ${fieldFmt(v, m)} on ${n} attempt${n === 1 ? '' : 's'}`
        + (v === null && n ? ' (under the sample floor)' : '');
      h += `<div class="field-grid-cell" style="background:${fieldColour(v, scale)};" data-tip="${rankEsc(tip)}" aria-label="${rankEsc(tip)}">`
        + `<span class="field-grid-v">${fieldFmt(v, m)}</span><span class="field-grid-n">${n}</span></div>`;
    }
  }
  h += `</div><div class="field-grid-note">The line of scrimmage is at the bottom. Each cell carries the attempt count under the figure; a cell under the sample floor shows a dash rather than a rate built on a handful of throws.</div></div>`;
  return h;
}

function openFieldGrid(id) {
  labFieldPlayer = labFieldPlayer === id ? null : id;
  renderLabPage();
}
function closeFieldGrid() { labFieldPlayer = null; renderLabPage(); }

/* ═══════════════════════════════════════════════════════════════════════════
   WORTH KNOWING — the facts nobody goes looking for

   A leaderboard answers a question you already had. This answers the ones you
   did not, which is the only way the charting layer reaches anybody who was not
   already curious about first-read rate.

   THE RULES THAT KEEP IT HONEST, because a "did you know" strip is exactly
   where a site starts inventing things:

   1. EVERY FACT IS DERIVED, never written. Each finder is a rule over the
      qualified pool, so the strip re-reads itself the moment the data moves —
      which during the season means weekly, with no one editing copy.
   2. A FACT HAS TO CLEAR A BAR TO BE STATED. Each finder carries a threshold,
      and if nothing clears it nothing is shown. "The highest drop rate was
      4.1%" is not a finding, and filling the strip anyway is how a page starts
      lying quietly.
   3. THE INTERESTING ONES ARE GAPS, not extremes. "Most targets" is a fact
      anybody can get. "A hundred targets of which only 44% were the first read"
      is a fact about a role, and it exists nowhere else.
   4. EVERY CARD LINKS TO THE BOARD IT CAME FROM, so a reader can check it
      rather than take it.
   ═══════════════════════════════════════════════════════════════════════════ */

function labFactFinders(season, pos) {
  const box = labCharting && labCharting.seasons && labCharting.seasons[season];
  if (!box) return [];
  const pool = {};
  playersDB.forEach(p => { pool[p.id] = p; });
  const advOf = (id) => {
    const r = labAdvstats && labAdvstats.players && labAdvstats.players[id];
    return (r && r.seasons && r.seasons[season]) || null;
  };
  // Everyone at THIS position, carrying both layers.
  const rows = Object.entries(box.players)
    .map(([id, c]) => ({ id, c, p: pool[id], a: advOf(id) }))
    .filter(x => x.p && x.p.pos === pos);
  // A back may be charted without ever being handed an advanced split, and a
  // quarterback the other way round, so the finders each state what they need.
  const advRows = playersDB.filter(x => x.pos === pos)
    .map(x => ({ id: x.id, p: x, a: advOf(x.id), c: box.players[x.id] }))
    .filter(x => x.a);

  const facts = [];
  const say = (f) => { if (f) facts.push(f); };
  const top = (list, key, dir = -1) => {
    const ranked = list.filter(x => typeof key(x) === 'number' && isFinite(key(x)))
      .sort((a, b) => dir * (key(a) - key(b)));
    return ranked[0];
  };
  const board = (metric) => `lab/charts/${pos.toLowerCase()}/${season}/${metric}`;

  if (pos === 'WR' || pos === 'TE') {
    const charted = rows.filter(x => x.c.chartedTargets >= 60);

    const plan = top(charted, x => x.c.firstReadRate);
    if (plan && plan.c.firstReadRate >= 78) say({
      id: plan.id, tag: 'The plan',
      headline: `${plan.p.name} was the first read on ${plan.c.firstReadRate}% of his targets`,
      detail: `The highest of any qualified ${pos} in ${season}. On ${plan.c.chartedTargets} charted targets, the throw was the one the play was designed to produce.`,
      board: board('firstRead'),
    });

    const hogs = charted.filter(x => x.c.chartedTargets >= 85);
    const notPlan = top(hogs, x => x.c.firstReadRate, 1);
    if (notPlan && notPlan.c.firstReadRate <= 58) say({
      id: notPlan.id, tag: 'Volume, not design',
      headline: `${notPlan.p.name} saw ${notPlan.c.chartedTargets} targets, and only ${notPlan.c.firstReadRate}% were the first read`,
      detail: 'He gets the ball as often as anyone, but usually because the play went somewhere else first. Target share and role are not the same thing.',
      board: board('firstRead'),
    });

    const worstBall = top(charted, x => x.c.catchableRate, 1);
    if (worstBall && worstBall.c.catchableRate <= 64) say({
      id: worstBall.id, tag: 'Not his hands',
      headline: `Only ${worstBall.c.catchableRate}% of the balls thrown at ${worstBall.p.name} were catchable`,
      detail: `The lowest rate of any qualified ${pos} in ${season}. A catch rate read without this is a receiver being blamed for his quarterback.`,
      board: board('catchable'),
    });

    const contested = top(charted, x => x.c.contestedRate);
    if (contested && contested.c.contestedRate >= 26) say({
      id: contested.id, tag: 'Never open',
      headline: `${contested.c.contestedRate}% of ${contested.p.name}'s targets were contested`,
      detail: 'More than a quarter of the balls thrown his way arrived with a defender on him. Volume earned the hard way.',
      board: board('contested'),
    });

    const yacRows = advRows.filter(x => x.a.receiving && x.a.receiving.rec >= 30)
      .map(x => ({ ...x, ys: yacShare(x.a.receiving) })).filter(x => x.ys);
    const creator = top(yacRows, x => x.ys.share);
    if (creator && creator.ys.share >= 68) say({
      id: creator.id, tag: 'His own yards',
      headline: creator.ys.behindLine
        ? `${creator.p.name} caught the ball behind the line of scrimmage on average`
        : `${Math.round(creator.ys.share)}% of ${creator.p.name}'s receiving yards came after the catch`,
      detail: 'He is not being thrown open downfield — he is handed the ball near the line and makes the yards himself.',
      board: board('yacShare'),
    });

    const hands = top(advRows.filter(x => x.a.receiving && x.a.receiving.rec >= 40 && x.a.receiving.dropPct != null),
      x => x.a.receiving.dropPct);
    if (hands && hands.a.receiving.dropPct * 100 >= 6) say({
      id: hands.id, tag: 'Stone hands',
      headline: `${hands.p.name} dropped ${(hands.a.receiving.dropPct * 100).toFixed(1)}% of the balls thrown at him`,
      detail: `${hands.a.receiving.drops} drops on ${hands.a.receiving.targets} targets — the highest rate among qualified ${pos}s. Charted by a human, and the standard moves between seasons.`,
      board: board('dropPct'),
    });
  }

  if (pos === 'RB') {
    const charted = rows.filter(x => x.c.chartedTargets >= 30);

    const valve = top(charted, x => x.c.checkdownRate);
    if (valve && valve.c.checkdownRate >= 45) say({
      id: valve.id, tag: 'The safety valve',
      headline: `${valve.c.checkdownRate}% of ${valve.p.name}'s targets were checkdowns`,
      detail: 'Nearly half the balls thrown to him arrived because the play broke down. Receiving volume built this way is harder to rely on week to week.',
      board: board('checkdown'),
    });

    const realReceiver = top(charted, x => x.c.firstReadRate);
    if (realReceiver && realReceiver.c.firstReadRate >= 30) say({
      id: realReceiver.id, tag: 'A receiver who plays back',
      headline: `${realReceiver.c.firstReadRate}% of ${realReceiver.p.name}'s targets were the quarterback's first read`,
      detail: 'Rare for a back. Most are checked down to; this offence draws plays up to throw him the ball.',
      board: board('firstRead'),
    });

    const ran = advRows.filter(x => x.a.rushing && x.a.rushing.attempts >= 100);
    const allHim = top(ran, x => x.a.rushing.yacPerAttempt);
    if (allHim && allHim.a.rushing.yacPerAttempt >= 2.6) say({
      id: allHim.id, tag: 'All him',
      headline: `${allHim.p.name} made ${allHim.a.rushing.yacPerAttempt} yards a carry AFTER contact`,
      detail: `On ${allHim.a.rushing.attempts} carries. Yards after contact are the back's own — the part of a rushing line the offensive line cannot claim.`,
      board: board('yacPerAtt'),
    });

    const noHelp = top(ran, x => x.a.rushing.ybcPerAttempt, 1);
    if (noHelp && noHelp.a.rushing.ybcPerAttempt <= 2.2) say({
      id: noHelp.id, tag: 'No help',
      headline: `${noHelp.p.name} got only ${noHelp.a.rushing.ybcPerAttempt} yards a carry before contact`,
      detail: 'The least of any qualified back. Yards before contact are mostly blocking, so this is a line problem showing up on a runner\'s stat line.',
      board: board('ybcPerAtt'),
    });

    const broke = top(ran.filter(x => x.a.rushing.brokenTackles != null), x => x.a.rushing.brokenTackles);
    if (broke && broke.a.rushing.brokenTackles >= 15) say({
      id: broke.id, tag: 'Hard to bring down',
      headline: `${broke.p.name} broke ${broke.a.rushing.brokenTackles} tackles as a runner`,
      detail: 'The most of any qualified back — a tackle broken is a yard that existed only because he made it.',
      board: board('brokenTackles'),
    });
  }

  if (pos === 'QB') {
    const passers = advRows.filter(x => x.a.passing && x.a.passing.attempts >= 200);

    const siege = top(passers, x => x.a.passing.pressurePct);
    if (siege && siege.a.passing.pressurePct >= 25) say({
      id: siege.id, tag: 'Under siege',
      headline: `${siege.p.name} was pressured on ${siege.a.passing.pressurePct}% of his dropbacks`,
      detail: 'The most of any qualified quarterback. Pressure is as much line and scheme as it is the man taking the snap, and it shapes everything downstream of him.',
      board: board('pressurePct'),
    });

    const letDown = top(passers.filter(x => x.a.passing.dropPctByReceivers != null), x => x.a.passing.dropPctByReceivers);
    if (letDown && letDown.a.passing.dropPctByReceivers >= 6) say({
      id: letDown.id, tag: 'Not his fault',
      headline: `${letDown.a.passing.dropPctByReceivers}% of ${letDown.p.name}'s throws were dropped by his own receivers`,
      detail: 'The part of a completion percentage that was never his. Read his accuracy without this and you are grading somebody else\'s hands.',
      board: board('receiverDrops'),
    });

    const held = top(passers.filter(x => x.a.passing.pocketTime != null), x => x.a.passing.pocketTime);
    if (held && held.a.passing.pocketTime >= 2.6) say({
      id: held.id, tag: 'Holds it',
      headline: `${held.p.name} held the ball ${held.a.passing.pocketTime} seconds a dropback`,
      detail: 'The longest of any qualified quarterback. Time in the pocket buys deeper throws and costs sacks — it is a style, not a grade.',
      board: board('pocketTime'),
    });

    const accurate = top(passers.filter(x => x.a.passing.onTargetPct != null), x => x.a.passing.onTargetPct);
    if (accurate && accurate.a.passing.onTargetPct >= 78) say({
      id: accurate.id, tag: 'On the money',
      headline: `${accurate.a.passing.onTargetPct}% of ${accurate.p.name}'s throws were on target`,
      detail: 'Accuracy with his receivers\' hands taken out of it — a drop still counts as an on-target throw.',
      board: board('onTarget'),
    });
  }

  // One team fact, chosen for how much it shapes THIS position's job.
  const teams = Object.entries(box.teams).filter(([, v]) => v.dropbacks);
  if (teams.length >= 20) {
    const mean = (k) => teams.reduce((s, [, v]) => s + (v[k] || 0), 0) / teams.length;
    const wanted = pos === 'QB'
      ? [{ key: 'blitzFacedRate', label: 'blitzed', verb: 'faced a blitz on' }, { key: 'playActionRate', label: 'play-action', verb: 'used play-action on' }]
      : pos === 'RB'
        ? [{ key: 'playActionRate', label: 'play-action', verb: 'used play-action on' }, { key: 'rpoRate', label: 'run-pass options', verb: 'used run-pass options on' }]
        : [{ key: 'motionRate', label: 'pre-snap motion', verb: 'used pre-snap motion on' }, { key: 'screenRate', label: 'screens', verb: 'used screens on' }];
    const picks = wanted.map(c => {
      const avg = mean(c.key);
      const t = teams.slice().sort((a, b) => b[1][c.key] - a[1][c.key])[0];
      return { ...c, avg, team: t[0], value: t[1][c.key], edge: t[1][c.key] - avg };
    }).sort((a, b) => b.edge - a.edge);
    const pick = picks[0];
    if (pick && pick.edge >= 5) say({
      team: pick.team, tag: 'Scheme outlier',
      headline: `${pick.team} ${pick.verb} ${pick.value}% of their dropbacks`,
      detail: `The league averaged ${pick.avg.toFixed(1)}%. Nobody leaned on it harder, and it shapes what every ${pos} on that roster is asked to do.`,
      board: `teams/${pick.team.toLowerCase()}`,
    });
  }

  return facts;
}

function labFactsHtml(season, pos) {
  // The stats seasons and the charted seasons are not the same set. Asking for
  // facts about a year FTN never charted returns nothing, so fall back to the
  // most recent charted season and say which one it is.
  const charted = (labCharting && labCharting.meta && labCharting.meta.seasons || []).map(String);
  const use = charted.includes(String(season)) ? String(season) : charted[charted.length - 1];
  if (!use) return '';
  const all = labFactFinders(use, pos);
  season = use;
  // One card per player. Tee Higgins legitimately led both first-read rate and
  // contested rate in 2025, and two cards about the same man reads as a strip
  // with one idea rather than four.
  const seen = new Set();
  const facts = [];
  for (const f of all) {
    const who = f.id || f.team;
    if (who && seen.has(who)) continue;
    if (who) seen.add(who);
    facts.push(f);
  }
  // Nothing clears the bar means nothing is shown. A strip padded out with
  // unremarkable numbers is worse than no strip.
  if (!facts.length) return '';
  const cards = facts.slice(0, 4).map(f => {
    const go = f.id ? `openProfile('${jsAttr(f.id)}')` : `navigate('${jsAttr(f.board)}')`;
    return `<div class="fact-card" onclick="${go}" tabindex="0" role="button"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${go};}">
      <div class="fact-tag">${rankEsc(f.tag)}</div>
      <div class="fact-headline">${rankEsc(f.headline)}</div>
      <div class="fact-detail">${rankEsc(f.detail)}</div>
    </div>`;
  }).join('');
  // Its own section, below the board, with a rule above it. Sitting loose at the
  // top of the page it read as a banner — something to scroll past on the way to
  // the real thing — rather than as a part of the page with its own subject.
  return `<div class="fun-stats">
    <div class="fact-strip-head">
      <span class="lab-title">Fun stats — ${rankEsc(pos)}, ${rankEsc(String(season))}</span>
      <span class="lab-qual">FOUND IN THE DATA, NOT WRITTEN · CHANGES WITH THE POSITION AND THE SEASON</span>
    </div>
    <div class="fact-strip">${cards}</div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ATHLETIC — what he is, before anything he did

   Combine testing, percentiled against every player on record AT THAT POSITION
   rather than against this year's pool. A 4.5 forty is unremarkable for a
   receiver and exceptional for a tight end, and a pool-relative figure would
   move a man's athleticism every time somebody else got cut.

   These boards are the only ones here that are not about a season. They do not
   move week to week and they never will — which is exactly why the numbers on
   them are worth knowing and why they carry no season at all.
   ═══════════════════════════════════════════════════════════════════════════ */

const ATHLETIC_METRICS = [
  { key: 'forty', label: '40-Yard Dash', drill: 'forty', unit: 's', lower: true,
    note: 'Straight-line speed. Lower is faster, so this board ranks up from the quickest.' },
  { key: 'vertical', label: 'Vertical Jump', drill: 'vertical', unit: '"',
    note: 'Lower-body explosion — the closest thing the combine has to a jump-ball proxy.' },
  { key: 'broadJump', label: 'Broad Jump', drill: 'broadJump', unit: '"',
    note: 'Horizontal explosion. Travels better to football than the vertical does.' },
  { key: 'cone', label: '3-Cone Drill', drill: 'cone', unit: 's', lower: true,
    note: 'Change of direction. The test that separates a route runner from a sprinter.' },
  { key: 'shuttle', label: '20-Yard Shuttle', drill: 'shuttle', unit: 's', lower: true,
    note: 'Short-area quickness in both directions.' },
  { key: 'bench', label: 'Bench Press', drill: 'bench', unit: ' reps',
    note: '225lb to failure. Means least of the six for a skill position, and is included because it is measured.' },
];

// Team-level, so it answers to a different filter than the rest of the page.
const DEFENSE_METRICS = [
  { key: 'compPct', label: 'Completion % Allowed', get: d => d.completionPctAllowed, unit: '%', lower: true, minTargets: 200,
    note: 'Share of throws at this defence that were caught. The cleanest single measure of a coverage unit, and lower is better.' },
  { key: 'ypt', label: 'Yards per Target Allowed', get: d => d.yardsPerTargetAllowed, unit: '', lower: true, minTargets: 200,
    note: 'Yards conceded per ball thrown their way — completion rate and depth in one number.' },
  { key: 'yards', label: 'Yards Allowed', get: d => d.yards, unit: '', lower: true, minTargets: 200,
    note: 'Total receiving yards conceded across every charted defender.' },
  { key: 'td', label: 'Touchdowns Allowed', get: d => d.td, unit: '', lower: true, minTargets: 200,
    note: 'Receiving touchdowns conceded. The number fantasy scoring actually turns on.' },
  { key: 'int', label: 'Interceptions', get: d => d.int, unit: '', minTargets: 200,
    note: 'Passes intercepted by the charted defenders.' },
  { key: 'pressures', label: 'Pressures', get: d => d.pressures, unit: '', minTargets: 200,
    note: 'A quarterback under pressure is a different quarterback. This is the front, not the coverage.' },
  { key: 'sacks', label: 'Sacks', get: d => d.sacks, unit: '', minTargets: 200,
    note: 'Sacks by the charted defenders.' },
  { key: 'blitzes', label: 'Blitzes', get: d => d.blitzes, unit: '', minTargets: 200,
    note: 'How often this defence sends extra rushers — scheme rather than personnel.' },
  { key: 'missedTacklePct', label: 'Missed Tackle %', get: d => d.missedTacklePct, unit: '%', lower: true, minTargets: 200,
    note: 'Share of tackle attempts missed. A high number is yards after contact waiting to happen.' },
];

function athleticRows(m) {
  if (!labContext || !labContext.combine) return [];
  const rows = [];
  for (const p of playersDB) {
    if (p.pos !== labPos) continue;
    const c = labContext.combine[p.id];
    const d = c && c.drills && c.drills[m.drill];
    if (!d || typeof d.value !== 'number') continue;
    rows.push({ id: p.id, name: p.name, team: p.team, value: d.value, pct: d.percentileAtPosition });
  }
  return rows;
}

function defenseRows(m) {
  if (!labAdvstats || !labAdvstats.defenseByTeam) return [];
  const rows = [];
  for (const [team, seasons] of Object.entries(labAdvstats.defenseByTeam)) {
    const d = seasons[labSeason];
    if (!d) continue;
    // The same discipline as every other board: a rate off a thin sample is
    // noise, and a defence with 200 charted targets is barely a season.
    if (m.minTargets && (d.targets || 0) < m.minTargets) continue;
    const v = m.get(d);
    if (typeof v !== 'number' || isNaN(v)) continue;
    // name and team are rendered as separate columns, so a defence row that set
    // both to the abbreviation printed "PHI PHI". The team IS the subject here.
    rows.push({ id: null, name: team, team: '', teamLink: team, value: v });
  }
  return rows;
}

// What each half is built from, in one place. This was four separate ternaries
// scattered through the renderer, and adding a third mode would have meant
// finding all of them.
function labQualFor(m) {
  if (labMode === 'charts') return chartQualText(m);
  if (labMode === 'rushing') return `QUALIFIER: ${m.minAtt || 60}+ carries — below that a season is a handful of runs and this metric is mostly one of them`;
  if (labMode === 'athletic') return 'QUALIFIER: PERCENTILES ARE AGAINST EVERY PLAYER ON RECORD AT THIS POSITION';
  if (labMode === 'defense') return m.minTargets ? `QUALIFIER: ${m.minTargets}+ charted targets faced` : '';
  return labQualText(m);
}

function labSourceText(m) {
  if (labMode === 'charts') return `${chartQualText(m)} · ${m.chart ? 'FTN charting' : 'Pro Football Reference'}`;
  if (labMode === 'rushing') return 'Next Gen Stats player tracking (the expectation) and nflverse play-by-play (EPA) · joined on the GSIS id';
  if (labMode === 'athletic') return 'NFL Scouting Combine via nflverse · percentiles against every tested player at the position';
  if (labMode === 'defense') return 'Pro Football Reference advanced defensive splits, aggregated across every charted defender';
  return `${labQualText(m)} · nflverse${m.ngs ? ' · NFL Next Gen Stats' : ''}`;
}

function labFooterText(m, n) {
  if (labMode === 'athletic') {
    return `Top ${n} ${labPos}s in the pool by this test. Click any player for the full profile. `
      + 'Combine testing is not a season — these numbers do not move, and not every player tested. '
      + 'Source: NFL Scouting Combine via nflverse.';
  }
  if (labMode === 'defense') {
    return `All ${n} defences that clear the qualifier. Aggregated across every charted defender on the team, `
      + 'with rates recomputed from totals rather than averaged across players — a nickel corner\'s twelve targets '
      + 'must not weigh the same as a number one corner\'s season. Source: Pro Football Reference advanced splits.';
  }
  const src = labMode === 'charts'
    ? (m.chart ? 'FTN play-by-play charting' : 'Pro Football Reference advanced splits')
    : `nflverse${m.ngs ? ' · NFL Next Gen Stats' : ''}`;
  return `Top ${n} of the ${labPos} pool. Click any player for the full profile. Source: ${src} · REG season only.`;
}

// The Film Room advertised itself in the nav and then said "coming soon" —
// while a film breakdown sat on the home page the whole time, tagged for this
// section. The articles carry a `tag`, so the page can simply ask for its own
// rather than being a dead end in a nine-item nav.
// FILM LIVES INSIDE DRAFT LAB NOW. It had a nav item, a page and a route while
// holding one article; a section is worth a top-level slot when it has enough
// in it to be worth navigating to, and this did not. Both are scouting, so they
// share a page and a switch.
let draftView = 'model';
function setDraftView(view, el) {
  draftView = view;
  document.querySelectorAll('#draftViewToggle .pos-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  const model = document.getElementById('draftModel');
  const film = document.getElementById('draftFilm');
  if (model) model.style.display = view === 'model' ? '' : 'none';
  if (film) film.style.display = view === 'film' ? '' : 'none';
  if (view === 'film') renderFilmPage();
  setRoute(view === 'film' ? 'draft/film' : 'draft');
}

function renderFilmPage() {
  const host = document.getElementById('draftFilm');
  if (!host) return;
  const mine = Object.values(articlesDB)
    .filter(a => a.tag === 'Film Room' && a.status !== 'draft')
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (!mine.length) {
    // An honest empty state names what would appear here, rather than promising
    // a date nobody has committed to.
    host.innerHTML = `<div class="medical-card"><div class="medical-detail">`
      + `No film breakdowns are published yet. They appear here as they are written, and on the home page alongside the rest of the writing.`
      + `</div></div>`;
    return;
  }
  host.innerHTML = mine.map(a => `<a class="film-card" href="/article/${jsAttr(a.slug)}" onclick="event.preventDefault();navigate('article/${jsAttr(a.slug)}')">`
    + `<div class="film-card-tag">${rankEsc(a.tag)}</div>`
    + `<h3 class="film-card-title">${rankEsc(a.title)}</h3>`
    + `<div class="film-card-meta">${rankEsc(a.author || '')}${a.readTime ? ` &middot; ${rankEsc(a.readTime)}` : ''}${a.date ? ` &middot; ${rankEsc(a.date)}` : ''}</div>`
    + `</a>`).join('');
}

function renderLabPage() {
  const board = document.getElementById('labBoard');
  if (!board || !playersDB.length) return;

  // The charting files are only needed by the Charts half, so a reader who
  // never leaves the production boards never pays for them.
  if ((labMode === 'charts' || labMode === 'athletic' || labMode === 'defense' || labMode === 'field') && !labCharting) {
    board.innerHTML = `<div class="medical-card"><div class="medical-detail">Loading the charting…</div></div>`;
    // Same guard, same reason: loadJSON SWALLOWS a failed fetch and resolves
    // with null, so re-rendering on anything other than "the data arrived"
    // spins this branch forever the first time the network drops. Empty beats
    // wrong and a stated failure beats a spinner that never stops.
    ensureChartData().then(() => {
      if (labCharting) renderLabPage();
      else board.innerHTML = `<div class="medical-card"><div class="medical-detail">The charting data could not be loaded. Nothing is shown rather than a board built from part of it.</div></div>`;
    });
    return;
  }

  // The mode switch. Stats is production — what happened. Charts is how it
  // happened, out of the two layers a box score cannot produce.
  const modeRow = document.getElementById('labModeToggle');
  if (modeRow) {
    modeRow.innerHTML = [['stats', 'Stats'], ['charts', 'Charts'], ['field', 'Field Map'], ['rushing', 'Rushing'], ['athletic', 'Athletic'], ['defense', 'Defense']].map(([k, label]) =>
      `<button class="pos-btn${labMode === k ? ' active' : ''}" onclick="setLabMode('${k}')">${label}</button>`).join('');
  }

  // Season buttons follow whichever half is showing: FTN does not chart as far
  // back as the box scores go, and offering a year the data cannot fill is a
  // board that renders empty for no stated reason.
  const seasons = labSeasons();
  if (seasons.length && (!labSeason || !seasons.includes(labSeason))) labSeason = seasons[seasons.length - 1];
  const seasonRow = document.getElementById('labSeasonFilter');
  if (seasonRow) {
    seasonRow.innerHTML = seasons.map(y =>
      `<button class="pos-btn${y === labSeason ? ' active' : ''}" onclick="setLabSeason('${y}', this)">${y}</button>`).join('');
  }
  // A control that applies to nothing is worse than a missing one — it invites
  // a click that changes nothing. Athletic has no season; Defense is by team,
  // so a position picker means nothing there.
  const seasonGroup = seasonRow && seasonRow.closest('.lab-control');
  if (seasonGroup) seasonGroup.style.display = seasons.length ? '' : 'none';
  const posGroup = document.getElementById('labPosFilter');
  const posWrap = posGroup && posGroup.closest('.lab-control');
  if (posWrap) posWrap.style.display = (labMode === 'defense' || labMode === 'rushing') ? 'none' : '';
  // The Field Map is a matrix and has no second rendering — there is no bar
  // chart to switch to and no plainer table underneath, because the table IS
  // the chart. Left on screen the Chart/Table pair invites a click that changes
  // nothing, which is the same mistake the Teams division picker and the
  // Defence position picker each made once.
  const viewGroup = document.getElementById('labViewToggle');
  const viewWrap = viewGroup && viewGroup.closest('.lab-control');
  if (viewWrap) viewWrap.style.display = labMode === 'field' ? 'none' : '';

  const metrics = (LAB_TABLES[labMode] || LAB_TABLES.stats)()[labPos] || [];
  if (!labMetricKey || !metrics.some(m => m.key === labMetricKey)) labMetricKey = metrics[0] && metrics[0].key;
  // Keep the address bar pointing at exactly this board, so it can be shared.
  // Athletic has no season, so the address must not carry one — a URL that
  // names a year the board does not have is a link that lies about itself.
  // Each half writes only the segments it actually has. Athletic has no season
  // and Defence has no position, and a URL naming a dimension the board does not
  // carry is a link that lies about itself — and, worse, one the parser then
  // misreads on the way back in.
  setRoute(labMode === 'athletic' ? `lab/athletic/${labPos.toLowerCase()}/${labMetricKey}`
    : labMode === 'defense' ? `lab/defense/${labSeason}/${labMetricKey}`
    : `lab/${labMode}/${labPos.toLowerCase()}/${labSeason}/${labMetricKey}`);
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

  // THE FIELD MAP IS A MATRIX, NOT A LEADERBOARD, so it leaves before the row
  // machinery below. Every other board reduces a player to one number and ranks
  // on it; this one is a row per player and a column per zone, and there is no
  // single value to sort, export as a bar chart, or scatter.
  if (labMode === 'field') {
    const frows = fieldRows(m);
    let fh = `<div class="lab-head"><span class="lab-title">${rankEsc(`${m.label} by field zone — ${labPos}, ${labSeason}`)}</span>`
      + `<span class="lab-qual">${rankEsc(fieldQualifier())}</span></div>`;
    fh += `<div class="lab-sub">${rankEsc(m.note)}</div>`;
    if (!frows.length) {
      fh += `<div class="medical-card"><div class="medical-detail">No ${labPos} in the pool clears the field-map qualifier for ${labSeason}. `
        + `Nothing is shown rather than a map built on part of a season.</div></div>`;
    } else {
      fh += fieldLegend(m);
      const open = labFieldPlayer && frows.find(r => r.id === labFieldPlayer);
      if (open) fh += labFieldGrid(open, m);
      fh += labFieldTable(frows, m);
      fh += `<div class="rank-note">${rankEsc(fieldFooter(frows.length))}</div>`;
    }
    board.innerHTML = fh;
    // The scatter belongs to the Stats half. Leaving the previous board's chart
    // under a matrix would sit an unrelated plot beneath it.
    const sc = document.getElementById('labScatter');
    if (sc) sc.innerHTML = '';
    return;
  }

  const valueOf = m.ngs ? ((s, n) => m.ngs(n)) : ((s) => m.stat(s));
  const rowsFor = { charts: () => chartRows(m), athletic: () => athleticRows(m), defense: () => defenseRows(m), rushing: () => rushRows(m) };
  const rows = (rowsFor[labMode] ? rowsFor[labMode]() : labRows(valueOf, m))
    .sort((a, b) => m.lower ? a.value - b.value : b.value - a.value)
    .slice(0, labMode === 'defense' ? 32 : 20);

  // Athletic has no season and Defense has no position, so a title built from
  // both would claim two things the board does not have.
  const boardTitle = labMode === 'athletic' ? `${m.label} — ${labPos}, all-time`
    : labMode === 'defense' ? `${m.label} — team defence, ${labSeason}`
    : labMode === 'rushing' ? `${m.label} — RB, ${labSeason}`
    : `${m.label} — ${labPos}, ${labSeason}`;
  labExportBoard = rows.length ? {
    title: boardTitle,
    subtitle: m.note,
    source: labSourceText(m),
    unit: m.unit,
    mode: rows.length && Math.min(...rows.map(r => r.value)) >= 0
      && (Math.max(...rows.map(r => r.value)) - Math.min(...rows.map(r => r.value))) / Math.max(...rows.map(r => r.value)) < 0.35
      ? 'dots' : 'bars',
    rows: rows.map((r, i) => ({ rank: i + 1, name: r.name, team: r.team, value: r.value }))
  } : null;

  let h = `<div class="lab-head"><span class="lab-title">${rankEsc(boardTitle)}</span>`
    + `<span class="lab-qual">${rankEsc(labQualFor(m))}${m.lower ? ' · LOWER RANKS FIRST' : ''}`
    + (rows.length ? ` <button class="export-btn" onclick="runExport(() => exportRowChart(labExportBoard), labExportBoard.title, this)">Export PNG</button>` : '')
    + `</span></div>`;
  h += `<div class="lab-sub">${rankEsc(m.note)}</div>`;
  if (!rows.length) {
    h += `<div class="medical-card"><div class="medical-detail">No player in the pool clears this board's qualifier for ${labSeason}. Nothing is shown rather than ranking on partial seasons.</div></div>`;
  } else {
    h += labView === 'chart' ? labBarBoard(rows, m) : labTable(rows, m);
    h += `<div class="rank-note">${rankEsc(labFooterText(m, rows.length))}</div>`;
    if (labMode === 'rushing') h += rushDisagreement();
  }
  // The findings render in BOTH halves. They were behind the Charts toggle,
  // which defaults off — so a reader landing on /lab saw no fun stats at all,
  // and the section might as well not have existed. They are about the POSITION
  // and the SEASON, not about which board happens to be on screen, so the mode
  // was never the right thing to gate them on. The charting files are fetched
  // for them either way.
  // Not on the Defence board: the findings are about players at a position, and
  // under a table of team defences they answer a question nobody asked.
  // THE GUARD IS "THE DATA IS STILL MISSING", NEVER "THE PAGE IS STILL OPEN".
  // These are two decisions and folding them into one condition froze the tab:
  // on the Defence board labCharting IS loaded, but the mode test made the
  // first branch false, so the else re-fetched — got the cached, already
  // resolved promise back — and re-rendered itself forever. Whether to FETCH
  // depends only on whether the data is here; whether to SHOW the findings
  // depends only on the mode.
  if (!labCharting) ensureChartData().then(() => { if (labCharting) renderLabPage(); });
  else if (labMode !== 'defense') h += labFactsHtml(labSeason, labPos);
  board.innerHTML = h;

  // ---- Scatter ----
  // Built from production stats, so it belongs to the Stats half only. Leaving
  // it under a charting board would sit an unrelated chart beneath the table
  // and imply the two are about the same thing.
  const spec = labMode === 'stats' ? LAB_SCATTER[labPos] : null;
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
let envData = null, envPromise = null;
let teamsPromise = null;
// Scheme is 216KB and only the Teams page reads it, so it is fetched when that
// page opens and never on first paint.
let schemePromise = null, schemeData = null, callerData = null, schemeCharting = null;
function ensureScheme() {
  if (!schemePromise) {
    schemePromise = Promise.all([
      loadJSON('/data/scheme.json').then(d => (schemeData = d)),
      // Small, hand-kept, and allowed to be absent or half-filled. An unknown
      // play-caller shows the head coach alone rather than a guess.
      loadJSON('/data/playcallers.json').then(d => (callerData = d)).catch(() => null),
      // How the offence throws, beside what personnel it lines up in. Same page,
      // same question, so it rides on the same fetch.
      loadJSON('/data/charting.json').then(d => (schemeCharting = d)).catch(() => null),
    ]);
  }
  return schemePromise;
}

// The play-caller is the more predictive of the two: a coordinator change moves
// scheme more reliably than a head-coach change, and plenty of head coaches do
// not call it. Returns null when nobody has filled the row in.
function playCaller(team, season) {
  const e = callerData && callerData.entries && callerData.entries[`${season}|${team}`];
  return e && e.playCaller ? e : null;
}

function ensureEnvironment() {
  // Unconditional assignment latches: loadJSON resolves with null on a failed
  // fetch, so a guard on envData being falsy would be true again on the second
  // pass and re-enter the render that scheduled it.
  if (!envPromise) envPromise = loadJSON('/data/environment.json').then(d => { envData = d || {}; });
  return envPromise;
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

// The Teams page answers two different questions and they were sharing one
// scroll: what is this team, and what is happening across the league. Putting
// the league board on top buried the team the reader actually clicked, so the
// two are tabs now, each with its own URL.
let teamsView = 'team';   // 'team' | 'league'

function setTeamsView(view) {
  teamsView = view;
  setRoute(view === 'league' ? 'teams/league' : 'teams/' + String(currentTeam || '').toLowerCase());
  renderTeamPage();
}

function setTeam(abbr) {
  currentTeam = abbr;
  teamsView = 'team';
  setRoute('teams/' + abbr.toLowerCase());
  renderTeamPage();
}

function teamsTabsHtml() {
  const tab = (view, label, note) => `<button class="pos-btn${teamsView === view ? ' active' : ''}" onclick="setTeamsView('${view}')" title="${rankEsc(note)}">${label}</button>`;
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
    ${tab('team', 'By team', 'One team: who gets the ball, how they line up, what their defence plays, and the schedule')}
    ${tab('league', 'Across the league', 'All 32 ranked, and the biggest identity shifts of the season')}
  </div>`;
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

// A labelled break between the three questions this page answers. Without them
// the team view is one long scroll of cards and the reader has to work out
// where target share stops and scheme begins.
function teamSectionLabel(title, sub) {
  return `<div style="margin:26px 0 12px;">
    <div style="font-family:var(--serif);font-size:19px;font-weight:700;">${rankEsc(title)}</div>
    <div style="font-family:var(--mono);font-size:9.5px;letter-spacing:1.2px;text-transform:uppercase;color:var(--text-muted);margin-top:3px;">${rankEsc(sub)}</div>
  </div>`;
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

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT THIS TEAM HANDS A SKILL PLAYER
   ═══════════════════════════════════════════════════════════════════════════
   Every other card on a team page describes what the team DID. This one
   describes what it gave the people doing it, and its whole design problem is
   that the two available readings of a line disagree.

   Next Gen Stats prices the blocking into an EXPECTED yards figure computed at
   the handoff from all 22 players. Pro Football Reference charts YARDS BEFORE
   CONTACT by watching the play. Measured across 238 team-seasons they agree at
   r = 0.32 — so both ranks are printed, side by side, and the gap between them
   is a third number rather than something averaged away. In 2025 Miami is 1st
   by tracking and 28th by charting; a single "O-line score" would have split
   the difference and told the reader nothing about why. */
function environmentCard(team) {
  const env = envData && envData.seasons;
  if (!env) return '';
  const years = Object.keys(env).sort();
  const year = years[years.length - 1];
  const row = year && env[year] && env[year][team];
  if (!row) return '';

  const m = envData.meta || {};
  const measured = m.measured || {};
  const rank = (n) => (typeof n === 'number' ? ordinalWord(n) : '—');
  const val = (v, unit) => (typeof v === 'number' ? v + (unit || '') : '—');

  // The two readings, and how far apart they put this line.
  const gap = row.run.rankGap;
  const gapNote = gap === null ? ''
    : gap >= 10
      ? `The two disagree sharply here — ${gap} places apart. Tracking reads the picture at the handoff; charting reads how far he got before anyone touched him, and a line can be good at one and not the other.`
      : gap <= 3 ? 'The two readings agree closely here.' : '';

  // THE MEASUREMENT IS LAST SEASON AND THE READER IS LOOKING AT THIS ONE. Next
  // Gen Stats and Pro Football Reference publish nothing for a season nobody
  // has played, so everything here describes the year that finished — and a
  // line is five men who may not all still be there. Saying "from 2025" in a
  // subtitle was not enough: the card sat on a team page and read as current.
  const cont = row.continuity;
  let h = teamSectionLabel(`What they handed a runner in ${year}`,
    `Two independent readings of the same line. They agree at r = ${measured.vendorAgreement ?? '—'} across ${measured.vendorAgreementPairs ?? '—'} team-seasons, so both are shown.`);

  h += `<div class="medical-card" style="padding:18px;margin-bottom:14px;">
    <div class="env-grid">
      <div class="env-cell">
        <div class="env-label">Expected yards per carry</div>
        <div class="env-value">${val(row.run.expPerAtt)}</div>
        <div class="env-rank">${rank(row.run.expRank)} in the league</div>
        <div class="env-note">What an average back gains from the pictures this line created, from player tracking at the handoff. The half that repeats: r = ${measured.expectationPersistence ?? '—'} year over year.</div>
      </div>
      <div class="env-cell">
        <div class="env-label">Yards before contact</div>
        <div class="env-value">${val(row.run.ybcPerAtt)}</div>
        <div class="env-rank">${rank(row.run.ybcRank)} in the league</div>
        <div class="env-note">How far a carry got before anyone touched him, charted by Pro Football Reference. Cruder, and it splits the line from the back at the point of contact.</div>
      </div>
      <div class="env-cell">
        <div class="env-label">Pressure faced</div>
        <div class="env-value">${val(row.pass.pressurePct, '%')}</div>
        <div class="env-rank">${rank(row.pass.pressureRank)} fewest</div>
        <div class="env-note">Share of dropbacks under duress${row.pass.pocketTime ? `, with ${row.pass.pocketTime}s in the pocket` : ''}. Not the line alone — a quarterback who holds the ball makes some of it.</div>
      </div>
    </div>`;

  if (gapNote) h += `<div class="season-state" style="margin-top:14px;"><span class="season-state-tag">${gap >= 10 ? 'They disagree' : 'They agree'}</span><span>${rankEsc(gapNote)}</span></div>`;

  // HOW MUCH OF THAT LINE STILL EXISTS. The published depth chart names a
  // starter at each of the five spots before a snap is taken, so this is a fact
  // rather than a projection — and it is the difference between the numbers
  // above describing this team and describing a team that has left.
  if (cont) {
    const gone = cont.of - cont.returning;
    h += `<div class="season-state" style="margin-top:10px;"><span class="season-state-tag">${cont.to}</span>`
      + `<span>${rankEsc(`${cont.returning} of ${cont.of} starters on that line are still listed first at their spot for ${cont.to}`)}`
      + (gone ? rankEsc(`, and ${gone === 1 ? 'one is not' : `${gone} are not`}. Read the figures above as ${gone >= 2 ? 'a different line' : 'that line minus a man'}.`)
              : rankEsc('. The unit measured above is the unit lining up.'))
      + `</span></div>`;
  }

  const sc = row.scheme;
  if (sc) {
    h += `<div class="env-scheme">`
      + [['EPA per play', sc.epaPerPlay], ['Pass rate', sc.passRate === null ? null : sc.passRate + '%'],
         ['Defenders in the box', sc.boxAvg], ['Explosive rate', sc.explosiveRate === null ? null : sc.explosiveRate + '%']]
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `<span><b>${rankEsc(String(v))}</b> ${rankEsc(k.toLowerCase())}</span>`).join('')
      + `</div>`;
  }
  if (row.caller) {
    const c = row.caller;
    // The play-caller is hand-kept and often blank. A blank row is honest: the
    // page falls back to the head coach rather than guessing who calls it.
    // Named for the season he is actually in charge of. This card showed Mike
    // McDaniel on Miami's page a year after he left, because the coach was
    // being read from the same season as the measurements.
    const cs = row.callerSeason;
    const when = cs ? `${cs}: ` : '';
    const who = c.playCaller
      ? `${when}${c.playCaller} calls the plays${c.callerIsHeadCoach ? ', and is the head coach' : c.headCoach ? ` for ${c.headCoach}` : ''}`
      : c.headCoach ? `${when}${c.headCoach} is the head coach; who calls the plays is not recorded` : '';
    if (who) h += `<div class="env-caller">${rankEsc(who)}${c.source ? ` · ${rankEsc(c.source)}` : ''}</div>`;
  }

  h += caveatHtml(m.caveats).replace(/class="caveat-p"/g, 'class="caveat-p env-caveat"');
  h += `</div>`;
  return h;
}

function renderTeamPage() {
  const body = document.getElementById('teamBody');
  if (!body) return;
  if (!teamsData) { body.innerHTML = `<div class="medical-card"><div class="medical-detail">Loading teams…</div></div>`; return; }
  if (!currentTeam || !teamsData.teams[currentTeam]) currentTeam = Object.keys(teamsData.teams).sort()[0];

  const tabsEl = document.getElementById('teamsTabs');
  if (tabsEl) tabsEl.innerHTML = teamsTabsHtml();

  const introEl = document.getElementById('teamsIntro');
  const picker = document.getElementById('teamPicker');
  if (teamsView === 'league') {
    // The standing intro describes one team's page; leaving it up over a
    // league board describes something the reader is not looking at.
    if (introEl) introEl.textContent = 'All 32 offences side by side — personnel, the box each grouping draws, explosive rate and efficiency — and the biggest identity shifts of the season.';
    // The picker is a team control; showing it above a league board invites a
    // click that changes nothing on screen.
    if (picker) picker.innerHTML = '';
    body.innerHTML = schemeLeagueHtml() || `<div class="medical-card"><div class="medical-detail">Loading the league…</div></div>`;
    return;
  }
  renderTeamPicker();

  const t = teamsData.teams[currentTeam];
  const m = teamsData.meta;
  if (introEl) introEl.textContent = m.note;

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

  h += teamSectionLabel('Who gets the ball', `Volume as it was actually distributed in ${m.statsSeason}`);
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
  const scheme = schemeHtml(currentTeam);
  if (!envData) ensureEnvironment().then(() => { if (currentTeam) renderTeamPage(); });
  h = h
    + environmentCard(currentTeam)
    + (scheme ? teamSectionLabel('How they line up', 'Personnel, what it draws from the defence, and what their own defence plays') + scheme : '')
    + teamSectionLabel('The season ahead', 'Every week, shaded by what that defence conceded to the position you pick');

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

  // 147 words in one paragraph, covering what is shown, why the comparison is
  // built the way it is, where the ADP comes from, and how to read the edge.
  // Four things, so four blocks — and the two that are derivation rather than
  // instruction sit behind a disclosure, the same treatment the Rankings
  // methodology gets.
  const upfront = [
    `Showing ${shown.length} of ${total} ranked players with an ADP.`,
    `The edge is a disagreement, not a projection: it says where these ranks differ from the room, `
    + `never who is right. Pick is the average draft slot, for knowing when he actually goes.`,
  ];
  const deeper = [
    `Both sides are positional ranks — his rank here against his rank among players at his position `
    + `by ADP — because that is the same scale on both sides and it is how a drafter argues. `
    + `Comparing an overall rank to a pick number does not work: these ranks cover ${total} players `
    + `and the ADP board covers ${vbAdp.players.length}, so anyone deep in the shorter list looks `
    + `like a bargain automatically.`,
    `ADP is ${m.source}'s consensus over `
    + `${m.totalDrafts ? m.totalDrafts.toLocaleString() : 'thousands of'} ${m.format} ${m.teams}-team `
    + `mock drafts since ${m.windowStart || 'recently'} — one site's rooms, not the whole market, and `
    + `mock drafters are not your league. A player needs ${m.minDrafts}+ drafts to appear.`,
  ];
  noteEl.innerHTML = caveatHtml(upfront)
    + `<details class="rank-method"><summary>How the comparison is built</summary>`
    + caveatHtml(deeper) + `</details>`;
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
    renderInjuryToday();
    renderBodyMap();
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
  if (page === 'season') renderSeasonPage();
  if (page === 'draft') setDraftView(draftView, document.querySelector('#draftViewToggle .pos-btn.active'));
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
// Six columns over 350 rows, and until now the only way through them was a
// search box. Every column sorts and the two categorical ones filter; the
// count line states how many of the pool survived, because a filtered table
// that does not say so reads as a short database rather than a narrow view.
//
// Fantasy rank is the column that made the nulls-last rule non-negotiable:
// 258 of the 350 have no fRank, so a naive ascending sort opens on 258 dashes
// and buries RB1 below the fold.
let currentPosFilter = 'all';
let playerSearch = '';
const playerFilters = { team: 'all', status: 'all' };

defineTable('players', {
  cols: {
    name:   { get: p => p.name, type: 'text' },
    pos:    { get: p => p.pos, type: 'text' },
    team:   { get: p => p.team, type: 'text' },
    age:    { get: p => p.age, type: 'num', dir: 'asc' },
    // Sorting by status surfaces the hurt first — an alphabetical status
    // column opens on "Doubtful" and means nothing.
    status: { get: p => statusRank(p), type: 'num', dir: 'desc' },
    // Positional rank, so the numbers repeat across positions. Ties break on
    // the position rather than the name: QB1, RB1, TE1, WR1, then QB2.
    frank:  { get: p => fRankValue(p.fRank), type: 'num', dir: 'asc',
              tie: { get: p => fRankPos(p.fRank), type: 'text' } },
  },
  tie: { get: p => p.name, type: 'text' },
  render: () => renderPlayersTable(),
});

function playerRows() {
  let rows = playersDB;
  if (currentPosFilter !== 'all') rows = rows.filter(p => p.pos === currentPosFilter);
  if (playerFilters.team !== 'all') rows = rows.filter(p => p.team === playerFilters.team);
  if (playerFilters.status !== 'all') rows = rows.filter(p => statusBase(p.status) === playerFilters.status);
  if (playerSearch) {
    const q = playerSearch.toLowerCase();
    rows = rows.filter(p => (p.name + ' ' + p.team + ' ' + p.pos).toLowerCase().includes(q));
  }
  return sortTableRows('players', rows);
}

// The options come from the pool, never from a hardcoded list — a team that
// leaves the data should leave the dropdown with it.
function fillPlayerFilterOptions() {
  const teamSel = document.getElementById('playerTeamFilter');
  const statusSel = document.getElementById('playerStatusFilter');
  if (!teamSel || !statusSel || !playersDB.length) return;
  if (teamSel.options.length && statusSel.options.length) return;

  const teams = [...new Set(playersDB.map(p => p.team).filter(Boolean))].sort();
  teamSel.innerHTML = `<option value="all">All teams</option>`
    + teams.map(t => `<option value="${rankEsc(t)}">${rankEsc(t)}</option>`).join('');

  // Grouped by the vocabulary word, not the full string: the body part in the
  // parenthesis makes 30 distinct statuses out of 5 real ones, and a filter
  // with 30 options is a list, not a filter.
  const counts = {};
  playersDB.forEach(p => { const b = statusBase(p.status); if (b) counts[b] = (counts[b] || 0) + 1; });
  const words = Object.keys(counts).sort((a, b) => statusRank({ status: a, statusClass: statusClassOf(a) })
    - statusRank({ status: b, statusClass: statusClassOf(b) }));
  statusSel.innerHTML = `<option value="all">Any status</option>`
    + words.map(w => `<option value="${rankEsc(w)}">${rankEsc(w)} (${counts[w]})</option>`).join('');
}

// The class a status word carries in the pool, read off the data rather than
// duplicating scripts/lib/status.js on the client.
function statusClassOf(word) {
  const hit = playersDB.find(p => statusBase(p.status) === word);
  return hit ? hit.statusClass : '';
}

function renderPlayersTable(search) {
  if (typeof search === 'string') playerSearch = search;
  const tbody = document.getElementById('playersTableBody');
  const thead = document.getElementById('playersTableHead');
  if (!tbody) return;
  fillPlayerFilterOptions();

  if (thead) {
    thead.innerHTML = '<tr>'
      + sortTh('players', 'name', 'Player')
      + sortTh('players', 'pos', 'Pos')
      + sortTh('players', 'team', 'Team')
      + sortTh('players', 'age', 'Age')
      + sortTh('players', 'status', 'Status')
      + sortTh('players', 'frank', 'Fantasy Rank')
      + '</tr>';
  }

  const rows = playerRows();
  tbody.innerHTML = rows.map(p => `
    <tr onclick="openProfile('${jsAttr(p.id)}')">
      <td><div class="player-cell">${renderAvatar(p, 36, 12)}<div><div class="player-cell-name">${rankEsc(p.name)}</div></div></div></td>
      <td><span style="font-family:var(--mono);font-size:12px;color:var(--text-muted);">${rankEsc(p.pos)}</span></td>
      <td>${rankEsc(p.team || '—')}</td>
      <td>${p.age ?? '—'}</td>
      <td><span class="player-quick-status ${rankEsc(p.statusClass)}">${rankEsc(p.status)}</span></td>
      <td><span style="font-family:var(--mono);font-size:12px;color:var(--gold);">${rankEsc(p.fRank || '—')}</span></td>
    </tr>
  `).join('');

  if (!rows.length) {
    tbody.innerHTML = `<tr class="table-empty"><td colspan="6">No player in the pool matches these filters.</td></tr>`;
  }

  const narrowed = currentPosFilter !== 'all' || playerFilters.team !== 'all'
    || playerFilters.status !== 'all' || !!playerSearch;
  const countEl = document.getElementById('playersCount');
  if (countEl) {
    countEl.textContent = narrowed
      ? `${rows.length} of ${playersDB.length} players`
      : `${playersDB.length} players`;
  }
  const resetEl = document.getElementById('playersReset');
  if (resetEl) resetEl.hidden = !narrowed;
}

function filterPlayers(val) { renderPlayersTable(val); }

function setPlayerFilter(which, value) {
  playerFilters[which] = value;
  renderPlayersTable();
}

function resetPlayerFilters() {
  currentPosFilter = 'all';
  playerFilters.team = 'all';
  playerFilters.status = 'all';
  playerSearch = '';
  const search = document.getElementById('playerSearchGlobal');
  if (search) search.value = '';
  const teamSel = document.getElementById('playerTeamFilter');
  if (teamSel) teamSel.value = 'all';
  const statusSel = document.getElementById('playerStatusFilter');
  if (statusSel) statusSel.value = 'all';
  playersPosButtons().forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
  clearTableSort('players');
  renderPlayersTable();
}

// Scoped to this page on purpose. A bare document.querySelectorAll('.pos-btn')
// also clears the Value Board's filters and the rankings tabs, which sit in the
// DOM at the same time — they came back looking as though nothing was selected.
function playersPosButtons() {
  const page = document.getElementById('page-players');
  return page ? Array.from(page.querySelectorAll('.pos-btn')) : [];
}

function filterByPos(pos, btn) {
  currentPosFilter = pos;
  playersPosButtons().forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderPlayersTable();
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

// ===== THE LEAGUE, AT A GLANCE =====
// A team page answers "what is this offence". This answers "what is happening
// in the league", which is the question that makes a scheme page worth opening
// when you do not already have a team in mind. The movers lead because a shift
// is news; the table is there to check the claim against everyone else.
// Rows here are [team, data] entries, so every accessor reads r[0] or r[1].
// A grouping the team has no rows for is null, never 0 — see the note on the
// table itself.
const schemeRate = (d, g) => (d.personnel && d.personnel[g] ? d.personnel[g].rate : null);
defineTable('schemeLeague', {
  cols: {
    team:      { get: r => r[0], type: 'text' },
    p11:       { get: r => schemeRate(r[1], '11'), type: 'num' },
    p12:       { get: r => schemeRate(r[1], '12'), type: 'num' },
    box:       { get: r => r[1].heavyBoxRate, type: 'num' },
    explosive: { get: r => r[1].explosiveRate, type: 'num' },
    epa:       { get: r => r[1].epaPerPlay, type: 'num' },
    coach:     { get: r => r[1].coach, type: 'text' },
  },
  tie: { get: r => r[0], type: 'text' },
  // 12 personnel opens the board because the heavier-personnel shift is the
  // finding the page is built around.
  initial: { key: 'p12', dir: 'desc' },
  render: () => renderTeamPage(),
});

function schemeLeagueHtml() {
  if (!schemeData || !schemeData.seasons) return '';
  const years = (schemeData.meta.seasons || []).slice().sort();
  const latest = years[years.length - 1];
  const prevYear = years[years.length - 2];
  const cur = schemeData.seasons[latest];
  const prev = prevYear ? schemeData.seasons[prevYear] : null;
  if (!cur) return '';

  // Biggest year-over-year move in any grouping that is a real part of the diet.
  const movers = [];
  if (prev) {
    for (const [team, d] of Object.entries(cur)) {
      if (!prev[team]) continue;
      for (const [g, s2] of Object.entries(d.personnel)) {
        const before = prev[team].personnel[g] ? prev[team].personnel[g].rate : 0;
        const delta = +(s2.rate - before).toFixed(1);
        if (Math.abs(delta) >= SCHEME_SHIFT_PTS && (s2.rate >= SCHEME_MIN_RATE || before >= SCHEME_MIN_RATE)) {
          movers.push({
            team, g, delta, before, now: s2.rate,
            coach: d.coach, coachChanged: prev[team].coach && d.coach && prev[team].coach !== d.coach,
          });
        }
      }
    }
    movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    // One row per team, keeping its biggest move. A team that went heavier
    // necessarily went lighter somewhere else, so listing both halves tells the
    // same story twice and costs another team its place on the list. The list
    // is already sorted, so the first occurrence of a team is its largest.
  }

  const seenTeam = new Set();
  const topMovers = movers.filter(m => (seenTeam.has(m.team) ? false : (seenTeam.add(m.team), true)));

  let h = `<div class="medical-card" style="padding:18px;margin-bottom:16px;">`;
  h += `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;">
    <span style="font-family:var(--serif);font-size:17px;font-weight:700;">The League in ${latest}</span>
    <span style="font-family:var(--mono);font-size:9.5px;color:var(--text-muted);letter-spacing:0.5px;">32 TEAMS · ${schemeData.league[latest] ? schemeData.league[latest].plays.toLocaleString() : ''} SNAPS</span>
  </div>`;

  if (topMovers.length) {
    h += `<div style="font-family:var(--mono);font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold);margin:14px 0 6px;">Biggest identity shifts from ${prevYear}</div>`;
    for (const m of topMovers.slice(0, 5)) {
      h += `<div style="display:flex;align-items:baseline;gap:10px;padding:5px 0;border-bottom:1px solid var(--border-subtle);font-size:13px;flex-wrap:wrap;">
        <span style="font-family:var(--mono);font-size:11.5px;color:var(--gold);cursor:pointer;min-width:38px;" onclick="setTeam('${jsAttr(m.team)}')">${rankEsc(m.team)}</span>
        <span style="color:var(--text);">${rankEsc(m.g)} personnel ${m.delta > 0 ? 'up' : 'down'} ${Math.abs(m.delta).toFixed(1)}</span>
        <span style="color:var(--text-muted);font-family:var(--mono);font-size:11px;">${m.before.toFixed(1)}% → ${m.now.toFixed(1)}%</span>
        ${m.coachChanged ? `<span style="font-family:var(--mono);font-size:10px;color:var(--teal);">NEW HC ${rankEsc((m.coach || '').split(' ').pop().toUpperCase())}</span>` : ''}
      </div>`;
    }
  }

  // The columns sort themselves now. The "Rank by" strip that used to sit above
  // this table only reached five of the seven columns and could not reverse any
  // of them, and it named the same groupings differently from the headers under
  // it ("12 personnel" over a column headed "12").
  //
  // It also read a missing grouping as 0%, which is a claim — a team with no
  // rows for a package is not a team that never calls it. Missing is null here
  // and sorts to the bottom in both directions.
  const rows = sortTableRows('schemeLeague', Object.entries(cur));

  h += `<div class="table-scroll"><table class="scheme-table"><thead><tr>`
    + sortTh('schemeLeague', 'team', 'Team')
    + sortTh('schemeLeague', 'p11', '11', { title: '11 personnel' })
    + sortTh('schemeLeague', 'p12', '12', { title: '12 personnel' })
    + sortTh('schemeLeague', 'box', '7+ box', { title: 'heavy box rate' })
    + sortTh('schemeLeague', 'explosive', 'Explosive', { title: 'explosive rate' })
    + sortTh('schemeLeague', 'epa', 'EPA/play')
    + sortTh('schemeLeague', 'coach', 'Head coach')
    + `</tr></thead><tbody>`;
  for (const [team, d] of rows) {
    const p = (g) => d.personnel[g] ? schemePct(d.personnel[g].rate) : '—';
    h += `<tr style="cursor:pointer;" onclick="setTeam('${jsAttr(team)}')">
      <td style="font-family:var(--mono);color:var(--gold);">${rankEsc(team)}</td>
      <td class="scheme-num">${p('11')}</td>
      <td class="scheme-num">${p('12')}</td>
      <td class="scheme-num">${schemePct(d.heavyBoxRate)}</td>
      <td class="scheme-num">${schemePct(d.explosiveRate)}</td>
      <td class="scheme-num">${d.epaPerPlay === null || d.epaPerPlay === undefined ? '—' : (d.epaPerPlay > 0 ? '+' : '') + d.epaPerPlay}</td>
      <td style="white-space:nowrap;color:var(--text-secondary);">${rankEsc(d.coach || '')}</td>
    </tr>`;
  }
  h += `</tbody></table></div>`;
  h += `<div style="font-size:11px;color:var(--text-muted);font-style:italic;line-height:1.6;margin-top:10px;">A shift counts when a grouping moves ${SCHEME_SHIFT_PTS}+ points and is at least ${SCHEME_MIN_RATE}% of the diet on one side of the move — below that a single game plan moves the number. Click a team for the full picture.</div>`;
  h += `</div>`;
  return h;
}

// The other half of a team's identity. Coverage only exists on a dropback, so
// every rate here is a share of PASS snaps — dividing by all snaps would halve
// each number and make an aggressive defence read as a passive one.
/**
 * HOW THEY THROW, as opposed to what they line up in.
 *
 * Personnel is intent about the shape of the field. This is intent about the
 * dropback itself — whether an offence leans on play-action, lives on screens,
 * or asks its quarterback to win from a static pocket. Every rate is a share of
 * DROPBACKS, because dividing by all snaps halves them and makes a play-action
 * offence read as a conventional one.
 */
function schemePassingHtml(team, season) {
  if (!schemeCharting || !schemeCharting.seasons) return '';
  const box = schemeCharting.seasons[season];
  const c = box && box.teams[team];
  if (!c || !c.dropbacks) return '';

  // A league baseline, or the number means nothing on its own.
  const all = Object.values(box.teams).filter(x => x.dropbacks);
  const avg = (k) => all.reduce((s, x) => s + (x[k] || 0), 0) / all.length;

  const row = (label, value, leagueAvg, note) => {
    const d = +(value - leagueAvg).toFixed(1);
    const cmp = Math.abs(d) < 1
      ? '<span style="color:var(--text-muted);"> = league</span>'
      : `<span style="color:${d > 0 ? 'var(--gold)' : 'var(--text-muted)'};"> ${d > 0 ? '+' : ''}${d} vs league</span>`;
    return `<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;font-size:12.5px;">
      <span style="color:var(--text-secondary);">${rankEsc(label)}${note ? `<span style="color:var(--text-muted);font-size:11px;"> ${rankEsc(note)}</span>` : ''}</span>
      <span style="font-family:var(--mono);font-size:11.5px;white-space:nowrap;">${value}%${cmp}</span>
    </div>`;
  };

  let h = `<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border);">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
      <span style="font-family:var(--mono);font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold);">How they throw</span>
      <span style="font-family:var(--mono);font-size:9.5px;color:var(--text-muted);">${season} · ${c.dropbacks} DROPBACKS</span>
    </div>`;
  h += row('Play-action', c.playActionRate, avg('playActionRate'));
  h += row('Screens', c.screenRate, avg('screenRate'));
  h += row('RPO', c.rpoRate, avg('rpoRate'));
  h += row('Motion', c.motionRate, avg('motionRate'));
  h += row('No huddle', c.noHuddleRate, avg('noHuddleRate'));
  h += row('Blitzed', c.blitzFacedRate, avg('blitzFacedRate'), 'by opponents');
  h += `<div style="font-size:11px;color:var(--text-muted);font-style:italic;line-height:1.6;margin-top:8px;">Share of dropbacks, not of all snaps. Charted by FTN; the standard is not identical across seasons.</div>`;
  h += `</div>`;
  return h;
}

function schemeDefenseHtml(def, leagueDef, season) {
  if (!def || !def.passSnaps) return '';
  const cmp = (v, l) => {
    if (v === null || l === null || l === undefined) return '';
    const d = +(v - l).toFixed(1);
    if (Math.abs(d) < 1) return '<span style="color:var(--text-muted);"> = league</span>';
    return `<span style="color:${d > 0 ? 'var(--gold)' : 'var(--text-muted)'};"> ${d > 0 ? '+' : ''}${d} vs league</span>`;
  };
  const stat = (label, v, l, note) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;font-size:12.5px;">
      <span style="color:var(--text-secondary);">${label}${note ? `<span style="color:var(--text-muted);font-size:11px;"> ${note}</span>` : ''}</span>
      <span style="font-family:var(--mono);font-size:11.5px;white-space:nowrap;">${schemePct(v)}${cmp(v, l)}</span>
    </div>`;

  let h = `<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border);">`;
  h += `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
    <span style="font-family:var(--mono);font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold);">What their defence plays</span>
    <span style="font-family:var(--mono);font-size:9.5px;color:var(--text-muted);">${season} · ${def.passSnaps} DROPBACKS FACED</span>
  </div>`;

  h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:16px;">`;
  h += `<div>`;
  h += stat('Man coverage', def.manRate, leagueDef && leagueDef.manRate, 'of dropbacks');
  h += stat('Zone coverage', def.zoneRate, leagueDef && leagueDef.zoneRate, 'of dropbacks');
  h += stat('Blitz', def.blitzRate, leagueDef && leagueDef.blitzRate, '5+ rushers');
  h += stat('Pressure', def.pressureRate, leagueDef && leagueDef.pressureRate, 'all snaps');
  h += `</div>`;

  const shells = Object.entries(def.shell || {}).sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= 2);
  const covs = Object.entries(def.coverage || {}).sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= 3).slice(0, 4);
  h += `<div>`;
  if (shells.length) {
    h += `<div style="font-family:var(--mono);font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px;">Personnel</div>`;
    h += shells.map(([k, v]) => `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0;color:var(--text-secondary);"><span>${rankEsc(k)}</span><span style="font-family:var(--mono);">${schemePct(v)}</span></div>`).join('');
  }
  if (covs.length) {
    h += `<div style="font-family:var(--mono);font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin:10px 0 4px;">Coverage called</div>`;
    h += covs.map(([k, v]) => `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0;color:var(--text-secondary);"><span>${rankEsc(k.replace(/_/g, ' '))}</span><span style="font-family:var(--mono);">${schemePct(v)}</span></div>`).join('');
  }
  h += `</div></div>`;
  h += `<div style="font-size:11px;color:var(--text-muted);font-style:italic;line-height:1.6;margin-top:10px;">Coverage and rush counts are charted on dropbacks only, so those rates are a share of pass snaps rather than of every snap. Nickel is five defensive backs, dime six, base four.</div>`;
  h += `</div>`;
  return h;
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

  const callerNow = playCaller(team, latest);
  const callerBefore = prevYear ? playCaller(team, prevYear) : null;

  const mix = Object.entries(cur.personnel).sort((a, b) => b[1].rate - a[1].rate);
  const top = mix.filter(([, d]) => d.rate >= 1);

  let h = `<div class="medical-card" style="padding:18px;margin-bottom:14px;">`;
  h += `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;">
    <span style="font-family:var(--serif);font-size:17px;font-weight:700;">Scheme &amp; Identity</span>
    <span style="font-family:var(--mono);font-size:9.5px;color:var(--text-muted);letter-spacing:0.5px;">${latest} · ${cur.plays} SNAPS${cur.coach ? ` · ${rankEsc(cur.coach.toUpperCase())}` : ''}${callerNow && !callerNow.callerIsHeadCoach ? ` · CALLED BY ${rankEsc(callerNow.playCaller.toUpperCase())}` : ''}</span>
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
    const callerChanged = callerNow && callerBefore && callerNow.playCaller !== callerBefore.playCaller;

    if (shifts.length || coachChanged || callerChanged) {
      h += `<div style="border-left:3px solid var(--gold);padding:10px 0 10px 14px;margin:14px 0 4px;">`;
      h += `<div style="font-family:var(--mono);font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold);margin-bottom:6px;">What changed from ${prevYear}</div>`;
      // Whoever actually calls it is the better explanation, so it leads.
      if (callerChanged) {
        h += `<div style="font-size:13.5px;line-height:1.7;color:var(--text-secondary);">Play-calling passed from ${rankEsc(callerBefore.playCaller)} to <strong style="color:var(--text);">${rankEsc(callerNow.playCaller)}</strong>${coachChanged ? ` (and the head coach changed too, ${rankEsc(prev.coach)} → ${rankEsc(cur.coach)})` : ''}. That is the likeliest reason any of the below moved.</div>`;
      } else if (coachChanged) {
        h += `<div style="font-size:13.5px;line-height:1.7;color:var(--text-secondary);">${rankEsc(prev.coach)} → <strong style="color:var(--text);">${rankEsc(cur.coach)}</strong>. A new head coach is the most likely reason any of the below moved.${callerNow && callerBefore && callerNow.playCaller === callerBefore.playCaller ? ` The play-caller did not change — ${rankEsc(callerNow.playCaller)} kept it — which makes a wholesale shift less expected.` : ''}</div>`;
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

  h += schemePassingHtml(team, latest);
  h += schemeDefenseHtml(cur.defense, lg && lg.defense, latest);

  h += `<div style="font-size:11px;color:var(--text-muted);font-style:italic;line-height:1.7;margin-top:14px;">`
    + `Explosive is ${rankEsc(schemeData.meta.explosive)}; a loaded box is ${rankEsc(schemeData.meta.heavyBox)}. `
    + `${rankEsc(schemeData.meta.qualifier)}. ${rankEsc(schemeData.meta.caveats)}`
    + `</div>`;

  h += `</div>`;
  return h;
}

/* ═══════════════════════════════════════════════════════════════════════════
   IN SEASON — the matchup board

   Fantasy points allowed is the most-used matchup number in the sport and the
   most misleading, because it conflates how good a defence is with how good the
   offences it drew were. This board leads with vsBaseline instead: the same
   games, each measured against THAT PLAYER'S OWN season average. Measured on
   2025, twelve of thirty-two defences move five or more places between the two
   — so the correction is not decorative, and leading with the familiar number
   would rank a third of the league wrongly.

   The colour ramp is the one validated for the field map. Reused rather than
   re-picked, because a second diverging scale on the same site would mean the
   reader has to learn which is which.
   ═══════════════════════════════════════════════════════════════════════════ */

let matchupData = null, matchupPromise = null;
let muPos = 'WR', muSeason = null;

function ensureMatchups() {
  if (!matchupPromise) {
    matchupPromise = loadJSON('/data/matchups.json').then(d => (matchupData = d));
  }
  return matchupPromise;
}

function setMuPos(pos, el) {
  muPos = pos;
  document.querySelectorAll('#muPosFilter .pos-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  renderSeasonPage();
}

function setMuSeason(year, el) {
  muSeason = year;
  document.querySelectorAll('#muSeasonFilter .pos-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  renderSeasonPage();
}

// What the page says about itself before Week 1. A matchup board built from
// last season's defences is genuinely useful for planning and genuinely not a
// forecast, and the difference has to be on the page rather than assumed.
function seasonStateHtml(meta) {
  const live = meta && meta.latestSeasonWithGames;
  const rosReady = typeof rosData !== 'undefined' && rosData;
  let h = `<div style="padding:0 var(--page-gutter) 4px;"><div class="season-state">`;
  h += `<span class="season-state-tag">Preseason</span>`;
  h += `<span>No games have been played this year, so every board here is built from ${rankEsc(String(live || 'last season'))}. `
    + `Defensive personnel changes completely across an offseason — a figure from a past season describes that season's defence, `
    + `not the one lining up in September. These fill in weekly from Week 1.</span>`;
  h += `</div>`;
  if (rosReady) {
    h += `<div class="season-state" style="margin-top:8px;"><span class="season-state-tag">Live</span>`
      + `<span>Rest-of-season projections are available on the <a href="/rankings" onclick="event.preventDefault();navigate('rankings')">Rankings</a> page.</span></div>`;
  }
  return h + `</div>`;
}

function renderSeasonPage() {
  const board = document.getElementById('matchupBoard');
  if (!board) return;

  // The season filter belongs to whichever board is up; the position filter to
  // both. Rendering the state banner first means it is on screen while either
  // dataset is still loading.
  // THE PRESEASON BANNER IS NOT TRUE OF THE WIRE. It says every board here is
  // built from last season, which is the honest thing to say about a matchup
  // board in August and a false one about a list of adds from this morning.
  // A caveat that does not apply to what is on screen teaches the reader to
  // skip the ones that do.
  const stateHost = document.getElementById('seasonState');
  if (stateHost) {
    stateHost.innerHTML = (seasonView !== 'wire' && matchupData) ? seasonStateHtml(matchupData.meta || {}) : '';
  }
  seasonControls(seasonView);

  if (seasonView === 'wire') {
    if (!wireData) {
      board.innerHTML = `<div class="medical-card"><div class="medical-detail">Loading the wire…</div></div>`;
      ensureWire().then(() => {
        if (wireData) renderSeasonPage();
        else board.innerHTML = `<div class="medical-card"><div class="medical-detail">`
          + `The wire could not be loaded. Nothing is shown rather than a board built from part of it.</div></div>`;
      });
      return;
    }
    renderWireBoard(board);
    return;
  }

  if (seasonView === 'usage') {
    if (!weeklyUsage) {
      board.innerHTML = `<div class="medical-card"><div class="medical-detail">Loading the weekly usage…</div></div>`;
      ensureWeeklyUsage().then(() => {
        if (weeklyUsage) renderSeasonPage();
        else board.innerHTML = `<div class="medical-card"><div class="medical-detail">`
          + `The weekly usage could not be loaded. Nothing is shown rather than a board built from part of it.</div></div>`;
      });
      return;
    }
    const years = Object.keys(weeklyUsage.seasons || {}).sort();
    const seasonRow = document.getElementById('muSeasonFilter');
    if (seasonRow) {
      if (!muSeason || !years.includes(muSeason)) muSeason = years[years.length - 1];
      seasonRow.innerHTML = years.map(y =>
        `<button class="pos-btn${y === muSeason ? ' active' : ''}" onclick="setMuSeason('${y}', this)">${y}</button>`).join('');
    }
    renderUsageBoard(board);
    return;
  }

  if (!matchupData) {
    board.innerHTML = `<div class="medical-card"><div class="medical-detail">Loading the matchup data…</div></div>`;
    ensureMatchups().then(() => {
      if (matchupData) renderSeasonPage();
      else board.innerHTML = `<div class="medical-card"><div class="medical-detail">`
        + `The matchup data could not be loaded. Nothing is shown rather than a board built from part of it.</div></div>`;
    });
    return;
  }

  const meta = matchupData.meta || {};
  const years = Object.keys(matchupData.seasons || {}).sort();
  if (!muSeason || !years.includes(muSeason)) muSeason = years[years.length - 1];

  const seasonRow = document.getElementById('muSeasonFilter');
  if (seasonRow) {
    seasonRow.innerHTML = years.map(y =>
      `<button class="pos-btn${y === muSeason ? ' active' : ''}" onclick="setMuSeason('${y}', this)">${y}</button>`).join('');
  }

  // A DEFENCE NEEDS ABOUT FOUR WEEKS BEFORE IT HAS A PUBLISHABLE FIGURE.
  // Simulated against 2025: one of thirty-two defences cleared the sample floor
  // in week 2, eleven by week 3, twenty-seven by week 4. So for the first month
  // of a season this board is mostly empty — which is honest and useless. The
  // previous season is the only evidence that exists in that window, and it is
  // what every other site is showing too; the difference is saying so, because
  // defensive personnel changes completely across an offseason.
  const readRows = (year) => {
    const d = (matchupData.seasons[year] || {}).defenses || {};
    const out = [];
    for (const [team, byPos] of Object.entries(d)) {
      const c = byPos[muPos];
      if (!c || c.thin || typeof c.vsBaseline !== 'number') continue;
      out.push({ team, ...c });
    }
    return out;
  };
  let rows = readRows(muSeason);
  let fellBackFrom = null;
  if (rows.length < 16) {
    const prior = years.filter(y => y < muSeason).pop();
    const priorRows = prior ? readRows(prior) : [];
    if (priorRows.length > rows.length) {
      fellBackFrom = { thin: muSeason, using: prior, had: rows.length };
      rows = priorRows;
    }
  }
  // Toughest first: a negative vsBaseline means the defence held players below
  // their own averages.
  rows.sort((a, b) => a.vsBaseline - b.vsBaseline);

  const shownSeason = fellBackFrom ? fellBackFrom.using : muSeason;
  let h = `<div class="lab-head"><span class="lab-title">${rankEsc(`Fantasy points allowed to ${muPos}s — ${shownSeason}`)}</span>`
    + `<span class="lab-qual">${rankEsc(meta.qualifiers ? meta.qualifiers.playerGames : '')}</span></div>`;
  h += `<div class="lab-sub">${rankEsc(meta.readThis || '')}</div>`;
  // THE READER WILL USE THIS TO PREDICT. The board records what a defence has
  // allowed, and measured against itself that record barely carries into the
  // rest of the season. Saying so is the difference between a record and a
  // forecast, and it is not something a reader can infer from the numbers.
  if (meta.predictiveness) {
    h += `<div class="season-state" style="margin:10px 0 4px;"><span class="season-state-tag">Read as</span>`
      + `<span>A record, not a forecast. Measured across 2023&ndash;25, a defence's rating over the first `
      + `weeks of a season correlates with its rest-of-season rating at only r&nbsp;=&nbsp;0.05&ndash;0.32 `
      + `for QB, RB and WR &mdash; and that does not improve as more games are played.</span></div>`;
  }
  if (fellBackFrom) {
    h += `<div class="season-state" style="margin:10px 0 16px;"><span class="season-state-tag">Early season</span>`
      + `<span>Only ${fellBackFrom.had} of 32 defences have faced enough ${muPos}s in ${rankEsc(String(fellBackFrom.thin))} `
      + `to publish a figure, so this is ${rankEsc(String(fellBackFrom.using))}. A defence takes about four weeks to `
      + `produce a sample worth reading, and personnel changes completely across an offseason — treat this as a prior, `
      + `not as this year's defence.</span></div>`;
  }

  if (!rows.length) {
    h += `<div class="medical-card"><div class="medical-detail">`
      + `No defence has faced enough ${muPos}s in ${muSeason} to publish a rate. Nothing is shown rather than a number built on a handful of games.`
      + `</div></div>`;
    board.innerHTML = h;
    return;
  }

  // Scale the colour across this board only — the spread differs by position,
  // and a shared scale would paint every quarterback board neutral.
  const vals = rows.map(r => r.vsBaseline);
  const mid = 0;   // zero IS the meaningful midpoint here: "as expected"
  const spread = Math.max(...vals.map(v => Math.abs(v - mid))) || 1;
  const colour = v => {
    const step = Math.min(3, Math.round(Math.abs(v - mid) / spread * 3.2));
    if (!step) return FIELD_NEUTRAL;
    return (v > mid ? FIELD_WARM : FIELD_COOL)[step - 1];
  };

  h += `<div class="mu-legend">`
    + `<span class="field-key" style="background:${FIELD_COOL[2]};"></span>`
    + `<span class="mu-legend-label">Held below their own average</span>`
    + `<span class="field-key" style="background:${FIELD_WARM[2]};"></span>`
    + `<span class="mu-legend-label">Beat it</span>`
    + `</div>`;

  h += `<div class="table-scroll"><table class="players-table rank-table mu-table"><thead><tr>`
    + `<th>#</th><th>Defence</th><th>vs Baseline</th><th>Pts Allowed/Gm</th><th>Player-Games</th>`
    + `</tr></thead><tbody>`;
  rows.forEach((r, i) => {
    const sign = r.vsBaseline > 0 ? '+' : '';
    h += `<tr onclick="navigate('teams/${jsAttr(r.team.toLowerCase())}')">`
      + `<td>${i + 1}</td><td class="mu-team">${rankEsc(r.team)}</td>`
      + `<td class="mu-cell" style="background:${colour(r.vsBaseline)};">${sign}${r.vsBaseline}</td>`
      + `<td>${r.pointsAllowedPerGame}</td><td>${r.playerGames}</td></tr>`;
  });
  h += `</tbody></table></div>`;
  h += `<div class="rank-note">${rankEsc(
    `${rows.length} defences. Toughest first. vs Baseline is points above or below what these players averaged for themselves that season, so a defence is not credited for drawing weak opponents. `
    + (meta.caveats ? meta.caveats[0] : ''))}</div>`;
  board.innerHTML = h;
}

/* ── Weekly usage: what a player was GIVEN, and which way it is moving ───────
   Production tells you what happened; opportunity tells you what is likely to
   keep happening. The board leads on the CHANGE rather than the level, because
   a receiver who has held a 22% target share all year is not news and one who
   went from 12% to 24% last week is. */

let weeklyUsage = null, weeklyUsagePromise = null;
let seasonView = 'matchups';

function ensureWeeklyUsage() {
  if (!weeklyUsagePromise) weeklyUsagePromise = loadJSON('/data/weekly-usage.json').then(d => (weeklyUsage = d));
  return weeklyUsagePromise;
}

let wireData = null, wirePromise = null;
function ensureWire() {
  if (!wirePromise) wirePromise = loadJSON('/data/wire.json').then(d => (wireData = d));
  return wirePromise;
}

// ===== THE WIRE =====
// A trending list is a leaderboard of names. The two things that make one of
// those a reason are where he sits on his own team and whether the room is
// still piling in — a depth chart and a series, and the site keeps both now.
//
// The row is the unit, not the table. These are eleven-word answers, not
// numbers to sort against each other, and a wide table on a phone would be a
// swipe to reach the only column that says anything.
function renderWireBoard(host) {
  const meta = (wireData && wireData.meta) || {};
  const adds = (wireData && wireData.adds) || [];
  const drops = (wireData && wireData.drops) || [];
  const moves = (wireData && wireData.depthMoves) || [];

  if (!adds.length) {
    host.innerHTML = `<div class="medical-card"><div class="medical-detail">`
      + `Sleeper reported no adds in the last day. Nothing is shown rather than yesterday's list dressed as today's.</div></div>`;
    return;
  }

  // A player with no reading yesterday gets the true statement rather than a
  // percentage: the list is a top fifteen and its membership churns, so being
  // on it this morning and not yesterday is the fact, and there is no honest
  // number to put beside it.
  const arrow = (p) => {
    const d = p.direction;
    if (!d) return p.newToday ? `<span class="wire-dir wire-new">new to the list today</span>` : '';
    if (d.move === 'rising') return `<span class="wire-dir wire-up">▲ ${Math.abs(d.pct)}%</span>`;
    if (d.move === 'cooling') return `<span class="wire-dir wire-down">▼ ${Math.abs(d.pct)}%</span>`;
    return `<span class="wire-dir wire-flat">— steady</span>`;
  };

  const row = (p, i) => {
    // A link only where the site actually has a page. The room speculates on
    // players outside the 350, and a name with no profile behind it is text.
    const name = p.id
      ? `<a class="wire-name" href="/player/${jsAttr(p.id)}" onclick="event.preventDefault();navigate('player/${jsAttr(p.id)}')">${rankEsc(p.name)}</a>`
      : `<span class="wire-name wire-unlinked">${rankEsc(p.name)}</span>`;
    const badges = [
      p.pos ? `<span class="wire-pos">${rankEsc(p.pos)}</span>` : '',
      p.team ? `<span class="wire-team">${rankEsc(p.team)}</span>` : '',
      p.rank ? `<span class="wire-rank">${rankEsc(p.rank)}</span>` : '',
      p.status && !/^healthy$/i.test(p.status) ? `<span class="wire-status">${rankEsc(p.status)}</span>` : '',
    ].join('');
    // The depth line is the reason. Absent when the chart does not carry him,
    // because a plausible line here would be an invented one.
    const depth = p.depth
      ? `<div class="wire-depth">${rankEsc(p.depth.reading)}</div>`
      : `<div class="wire-depth wire-depth-none">not on his team's published chart at a skill position</div>`;
    return `<div class="wire-row">
      <div class="wire-count"><span class="wire-n">${p.count.toLocaleString()}</span><span class="wire-n-label">adds</span></div>
      <div class="wire-body">
        <div class="wire-head">${name}${badges}${arrow(p)}</div>
        ${depth}
      </div>
    </div>`;
  };

  let h = `<div class="lab-head"><span class="lab-title">Waiver wire — who the room is adding</span>`
    + `<span class="lab-qual">SLEEPER, LAST 24 HOURS</span></div>`;

  // WHAT THE SERIES CAN SAY YET. It began on the day it began, and a direction
  // needs two readings — so on day one the page says so rather than drawing a
  // trend through a single point. Same call as the In Season boards make in
  // their opening weeks.
  if ((meta.daysOnFile || 0) < 2) {
    h += `<div class="season-state" style="margin:10px 0 16px;"><span class="season-state-tag">Day one</span>`
      + `<span>This is the first morning on file, so nobody carries a direction yet — there is nothing to `
      + `compare today against. Movement appears tomorrow.</span></div>`;
  } else {
    // WHEN THE ROOM WAS COUNTED, not when the page was built. In season the
    // status refreshes run four more times a week than the full build does, so
    // these counts can be an hour old on a Sunday and a day old on a Wednesday;
    // "adds today" means nothing without saying which moment it is counting.
    const counted = meta.countedAt ? new Date(meta.countedAt) : null;
    const when = counted && !isNaN(counted)
      ? counted.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : null;
    h += `<div class="lab-sub wire-intro">Counted ${when ? rankEsc(when) : 'at the last build'}, `
      + `against the same count a day earlier — ${meta.daysOnFile} mornings on file `
      + `(from ${rankEsc(String(meta.seriesFrom || ''))}). `
      + `Sleeper publishes no history of its own, so this series only reaches back as far as the site has been keeping it.</div>`;
  }

  h += `<div class="wire-list">${adds.map(row).join('')}</div>`;

  // ===== WHO ACTUALLY MOVED =====
  // The other half, and the one nobody else can show: a promotion is visible
  // the day it happens and invisible a week later, because the published chart
  // carries no history behind it.
  h += `<div class="lab-head" style="margin-top:36px;"><span class="lab-title">Depth chart moves</span>`
    + `<span class="lab-qual">LAST ${meta.moveWindowDays || 21} DAYS</span></div>`;
  if (!moves.length) {
    h += `<div class="medical-card"><div class="medical-detail">`
      + `No player in the pool has changed position on his team's published chart in the last `
      + `${meta.moveWindowDays || 21} days. The chart is published without any history behind it, so this fills `
      + `only from the day the site started keeping one — a move it did not see is a move that cannot be recovered.</div></div>`;
  } else {
    h += `<div class="wire-list">` + moves.map(m => {
      const label = m.kind === 'traded' ? 'traded' : m.kind;
      const name = m.id
        ? `<a class="wire-name" href="/player/${jsAttr(m.id)}" onclick="event.preventDefault();navigate('player/${jsAttr(m.id)}')">${rankEsc(m.name)}</a>`
        : `<span class="wire-name wire-unlinked">${rankEsc(m.name)}</span>`;
      return `<div class="wire-row">
        <div class="wire-count"><span class="wire-move ${m.kind === 'demoted' ? 'wire-down' : 'wire-up'}">${rankEsc(label)}</span>
          <span class="wire-n-label">${rankEsc(m.date)}</span></div>
        <div class="wire-body">
          <div class="wire-head">${name}<span class="wire-pos">${rankEsc(m.position || '')}</span><span class="wire-team">${rankEsc(m.team || '')}</span></div>
          <div class="wire-depth">${rankEsc(`${m.position || 'his spot'} ${m.fromRank} → ${m.toRank} on the published chart`)}</div>
        </div>
      </div>`;
    }).join('') + `</div>`;
  }

  // Each caveat is a separate thing the reader has to know, so it renders as a
  // list. caveatHtml is the one renderer for this on the site.
  h += `<div class="rank-note">${caveatHtml(meta.caveats)}</div>`;
  host.innerHTML = h;
}

// ONE LIST, in the order the toggle's buttons appear, read by the setter here
// and by the router and the known-route check in app-feeds.js. Two lists drift:
// the first version of this built the URL from the view name directly, so the
// default view addressed itself as /season/matchups — a path isKnownRoute does
// not recognise, which put a `noindex` on the page and gave it the fallback
// canonical. The first entry is the default and carries no suffix.
const SEASON_VIEWS = ['matchups', 'usage', 'wire'];

function setSeasonView(view, el) {
  seasonView = SEASON_VIEWS.includes(view) ? view : SEASON_VIEWS[0];
  document.querySelectorAll('#seasonViewToggle .pos-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  setRoute(seasonView === SEASON_VIEWS[0] ? 'season' : `season/${seasonView}`);
  renderSeasonPage();
}

// A control that reaches nothing is worse than one that is missing: it invites
// a click that changes what the reader is looking at in no way at all. The wire
// has neither a position nor a season — it is one morning's adds — so both
// controls go, the same call the field map's view toggle got.
function seasonControls(view) {
  const pos = document.getElementById('muPosControl');
  const season = document.getElementById('muSeasonControl');
  if (pos) pos.style.display = view === 'wire' ? 'none' : '';
  if (season) season.style.display = view === 'wire' ? 'none' : '';
}

// The comparison is a player against HIMSELF, not against the league. A 60%
// snap share means one thing for a committee back and another for a starter,
// so the only reading that travels is which way his own number moved.
const USAGE_BASELINE_WEEKS = 4;

/**
 * THE FIRST WEEKS OF A SEASON HAVE NO TRENDS, AND THAT IS WHEN PEOPLE LOOK.
 *
 * Simulated against 2025: in week 1 this board had NOTHING on it, because a
 * change needs two games. The floor is right — a trend off one game is not a
 * trend — but an empty page for the opening Sunday is the wrong answer to it.
 *
 * So the board has two modes. With a baseline it shows MOVEMENT, which is the
 * useful reading. Without one it shows LEVELS, which are complete facts that
 * simply have nothing to be compared against yet, and says which it is showing.
 */
function usageRows(season) {
  const bank = (weeklyUsage && weeklyUsage.seasons && weeklyUsage.seasons[season]) || {};
  const rows = [];
  let anyBaseline = false;
  for (const [gsis, rec] of Object.entries(bank)) {
    if (rec.pos !== muPos) continue;
    const played = rec.weeks.filter(w => w.snapPct !== null || w.targets > 0 || w.carries > 0);
    if (!played.length) continue;
    const last = played[played.length - 1];
    const prior = played.slice(Math.max(0, played.length - 1 - USAGE_BASELINE_WEEKS), played.length - 1);
    if (prior.length) anyBaseline = true;
    if (!prior.length) {
      // Week one: the level is all there is, and it is real.
      rows.push({
        name: rec.name, team: last.team, week: last.week, weeksBack: 0,
        snapPct: last.snapPct, snapDelta: null,
        targetShare: last.targetShare, targetDelta: null,
        wopr: last.wopr, woprDelta: null,
        touches: last.touches,
      });
      continue;
    }
    const mean = (arr, k) => {
      const vals = arr.map(x => x[k]).filter(v => typeof v === 'number');
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const delta = (now, base) => (typeof now === 'number' && typeof base === 'number')
      ? Math.round((now - base) * 10) / 10 : null;
    rows.push({
      name: rec.name, team: last.team, week: last.week, weeksBack: prior.length,
      snapPct: last.snapPct, snapDelta: delta(last.snapPct, mean(prior, 'snapPct')),
      targetShare: last.targetShare, targetDelta: delta(last.targetShare, mean(prior, 'targetShare')),
      wopr: last.wopr, woprDelta: delta(last.wopr, mean(prior, 'wopr')),
      touches: last.touches,
    });
  }
  rows.anyBaseline = anyBaseline;
  return rows;
}

function renderUsageBoard(host) {
  const meta = (weeklyUsage && weeklyUsage.meta) || {};
  const years = Object.keys((weeklyUsage && weeklyUsage.seasons) || {}).sort();
  if (!years.length) {
    host.innerHTML = `<div class="medical-card"><div class="medical-detail">`
      + `No weekly usage has been built yet. It fills in from Week 1.</div></div>`;
    return;
  }
  if (!muSeason || !years.includes(muSeason)) muSeason = years[years.length - 1];
  const rows = usageRows(muSeason);
  const byMovement = rows.anyBaseline;
  // With a baseline the useful order is biggest movers; without one there is
  // nothing to move, so the level itself is the ranking.
  if (byMovement) {
    rows.sort((a, b) => (b.woprDelta === null ? -Infinity : b.woprDelta) - (a.woprDelta === null ? -Infinity : a.woprDelta));
  } else {
    rows.sort((a, b) => (b.wopr === null ? -Infinity : b.wopr) - (a.wopr === null ? -Infinity : a.wopr));
  }

  const week = rows.length ? Math.max(...rows.map(r => r.week)) : null;
  let h = `<div class="lab-head"><span class="lab-title">${rankEsc(`${muPos} usage — week ${week} of ${muSeason}`)}</span>`
    + `<span class="lab-qual">${byMovement ? `AGAINST HIS OWN PREVIOUS ${USAGE_BASELINE_WEEKS} WEEKS` : 'LEVELS — NO PRIOR WEEK TO COMPARE'}</span></div>`;
  h += `<div class="lab-sub">${rankEsc(meta.wopr || '')}</div>`;
  // WEEK 18 IS NOT A NORMAL WEEK. Teams with their seeding settled rest
  // starters, so the biggest movers that week are rest days wearing the shape
  // of role changes — a receiver who "lost 55 points of snap share" was on the
  // bench by choice. It reads identically to a demotion and it is not one.
  if (week === 18) {
    h += `<div class="season-state" style="margin:10px 0 16px;"><span class="season-state-tag">Week 18</span>`
      + `<span>Teams with nothing left to play for rest their starters in the final week, so the largest `
      + `moves here are rest days rather than role changes. Read week 17 for the last full-strength picture.</span></div>`;
  }

  if (!byMovement && rows.length) {
    h += `<div class="season-state" style="margin:10px 0 16px;"><span class="season-state-tag">Week 1</span>`
      + `<span>One game in, so there is nothing to compare against yet. These are levels rather than changes — `
      + `real numbers with no trend behind them. Movement appears from week two.</span></div>`;
  }
  if (!rows.length) {
    h += `<div class="medical-card"><div class="medical-detail">`
      + `No ${muPos} has played a recorded snap in ${muSeason} yet. This fills in from the first Sunday.</div></div>`;
    host.innerHTML = h;
    return;
  }

  const arrow = d => d === null ? '<span class="u-flat">—</span>'
    : d > 0.5 ? `<span class="u-up">▲ +${d}</span>`
    : d < -0.5 ? `<span class="u-down">▼ ${d}</span>`
    : `<span class="u-flat">${d > 0 ? '+' : ''}${d}</span>`;

  h += `<div class="table-scroll"><table class="players-table rank-table u-table"><thead><tr>`
    + `<th>Player</th><th>Tm</th><th>Snap %</th><th>vs base</th><th>Tgt Share</th><th>vs base</th>`
    + `<th>WOPR</th><th>vs base</th><th>Touches</th></tr></thead><tbody>`;
  for (const r of rows.slice(0, 40)) {
    h += `<tr><td class="u-name">${rankEsc(r.name)}</td><td>${rankEsc(r.team || '')}</td>`
      + `<td>${r.snapPct === null ? '—' : r.snapPct + '%'}</td><td>${arrow(r.snapDelta)}</td>`
      + `<td>${r.targetShare === null ? '—' : r.targetShare + '%'}</td><td>${arrow(r.targetDelta)}</td>`
      + `<td>${r.wopr === null ? '—' : r.wopr}</td><td>${arrow(r.woprDelta)}</td>`
      + `<td>${r.touches}</td></tr>`;
  }
  h += `</tbody></table></div>`;
  h += `<div class="rank-note">${rankEsc(
    `Top ${Math.min(40, rows.length)} of ${rows.length} by WOPR movement. Each figure is compared with that player's own previous `
    + `${USAGE_BASELINE_WEEKS} weeks, not with the league — a 60% snap share means one thing for a committee back and another for a starter. `
    + (meta.caveats ? meta.caveats[0] : ''))}</div>`;
  host.innerHTML = h;
}
