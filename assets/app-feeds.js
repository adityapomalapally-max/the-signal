/*
 * The Signal — injury curves, external feeds, nav, routing, boot
 *
 * LOAD ORDER MATTERS. These files are plain classic scripts, concatenated by
 * the browser in the order index.html lists them, and they share one global
 * scope on purpose: the markup carries ~108 inline onclick handlers, and an
 * inline handler can only see globals. Converting these to type="module"
 * would scope every function and silently break every one of those handlers.
 *
 * Split out of index.html without reordering a single statement.
 */

// ===== INJURY IMPACT TOOL =====
// ===== AGGREGATE RETURN CURVES =====
// The grid above is what the literature says. This is what actually happened
// to this pool: every attributable absence over three seasons, indexed to
// each player's own level before it. Games missed is the reliable number
// here; the production line is a shape with real biases, all stated.
let curvesPromise = null;
function ensureCurves() {
  if (!curvesPromise) curvesPromise = loadJSON('/data/injury-curves.json').then(d => d || null);
  return curvesPromise;
}

async function renderInjuryCurves() {
  const el = document.getElementById('injuryCurves');
  if (!el) return;
  const data = await ensureCurves();
  if (!data || !data.types || !Object.keys(data.types).length) { el.innerHTML = ''; return; }

  const entries = Object.entries(data.types);
  let h = `<div class="section-divider" style="padding:0;margin:36px 0 18px;">
    <span class="section-divider-label">What Coming Back Actually Looked Like</span>
    <span class="section-divider-line"></span></div>`;
  h += `<div style="font-size:13.5px;color:var(--text-secondary);line-height:1.7;margin-bottom:22px;max-width:900px;">
    Absences in the top-200 pool over ${data.meta.seasons[0]}–${data.meta.seasons[data.meta.seasons.length - 1]} that the official injury report
    attributes to a body part — ${entries.reduce((a, [, t]) => a + t.absences, 0)} of them across the ${entries.length} injury types with enough cases to say anything.
    Each player's games back are indexed to his own median week before the injury, so a WR1 and a committee back sit on the same axis.</div>`;

  h += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;">`;
  for (const [part, t] of entries) {
    const worst = Math.min(...t.curve.map(c => c.pct));
    h += `<div class="medical-card" style="padding:18px;">`;
    h += `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:4px;">
      <span style="font-family:var(--serif);font-size:17px;font-weight:700;">${rankEsc(part)}</span>
      <span style="font-family:var(--mono);font-size:9.5px;color:var(--text-muted);">${t.absences} ABSENCES · ${t.players} PLAYERS</span></div>`;
    h += `<div style="font-family:var(--mono);font-size:11px;color:var(--gold);margin-bottom:14px;">TYPICALLY COSTS ${t.medianMissed} GAME${t.medianMissed === 1 ? '' : 'S'}</div>`;

    // 100% is the player's own pre-injury level, so the reference line is
    // the point of the chart, not decoration. Bars own the full plot height
    // and the values float above them — laying the labels out inside the
    // columns stole height from the bars and flattened the differences.
    const PLOT = 84;
    const max = Math.max(125, ...t.curve.map(c => c.pct));
    h += `<div style="position:relative;height:${PLOT}px;margin:20px 0 6px;border-bottom:1px solid var(--border);">`;
    h += `<div style="position:absolute;left:0;right:0;bottom:${(100 / max * PLOT).toFixed(1)}px;border-top:1px dashed rgba(27,168,155,0.7);z-index:1;"></div>`;
    h += `<div style="position:absolute;inset:0;display:flex;align-items:flex-end;gap:10px;z-index:2;">`;
    h += t.curve.map(c => {
      const hh = Math.max((c.pct / max) * PLOT, 3);
      return `<div data-tip="${rankEsc(`${c.label}: ${c.pct}% of his own pre-injury median, across ${c.n} players`)}"
             style="flex:1;position:relative;height:${hh.toFixed(1)}px;border-radius:4px 4px 0 0;background:${c.pct < 100 ? '#a8893a' : '#1ba89b'};">
        <span style="position:absolute;top:-17px;left:0;right:0;text-align:center;font-family:var(--mono);font-size:10px;color:var(--text-secondary);">${c.pct}%</span>
      </div>`;
    }).join('');
    h += `</div></div>`;
    h += `<div style="display:flex;gap:8px;">` + t.curve.map(c =>
      `<div style="flex:1;text-align:center;font-family:var(--mono);font-size:8.5px;color:var(--text-muted);line-height:1.3;">${rankEsc(c.label.replace('Games ', '').replace(' back', ''))}<br>n=${c.n}</div>`).join('') + `</div>`;
    h += `<div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);margin-top:10px;letter-spacing:0.5px;">TEAL LINE = HIS OWN PRE-INJURY LEVEL${worst < 100 ? ` · LOW POINT ${worst}%` : ''}</div>`;
    h += `</div>`;
  }
  h += `</div>`;

  h += `<div style="font-size:11.5px;color:var(--text-muted);font-style:italic;line-height:1.7;margin-top:18px;max-width:900px;">
    ${rankEsc(data.meta.method)}</div>`;
  h += `<div class="caveat-block">${caveatHtml(data.meta.caveats)}</div>`;
  el.innerHTML = h;
}

/**
 * The injury-type cards.
 *
 * TWO THINGS WERE WRONG HERE.
 *
 * The cards led with an EMOJI — a leg, a foot, a brain — which was the only
 * place on the site using emoji as a visual language, on the one page where
 * tone matters most. A torn Achilles is somebody's career and it was being
 * illustrated like a chat message.
 *
 * And every card carried the bare figure "Return: 65%" with nothing saying what
 * returns. The meaning was in the data the whole time — injury-research.json
 * holds `returnRateLabel: "60–69% of WRs return"` — and the card dropped it.
 * A number this consequential without its unit is not a fact, it is a
 * Rorschach test: a reader can as easily take it for a chance of full recovery,
 * or of playing again at all.
 *
 * `inj.icon` is left in the data — it is hand-written research and not worth a
 * migration — but nothing renders it.
 */
function renderInjuryTypeGrid() {
  const grid = document.getElementById('injuryTypeGrid');
  if (!grid) return;
  grid.innerHTML = Object.entries(injuryResearch).map(([key, inj]) => {
    const rate = typeof inj.returnRate === 'number' ? inj.returnRate : null;
    // The bar is the figure. A number read against a drawn scale is harder to
    // misread than a number sitting on its own.
    const bar = rate === null ? '' : `<div class="inj-bar"><div class="inj-bar-fill" style="width:${Math.max(2, Math.min(100, rate))}%;"></div></div>`;
    return `<button type="button" class="inj-card" onclick="showInjuryDetail('${rankEsc(key)}')">
      <div class="inj-name">${rankEsc(inj.name)}</div>
      ${rate === null ? '' : `<div class="inj-figure">${rate}<span class="inj-figure-unit">%</span></div>`}
      ${bar}
      <div class="inj-caption">${rankEsc(inj.returnRateLabel || 'return rate')}</div>
      ${inj.avgReturn ? `<div class="inj-sub">${rankEsc(inj.avgReturn)} out</div>` : ''}
    </button>`;
  }).join('');
}

/**
 * WHO IS HURT TODAY.
 *
 * The page opened on a research tool, and the 287 medical profiles — the
 * substance — began 2,280 pixels down. But the question a reader actually
 * arrives with is not "how do ACLs heal in general", it is "is anyone on my
 * team hurt right now". That is a live answer the site already had and never
 * led with.
 *
 * Counted from the same live status the rest of the site uses, so it can never
 * disagree with a player's own badge.
 */
function renderInjuryToday() {
  const el = document.getElementById('injuryToday');
  if (!el || !playersDB.length) return;

  const hurt = playersDB.filter(p => p.statusClass && p.statusClass !== 'status-healthy');
  const out = hurt.filter(p => p.statusClass === 'status-out');
  const quest = hurt.filter(p => p.statusClass === 'status-quest');

  // Ranked players first — a reader cares about the ones he might actually
  // start. Everyone else is still counted, just not listed.
  const notable = out.concat(quest)
    .filter(p => p.fRank)
    .sort((a, b) => (fRankValue(a.fRank) ?? 999) - (fRankValue(b.fRank) ?? 999))
    .slice(0, 12);

  let h = `<div class="today-head">
      <span class="lab-title">Hurt today</span>
      <span class="lab-qual">LIVE FROM THE INJURY FEED · ${hurt.length} OF ${playersDB.length} CARRYING A DESIGNATION</span>
    </div>`;
  h += `<div class="today-counts">
      <div><div class="today-count">${out.length}</div><div class="today-count-label">Out, PUP, IR or doubtful</div></div>
      <div><div class="today-count">${quest.length}</div><div class="today-count-label">Questionable</div></div>
      <div><div class="today-count">${playersDB.length - hurt.length}</div><div class="today-count-label">No designation</div></div>
    </div>`;

  if (notable.length) {
    // A label, because the list below flows in columns of the same width as the
    // three counts above it — without one, a reader reasonably takes the first
    // column to be the players making up the first count, and the first name
    // under "10 out" is usually somebody who is merely questionable.
    h += `<div class="today-list-label">The most valuable players carrying one, whichever kind</div>`;
    h += `<div class="today-list">` + notable.map(p => `
      <button type="button" class="today-row" onclick="openProfile('${jsAttr(p.id)}')">
        <span class="today-name">${rankEsc(p.name)}</span>
        <span class="today-meta">${rankEsc(p.fRank)} · ${rankEsc(p.team || '')}</span>
        <span class="player-quick-status ${rankEsc(p.statusClass)}">${rankEsc(p.status)}</span>
      </button>`).join('') + `</div>`;
    h += `<div class="today-note">Ranked players only, most valuable first. A designation is what a team has declared, not a prediction — and a player on IR drops off the report entirely, so this undercounts the season-ending cases rather than capturing them.</div>`;
  } else {
    h += `<div class="today-note">Nobody in the ranked pool is carrying a designation right now.</div>`;
  }
  el.innerHTML = h;
}

function showInjuryDetail(key) {
  const inj = injuryResearch[key];
  if (!inj) return;
  const results = document.getElementById('injuryToolResults');

  // Find players in our DB with this injury type
  const affectedPlayers = [];
  Object.entries(medicalDB).forEach(([id, player]) => {
    player.injuries.forEach(injury => {
      const title = injury.title.toLowerCase();
      const matchMap = {
        acl: ['acl'], achilles: ['achilles'], concussion: ['concussion'],
        hamstring: ['hamstring'], high_ankle: ['high ankle', 'high-ankle'],
        turf_toe: ['turf toe'], pcl: ['pcl']
      };
      const keywords = matchMap[key] || [key];
      if (keywords.some(k => title.includes(k))) {
        affectedPlayers.push({ id, name: player.name, pos: player.pos, team: player.team, injury: injury.title, severity: injury.severity, severityLabel: injury.severityLabel, initials: playerInitials(player), color: playerColor(player) });
      }
    });
  });

  results.innerHTML = `
    <div style="margin-bottom:32px;">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;">
        <span style="font-size:40px;">${inj.icon}</span>
        <div>
          <h2 style="font-family:var(--serif);font-size:28px;font-weight:700;">${inj.name}</h2>
          <p style="font-size:14px;color:var(--text-secondary);">Average return: ${inj.avgReturn}</p>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;">
        ${inj.keyStats.map(s => `
          <div class="medical-card" style="text-align:center;padding:16px;">
            <div style="font-family:var(--serif);font-size:26px;font-weight:700;color:var(--gold);">${s.value}</div>
            <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:0.5px;text-transform:uppercase;margin-top:4px;">${s.label}</div>
          </div>
        `).join('')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
        <div class="medical-card">
          <div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">Return to Play</div>
          <div class="impact-bar" style="margin-bottom:8px;"><div class="impact-fill ${inj.returnRate > 80 ? 'low' : inj.returnRate > 50 ? 'moderate' : 'high'}" style="width:${inj.returnRate}%"></div></div>
          <div style="font-size:13px;color:var(--text-secondary);">${inj.returnRateLabel}</div>
        </div>
        <div class="medical-card">
          <div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">Re-Injury Risk</div>
          <div class="impact-bar" style="margin-bottom:8px;"><div class="impact-fill ${inj.reinjuryRisk > 20 ? 'high' : inj.reinjuryRisk > 10 ? 'moderate' : 'low'}" style="width:${inj.reinjuryRisk * 2}%"></div></div>
          <div style="font-size:13px;color:var(--text-secondary);">${inj.reinjuryLabel}</div>
        </div>
      </div>

      <div class="medical-card" style="margin-bottom:16px;">
        <div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">Performance Impact</div>
        <div style="font-size:15px;line-height:1.7;color:var(--text-secondary);">${inj.performanceLabel}</div>
      </div>

      <div class="medical-card" style="border-left:3px solid var(--gold);margin-bottom:16px;">
        <div style="font-family:var(--mono);font-size:10px;color:var(--gold);letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">Fantasy Impact</div>
        <div style="font-size:15px;line-height:1.7;color:var(--text-secondary);">${inj.fantasyImpact}</div>
      </div>

      <div class="medical-card" style="margin-bottom:16px;">
        <div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">Career Impact</div>
        <div style="font-size:15px;line-height:1.7;color:var(--text-secondary);">${inj.careerImpact}</div>
      </div>

      ${affectedPlayers.length > 0 ? `
        <div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1.5px;text-transform:uppercase;margin:24px 0 12px;">Players in Our Database With This Injury (${affectedPlayers.length})</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px;">
          ${affectedPlayers.map(p => `
            <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:background 0.2s;" onclick="openProfile('${p.id}')" onmouseover="this.style.background='var(--bg-card-hover)'" onmouseout="this.style.background='var(--bg-card)'">
              ${renderAvatar(p, 34, 11)}
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;">${p.name}</div>
                <div style="font-size:11px;color:var(--text-muted);">${p.injury}</div>
              </div>
              <span class="severity ${p.severity}" style="font-size:9px;">${p.severityLabel.split(' ')[0]}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div style="margin-top:20px;font-size:12px;color:var(--text-muted);">Sources: ${inj.sources}</div>

      <div style="margin-top:16px;"><span style="font-size:13px;color:var(--gold);cursor:pointer;" onclick="document.getElementById('injuryToolResults').innerHTML='';renderInjuryTypeGrid();">← Back to all injury types</span></div>
    </div>
  `;

  // Hide the grid when showing detail
  document.getElementById('injuryTypeGrid').style.display = 'none';
}

function switchInjuryMode(mode, btn) {
  document.querySelectorAll('.players-header + div .pos-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('injuryToolContent').style.display = mode === 'injury' ? 'block' : 'none';
  document.getElementById('playerToolContent').style.display = mode === 'player' ? 'block' : 'none';
  if (mode === 'injury') {
    document.getElementById('injuryTypeGrid').style.display = 'grid';
    document.getElementById('injuryToolResults').innerHTML = '';
    renderInjuryTypeGrid();
  }
}

function searchInjuryPlayer(query) {
  const container = document.getElementById('injuryPlayerResults');
  if (!query || query.length < 2) { container.innerHTML = ''; return; }

  const results = Object.entries(medicalDB).filter(([id, p]) =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );

  if (results.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No medical profiles found for "${query}". Try another name.</p>`;
    return;
  }

  container.innerHTML = results.map(([id, player]) => {
    const topInjury = player.injuries[0];
    const totalInjuries = player.injuries.length;
    const maxImpact = Math.max(...player.injuries.map(i => i.impact));
    const riskLevel = maxImpact > 50 ? 'High' : maxImpact > 25 ? 'Moderate' : 'Low';
    const riskColor = maxImpact > 50 ? 'var(--red)' : maxImpact > 25 ? 'var(--gold)' : 'var(--green)';

    return `<div class="medical-card" style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        ${renderAvatar(player, 44, 14)}
        <div style="flex:1;">
          <div style="font-family:var(--serif);font-size:20px;font-weight:600;">${player.name}</div>
          <div style="font-size:12px;color:var(--text-secondary);">${player.team}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-family:var(--serif);font-size:24px;font-weight:700;color:${riskColor};">${riskLevel}</div>
          <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;">Injury Risk</div>
        </div>
      </div>
      ${player.currentStatus ? `<div style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:16px;padding:12px;background:var(--bg-elevated);border-radius:6px;">${player.currentStatus}</div>` : ''}
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
        <div style="text-align:center;padding:12px;background:var(--bg-elevated);border-radius:6px;">
          <div style="font-family:var(--serif);font-size:20px;font-weight:700;">${totalInjuries}</div>
          <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;">Injuries</div>
        </div>
        <div style="text-align:center;padding:12px;background:var(--bg-elevated);border-radius:6px;">
          <div style="font-family:var(--serif);font-size:20px;font-weight:700;color:${riskColor};">${maxImpact}%</div>
          <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;">Max Impact</div>
        </div>
        <div style="text-align:center;padding:12px;background:var(--bg-elevated);border-radius:6px;">
          <div style="font-family:var(--serif);font-size:20px;font-weight:700;">${player.injuries.filter(i => i.severity === 'high').length}</div>
          <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;">Major</div>
        </div>
      </div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Injury History</div>
      ${player.injuries.map(inj => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border-subtle);">
          <div>
            <div style="font-size:13px;font-weight:600;">${inj.title}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Impact: ${inj.impact}%</div>
          </div>
          <span class="severity ${inj.severity}" style="font-size:9px;">${inj.severityLabel.split('—')[0].trim()}</span>
        </div>
      `).join('')}
      <div style="margin-top:12px;"><span style="font-size:13px;color:var(--gold);cursor:pointer;" onclick="openProfile('${id}')">View full medical profile →</span></div>
    </div>`;
  }).join('');
}

// ===== SLEEPER PLAYER DB (cached) =====
let sleeperPlayers = {};

async function loadSleeperPlayerDB() {
  const cacheKey = 'signal_sleeper_players';
  const cacheExpiry = 'signal_sleeper_expiry';
  const cached = localStorage.getItem(cacheKey);
  const expiry = localStorage.getItem(cacheExpiry);

  if (cached && expiry && Date.now() < parseInt(expiry)) {
    sleeperPlayers = JSON.parse(cached);
    return;
  }

  try {
    const res = await fetch('https://api.sleeper.app/v1/players/nfl');
    const data = await res.json();
    sleeperPlayers = data;
    localStorage.setItem(cacheKey, JSON.stringify(data));
    localStorage.setItem(cacheExpiry, String(Date.now() + 86400000)); // 24hr
  } catch (e) { console.warn('Sleeper player DB failed:', e); }
}

// ===== SLEEPER TRENDING =====
async function loadSleeperTrending() {
  const container = document.getElementById('sleeperTrending');
  try {
    // Try cached data first (from GitHub Action)
    let trending = null;
    try {
      const cached = await fetch('/data/trending.json?v=' + Date.now());
      if (cached.ok) trending = await cached.json();
    } catch (e) {}

    // If cached data has resolved names, use it directly
    if (trending && trending.adds && trending.adds.length > 0 && trending.adds[0].name) {
      container.innerHTML = trending.adds.slice(0, 10).map((t, i) => {
        const ourPlayer = playersDB.find(x => t.name.toLowerCase().includes(x.name.split(' ').pop().toLowerCase()) && x.pos === t.position);
        const clickHandler = ourPlayer ? `onclick="openProfile('${ourPlayer.id}')"` : '';
        const statusHtml = t.injury_status ? `<span style="font-family:var(--mono);font-size:8px;padding:2px 5px;border-radius:3px;background:var(--red-muted);color:var(--red);text-transform:uppercase;">${t.injury_status}</span>` : '';
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-subtle);cursor:${ourPlayer ? 'pointer' : 'default'};" ${clickHandler}>
          <span style="font-family:var(--mono);font-size:10px;color:var(--gold);font-weight:600;min-width:18px;">${i + 1}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.name}</div>
            <div style="font-size:10px;color:var(--text-muted);">${t.position} · ${t.team} · +${t.count.toLocaleString()} adds</div>
          </div>
          ${statusHtml}
        </div>`;
      }).join('');
      if (trending.updated) {
        container.innerHTML += `<div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);margin-top:8px;">Updated: ${new Date(trending.updated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>`;
      }
      return;
    }

    // Fall back to live API
    if (Object.keys(sleeperPlayers).length === 0) await loadSleeperPlayerDB();
    const res = await fetch('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=10');
    const liveData = await res.json();
    if (!liveData || liveData.length === 0) {
      container.innerHTML = '<p style="font-size:12px;color:var(--text-muted);">No trending data available</p>';
      return;
    }

    container.innerHTML = liveData.map((t, i) => {
      const p = sleeperPlayers[t.player_id];
      if (!p || !p.first_name) return '';
      const name = p.first_name + ' ' + p.last_name;
      const pos = p.position || '';
      const team = p.team || 'FA';
      const injStatus = p.injury_status || '';
      const ourPlayer = playersDB.find(x => x.name.toLowerCase().includes(p.last_name.toLowerCase()) && x.pos === pos);
      const clickHandler = ourPlayer ? `onclick="openProfile('${ourPlayer.id}')"` : '';
      const statusHtml = injStatus ? `<span style="font-family:var(--mono);font-size:8px;padding:2px 5px;border-radius:3px;background:var(--red-muted);color:var(--red);text-transform:uppercase;">${injStatus}</span>` : '';

      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-subtle);cursor:${ourPlayer ? 'pointer' : 'default'};" ${clickHandler}>
        <span style="font-family:var(--mono);font-size:10px;color:var(--gold);font-weight:600;min-width:18px;">${i + 1}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
          <div style="font-size:10px;color:var(--text-muted);">${pos} · ${team} · +${t.count.toLocaleString()} adds</div>
        </div>
        ${statusHtml}
      </div>`;
    }).join('');
  } catch (e) {
    console.warn('Sleeper trending failed:', e);
    document.getElementById('sleeperTrending').innerHTML = '<p style="font-size:12px;color:var(--text-muted);">Trending data unavailable</p>';
  }
}

// ===== NEWS FILTERING =====
let allNewsArticles = [];
let currentNewsFilter = 'all';

function filterNews(type, btn) {
  currentNewsFilter = type;
  document.querySelectorAll('.section-divider .pos-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderNewsCards();
}

function categorizeArticle(headline) {
  const h = headline.toLowerCase();
  if (h.includes('injur') || h.includes('concuss') || h.includes('acl') || h.includes('hamstring') || h.includes('out for') || h.includes('miss') || h.includes('surgery') || h.includes('ir ') || h.includes('rehab') || h.includes('sprain') || h.includes('fracture') || h.includes('tear') || h.includes('strain')) return 'injury';
  if (h.includes('fantasy') || h.includes('trade') || h.includes('sign') || h.includes('contract') || h.includes('extension') || h.includes('waiv') || h.includes('roster') || h.includes('cut') || h.includes('release') || h.includes('draft')) return 'fantasy';
  return 'news';
}

function renderNewsCards() {
  const feed = document.getElementById('newsFeed');
  let filtered = allNewsArticles;
  if (currentNewsFilter !== 'all') filtered = filtered.filter(a => a.category === currentNewsFilter);
  if (filtered.length === 0) filtered = allNewsArticles.slice(0, 3);

  feed.innerHTML = filtered.slice(0, 6).map((article, i) => {
    const tagMap = { injury: { label: 'Injury', cls: 'tag-injury' }, fantasy: { label: 'Fantasy Impact', cls: 'tag-fantasy' }, news: { label: 'NFL News', cls: 'tag-news' } };
    const tag = tagMap[article.category] || tagMap.news;
    const dotHtml = i === 0 && currentNewsFilter === 'all' ? '<span class="live-dot"></span>' : '';
    return `<a class="news-card" href="${article.link}" target="_blank" style="text-decoration:none;color:var(--text);">
      <div class="news-card-tag ${tag.cls}">${dotHtml} ${tag.label}</div>
      <h3>${article.headline}</h3>
      <p>${article.description}</p>
      <div class="news-card-footer">
        <span>Via <span class="author">ESPN</span></span>
        <span class="read-time">${article.date}</span>
      </div>
    </a>`;
  }).join('');
}

// ===== ESPN NEWS API =====
async function loadESPNNews() {
  try {
    // Try cached data first (from GitHub Action)
    try {
      const cached = await fetch('/data/news-cache.json?v=' + Date.now());
      if (cached.ok) {
        const newsData = await cached.json();
        if (newsData.articles && newsData.articles.length > 0) {
          allNewsArticles = newsData.articles;
          renderNewsCards();
          const ts = document.getElementById('newsTimestamp');
          if (ts && newsData.updated) ts.textContent = 'Cached: ' + new Date(newsData.updated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        }
      }
    } catch (e) {}

    // Then try live API to get fresher data
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=12');
    const data = await res.json();
    if (data.articles && data.articles.length > 0) {
      allNewsArticles = data.articles.map(article => {
        const headline = article.headline || '';
        const desc = article.description || '';
        const link = article.links && article.links.web ? article.links.web.href : '#';
        const published = article.published ? new Date(article.published) : null;
        const dateStr = published ? published.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        return {
          headline,
          description: desc.substring(0, 160) + (desc.length > 160 ? '...' : ''),
          link,
          date: dateStr,
          category: categorizeArticle(headline + ' ' + desc)
        };
      });
      renderNewsCards();
      const ts = document.getElementById('newsTimestamp');
      if (ts) ts.textContent = 'Updated: ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
  } catch (e) {
    console.log('ESPN API fallback:', e);
    allNewsArticles = [
      { headline: 'Malik Nabers ACL Update: Second Surgery, Scar Tissue Cleanup', description: 'Nabers underwent a second procedure to remove scar tissue from his torn ACL/meniscus repair. Full medical breakdown inside.', link: '#', date: 'May 2026', category: 'injury' },
      { headline: 'Christian McCaffrey: The Bilateral Achilles Question', description: 'CMC claims zero restrictions but the data on bilateral Achilles tendonitis recovery paints a complicated picture.', link: '#', date: 'May 2026', category: 'injury' },
      { headline: "Justin Jefferson's Hamstring History: Dynasty Signal?", description: 'Two hamstring injuries in three years for a WR who relies on explosive speed. Breaking down the recurrence data.', link: '#', date: 'May 2026', category: 'fantasy' }
    ];
    renderNewsCards();
  }
}

// ===== SUBSTACK INTEGRATION =====
// Substack CDN urls carry both the width it chose to render (w_NNN) and the
// original's dimensions (…_686x386.jpeg). The render width is the reliable
// signal: real post artwork comes back at w_1456, while a post with no
// artwork attaches a small square avatar at its natural size. The source
// width is only a floor against genuinely tiny originals — legitimate
// artwork is sometimes portrait (480x640), and that is still worth showing.
const HERO_MIN_RENDER_WIDTH = 600;
const HERO_MIN_SOURCE_WIDTH = 400;

function heroImageBigEnough(url) {
  if (!url) return false;
  const decoded = decodeURIComponent(url);
  const render = decoded.match(/[?&,\/]w_(\d+)/);
  if (render && Number(render[1]) < HERO_MIN_RENDER_WIDTH) return false;
  const source = decoded.match(/_(\d{2,5})x(\d{2,5})\.(?:jpe?g|png|webp|gif)/i);
  if (source && Number(source[1]) < HERO_MIN_SOURCE_WIDTH) return false;
  return true;
}

// The feed exposes the post artwork as `thumbnail`, but not every post has
// one (a text-only post carries an empty string), so try the enclosure and
// then the first image in the post body before giving up.
function substackImage(item) {
  if (!item) return null;
  const candidates = [
    (item.thumbnail || '').trim(),
    item.enclosure ? (item.enclosure.link || '').trim() : '',
    ...[...String(item.content || item.description || '').matchAll(/<img[^>]+src="([^">]+)"/gi)].map(m => m[1])
  ].filter(Boolean);
  return candidates.find(heroImageBigEnough) || null;
}

// Only reveal the artwork once it has actually decoded. A 404, a hotlink
// block, or a slow CDN then costs nothing — the hero keeps the pattern it
// has always had instead of flashing a broken frame.
function setHeroImage(url) {
  const img = document.getElementById('heroImage');
  const scrim = document.getElementById('heroScrim');
  if (!img || !scrim) return;
  if (!url) { img.removeAttribute('src'); img.classList.remove('loaded'); scrim.classList.remove('on'); return; }
  img.onload = () => { img.classList.add('loaded'); scrim.classList.add('on'); };
  img.onerror = () => { img.classList.remove('loaded'); scrim.classList.remove('on'); };
  img.src = url;
}

async function loadSubstack() {
  // Try multiple possible Substack RSS URLs
  const feedUrls = [
    'https://adityapomalapally.substack.com/feed',
    'https://mlamscookbook.substack.com/feed',
    'https://mlams-cookbook.substack.com/feed'
  ];
  const substackProfile = 'https://adityapomalapally.substack.com';
  
  let data = null;
  for (const feedUrl of feedUrls) {
    try {
      const res = await fetch('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(feedUrl));
      const json = await res.json();
      if (json.status === 'ok' && json.items && json.items.length > 0) {
        data = json;
        break;
      }
    } catch (e) { continue; }
  }

  if (data && data.items && data.items.length > 0) {
    // Hero — latest post
    const latest = data.items[0];
    document.getElementById('heroTitle').textContent = latest.title;
    const excerpt = latest.description ? latest.description.replace(/<[^>]+>/g, '').substring(0, 200) + '...' : '';
    document.getElementById('heroExcerpt').textContent = excerpt;
    document.getElementById('heroDate').textContent = new Date(latest.pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    document.getElementById('heroLink').href = latest.link;
    setHeroImage(substackImage(latest));

    // Analysis section — 2nd post (or 1st if only 1)
    if (data.items.length > 1) {
      const second = data.items[1];
      document.getElementById('substackAnalysisTitle').textContent = second.title;
      const excerpt2 = second.description ? second.description.replace(/<[^>]+>/g, '').substring(0, 180) + '...' : '';
      document.getElementById('substackAnalysisExcerpt').textContent = excerpt2;
      document.getElementById('substackAnalysisDate').textContent = new Date(second.pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      document.getElementById('substackAnalysis').onclick = () => window.open(second.link, '_blank');
    } else {
      document.getElementById('substackAnalysisTitle').textContent = latest.title;
      document.getElementById('substackAnalysisExcerpt').textContent = excerpt;
      document.getElementById('substackAnalysis').onclick = () => window.open(latest.link, '_blank');
    }

    // Top stories sidebar — slot 5. These elements were removed in a past
    // redesign; the unguarded writes threw and silently killed everything
    // below (the whole "From Substack" sidebar). Guard, don't assume.
    const thirdPost = data.items[2] || data.items[0];
    const sbTitle = document.getElementById('sidebarSubstackTitle');
    const sbMeta = document.getElementById('sidebarSubstackMeta');
    const sbStory = document.getElementById('substackSidebarStory');
    if (sbTitle) sbTitle.textContent = thirdPost.title;
    if (sbMeta) sbMeta.innerHTML = `<span>Adi</span> · ${new Date(thirdPost.pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    if (sbStory) sbStory.onclick = () => window.open(thirdPost.link, '_blank');

    // Right sidebar — remaining posts
    const sidebar = document.getElementById('substackSidebar');
    sidebar.innerHTML = data.items.slice(0, 5).map(item => `
      <a href="${item.link}" target="_blank" style="display:block;padding:10px 0;border-bottom:1px solid var(--border-subtle);text-decoration:none;color:var(--text);transition:opacity 0.2s;">
        <div style="font-family:var(--serif);font-size:14px;font-weight:600;line-height:1.35;margin-bottom:4px;">${item.title}</div>
        <div style="font-size:11px;color:var(--text-muted);">${new Date(item.pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
      </a>
    `).join('');
  } else {
    // RSS failed — graceful fallback linking to profile
    document.getElementById('heroTitle').textContent = "mlam's cookbook — Latest Analysis";
    document.getElementById('heroExcerpt').textContent = 'Scouting reports, player evaluations, and NFL analytics. Read the latest on Substack.';
    document.getElementById('heroLink').href = substackProfile;
    document.getElementById('substackAnalysisTitle').textContent = 'Read more on Substack →';
    document.getElementById('substackAnalysisExcerpt').textContent = 'Head to Substack for the latest posts from Adi.';
    document.getElementById('substackAnalysis').onclick = () => window.open(substackProfile, '_blank');
    document.getElementById('substackSidebar').innerHTML = `<a href="${substackProfile}" target="_blank" style="display:block;padding:10px 0;color:var(--gold);font-size:13px;">Visit Substack profile →</a>`;
  }
}


function openArticle(slug) {
  const article = articlesDB[slug];
  if (!article) return;

  // The article gets its own URL — it is the most shareable thing on the site.
  setRoute('article/' + slug, true);

  // Set article page content
  const tagColors = { 'tag-injury': 'var(--red-muted)', 'tag-draft': 'rgba(91,155,213,0.1)', 'tag-film': 'rgba(167,139,250,0.1)', 'tag-analysis': 'var(--gold-muted)', 'tag-fantasy': 'var(--teal-muted)' };
  const tagTextColors = { 'tag-injury': 'var(--red)', 'tag-draft': 'var(--blue)', 'tag-film': '#a78bfa', 'tag-analysis': 'var(--gold)', 'tag-fantasy': 'var(--teal)' };

  const tagEl = document.getElementById('articlePageTag');
  tagEl.textContent = article.tag;
  tagEl.style.background = tagColors[article.tagClass] || 'var(--gold-muted)';
  tagEl.style.color = tagTextColors[article.tagClass] || 'var(--gold)';

  document.getElementById('articlePageTitle').textContent = article.title;
  document.getElementById('articlePageAuthor').textContent = article.author || 'Adi';
  document.getElementById('articlePageTime').textContent = article.readTime || '';

  let bodyHtml = '';
  if (article.status === 'published' && article.content) {
    bodyHtml = article.content;
  } else {
    // Draft state — show outline
    bodyHtml = `<div class="article-draft-notice">This article is being written. Here's the outline of what it will cover.</div>`;
    if (article.outline && article.outline.length) {
      bodyHtml += `<div class="article-outline"><h4>What This Piece Will Cover</h4><ul>`;
      article.outline.forEach(item => { bodyHtml += `<li>${item}</li>`; });
      bodyHtml += `</ul></div>`;
    }
    if (article.content) bodyHtml += article.content;
  }

  document.getElementById('articlePageBody').innerHTML = bodyHtml;
  switchPage('article');
}

// ===== MOBILE NAV =====
function toggleMobileNav() {
  // The control has to say what state it is in, or a screen reader announces
  // the same thing whether the drawer is open or shut.
  const burger = document.getElementById('hamburger');
  const drawer = document.getElementById('mobileNavDrawer');
  if (burger && drawer) {
    const opening = !drawer.classList.contains('open');
    burger.setAttribute('aria-expanded', String(opening));
    burger.setAttribute('aria-label', opening ? 'Close navigation' : 'Open navigation');
  }
  document.getElementById('hamburger').classList.toggle('open');
  document.getElementById('mobileNavOverlay').classList.toggle('open');
  document.getElementById('mobileNavDrawer').classList.toggle('open');
  document.body.style.overflow = document.getElementById('mobileNavDrawer').classList.contains('open') ? 'hidden' : '';
}

// ===== ROUTING =====
// The address is a PATH, not a fragment.
//
// A fragment is never sent to the server, and a crawler treats /#medicals/nabers
// and /#rankings/qb as the same URL as /. The entire site — every board, every
// one of 350 profiles — was one indexable page, and no amount of good writing
// inside it could be found. vercel.json rewrites every path back to index.html,
// so these are real URLs that answer 200 and can be crawled, linked and shared.
//
// The route GRAMMAR is unchanged: what used to follow the # now follows the /.
const ROUTE_PAGES = ['teams', 'rankings', 'lab', 'players', 'medicals', 'fantasy', 'draft', 'film', 'ask'];

function routePath(route) {
  return '/' + String(route || '').replace(/^\/+/, '');
}

function currentRoute() {
  return window.location.pathname.replace(/^\/+|\/+$/g, '');
}

// push: leaves a history entry, for a navigation the reader chose to make.
// Default is replace, so re-rendering a page you are already on does not fill
// the back button with duplicates of itself.
function setRoute(route, push) {
  const next = routePath(route);
  if (window.location.pathname === next) return;
  if (push) history.pushState(null, '', next);
  else history.replaceState(null, '', next);
  // The document's description of itself is part of the address. Updating it
  // here means no caller can move the URL and forget the title — which is how
  // /rankings/wr ended up titled "Fantasy Rankings".
  applyRouteMeta();
}

// Navigate the way a click should: a new history entry, then render.
function navigate(route) {
  setRoute(route, true);
  handleRoute();
}

function handleRoute() {
  const parts = currentRoute().split('/').filter(Boolean);
  const hash = parts.join('/');

  // A profile modal must not outlive the route that opened it — pressing back
  // out of /player/nabers has to actually dismiss the card.
  if (parts[0] !== 'player' && currentProfileId) closeProfileUI();

  // /player/nabers — the modal, addressable. The players table sits behind it,
  // so closing lands somewhere that makes sense rather than on a blank page.
  if (parts[0] === 'player') {
    const id = parts[1];
    if (!id) { switchPage('players'); return; }
    if (!document.getElementById('page-players').classList.contains('active')) switchPage('players');
    if (playersDB.length) openProfile(id, true);
    else setTimeout(() => openProfile(id, true), 500);
    return;
  }

  // /lab/stats/wr/2025/sep — mode, position, season, then the board's metric.
  //
  // The mode segment is new, and links shared before it existed are /lab/wr/…
  // with no mode at all. Rather than break them, a first segment that parses as
  // a POSITION is read as the old shape and defaults to stats, which is what
  // those links always meant.
  if (parts[0] === 'lab') {
    let i = 1;
    const MODES = ['stats', 'charts', 'field', 'athletic', 'defense'];
    if (MODES.includes(parts[1])) { labMode = parts[1]; i = 2; }
    else if (parts[1] && LAB_METRICS[parts[1].toUpperCase()]) labMode = 'stats';
    const table = (LAB_TABLES[labMode] || LAB_TABLES.stats)();
    // Defence writes no position, so its season sits where a position normally
    // would. Reading it as a position left the metric unparsed and every
    // defence deep link snapped back to the first board.
    if (labMode === 'defense') i -= 1;
    else if (parts[i] && table[parts[i].toUpperCase()]) labPos = parts[i].toUpperCase();
    // The charted seasons are a subset of the stats seasons, so the year is
    // validated against whichever half is actually being addressed.
    // Charts, athletic and defence each answer to their own season set — or to
    // none at all, in athletic's case.
    const seasons = labMode === 'stats' ? LAB_SEASONS : null;
    if (parts[i + 1] && /^\d{4}$/.test(parts[i + 1]) && (!seasons || seasons.includes(parts[i + 1]))) {
      labSeason = parts[i + 1];
    }
    // Metric is validated against the position AND the mode that actually
    // apply, so a stale link to a board that no longer exists falls back to the
    // first one rather than rendering nothing.
    // Athletic writes no season into its address, so its metric sits one
    // segment earlier. Reading it at the usual offset silently dropped it and
    // every athletic deep link fell back to the first board.
    const metricPart = labMode === 'athletic' ? parts[i + 1] : parts[i + 2];
    // (defence already shifted i above, so its season/metric land correctly)
    labMetricKey = (metricPart && (table[labPos] || []).some(m => m.key === metricPart)) ? metricPart : null;
    switchPage('lab');
    return;
  }
  // /teams/sea for one team, /teams/league for the league board
  if (parts[0] === 'teams') {
    if (parts[1] === 'league') {
      teamsView = 'league';
    } else if (parts[1]) {
      teamsView = 'team';
      currentTeam = parts[1].toUpperCase();
    }
    switchPage('teams');
    return;
  }
  // #medicals/nabers — a medical profile is a thing you can send someone
  if (parts[0] === 'medicals') {
    medDetailId = parts[1] || null;
    switchPage('medicals');
    return;
  }
  // #rankings/qb
  if (parts[0] === 'rankings') {
    if (parts[1] && ['overall', 'qb', 'rb', 'wr', 'te'].includes(parts[1])) currentRankTab = parts[1];
    switchPage('rankings');
    return;
  }
  if (parts.length === 1 && ROUTE_PAGES.includes(parts[0])) {
    switchPage(parts[0]);
    return;
  }
  if (hash.startsWith('article/')) {
    const slug = hash.replace('article/', '');
    // Wait for data to load if needed
    if (Object.keys(articlesDB).length > 0) {
      openArticle(slug);
    } else {
      setTimeout(() => openArticle(slug), 500);
    }
    return;
  }

  // Nothing matched. The URL still answers 200 with this document, so say
  // plainly that it should not be indexed rather than letting a nonsense path
  // pass for a page. The reader keeps the home view underneath.
  applyRouteMeta();
}

// Back and forward move between pushed routes.
window.addEventListener('popstate', handleRoute);

// ===== PER-ROUTE METADATA =====
// Distinct URLs are worth nothing if they all claim to be the same document.
// Every route gets its own title, description and canonical, so a search result
// says what the page actually holds and a shared link unfurls as itself.
// Keep SITE_ORIGIN in step with the canonical tag in index.html and with
// scripts/build-sitemap.js — three places, one host.
const SITE_ORIGIN = 'https://the-signal-gamma.vercel.app';

const ROUTE_META = {
  '': {
    title: 'The Signal — NFL Intelligence',
    description: 'Signal over noise. Research-backed NFL analysis: injury impact database, verified athletic profiles, nflverse stats, and a draft model built on production over combine testing.',
  },
  players: {
    title: 'Player Database — The Signal',
    description: 'Every fantasy-relevant NFL player: athletic profiles, nflverse production, sourced medical history and current status, updated daily.',
  },
  ask: {
    title: 'Ask The Signal',
    description: "Questions answered from this site's own rows — production, charting, field position, usage, rankings and medical history. It answers from the data or says it cannot.",
  },
  rankings: {
    title: 'Fantasy Rankings — The Signal',
    description: 'Half-PPR redraft rankings with projection ranges and missed-time risk priced in as a second downside, not hidden in the median.',
  },
  medicals: {
    title: 'Medical Intelligence — The Signal',
    description: 'Sourced injury histories, official NFL injury-report records, and research-backed return-to-play curves for the players who matter.',
  },
  lab: {
    title: 'Stats & Charts — The Signal',
    description: 'Positional leaderboards from nflverse and Next Gen Stats. Every board states its qualifier and excludes anyone under it.',
  },
  teams: {
    title: 'Teams — The Signal',
    description: 'Who gets the ball, and how each offense lines up: personnel groupings, the box they draw, coverage faced, and year-over-year identity shifts.',
  },
  fantasy: {
    title: 'Value Board — The Signal',
    description: 'Our positional ranks against consensus ADP, compared rank-to-rank so the gaps mean something.',
  },
  draft: {
    title: 'Draft Lab — The Signal',
    description: 'Draft-capital hit rates by round and position — the base rate any prospect model has to beat.',
  },
  film: {
    title: 'Film Room — The Signal',
    description: 'Breakdowns grounded in game film rather than box-score narratives.',
  },
};

function metaForRoute(route) {
  const parts = String(route || '').split('/').filter(Boolean);
  const base = ROUTE_META[parts[0] || ''] || ROUTE_META[''];
  if (parts.length < 2) return base;

  const POS = { qb: 'Quarterback', rb: 'Running Back', wr: 'Wide Receiver', te: 'Tight End', overall: 'Overall' };

  if (parts[0] === 'player') {
    const p = playersDB.find(x => x.id === parts[1]);
    if (!p) return base;
    return {
      title: `${p.name} — ${p.pos} ${p.team} | The Signal`,
      description: `${p.name} (${[p.pos, p.team].filter(Boolean).join(' · ')}): athletic profile, production, sourced injury history and current status${p.fRank ? `, ranked ${p.fRank}` : ''}.`,
    };
  }

  if (parts[0] === 'medicals') {
    const prof = medicalDB[parts[1]];
    const pooled = playersDB.find(p => p.id === parts[1]);
    const name = (prof && prof.name) || (pooled && pooled.name);
    if (!name) return base;
    const inj = prof && prof.injuries && prof.injuries.length ? prof.injuries[0].title : null;
    return {
      title: `${name} — Injury History & Medical Profile | The Signal`,
      description: inj
        ? `${name}: sourced medical history including ${inj}, career impact, and his official NFL injury-report record.`
        : `${name}: official NFL injury-report history by season and body part, plus current status.`,
    };
  }

  if (parts[0] === 'article') {
    const a = articlesDB[parts[1]];
    if (!a) return base;
    return {
      title: `${a.title} — The Signal`,
      description: (a.excerpt || a.subtitle || base.description).slice(0, 200),
    };
  }

  if (parts[0] === 'teams') {
    if (parts[1] === 'league') {
      return {
        title: 'League Scheme Board — The Signal',
        description: 'All 32 offences ranked by personnel, the box they draw, explosive rate and EPA — plus the biggest identity shifts of the season.',
      };
    }
    const abbr = parts[1].toUpperCase();
    return {
      title: `${abbr} — Scheme, Personnel & Target Share | The Signal`,
      description: `${abbr} offensive identity: personnel groupings and how they changed, the box those groupings draw, coverage faced, target and carry share, and the schedule as a matchup map.`,
    };
  }

  if (parts[0] === 'rankings' && POS[parts[1]]) {
    return {
      title: `${POS[parts[1]]} Rankings — The Signal`,
      description: `Half-PPR ${POS[parts[1]]} rankings with projection ranges and missed-time risk priced in as a second downside.`,
    };
  }

  if (parts[0] === 'lab') {
    const known = ['stats', 'charts', 'field', 'athletic', 'defense'];
    const hasMode = known.includes(parts[1]);
    const mode = hasMode ? parts[1] : 'stats';
    const posPart = hasMode ? parts[2] : parts[1];
    const seasonPart = hasMode ? parts[3] : parts[2];
    if (mode === 'defense') {
      return {
        title: `Team Defence${seasonPart ? ' — ' + seasonPart : ''} | The Signal`,
        description: 'What each defence actually allows when it is thrown at — completion rate, yards per target, pressure and missed tackles, from charted defensive splits.',
      };
    }
    if (POS[posPart]) {
      const meta = {
        charts: {
          title: `${POS[posPart]} Charts${seasonPart ? ' — ' + seasonPart : ''} | The Signal`,
          description: `${POS[posPart]} boards from play-by-play charting and advanced splits — first reads against checkdowns, and the yards a player made himself.`,
        },
        athletic: {
          title: `${POS[posPart]} Athletic Testing | The Signal`,
          description: `${POS[posPart]} combine testing, percentiled against every player on record at the position rather than against this year's pool.`,
        },
        stats: {
          title: `${POS[posPart]} Stats${seasonPart ? ' — ' + seasonPart : ''} | The Signal`,
          description: `${POS[posPart]} leaderboards from nflverse and Next Gen Stats. Every board states its qualifier and excludes anyone under it.`,
        },
        field: {
          title: `${POS[posPart]} Field Map${seasonPart ? ' — ' + seasonPart : ''} | The Signal`,
          description: posPart === 'qb'
            ? 'Where each quarterback throws and how he does there — completion rate, EPA and accuracy over expected across twelve zones of the field.'
            : posPart === 'rb'
            ? 'Where each back runs and how he does there — yards, success rate and stuffed rate through all seven gaps, plus goal line and short yardage.'
            : `Where each ${POS[posPart].toLowerCase()} is targeted and how he does there — catch rate and yards by depth and by side of the field.`,
        },
      };
      return meta[mode] || meta.stats;
    }
  }

  return base;
}

function setTag(selector, attr, value) {
  const el = document.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

function applyRouteMeta() {
  const route = currentRoute();
  const meta = metaForRoute(route);
  const url = SITE_ORIGIN + routePath(route === '' ? '' : route);

  document.title = meta.title;
  setTag('meta[name="description"]', 'content', meta.description);
  setTag('link[rel="canonical"]', 'href', url);
  setTag('meta[property="og:title"]', 'content', meta.title);
  setTag('meta[property="og:description"]', 'content', meta.description);
  setTag('meta[property="og:url"]', 'content', url);
  setTag('meta[name="twitter:title"]', 'content', meta.title);
  setTag('meta[name="twitter:description"]', 'content', meta.description);

  setRouteJsonLd(route, meta, url);
  setIndexable(isKnownRoute(route));
}

// Every path serves index.html with a 200, so an address that means nothing
// still answers as though it were a page. That is a soft 404, and a crawler
// treats a site full of them as a site full of thin duplicates. We cannot send
// a 404 status from a static host, but we can refuse to be indexed.
function isKnownRoute(route) {
  const parts = String(route || '').split('/').filter(Boolean);
  if (!parts.length) return true;
  const head = parts[0];
  if (head === 'player') return playersDB.some(p => p.id === parts[1]);
  if (head === 'medicals') return !parts[1] || !!medicalDB[parts[1]] || playersDB.some(p => p.id === parts[1]);
  if (head === 'article') return !!articlesDB[parts[1]];
  if (head === 'rankings') return !parts[1] || ['overall', 'qb', 'rb', 'wr', 'te'].includes(parts[1]);
  return ROUTE_PAGES.includes(head);
}

function setIndexable(ok) {
  let tag = document.querySelector('meta[name="robots"]');
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', 'robots');
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', ok ? 'index, follow' : 'noindex, follow');
}

// Structured data, replaced per route. This is what lets a result render as
// something richer than a blue link. Only claims that are true: an article is
// only Article when it is actually published.
function setRouteJsonLd(route, meta, url) {
  const parts = String(route || '').split('/').filter(Boolean);
  let ld = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: meta.title,
    description: meta.description,
    url,
    isPartOf: { '@type': 'WebSite', name: 'The Signal', url: SITE_ORIGIN + '/' },
  };

  if (parts[0] === 'player') {
    const p = playersDB.find(x => x.id === parts[1]);
    if (p) {
      ld = {
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        url,
        mainEntity: {
          '@type': 'Person',
          name: p.name,
          jobTitle: p.pos,
          ...(p.team ? { affiliation: { '@type': 'SportsTeam', name: p.team } } : {}),
        },
        isPartOf: { '@type': 'WebSite', name: 'The Signal', url: SITE_ORIGIN + '/' },
      };
    }
  } else if (parts[0] === 'article') {
    const a = articlesDB[parts[1]];
    // A draft is not an Article. Claiming otherwise invites it to be indexed
    // and shown in the state we did not want anyone reading.
    if (a && a.status === 'published') {
      ld = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: a.title,
        description: meta.description,
        url,
        ...(a.date ? { datePublished: a.date } : {}),
        author: { '@type': 'Person', name: a.author || 'Adi' },
        publisher: { '@type': 'Organization', name: 'The Signal' },
      };
    }
  }

  let el = document.getElementById('routeLd');
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = 'routeLd';
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(ld);
}

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    switchPage('players');
    setTimeout(() => document.getElementById('playerSearchGlobal').focus(), 100);
  }
  if (e.key === 'Escape') closeProfile();
});

// ===== BOOT =====
// ===== KEYBOARD ACCESSIBILITY =====
// Much of the UI uses clickable <div>s, which are invisible to keyboard and
// screen-reader users. Rather than rewrite every call site, promote them:
// give each one a button role, put it in the tab order, and map Enter/Space
// to a click. Runs after any render that injects new markup.
function makeClickablesAccessible(root) {
  (root || document).querySelectorAll('[onclick]:not([data-a11y])').forEach(el => {
    el.setAttribute('data-a11y', '1');
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || tag === 'a') return; // already focusable
    // A dismiss backdrop is not a control. Promoting it put a focusable element
    // with no accessible name into the tab order — a silent stop that reads as
    // "button" and does nothing a keyboard user can perceive. The click stays;
    // only the promotion is skipped.
    if (el.getAttribute('aria-hidden') === 'true') return;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    });
  });
}

// Catch markup injected by any render path.
const a11yObserver = new MutationObserver(() => makeClickablesAccessible());
a11yObserver.observe(document.body, { childList: true, subtree: true });

// Links shared before the move to paths look like /#medicals/nabers. Translate
// once, in place, so an old link lands on the page it always meant and the
// address bar shows the URL we actually want indexed.
if (window.location.hash.length > 1) {
  history.replaceState(null, '', routePath(window.location.hash.slice(1)));
}

initData().then(() => {
  makeClickablesAccessible();
  // Route once the data the route needs is in memory. applyRouteMeta runs
  // either way: the home page needs its canonical set too, and an unrecognised
  // path needs its noindex.
  if (currentRoute()) handleRoute();
  else applyRouteMeta();
});

/**
 * In-page jumps on the medicals page.
 *
 * A plain #hash would work, except the site's address bar IS the router — a
 * fragment left in it is a URL that means nothing to the router on reload, and
 * the whole point of the routing work was that every address renders the page
 * it names. So the jump scrolls and leaves the address alone.
 */
function medJump(event, id) {
  if (event) event.preventDefault();
  const el = document.getElementById(id);
  if (!el) return;
  // NOT scrollIntoView. Two reasons: it cannot be offset, so the target lands
  // UNDER the sticky nav and the reader sees the wrong thing at the top of the
  // screen; and its smooth behaviour is a silent no-op in some environments,
  // which is a jump link that does nothing at all. Computing the position and
  // calling scrollTo works either way, and falls back to an instant jump if
  // smooth scrolling is unavailable.
  const nav = document.querySelector('.nav-main') || document.querySelector('nav');
  const offset = (nav ? nav.getBoundingClientRect().height : 0) + 16;
  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  // No "did it work" retry on the next frame. A smooth scroll has barely begun
  // one frame in, so a retry that checks whether it arrived fires every time and
  // turns every smooth scroll into an instant jump — defensive code breaking the
  // normal path to guard an abnormal one.
  try {
    window.scrollTo({ top, behavior: 'smooth' });
  } catch (e) {
    window.scrollTo(0, top);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE BODY MAP

   A reader who wants to understand a knee injury does not want a list of
   injury types sorted alphabetically. He wants to point at a knee.

   The figure is a deliberately plain dummy rather than an anatomical drawing:
   the regions have to be big enough to hit on a phone, and a realistic body on
   an injury page reads as clinical in a way this is not trying to be.

   THREE THINGS KEEP IT HONEST, and they are the whole reason this took data
   work before it took drawing:
     · FREQUENCY is counted from our own injury reports, not asserted.
     · RECOVERY is derived from those same reports, with the sample stated.
     · RESEARCH exists for SEVEN injuries. Every other condition is listed
       because it genuinely occurs at that region, and the panel SAYS we have no
       sourced detail rather than printing a plausible timeline.

   Every region is a <button>: hover works, click pins, and the whole thing is
   reachable by keyboard, which an SVG full of <path onmouseover> would not be.
   ═══════════════════════════════════════════════════════════════════════════ */

let anatomyPromise = null, anatomyData = null;
let activeRegion = 'knee';   // the most-reported region, so the panel opens full

function ensureAnatomy() {
  if (!anatomyPromise) {
    anatomyPromise = loadJSON('/data/injury-anatomy.json').then(d => (anatomyData = d));
  }
  return anatomyPromise;
}

// Where each region sits on the figure. Plain shapes on purpose — a hit target
// a thumb can find beats an accurate outline nobody can tap.
const BODY_SHAPES = {
  head:     '<circle cx="100" cy="32" r="23"/><rect x="90" y="53" width="20" height="12" rx="4"/>',
  shoulder: '<rect x="52" y="66" width="30" height="22" rx="10"/><rect x="118" y="66" width="30" height="22" rx="10"/>',
  arm:      '<rect x="46" y="86" width="20" height="86" rx="10"/><rect x="134" y="86" width="20" height="86" rx="10"/>'
            + '<rect x="46" y="172" width="18" height="26" rx="8"/><rect x="136" y="172" width="18" height="26" rx="8"/>',
  core:     '<rect x="70" y="68" width="60" height="60" rx="12"/>',
  back:     '',   // not on a front view — reachable from the list below
  hip:      '<rect x="72" y="150" width="56" height="34" rx="12"/>',
  thigh:    '<rect x="74" y="186" width="24" height="62" rx="11"/><rect x="102" y="186" width="24" height="62" rx="11"/>',
  knee:     '<rect x="74" y="250" width="24" height="22" rx="9"/><rect x="102" y="250" width="24" height="22" rx="9"/>',
  calf:     '<rect x="76" y="274" width="21" height="56" rx="10"/><rect x="103" y="274" width="21" height="56" rx="10"/>',
  ankle:    '<rect x="77" y="332" width="19" height="16" rx="7"/><rect x="104" y="332" width="19" height="16" rx="7"/>',
  foot:     '<rect x="72" y="350" width="24" height="14" rx="6"/><rect x="104" y="350" width="24" height="14" rx="6"/>',
};
// Drawn abdomen so the figure reads as a body rather than floating parts. It is
// scenery: no region owns it and nothing can be clicked on it.
const BODY_FILLER = '<rect x="74" y="128" width="52" height="24" rx="8"/>';

function setBodyRegion(key) {
  activeRegion = key;
  renderBodyMap();
}

function renderBodyMap() {
  const host = document.getElementById('bodyMap');
  if (!host) return;
  if (!anatomyData) {
    host.innerHTML = `<div class="medical-card"><div class="medical-detail">Loading the injury map…</div></div>`;
    // Re-render only if the data actually arrived. loadJSON swallows a failed
    // fetch and resolves with null, and the promise is cached — so an
    // unconditional re-render walks straight back into this branch, calls the
    // resolved promise again, and freezes the page.
    ensureAnatomy().then(() => {
      if (anatomyData) renderBodyMap();
      else host.innerHTML = `<div class="medical-card"><div class="medical-detail">The injury map could not be loaded.</div></div>`;
    });
    return;
  }
  const regions = anatomyData.regions || {};
  if (!regions[activeRegion]) activeRegion = Object.keys(regions)[0];

  // The busiest region sets the scale, so the shading means something rather
  // than being decoration.
  const maxEpisodes = Math.max(...Object.values(regions).map(r => r.episodes || 0), 1);

  let svg = `<svg viewBox="0 0 200 380" class="body-svg" role="presentation" aria-hidden="true">
    <g class="body-filler">${BODY_FILLER}</g>`;
  for (const [key, shape] of Object.entries(BODY_SHAPES)) {
    if (!shape || !regions[key]) continue;
    const r = regions[key];
    // Opacity carries how often the region is actually reported.
    const weight = 0.18 + 0.62 * ((r.episodes || 0) / maxEpisodes);
    svg += `<g class="body-region${key === activeRegion ? ' on' : ''}" data-region="${rankEsc(key)}"
      style="--w:${weight.toFixed(2)};">${shape}</g>`;
  }
  svg += `</svg>`;

  // A real button per region, layered over the drawing. The SVG itself is
  // aria-hidden — a screen reader gets the buttons, which are the thing that
  // actually does something.
  const buttons = Object.entries(regions).map(([key, r]) =>
    `<button type="button" class="body-pick${key === activeRegion ? ' on' : ''}"
       onclick="setBodyRegion('${rankEsc(key)}')"
       onmouseenter="setBodyRegion('${rankEsc(key)}')"
       aria-pressed="${key === activeRegion}">
      <span>${rankEsc(r.label)}</span>
      <span class="body-pick-count">${r.episodes}</span>
    </button>`).join('');

  host.innerHTML = `<div class="body-wrap">
      <div class="body-figure">${svg}
        <div class="body-figure-note">Shaded by how often each region is reported for this pool.</div>
      </div>
      <div class="body-side">
        <div class="body-picks">${buttons}</div>
        <div class="body-panel">${bodyPanelHtml(activeRegion)}</div>
      </div>
    </div>`;
}

function bodyPanelHtml(key) {
  const r = (anatomyData.regions || {})[key];
  if (!r) return '';
  const meta = anatomyData.meta || {};

  let h = `<div class="body-panel-head">
      <span class="lab-title">${rankEsc(r.label)}</span>
      <span class="lab-qual">${r.episodes} REPORTED ABSENCES · ${r.players} PLAYERS · ${r.shareOfAll}% OF ALL</span>
    </div>`;

  // What the report actually called it — the raw vocabulary, so nobody has to
  // take the grouping on trust.
  if (r.reportedAs && r.reportedAs.length) {
    h += `<div class="body-parts">Reported as: ${r.reportedAs.slice(0, 6)
      .map(p => `${rankEsc(p.part)} <span>${p.episodes}</span>`).join(' · ')}</div>`;
  }

  // Recovery, derived from our own reports.
  if (r.recovery) {
    const c = r.recovery;
    h += `<div class="body-block">
      <div class="body-block-head">What it has actually cost</div>
      <div class="body-stat-row">
        <div><div class="body-stat">${c.medianGamesMissed}</div><div class="body-stat-label">Median games missed</div></div>
        <div><div class="body-stat">${c.absences}</div><div class="body-stat-label">Absences on file</div></div>
        <div><div class="body-stat">${c.players}</div><div class="body-stat-label">Players</div></div>
      </div>`;
    if (Array.isArray(c.returnCurve) && c.returnCurve.length) {
      h += `<div class="body-curve">`;
      for (const step of c.returnCurve) {
        const pct = Math.max(0, Math.min(160, step.pct));
        const over = step.pct >= 100;
        h += `<div class="body-curve-row">
          <span class="body-curve-label">${rankEsc(step.label)}</span>
          <span class="body-curve-track"><span class="body-curve-fill" style="width:${(pct / 160 * 100).toFixed(1)}%;background:${over ? 'var(--teal)' : 'var(--gold)'};"></span></span>
          <span class="body-curve-val">${step.pct}%</span>
        </div>`;
      }
      h += `</div><div class="body-note">Production on return, against each player's own median before the injury — so a WR1 and a committee back sit on the same axis. Above 100% is better than his own baseline.</div>`;
    }
    if (c.examples && c.examples.length) {
      h += `<div class="body-note">For instance: ${c.examples.map(e =>
        `<button type="button" class="body-example" onclick="openProfile('${jsAttr(e.id)}')">${rankEsc(e.name)}</button> missed ${e.missed} in ${e.season}`).join(', ')}.</div>`;
    }
    h += `</div>`;
  } else {
    h += `<div class="body-block"><div class="body-note">Too few absences at this region to publish a recovery curve. Nothing is shown rather than a median off a handful of cases.</div></div>`;
  }

  // The named conditions — with research only where it exists.
  h += `<div class="body-block">
    <div class="body-block-head">What goes wrong here</div>`;
  for (const c of r.conditions) {
    h += `<div class="cond${c.research ? ' cond-sourced' : ''}">
      <div class="cond-head">
        <span class="cond-name">${rankEsc(c.name)}</span>
        ${c.research ? `<span class="cond-tag">RESEARCHED</span>` : `<span class="cond-tag cond-tag-none">NO SOURCED DETAIL</span>`}
      </div>`;
    if (c.note) h += `<div class="cond-note">${rankEsc(c.note)}</div>`;
    if (c.research) {
      const x = c.research;
      h += `<div class="cond-facts">`;
      if (x.returnRateLabel) h += `<div><strong>${x.returnRate}%</strong> — ${rankEsc(x.returnRateLabel)}</div>`;
      if (x.avgReturn) h += `<div>Typically <strong>${rankEsc(x.avgReturn)}</strong> out.</div>`;
      if (x.reinjuryLabel) h += `<div>${rankEsc(x.reinjuryLabel)}</div>`;
      if (x.performanceLabel) h += `<div>${rankEsc(x.performanceLabel)}</div>`;
      if (x.careerImpact) h += `<div>${rankEsc(x.careerImpact)}</div>`;
      if (x.fantasyImpact) h += `<div class="cond-fantasy">${rankEsc(x.fantasyImpact)}</div>`;
      // The citation, on the page, under the number it belongs to. A figure
      // whose source lives only in a data file is a figure a reader has to take
      // on trust, which is the thing this site is built not to ask for.
      if (x.sources) h += `<div class="cond-source">Source: ${rankEsc(x.sources)}</div>`;
      h += `</div>`;
    } else {
      // Say WHY there is nothing. "We looked and there is no NFL cohort" is a
      // different statement from silence, and the more useful one: it tells a
      // reader the gap is in the literature rather than in the effort.
      h += `<div class="cond-facts cond-empty">${c.noResearch
        ? rankEsc(c.noResearch) + ' Rather than print a plausible timeline, this says nothing.'
        : 'It happens here, and we have no sourced timeline for it. Rather than print a plausible one, this says nothing.'}</div>`;
    }
    h += `</div>`;
  }
  h += `</div>`;

  if (Array.isArray(meta.caveats)) {
    h += `<div class="body-note body-caveats">${caveatHtml(meta.caveats)}</div>`;
  }
  return h;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ASK — the one page that talks to a server

   Everything else here is static files. This posts to /api/ask, which holds the
   key and does the retrieval. IT FAILS ALONE ON PURPOSE: no other page calls
   it, and every error path ends in a sentence the reader can act on rather than
   a spinner that never resolves.
   ═══════════════════════════════════════════════════════════════════════════ */

let askBusy = false;

function askCount() {
  const el = document.getElementById('askInput');
  const out = document.getElementById('askCount');
  if (el && out) out.textContent = `${el.value.length} / 500`;
}

function askExample(btn) {
  const el = document.getElementById('askInput');
  if (!el) return;
  el.value = btn.textContent.trim();
  askCount();
  el.focus();
}

function askRender(html) {
  const out = document.getElementById('askOut');
  if (out) out.innerHTML = html;
}

async function submitAsk() {
  if (askBusy) return;
  const input = document.getElementById('askInput');
  const send = document.getElementById('askSend');
  const question = (input && input.value || '').trim();
  if (!question) return;

  askBusy = true;
  if (send) { send.disabled = true; send.textContent = 'Asking…'; }
  askRender(`<div class="ask-card ask-pending">Reading the data…</div>`);

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    // The endpoint always answers with JSON. If it did not, something between
    // here and it did — a rewrite, a proxy, an outage — and saying "unavailable"
    // is more honest than parsing whatever came back.
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;

    if (!res.ok || !data) {
      askRender(`<div class="ask-card ask-error">${rankEsc(
        (data && data.error) || 'The answer engine is unavailable right now. The rest of the site is unaffected.'
      )}</div>`);
      return;
    }

    let h = `<div class="ask-card"><div class="ask-answer">${rankEsc(data.answer).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</div>`;
    const g = data.grounding || {};
    if (g.ambiguous && g.ambiguous.length) {
      h += `<div class="ask-ground"><span class="ask-ground-label">Ambiguous</span> `
        + rankEsc(g.ambiguous.map(a => `"${a.surname}" could be ${a.players.join(', ')}`).join('; ')) + `</div>`;
    }
    if (g.players && g.players.length) {
      // What the answer was built from, so it can be checked against the site
      // rather than taken on trust — the same bargain every other page makes.
      h += `<div class="ask-ground"><span class="ask-ground-label">Built from</span> `
        + g.players.map(p => `<a href="/player/${jsAttr(playerSlug(p.name))}" onclick="event.preventDefault();navigate('player/${jsAttr(playerSlug(p.name))}')">${rankEsc(p.name)}</a>`).join(', ')
        + (g.topics && g.topics.length ? ` &middot; ${rankEsc(g.topics.join(', '))}` : '')
        + `</div>`;
    }
    h += `</div>`;
    askRender(h);
  } catch (e) {
    askRender(`<div class="ask-card ask-error">Could not reach the answer engine. The rest of the site is unaffected.</div>`);
  } finally {
    askBusy = false;
    if (send) { send.disabled = false; send.textContent = 'Ask'; }
  }
}

// The pool carries the slug already; this only has to find it.
function playerSlug(name) {
  const p = playersDB.find(x => x.name === name);
  return p ? p.id : '';
}
