/**
 * The shared table sorter in assets/app-core.js.
 *
 * The browser scripts are classic scripts sharing one global scope — they have
 * no exports to require. So the file is evaluated in a vm with the handful of
 * browser globals it touches stubbed out, and the functions are read off that
 * context. No dependencies, same as every other suite here.
 *
 * These three rules are the reason the sorter exists at all, and each one was
 * observably wrong somewhere before it did:
 *   - a missing value sorts last in BOTH directions
 *   - ties break on a stable key, so a re-render cannot reshuffle the rows
 *   - the first click on a column goes the useful way
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// The stubs are deliberately thin: if app-core.js grows a top-level statement
// that actually needs a browser, this throws here rather than in a reader's tab.
function loadCore() {
  const src = fs.readFileSync(path.join(ROOT, 'assets/app-core.js'), 'utf8');
  const noop = () => {};
  const node = () => ({ style: {}, dataset: {}, appendChild: noop, addEventListener: noop });
  const ctx = {
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener: noop,
      createElement: node,
      body: node(),
    },
    window: { addEventListener: noop, location: { pathname: '/' }, innerWidth: 1200, innerHeight: 800 },
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }),
    console,
    setTimeout,
    requestIdleCallback: noop,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'app-core.js' });
  return ctx;
}

const core = loadCore();

function table(cols, opts) {
  const id = 't' + Math.random().toString(36).slice(2);
  core.defineTable(id, Object.assign({ cols }, opts || {}));
  return id;
}

test('a missing value sorts last in BOTH directions', () => {
  // The live case: 258 of the 350 players have no fRank. Ascending by fantasy
  // rank has to open on RB1, not on 258 dashes.
  const id = table({ n: { get: r => r.n, type: 'num' } });
  const rows = [{ n: 3 }, { n: null }, { n: 1 }, { n: undefined }, { n: 2 }, { n: '' }];

  core.setTableSort(id, 'n');                       // first click on a number: descending
  let out = core.sortTableRows(id, rows).map(r => r.n);
  assert.deepStrictEqual(out.slice(0, 3), [3, 2, 1], 'descending should run high to low');
  assert.strictEqual(out.slice(3).every(v => v === null || v === undefined || v === ''), true,
    'the empties belong at the bottom of a descending sort');

  core.setTableSort(id, 'n');                       // same column again: flip
  out = core.sortTableRows(id, rows).map(r => r.n);
  assert.deepStrictEqual(out.slice(0, 3), [1, 2, 3], 'ascending should run low to high');
  assert.strictEqual(out.slice(3).every(v => v === null || v === undefined || v === ''), true,
    'the empties belong at the bottom of an ascending sort too — this is the whole rule');
});

test('NaN and Infinity count as missing, not as extremes', () => {
  const id = table({ n: { get: r => r.n, type: 'num' } });
  const rows = [{ n: NaN }, { n: 5 }, { n: Infinity }, { n: 1 }];
  core.setTableSort(id, 'n');
  const out = core.sortTableRows(id, rows).map(r => r.n);
  assert.deepStrictEqual(out.slice(0, 2), [5, 1], 'a real number outranks a non-number');
});

test('ties break on a stable key, so the same list always renders the same way', () => {
  // 129 of the 350 players are WRs. Without a tie-break they reorder on every
  // keystroke in the search box, which reads as a rendering bug.
  const id = table(
    { pos: { get: r => r.pos, type: 'text' } },
    { tie: { get: r => r.name, type: 'text' } }
  );
  const rows = [
    { pos: 'WR', name: 'Nabers' }, { pos: 'RB', name: 'Gibbs' },
    { pos: 'WR', name: 'Chase' }, { pos: 'WR', name: 'Lamb' },
  ];
  core.setTableSort(id, 'pos');
  const once = core.sortTableRows(id, rows).map(r => r.name);
  const twice = core.sortTableRows(id, rows.slice().reverse()).map(r => r.name);
  assert.deepStrictEqual(once, twice, 'input order must not change the output');
  assert.deepStrictEqual(once, ['Gibbs', 'Chase', 'Lamb', 'Nabers']);
});

test('a column may break its own ties', () => {
  const id = table({
    rank: {
      get: r => r.rank, type: 'num', dir: 'asc',
      tie: { get: r => r.pos, type: 'text' },
    },
  }, { tie: { get: r => r.name, type: 'text' } });
  const rows = [{ rank: 1, pos: 'WR', name: 'b' }, { rank: 1, pos: 'QB', name: 'a' }];
  core.setTableSort(id, 'rank');
  assert.deepStrictEqual(core.sortTableRows(id, rows).map(r => r.pos), ['QB', 'WR'],
    'the column tie-break wins over the table one');
});

test('the first click goes the useful way', () => {
  const id = table({
    name: { get: r => r.name, type: 'text' },
    rank: { get: r => r.rank, type: 'num', dir: 'asc' },
    rate: { get: r => r.rate, type: 'num' },
  });
  core.setTableSort(id, 'name');
  assert.strictEqual(core.tableSortState(id).dir, 'asc', 'text opens at A');
  core.setTableSort(id, 'rate');
  assert.strictEqual(core.tableSortState(id).dir, 'desc', 'a rate opens at the highest');
  core.setTableSort(id, 'rank');
  assert.strictEqual(core.tableSortState(id).dir, 'asc', 'a rank column opens at #1, not at #350');
});

test('sorting never mutates the caller\'s array', () => {
  const id = table({ n: { get: r => r.n, type: 'num' } });
  const rows = [{ n: 1 }, { n: 3 }, { n: 2 }];
  const before = rows.map(r => r.n);
  core.setTableSort(id, 'n');
  core.sortTableRows(id, rows);
  assert.deepStrictEqual(rows.map(r => r.n), before, 'the source list is the caller\'s');
});

test('an unsorted or unknown column returns the rows untouched', () => {
  const id = table({ n: { get: r => r.n, type: 'num' } });
  const rows = [{ n: 3 }, { n: 1 }];
  assert.deepStrictEqual(core.sortTableRows(id, rows).map(r => r.n), [3, 1]);
  core.setTableSort(id, 'nope');
  assert.deepStrictEqual(core.sortTableRows(id, rows).map(r => r.n), [3, 1],
    'a key with no column defined must not throw or reorder');
});

test('status sorts by severity, not by the alphabet', () => {
  const p = (status, statusClass) => ({ status, statusClass });
  const healthy = core.statusRank(p('Healthy', 'status-healthy'));
  const quest = core.statusRank(p('Questionable (Hamstring)', 'status-quest'));
  const doubt = core.statusRank(p('Doubtful (Hamstring)', 'status-out'));
  const ir = core.statusRank(p('IR (Knee - PCL)', 'status-out'));
  assert.ok(healthy < quest, 'healthy outranks questionable');
  assert.ok(quest < doubt, 'questionable outranks doubtful');
  assert.ok(doubt < ir, 'IR is the far end');
  // Alphabetically "Doubtful" leads "Healthy" leads "IR" leads "Questionable",
  // which is the order this exists to avoid.
  assert.ok(core.statusRank(p('Healthy', 'status-healthy')) < core.statusRank(p('Doubtful', 'status-out')));
});

test('a status word nobody has seen lands in its class, not at the front', () => {
  const known = core.statusRank({ status: 'IR', statusClass: 'status-out' });
  const novel = core.statusRank({ status: 'Reserve/Whatever', statusClass: 'status-out' });
  const healthy = core.statusRank({ status: 'Healthy', statusClass: 'status-healthy' });
  assert.ok(novel > known, 'an unknown word sorts last inside its own class');
  assert.ok(novel > healthy, 'but never ahead of a healthy player');
});

test('statusBase strips the body part and nothing else', () => {
  assert.strictEqual(core.statusBase('Questionable (Knee - ACL + MCL)'), 'Questionable');
  assert.strictEqual(core.statusBase('IR'), 'IR');
  assert.strictEqual(core.statusBase('Healthy'), 'Healthy');
  assert.strictEqual(core.statusBase(null), '');
});

test('fantasy rank sorts as a number, not as text', () => {
  // "RB10" before "RB2" is what a text sort does to the one column a fantasy
  // reader is most likely to click.
  assert.strictEqual(core.fRankValue('RB2'), 2);
  assert.strictEqual(core.fRankValue('WR14'), 14);
  assert.strictEqual(core.fRankValue(null), null, 'no rank is null, never 0');
  assert.strictEqual(core.fRankValue('RB'), null);
  assert.strictEqual(core.fRankPos('WR14'), 'WR');
  assert.ok(core.fRankValue('RB10') > core.fRankValue('RB2'));
});

test('the real pool sorts the way the page promises', () => {
  const pool = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/players.json'), 'utf8'));
  const players = Array.isArray(pool) ? pool : Object.values(pool);
  const id = table({
    frank: {
      get: p => core.fRankValue(p.fRank), type: 'num', dir: 'asc',
      tie: { get: p => core.fRankPos(p.fRank), type: 'text' },
    },
    status: { get: p => core.statusRank(p), type: 'num', dir: 'desc' },
  }, { tie: { get: p => p.name, type: 'text' } });

  core.setTableSort(id, 'frank');
  const byRank = core.sortTableRows(id, players);
  assert.strictEqual(core.fRankValue(byRank[0].fRank), 1,
    'ascending by fantasy rank must open on a #1, not on the players who have no rank');
  const ranked = players.filter(p => core.fRankValue(p.fRank) !== null).length;
  assert.strictEqual(byRank.slice(ranked).every(p => core.fRankValue(p.fRank) === null), true,
    'every unranked player belongs behind every ranked one');

  core.setTableSort(id, 'status');
  const byStatus = core.sortTableRows(id, players);
  assert.notStrictEqual(byStatus[0].statusClass, 'status-healthy',
    'sorting by status descending should lead with somebody who is hurt');
  assert.strictEqual(byStatus[byStatus.length - 1].statusClass, 'status-healthy',
    'and end with somebody who is not');
});
