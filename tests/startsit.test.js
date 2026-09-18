/**
 * Start / Sit — the one page that answers a question instead of showing a board.
 *
 * WHAT MAKES IT SAFE TO BUILD is that it invents nothing. Every number in it is
 * already published here with its own stated method: the projection from
 * ros.json, the rank from rankings.json, the opponent from the schedule, the
 * status from the daily feed. A score computed on this page would be a fourth
 * opinion sitting beside three published ones with nothing to check it against
 * — and ros.json's own meta is explicit that it "is not a re-ranking of the
 * board", so where the projection and the analyst's rank disagree, the page
 * prints both and names the disagreement rather than resolving it quietly.
 *
 * The decision is a pure function over files passed in, so the states that
 * decide a week can be built here instead of waited for: a bye, a missing
 * projection, a status flag on the player the projection prefers, a board that
 * says the opposite.
 *
 *   node --test tests/startsit.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const { loadPages, evalIn } = require('./lib/pageharness');

const ctx = loadPages();
const model = (a, b, src) => evalIn(ctx, 'startSitModel')(a, b, src);

const player = (over) => Object.assign({
  id: 'a', name: 'Player A', pos: 'RB', team: 'DET', fRank: 'RB3', gsisId: '00-1', status: 'Healthy',
}, over);

const rosRow = (over) => Object.assign({
  projectedPpg: 16, actualPpg: 18, preseasonPpg: 14, weightOnActual: 0.4,
  gamesPlayed: 2, gamesRemaining: 15, restOfSeasonPoints: 240, ppgDelta: 2,
}, over);

const base = () => ({
  pool: [player({}), player({ id: 'b', name: 'Player B', fRank: 'RB7', gsisId: '00-2', team: 'BUF' })],
  ros: { meta: { throughWeek: 2 }, players: { a: rosRow({ projectedPpg: 16 }), b: rosRow({ projectedPpg: 12 }) } },
  teams: { teams: {
    DET: { schedule: [{ week: 3, opp: 'NYJ', home: true }] },
    BUF: { schedule: [{ week: 3, opp: 'MIA', home: false }] },
  } },
  usage: null,
});

test('the week is the one after the last one with results in it', () => {
  const m = model('a', 'b', base());
  assert.strictEqual(m.week, 3, 'the week comes from ros.json throughWeek, not from a calendar of its own');
  assert.strictEqual(m.a.opp.team, 'NYJ');
  assert.strictEqual(m.b.opp.home, false, 'home and away is part of the fixture, not decoration');
});

test('the higher projection leads, and the gap is stated rather than scored', () => {
  const m = model('a', 'b', base());
  assert.strictEqual(m.lead, 'a');
  assert.strictEqual(m.gapPpg, 4);
  assert.ok(m.notes.some(n => n.kind === 'made-of' && /40%/.test(n.text)),
    'the reader is not told how much of the number is this season');
});

test('a bye settles it before any projection is consulted', () => {
  // The only certain answer on the page. A team with a schedule and no row for
  // the week is on bye; a team with NO schedule is a missing file, which is a
  // different thing and must not read as a bye.
  const src = base();
  src.teams.teams.DET.schedule = [{ week: 4, opp: 'NYJ', home: true }];
  const m = model('a', 'b', src);
  assert.strictEqual(m.lead, 'b', 'the player who plays lost to the one on bye');
  assert.match(m.blocked, /on bye/i);
  assert.strictEqual(m.gapPpg, null, 'a bye needs no points-per-game argument');

  const noFile = base();
  delete noFile.teams.teams.DET;
  const n = model('a', 'b', noFile);
  assert.strictEqual(n.blocked, null, 'a team missing from teams.json was read as a bye');
  assert.strictEqual(n.a.opp, null);
  assert.strictEqual(n.lead, 'a', 'and the comparison still ran on the numbers that ARE there');
});

test('a player with no projection is said so, not silently dropped', () => {
  const src = base();
  delete src.ros.players.b;
  const m = model('a', 'b', src);
  assert.strictEqual(m.lead, null, 'it picked a winner with only one number to compare');
  const note = m.notes.find(n => n.kind === 'missing');
  assert.ok(note, 'nothing explains the absence');
  assert.match(note.text, /Player B/);
  assert.match(note.text, /game log/, 'the reason has to say what would put him in the file');
});

test('availability outranks the gap, and it matters WHICH player carries it', () => {
  // ros.json is points per game and its own caveats say it says nothing about
  // availability. A player who does not play scores nothing, which is a bigger
  // number than any gap on this page.
  const hurtLeader = base();
  hurtLeader.pool[0].status = 'Questionable (Hamstring)';
  const m1 = model('a', 'b', hurtLeader);
  assert.strictEqual(m1.lead, 'a', 'the projection is still the projection');
  const against = m1.notes.find(n => n.kind === 'against');
  assert.ok(against && /Questionable \(Hamstring\)/.test(against.text),
    'a flag on the favoured player did not argue against him');

  const hurtOther = base();
  hurtOther.pool[1].status = 'IR (Knee)';
  const m2 = model('a', 'b', hurtOther);
  assert.ok(m2.notes.some(n => n.kind === 'for' && /widens/.test(n.text)),
    'a flag on the other player should widen the gap, not argue against the lead');
  assert.ok(!m2.notes.some(n => n.kind === 'against'),
    'the other player being hurt was read as an argument against the leader');
});

test('the board disagreeing with the projection is printed, never resolved quietly', () => {
  // rankings.json is the analyst's call and ros.json is allowed to order
  // players differently — its own meta says so. The page owes the reader both.
  const src = base();
  src.pool[0].fRank = 'RB12';   // the projection likes A
  src.pool[1].fRank = 'RB9';    // the board likes B
  const m = model('a', 'b', src);
  assert.strictEqual(m.lead, 'a');
  const note = m.notes.find(n => n.kind === 'against' && /board has/i.test(n.text));
  assert.ok(note, 'the board and the projection disagreed and the page said nothing');
  assert.match(note.text, /RB9/);

  // AND THE RANK IS PARSED, NOT COMPARED AS TEXT. "RB12" < "RB9" is true of
  // strings and false of ranks, which would have printed this disagreement
  // exactly backwards — the failure mode that has no symptom.
  assert.strictEqual(m.a.rank.n, 12);
  assert.strictEqual(m.b.rank.n, 9);
});

test('two positions is a caveat, because the slot may not take both', () => {
  const src = base();
  src.pool[1].pos = 'TE';
  const m = model('a', 'b', src);
  assert.ok(m.notes.some(n => n.kind === 'caveat' && /different positions/i.test(n.text)));
});

test('a snap share that moved is a reading; one that wobbled is not', () => {
  const moved = base();
  moved.usage = { seasons: { 2026: { '00-1': { weeks: [{ week: 1, snapPct: 50 }, { week: 2, snapPct: 75 }] } } } };
  const m1 = model('a', 'b', moved);
  assert.ok(m1.notes.some(n => /snap share went up, from 50% to 75%/.test(n.text)));

  const wobbled = base();
  wobbled.usage = { seasons: { 2026: { '00-1': { weeks: [{ week: 1, snapPct: 70 }, { week: 2, snapPct: 73 }] } } } };
  const m2 = model('a', 'b', wobbled);
  assert.ok(!m2.notes.some(n => /snap share went/.test(n.text)),
    'three points of movement is the same role played twice, not a trend');

  const oneWeek = base();
  oneWeek.usage = { seasons: { 2026: { '00-1': { weeks: [{ week: 1, snapPct: 70 }] } } } };
  assert.strictEqual(model('a', 'b', oneWeek).a.usage, null, 'one week is not a direction');
});

test('the view is registered everywhere a view has to be', () => {
  // A view lives in four places: the toggle that draws it, the list the router
  // indexes into, the address it answers to, and the metadata that titles a
  // link to it. Three of four is a tab that renders and cannot be sent.
  const fs = require('node:fs');
  const path = require('node:path');
  const ROOT = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const pages = fs.readFileSync(path.join(ROOT, 'assets', 'app-pages.js'), 'utf8');
  const feeds = fs.readFileSync(path.join(ROOT, 'assets', 'app-feeds.js'), 'utf8');
  const actions = fs.readFileSync(path.join(ROOT, 'assets', 'app-actions.js'), 'utf8');

  assert.match(html, /data-click="season-view" data-arg="startsit"/, 'no toggle draws it');
  assert.match(pages, /SEASON_VIEWS = \[[^\]]*'startsit'/, 'the router cannot index to it');
  assert.match(feeds, /'season\/startsit':\s*\{/, 'a link to it unfurls as the section above it');
  assert.match(actions, /'ss-pick'/, 'the pickers reach no action');

  // The toggle order IS the router's index, so a button added out of order
  // sends /season/wire to the start/sit tab.
  // Joined rather than deep-compared: the array comes out of the vm realm, so
  // deepStrictEqual fails on its prototype rather than on its contents.
  const views = [...evalIn(ctx, 'SEASON_VIEWS')];
  const order = [...html.matchAll(/data-click="season-view" data-arg="([a-z]+)"/g)].map(m => m[1]);
  assert.strictEqual(order.join(','), views.join(','),
    'the toggle buttons and SEASON_VIEWS are in different orders — the router indexes by position');
});

test('the two players are part of the address', () => {
  // A comparison somebody wants settled is exactly the thing they send to a
  // leaguemate, and a decision aid addressed only by two dropdowns has nothing
  // to send. The toggle must not throw the ids away either — a bare
  // `season/<view>` here is the discard switchPage used to make with /teams/sea.
  const pages = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'assets', 'app-pages.js'), 'utf8');
  assert.match(pages, /season\/startsit\/\$\{ssA\}\/\$\{ssB\}/, 'the picked players never reach the URL');
  const setView = pages.slice(pages.indexOf('function setSeasonView'), pages.indexOf('function setSeasonView') + 700);
  assert.ok(!/setRoute\(`season\/\$\{seasonView\}`\)/.test(setView),
    'the view toggle rewrites the URL without the players, discarding a deeper route');

  const feeds = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'assets', 'app-feeds.js'), 'utf8');
  assert.match(feeds, /ssA = parts\[2\][\s\S]{0,80}ssB = parts\[3\]/,
    'an incoming /season/startsit/a/b link does not open on those two players');
});
