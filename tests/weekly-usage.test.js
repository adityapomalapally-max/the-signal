/**
 * Weekly opportunity.
 *
 * Two things here fail silently and both still sort correctly, which is what
 * makes them dangerous:
 *
 *   WOPR TAKES DECIMALS, NOT PERCENTAGES. Feeding 25 instead of 0.25 produces a
 *   number a hundred times too large that ranks every player in exactly the
 *   same order. Nothing about the board looks wrong; the figure is just not
 *   WOPR any more, and it is quoted against a published scale where 0.6 is a
 *   good receiver.
 *
 *   SHARES NEED A TEAM DENOMINATOR. Computed against the 350-player pool
 *   instead of the team, every share comes out too high — by a different amount
 *   for every team, so the error is invisible in aggregate and changes who
 *   ranks where.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const W = require('../scripts/lib/weekly.js');

test('WOPR uses the published weights on decimals', () => {
  // 25% of targets and 30% of air yards: 1.5(0.25) + 0.7(0.30) = 0.585.
  assert.strictEqual(W.wopr(25, 30), 0.585);
  assert.strictEqual(W.wopr(0, 0), 0);
  assert.strictEqual(W.wopr(100, 100), 2.2, 'the theoretical maximum is 1.5 + 0.7');
  // The trap: a plausible elite receiver must land near the published scale,
  // where roughly 0.6 is a WR1 and anything over 1.0 is a target monster.
  const elite = W.wopr(30, 40);
  assert.ok(elite > 0.5 && elite < 1.0, `a 30%/40% receiver scored ${elite} — that is not on the WOPR scale`);
});

test('WOPR weights are the standard ones and are not quietly retuned', () => {
  assert.strictEqual(W.WOPR_TARGET, 1.5);
  assert.strictEqual(W.WOPR_AIR, 0.7);
});

test('a share with no denominator is null, never zero', () => {
  // Zero reads as "got none of it". Null reads as "we cannot say", which is the
  // true statement for a team-week with no recorded air yards.
  assert.strictEqual(W.share(5, 0), null);
  assert.strictEqual(W.share(5, null), null);
  assert.strictEqual(W.share(0, 40), 0, 'zero targets out of forty IS zero, and that is a fact');
  assert.strictEqual(W.share(10, 40), 25);
});

test('the play-by-play reader counts team totals and player totals from the same plays', () => {
  const cols = ['week','posteam','pass_attempt','rush_attempt','air_yards','receiver_player_id',
                'rusher_player_id','season_type'];
  const row = o => cols.map(c => o[c] === undefined ? '' : o[c]).join(',');
  const lines = [cols.join(',')];
  // Week 1, one team: three pass attempts (two to WR1, one to WR2) and two runs.
  lines.push(row({week:1,posteam:'BUF',pass_attempt:1,air_yards:10,receiver_player_id:'WR1',season_type:'REG'}));
  lines.push(row({week:1,posteam:'BUF',pass_attempt:1,air_yards:20,receiver_player_id:'WR1',season_type:'REG'}));
  lines.push(row({week:1,posteam:'BUF',pass_attempt:1,air_yards:10,receiver_player_id:'WR2',season_type:'REG'}));
  lines.push(row({week:1,posteam:'BUF',rush_attempt:1,rusher_player_id:'RB1',season_type:'REG'}));
  lines.push(row({week:1,posteam:'BUF',rush_attempt:1,rusher_player_id:'RB1',season_type:'REG'}));
  // A postseason play, which must not count.
  lines.push(row({week:1,posteam:'BUF',pass_attempt:1,air_yards:50,receiver_player_id:'WR1',season_type:'POST'}));

  const { teams, players } = W.usageFromPbp(lines.join('\n'));
  const t = teams.get('1|BUF');
  assert.strictEqual(t.attempts, 3, 'the postseason attempt leaked into the team total');
  assert.strictEqual(t.airYards, 40);
  assert.strictEqual(t.carries, 2);
  const wr1 = players.get('1|WR1');
  assert.strictEqual(wr1.targets, 2);
  assert.strictEqual(wr1.airYards, 30);
  // The share the board would print: 2 of 3 attempts, 30 of 40 air yards.
  assert.strictEqual(W.share(wr1.targets, t.attempts), 66.7);
  assert.strictEqual(W.share(wr1.airYards, t.airYards), 75);
});

test('snap percentage arrives as a fraction and is published as a percentage', () => {
  // offense_pct is 1 for every snap, not 100. Published unconverted, a full-time
  // starter reads as 1% and the board ranks the whole league upside down.
  const cols = ['week','pfr_player_id','offense_snaps','offense_pct','game_type','opponent'];
  const lines = [cols.join(',')];
  lines.push(['1','SmitJo01','62','1','REG','MIA'].join(','));
  lines.push(['1','JoneAl00','31','0.5','REG','MIA'].join(','));
  lines.push(['1','PostSe01','40','0.65','POST','NE'].join(','));
  const m = W.snapsFromCsv(lines.join('\n'));
  assert.strictEqual(m.get('1|SmitJo01').pct, 100, 'a full-time starter must read as 100%, not 1%');
  assert.strictEqual(m.get('1|JoneAl00').pct, 50);
  assert.strictEqual(m.has('1|PostSe01'), false, 'a postseason game must not be counted');
});

test('the schema is asserted, so a renamed column fails the run', () => {
  assert.throws(() => W.usageFromPbp('game_id,play_id\n1,2\n'), /missing .* the schema moved/);
  assert.throws(() => W.snapsFromCsv('player,team\nx,y\n'), /missing .* the schema moved/);
});

test('the published file states what it does not have', () => {
  const f = path.join(__dirname, '..', 'data', 'weekly-usage.json');
  if (!fs.existsSync(f)) return;
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const c = d.meta.caveats.join(' ');
  assert.match(c, /ROUTES RUN IS NOT HERE|route participation/i,
    'yards per route run is the metric people will assume is here, and it is not');
  assert.match(c, /snap share is the closest free substitute|different thing/i,
    'and the file must say why snap share is not a substitute for it');
  assert.match(d.meta.qualifiers.denominators, /TEAM total/i,
    'the denominator is the thing that would be wrong invisibly');
  assert.match(d.meta.wopr, /1\.5.*0\.7/, 'the WOPR weights have to travel with the number');
});

test('a missed week is absent, not a zero', () => {
  const f = path.join(__dirname, '..', 'data', 'weekly-usage.json');
  if (!fs.existsSync(f)) return;
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const year = Object.keys(d.seasons).sort().pop();
  const players = Object.values(d.seasons[year]);
  // Somebody in a 350-player pool missed a week; if every player has every
  // week, absences are being written as zeros.
  const anyPartial = players.some(p => p.weeks.length < 17);
  assert.ok(anyPartial, 'every player has a full slate — missed weeks are being recorded as zeros');
  for (const p of players) {
    const weeks = p.weeks.map(w => w.week);
    assert.strictEqual(new Set(weeks).size, weeks.length, `${p.name} has a duplicated week`);
  }
});
