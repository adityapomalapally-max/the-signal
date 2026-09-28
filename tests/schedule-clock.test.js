/**
 * The clock's own fetch: which rows count as the season being played.
 *
 * lib/schedule.js is the single definition of how far into a season we are —
 * build-ros and build-sos both read it, and a week wrong here is a week wrong in
 * every rest-of-season number on the site (2026-09-25: one Thursday game read as
 * a finished week cost every projection a game).
 *
 * `weeksPlayedFrom` is exercised at every week through build-sos in
 * tests/ros-window.test.js. What this covers is the half in front of it — the
 * fetch and the filter — which nothing reached, because it needed the network.
 * lib/match's transport seam makes it answerable offline.
 *
 *   node --test tests/schedule-clock.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const match = require('../scripts/lib/match');
const schedule = require('../scripts/lib/schedule');

const HEAD = 'season,game_type,week,away_team,home_team,result';
const csv = (rows) => [HEAD, ...rows].join('\n') + '\n';

function serve(body) {
  match.__setTransport((url, opts, cb) => {
    const res = new (require('node:events').EventEmitter)();
    res.statusCode = 200;
    res.headers = {};
    process.nextTick(() => { res.emit('data', Buffer.from(body)); res.emit('end'); });
    cb(res);
    return new (require('node:events').EventEmitter)();
  });
}

test.afterEach(() => match.__resetTransport());

test('only the regular season of the season asked for gets counted', async () => {
  // THE SCHEDULE FEED CARRIES EVERY SEASON AND EVERY GAME TYPE. A preseason row
  // is football nobody's fantasy season counted, and a playoff row belongs to a
  // week number that repeats the regular season's — either one leaking in moves
  // the clock.
  serve(csv([
    '2025,REG,18,GB,CHI,7',        // last season, finished
    '2026,PRE,3,GB,ATL,3',        // preseason: not the season being played
    '2026,REG,1,GB,ATL,7',
    '2026,REG,2,CHI,DET,-3',
    '2026,POST,1,KC,BUF,',        // playoffs, week 1 again, unplayed
  ]));
  const games = await schedule.regularSeasonGames(2026);
  assert.deepStrictEqual(games.map(g => `${g.season}/${g.game_type}/${g.week}`),
    ['2026/REG/1', '2026/REG/2'],
    'something that is not this season\'s regular season reached the clock');
});

test('the clock counts finished weeks off the feed, and a tie is finished', async () => {
  // End to end: fetch, filter, count. Week 3 has one result in and fifteen games
  // to come — the exact shape that shipped wrong numbers — and the answer has to
  // be 2. The tie in week 2 is a played game; `result: 0` read as "no result"
  // would answer 1 and stay there all season.
  const rows = [];
  for (let w = 1; w <= 2; w++) for (let i = 0; i < 16; i++) rows.push(`2026,REG,${w},GB,ATL,${w === 2 && i === 0 ? 0 : 7}`);
  rows.push('2026,REG,3,GB,ATL,3');                       // Thursday night, played
  for (let i = 0; i < 15; i++) rows.push('2026,REG,3,CHI,DET,');   // the rest of week 3
  serve(csv(rows));
  assert.strictEqual(await schedule.weeksPlayed(2026), 2);
});

test('a season the feed has no regular-season rows for is nought weeks old', async () => {
  // Not an error: in the days after the rollover the file exists and this
  // season is not in it yet. Nought is what the builds are written to see —
  // build-ros writes nothing and says why.
  serve(csv(['2025,REG,18,GB,CHI,7']));
  assert.strictEqual(await schedule.weeksPlayed(2026), 0);
});
