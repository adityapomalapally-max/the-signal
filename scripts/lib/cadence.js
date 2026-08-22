/**
 * cadence.js — what kind of run is this?
 *
 * ONE BUILD A DAY IS THE RIGHT SHAPE FOR THE DATA, AND THE WRONG SHAPE FOR
 * SUNDAY. Measured against nflverse's own publishing schedule, the 11:00 UTC
 * daily run is well placed: they rebuild play-by-play after Thursday night
 * (05:30 UTC Fri), the early window (22:00 UTC Sun), the late window (00:05 UTC
 * Mon), Sunday night (05:30 UTC Mon) and Monday night (05:30 UTC Tue). Every
 * one of those lands overnight, so a 11:00 UTC build has the whole weekend in
 * it by Monday morning and Monday night's game by Tuesday morning. Nothing
 * about the STATS needs a second run.
 *
 * What does is everything that changes on the day. Inactives are official
 * ninety minutes before kickoff — 11:30 ET for a 1pm game — and a build that
 * ran at 6:00 ET does not have them. A reader setting a lineup at noon on
 * Sunday is looking at a status page from before the teams announced who is
 * playing, which is the single worst moment of the week to be five hours
 * behind. The adds a room makes on Tuesday night, before Wednesday's waivers
 * process, are the same story.
 *
 * So there are two tiers, split by where the data comes from rather than by
 * how important it is:
 *
 *   full   — everything, including ~200MB of nflverse CSVs. Once a day.
 *   light  — the sources that answer in seconds: Sleeper statuses, trending,
 *            ESPN news, and the boards derived from them. In season only.
 *
 * THE TIER IS DECIDED BY THE CRON THAT FIRED, NOT BY THE CLOCK. GitHub delays
 * scheduled runs, sometimes past the hour, so `new Date().getUTCHours() === 11`
 * would quietly turn a late daily build into a light one and skip the day's
 * real work. `github.event.schedule` is the exact expression that triggered the
 * run, and it is not subject to being late.
 *
 * And the mapping is a RULE, not a list: the full build is whichever cron sits
 * at 11:00 UTC, and every other schedule is a light refresh. A list of cron
 * strings kept here would be a second copy of the workflow's schedule, and the
 * two would drift the first time one was edited.
 *
 * Run: node scripts/lib/cadence.js --schedule "30 16 * * 0"
 *      node scripts/lib/cadence.js --tier light
 */

const season = require('./season');

// The hour the full build has always run at. The workflow states it too; this
// is the one that decides, and tests/cadence.test.js fails if they disagree.
const FULL_HOUR_UTC = 11;

/** Which tier a cron expression asks for, before the season is considered. */
function tierForSchedule(cron) {
  const parts = String(cron || '').trim().split(/\s+/);
  if (parts.length < 5) return null;
  return Number(parts[1]) === FULL_HOUR_UTC ? 'full' : 'light';
}

/**
 * @returns {{tier: 'full'|'light'|'none', why: string}}
 */
async function plan({ schedule, tier } = {}) {
  // A person asking for a run by hand gets what they asked for. They are
  // standing there watching it, which is a thing no schedule can claim.
  if (tier === 'full' || tier === 'light') {
    return { tier, why: `asked for by hand (${tier})` };
  }

  const asked = tierForSchedule(schedule);
  if (asked === 'full' || !asked) {
    // No schedule and no request means something else triggered this — a push,
    // a dispatch with no input. Do the whole thing rather than half of it.
    return { tier: 'full', why: asked ? 'the daily build' : 'not a scheduled run, so nothing is being skipped' };
  }

  const st = await season.state();
  const playing = st.phase === 'regular' || st.phase === 'post';
  if (!playing) {
    // Out of season a status refresh has nothing to refresh: nobody is being
    // ruled out of a game that is not being played. The extra crons cost one
    // twenty-second no-op each and manage themselves, which is cheaper than a
    // month range in the schedule that has to be remembered every year.
    return { tier: 'none', why: `no games are being played (${st.season} ${st.phase}), so there is nothing a status refresh would catch` };
  }
  return { tier: 'light', why: `${st.season} ${st.phase} week ${st.week} — statuses, trending and the boards built from them` };
}

module.exports = { plan, tierForSchedule, FULL_HOUR_UTC };

if (require.main === module) {
  const args = process.argv.slice(2);
  const val = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : (args[i + 1] || '').trim() || undefined;
  };
  plan({ schedule: val('--schedule'), tier: val('--tier') }).then(({ tier, why }) => {
    // Both, because the log is where anybody looks when a run did less than
    // they expected, and "tier=none" on its own explains nothing.
    console.error(`[cadence] ${tier} — ${why}`);
    console.log(`tier=${tier}`);
  });
}
