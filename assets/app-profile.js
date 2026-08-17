/*
 * The Signal — player profile modal, its charts, and Compare
 *
 * LOAD ORDER MATTERS. These files are plain classic scripts, concatenated by
 * the browser in the order index.html lists them, and they share one global
 * scope on purpose: the markup carries ~108 inline onclick handlers, and an
 * inline handler can only see globals. Converting these to type="module"
 * would scope every function and silently break every one of those handlers.
 *
 * Split out of index.html without reordering a single statement.
 */

// ===== PLAYER PROFILE MODAL =====
let currentProfileId = null;

function openProfile(id) {
  const overlay = document.getElementById('profileOverlay');
  const player = playersDB.find(p => p.id === id);
  if (!player) return;
  currentProfileId = id;
  // The rich fields live in players-detail.json. Merge them in and re-render
  // the open tab; on any visit after the first this resolves from cache.
  ensurePlayerDetail().then(() => {
    if (currentProfileId !== id) return;
    const active = document.querySelector('.profile-tab.active');
    renderProfileTab(active ? (active.dataset.tab || 'medical') : 'medical');
  });

  const avatarEl = document.getElementById('profileAvatar');
  const hsUrl = getHeadshotUrl(player);
  if (hsUrl) {
    avatarEl.style.background = playerColor(player);
    avatarEl.innerHTML = `<img src="${hsUrl}" alt="${player.name}" style="width:100%;height:100%;object-fit:cover;" onerror="this.remove();this.parentElement.textContent='${playerInitials(player)}';">`;
  } else {
    avatarEl.style.background = playerColor(player);
    avatarEl.innerHTML = '';
    avatarEl.textContent = playerInitials(player);
  }
  document.getElementById('profileName').textContent = player.name;
  document.getElementById('profileTeamLine').innerHTML = `${player.pos} · ${player.team}${player.fRank ? ` · <span>${player.fRank}</span>` : ''}${player.experience ? ' · ' + player.experience : ''}`;

  // Reset to medical tab
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.profile-tab')[0].classList.add('active');
  renderProfileTab('medical');

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeProfile() {
  document.getElementById('profileOverlay').classList.remove('open');
  document.body.style.overflow = '';
  currentProfileId = null;
}

function switchProfileTab(tab, el) {
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderProfileTab(tab);
}

function renderProfileTab(tab) {
  const player = playersDB.find(p => p.id === currentProfileId);
  if (!player) return;
  const medical = medicalDB[currentProfileId];
  const container = document.getElementById('profileContent');
  let html = '';

  if (tab === 'medical') {
    if (medical) {
      if (medical.currentStatus) {
        html += `<div class="medical-card" style="border-left:3px solid var(--gold);margin-bottom:16px;">
          <div style="font-family:var(--mono);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold);margin-bottom:8px;">Current Status</div>
          <div class="medical-detail" style="margin-bottom:0;">${medical.currentStatus}</div>
        </div>`;
      }
      medical.injuries.forEach((inj, idx) => {
        html += `<div class="medical-card">
          <div class="medical-card-header"><h4>${inj.title}</h4><span class="severity ${inj.severity}">${inj.severityLabel}</span></div>
          <div class="medical-detail">${inj.detail}</div>
          <div class="impact-meter"><div class="impact-label">Career Impact</div><div class="impact-bar"><div class="impact-fill ${inj.impactClass}" style="width:${inj.impact}%"></div></div></div>
          <div class="medical-source">Source: <span class="source-verified">✓ ${inj.source}</span></div>
        </div>`;
        // An injury carrying a verified date gets its production curve right
        // under it, where the reader is already asking "how did he come back?"
        if (inj.event && typeof inj.event.outSeason === 'number' && typeof inj.event.outWeek === 'number') {
          const slotId = `rtpSlot-${idx}`;
          html += `<div id="${slotId}"></div>`;
          loadReturnToPlay(currentProfileId, slotId, inj.event, inj.title);
        }
      });
    } else {
      html = `<div class="medical-card"><div class="medical-detail">No hand-written medical profile for ${player.name} yet — those are researched one at a time. He is currently listed as <strong>${player.status}</strong>, and his official injury report history is below.</div></div>`;
    }
    // The generated layer under the curated profiles: every player in the
    // pool gets a real sourced history, not just the ~30 written by hand.
    html += `<div id="injReportSlot"></div>`;
    loadInjuryReport(currentProfileId);
  }

  else if (tab === 'overview') {
    // ===== HELPERS (null-safe, honest labels) =====
    const isQBProfile = player.pos === 'QB';
    const ordinal = (n) => {
      const s = ['th','st','nd','rd'], v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };
    const pctSuffix = (pct) => (pct === null || pct === undefined) ? '' : ` (${ordinal(pct)})`;
    const barW = (pct) => (pct === null || pct === undefined) ? 0 : pct;
    const colorFor = (pct) => (pct === null || pct === undefined) ? 'var(--text-muted)'
      : pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--gold)' : 'var(--red)';

    const TIP = {
      speed: 'Speed Score = size-adjusted 40 time: (Weight×200)/40⁴. Rewards fast times at heavy weight.',
      explosion: 'Explosion = Vertical + Broad Jump (standing, zero-inertia leap). NOT game-speed burst or acceleration.',
      agility: 'Agility = 3-cone + 20-yd shuttle. Change-of-direction in a drill.',
      ath: 'Athleticism = aggregate of 40, Explosion, Agility, with a size premium.',
      throw: 'Throw Velocity = ball velocity measured at the combine (mph).',
      forty: '40-yard dash time.',
      breakout: 'Breakout Age = age of first dominant college season. Earlier is better; predictive cliff at 19.5.',
      dominator: 'College Dominator = share of team receiving yards + TDs commanded in college.',
      tgtshare: 'College Target Share = % of team targets commanded.',
      ypc: 'Yards per carry in college.',
      qbr: 'College QBR = passing efficiency rating in college.',
      ypa: 'College Yards Per Attempt — passing efficiency.'
    };

    const renderBars = (title, items, footnote) => {
      items = items.filter(m => m.value !== null && m.value !== undefined && m.value !== '');
      if (!items.length) return '';
      let h = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">${title}</div>`;
      h += `<div class="medical-card" style="margin-bottom:${footnote ? '8' : '16'}px;padding:20px;">`;
      items.forEach(m => {
        const c = colorFor(m.pct);
        h += `<div style="margin-bottom:14px;" title="${(m.tip || '').replace(/"/g, '&quot;')}">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span style="font-size:13px;font-weight:500;cursor:help;border-bottom:1px dotted var(--text-muted);">${m.label}</span>
            <span style="font-family:var(--mono);font-size:13px;font-weight:600;">${m.value}<span style="color:${c};font-size:11px;">${pctSuffix(m.pct)}</span></span>
          </div>
          <div class="impact-bar"><div style="height:100%;width:${barW(m.pct)}%;background:${c};border-radius:3px;transition:width 0.8s;"></div></div>
        </div>`;
      });
      h += `</div>`;
      if (footnote) h += `<p style="font-size:11px;color:var(--text-muted);font-style:italic;margin:0 0 16px;">${footnote}</p>`;
      return h;
    };

    // ===== RADARS (shape at a glance; bars below carry the exact numbers) =====
    const prodAxes = getRadarAxes(player, 'production');
    const athAxes = getRadarAxes(player, 'athletic');
    if (prodAxes || athAxes) {
      const radars = [];
      if (prodAxes) radars.push({ title: 'Production Shape', series: [{ name: player.name, color: 'var(--gold)', axes: prodAxes }] });
      if (athAxes) radars.push({ title: 'Athletic Shape', series: [{ name: player.name, color: 'var(--teal)', axes: athAxes }] });

      if (radars.length === 2) {
        html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;">`;
        radars.forEach(rd => { html += `<div>${radarBlock(rd.title, rd.series)}</div>`; });
        html += `</div>`;
      } else {
        html += radarBlock(radars[0].title, radars[0].series);
      }
      html += `<p style="font-size:11px;color:var(--text-muted);font-style:italic;margin:0 0 20px;">All axes are percentile ranks within position. Exact values below.</p>`;
    }

    // ===== PRODUCTION PROFILE (leads — most predictive per POE/SHAP) =====
    let prod;
    if (isQBProfile) {
      prod = [
        { label: 'College QBR', value: player.collegeQBR, pct: player.qbrPct, tip: TIP.qbr },
        { label: 'College YPA', value: player.collegeYPA, pct: player.ypaPct, tip: TIP.ypa },
        { label: 'Breakout Age', value: player.breakoutAge, pct: player.breakoutPct, tip: TIP.breakout }
      ];
    } else if (player.pos === 'RB') {
      prod = [
        { label: 'College Dominator', value: player.collegeDominator, pct: player.dominatorPct, tip: TIP.dominator },
        { label: 'College YPC', value: player.collegeYPC, pct: player.ypcPct, tip: TIP.ypc },
        { label: 'College Target Share', value: player.collegeTargetShare, pct: player.targetSharePct, tip: TIP.tgtshare },
        { label: 'Breakout Age', value: player.breakoutAge, pct: player.breakoutPct, tip: TIP.breakout }
      ];
    } else { // WR / TE
      prod = [
        { label: 'College Dominator', value: player.collegeDominator, pct: player.dominatorPct, tip: TIP.dominator },
        { label: 'College Target Share', value: player.collegeTargetShare, pct: player.targetSharePct, tip: TIP.tgtshare },
        { label: 'Breakout Age', value: player.breakoutAge, pct: player.breakoutPct, tip: TIP.breakout }
      ];
    }
    html += renderBars('Production Profile', prod);

    // ===== ATHLETIC PROFILE (measured at combine; secondary) =====
    let ath;
    if (isQBProfile) {
      ath = [
        { label: 'Throw Velocity', value: player.throwVelocity ? player.throwVelocity + ' mph' : null, pct: player.throwVelocityPct, tip: TIP.throw },
        { label: '40-Yard Dash', value: player.fortyTime ? player.fortyTime + 's' : null, pct: null, tip: TIP.forty },
        { label: 'Explosion (Vert+Broad)', value: player.burstScore, pct: player.burstPct, tip: TIP.explosion },
        { label: 'Agility', value: player.agilityScore, pct: player.agilityPct, tip: TIP.agility },
        { label: 'Athleticism', value: player.athleticismScore, pct: player.athleticismPct, tip: TIP.ath }
      ];
    } else {
      ath = [
        { label: 'Speed Score', value: player.speedScore, pct: player.speedPct, tip: TIP.speed },
        { label: '40-Yard Dash', value: player.fortyTime ? player.fortyTime + 's' : null, pct: null, tip: TIP.forty },
        { label: 'Explosion (Vert+Broad)', value: player.burstScore, pct: player.burstPct, tip: TIP.explosion },
        { label: 'Agility', value: player.agilityScore, pct: player.agilityPct, tip: TIP.agility },
        { label: 'Athleticism', value: player.athleticismScore, pct: player.athleticismPct, tip: TIP.ath }
      ];
    }
    html += renderBars('Athletic Profile', ath,
      'Explosion = standing vertical + broad jump, not game-speed burst. Hover any metric for its definition.');

    // Workout Metrics Grid
    const workoutMetrics = [
      { label: '40-Yard', value: player.fortyTime, unit: 's' },
      { label: 'Vertical', value: player.vertical, unit: '' },
      { label: 'Broad Jump', value: player.broadJump, unit: '' },
      { label: 'Hand Size', value: player.handSize, unit: '' },
      { label: '3-Cone', value: player.threeConeDrill, unit: 's' },
      { label: 'Shuttle', value: player.shuttle, unit: 's' },
      { label: 'Bench', value: player.benchPress, unit: ' reps' },
      { label: 'Catch Rad.', value: player.catchRadius, unit: '' }
    ].filter(m => m.value);

    if (workoutMetrics.length > 0) {
      html += `<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">Workout Metrics</div>`;
      html += `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">`;
      workoutMetrics.forEach(m => {
        html += `<div class="medical-card" style="text-align:center;padding:12px 8px;">
          <div style="font-family:var(--serif);font-size:18px;font-weight:700;color:var(--text);">${m.value}${m.unit}</div>
          <div style="font-family:var(--mono);font-size:8px;color:var(--text-muted);letter-spacing:0.5px;text-transform:uppercase;margin-top:3px;">${m.label}</div>
        </div>`;
      });
      html += `</div>`;
    }

    // Pro Comps
    if (player.proComps && player.proComps.length > 0) {
      html += `<div class="medical-card" style="border-left:3px solid var(--gold);margin-bottom:16px;">
        <div style="font-family:var(--mono);font-size:10px;color:var(--gold);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">Pro Player Comparisons</div>
        <div style="font-family:var(--serif);font-size:18px;font-weight:600;line-height:1.6;">${player.proComps.join(' &middot; ')}</div>
      </div>`;
    }

    // Bio
    html += `<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">Background</div>`;
    html += `<div class="medical-card">`;
    const bioFields = [
      { label: 'Draft', value: player.draft },
      { label: 'College', value: player.college },
      { label: 'Height / Weight', value: player.height && player.weight ? player.height + ' &middot; ' + player.weight + ' lbs' : null },
      { label: 'Age', value: player.age },
      { label: 'Experience', value: player.experience },
      { label: 'Status', value: player.status, isStatus: true }
    ].filter(f => f.value);
    bioFields.forEach((f, i) => {
      html += `<div style="display:flex;justify-content:space-between;padding:10px 0;${i < bioFields.length - 1 ? 'border-bottom:1px solid var(--border-subtle);' : ''}">
        <span style="font-family:var(--mono);font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">${f.label}</span>
        ${f.isStatus ? '<span class="player-quick-status ' + player.statusClass + '">' + f.value + '</span>' : '<span style="font-size:14px;font-weight:600;">' + f.value + '</span>'}
      </div>`;
    });
    html += `</div>`;
  }

  else if (tab === 'stats') {
    // Season totals are lazy. In practice they are already warming from
    // first paint, so this almost never actually waits — but when it does,
    // say so rather than rendering an empty tab that looks like no data.
    if (!statsReady) {
      container.innerHTML = `<div class="medical-card"><div class="medical-detail">Loading season stats…</div></div>`;
      ensureStats().then(() => {
        statsReady = true;
        if (currentProfileId === player.id) renderProfileTab('stats');
      });
      return;
    }
    const ps = playerStats[player.id];
    const isQB = player.pos === 'QB';
    const isRB = player.pos === 'RB';

    if (ps && Object.keys(ps.seasons).length > 0) {
      // ===== SEASON TOTALS TABLE =====
      html += `<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">Season Totals</div>`;
      html += `<div style="overflow-x:auto;margin-bottom:20px;-webkit-overflow-scrolling:touch;"><table style="width:100%;border-collapse:collapse;font-size:13px;white-space:nowrap;">`;

      if (isQB) {
        html += '<thead><tr style="border-bottom:2px solid var(--border);">';
        ['Year','G','Cmp/Att','Cmp%','Pass Yds','TD','INT','YPA','Sack%','Rush','RuYds','RuTD','EPA','FPPG'].forEach(h =>
          html += `<th style="padding:8px 6px;text-align:left;font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:0.5px;text-transform:uppercase;">${h}</th>`);
        html += '</tr></thead><tbody>';
        Object.values(ps.seasons).sort((a,b) => a.season - b.season).forEach(s => {
          html += `<tr style="border-bottom:1px solid var(--border-subtle);">
            <td style="padding:8px 6px;font-weight:600;color:var(--gold);font-family:var(--mono);">${s.season}</td>
            <td style="padding:8px 6px;">${s.games}</td>
            <td style="padding:8px 6px;">${s.completions}/${s.attempts}</td>
            <td style="padding:8px 6px;font-weight:600;">${s.compPct}%</td>
            <td style="padding:8px 6px;font-weight:600;">${s.passYds.toLocaleString()}</td>
            <td style="padding:8px 6px;color:var(--green);">${s.passTD}</td>
            <td style="padding:8px 6px;color:var(--red);">${s.int}</td>
            <td style="padding:8px 6px;">${s.ypa}</td>
            <td style="padding:8px 6px;">${s.sackPct}%</td>
            <td style="padding:8px 6px;">${s.carries}</td>
            <td style="padding:8px 6px;">${s.rushYds}</td>
            <td style="padding:8px 6px;color:var(--green);">${s.rushTD}</td>
            <td style="padding:8px 6px;color:${s.passEPA > 0 ? 'var(--green)' : 'var(--red)'};">${s.passEPA > 0 ? '+' : ''}${s.passEPA}</td>
            <td style="padding:8px 6px;font-weight:600;color:var(--gold);">${s.fantasyPPG}</td>
          </tr>`;
        });
      } else if (isRB) {
        html += '<thead><tr style="border-bottom:2px solid var(--border);">';
        ['Year','G','Car','RuYds','YPC','RuTD','Tgt','Rec','RecYds','RecTD','Catch%','TgtSh%','FPPG'].forEach(h =>
          html += `<th style="padding:8px 6px;text-align:left;font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:0.5px;text-transform:uppercase;">${h}</th>`);
        html += '</tr></thead><tbody>';
        Object.values(ps.seasons).sort((a,b) => a.season - b.season).forEach(s => {
          html += `<tr style="border-bottom:1px solid var(--border-subtle);">
            <td style="padding:8px 6px;font-weight:600;color:var(--gold);font-family:var(--mono);">${s.season}</td>
            <td style="padding:8px 6px;">${s.games}</td>
            <td style="padding:8px 6px;">${s.carries}</td>
            <td style="padding:8px 6px;font-weight:600;">${s.rushYds.toLocaleString()}</td>
            <td style="padding:8px 6px;">${s.ypc}</td>
            <td style="padding:8px 6px;color:var(--green);">${s.rushTD}</td>
            <td style="padding:8px 6px;">${s.targets}</td>
            <td style="padding:8px 6px;">${s.rec}</td>
            <td style="padding:8px 6px;">${s.recYds}</td>
            <td style="padding:8px 6px;color:var(--green);">${s.recTD}</td>
            <td style="padding:8px 6px;">${s.catchPct}%</td>
            <td style="padding:8px 6px;">${s.tgtShare}%</td>
            <td style="padding:8px 6px;font-weight:600;color:var(--gold);">${s.fantasyPPG}</td>
          </tr>`;
        });
      } else { // WR / TE
        html += '<thead><tr style="border-bottom:2px solid var(--border);">';
        ['Year','G','Tgt','Rec','Yds','TD','Catch%','aDOT','YAC/R','TgtSh%','AirYd%','FPPG'].forEach(h =>
          html += `<th style="padding:8px 6px;text-align:left;font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:0.5px;text-transform:uppercase;">${h}</th>`);
        html += '</tr></thead><tbody>';
        Object.values(ps.seasons).sort((a,b) => a.season - b.season).forEach(s => {
          html += `<tr style="border-bottom:1px solid var(--border-subtle);">
            <td style="padding:8px 6px;font-weight:600;color:var(--gold);font-family:var(--mono);">${s.season}</td>
            <td style="padding:8px 6px;">${s.games}</td>
            <td style="padding:8px 6px;">${s.targets}</td>
            <td style="padding:8px 6px;">${s.rec}</td>
            <td style="padding:8px 6px;font-weight:600;">${s.recYds.toLocaleString()}</td>
            <td style="padding:8px 6px;color:var(--green);">${s.recTD}</td>
            <td style="padding:8px 6px;">${s.catchPct}%</td>
            <td style="padding:8px 6px;">${s.aDOT}</td>
            <td style="padding:8px 6px;">${s.yacPerRec}</td>
            <td style="padding:8px 6px;">${s.tgtShare}%</td>
            <td style="padding:8px 6px;">${s.airYardShare}%</td>
            <td style="padding:8px 6px;font-weight:600;color:var(--gold);">${s.fantasyPPG}</td>
          </tr>`;
        });
      }
      html += '</tbody></table></div>';

      // ===== NEXT GEN STATS (lazy — one shared data/ngs.json) =====
      html += `<div id="ngsSlot"></div>`;
      loadNgsSection(player.id, player.pos);

      // ===== WEEKLY CONSISTENCY =====
      const volSeason = Object.values(ps.seasons).sort((a,b) => b.season - a.season)[0];
      if (volSeason && volSeason.volatility) html += renderVolatility(volSeason.volatility, volSeason.season, player.pos);

      // ===== WEEKLY CHARTS + GAME LOG (lazy-loaded per player from data/weekly/) =====
      const latestSeason = Object.values(ps.seasons).sort((a,b) => b.season - a.season)[0];
      if (latestSeason) {
        html += `<div id="gameLogSlot" style="min-height:40px;"><div style="font-size:12px;color:var(--text-muted);font-style:italic;padding:8px 0;">Loading ${latestSeason.season} game log…</div></div>`;
        loadWeeklyLog(player.id, latestSeason.season, player.pos);
      }

      html += `<div style="font-size:11px;color:var(--text-muted);font-style:italic;margin-top:12px;">Source: nflverse · NFL Next Gen Stats · REG season only · PPR scoring</div>`;
    }

    // Fallback to hand-coded seasonStats if no nflverse data
    else if (player.seasonStats && player.seasonStats.length > 0) {
      html += `<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">Season-by-Season</div>`;
      html += `<div style="overflow-x:auto;margin-bottom:20px;"><table style="width:100%;border-collapse:collapse;font-size:13px;">`;
      if (isQB) {
        html += '<thead><tr style="border-bottom:2px solid var(--border);">';
        ['Year','G','Pass Yds','TD','INT','Rush Yds','Rush TD','Note'].forEach(h => html += '<th style="padding:8px 10px;text-align:left;font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:0.5px;text-transform:uppercase;white-space:nowrap;">' + h + '</th>');
        html += '</tr></thead><tbody>';
        player.seasonStats.forEach(s => {
          html += `<tr style="border-bottom:1px solid var(--border-subtle);"><td style="padding:8px 10px;font-weight:600;color:var(--gold);font-family:var(--mono);">${s.year}</td><td style="padding:8px 10px;">${s.games}</td><td style="padding:8px 10px;font-weight:600;">${s.passYds ? s.passYds.toLocaleString() : '—'}</td><td style="padding:8px 10px;color:var(--green);">${s.passTD || '—'}</td><td style="padding:8px 10px;color:var(--red);">${s.passINT || '—'}</td><td style="padding:8px 10px;">${s.rushYds || '—'}</td><td style="padding:8px 10px;">${s.rushTD || '—'}</td><td style="padding:8px 10px;font-size:11px;color:var(--text-muted);max-width:140px;">${s.note || ''}</td></tr>`;
        });
      } else if (isRB) {
        html += '<thead><tr style="border-bottom:2px solid var(--border);">';
        ['Year','G','Rush','Yds','TD','Rec','Rec Yds','Rec TD','Note'].forEach(h => html += '<th style="padding:8px 8px;text-align:left;font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:0.5px;text-transform:uppercase;white-space:nowrap;">' + h + '</th>');
        html += '</tr></thead><tbody>';
        player.seasonStats.forEach(s => {
          html += `<tr style="border-bottom:1px solid var(--border-subtle);"><td style="padding:8px;font-weight:600;color:var(--gold);font-family:var(--mono);">${s.year}</td><td style="padding:8px;">${s.games}</td><td style="padding:8px;">${s.rush || '—'}</td><td style="padding:8px;font-weight:600;">${s.rushYds ? s.rushYds.toLocaleString() : '—'}</td><td style="padding:8px;color:var(--green);">${s.rushTD || '—'}</td><td style="padding:8px;">${s.rec || '—'}</td><td style="padding:8px;">${s.recYds || '—'}</td><td style="padding:8px;color:var(--green);">${s.recTD || '—'}</td><td style="padding:8px;font-size:11px;color:var(--text-muted);max-width:120px;">${s.note || ''}</td></tr>`;
        });
      } else {
        html += '<thead><tr style="border-bottom:2px solid var(--border);">';
        ['Year','G','Rec','Yds','TD','Tgt','Catch%','YPRR','Note'].forEach(h => html += '<th style="padding:8px 8px;text-align:left;font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:0.5px;text-transform:uppercase;white-space:nowrap;">' + h + '</th>');
        html += '</tr></thead><tbody>';
        player.seasonStats.forEach(s => {
          html += `<tr style="border-bottom:1px solid var(--border-subtle);"><td style="padding:8px;font-weight:600;color:var(--gold);font-family:var(--mono);">${s.year}</td><td style="padding:8px;">${s.games}</td><td style="padding:8px;">${s.rec || '—'}</td><td style="padding:8px;font-weight:600;">${s.recYds ? s.recYds.toLocaleString() : '—'}</td><td style="padding:8px;color:var(--green);">${s.recTD || '—'}</td><td style="padding:8px;">${s.targets || '—'}</td><td style="padding:8px;">${s.catchPct || '—'}</td><td style="padding:8px;color:var(--teal);">${s.yprr || '—'}</td><td style="padding:8px;font-size:11px;color:var(--text-muted);max-width:120px;">${s.note || ''}</td></tr>`;
        });
      }
      html += '</tbody></table></div>';
    }

    else {
      html = `<div class="medical-card"><div class="medical-detail">Season stats are being compiled for ${player.name}. Check back soon.</div></div>`;
    }
  }

  else if (tab === 'fantasy') {
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">`;
    html += `<div class="medical-card" style="text-align:center;padding:20px;"><div style="font-family:var(--serif);font-size:32px;font-weight:700;color:var(--gold);">${player.fRank}</div><div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;margin-top:4px;">Positional Rank</div></div>`;
    html += `<div class="medical-card" style="text-align:center;padding:20px;"><div style="font-family:var(--serif);font-size:32px;font-weight:700;color:var(--text);">${player.pos}</div><div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;margin-top:4px;">Position</div></div>`;
    html += `</div>`;

    if (player.seasonStats && player.seasonStats.length > 0) {
      const latest = player.seasonStats[player.seasonStats.length - 1];
      html += `<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">Latest Season (${latest.year})</div>`;
      html += `<div class="medical-card" style="margin-bottom:16px;">`;
      const isQB = player.pos === 'QB';
      const isRB = player.pos === 'RB';
      let keyMetrics;
      if (isQB) keyMetrics = [{l:'Pass Yards',v:latest.passYds?latest.passYds.toLocaleString():'—'},{l:'Pass TD',v:latest.passTD||'—'},{l:'INT',v:latest.passINT||'—'},{l:'Rush Yards',v:latest.rushYds||'—'},{l:'Rush TD',v:latest.rushTD||'—'},{l:'Games',v:latest.games}];
      else if (isRB) keyMetrics = [{l:'Rush Yards',v:latest.rushYds?latest.rushYds.toLocaleString():'—'},{l:'Rush TD',v:latest.rushTD||'—'},{l:'Receptions',v:latest.rec||'—'},{l:'Rec Yards',v:latest.recYds||'—'},{l:'Rec TD',v:latest.recTD||'—'},{l:'Games',v:latest.games}];
      else keyMetrics = [{l:'Receptions',v:latest.rec||'—'},{l:'Rec Yards',v:latest.recYds?latest.recYds.toLocaleString():'—'},{l:'Rec TD',v:latest.recTD||'—'},{l:'Targets',v:latest.targets||'—'},{l:'Catch %',v:latest.catchPct||'—'},{l:'YPRR',v:latest.yprr||'—'},{l:'Games',v:latest.games}];
      keyMetrics.forEach((m,i) => {
        html += `<div style="display:flex;justify-content:space-between;padding:10px 0;${i<keyMetrics.length-1?'border-bottom:1px solid var(--border-subtle);':''}"><span style="font-size:13px;color:var(--text-secondary);">${m.l}</span><span style="font-family:var(--mono);font-size:14px;font-weight:600;">${m.v}</span></div>`;
      });
      html += `</div>`;
      if (latest.note) html += `<div style="font-size:12px;color:var(--text-muted);font-style:italic;margin-bottom:16px;">${latest.note}</div>`;
    }

    if (medical && medical.injuries.length > 0) {
      const maxImpact = Math.max(...medical.injuries.map(i => i.impact));
      const riskLevel = maxImpact > 50 ? 'High' : maxImpact > 25 ? 'Moderate' : 'Low';
      const riskColor = maxImpact > 50 ? 'var(--red)' : maxImpact > 25 ? 'var(--gold)' : 'var(--green)';
      html += `<div class="medical-card" style="border-left:3px solid ${riskColor};">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;">Injury Risk</span><span style="font-family:var(--serif);font-size:18px;font-weight:700;color:${riskColor};">${riskLevel}</span></div>
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">${medical.injuries[0].title}</div>
        <div class="impact-bar"><div class="impact-fill ${medical.injuries[0].impactClass}" style="width:${medical.injuries[0].impact}%"></div></div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:8px;">${medical.injuries.length} injuries on record</div>
      </div>`;
    }

    if (player.proComps && player.proComps.length > 0) {
      html += `<div class="medical-card" style="border-left:3px solid var(--gold);margin-top:12px;">
        <div style="font-family:var(--mono);font-size:10px;color:var(--gold);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Player Comparisons</div>
        <div style="font-size:15px;font-weight:600;">${player.proComps.join(' &middot; ')}</div>
      </div>`;
    }
  }

  container.innerHTML = html;
}

function findSleeperPlayer(player) {
  if (Object.keys(sleeperPlayers).length === 0) return null;
  const lastName = player.name.split(' ').pop().toLowerCase();
  const firstName = player.name.split(' ')[0].toLowerCase();
  return Object.values(sleeperPlayers).find(sp =>
    sp && sp.last_name && sp.first_name &&
    sp.last_name.toLowerCase() === lastName &&
    sp.first_name.toLowerCase() === firstName &&
    sp.position === player.pos
  ) || null;
}

// ===== HEADSHOTS (via Sleeper CDN) =====
function getHeadshotUrl(player) {
  // Prefer the ID baked into players.json by the daily Action — this is the
  // common path and costs nothing. The runtime DB lookup is only a fallback
  // for players added by hand before the next Action run.
  let id = player.sleeperId;
  if (!id) {
    const sp = findSleeperPlayer(player);
    if (!sp) return null;
    id = sp.player_id;
  }
  return `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`;
}

function renderAvatar(player, size, fontSize) {
  size = size || 36;
  fontSize = fontSize || 12;
  const url = getHeadshotUrl(player);
  if (url) {
    // lazy + async: the pool is 350 players and several pages render an avatar
    // per row, so the document holds ~770 of these. Eager decoding meant every
    // one of them was requested on load, including the pages nobody opened.
    return `<img class="player-headshot" src="${url}" alt="${player.name}" width="${size}" height="${size}" loading="lazy" decoding="async" style="width:${size}px;height:${size}px;border-radius:${size <= 36 ? 8 : 12}px;" onerror="this.outerHTML='<div class=\\'player-initials\\' style=\\'background:${playerColor(player)};width:${size}px;height:${size}px;font-size:${fontSize}px;\\'>${playerInitials(player)}</div>'">`;
  }
  return `<div class="player-initials" style="background:${playerColor(player)};width:${size}px;height:${size}px;font-size:${fontSize}px;">${playerInitials(player)}</div>`;
}

// Escapes a string for safe embedding inside a single-quoted JS string
// that itself sits inside a double-quoted HTML attribute.
// Without this, "Ja'Marr Chase" terminates the JS string and the handler dies.
function jsAttr(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ===== WEEKLY CONSISTENCY =====
// Renders observed week-to-week distribution. This measures start-to-start
// reliability, which is a DIFFERENT question from a season-long outcome range:
// weekly noise partially cancels across 17 games. Labelled explicitly so the
// two never get read as the same thing.
function renderVolatility(v, season, pos) {
  if (!v) return '';

  const head = (t) => `<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">${t}</div>`;

  if (v.insufficient) {
    return head(`${season} Weekly Consistency`) +
      `<div class="medical-card" style="margin-bottom:16px;">
        <div class="medical-detail">Only ${v.games} game${v.games === 1 ? '' : 's'} on record for ${season}. A distribution built from that few observations would be noise, so nothing is reported here.</div>
      </div>`;
  }

  const posLabel = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE' }[pos] || pos;

  // --- Distribution strip: p10 .. p90 with quartile box and median line ---
  const lo = v.p10, hi = v.p90;
  const span = (hi - lo) || 1;
  const at = x => Math.max(0, Math.min(100, ((x - lo) / span) * 100));
  const boxL = at(v.p25), boxR = at(v.p75), medX = at(v.median), meanX = at(v.mean);

  let h = head(`${season} Weekly Consistency`);
  h += `<div class="medical-card" style="margin-bottom:8px;padding:20px;">`;

  // Strip
  h += `<div style="margin-bottom:6px;display:flex;justify-content:space-between;font-family:var(--mono);font-size:9px;color:var(--text-muted);">
    <span>${v.p10} pts</span><span style="letter-spacing:1px;">WEEKLY PPR RANGE (10th–90th)</span><span>${v.p90} pts</span>
  </div>`;
  h += `<div style="position:relative;height:34px;margin-bottom:14px;">
    <div style="position:absolute;top:15px;left:0;right:0;height:3px;background:var(--border);border-radius:2px;"></div>
    <div style="position:absolute;top:9px;left:${boxL}%;width:${Math.max(boxR - boxL, 1)}%;height:15px;background:var(--gold-muted);border:1px solid var(--gold);border-radius:3px;" title="Middle half of weeks: ${v.p25} to ${v.p75}"></div>
    <div style="position:absolute;top:5px;left:${medX}%;width:2px;height:23px;background:var(--gold);" title="Median week: ${v.median}"></div>
    <div style="position:absolute;top:11px;left:${meanX}%;width:9px;height:9px;margin-left:-4px;border-radius:50%;background:var(--teal);border:2px solid var(--bg-card);" title="Mean: ${v.mean}"></div>
  </div>`;
  h += `<div style="display:flex;justify-content:center;gap:18px;flex-wrap:wrap;font-size:11px;color:var(--text-muted);margin-bottom:16px;">
    <span><span style="display:inline-block;width:2px;height:10px;background:var(--gold);vertical-align:middle;margin-right:5px;"></span>Median ${v.median}</span>
    <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--teal);vertical-align:middle;margin-right:5px;"></span>Mean ${v.mean}</span>
    <span><span style="display:inline-block;width:14px;height:9px;background:var(--gold-muted);border:1px solid var(--gold);vertical-align:middle;margin-right:5px;"></span>Middle 50%</span>
  </div>`;

  // --- Key figures ---
  const cvLabel = v.cv === null ? '—'
    : v.cv < 0.40 ? 'Steady' : v.cv < 0.55 ? 'Typical' : 'Swingy';
  const cvColor = v.cv === null ? 'var(--text-muted)'
    : v.cv < 0.40 ? 'var(--green)' : v.cv < 0.55 ? 'var(--gold)' : 'var(--red)';

  const tiles = [
    { v: v.boomRate === null ? '—' : v.boomRate + '%', l: `Top-${v.boomThreshold} ${posLabel} week`, c: 'var(--green)', t: `Share of games finishing as a top-${v.boomThreshold} ${posLabel} that week, measured against every ${posLabel} who played.` },
    { v: v.bustRate === null ? '—' : v.bustRate + '%', l: `Outside ${posLabel}${v.bustThreshold}`, c: 'var(--red)', t: `Share of games finishing outside the top ${v.bustThreshold} ${posLabel}s — below what a 12-team league would start.` },
    { v: v.cv === null ? '—' : v.cv.toFixed(2), l: `Variation · ${cvLabel}`, c: cvColor, t: 'Standard deviation divided by mean. Scale-free, so a 20-PPG and a 10-PPG player can be compared on consistency. Lower = steadier.' },
    { v: v.medianRank === null ? '—' : posLabel + v.medianRank, l: 'Median weekly finish', c: 'var(--text)', t: `Typical weekly positional finish. Best: ${posLabel}${v.bestRank} · Worst: ${posLabel}${v.worstRank}` }
  ];

  h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:16px;">`;
  tiles.forEach(t => {
    h += `<div style="text-align:center;padding:12px 8px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;cursor:help;" title="${t.t.replace(/"/g, '&quot;')}">
      <div style="font-family:var(--serif);font-size:22px;font-weight:700;color:${t.c};">${t.v}</div>
      <div style="font-family:var(--mono);font-size:8px;color:var(--text-muted);letter-spacing:0.5px;text-transform:uppercase;margin-top:4px;line-height:1.3;">${t.l}</div>
    </div>`;
  });
  h += `</div>`;

  // --- Asymmetry ---
  if (v.skewRatio !== null) {
    const right = v.skewRatio > 1.15, left = v.skewRatio < 0.87;
    const verdict = right ? 'Upside tail is longer' : left ? 'Downside tail is longer' : 'Roughly symmetric';
    const vColor = right ? 'var(--green)' : left ? 'var(--red)' : 'var(--text-secondary)';
    const upPct = Math.round((v.upGap / (v.upGap + v.downGap)) * 100);
    h += `<div style="border-top:1px solid var(--border);padding-top:14px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
        <span style="font-size:12px;color:var(--text-secondary);">Distribution shape</span>
        <span style="font-size:12px;font-weight:600;color:${vColor};">${verdict}</span>
      </div>
      <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;margin-bottom:6px;">
        <div style="width:${100 - upPct}%;background:var(--red);opacity:0.55;" title="Median to 10th: ${v.downGap} pts"></div>
        <div style="width:${upPct}%;background:var(--green);opacity:0.55;" title="Median to 90th: ${v.upGap} pts"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9px;color:var(--text-muted);">
        <span>−${v.downGap} to floor</span>
        <span>ratio ${v.skewRatio}×</span>
        <span>+${v.upGap} to ceiling</span>
      </div>
    </div>`;
  }

  h += `</div>`;
  h += `<p style="font-size:11px;color:var(--text-muted);font-style:italic;margin:0 0 20px;">Week-to-week spread across ${v.games} games — this is start-to-start reliability, not a season-long projection range. Weekly swings partly cancel over a full season, so the two are not interchangeable. Ranks measured against every ${posLabel} who touched the ball that week. Source: nflverse, REG season, PPR.</p>`;
  return h;
}

// ===== WEEKLY GAME LOGS (lazy) =====
// Season totals ship in stats.json (~31KB, loaded on init). The weekly logs are
// ~188KB and only ever render inside an open profile modal, so they are fetched
// on demand and cached for the rest of the session. Logs are sharded one
// file per player (data/weekly/<id>.json) so a profile open costs ~8KB,
// not the whole league's logs.
const weeklyCache = {};

function ensureWeeklyStats(playerId) {
  if (!(playerId in weeklyCache)) {
    weeklyCache[playerId] = loadJSON(`data/weekly/${playerId}.json`).then(d => d || {});
  }
  return weeklyCache[playerId];
}

// ===== NEXT GEN STATS (profile section) =====
// Season-level tracking data (separation, CPOE, box counts) + snap share,
// built by scripts/fetch-ngs.js. One file for the whole pool, fetched on
// first profile open and cached. Missing metrics render as em-dashes,
// missing players render as nothing.
let ngsAllPromise = null;
function ensureNgs() {
  if (!ngsAllPromise) ngsAllPromise = loadJSON('data/ngs.json').then(d => d || {});
  return ngsAllPromise;
}

async function loadNgsSection(playerId, pos) {
  const data = await ensureNgs();
  const el = document.getElementById('ngsSlot');
  if (!el || currentProfileId !== playerId) return;
  const seasons = data[playerId];
  if (!seasons) { el.innerHTML = ''; return; }

  const fmt = v => (v === null || v === undefined) ? '—' : v;
  const sign = v => (v === null || v === undefined) ? '—'
    : `<span style="color:${v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text)'};">${v > 0 ? '+' : ''}${v}</span>`;

  // [header, tooltip, cellFn]
  let spec;
  if (pos === 'QB') {
    spec = [
      ['TT', 'Average time to throw, in seconds', s => s.pass && fmt(s.pass.timeToThrow)],
      ['AGG%', 'Aggressiveness — share of throws into tight windows (defender within 1 yard)', s => s.pass && fmt(s.pass.aggressiveness)],
      ['iAY', 'Average intended air yards per attempt', s => s.pass && fmt(s.pass.iay)],
      ['Comp%', 'Completion percentage', s => s.pass && fmt(s.pass.compPct)],
      ['xComp%', 'Expected completion percentage, given the difficulty of each throw', s => s.pass && fmt(s.pass.xCompPct)],
      ['CPOE', 'Completion percentage over expected — accuracy after adjusting for throw difficulty', s => s.pass && sign(s.pass.cpoe)]
    ];
  } else if (pos === 'RB') {
    spec = [
      ['EFF', 'Rushing efficiency — yards traveled per yard gained; lower is more direct (north/south)', s => s.rush && fmt(s.rush.efficiency)],
      ['8+BOX%', 'Share of carries against 8 or more defenders in the box', s => s.rush && fmt(s.rush.eightBoxPct)],
      ['TLOS', 'Average time behind the line of scrimmage, in seconds', s => s.rush && fmt(s.rush.timeToLos)]
    ];
  } else {
    spec = [
      ['SEP', 'Average separation from the nearest defender at pass arrival, in yards', s => s.rec && fmt(s.rec.separation)],
      ['CUSH', 'Average cushion at the snap, in yards', s => s.rec && fmt(s.rec.cushion)],
      ['iAY', 'Average intended air yards per target', s => s.rec && fmt(s.rec.iay)],
      ['iAY SH%', "Share of the team's intended air yards", s => s.rec && fmt(s.rec.iayShare)],
      ['xYAC/R', 'Expected yards after catch per reception, given position and defenders', s => s.rec && fmt(s.rec.xYac)],
      ['YAC/R', 'Actual yards after catch per reception', s => s.rec && fmt(s.rec.yac)],
      ['YAC +/-', 'YAC over expected — what the player creates beyond the situation', s => s.rec && sign(s.rec.yacOE)]
    ];
  }

  const years = Object.keys(seasons).sort();
  const rows = years.filter(yr => {
    const s = seasons[yr];
    return s.snapPct !== undefined || spec.some(([, , cell]) => cell(s));
  });
  if (!rows.length) { el.innerHTML = ''; return; }

  let h = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1.5px;text-transform:uppercase;margin:20px 0 12px;">Next Gen Stats &amp; Snap Share</div>`;
  h += `<div style="overflow-x:auto;margin-bottom:20px;"><table style="width:100%;border-collapse:collapse;font-size:13px;white-space:nowrap;">`;
  h += '<thead><tr style="border-bottom:2px solid var(--border);">';
  ['Year', 'Snap%', ...spec.map(c => c[0])].forEach((c, i) => {
    const tip = i === 0 ? '' : i === 1 ? 'Share of team offensive snaps, snap-weighted across games played' : spec[i - 2][1];
    h += `<th ${tip ? `data-tip="${rankEsc(tip)}"` : ''} style="padding:8px 6px;text-align:left;font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:0.5px;text-transform:uppercase;${tip ? 'cursor:help;text-decoration:underline dotted;' : ''}">${c}</th>`;
  });
  h += '</tr></thead><tbody>';
  rows.forEach(yr => {
    const s = seasons[yr];
    h += `<tr style="border-bottom:1px solid var(--border-subtle);">
      <td style="padding:8px 6px;font-weight:600;color:var(--gold);font-family:var(--mono);">${yr}</td>
      <td style="padding:8px 6px;font-weight:600;">${fmt(s.snapPct)}${s.snapPct !== undefined ? '%' : ''}</td>`;
    spec.forEach(([, , cell]) => { h += `<td style="padding:8px 6px;">${cell(s) || '—'}</td>`; });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  el.innerHTML = h;
}

// ===== OFFICIAL INJURY REPORT =====
// The NFL's own weekly report, via nflverse. This is a RECORD of what the
// team declared, not analysis — and it has one limit worth stating on the
// page: a player placed on IR drops off the report entirely, so the weeks
// listed here undercount a season-ending injury rather than capturing it.
// Games actually missed live in the availability figure on Rankings.
let injAllPromise = null;
function ensureInjuries() {
  if (!injAllPromise) injAllPromise = loadJSON('data/injuries.json').then(d => d || {});
  return injAllPromise;
}

async function loadInjuryReport(playerId) {
  const data = await ensureInjuries();
  const el = document.getElementById('injReportSlot');
  if (!el || currentProfileId !== playerId) return;
  el.innerHTML = injuryReportHtml(data[playerId]);
}

// The Medicals page shows this same block, so it is built in one place. A
// second copy would drift, and the caveat at the bottom is the part that must
// never go missing.
function injuryReportHtml(seasons) {
  if (!seasons || !Object.keys(seasons).length) return '';

  const years = Object.keys(seasons).sort().reverse();
  let h = `<div style="font-family:var(--mono);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);margin:24px 0 10px;">Official Injury Report</div>`;
  h += `<div style="font-size:12.5px;color:var(--text-secondary);line-height:1.6;margin-bottom:14px;">Every week this player appeared on his team's official injury report, grouped into episodes by body part. Most listings are a tag he played through — the Out count is the weeks the team ruled him out.</div>`;

  years.forEach(yr => {
    const s = seasons[yr];
    if (!s.episodes || !s.episodes.length) return;
    h += `<div class="medical-card" style="margin-bottom:10px;padding:16px 18px;">`;
    h += `<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:10px;">`
      + `<span style="font-family:var(--mono);font-size:12px;color:var(--gold);font-weight:600;">${yr}</span>`
      + `<span style="font-family:var(--mono);font-size:10px;color:var(--text-muted);">${s.weeksListed} WEEK${s.weeksListed === 1 ? '' : 'S'} LISTED${s.gamesOut ? ` · ${s.gamesOut} RULED OUT` : ''}</span></div>`;
    h += s.episodes.map(e => {
      const span = e.firstWeek === e.lastWeek ? `Wk ${e.firstWeek}` : `Wk ${e.firstWeek}–${e.lastWeek}`;
      const worst = e.statuses && e.statuses.length ? e.statuses.join(', ') : null;
      return `<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-top:1px solid var(--border-subtle);font-size:13px;">`
        + `<span style="color:var(--text);">${rankEsc(e.part)}</span>`
        + `<span style="font-family:var(--mono);font-size:11px;color:var(--text-muted);white-space:nowrap;">${span}`
        + (e.gamesOut ? ` · <span style="color:var(--red);">${e.gamesOut} out</span>` : (worst ? ` · ${rankEsc(worst)}` : ''))
        + `</span></div>`;
    }).join('');
    h += `</div>`;
  });

  h += `<div style="font-size:11px;color:var(--text-muted);font-style:italic;line-height:1.6;margin-top:8px;">Source: NFL official injury reports via nflverse. A player moved to injured reserve comes off the weekly report, so a season-ending injury shows up here as the weeks before it and then silence — this counts report appearances, not games missed.</div>`;
  return h;
}

// ===== RETURN TO PLAY =====
// Weekly production after a dated injury, against the player's own level
// before it. This is the medical database crossed with the game logs, so the
// honesty bar is high: the injury week comes from a hand-entered event that
// was checked against the game log, the injury game itself belongs to
// neither side (it is a partial game), and a baseline built from too few
// games is reported as too thin rather than drawn.
const RTP_MIN_BASELINE = 4;
const RTP_MIN_RETURN = 3;
const RTP_MAX_POINTS = 18;

function rtpSplit(seasonsLog, ev) {
  const before = [], after = [];
  for (const [yrStr, games] of Object.entries(seasonsLog || {})) {
    const yr = Number(yrStr);
    for (const g of games) {
      if (typeof g.fpts !== 'number') continue;
      const rec = { yr, week: g.week, fpts: g.fpts, opp: g.opp };
      if (yr < ev.outSeason || (yr === ev.outSeason && g.week < ev.outWeek)) before.push(rec);
      else if (yr > ev.outSeason || (yr === ev.outSeason && g.week > ev.outWeek)) after.push(rec);
    }
  }
  const bySeq = (a, b) => a.yr - b.yr || a.week - b.week;
  return { before: before.sort(bySeq), after: after.sort(bySeq) };
}

// Prefer the injury season's own games; reach back only far enough to get a
// usable sample, and always report which seasons were used.
function rtpBaseline(before, ev) {
  const picked = before.filter(g => g.yr === ev.outSeason);
  if (picked.length < 6) {
    const priors = [...new Set(before.map(g => g.yr))].filter(y => y < ev.outSeason).sort((a, b) => b - a);
    for (const y of priors) {
      picked.push(...before.filter(g => g.yr === y));
      if (picked.length >= 6) break;
    }
  }
  return picked;
}

function rtpMedian(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  return Math.round(v * 10) / 10;
}

async function loadReturnToPlay(playerId, slotId, ev, title) {
  const seasons = await ensureWeeklyStats(playerId);
  const el = document.getElementById(slotId);
  if (!el || currentProfileId !== playerId) return;

  const { before, after } = rtpSplit(seasons, ev);
  const baseGames = rtpBaseline(before, ev);
  const research = ev.researchKey && injuryResearch ? injuryResearch[ev.researchKey] : null;

  const head = `<div style="font-family:var(--mono);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--teal);margin-bottom:10px;">Return to Play</div>`;
  const note = (msg) => `<div class="medical-card" style="margin-top:-4px;margin-bottom:16px;border-left:3px solid var(--teal);">${head}<div class="medical-detail">${msg}</div></div>`;

  if (after.length === 0) {
    el.innerHTML = note(`No regular-season games on record since this injury (${ev.outSeason} week ${ev.outWeek}), so there is nothing to plot yet. This section fills in once he plays.`);
    return;
  }
  if (baseGames.length < RTP_MIN_BASELINE) {
    el.innerHTML = note(`Only ${baseGames.length} game${baseGames.length === 1 ? '' : 's'} on record before this injury. A "before" level built from that few games would be noise, so no comparison is drawn.`);
    return;
  }
  if (after.length < RTP_MIN_RETURN) {
    el.innerHTML = note(`Only ${after.length} game${after.length === 1 ? '' : 's'} back so far. That is too few to read a recovery curve from, so the numbers are left to the game log above.`);
    return;
  }

  const baseline = rtpMedian(baseGames.map(g => g.fpts));
  const pts = after.slice(0, RTP_MAX_POINTS);
  const firstN = Math.min(5, pts.length);
  const firstMed = rtpMedian(pts.slice(0, firstN).map(g => g.fpts));
  const allMed = rtpMedian(after.map(g => g.fpts));
  const baseSeasons = [...new Set(baseGames.map(g => g.yr))].sort().join('–');
  const delta = Math.round((allMed - baseline) * 10) / 10;

  const max = Math.max(...pts.map(g => g.fpts), baseline);
  if (!(max > 0)) { el.innerHTML = ''; return; }
  const PLOT = 92;
  const hOf = v => Math.max(Math.round((v / max) * PLOT), 2);

  let cols = '', xrow = '', prevYr = pts[0].yr;
  pts.forEach((g, i) => {
    const boundary = g.yr !== prevYr;
    prevYr = g.yr;
    const tip = `Game ${i + 1} back — ${g.yr} week ${g.week} vs ${g.opp || '?'}: ${g.fpts} PPR (baseline ${baseline})`;
    cols += `<div class="wk-slot"${boundary ? ' style="border-left:1px solid var(--border-hover);"' : ''}>`
      + `<div class="wk-bar" data-tip="${rankEsc(tip)}" style="height:${hOf(g.fpts)}px;background:#a8893a;"></div></div>`;
    xrow += `<div class="wk-x">${i + 1}</div>`;
  });

  const tile = (label, val, sub) => `<div class="medical-card" style="padding:14px;text-align:center;">
    <div style="font-family:var(--serif);font-size:24px;font-weight:700;color:var(--gold);">${val}</div>
    <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;margin-top:5px;">${label}</div>
    ${sub ? `<div style="font-size:10px;color:var(--text-muted);margin-top:3px;">${sub}</div>` : ''}</div>`;

  let h = `<div class="medical-card" style="margin-top:-4px;margin-bottom:16px;border-left:3px solid var(--teal);">`;
  h += head;
  h += `<div style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:16px;">Weekly PPR after returning from this injury, against his own median week beforehand. Games are counted from his first game back, not by calendar week.</div>`;

  h += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px;">`
    + tile('Median week before', baseline, `${baseGames.length} games · ${baseSeasons}`)
    + tile(`First ${firstN} back`, firstMed, 'median')
    + tile('Since return', allMed, `${after.length} games · ${delta >= 0 ? '+' : ''}${delta} vs before`)
    + `</div>`;

  h += `<div class="wk-chart"><div class="wk-chart-head"><span>Weekly PPR since return</span><span>PPR</span></div>`;
  h += `<div class="rtp-plot"><div class="rtp-base" style="bottom:${hOf(baseline)}px;"></div>`
    + `<div class="rtp-base-lab" style="bottom:${hOf(baseline) + 3}px;">BEFORE ${baseline}</div>`
    + `<div class="wk-cols">${cols}</div></div>`;
  h += `<div class="wk-xrow">${xrow}</div>`;
  h += `<div style="font-family:var(--mono);font-size:8.5px;color:var(--text-muted);text-align:center;margin-top:4px;letter-spacing:1px;">GAMES SINCE RETURN</div></div>`;

  if (after.length > pts.length) {
    h += `<div class="rank-note">Showing his first ${pts.length} games back; the full log is on the Stats tab.</div>`;
  }

  if (research) {
    h += `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border-subtle);font-size:12.5px;color:var(--text-secondary);line-height:1.6;">
      <strong style="color:var(--text);">${rankEsc(research.name)} research context:</strong> ${rankEsc(research.performanceLabel || '')}
      ${research.avgReturn ? ` Typical return window is ${rankEsc(research.avgReturn)}.` : ''}</div>`;
  }

  h += `<div style="margin-top:12px;font-size:11.5px;color:var(--text-muted);font-style:italic;line-height:1.6;">`
    + (ev.caveat ? rankEsc(ev.caveat) + ' ' : '')
    + `A return curve is not a controlled comparison — age, scheme, team and role all move alongside the injury. Read it as description, not attribution.</div>`;
  h += `</div>`;

  // Table twin: every plotted value reachable without the chart.
  h += `<details class="rtp-table"><summary>Table view — games since return</summary>`
    + `<div class="table-scroll"><table class="players-table rank-table" style="margin-top:8px;"><thead><tr><th>#</th><th>Season</th><th>Wk</th><th>Opp</th><th>PPR</th><th>vs before</th></tr></thead><tbody>`
    + pts.map((g, i) => {
      const d = Math.round((g.fpts - baseline) * 10) / 10;
      return `<tr><td>${i + 1}</td><td>${g.yr}</td><td>${g.week}</td><td>${rankEsc(g.opp || '')}</td><td>${g.fpts}</td><td>${d >= 0 ? '+' : ''}${d}</td></tr>`;
    }).join('')
    + `</tbody></table></div></details>`;

  el.innerHTML = h;
}

// ===== WEEKLY PROFILE CHARTS =====
// Columns sit on a full week 1→N axis so a missed week is a visible hole,
// not a silently closed gap — injury absences are part of the story. The
// game-log table right below is the table-view twin for both charts.
function vizWeeklyColumns(title, unit, log, valueOf, tipOf, color, season) {
  const played = log.filter(w => typeof valueOf(w) === 'number');
  if (played.length < 3) return '';
  // A finished season runs the full 18-week axis, so a season-ending injury
  // reads as a run of empty slots. An in-progress season ends at the last
  // played week — weeks that haven't happened yet are not "missed".
  const seasonOver = Number(season) < new Date().getFullYear();
  const maxWeek = seasonOver ? 18 : Math.max(...log.map(w => w.week));
  const byWeek = new Map(log.map(w => [w.week, w]));
  const max = Math.max(...played.map(valueOf));
  if (!(max > 0)) return '';
  const PLOT = 74; // px; bar of `max` fills it, its label rides above

  let cols = '', xrow = '';
  const thin = maxWeek > 10; // label every other week when crowded
  for (let wk = 1; wk <= maxWeek; wk++) {
    const w = byWeek.get(wk);
    const v = w ? valueOf(w) : null;
    if (typeof v === 'number') {
      const h = Math.max(Math.round((v / max) * PLOT), 2);
      const lab = v === max ? `<div class="wk-lab">${v}</div>` : '';
      cols += `<div class="wk-slot">${lab}<div class="wk-bar" data-tip="${rankEsc(tipOf(w, v))}" style="height:${h}px;background:${color};"></div></div>`;
    } else {
      cols += `<div class="wk-slot"></div>`;
    }
    xrow += `<div class="wk-x">${(thin && wk % 2 === 0) ? '' : wk}</div>`;
  }

  return `<div class="wk-chart">`
    + `<div class="wk-chart-head"><span>${rankEsc(title)}</span><span>${rankEsc(unit)}</span></div>`
    + `<div class="wk-cols">${cols}</div>`
    + `<div class="wk-xrow">${xrow}</div>`
    + `</div>`;
}

function weeklyCharts(log, pos, season) {
  const fpts = vizWeeklyColumns(
    `${season} Weekly Fantasy Points`, 'PPR',
    log, w => (typeof w.fpts === 'number' ? w.fpts : null),
    (w, v) => `W${w.week} vs ${w.opp || '?'} — ${v} PPR pts`,
    '#a8893a', season);
  const usageVal = pos === 'QB'
    ? (w => (typeof w.att === 'number' ? w.att : null))
    : pos === 'RB'
      ? (w => (typeof w.car === 'number' || typeof w.tgt === 'number' ? (w.car || 0) + (w.tgt || 0) : null))
      : (w => (typeof w.tgt === 'number' ? w.tgt : null));
  const usageName = pos === 'QB' ? 'Pass Attempts' : pos === 'RB' ? 'Touches' : 'Targets';
  const usageUnit = pos === 'RB' ? 'CARRIES + TARGETS' : '';
  const usage = vizWeeklyColumns(
    `${season} Weekly ${usageName}`, usageUnit,
    log, usageVal,
    (w, v) => `W${w.week} vs ${w.opp || '?'} — ${v} ${usageName.toLowerCase()}`,
    '#1ba89b', season);
  return fpts + usage;
}

async function loadWeeklyLog(playerId, season, pos) {
  const seasons = await ensureWeeklyStats(playerId);
  // The modal may have been closed or switched tabs while this was in flight.
  const slot = document.getElementById('gameLogSlot');
  if (!slot || currentProfileId !== playerId) return;

  const log = seasons[season];
  if (!log || !log.length) { slot.innerHTML = ''; return; }

  const isQB = pos === 'QB';
  const isRB = pos === 'RB';
  const cols = isQB ? ['Wk','Opp','C/A','PaYds','PaTD','INT','RuYds','RuTD','EPA','FPTS']
    : isRB ? ['Wk','Opp','Car','RuYds','RuTD','Tgt','Rec','RecYds','RecTD','FPTS']
    : ['Wk','Opp','Tgt','Rec','Yds','TD','aDOT','YAC','EPA','FPTS'];

  let h = weeklyCharts(log, pos, season);
  h += `<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">${season} Game Log</div>`;
  h += `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;"><table style="width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap;">`;
  h += '<thead><tr style="border-bottom:2px solid var(--border);">';
  cols.forEach(c => h += `<th style="padding:6px 5px;text-align:left;font-family:var(--mono);font-size:8px;color:var(--text-muted);text-transform:uppercase;">${c}</th>`);
  h += '</tr></thead><tbody>';

  const cell = (v, style) => `<td style="padding:6px 5px;${style || ''}">${v === null || v === undefined ? '—' : v}</td>`;
  const epaColor = v => `color:${v > 0 ? 'var(--green)' : 'var(--red)'};`;
  const signed = v => (v === null || v === undefined) ? '—' : (v > 0 ? '+' : '') + v;

  log.forEach(w => {
    h += `<tr style="border-bottom:1px solid var(--border-subtle);">`;
    h += cell(w.week, 'font-family:var(--mono);font-size:11px;');
    h += cell(w.opp, 'font-weight:600;');
    if (isQB) {
      h += cell(`${w.cmp}/${w.att}`);
      h += cell(w.passYds, 'font-weight:600;');
      h += cell(w.passTD, 'color:var(--green);');
      h += cell(w.int, w.int > 0 ? 'color:var(--red);' : 'color:var(--text-muted);');
      h += cell(w.rushYds);
      h += cell(w.rushTD, 'color:var(--green);');
      h += cell(signed(w.passEPA), epaColor(w.passEPA));
    } else if (isRB) {
      h += cell(w.car);
      h += cell(w.rushYds, 'font-weight:600;');
      h += cell(w.rushTD, 'color:var(--green);');
      h += cell(w.tgt);
      h += cell(w.rec);
      h += cell(w.recYds);
      h += cell(w.recTD, 'color:var(--green);');
    } else {
      h += cell(w.tgt);
      h += cell(w.rec);
      h += cell(w.recYds, 'font-weight:600;');
      h += cell(w.recTD, 'color:var(--green);');
      h += cell(w.aDOT);
      h += cell(w.yac);
      h += cell(signed(w.recEPA), epaColor(w.recEPA));
    }
    h += cell(w.fpts, 'font-weight:600;color:var(--gold);');
    h += `</tr>`;
  });

  h += '</tbody></table></div>';
  slot.innerHTML = h;
}

// ===== RADAR CHARTS =====
// Extracts the percentile axes for a player. Returns null if too sparse to plot.
function getRadarAxes(player, kind) {
  const num = v => (v === null || v === undefined || isNaN(v)) ? null : Number(v);
  let axes;

  if (kind === 'athletic') {
    // athleticismPct is not published for anyone in our set, and QB athletic
    // percentiles are too sparse to plot honestly. Bars carry those instead.
    if (player.pos === 'QB') return null;
    axes = [
      { label: 'Speed', pct: num(player.speedPct) },
      { label: 'Explosion', pct: num(player.burstPct) },
      { label: 'Agility', pct: num(player.agilityPct) }
    ];
  } else { // production
    if (player.pos === 'QB') {
      axes = [
        { label: 'College QBR', pct: num(player.qbrPct) },
        { label: 'College YPA', pct: num(player.ypaPct) },
        { label: 'Breakout Age', pct: num(player.breakoutPct) }
      ];
    } else if (player.pos === 'RB') {
      axes = [
        { label: 'Dominator', pct: num(player.dominatorPct) },
        { label: 'College YPC', pct: num(player.ypcPct) },
        { label: 'Target Share', pct: num(player.targetSharePct) },
        { label: 'Breakout Age', pct: num(player.breakoutPct) }
      ];
    } else {
      axes = [
        { label: 'Dominator', pct: num(player.dominatorPct) },
        { label: 'Target Share', pct: num(player.targetSharePct) },
        { label: 'Breakout Age', pct: num(player.breakoutPct) }
      ];
    }
  }

  // Drop axes with no published percentile. Plotting them at the center would
  // read visually as "worst in class" when the truth is "not measured".
  const present = axes.filter(a => a.pct !== null);
  // Fewer than 3 axes cannot enclose an area — the bars below say it better.
  if (present.length < 3) return null;
  return present;
}

/**
 * Renders an SVG radar. `series` = [{ name, color, axes }].
 * All series must share the same axis labels in the same order —
 * use intersectAxes() to guarantee that before calling with multiple series.
 */
function renderRadar(series, opts) {
  opts = opts || {};
  const size = opts.size || 260;
  const cx = size / 2, cy = size / 2;
  const r = (size / 2) - 46; // leave room for labels
  const rings = [25, 50, 75, 100];
  const axes = series[0].axes;
  const n = axes.length;

  const angleFor = i => (Math.PI * 2 * i / n) - (Math.PI / 2);
  const pointAt = (i, pct) => {
    const a = angleFor(i);
    const rad = (pct / 100) * r;
    return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
  };

  let svg = `<svg viewBox="0 0 ${size} ${size}" style="width:100%;max-width:${size}px;height:auto;display:block;margin:0 auto;">`;

  // Rings
  rings.forEach(ring => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = pointAt(i, ring);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    svg += `<polygon points="${pts.join(' ')}" fill="none" stroke="var(--border)" stroke-width="1"/>`;
  });

  // Spokes + labels
  for (let i = 0; i < n; i++) {
    const [x, y] = pointAt(i, 100);
    svg += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>`;
    const a = angleFor(i);
    const lx = cx + Math.cos(a) * (r + 24);
    const ly = cy + Math.sin(a) * (r + 24);
    let anchor = 'middle';
    if (Math.cos(a) > 0.3) anchor = 'start';
    else if (Math.cos(a) < -0.3) anchor = 'end';
    svg += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}" font-family="var(--mono)" font-size="9" fill="var(--text-secondary)" letter-spacing="0.5">${axes[i].label}</text>`;
  }

  // Series polygons
  series.forEach(s => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = pointAt(i, s.axes[i].pct);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    svg += `<polygon points="${pts.join(' ')}" fill="${s.color}" fill-opacity="0.16" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    for (let i = 0; i < n; i++) {
      const [x, y] = pointAt(i, s.axes[i].pct);
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${s.color}"><title>${s.name} — ${s.axes[i].label}: ${s.axes[i].pct}th</title></circle>`;
    }
  });

  svg += `</svg>`;
  return svg;
}

/**
 * Reduces a set of players' axes to the labels every one of them has.
 * Returns null if fewer than 3 axes survive — an overlay on non-shared
 * axes would compare a measured value against nothing.
 */
function intersectAxes(axesList) {
  if (!axesList.length || axesList.some(a => !a)) return null;
  const shared = axesList[0]
    .map(a => a.label)
    .filter(label => axesList.every(list => list.some(a => a.label === label)));
  if (shared.length < 3) return null;
  return axesList.map(list => shared.map(label => list.find(a => a.label === label)));
}

function radarBlock(title, series, note) {
  let h = `<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">${title}</div>`;
  h += `<div class="medical-card" style="margin-bottom:16px;padding:16px 12px;">`;
  h += renderRadar(series);
  if (series.length > 1) {
    h += `<div style="display:flex;justify-content:center;gap:16px;flex-wrap:wrap;margin-top:12px;">`;
    series.forEach(s => {
      h += `<div style="display:flex;align-items:center;gap:6px;">
        <span style="width:10px;height:10px;border-radius:2px;background:${s.color};display:inline-block;"></span>
        <span style="font-size:12px;color:var(--text-secondary);">${s.name}</span>
      </div>`;
    });
    h += `</div>`;
  }
  h += `</div>`;
  if (note) h += `<p style="font-size:11px;color:var(--text-muted);font-style:italic;margin:0 0 16px;">${note}</p>`;
  return h;
}

// ===== PLAYER COMPARISON =====
const COMPARE_COLORS = ['var(--gold)', 'var(--teal)', 'var(--blue)'];
let comparePos = 'WR';
let compareSelected = [];

function renderComparePage() {
  const positions = ['QB', 'RB', 'WR', 'TE'];

  // Position tabs
  const tabs = document.getElementById('comparePosTabs');
  tabs.innerHTML = positions.map(p =>
    `<button onclick="setComparePos('${p}')" style="font-family:var(--mono);font-size:11px;letter-spacing:1px;padding:6px 14px;border-radius:6px;cursor:pointer;border:1px solid ${p === comparePos ? 'var(--gold)' : 'var(--border)'};background:${p === comparePos ? 'var(--gold-muted)' : 'transparent'};color:${p === comparePos ? 'var(--gold)' : 'var(--text-secondary)'};">${p}</button>`
  ).join('');

  // Roster chips for the active position
  const roster = playersDB.filter(p => p.pos === comparePos);
  const chips = document.getElementById('compareRoster');
  chips.innerHTML = roster.map(p => {
    const on = compareSelected.includes(p.id);
    const idx = compareSelected.indexOf(p.id);
    const col = on ? COMPARE_COLORS[idx] : 'var(--border)';
    return `<button onclick="toggleCompare('${p.id}')" style="display:flex;align-items:center;gap:8px;padding:6px 12px 6px 6px;border-radius:8px;cursor:pointer;border:1px solid ${col};background:${on ? 'var(--bg-card-hover)' : 'var(--bg-card)'};color:var(--text);">
      ${renderAvatar(p, 26, 9)}
      <span style="font-size:12px;font-weight:${on ? '600' : '400'};">${p.name}</span>
    </button>`;
  }).join('');

  const hint = document.getElementById('compareHint');
  hint.textContent = compareSelected.length === 0
    ? `Pick two or three ${comparePos}s to compare.`
    : compareSelected.length === 1
      ? 'Pick at least one more.'
      : compareSelected.length >= 3
        ? 'Three is the max — deselect one to swap.'
        : 'Add a third, or read the comparison below.';

  renderCompareOutput();
}

function setComparePos(pos) {
  if (pos === comparePos) return;
  comparePos = pos;
  compareSelected = []; // cross-position percentiles aren't comparable
  renderComparePage();
}

function toggleCompare(id) {
  const i = compareSelected.indexOf(id);
  if (i >= 0) compareSelected.splice(i, 1);
  else {
    if (compareSelected.length >= 3) return;
    compareSelected.push(id);
  }
  renderComparePage();
}

function renderCompareOutput() {
  const out = document.getElementById('compareOutput');
  if (compareSelected.length < 2) { out.innerHTML = ''; return; }

  const picks = compareSelected.map((id, i) => ({
    player: playersDB.find(p => p.id === id),
    color: COMPARE_COLORS[i]
  })).filter(x => x.player);

  let html = '';

  // --- Radars (only on axes every selected player actually has) ---
  const buildSeries = (kind) => {
    const raw = picks.map(({ player }) => getRadarAxes(player, kind));
    const aligned = intersectAxes(raw);
    if (!aligned) return null;
    return picks.map(({ player, color }, i) => ({ name: player.name, color, axes: aligned[i] }));
  };

  const prodSeries = buildSeries('production');
  const athSeries = buildSeries('athletic');

  const blocks = [];
  if (prodSeries) blocks.push(radarBlock('Production Shape', prodSeries));
  if (athSeries) blocks.push(radarBlock('Athletic Shape', athSeries));

  if (blocks.length) {
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:8px;">`;
    blocks.forEach(b => { html += `<div>${b}</div>`; });
    html += `</div>`;
    html += `<p style="font-size:11px;color:var(--text-muted);font-style:italic;margin:0 0 28px;">Percentile ranks within position, drawn only on axes every selected player has on record. Exact values in the tables below.</p>`;
  } else {
    html += `<div class="medical-card" style="margin-bottom:20px;"><div class="medical-detail">These players don't share enough published percentiles to overlay a radar honestly. The tables below carry everything that is on record.</div></div>`;
  }

  // --- Career stat comparison (nflverse) ---
  const withStats = picks.filter(({ player }) => playerStats[player.id]);
  if (withStats.length >= 2) {
    const rows = comparePos === 'QB'
      ? [['Games','games'],['Pass Yds','passYds'],['Pass TD','passTD'],['INT','int'],['Cmp %','compPct','%'],['YPA','ypa'],['Sack %','sackPct','%'],['Rush Yds','rushYds'],['Rush TD','rushTD'],['Pass EPA','passEPA'],['Fantasy PPG','fantasyPPG']]
      : comparePos === 'RB'
      ? [['Games','games'],['Carries','carries'],['Rush Yds','rushYds'],['YPC','ypc'],['Rush TD','rushTD'],['Targets','targets'],['Rec','rec'],['Rec Yds','recYds'],['Rec TD','recTD'],['Catch %','catchPct','%'],['Tgt Share','tgtShare','%'],['Fantasy PPG','fantasyPPG']]
      : [['Games','games'],['Targets','targets'],['Rec','rec'],['Rec Yds','recYds'],['Rec TD','recTD'],['Catch %','catchPct','%'],['aDOT','aDOT'],['YAC/Rec','yacPerRec'],['Tgt Share','tgtShare','%'],['Air Yd Share','airYardShare','%'],['Fantasy PPG','fantasyPPG']];

    // Use each player's most recent season
    const latest = withStats.map(({ player, color }) => {
      const seasons = Object.values(playerStats[player.id].seasons).sort((a, b) => b.season - a.season);
      return { player, color, s: seasons[0] };
    });

    html += `<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">Most Recent Season</div>`;
    html += `<div class="medical-card" style="padding:0;overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:8px;">`;
    html += `<table style="width:100%;border-collapse:collapse;font-size:13px;">`;
    html += `<thead><tr style="border-bottom:2px solid var(--border);">
      <th style="padding:12px 14px;text-align:left;font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;">Metric</th>`;
    latest.forEach(({ player, color, s }) => {
      html += `<th style="padding:12px 14px;text-align:right;font-size:13px;font-weight:600;color:${color};white-space:nowrap;">${player.name}<div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);font-weight:400;letter-spacing:0.5px;">${s.season}</div></th>`;
    });
    html += `</tr></thead><tbody>`;

    rows.forEach(([label, key, suffix]) => {
      const vals = latest.map(({ s }) => (s[key] === null || s[key] === undefined) ? null : s[key]);
      const nums = vals.filter(v => v !== null);
      // INT and Sack% are stats where lower is better
      const lowerBetter = (key === 'int' || key === 'sackPct');
      const best = nums.length > 1 ? (lowerBetter ? Math.min(...nums) : Math.max(...nums)) : null;

      html += `<tr style="border-bottom:1px solid var(--border-subtle);">
        <td style="padding:10px 14px;color:var(--text-secondary);">${label}</td>`;
      vals.forEach(v => {
        const isBest = best !== null && v === best && nums.length > 1 && new Set(nums).size > 1;
        html += `<td style="padding:10px 14px;text-align:right;font-family:var(--mono);font-weight:${isBest ? '700' : '400'};color:${isBest ? 'var(--green)' : 'var(--text)'};">${v === null ? '—' : v.toLocaleString()}${v === null ? '' : (suffix || '')}</td>`;
      });
      html += `</tr>`;
    });
    html += `</tbody></table></div>`;
    html += `<p style="font-size:11px;color:var(--text-muted);font-style:italic;margin:0 0 28px;">Green marks the better figure. Seasons may differ in length or year — check the header before drawing conclusions. Source: nflverse, REG season, PPR.</p>`;
  }

  // --- Combine measurables ---
  const measure = [['Height','height'],['Weight','weight',' lbs'],['40-Yard','fortyTime','s'],['Vertical','vertical'],['Broad Jump','broadJump'],['3-Cone','threeConeDrill','s'],['Shuttle','shuttle','s'],['Bench','benchPress',' reps'],['Arm Length','armLength'],['Hand Size','handSize']];
  const anyMeasure = measure.some(([, k]) => picks.some(({ player }) => player[k]));
  if (anyMeasure) {
    html += `<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">Measurables</div>`;
    html += `<div class="medical-card" style="padding:0;overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:8px;">`;
    html += `<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="border-bottom:2px solid var(--border);">
      <th style="padding:12px 14px;text-align:left;font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;">Metric</th>`;
    picks.forEach(({ player, color }) => {
      html += `<th style="padding:12px 14px;text-align:right;font-size:13px;font-weight:600;color:${color};white-space:nowrap;">${player.name}</th>`;
    });
    html += `</tr></thead><tbody>`;
    measure.forEach(([label, key, suffix]) => {
      if (!picks.some(({ player }) => player[key])) return;
      html += `<tr style="border-bottom:1px solid var(--border-subtle);">
        <td style="padding:10px 14px;color:var(--text-secondary);">${label}</td>`;
      picks.forEach(({ player }) => {
        const v = player[key];
        html += `<td style="padding:10px 14px;text-align:right;font-family:var(--mono);">${v ? v + (suffix || '') : '—'}</td>`;
      });
      html += `</tr>`;
    });
    html += `</tbody></table></div>`;
    html += `<p style="font-size:11px;color:var(--text-muted);font-style:italic;margin:0 0 28px;">Blank means not on record — no combine result published, not a zero.</p>`;
  }

  // --- Injury flags ---
  const withMed = picks.filter(({ player }) => medicalDB[player.id] && medicalDB[player.id].injuries.length);
  if (withMed.length) {
    html += `<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">Medical Flags</div>`;
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:12px;">`;
    picks.forEach(({ player, color }) => {
      const med = medicalDB[player.id];
      html += `<div class="medical-card" style="border-left:3px solid ${color};">
        <div style="font-weight:600;font-size:14px;margin-bottom:8px;">${player.name}</div>`;
      if (med && med.injuries.length) {
        const worst = Math.max(...med.injuries.map(i => i.impact));
        const risk = worst > 50 ? 'High' : worst > 25 ? 'Moderate' : 'Low';
        const rc = worst > 50 ? 'var(--red)' : worst > 25 ? 'var(--gold)' : 'var(--green)';
        html += `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">${med.injuries.length} record${med.injuries.length !== 1 ? 's' : ''} · <span style="color:${rc};font-weight:600;">${risk} impact</span></div>`;
        med.injuries.slice(0, 3).forEach(inj => {
          html += `<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">· ${inj.title.split('—')[0].trim()}</div>`;
        });
        if (med.injuries.length > 3) html += `<div style="font-size:11px;color:var(--text-muted);font-style:italic;margin-top:6px;">+${med.injuries.length - 3} more — open the profile</div>`;
      } else {
        html += `<div style="font-size:12px;color:var(--text-muted);">No records on file.</div>`;
      }
      html += `</div>`;
    });
    html += `</div>`;
    html += `<p style="font-size:11px;color:var(--text-muted);font-style:italic;margin:0;">Impact scores are our own research estimates, not a medical opinion.</p>`;
  }

  out.innerHTML = html;
}

// ===== DYNAMIC HERO SIDEBAR =====
function renderHeroSidebar() {
  const container = document.getElementById('heroSidebarStories');
  if (!container) return;

  const stories = [];

  // Pull from articles (published first, then drafts)
  const articleList = Object.values(articlesDB);
  articleList.forEach(a => {
    stories.push({
      title: a.title,
      tag: a.tag,
      tagClass: a.tagClass,
      meta: `By <span>${a.author || 'Adi'}</span> · ${a.readTime || ''}`,
      onclick: `openArticle('${a.slug}')`
    });
  });

  // Fill remaining slots with top medical profiles (highest impact, non-healthy)
  if (stories.length < 5) {
    const medWatch = Object.entries(medicalDB)
      .map(([id, med]) => {
        const player = playersDB.find(p => p.id === id);
        if (!player) return null;
        const maxImpact = Math.max(...med.injuries.map(i => i.impact));
        const topInjury = med.injuries[0];
        return { id, player, topInjury, maxImpact, isNotHealthy: player.statusClass !== 'status-healthy' };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.isNotHealthy !== b.isNotHealthy) return a.isNotHealthy ? -1 : 1;
        return b.maxImpact - a.maxImpact;
      });

    for (const m of medWatch) {
      if (stories.length >= 5) break;
      const shortInjury = m.topInjury.title.split('—')[0].split('(')[0].trim();
      stories.push({
        title: `${m.player.name}: ${shortInjury} — Medical Profile`,
        tag: 'Injury Intel',
        tagClass: 'tag-injury',
        meta: `${m.player.pos} · ${m.player.team} · Impact: ${m.maxImpact}%`,
        onclick: `openProfile('${m.id}')`
      });
    }
  }

  container.innerHTML = stories.slice(0, 5).map((s, i) => `
    <div class="sidebar-story" onclick="${s.onclick}" style="cursor:pointer;">
      <span class="sidebar-story-num">${String(i + 1).padStart(2, '0')}</span>
      <div class="sidebar-story-tag ${s.tagClass}">${s.tag}</div>
      <h3>${s.title}</h3>
      <div class="sidebar-story-meta">${s.meta}</div>
    </div>
  `).join('');
}

// ===== DYNAMIC INJURY WATCH SIDEBAR =====
function renderInjuryWatch() {
  const container = document.getElementById('injuryWatchSidebar');
  if (!container || Object.keys(medicalDB).length === 0) return;

  // Sort players by top injury impact, show non-healthy players first
  const watchList = Object.entries(medicalDB)
    .map(([id, med]) => {
      const player = playersDB.find(p => p.id === id);
      if (!player) return null;
      const maxImpact = Math.max(...med.injuries.map(i => i.impact));
      const topInjury = med.injuries[0];
      const isNotHealthy = player.statusClass !== 'status-healthy';
      return { id, player, med, maxImpact, topInjury, isNotHealthy };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.isNotHealthy !== b.isNotHealthy) return a.isNotHealthy ? -1 : 1;
      return b.maxImpact - a.maxImpact;
    })
    .slice(0, 6);

  container.innerHTML = watchList.map(({ id, player, topInjury }) => {
    const shortInjury = topInjury.title.split('—')[0].split('(')[0].trim();
    return `<div class="player-quick" onclick="openProfile('${id}')">
      ${renderAvatar(player, 36, 12)}
      <div class="player-quick-info">
        <div class="player-quick-name">${player.name}</div>
        <div class="player-quick-detail">${player.pos} · ${player.team} · ${shortInjury}</div>
      </div>
      <span class="player-quick-status ${player.statusClass}">${player.status.split('(')[0].trim()}</span>
    </div>`;
  }).join('');
}

