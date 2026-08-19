/**
 * POST /api/ask — the only server-side code on this site.
 *
 * WHY THIS EXISTS AT ALL: the key cannot go in the browser, so a question has
 * to be answered somewhere the key is private. Everything else here is still
 * static files; this is the one moving part, and it is built so that when it
 * breaks it breaks alone. Nothing on the rest of the site calls it.
 *
 * THE MODEL IS A READER, NOT A SOURCE. It is handed rows from this repo and
 * told to answer from them and nothing else. That is the entire design: a
 * general model can already talk about football, and if it is allowed to fall
 * back on that, the answer stops being checkable — which is worse here than a
 * wrong chart, because prose sounds certain and carries no qualifier.
 */

const { buildContext } = require('./_lib/retrieve.js');

// gemini-2.0-flash is RETIRED. The chain is newest-first; a 404 on a model name
// falls through to the next rather than failing the request, because a model
// being renamed upstream should not take the feature down.
const MODELS = ['gemini-2.5-flash', 'gemini-flash-latest'];
const ENDPOINT = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

const MAX_QUESTION = 500;
const TIMEOUT_MS = 20000;

// Best-effort, per-instance. Serverless spreads requests across instances so
// this is a speed bump rather than a gate — it exists to stop one tab hammering
// the free tier, not to stop a determined abuser, and it is honest about that.
const hits = new Map();
const WINDOW_MS = 60000;
const MAX_PER_WINDOW = 8;

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 500) {   // never let the map grow without bound
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > WINDOW_MS) hits.delete(k);
  }
  return list.length > MAX_PER_WINDOW;
}

const SYSTEM = `You are the answer engine for The Signal, an NFL analytics site.

You are given a CONTEXT object containing rows from the site's own data files.
Answer ONLY from that context.

Rules, in order of importance:
1. NEVER state a number that is not in the context. Not from memory, not from
   general football knowledge, not "approximately". If the context does not
   contain it, say the site does not have it.
2. If CONTEXT.noPlayerMatched is set, say you could not find that player in the
   350-player pool. Do not answer from general knowledge.
3. If CONTEXT.ambiguousNames is set, ask which player they meant and list them.
   Do not pick one.
4. A field reading "not published — under the sample floor" means the sample was
   too small. Say that. Never convert the play count into a rate yourself.
5. Every figure you quote carries its season and, where the context gives one,
   its qualifier or note. "48.6% on deep targets in 2025" — not "48.6%".
6. A player's injury status is what a team declared. It is never a prediction of
   what he will do. Do not turn a designation into a forecast.
7. Projections are a human analyst's medians, not a simulation. Say so if asked
   to justify one.
8. Be concise: two or three short paragraphs at most. No preamble, no "great
   question", no bullet lists unless comparing players.
9. If asked something the data cannot settle — a trade offer, a start/sit call —
   give the numbers that bear on it and say plainly which part is judgement.`;

async function callGemini(key, prompt) {
  let lastErr = null;
  for (const model of MODELS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 700 },
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status === 404) { lastErr = { status: 404, model }; continue; }
      const body = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, status: res.status, body };
      const text = body && body.candidates && body.candidates[0]
        && body.candidates[0].content && body.candidates[0].content.parts
        && body.candidates[0].content.parts.map(p => p.text).join('').trim();
      if (!text) return { ok: false, status: 502, body };
      return { ok: true, text, model };
    } catch (e) {
      clearTimeout(timer);
      lastErr = { status: e.name === 'AbortError' ? 504 : 500, message: e.message };
    }
  }
  return { ok: false, status: (lastErr && lastErr.status) || 500, body: lastErr };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Send a POST with a question.' });
    return;
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    // Said plainly rather than as a 500, because this is a configuration state
    // and not a fault, and the difference matters when reading a log.
    res.status(503).json({ error: 'The answer engine is not configured on this deployment.' });
    return;
  }

  let question = '';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    question = String(body.question || '').trim();
  } catch (e) {
    res.status(400).json({ error: 'Could not read the request.' });
    return;
  }
  if (!question) { res.status(400).json({ error: 'Ask a question.' }); return; }
  if (question.length > MAX_QUESTION) {
    res.status(400).json({ error: `Questions are capped at ${MAX_QUESTION} characters.` });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    res.status(429).json({ error: 'That is a lot of questions at once. Give it a minute.' });
    return;
  }

  let context;
  try {
    context = buildContext(question);
  } catch (e) {
    res.status(500).json({ error: 'Could not assemble the data for that question.' });
    return;
  }

  const prompt = `CONTEXT (the only facts you may use):\n${JSON.stringify(context, null, 1)}\n\nQUESTION: ${question}`;
  const out = await callGemini(key, prompt);

  if (!out.ok) {
    // Every failure here is the answer engine's, and the message says which so
    // a reader knows whether to retry or to stop asking.
    const msg = out.status === 429
      ? 'The answer engine has hit its rate limit. Try again shortly.'
      : out.status === 504
      ? 'The answer engine took too long. Try again.'
      : out.status === 401 || out.status === 403
      ? 'The answer engine could not authenticate.'
      : 'The answer engine is unavailable right now.';
    res.status(out.status === 429 ? 429 : 502).json({ error: msg });
    return;
  }

  res.status(200).json({
    answer: out.text,
    // What the answer was built from, so a reader can check it against the site.
    grounding: {
      players: (context.askedAbout || []).map(p => ({ name: p.name, position: p.position, team: p.team })),
      topics: context.topicsDetected || [],
      ambiguous: context.ambiguousNames || null,
    },
  });
};
