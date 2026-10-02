/**
 * The two files the gate still had its teeth in, after the field map.
 *
 * Of the 31 survivors the mutation gate reported on 2026-10-02, lib/season.js
 * held 5 and lib/rushing.js 4 — the thickest clusters left once fieldmap.js was
 * covered. season.js goes first on purpose: it decides what season the ENTIRE
 * site believes it is in, CLAUDE.md already records a 34 -> 33 ratchet drop
 * caused by one of its date-fallback mutants, and a killed gate run left a live
 * mutant in it yesterday that would have told the site games had started in
 * February.
 *
 * Every test below was written against a named survivor and verified by putting
 * that mutation back.
 *
 *   node --test tests/season-rushing-coverage.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const season = require('../scripts/lib/season.js');
const { buildRushing } = require('../scripts/lib/rushing.js');

// ── season.js ───────────────────────────────────────────────────────────────

test('the league year rolls over in March, on the boundary (line 145)', () => {
  // `m >= 3 ? y : y - 1`. A season is named for the calendar year it STARTS in,
  // so January's playoffs belong to last year — and March is the first month of
  // the new one. The mutant moved the hinge to April and left March reading a
  // year stale, which is the quietest possible way to be wrong.
  assert.strictEqual(season.fromDate(new Date('2027-03-01T12:00:00Z')).season, 2027,
    'March 1 did not belong to the new league year');
  assert.strictEqual(season.fromDate(new Date('2027-02-28T12:00:00Z')).season, 2026,
    'February still belongs to the season that started last autumn');
  assert.strictEqual(season.fromDate(new Date('2027-03-31T12:00:00Z')).season, 2027);
});

test('every month lands in exactly one phase, and the phases are the four', () => {
  // The companion to the rollover: a month that falls through to 'off' in
  // September would take the whole site out of season.
  const phase = (iso) => season.fromDate(new Date(`${iso}T12:00:00Z`)).phase;
  assert.strictEqual(phase('2026-08-15'), 'pre');
  assert.strictEqual(phase('2026-09-15'), 'regular');
  assert.strictEqual(phase('2026-12-15'), 'regular');
  assert.strictEqual(phase('2027-01-15'), 'post');
  assert.strictEqual(phase('2027-02-15'), 'post');
  assert.strictEqual(phase('2027-05-15'), 'off');
  assert.strictEqual(phase('2027-07-15'), 'off');
});

test('week two alone says the season has started, on the boundary (line 183)', () => {
  // TWO INDEPENDENT CORROBORATORS, and this is the one that does not need a
  // date: week 2 means week 1 was played. The mutant raised it to week 3, so a
  // feed that dropped its start date would read the first fortnight of every
  // season as not yet begun.
  const noDate = { season: 2026, week: 2, phase: 'regular', seasonStartDate: null };
  assert.strictEqual(season.gamesHaveStarted(noDate, new Date('2026-09-02T12:00:00Z')), true,
    'week 2 did not corroborate a started season');
  assert.strictEqual(season.gamesHaveStarted({ ...noDate, week: 1 }, new Date('2026-09-02T12:00:00Z')), false,
    'week 1 is not corroboration — week 1 is the week about to be played');
  // And the date half still carries it on its own.
  assert.strictEqual(season.gamesHaveStarted({ ...noDate, week: 0 }, new Date('2026-09-11T12:00:00Z')), true,
    'the date corroborator stopped working');
});

test('a season after the last completed one is the unpublished one (line 267)', async () => {
  // notPublishedYet is the single definition behind every per-season fetch —
  // written three times in three scripts and missed in a fourth, which took the
  // whole run down over snap_counts_2026.csv. Inverted, every script would wait
  // for files that exist and fetch files that do not.
  season.__setState({ season: 2026, previousSeason: 2025, week: 4, phase: 'regular',
                      seasonStartDate: '2026-09-10', source: 'test' });
  try {
    const last = await season.lastCompletedSeason();
    assert.strictEqual(await season.notPublishedYet(last + 1), true,
      'next season is not published and must be reported so');
    assert.strictEqual(await season.notPublishedYet(last), false,
      'the last completed season IS published');
    assert.strictEqual(await season.notPublishedYet(last - 1), false);
  } finally {
    season.__reset();
  }
});

test('a simulated calendar keeps the phase it was given (lines 94, 134)', async () => {
  // SIGNAL_SEASON_STATE is how check-season is pointed at a state on purpose —
  // tests/pending-layers.test.js builds every alarm state through it. The phase
  // passes through normalizePhase, and both mutants there corrupt it silently:
  // one reads season_type instead of phase, the other maps 'pre' to 'off' and
  // everything else to 'pre'.
  // DRIVEN THROUGH state(), BECAUSE fromEnv IS NOT EXPORTED. The first version of
  // this test asked for season.fromEnv and skipped itself when it was not there
  // — nine green assertions, one of which asserted nothing. state() takes the
  // env path before it ever reaches the network, so no fetch happens here.
  const prev = process.env.SIGNAL_SEASON_STATE;
  const err = console.error;
  console.error = () => {};                       // it shouts about being simulated, by design
  try {
    for (const [given, expected] of [['pre', 'pre'], ['regular', 'regular'],
                                     ['post', 'post'], ['nonsense', 'off']]) {
      season.__reset();
      process.env.SIGNAL_SEASON_STATE = JSON.stringify({ season: 2026, week: 1, phase: given });
      const st = await season.state();
      assert.strictEqual(st.source, 'SIMULATED via SIGNAL_SEASON_STATE',
        'state() did not take the env path, so this test is measuring the network');
      assert.strictEqual(st.phase, expected, `phase ${given} became ${st.phase}`);
    }
  } finally {
    console.error = err;
    season.__reset();
    if (prev === undefined) delete process.env.SIGNAL_SEASON_STATE;
    else process.env.SIGNAL_SEASON_STATE = prev;
  }
});

// ── rushing.js ──────────────────────────────────────────────────────────────

const RCOLS = ['play_type', 'qb_kneel', 'qb_spike', 'rusher_player_id', 'epa', 'yards_gained', 'posteam'];
const rline = (o) => RCOLS.map(c => (o[c] === undefined ? '' : o[c])).join(',');
const rcsv = (rows) => [RCOLS.join(','), ...rows].join('\n');
const carry = (o = {}) => rline({ play_type: 'run', rusher_player_id: 'RB1', epa: 0.3,
                                  yards_gained: 5, posteam: 'KC', ...o });

test('success is a carry with POSITIVE epa, not a negative one (line 62)', () => {
  // The success rate exists because EPA per carry is an average over a skewed
  // distribution that one long touchdown moves. Inverted, the column still
  // looks like a percentage and ranks the league upside down.
  const rows = [];
  for (let i = 0; i < 15; i++) rows.push(carry({ epa: 0.5 }));
  for (let i = 0; i < 5; i++) rows.push(carry({ epa: -0.5 }));
  const { players } = buildRushing(rcsv(rows));
  assert.strictEqual(players.RB1.carries, 20);
  assert.strictEqual(players.RB1.successRate, 75, '15 of 20 positive carries is not 75%');
});

test('a carry with no epa is counted as a carry and not as a zero (line 33)', () => {
  // `num()` turning '' into null is what keeps a missing EPA out of the sum. The
  // mutant made it return 0 instead, which silently drags every average toward
  // nought and reports missingEpaPct as 0 — so the guard that throws when more
  // than 5% of carries carry no EPA would never fire.
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push(carry({ epa: 0.5 }));
  for (let i = 0; i < 5; i++) rows.push(carry({ epa: '' }));
  const out = buildRushing(rcsv(rows));
  assert.strictEqual(out.meta.carries, 25, 'a carry with no EPA is still a carry');
  assert.strictEqual(out.meta.missingEpaPct, 20, '5 of 25 carries without EPA is 20%');
  assert.strictEqual(out.players.RB1.carries, 20,
    'a carry with no EPA reached the per-player totals, where it would average in as nought');
  assert.strictEqual(out.players.RB1.epaPerCarry, 0.5);
});

test('NA is as absent as empty, and a real zero is not absent', () => {
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push(carry({ epa: 0 }));
  const out = buildRushing(rcsv(rows));
  assert.strictEqual(out.meta.missingEpaPct, 0, 'an EPA of exactly zero was read as missing');
  assert.strictEqual(out.players.RB1.carries, 20);
  assert.strictEqual(out.players.RB1.successRate, 0, 'zero EPA is not positive, so not a success');
});

test('a kneel is not a carry', () => {
  const rows = [carry(), carry({ qb_kneel: 1 }), carry({ qb_spike: 1 })];
  const out = buildRushing(rcsv(rows));
  assert.strictEqual(out.meta.carries, 1, 'a kneel or a spike was counted as a carry');
});
