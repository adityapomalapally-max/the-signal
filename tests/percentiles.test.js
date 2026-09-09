/**
 * A percentile is the most trustworthy-looking number on the site.
 *
 * It arrives pre-scaled, it comes with a rank beside it, and it is drawn as a
 * bar that is longer when it is better. A reader has no way to check any of
 * that from the page — which is exactly why the ways it can be silently wrong
 * are worth writing down:
 *
 *   THE DIRECTION CAN BE INVERTED AND NOTHING LOOKS WRONG. Drop rate published
 *   ascending puts the surest hands in the 4th percentile behind a short bar.
 *   Every value is in range, every rank is unique, the page renders, and the
 *   claim is the precise opposite of the truth. The combine percentiles already
 *   had this exact bug class — lower is better for the forty — so the witness
 *   here is asymmetric on purpose: the BEST value must hold rank 1, which is a
 *   different assertion from "the ranks are 1..n".
 *
 *   THE POOL CAN QUIETLY BECOME EVERYBODY. The floor is what stops a receiver
 *   with four targets owning the catch-rate leaderboard, and a floor that stops
 *   being applied does not error — it just makes every percentile on the site
 *   slightly wrong in a direction nobody can see.
 *
 *   A METRIC CAN GO MISSING FROM ITS OWN LABELS. The page renders whatever
 *   `groups` describes; a stat published under a key nothing labels is invisible
 *   rather than broken, which is the failure that never gets reported.
 *
 *   node --test tests/percentiles.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const D = path.join(__dirname, '..', 'data');
const pct = JSON.parse(fs.readFileSync(path.join(D, 'percentiles.json'), 'utf8'));
const pool = JSON.parse(fs.readFileSync(path.join(D, 'players.json'), 'utf8'));
const poolIds = new Set(pool.map(p => p.id));

const positions = Object.keys(pct.groups);
const entries = Object.entries(pct.players);

test('every position states its pool and its floor', () => {
  // A rank without its denominator is decoration. The page prints these, so
  // their absence is what would make "#12" mean nothing.
  for (const pos of positions) {
    const p = pct.meta.pools[pos];
    assert.ok(p, `${pos} has metrics but no pool`);
    assert.ok(Number.isInteger(p.qualified), `${pos} pool has no qualified count`);
    assert.ok(Number.isInteger(p.eligible), `${pos} pool has no eligible count`);
    assert.ok(p.qualified <= p.eligible, `${pos}: ${p.qualified} qualified of ${p.eligible} tracked`);
    assert.match(String(p.floorLabel), /\d/, `${pos} floor is not stated as a number`);
  }
});

test('the floor actually excludes somebody', () => {
  // The floor is the whole defence against a rate over four targets. If every
  // tracked player clears it, either the pool has become uniform overnight or
  // the floor has stopped being applied — and the second is invisible from the
  // page, because the numbers all still render.
  const anyExcluded = positions.some(pos => {
    const p = pct.meta.pools[pos];
    return p.eligible > p.qualified;
  });
  assert.ok(anyExcluded,
    'no position excluded a single player — a floor that admits everyone is not a floor');
});

test('the qualified flag agrees with the pool it was counted in', () => {
  for (const pos of positions) {
    const marked = entries.filter(([, p]) => p.pos === pos && p.qualified).length;
    assert.strictEqual(marked, pct.meta.pools[pos].qualified,
      `${pos}: ${marked} players marked qualified but the pool says ${pct.meta.pools[pos].qualified}`);
  }
});

test('every published stat is one the page has a label for', () => {
  const known = {};
  for (const pos of positions) known[pos] = new Set(pct.groups[pos].map(m => m.key));
  for (const [id, p] of entries) {
    for (const key of Object.keys(p.stats)) {
      assert.ok(known[p.pos] && known[p.pos].has(key),
        `${id} publishes "${key}", which nothing in groups.${p.pos} labels — it would render as nothing`);
    }
  }
});

test('a percentile is a percentile and a rank is a rank', () => {
  for (const [id, p] of entries) {
    const size = pct.meta.pools[p.pos].qualified;
    for (const [key, s] of Object.entries(p.stats)) {
      assert.ok(Number.isFinite(s.v), `${id} ${key}: value is not a number`);
      assert.ok(Number.isInteger(s.p) && s.p >= 0 && s.p <= 100, `${id} ${key}: percentile ${s.p}`);
      assert.ok(Number.isInteger(s.r) && s.r >= 1, `${id} ${key}: rank ${s.r}`);
      // An unqualified player is measured against the pool but is not in it, so
      // he is allowed to rank past its size — nobody else is.
      if (p.qualified) {
        assert.ok(s.r <= size, `${id} ${key}: rank ${s.r} in a pool of ${size}`);
      }
    }
  }
});

/**
 * THE ASYMMETRIC WITNESS.
 *
 * Everything above passes just as happily on a file with every direction
 * reversed. This is the assertion that cannot: whoever holds the best value at
 * a metric must hold rank 1 and the top percentile — and "best" means the
 * LOWEST value when the metric's own `dir` says so.
 */
test('the best value at a metric holds rank 1, and best means what dir says', () => {
  for (const pos of positions) {
    const qualified = entries.filter(([, p]) => p.pos === pos && p.qualified);
    for (const m of pct.groups[pos]) {
      const have = qualified.filter(([, p]) => p.stats[m.key]);
      if (have.length < 2) continue;
      const values = have.map(([, p]) => p.stats[m.key].v);
      const best = m.dir === 'low' ? Math.min(...values) : Math.max(...values);
      const holders = have.filter(([, p]) => p.stats[m.key].v === best);
      for (const [id, p] of holders) {
        assert.strictEqual(p.stats[m.key].r, 1,
          `${pos} ${m.key} (dir ${m.dir}): ${id} has the best value ${best} but ranks #${p.stats[m.key].r}`);
      }
      // And the worst end must not also be the top of the scale, which is what
      // a percentile computed in one direction and a rank in the other looks
      // like from the outside.
      const worst = m.dir === 'low' ? Math.max(...values) : Math.min(...values);
      if (worst !== best) {
        const worstPct = have.filter(([, p]) => p.stats[m.key].v === worst)[0][1].stats[m.key].p;
        const bestPct = holders[0][1].stats[m.key].p;
        assert.ok(bestPct > worstPct,
          `${pos} ${m.key} (dir ${m.dir}): best value ${best} sits at the ${bestPct}th percentile and worst ${worst} at the ${worstPct}th`);
      }
    }
  }
});

test('identical seasons are never separated by array order', () => {
  // Eleven receivers caught 100% of two targets. Ranking them by position in an
  // array hands one 99th and another 91st for the same season, and the number
  // stops being reproducible from the data.
  for (const pos of positions) {
    const qualified = entries.filter(([, p]) => p.pos === pos && p.qualified);
    for (const m of pct.groups[pos]) {
      const byValue = new Map();
      for (const [id, p] of qualified) {
        const s = p.stats[m.key];
        if (!s) continue;
        if (!byValue.has(s.v)) byValue.set(s.v, []);
        byValue.get(s.v).push([id, s]);
      }
      for (const [v, rows] of byValue) {
        if (rows.length < 2) continue;
        const ranks = new Set(rows.map(([, s]) => s.r));
        const pcts = new Set(rows.map(([, s]) => s.p));
        assert.strictEqual(ranks.size, 1, `${pos} ${m.key}: value ${v} carries ranks ${[...ranks].join(', ')}`);
        assert.strictEqual(pcts.size, 1, `${pos} ${m.key}: value ${v} carries percentiles ${[...pcts].join(', ')}`);
      }
    }
  }
});

test('a metric with no good end is published without one', () => {
  // aDOT says where a player is used, not how well. The page reads `dir` to
  // decide whether to colour a bar as a verdict, so a neutral metric that loses
  // its marking silently starts calling deep threats better than slot men.
  const neutral = [];
  for (const pos of positions) {
    for (const m of pct.groups[pos]) {
      assert.ok(['high', 'low', 'neutral'].includes(m.dir), `${pos} ${m.key}: dir is "${m.dir}"`);
      if (m.dir === 'neutral') neutral.push(`${pos}.${m.key}`);
    }
  }
  assert.ok(neutral.length, 'no metric is marked neutral — aDOT and pocket time have no good end and used to say so');
});

test('everybody published is somebody the site can show', () => {
  for (const [id, p] of entries) {
    assert.ok(poolIds.has(id), `percentiles carries "${id}", who is not in the pool`);
    assert.ok(p.name && p.pos, `${id} has no name or position`);
  }
});

test('the file says which season it is about and which one the league is in', () => {
  // Same discipline player-usage.json now carries. A file whose newest season
  // is older than the live one is describing history, and the page has to be
  // able to say so rather than implying the numbers are current.
  assert.ok(Number.isInteger(pct.meta.season), 'no season on the file');
  assert.ok(Number.isInteger(pct.meta.live), 'the file does not say what the league is playing');
  assert.ok(pct.meta.season <= pct.meta.live,
    `percentiles describe ${pct.meta.season} while the league is in ${pct.meta.live}`);
  assert.deepStrictEqual(pct.meta.seasons, [pct.meta.season],
    'meta.seasons is what the directory-wide guards read; it must name the season the file is about');
});

test('a thin season is labelled as one', () => {
  // A percentile over one game is a coin flip with a decimal point. The build
  // walks back to a season worth ranking; if it ever cannot, the file has to
  // admit it rather than publishing week-2 noise at full confidence.
  assert.strictEqual(typeof pct.meta.thin, 'boolean', 'the file does not say whether its sample is thin');
  if (pct.meta.thin) {
    assert.ok(pct.meta.medianGames < 4, 'marked thin on a full season');
  } else {
    assert.ok(pct.meta.medianGames >= 4,
      `median of ${pct.meta.medianGames} games is not enough to rank and is not marked thin`);
  }
});

test('the pool is described as ours, not as the league', () => {
  // 80 qualified receivers is not "the 80 best receivers in football", it is
  // the receivers this site tracks. Every board here states its population and
  // this is the one most likely to be read as league-wide.
  assert.match(pct.meta.pool, /not the whole league/i,
    'the file no longer says its pool is narrower than the league');
  assert.ok(Array.isArray(pct.meta.caveats) && pct.meta.caveats.length >= 3,
    'the caveats that explain what a percentile is not have gone');
});
