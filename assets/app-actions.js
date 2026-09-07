/*
 * The Signal — every click, in one place
 *
 * WHY THIS FILE EXISTS. index.html carried 108 inline onclick handlers and
 * assets/*.js generated about sixty more. Not one inline <script> block — the
 * handlers alone were the entire reason the Content-Security-Policy had to say
 * `script-src 'self' 'unsafe-inline'`, and that directive is what made the XSS
 * found in the August audit exploitable WITH CSP ENFORCED. A policy that has to
 * allow inline script cannot stop an injected payload from running, so it was
 * protecting nothing that mattered.
 *
 * The fix is not a longer policy, it is having nothing to allow. Markup now
 * declares WHAT it wants — data-click="page" data-arg="rankings" — and the
 * dispatcher below decides HOW. One listener per event type on the document,
 * delegated, so markup rendered later needs no wiring and re-renders cannot
 * stack duplicate handlers.
 *
 * THIS ALSO RETIRES A CONSTRAINT. app-core.js opens by explaining that these
 * files share one global scope on purpose, because "an inline handler can only
 * see globals" and making them modules "would silently break every one of those
 * handlers". That is no longer true: the only thing that has to be reachable
 * from the markup is the action NAME, and the registry is the one place that
 * resolves it. Moving to modules is now a normal refactor rather than a
 * rewrite.
 *
 * ADDING A HANDLER: add a named action here and put data-click on the element.
 * Never add an inline on* attribute — tests/csp.test.js fails the build if one
 * appears, because a single one puts 'unsafe-inline' back in the policy.
 */

(function () {
  'use strict';

  // A click is a navigation more often than not, so preventDefault is the
  // default rather than something each action remembers. The handful that need
  // the browser's own behaviour are marked `raw`.
  const CLICK = {
    // --- navigation -----------------------------------------------------
    'page':          (el, ev, a) => switchPage(a),
    'page-nav':      (el, ev, a) => { switchPage(a); toggleMobileNav(); },
    'nav-toggle':    () => toggleMobileNav(),
    'nav':           (el, ev, a) => navigate(a),
    'players-search':() => {
      switchPage('players');
      // The field does not exist until the page has rendered.
      setTimeout(() => { const f = document.getElementById('playerSearchGlobal'); if (f) f.focus(); }, 100);
    },
    'scroll-to':     (el, ev, a) => {
      const t = document.getElementById(a);
      if (t) t.scrollIntoView({ behavior: 'smooth' });
    },
    'article':       (el, ev, a) => openArticle(a),

    // --- the board and the tables ---------------------------------------
    'vb-pos':        (el, ev, a) => setVbPos(a, el),
    'vb-view':       (el, ev, a) => setVbView(a, el),
    'rank-tab':      (el, ev, a) => setRankTab(a, el),
    'rank-view':     (el, ev, a) => setRankView(a, el),
    'rank-avail':    (el, ev, a) => setRankAvail(a === 'true', el),
    'rankings-view': (el, ev, a) => setRankingsView(a, el),
    'filter-pos':    (el, ev, a) => filterByPos(a, el),
    // Two arguments, so the second rides on data-arg2. More than two would be
    // a sign the action wants a name of its own rather than another slot.
    'table-sort':    (el, ev, a) => setTableSort(a, el.getAttribute('data-arg2')),
    'reset-filters': () => resetPlayerFilters(),

    // --- profile ---------------------------------------------------------
    'open-profile':  (el, ev, a) => openProfile(a),
    'profile-tab':   (el, ev, a) => switchProfileTab(a, el),
    'close-profile': () => closeProfile(),
    // The backdrop closes only when the backdrop itself was clicked, not when
    // the click merely bubbled out of the card sitting on top of it.
    'profile-backdrop': (el, ev) => { if (ev.target === el) closeProfile(); },
    'profile-nav':   (el, ev, a) => { closeProfile(); navigate(a); },
    'compare':       (el, ev, a) => toggleCompare(a),
    'compare-pos':   (el, ev, a) => setComparePos(a, el),

    // --- medicals --------------------------------------------------------
    'open-medical':  (el, ev, a) => openMedical(a),
    'close-medical': () => closeMedical(),
    'med-filter':    (el, ev, a) => setMedFilter(a, el),
    'med-jump':      (el, ev, a) => medJump(ev, a),
    'injury-mode':   (el, ev, a) => switchInjuryMode(a, el),
    'injury-detail': (el, ev, a) => showInjuryDetail(a),
    'injury-reset':  () => {
      const box = document.getElementById('injuryToolResults');
      if (box) box.innerHTML = '';
      renderInjuryTypeGrid();
    },
    'body-region':   (el, ev, a) => setBodyRegion(a, el),

    // --- teams, matchups, season, lab ------------------------------------
    'set-team':      (el, ev, a) => setTeam(a),
    'teams-view':    (el, ev, a) => setTeamsView(a, el),
    'sos-pos':       (el, ev, a) => setSosPos(a, el),
    'mu-pos':        (el, ev, a) => setMuPos(a, el),
    'mu-season':     (el, ev, a) => setMuSeason(a, el),
    'season-view':   (el, ev, a) => setSeasonView(a, el),
    'draft-view':    (el, ev, a) => setDraftView(a, el),
    'lab-pos':       (el, ev, a) => setLabPos(a, el),
    'lab-view':      (el, ev, a) => setLabView(a, el),
    'lab-mode':      (el, ev, a) => setLabMode(a, el),
    'lab-metric':    (el, ev, a) => setLabMetric(a, el),
    'lab-season':    (el, ev, a) => setLabSeason(a, el),
    'field-grid':    (el, ev, a) => openFieldGrid(a),
    'close-field-grid': () => closeFieldGrid(),

    // --- feeds and Ask ----------------------------------------------------
    'news-filter':   (el, ev, a) => filterNews(a, el),
    'ask-about':     (el, ev, a) => askAbout(a),
    'ask-example':   (el) => askExample(el),

    // --- exports ----------------------------------------------------------
    // Named one per chart rather than passing a closure through an attribute:
    // an attribute that carries a function to call is the thing this file was
    // written to remove.
    'export-rank':        (el) => runExport(() => exportRowChart(rankExportSpec), rankExportSpec.title, el),
    'export-lab-board':   (el) => runExport(() => exportRowChart(labExportBoard), labExportBoard.title, el),
    'export-lab-scatter': (el) => runExport(() => exportScatterChart(labExportScatter), labExportScatter.title, el),
  };

  const INPUT = {
    'player-search':  (el) => filterPlayers(el.value),
    'medical-search': (el) => filterMedicals(el.value),
    'injury-search':  (el) => searchInjuryPlayer(el.value),
    'ask-count':      () => askCount(),
  };

  const CHANGE = {
    'player-filter':  (el, ev, a) => setPlayerFilter(a, el.value),
    'profile-compare':(el) => setProfileCompare(el.value),
    'med-sort':       (el) => setMedSort(el.value),
  };

  // Hover, for the one control that arms on pointer rather than on click.
  // mouseenter does not bubble; mouseover does, and `closest` makes the two
  // equivalent for this purpose.
  const HOVER = {
    'body-region': (el, ev, a) => setBodyRegion(a, el),
  };

  const SUBMIT = {
    'ask':        () => submitAsk(),
    'nav-search': (el) => mobileNavSearch(el.q.value),
  };

  function dispatch(table, attr, ev, prevent) {
    const el = ev.target.closest ? ev.target.closest(`[data-${attr}]`) : null;
    if (!el) return;
    const name = el.getAttribute(`data-${attr}`);
    const fn = table[name];
    if (!fn) {
      // Loud, because a typo in a data-click is otherwise a button that does
      // nothing and reports nothing.
      console.warn(`[actions] no ${attr} action named "${name}"`);
      return;
    }
    if (prevent && !el.hasAttribute('data-raw')) ev.preventDefault();
    fn(el, ev, el.getAttribute('data-arg'));
  }

  document.addEventListener('click',  (ev) => dispatch(CLICK,  'click',  ev, true));
  document.addEventListener('mouseover', (ev) => dispatch(HOVER, 'hover', ev, false));

  // ENTER AND SPACE ON ANYTHING CLICKABLE. One card used to carry its own
  // onkeydown for this; doing it here means every data-click element that is
  // focusable gets keyboard activation, which is a straight accessibility win
  // that fell out of the refactor rather than being asked for.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const el = ev.target.closest ? ev.target.closest('[data-click]') : null;
    if (!el || !el.hasAttribute('tabindex')) return;
    // A real button already does this for itself.
    if (el.tagName === 'BUTTON' || el.tagName === 'A') return;
    ev.preventDefault();
    el.click();
  });
  document.addEventListener('input',  (ev) => dispatch(INPUT,  'input',  ev, false));
  document.addEventListener('change', (ev) => dispatch(CHANGE, 'change', ev, false));
  document.addEventListener('submit', (ev) => dispatch(SUBMIT, 'submit', ev, true));

  // A HEADSHOT THAT 404s FALLS BACK TO INITIALS. `error` does not bubble, so
  // this listens in the capture phase — the one event here that cannot be
  // delegated the ordinary way.
  document.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!img || img.tagName !== 'IMG' || !img.hasAttribute('data-fb')) return;
    const initials = img.getAttribute('data-fb-initials') || '';
    if (img.getAttribute('data-fb') === 'chip') {
      const d = document.createElement('div');
      d.className = 'player-initials';
      d.style.background = img.getAttribute('data-fb-color') || '';
      d.style.width = d.style.height = (img.getAttribute('data-fb-size') || 36) + 'px';
      d.style.fontSize = (img.getAttribute('data-fb-font') || 14) + 'px';
      d.textContent = initials;
      img.replaceWith(d);
    } else {
      const parent = img.parentElement;
      img.remove();
      if (parent) parent.textContent = initials;
    }
  }, true);
})();
