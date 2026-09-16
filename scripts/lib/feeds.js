/**
 * feeds.js — asking an upstream feed whether it has published a season yet,
 * and what that answer means for the layers built on top of it.
 *
 * THE FAILURE THIS EXISTS FOR. nflverse does not publish every file for a
 * season at the same time. Play-by-play, snap counts and FTN charting all land
 * the morning after a game; `pbp_participation` does not — 2026 was still a 404
 * in Week 2 while the other three carried the whole season. The pipeline had
 * one rule for all of them, and it cost twice:
 *
 *   - build-scheme fetched participation and pbp in one Promise.all, so the
 *     404 rejected the whole season build and SEVEN outputs went dark. Only
 *     three of them read participation. The field maps, first reads, weekly
 *     shares, rushing and xfp layers had every row they needed and were
 *     skipped anyway, in season, when they are the numbers people come for.
 *
 *   - check-season then reddened the daily run for exactly that absence, every
 *     morning, four problems at a time. An alarm nobody can act on is the one
 *     people learn to scroll past, and this project has already paid for that
 *     lesson twice: a banner on a healthy morning, and a health report that
 *     counted its own ringing.
 *
 * So the question is asked out loud instead of assumed, in one place, by the
 * producer and the alarm alike. A layer whose feed has not published is
 * PENDING and says so. A layer whose feed HAS published and still has no rows
 * is BEHIND, and that is the year-stale failure check-season was written for —
 * which this now catches the morning it becomes true rather than never.
 *
 * The publication state is a fact about the world, not about us, so nothing
 * here writes it down: a stamp on disk would need a freshness rule of its own,
 * and the only writer of that stamp going away would silence the alarm for
 * good. Asking costs one HEAD request a day.
 */

const https = require('https');
const { USER_AGENT } = require('./agent');

const RELEASES = 'https://github.com/nflverse/nflverse-data/releases/download';

// THE ONE DEFINITION OF THE URL. build-scheme fetches it and check-season asks
// after it; two copies of this string is two things to edit when nflverse moves
// a file, and the one nobody edits fails silently.
// participation ships uncompressed only — there is no .csv.gz asset.
function participationUrl(season) {
  return `${RELEASES}/pbp_participation/pbp_participation_${season}.csv`;
}

// null means WE COULD NOT TELL, which is a third answer and never folded into
// "no". A socket error here says nothing about whether nflverse published.
function headStatus(url, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const go = (u, redirects = 0) => {
      if (redirects > 5) return resolve(null);
      const req = https.request(u, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } }, (res) => {
        res.resume();
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return go(res.headers.location, redirects + 1);
        }
        resolve(res.statusCode);
      });
      req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
      req.on('error', () => resolve(null));
      req.end();
    };
    go(url);
  });
}

// One answer per season per run. check-season asks once for each of the three
// layers built on participation and they are the same question.
const cache = new Map();
let forced = null;

async function participationPublished(season) {
  if (forced !== null) return forced;
  const key = String(season);
  if (cache.has(key)) return cache.get(key);
  const code = await headStatus(participationUrl(season));
  const answer = code === null ? null : code === 200;
  cache.set(key, answer);
  return answer;
}

/**
 * What a season's participation download means for the build.
 *
 * AN EMPTY FILE IS A MISSING FILE — the rule the FTN charting block already
 * follows, and the one that stopped an empty 2026 charting file from throwing
 * "the join key moved" in Week 1.
 *
 * `fatal` is the other half: a season that has FINISHED must resolve, because
 * then a missing file is nflverse moving an asset on us, which has happened,
 * and carrying last year's numbers forward in silence is the whole failure
 * mode this pipeline is built against.
 */
function participationGate({ rows, error, seasonFinished }) {
  if (error) {
    return { available: false, fatal: !!seasonFinished, reason: String(error.message || error) };
  }
  if (!rows) {
    return {
      available: false,
      fatal: !!seasonFinished,
      reason: 'the participation file is published but empty',
    };
  }
  return { available: true, fatal: false, reason: null };
}

/**
 * A layer whose season is missing: is that pending, or is it behind?
 *
 * `hasSeason` — does the file on disk carry the season being played.
 * `published` — true, false, or null for "could not ask".
 */
function judgeGatedLayer({ label, file, season, feed, hasSeason, published }) {
  if (hasSeason) return { level: 'ok', message: null };
  if (published === true) {
    return {
      level: 'problem',
      message: `${label} (${file}) has no ${season} and nflverse HAS published ${feed}_${season} — `
        + `the feed is there and this layer is not reading it. Every profile reading from it is a year stale.`,
    };
  }
  if (published === false) {
    return {
      level: 'note',
      message: `${label} (${file}) correctly ends before ${season}: nflverse has not published `
        + `${feed}_${season} yet, so there is nothing to build it from`,
    };
  }
  return {
    level: 'note',
    message: `${label} (${file}) has no ${season} and nflverse could not be asked whether `
      + `${feed}_${season} exists — treated as pending, which is what every other feed in this run would `
      + `have failed on first if the network were the problem`,
  };
}

// The same escape hatch lib/season.js gives the calendar, for the same reason:
// the branch that needs a network is the one nobody has ever run.
function __setPublished(v) { forced = v; }
function __reset() { forced = null; cache.clear(); }

module.exports = {
  RELEASES, participationUrl, headStatus, participationPublished,
  participationGate, judgeGatedLayer, __setPublished, __reset,
};
