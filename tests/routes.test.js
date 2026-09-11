/**
 * The route board — a small file with one large way to be wrong.
 *
 * THE CLAIM IS THE RISK. participation carries ONE route per play, the concept
 * the ball was thrown to, so this is what a player was TARGETED on. A real
 * route tree counts every route run whether or not the pass arrived and would
 * be roughly five times as many. The temptation to call this a route tree is
 * the single most likely thing to go wrong here, and it would not show up as a
 * broken number — every share would still sum to 100 and every cell would still
 * render. So the caveat is asserted like a figure.
 *
 * THE JOIN WITNESS IS PHYSICAL, as it is for expected points. A route concept
 * and an air-yards figure come from two different files joined on
 * game_id + play_id, and if that join slips the labels and the depths come
 * apart. Nothing in the code forces a screen to be thrown behind the line —
 * that falls out of the join being right, which is exactly what makes it worth
 * asserting.
 *
 *   node --test tests/routes.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const D = path.join(__dirname, '..', 'data');
const R = JSON.parse(fs.readFileSync(path.join(D, 'routes.json'), 'utf8'));

const latest = R.meta.seasons[R.meta.seasons.length - 1];
const players = R.seasons[String(latest)] || R.seasons[latest];

test('a screen is thrown behind the line and a go is thrown deep', () => {
  // THE WITNESS. The concept label comes from participation and the air yards
  // from play-by-play; they meet on game_id + play_id and nowhere else. A join
  // off by one row scrambles this immediately, and nothing else in the file
  // would look wrong.
  const L = R.league;
  for (const behind of ['SCREEN', 'SWING']) {
    if (!L[behind]) continue;
    assert.ok(L[behind].aDOT < 0,
      `${behind} has an average depth of ${L[behind].aDOT} — it is thrown behind the line of scrimmage`);
  }
  if (L.GO) assert.ok(L.GO.aDOT > 15, `GO averages ${L.GO.aDOT} air yards, which is not a deep route`);
  // And the ordering across the tree, which a shuffled label map would break
  // even where every individual depth still looked plausible.
  const ladder = ['SCREEN', 'QUICK OUT', 'HITCH/CURL', 'IN/DIG', 'GO'].filter(c => L[c]);
  assert.ok(ladder.length >= 4, 'the route ladder has lost concepts');
  for (let i = 1; i < ladder.length; i++) {
    assert.ok(L[ladder[i]].aDOT > L[ladder[i - 1]].aDOT,
      `depth does not rise across the tree: ${ladder.map(c => `${c} ${L[c].aDOT}`).join(' -> ')}`);
  }
});

test('a route caught behind the line is caught more often than one thrown deep', () => {
  // The second half of the same witness, on a different column, so a fix that
  // satisfied the depths alone would not satisfy this.
  const L = R.league;
  if (L.SCREEN && L.GO) {
    assert.ok(L.SCREEN.catchRate > L.GO.catchRate + 20,
      `screens are caught ${L.SCREEN.catchRate}% and go routes ${L.GO.catchRate}% — too close to be right`);
  }
});

test('the file says it is not a route tree', () => {
  // The overstatement this board invites, asserted like a number because it is
  // the thing most likely to drift and least likely to look wrong.
  const caveats = R.meta.caveats.join(' ');
  assert.match(caveats, /NOT A ROUTE TREE/i,
    'the file no longer says this is targets rather than routes run');
  assert.match(caveats, /every route run/i,
    'it has to say what a real route tree would count instead');
  assert.match(R.meta.source, /receiver_player_id/,
    'the file no longer states how a concept reaches a player');
});

test('a share is a share, and it is of his own targets', () => {
  for (const [id, p] of Object.entries(players)) {
    const total = Object.values(p.mix).reduce((a, m) => a + m.share, 0);
    // The shares have to CLOSE. Concepts seen once are under the floor and are
    // not published as their own row, but the targets on them still happened —
    // they are carried in `belowFloor` so a reader is never shown a mix that
    // accounts for three quarters of a player without saying so.
    const accounted = total + (p.belowFloor ? p.belowFloor.share : 0);
    assert.ok(Math.abs(accounted - 100) < 1.5,
      `${id}: his mix plus what fell under the floor accounts for ${accounted.toFixed(1)}% of his targets`);
    assert.ok(p.chartedTargets >= R.meta.build.minChartedTargets,
      `${id} is published on ${p.chartedTargets} charted targets, under the stated floor`);
    for (const [concept, m] of Object.entries(p.mix)) {
      assert.ok(m.share > 0 && m.share <= 100, `${id} ${concept}: share ${m.share}`);
      assert.ok(m.targets >= R.meta.build.minConcept, `${id} ${concept}: ${m.targets} targets`);
    }
  }
});

test('the league baseline beside a player is the league baseline', () => {
  // The comparison is the entire point of the board, so the two numbers must
  // not be able to drift. A player's leagueShare is carried next to his own so
  // the page never has to look it up — which is also how it could silently stop
  // matching.
  for (const [id, p] of Object.entries(players)) {
    for (const [concept, m] of Object.entries(p.mix)) {
      if (m.leagueShare === null) continue;
      assert.ok(R.league[concept], `${id} cites a league share for ${concept}, which the baseline does not have`);
      assert.strictEqual(m.leagueShare, R.league[concept].share,
        `${id} ${concept}: cites a league share of ${m.leagueShare} against a baseline of ${R.league[concept].share}`);
    }
  }
});

test('the league shares sum to a whole board', () => {
  const total = Object.values(R.league).reduce((a, c) => a + c.share, 0);
  assert.ok(Math.abs(total - 100) < 1.5, `the league concept shares sum to ${total.toFixed(1)}%`);
});

test('the lead concept is the one he actually sees most', () => {
  for (const [id, p] of Object.entries(players)) {
    const top = Object.entries(p.mix).sort((a, b) => b[1].share - a[1].share)[0];
    assert.strictEqual(p.lead.concept, top[0],
      `${id}: lead says ${p.lead.concept} but his largest share is ${top[0]}`);
    assert.strictEqual(p.lead.share, top[1].share, `${id}: lead share disagrees with the mix`);
  }
});

test('coverage is reported, and a charted play that reached nobody still counts for the league', () => {
  const b = R.meta.build;
  assert.ok(b.chartedPct > 70, `only ${b.chartedPct}% of pass plays carry a route — the column has moved`);
  assert.ok(b.charted > b.attributed,
    'every charted throw reached a pool player, which cannot be true — the league baseline is being '
    + 'built from the pool rather than from the league');
  assert.ok(b.concepts.length >= 10, `only ${b.concepts.length} route concepts — the vocabulary has shrunk`);
});
