/**
 * What the answer engine is allowed to see.
 *
 * The chatbot's only real risk is that it states a number this site does not
 * have. Every other layer here refuses to publish an unsourced figure; prose
 * undoes that more thoroughly than a bad chart, because it sounds certain and
 * carries no qualifier.
 *
 * The model cannot be unit-tested. The CONTEXT can, and the context is the only
 * thing standing between a question and an invented answer — so these tests are
 * about what does and does not reach it.
 *
 *   node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = require('../api/_lib/retrieve.js');
const pool = require('../data/players.json');

test('a full name pins one player and does not drag in his namesakes', () => {
  const m = R.findPlayers('is Bijan Robinson worth the first pick?', pool);
  assert.deepStrictEqual(m.players.map(p => p.name), ['Bijan Robinson']);
  assert.strictEqual(m.ambiguous.length, 0, 'a first name resolves the surname — nothing is ambiguous here');
});

test('a bare surname returns every player it could mean, and says so', () => {
  // resolvePlayer('robinson') once returned Bijan for a question about someone
  // else, because the slugs are surnames and the first match won.
  const m = R.findPlayers('how is robinson looking this year', pool);
  assert.ok(m.players.length > 1, 'more than one Robinson is in the pool');
  assert.strictEqual(m.ambiguous.length, 1);
  assert.ok(m.ambiguous[0].players.length > 1, 'the ambiguity has to name the candidates');
  assert.match(m.ambiguous[0].players[0], /\(\w+, \w+\)/, 'each candidate carries position and team to tell them apart');
});

test('two named players both survive', () => {
  const m = R.findPlayers('start Puka Nacua or Malik Nabers?', pool);
  const names = m.players.map(p => p.name);
  assert.ok(names.includes('Puka Nacua') && names.includes('Malik Nabers'), `got ${names.join(', ')}`);
});

test('a generational suffix is not a surname', () => {
  // "James Cook III" made "iii" look like a surname, and three players in the
  // pool shared it — so any question containing the word matched all of them.
  const m = R.findPlayers('is iii worth a pick', pool);
  assert.strictEqual(m.players.length, 0, `matched ${m.players.map(p => p.name).join(', ')}`);
  // And the real surname behind the suffix still resolves.
  const cook = R.findPlayers('how is cook doing', pool);
  assert.ok(cook.players.some(p => /Cook/.test(p.name)), 'the name under the suffix must still match');
});

test('a name written without its suffix still resolves, and consumes both words', () => {
  // Two bugs in one question. People write "James Cook", not "James Cook III",
  // so the full-name match missed and fell through to the surname — which
  // matched Brady Cook too. And "James" is Jordan James's surname, so the
  // first name matched a third player. One named player returned three.
  const m = R.findPlayers('which gaps does James Cook run well through?', pool);
  assert.strictEqual(m.players.length, 1, `got ${m.players.map(p => p.name).join(', ')}`);
  assert.match(m.players[0].name, /^James Cook/);
  assert.strictEqual(m.ambiguous.length, 0, 'a full name is not ambiguous');
});

test('a first name that is also a surname does not pull in a stranger', () => {
  const m = R.findPlayers('James Cook', pool);
  assert.ok(!m.players.some(p => p.name === 'Jordan James'),
    'matched Jordan James on the word "James" inside another player\'s full name');
});

test('the bare surname is still ambiguous once the first name is gone', () => {
  // The fix above must not over-correct: a surname shared by two players
  // genuinely is ambiguous and must come back as several.
  //
  // THE SURNAME IS TAKEN FROM THE POOL RATHER THAN NAMED HERE. This test used
  // to ask about "cook" and assert several came back, which was true until the
  // morning Brady Cook fell out of the 350 — the pool is deliberately
  // hysteretic but it does churn, and the daily bot's commit failed on a test
  // that was really asserting who was rostered. What is being checked is the
  // RULE, so the fixture comes from whatever the data currently contains.
  const bySurname = new Map();
  for (const p of pool) {
    const parts = p.name.split(/\s+/);
    if (parts.length < 2) continue;
    // Skip generational suffixes: "III" is not a surname, and a pair sharing
    // one would be a different test.
    const last = parts[parts.length - 1].replace(/[.,]/g, '');
    const surname = /^(jr|sr|ii|iii|iv|v)$/i.test(last) ? parts[parts.length - 2] : last;
    const key = surname.toLowerCase().replace(/[^a-z]/g, '');
    if (key.length < 4) continue;   // a very short surname is its own test below
    bySurname.set(key, (bySurname.get(key) || []).concat(p.name));
  }
  const shared = [...bySurname.entries()].filter(([, names]) => names.length > 1);
  assert.ok(shared.length, 'no surname in the pool is shared by two players, which cannot be right for 350 of them');

  const [surname, names] = shared[0];
  const m = R.findPlayers(`how is ${surname} doing this year`, pool);
  assert.ok(m.players.length > 1,
    `"${surname}" is shared by ${names.join(', ')} but came back as ${m.players.map(p => p.name).join(', ') || 'nothing'}`);
  assert.strictEqual(m.ambiguous.length, 1);
});

test('a genuinely short surname still matches', () => {
  // The first version of this excluded anything under four letters, which was
  // safe and also made Bo Nix unanswerable.
  const m = R.findPlayers('how is nix looking this season', pool);
  assert.ok(m.players.some(p => p.name === 'Bo Nix'), `got ${m.players.map(p => p.name).join(', ') || 'nothing'}`);
});

test('a question naming nobody matches nobody', () => {
  const m = R.findPlayers('what does a bye week do to my flex spot', pool);
  assert.strictEqual(m.players.length, 0, `matched ${m.players.map(p => p.name).join(', ')}`);
});

test('a question about nobody in the pool says so, loudly', () => {
  const ctx = R.buildContext('how good is Tom Brady these days');
  assert.ok(!ctx.askedAbout || !ctx.askedAbout.length);
  assert.ok(ctx.noPlayerMatched, 'the context must state that nothing matched');
  assert.match(ctx.noPlayerMatched, /general knowledge/i,
    'and it must tell the model not to fall back on what it already knows');
});

test('a thin cell reaches the model as a refusal, never as a number', () => {
  // The single most dangerous value in the whole pipeline. A field-map cell
  // under the sample floor has a play COUNT and no rate; handed the count in a
  // rate-shaped field, the model will report it as one.
  //
  // The first version of this filtered for cells that already carried the
  // refusal string — which is exactly what a regression removes, so it passed
  // over an empty list. It now finds thin cells by their SOURCE (the raw
  // fieldmap marks them) and checks what the context did with them.
  const fm = require('../data/fieldmap.json');
  const yr = Object.keys(fm.seasons).sort().pop();
  const passers = fm.seasons[yr].passers;
  const gsis = Object.keys(passers).find(id => Object.values(passers[id].cells).some(c => c.thin));
  assert.ok(gsis, 'no passer has a thin cell — the fixture this test relies on has changed');

  const player = pool.find(p => p.gsisId === gsis);
  assert.ok(player, 'the thin-celled passer is not in the pool');
  const ctx = R.buildContext(`where does ${player.name} throw on the field`);
  const qb = (ctx.askedAbout || []).find(p => p.name === player.name);
  assert.ok(qb && qb.fieldMap && qb.fieldMap.byZone, 'the zone grid did not reach the context');

  const sourceThin = Object.entries(passers[gsis].cells).filter(([, c]) => c.thin).map(([k]) => k);
  assert.ok(sourceThin.length, 'expected at least one thin cell');
  for (const key of sourceThin) {
    const cell = qb.fieldMap.byZone[key];
    assert.ok(cell, `${key} vanished from the context entirely`);
    assert.strictEqual(typeof cell.rate, 'string', `${key} must carry a stated refusal, got ${JSON.stringify(cell)}`);
    assert.match(cell.rate, /not published|sample floor/i, `${key}: the refusal must say why`);
    assert.strictEqual(cell.compPct, undefined, `${key} must not carry a completion rate`);
    assert.strictEqual(cell.epa, undefined, `${key} must not carry an EPA`);
  }
});

test('nulls never reach the model', () => {
  // A null in a numeric field reads as a value. Absent reads as "not on file",
  // which is the true statement.
  const ctx = R.buildContext('tell me about Puka Nacua production and injuries');
  const walk = (v, trail) => {
    if (v === null) assert.fail(`null survived at ${trail}`);
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${trail}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${trail}.${k}`);
  };
  walk(ctx, 'context');
});

test('the phrasing of a question never decides whether real data reaches the model', () => {
  // This used to gate the layers on keywords in the question, and the gate
  // failed on the most natural phrasing there is: "where does Stafford throw
  // best" did not match the field regex, so the field map never loaded and the
  // answer said the site has no such data. It has exactly that data.
  //
  // A false "we do not have it" hides a real number as surely as an invented
  // one states a fake, and it is harder to catch because it wears the same
  // honesty the rest of the engine is built on.
  const phrasings = [
    'where does Matthew Stafford throw best',
    'Matthew Stafford deep ball',
    'how good is Matthew Stafford',
    'tell me about Matthew Stafford',
  ];
  const layers = phrasings.map(q => {
    const p = (R.buildContext(q).askedAbout || [])[0];
    assert.ok(p, `no player matched for: ${q}`);
    return Object.keys(p).sort().join(',');
  });
  assert.strictEqual(new Set(layers).size, 1,
    `the same player returns different layers depending on wording:\n  ${phrasings.map((q, i) => `${q} -> ${layers[i]}`).join('\n  ')}`);
  const first = (R.buildContext(phrasings[0]).askedAbout || [])[0];
  assert.ok(first.fieldMap, 'the field map must reach the model for a "where does he throw" question');
});

test('every figure travels with the season it belongs to', () => {
  const ctx = R.buildContext('what did Puka Nacua do last season and how is he charted');
  const p = ctx.askedAbout[0];
  if (p.production) assert.ok(p.production.season, 'production carries no season');
  if (p.charting) assert.ok(p.charting.season, 'charting carries no season');
  if (p.fieldMap) assert.ok(p.fieldMap.season, 'the field map carries no season');
  // The projection was the one that did not, and the model read it as belonging
  // to the season sitting beside it — reporting a 2026 forecast as 2025 fact.
  if (p.ranking) {
    assert.ok(p.ranking.projectionForSeason, 'the projection carries no season');
    const production = p.production && Number(p.production.season);
    if (production) {
      assert.notStrictEqual(Number(p.ranking.projectionForSeason), production,
        'the projection season equals the production season — one of them is mislabelled');
    }
  }
});

test('the context stays small enough to send', () => {
  // It is pasted into every prompt. A context that grows unbounded is a bill.
  const ctx = R.buildContext('compare Bijan Robinson and Jahmyr Gibbs on gaps, usage, injuries and rank');
  const kb = Buffer.byteLength(JSON.stringify(ctx)) / 1024;
  assert.ok(kb < 60, `context is ${kb.toFixed(0)}KB — too much to send on every question`);
});

test('the prompt forbids inventing, and says it first', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'ask.js'), 'utf8');
  const sys = src.slice(src.indexOf('const SYSTEM'), src.indexOf('async function callGemini'));
  assert.match(sys, /NEVER state a number that is not in the context/i);
  assert.match(sys, /sample floor/i, 'the thin-cell rule has to be in the prompt, not only in the data');
  assert.match(sys, /ambiguousNames/, 'the model has to be told to ask rather than pick');
  assert.match(sys, /never a prediction/i, 'a designation must not become a forecast');
});

test('the endpoint never returns the key, whatever goes wrong', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'ask.js'), 'utf8');
  // Every response path, checked for the one thing that must never be in one.
  const responses = src.match(/res\.status\([^)]*\)\.json\(\{[\s\S]*?\}\)/g) || [];
  assert.ok(responses.length >= 6, `only found ${responses.length} response paths`);
  for (const r of responses) {
    assert.ok(!/GEMINI_API_KEY|process\.env|\bkey\b/.test(r), `a response path mentions the key: ${r.slice(0, 80)}`);
  }
  // And the upstream error body is never forwarded verbatim, because it can
  // echo the request.
  assert.ok(!/json\(\{[^}]*body[^}]*\}\)/.test(src), 'an upstream error body is being returned to the caller');
});

test('a surname paired with somebody else\'s first name is not a match', () => {
  // THE BUG THIS EXISTS FOR. "Is Brady Cook any good" answered about James Cook
  // III. Brady Cook had fallen out of the 350-player pool, the full-name match
  // found nothing, and the bare surname matched the one Cook left — confidently,
  // with nothing flagged as ambiguous, about a different man.
  //
  // The standing rule is never to guess an ambiguous name match. This is the
  // same rule from a direction it did not cover: the danger is not only two
  // players sharing a surname, it is a reader naming one the pool does not hold.
  const cooks = pool.filter(p => /(^|\s)cook($|\s|\b)/i.test(p.name));
  if (cooks.length === 1) {
    const other = 'brady';
    assert.ok(!new RegExp(`^${other}`, 'i').test(cooks[0].name), 'fixture assumes the pool Cook is not Brady');
    const m = R.findPlayers(`is ${other} cook any good`, pool);
    assert.deepStrictEqual(m.players.map(p => p.name), [],
      `naming a player the pool does not have returned ${m.players.map(p => p.name).join(', ')}`);
  }

  // The general form, built from whoever is actually in the pool: take a
  // player, ask about his surname with a first name nobody has, and get nothing.
  const withSurname = pool.find(p => p.name.split(/\s+/).length >= 2);
  const surname = withSurname.name.split(/\s+/).filter(w => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(w)).pop();
  const sharing = pool.filter(p => p.name.toLowerCase().includes(surname.toLowerCase()));
  const m2 = R.findPlayers(`how is zebulon ${surname} doing`, pool);
  assert.deepStrictEqual(m2.players.map(p => p.name), [],
    `"zebulon ${surname}" should match nobody, got ${m2.players.map(p => p.name).join(', ')} (pool has ${sharing.length} with that surname)`);
});

test('the guard does not break the questions that should work', () => {
  // The cost of being wrong here is an engine that cannot answer about real
  // players, so the ordinary shapes are pinned.
  const p = pool.find(x => x.name === 'Jonathan Taylor') || pool.find(x => x.name.split(/\s+/).length === 2);
  const [first, last] = p.name.split(/\s+/);
  for (const q of [`how is ${last} doing`, `is ${first} ${last} healthy`, `what about ${last}`, `${last} usage`]) {
    const m = R.findPlayers(q, pool);
    assert.ok(m.players.some(x => x.name === p.name), `"${q}" no longer finds ${p.name}`);
  }
});

test('the guard is exercised directly, including the branch the pool cannot reach', () => {
  // `own.has(before)` — the case where the word in front of a surname is the
  // player's OWN first name — is not reachable through findPlayers today,
  // because a question naming both words full-matches before the surname path
  // runs. A mutation deleting it therefore changed nothing, which is the
  // definition of an untested branch. It is called directly instead.
  const f = R.precededByAnotherFirstName;
  assert.strictEqual(f(' is brady cook any good ', 'cook', 'james cook iii'), true,
    'somebody else\'s first name should disqualify the match');
  assert.strictEqual(f(' how is james cook doing ', 'cook', 'james cook iii'), false,
    'his own first name must not disqualify him');
  assert.strictEqual(f(' how is cook doing ', 'cook', 'james cook iii'), false,
    '"is" is not a first name');
  assert.strictEqual(f(' cook is good ', 'cook', 'james cook iii'), false,
    'a surname opening the question has nothing in front of it');
  assert.strictEqual(f(' rb cook usage ', 'cook', 'james cook iii'), false,
    'a two-letter word in front is a position, not a name');
  assert.strictEqual(f(' about cook ', 'cook', 'james cook iii'), false,
    '"about" is not a first name');
});
