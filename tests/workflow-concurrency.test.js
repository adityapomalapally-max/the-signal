/**
 * Which workflows may be cancelled mid-flight, and which must not.
 *
 * The mutation gate takes about half an hour. On 2026-10-02 four runs of it
 * raced after four pushes in an afternoon, reported OUT OF ORDER — a run
 * measuring a commit two behind landed after a newer one — and a stale catch
 * count was one keystroke from being recorded as the baseline. A ratchet is only
 * meaningful if its number describes the tip of the branch.
 *
 * So Tests cancels its own older runs, and the two workflows that WRITE must
 * not: killing a half-finished data build loses the day's fetches and can leave
 * data/ half-written between the build steps and the commit. The asymmetry is
 * the point, and it is the kind of thing that gets "tidied" into consistency by
 * someone who does not know why it differs.
 *
 *   node --test tests/workflow-concurrency.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WF = path.join(__dirname, '..', '.github', 'workflows');
const read = (f) => fs.readFileSync(path.join(WF, f), 'utf8');

/** The concurrency block, read without a YAML parser — there is none in this repo. */
function concurrency(src) {
  const m = src.match(/^concurrency:\n((?:[ \t]+.*\n)+)/m);
  if (!m) return null;
  const body = m[1];
  const group = (body.match(/^\s+group:\s*(.+)$/m) || [])[1];
  const cancel = (body.match(/^\s+cancel-in-progress:\s*(true|false)\s*$/m) || [])[1];
  return { group: group && group.trim(), cancel: cancel === 'true' };
}

test('the test workflow cancels its own older runs', () => {
  const c = concurrency(read('test.yml'));
  assert.ok(c, 'test.yml has no concurrency block, so gate runs will race again');
  assert.strictEqual(c.cancel, true, 'an older gate run is allowed to outlive a newer push');
  assert.match(c.group, /github\.workflow/, 'the group must not collide with another workflow');
  assert.match(c.group, /github\.ref/,
    'without the ref, a push to a branch would cancel the run for main');
});

test('a workflow that writes is never cancelled mid-flight', () => {
  // daily-update.yml fetches ~20 feeds, writes nine data files and commits.
  // health.yml opens and closes an issue. Cancelling either leaves work half
  // done; cancelling a measurement loses nothing anybody needs.
  for (const f of ['daily-update.yml', 'health.yml']) {
    const c = concurrency(read(f));
    assert.ok(c, `${f} has no concurrency block`);
    assert.strictEqual(c.cancel, false,
      `${f} may be cancelled mid-run, which can leave data/ half-written between the builds and the commit`);
  }
});

test('the gate still runs with the sample the baseline records', () => {
  // The whole reason the racing mattered: --strict compares against a recorded
  // budget and seed, and a run on a different sample is not comparable.
  const src = read('test.yml');
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'mutation-baseline.json'), 'utf8'));
  const m = src.match(/mutate\.js --budget (\d+) --seed (\d+) --strict/);
  assert.ok(m, 'the gate is not run with an explicit budget, seed and --strict');
  assert.strictEqual(Number(m[1]), baseline.budget, 'the workflow budget and the baseline disagree');
  assert.strictEqual(Number(m[2]), baseline.seed, 'the workflow seed and the baseline disagree');
});
