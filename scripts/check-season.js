#!/usr/bin/env node
/**
 * check-season.js — the alarm for the failure that has no symptom
 *
 * When the regular season starts, the risk is not that something breaks. It is
 * that nothing does: the fetch scripts go on asking for the seasons they were
 * told about, the builds go on succeeding, the site goes on rendering, and every
 * number on it quietly belongs to last year. There is no error to notice.
 *
 * So this asks the only question that matters — does the data on disk contain
 * the season the league is actually playing — and reds the run when it does not.
 *
 * Runs LAST in the Action, after the push, on the same bargain as
 * check-overrides and check-feeds: a stale season should colour the run without
 * holding up the day's real data.
 *
 *   node scripts/check-season.js
 */

const fs = require('fs');
const path = require('path');
const season = require('./lib/season');
const feeds = require('./lib/feeds');

// THE ALARM HAS TO BE POINTABLE AT A STATE ON PURPOSE. Every branch below is
// about data that is missing, old or pending, and the only way to reach one
// from a test was to put the repo's real data into that state — so the only
// state ever exercised was whatever this morning happened to look like, and
// the one that mattered (a layer excused by a stamp while its feed had already
// published) had never run at all. Same lesson as judgeRuns in health-report.
const DATA = process.env.SIGNAL_DATA_DIR
  ? path.resolve(process.env.SIGNAL_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const problems = [];
const notes = [];

function has(file) {
  return fs.existsSync(path.join(DATA, file));
}

async function main() {
  const st = await season.state();
  const latest = await season.latestDataSeason();
  const target = await season.targetSeason();
  const inSeason = await season.isInSeason();

  console.log(`[season] the league is in ${await season.describe()}`);
  console.log(`[season] latest season with data: ${latest} | projections are about: ${target}`);

  if (st.source.startsWith('date fallback')) {
    notes.push(`the season feed was unreachable, so this ran off the calendar — ${st.source}`);
  }

  // ---- Do the stat layers contain the season being played? ----------------
  // Only meaningful once real games exist. In August, 2026 stats SHOULD be
  // missing and their absence is not a fault.
  //
  // NOR IS IT ONE IN WEEK 1. The ros.json check below has always known that the
  // season flips over days before anyone kicks off; this block did not, and
  // asked for stat rows that could not exist yet. nflverse builds a season's
  // file only after its first games are played, so through Week 1 the absence
  // of this season's rows is the honest state of the world. From Week 2 the
  // games are on file, and their absence IS the year-stale failure this alarm
  // was written for — which is still caught, one week later than the ideal and
  // eleven weeks earlier than a human would have noticed.
  const dataIsDue = inSeason && (st.week || 0) > 1;
  if (dataIsDue) {
    const checks = [
      { file: 'stats.json', label: 'season stats', seasons: (j) => collect(j, p => Object.keys(p.seasons || {})) },
      { file: 'ngs.json', label: 'Next Gen Stats', seasons: (j) => collect(j, p => Object.keys(p).filter(k => /^\d{4}$/.test(k))) },
      { file: 'injuries.json', label: 'injury reports', seasons: (j) => collect(j, p => Object.keys(p).filter(k => /^\d{4}$/.test(k))) },
    ];
    for (const c of checks) {
      if (!has(c.file)) { problems.push(`${c.file} is missing entirely`); continue; }
      const years = c.seasons(read(c.file));
      if (!years.includes(String(latest))) {
        problems.push(
          `${c.label} (${c.file}) has no ${latest} rows — the season is under way and this layer is still `
          + `showing ${years[years.length - 1] || 'nothing'}. Every profile reading from it is a year stale.`);
      }
    }

    // The layers that state their own seasons in meta. THE IN-SEASON SECTION
    // EXISTS TO BE USED DURING THE SEASON, which makes a silent rollover there
    // worse than anywhere else on the site: the page would go on showing last
    // year's defences under a banner that says "preseason" and look correct.
    //
    // A LAYER WHOSE FEED HAS NOT PUBLISHED IS PENDING, NOT BEHIND, AND THE
    // DIFFERENCE IS ASKED RATHER THAN ASSUMED. nflverse publishes pbp, snap
    // counts and FTN charting the morning after a game and pbp_participation
    // long after that — 2026 was still a 404 in Week 2 — so the three layers
    // built on participation cannot be there and the rest can. Reading them
    // the same way reddened the daily run four problems at a time, every
    // morning, over a file nobody here can make appear; and it would have gone
    // on doing so when the feed DID land and the build failed to pick it up,
    // because the message would not have changed. `feed` marks the gated ones
    // and lib/feeds.js asks the source which case this is.
    const metaSeasoned = [
      { file: 'scheme.json', label: 'personnel and identity', feed: 'pbp_participation' },
      { file: 'player-usage.json', label: 'personnel usage by player', feed: 'pbp_participation' },
      { file: 'routes.json', label: 'route concepts', feed: 'pbp_participation' },
      { file: 'charting.json', label: 'first reads and checkdowns' },
      { file: 'fieldmap.json', label: 'the field maps' },
      { file: 'matchups.json', label: 'the matchup board' },
      { file: 'weekly-usage.json', label: 'weekly snap and target share' },
    ];
    for (const m of metaSeasoned) {
      if (!has(m.file)) { problems.push(`${m.file} is missing entirely`); continue; }
      const j = read(m.file);
      const years = ((j.meta && j.meta.seasons) || []).map(String);
      const hasSeason = years.includes(String(latest));
      if (hasSeason) continue;
      if (m.feed) {
        const verdict = feeds.judgeGatedLayer({
          label: m.label, file: m.file, season: latest, feed: m.feed,
          hasSeason, published: await feeds.participationPublished(latest),
        });
        (verdict.level === 'problem' ? problems : notes).push(verdict.message);
        continue;
      }
      // A LAYER CAN BE EMPTY BECAUSE THE SEASON IS YOUNG, and only the build
      // knows it. The field map qualifies a passer at 200 attempts; nobody has
      // thrown 200 by Week 2, so it honestly has no 2026 until about Week 6.
      // That is indistinguishable, from here, from a build that stopped
      // running — so build-scheme writes the reason into the file's own meta
      // and this reads it back. The stamp is only honoured for the season
      // being played: come next September a 2026 stamp says nothing about
      // 2027 and the alarm rings again.
      //
      // IT IS NOT HONOURED FOR A FEED-GATED LAYER, which is why that branch is
      // above this one. That answer comes from nflverse rather than from us,
      // and a stamp left behind by a build that is no longer running would go
      // on excusing a layer the feed had already published.
      const stamped = (j.meta && j.meta.pending) || null;
      if (stamped && Number(stamped.season) === Number(latest)) {
        notes.push(`${m.label} (${m.file}) has no ${latest} yet and says why: ${stamped.reason}`);
        continue;
      }
      problems.push(
        `${m.label} (${m.file}) has no ${latest} — the season is under way and this layer still ends at `
        + `${years[years.length - 1] || 'nothing'}.`);
    }
  } else if (inSeason) {
    notes.push(`week ${st.week || 0}: ${target} stat rows are not published yet, which is correct this early`);
  } else {
    notes.push(`not in season yet, so ${target} stat rows are correctly absent`);
  }

  // ---- Are the preseason-built products still claiming to be current? -----
  // This one IS keyed to kickoff rather than to Week 2: drafts close when the
  // season starts, so an unfrozen ADP is wrong from the first game, not from
  // the second week.
  if (inSeason) {
    if (has('adp.json')) {
      const adp = read('adp.json');
      if (!adp.meta.historical) {
        problems.push(
          `ADP is a DRAFT artefact and the season has started. adp.json is from ${adp.meta.fetchedAt ? adp.meta.fetchedAt.slice(0, 10) : 'an unknown date'} `
          + `— the Value Board compares ranks to it and now describes a market that has closed. fetch-adp.js should have frozen it.`);
      } else {
        notes.push(`ADP is frozen and labelled historical (closed ${String(adp.meta.closedAt).slice(0, 10)}) — correct for a season in progress`);
      }
    }
    // Only once games have actually been played. The season flips over days
    // before Week 1 kicks off, and demanding a rest-of-season projection with no
    // games on file would raise an alarm about a completely normal week.
    const week = st.week || 0;
    if (week > 1 && !has('ros.json')) {
      problems.push('no ros.json — the season is under way and nothing is producing rest-of-season '
        + 'projections, so the only forecast on the site is the one built in August.');
    } else if (!has('ros.json')) {
      notes.push('no ros.json yet, which is correct this early — the season has flipped over but Week 1 may not have been played');
    }
    if (has('sos.json')) {
      const sos = read('sos.json');
      // WHAT IT IS WAITING FOR, not just that it is old. build-sos switches to
      // this season's defences once five weeks have been played
      // (MIN_WEEKS_FOR_LIVE), and a note that says only "this decays" reads as
      // something nobody has dealt with rather than something scheduled.
      const onLast = Number(sos.meta.defenseSeason) !== Number(latest);
      const seg = (sos.meta.segments && sos.meta.segments[sos.meta.headline]) || null;
      notes.push(onLast
        ? `SOS covers ${seg ? seg.label.toLowerCase() : 'the season'} off ${sos.meta.defenseSeason} defences — `
          + `build-sos switches to ${latest} once five weeks have been played, and says so in its own caveats`
        : `SOS covers ${seg ? seg.label.toLowerCase() : 'the season'} off ${latest} defences, this season's own`);
    }
    // DERIVED, NOT TYPED. A hardcoded file name here is a note that quietly
    // stops appearing the first season after the one it names — the same shape
    // as the test that pinned projections-2026.json behind a silent return.
    if (has(`projections-${target}.json`)) {
      // WHAT THIS NOTE SAID WAS TRUE THE DAY IT WAS WRITTEN AND FALSE EVERY
      // MORNING SINCE build-ros.js LANDED. It claimed rest-of-season was "the
      // useful number, which nothing generates yet" while ros.json was being
      // rebuilt daily and read by the profile card. Prose in a checker is not
      // tested by anything, so a line like that goes on being printed for as
      // long as nobody reads it carefully — which is the same failure as the
      // alarm nobody can act on, in the quietest possible form.
      const ros = has('ros.json') ? read('ros.json') : null;
      const rosMeta = (ros && ros.meta) || null;
      notes.push(rosMeta
        ? `projections are preseason season-long medians; the in-season number is rest-of-season, and `
          + `ros.json has it through week ${rosMeta.throughWeek} for ${(rosMeta.coverage || {}).projected} players `
          + `(${rosMeta.gamesRemaining} games left)`
        : 'projections are preseason season-long medians; nothing on disk carries a rest-of-season number');
    }
  }

  // ---- Does a board carrying a LIVE figure get rebuilt with the run? -----
  // rankings.json prints a status flag beside each player's missed-time case,
  // and that flag is computed at build time. The file was not in the daily
  // Action for most of a year, so the flag was as fresh as the last time
  // somebody ran the script by hand — four days stale when this was written,
  // and nothing on the site or in the checks said so. A number that looks live
  // and is not is worse than an absent one: the data-age banner reads
  // meta.json, so the site would call itself current while this board
  // described last week's injuries.
  if (has('rankings.json')) {
    const r = read('rankings.json');
    const builtAt = r.meta && r.meta.builtAt;
    const ageDays = builtAt ? (Date.now() - Date.parse(builtAt)) / 86400000 : null;
    if (ageDays === null) {
      problems.push('rankings.json has no meta.builtAt, so there is no way to tell whether its live status flags are current');
    } else if (inSeason && ageDays > 3) {
      problems.push(
        `rankings.json was built ${Math.floor(ageDays)} days ago and the season is under way. The status flag `
        + `beside each missed-time case is that old, so the board is describing injuries from a previous week `
        + `while the rest of the site is current. build-rankings.js should be running in the daily Action.`);
    } else if (ageDays > 8) {
      notes.push(`rankings.json is ${Math.floor(ageDays)} days old — fine out of season, but its status flags are that stale`);
    } else {
      notes.push(`rankings.json rebuilt ${Math.floor(ageDays)} day(s) ago, so its live status flags are current`);
    }
  }

  // ---- Is the target season itself stale? --------------------------------
  const teams = has('teams.json') ? read('teams.json') : null;
  if (teams && teams.meta && teams.meta.season && Number(teams.meta.season) !== target) {
    problems.push(`teams.json is built for ${teams.meta.season} but the league year is ${target}`);
  }

  for (const n of notes) console.log(`[season] note: ${n}`);
  if (!problems.length) {
    console.log('[season] OK — the data on disk matches the season being played.');
    return;
  }
  console.error(`\n[season] ${problems.length} problem(s):`);
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('\nThe season rolled over and the pipeline did not. See scripts/lib/season.js.');
  process.exit(1);
}

function collect(json, fn) {
  const years = new Set();
  for (const [k, v] of Object.entries(json)) {
    if (k === 'meta' || !v || typeof v !== 'object') continue;
    for (const y of fn(v)) if (/^\d{4}$/.test(y)) years.add(y);
  }
  return [...years].sort();
}

main().catch(e => {
  console.error('[season] check failed to run:', e.message);
  process.exit(1);
});
