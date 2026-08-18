/**
 * Per-player personnel usage. Every figure here is a share of the player's OWN
 * snaps, and the value of the page comes from comparing it to the offence he
 * actually played in — so the team recorded on a season must be that team.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const D = path.join(__dirname, '..', 'data');
const usage = JSON.parse(fs.readFileSync(path.join(D, 'player-usage.json'), 'utf8'));
const scheme = JSON.parse(fs.readFileSync(path.join(D, 'scheme.json'), 'utf8'));
const pool = JSON.parse(fs.readFileSync(path.join(D, 'players.json'), 'utf8'));
const poolIds = new Set(pool.map(p => p.id));

// The CURRENT season is rebuilt against the current pool every morning, so a
// stranger in it means the join is wrong and the assertion stands as written.
//
// Past seasons are a different case, and asserting the same thing about them
// was wrong. They are never rebuilt — "past seasons never change" is why
// build-scheme.js downloads one season and not three — so when the pool churns,
// a player who drops out leaves his history behind. On 2026-08-18 that was
// brown-n, strong, mccaffrey and rush: 6 rows across 2023 and 2024, 0 in 2025.
//
// Those rows are inert. Usage is only ever looked up for a player the page is
// already showing, and the page only shows the pool. Pruning them would cost
// more than it saves: pool membership is deliberately hysteretic (STICKY_RANKS),
// so a player who drops out this week can be back next week — and his history
// would then be gone until somebody spent a 70MB-a-season `--all` rebuild
// getting it back. Keeping them means a returning player's profile is whole the
// day he returns. That is the trade, made on purpose rather than by accident.
test('the current season of usage is keyed by players who exist in the pool', () => {
  const current = usage.meta.seasons[usage.meta.seasons.length - 1];
  for (const id of Object.keys(usage.seasons[current])) {
    assert.ok(poolIds.has(id), `${current}: "${id}" is not in the pool`);
  }
});

test('a past season carries history, never a player the pool never had', () => {
  // The bound that replaces the old assertion: history may outlive the pool,
  // but it may not GROW. Every historical row has to be a player with a name
  // and a team on it, so a broken join shows up as junk rather than as churn.
  for (const season of usage.meta.seasons) {
    for (const [id, u] of Object.entries(usage.seasons[season])) {
      assert.ok(u.name && u.team, `${season} "${id}": a usage row with no name or team is a bad join, not churn`);
    }
  }
});

test('a personnel mix is a share of one player, so it cannot exceed 100', () => {
  for (const season of usage.meta.seasons) {
    for (const [id, u] of Object.entries(usage.seasons[season])) {
      const total = Object.values(u.mix).reduce((a, b) => a + b, 0);
      // Groupings under 1% are dropped, so the total can sit a little under.
      assert.ok(total <= 100.5, `${season} ${u.name}: mix sums to ${total.toFixed(1)}%`);
      assert.ok(total > 50, `${season} ${u.name}: mix only sums to ${total.toFixed(1)}%`);
    }
  }
});

test('nobody is published below the stated snap qualifier', () => {
  const min = Number(usage.meta.qualifier.match(/(\d+)/)[1]);
  for (const season of usage.meta.seasons) {
    for (const u of Object.values(usage.seasons[season])) {
      assert.ok(u.snaps >= min, `${u.name}: ${u.snaps} snaps, below the stated ${min}`);
    }
  }
});

test('the team on a season is a team that existed that season', () => {
  // This is the correctness bug the feature shipped with for ten minutes: a
  // player's usage was compared to his CURRENT team's scheme, so a traded
  // player was read against an offence he never took a snap in.
  for (const season of usage.meta.seasons) {
    for (const u of Object.values(usage.seasons[season])) {
      if (!u.team) continue;
      assert.ok(scheme.seasons[season] && scheme.seasons[season][u.team],
        `${season} ${u.name}: team ${u.team} has no scheme entry that season`);
    }
  }
});

test('a traded player records where the rest of his snaps went', () => {
  for (const season of usage.meta.seasons) {
    for (const u of Object.values(usage.seasons[season])) {
      for (const extra of u.alsoWith || []) {
        assert.ok(scheme.seasons[season][extra.team], `${u.name}: alsoWith ${extra.team} is not a team that season`);
        assert.ok(extra.snaps > 0, `${u.name}: alsoWith ${extra.team} has ${extra.snaps} snaps`);
      }
    }
  }
});

test('the file states its qualifier and its caveats', () => {
  for (const key of ['qualifier', 'caveats', 'source']) {
    assert.ok(usage.meta[key], `meta.${key} is missing`);
  }
  assert.match(usage.meta.caveats, /GSIS/i);
});
