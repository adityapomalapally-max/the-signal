# The Signal

Vanilla HTML/CSS/JS SPA. No framework, no build step. Vercel auto-deploys from main.

## Architecture
- `index.html` — markup only (~800 lines). CSS and JS live in `assets/`
- `assets/styles.css` — all styles
- `assets/app-{core,export,pages,profile,feeds}.js` — the app, split by concern.
  THEY ARE CLASSIC SCRIPTS AND THE ORDER IN index.html IS LOAD-BEARING: they share one
  global scope because the markup has ~108 inline `onclick` handlers, and an inline handler
  can only see globals. Do NOT convert to `type="module"` — every handler would break
  silently. Do not reorder the tags; later files use bindings from earlier ones
- `scripts/build-players.js` — generates data/players.json: top-200 Sleeper pool, merged with
  status carry-over + curated overlay. NEVER edit players.json by hand. Runs FIRST in the Action
- `scripts/update-data.js` — daily GitHub Action, 6 AM ET. Sleeper statuses, ESPN news, trending
- `scripts/fetch-stats.js` — nflverse stats (stats_player release). GSIS-id match first, name second
- `scripts/fetch-ngs.js` — Next Gen Stats + snap counts → data/ngs.json. Same matching rules
- `scripts/fetch-injuries.js` — official NFL weekly injury reports → data/injuries.json. The
  GENERATED medical layer under the hand-written medicals.json (174/200 vs 31/200). nflverse's
  injuries schema is NOT stable across seasons: 2025 has season_type, 2024 and earlier only
  game_type. Read one alone and whole seasons silently match zero rows. Guard PER SEASON
- `scripts/lib/match.js` — THE player matcher + CSV fetch. Both fetch scripts use it; never fork it.
  It holds TWO normalizers and they are not interchangeable: `normalizeName` for nflverse CSVs,
  `normalizeSleeperName` (collapses hyphens, strips suffixes anywhere) for the Sleeper side
- `scripts/lib/status.js` — the status vocabulary + `formatStatus`. Sleeper ships `injury_body_part`
  next to `injury_status` and we discarded it for a season: seven players sat on "Knee - ACL" and
  rendered as a bare "Questionable", identical to a rest day. Detail goes in parens — the compact
  profile badge already splits there
- `data/injury-overrides.json` — the ONLY sanctioned way to hand-set a status. Dated, sourced,
  and EXPIRING (21 days by default). Beats the feed except a live IR/Out/PUP/NFI/Suspended/Doubtful,
  which always wins. Validate with `node scripts/check-overrides.js` (`--schema` prints the fields);
  it runs last in the Action, after the push, so a typo reds the run without blocking real data
- `scripts/build-rankings.js` — generates data/rankings.json. NEVER edit rankings.json by hand.
  Also computes the availability / missed-time case per player. That number MOVES THE DOWNSIDE,
  NEVER THE RANK — if a change to it reorders any board, the change is wrong. Sleeper's
  `experience` is not trustworthy for entry season (it lists 2023 draftees as 3rd Year), so a
  season with a game log on file always counts as eligible
- `data/players-curated.json` — hand-written rich profiles (athletic %iles, comps, pinned GSIS ids).
  Wins over the generated base, EXCEPT status/team/age/fRank, which drift and stay feed-owned
- The Medicals page unions THREE sources and labels which is which: the 31 hand-written narratives,
  the 269-player generated report history, and today's live status. `severity` and `impact` are
  DIFFERENT axes that both already exist — severity is how bad the injury was, impact is what it
  still costs him ("Resolved — Career Start" is severity high, impact 10). `severityLabel` is prose,
  48 distinct strings across 73 injuries, so it is a caption and never a category. Exactly one
  coloured chip per card and it always means TODAY; two red badges side by side had a healthy man
  with an old ACL reading as a scratch
- `data/medicals.json` — hand-written, never generated. An injury may carry an optional
  `event: { outSeason, outWeek, researchKey?, caveat? }`, which drives the Return to Play
  curve. NEVER parse the injury date out of the title prose — the titles run from
  "Week 4, Sept 28, 2025" to "High School". Enter the event by hand and CHECK it against
  data/weekly/<id>.json first: the last game logged before outWeek and the gap after it
  must both line up, or the event is wrong.
- `scripts/build-draft-outcomes.js` — draft-capital hit rates → data/draft-outcomes.json. Inputs move
  once a year, so it is NOT in the daily Action; re-run it when a new class completes three seasons.
  It is the BASE RATE, deliberately not a validation of the POE model — validating that needs the
  model's predictions, which are not in this repo
- `scripts/fetch-adp.js` — consensus ADP → data/adp.json, daily. Pinned to Half-PPR 12-team to match
  the projection format. The Value Board compares POSITIONAL ranks on both sides; comparing an overall
  rank to an ADP pick number is a scale error that makes every deep player look like a bargain
- `data/projections-2026.json` — source of truth for projections
- `data/rankings-manual.json` — Adi's hand-ordered ranks. Wins over generated order

## Rules learned the hard way
- Data files must be GENERATED by a committed script, never hand-typed. rankings.json
  used to be hardcoded names and the ordering looked arbitrary because nothing made it.
- Status provenance is explicit, never inferred. `manualOverride: true` or it isn't manual.
  Inferring from punctuation froze Burrow at status-out for ten months.
- A hand note that cannot expire is not a note, it is a permanent edit. `manualOverride` recorded
  only THAT someone typed something, never when or on what evidence, and the pipeline could only
  nag about it — Olave carried "Monitor (Concussion Hx)" into a second season off a 2024 injury.
  A hand-set status now lives or dies by a date and a source in injury-overrides.json; a
  `manualOverride` in players.json with no live entry behind it is an orphan and goes back to the feed.
- Never guess an ambiguous name match. Skip and log. A wrong match writes one player's
  injury onto another's profile.
- Empty beats wrong. A missing projection renders as nothing, not an invented number.
- ALWAYS `git pull --rebase` before pushing. The daily bot commits while work is in progress.
- Verify a change landed before committing. Print the value, don't assume.
- A data-source fetch that fails must fail the RUN, loudly. nflverse moved the 2025 stats file
  and a per-season try/catch swallowed the 404 for months — every profile was silently a year stale.
- A grid track wider than the container scrolls the whole document sideways. This page keeps 48px of
  padding a side, so `minmax(min(320px,100%),1fr)` — a bare 320px overflows a 375px phone.
- Anything worth reading is worth linking. A detail view addressed only by typing into a search box
  has no URL, no back button, and nothing to send anyone. Route it, and let the ROUTER render, so an
  incoming link and a click land on identical markup. Use `navigate()` (pushState) for a move the
  reader chose to make; plain `setRoute` replaces and leaves no history entry, so the back button
  walks off the site.
- Charts show real data or nothing. Chart marks use validated dark-surface steps of the site
  accents (gold #a8893a, teal #1ba89b; blue #2a78d6 for the negative pole of a diverging bar),
  and every chart has a table-view twin.
- NEVER eyeball a chart color. Run the dataviz skill's validate_palette.js against the card
  surface #161a23. A hand-picked red for negative bars FAILED the normal-vision floor; a
  diverging pair needs warm-vs-cool poles, not two warm hues.
- Every leaderboard states its qualifier and excludes players under it. A rate stat off three
  targets is noise wearing a number's clothes.
- A hard cutoff on a jittery feed churns its own boundary. Sleeper's search_rank moves a few
  places overnight, so the last ~20 of the 350-player pool entered and left daily, deleting and
  rebuilding weekly shards each time. build-players gives incumbents a STICKY_RANKS bonus:
  membership is hysteretic, the pool size is not.

## Auth
`gh` handles GitHub auth. Never put a token in a URL or a file.

## Routing and SEO
- The address is a PATH, not a fragment. `vercel.json` rewrites everything to index.html, and the
  filesystem is checked FIRST (Vercel's documented order), so `/assets/*` and `/data/*` still serve.
- Therefore every asset and data URL must be ROOT-relative (`/data/x.json`, `/assets/app.js`). A bare
  `data/x.json` fetched from `/player/nabers` resolves to `/player/data/x.json`, the rewrite answers
  with index.html, and the page gets HTML where it expected JSON. This kills every script silently.
- `switchPage` only rewrites the URL when the PAGE changes. The router calls it back with a deeper
  route already in the bar (`/teams/sea`, `/rankings/wr`) and a bare `setRoute(page)` discards it.
- `setRoute` updates the title, description and canonical, so no caller can move the URL and forget
  the metadata. Old `#hash` links are translated to paths once, on boot.
- Player profiles live at `/player/<id>` — 350 pages of the deepest content on the site, which had no
  address at all until they were routed.
- `scripts/build-sitemap.js` generates sitemap.xml + robots.txt in the daily Action. DRAFT ARTICLES
  ARE EXCLUDED: submitting an unfinished page gets the unfinished version cached and shown.

## Tests
- `node --test 'tests/*.test.js'` — no dependencies, no package.json, built into Node. CI runs it on
  every push, including the daily bot's data commit, which is the commit most likely to break a rule.
- The suite encodes the rules in this file: unique player ids, explicit status provenance, a source on
  every medical injury, a game log behind every dated injury event, no invented projections, ordered
  rankings, no draft article in the sitemap. When you learn a new rule the hard way, add a test with it.
- A test that cannot fail is decoration. Mutate the data and watch it go red before you trust it.

## Scheme & identity
- `scripts/build-scheme.js` — generates data/scheme.json from nflverse `pbp_participation` joined to
  `pbp` on game_id + play_id. The join is exact and the script FAILS if it drops below 99%.
  Current season only by default (~70MB); `--all` rebuilds history. Past seasons never change.
- Personnel is the one public number showing a coach's INTENT rather than his results, and the causal
  chain is measurable end to end: heavier personnel → more defenders in the box → a lighter secondary
  → explosive rate moves. Show all three links; never assert the last one alone.
- `defenders_in_box` of 0 is UNRECORDED, not zero defenders — 9,093 of 45,184 rows in 2025. Averaged
  in as a zero it drags every box figure down. Treat <= 0 as null.
- nflverse calls the Rams `LA`; every other file here calls them `LAR`. Unaliased, scheme.json keys
  differently from teams.json and the Rams' whole section renders as nothing — silent, not an error.
  `TEAM_ALIAS` also covers OAK/SD/STL for older seasons.
- Box figures answer to the SAME sample qualifier as EPA and explosive rate. Publishing a 1.0 box
  average off four snaps while gating the EPA was the inconsistency that made the rule obvious.
- Head coach comes from nflverse `schedules` and is generated. THE PLAY-CALLER IS NOT IN ANY PUBLIC
  DATASET — if that layer is ever wanted it has to be hand-kept and sourced, like medicals.json.
- `data/playcallers.json` — hand-kept, scaffolded by `scripts/build-playcallers.js` (adds rows, never
  overwrites an answer; refreshes the generated `headCoach` column only). Fill `playCaller`,
  `callerIsHeadCoach`, `source`. A blank row is HONEST — the page falls back to the head coach rather
  than guessing. `scripts/check-playcallers.js` reports what is blank and fails on a claim with no
  source. A play-caller change leads the "what changed" note ahead of a head-coach change, because it
  explains more scheme movement.

## Projections
- `data/projections-2026.json` — MEDIANS ARE THE ANALYST'S and are never generated, the same standing
  as rankings-manual.json. Generating them would mean resampling a player's own past, which is
  impossible for the rookies in the file and misleading for anyone who changed offences; a
  backward-looking number presented as a projection is worse than a labelled human one because a
  script makes it look measured.
- `scripts/build-projection-bands.js` — generates ONLY floor and ceiling: the 15th and 85th percentile
  of year-over-year change in POINTS PER GAME across this pool, centred on the median. Not in the
  daily Action; re-run it when the medians change or a season completes.
- Per game, deliberately. The projections assume 17 games and the rankings chart draws availability as
  a SEPARATE downside — folding missed games into the band counts one injury twice.
- The band must move the DOWNSIDE, NEVER THE RANK. Ranks come from the median, so regenerating bands
  must reorder nothing; verify by diffing rankings.json before and after (108 floors moved, 0 ranks).
- Compare each player to the historical seasons that began NEAREST his projected points per game.
  Two tiers was not enough: a 12-points-a-game back shared a bucket with 3-ppg backups whose
  promotions drove the 85th percentile, and inherited a 512-point ceiling — higher than any back has
  ever scored. That promotion is already inside the analyst's median.
- The hand-set bands were roughly ±15-20%; the data says -25%/+25% for an established player and much
  wider below that. The old ranges conveyed more confidence than the evidence supports.

## The GSIS crosswalk
- GSIS is the join key for stats, NGS, injuries and personnel. Sleeper only carries it for about a
  fifth of the pool, so everything downstream was falling back to NAME matching for the other four
  fifths — the exact failure the matcher rules exist to prevent. `build-players.js` now backfills it
  from the nflverse rosters keyed on `sleeper_id`: an ID-to-ID crosswalk, no name guessing. 69 -> 343
  of 350, 0 conflicts with the ids already on file.
- TWO seasons are read, because a roster only holds the players on it: last season covers the
  veterans, this season the rookies. The ones still missing are rookies the league has not assigned an
  id to yet, which is the honest answer rather than a guess.
- If the crosswalk is unavailable the run keeps the ids already on file and adds none. NEVER blank an
  id we already knew because a fetch failed.
- A conflict between Sleeper's id and nflverse's means one feed is wrong about who somebody IS. The
  build says so loudly; do not trust a joined stat until it is resolved.
- Pool churn makes derived files stale: change the pool and injuries.json and sitemap.xml must be
  rebuilt too. The daily Action does this in order; a standalone `build-players.js` run does not, and
  the test suite will catch it.
- `data/player-usage.json` — which personnel a PLAYER is on the field for, from participation's
  `offense_players` joined on GSIS id. Built alongside scheme.json (one download, two outputs).
  The comparison is the point: 68% of a tight end's snaps in 12 personnel, on an offence that runs it
  21% of the time, means his volume is capped by how often the package is called. Usage records the
  team he played those snaps FOR — comparing a season to his current employer's scheme reads a traded
  player against an offence he never took a snap in.
- A `.then()` that re-renders the view it was called from must be guarded on the data still being
  missing. renderProfileTab called ensureUsage().then(render), the cached promise resolved
  immediately, and the tab locked up in an infinite render loop.
- The defensive half of scheme.json: the defence is the team in the game NOT in possession, parsed out
  of `nflverse_game_id` (season_week_away_home). Coverage, man/zone and rusher counts are charted on
  DROPBACKS ONLY (49% of snaps), so those rates are a share of pass snaps — dividing by every snap
  halves each number and reads an aggressive defence as a passive one. Shell is by defensive-back
  count: five is nickel, six dime, four base. Every figure carries a league baseline for the same
  season, because "18.8% man" means nothing without one.

## Social cards and page shells
- SOCIAL SCRAPERS DO NOT RUN JAVASCRIPT. Twitter, Slack, iMessage and Discord read the HTML as served,
  so the per-route title/description/og:image that `applyRouteMeta()` sets at runtime is invisible to
  them. Google renders JS and does see it; a link pasted in a group chat does not.
- `scripts/build-page-shells.js` writes one real file per section (players.html, medicals.html, …),
  identical to index.html except in the head. `cleanUrls` serves players.html at /players, and the
  filesystem is checked before rewrites so it beats the catch-all. The router reads the same path and
  renders the same page — a shared link and a click still land on identical markup.
- Sections only. A shell per player would be 350 copies of a 43KB document for a card that says little
  more than the house one; deep pages keep the site card and their JS-set title.
- A shell goes STALE the moment index.html changes, and a stale shell serves an old version of the
  whole site. The test suite compares every shell byte-for-byte with index.html below `</head>`.
  Edit index.html, re-run build-page-shells.js. `scripts/build-og-image.js` makes the cards.
- The Teams page answers TWO questions and they were sharing one scroll: what is this team, and what
  is happening across the league. They are tabs now (`teamsView`), each with its own URL —
  `/teams/sea` and `/teams/league`. The switch sits ABOVE the division picker because the picker only
  applies to the by-team view, and the picker is emptied in league view rather than left to invite a
  click that changes nothing. The page intro follows the view too.

## History — the series nobody else has
- `scripts/build-history.js` appends ONE LINE A DAY to `data/history/*.jsonl`, last of the
  data steps in the daily Action and before the commit. Every other file here answers "what is
  true today" and is then overwritten; this is the only record that today ever happened, so a
  morning it does not run is a morning gone for good.
- JSONL, not a growing JSON object. A rewritten object makes the entire file a diff every
  morning — 365 full copies a year in the repo. One appended line is one line of diff.
- Continuous series (ADP, ranks, projections) get a line a day. STATUS IS AN EVENT, NOT A
  SERIES: 286 of 350 players are healthy on a given day and logging "still healthy" 350 times
  would bury the ten lines that matter. Only changes are written, against the state replayed
  from the log itself — the log IS the state, so a replay that disagrees with players.json
  means every future diff is computed against fiction. There is a test for exactly that.
- A FIRST SIGHTING IS NOT A CHANGE. The day the pool first sees a player is the day we started
  watching, not the day something happened to him; those rows carry `first: true` and a null
  `from`. Reading them as injuries would invent 350 of them.
- IDEMPOTENT — a second run replaces the day rather than appending it. The Action gets
  re-dispatched by hand and a doubled day skews every average computed over the series later.
- The join is guarded: if the name match rate against the pool falls below 70% the run FAILS
  rather than writing an empty day. A silently empty series looks like a day when nobody was
  ranked, and by the time anyone notices the real data is gone.
- `scripts/backfill-history.js` is a ONE-OFF, deliberately not in the Action: it rewrites the
  files from git rather than appending. The daily bot has been committing dated snapshots since
  May, so 23 days and 77 real status changes were recovered from the repo's own history. What
  it could not reach is permanent — adp.json only goes back to 2026-08-16 because that is when
  it was added.

## Asking from where you already are
- The answer engine worked and lived on a page nobody had a reason to visit. A reader looking at a
  player's field map already HAS the question; the entry points exist so they do not have to leave,
  retype his name, and describe the board they were just looking at.
- THE QUESTION IS PREFILLED, NEVER SENT. Every ask costs money and burns a slot against a
  five-a-minute free tier, so a button that fires an unseen question on one click is one people press
  by accident and then press again. The cursor lands at the end so editing continues the sentence.
- IT FOLLOWS WHAT THE READER IS READING. Four profile tabs, four questions — the medical tab asks
  about the injury history, the stats tab about last season. A single generic prompt would send the
  same thing from all four and waste the context the reader had already chosen.
- A board question names the metric, the position and the season, and the defence and athletic boards
  get their own phrasing because they carry fewer dimensions — the same reason their routes differ.
- The test checks EVERY question template, not the function as a whole. Asserting the function
  contains `labPos` passes while the default branch says "Who led this board?", because the other
  branches keep the token alive.

## Telling a reader the data is old
- THE SILENT FAILURE, FROM THE READER'S SIDE. check-season and check-feeds red the RUN when the daily
  job breaks; a reader looking at a board has no way to know, and in season that is the whole game.
  The footer already printed "Data updated: 18 Aug" — same grey, same size, whether that was six
  hours ago or six days. A DATE IS NOT AN AGE: it asks the reader to know today's date and subtract.
- `dataHealth(meta, now)` in app-core.js returns ok / partial / stale / very-stale. Thresholds are 36
  and 96 hours, sitting ABOVE the daily cadence with room for a late run rather than at it.
- THE HARD PART IS THE SILENCE. A banner on a healthy morning is noise that trains people to ignore
  banners, and then it is worth nothing on the morning it matters. The host ships `hidden` with no
  content, occupies zero height, and is re-hidden when a build recovers — most of the tests are about
  it staying quiet, including every hour from 0 to 35.
- A MISSING TIMESTAMP IS NOT FRESH. `{}` or a null `lastUpdate` returns `unknown`, never `ok` — the
  dangerous default would be silence on the one input that means we cannot tell.
- A FAILED SOURCE IS REPORTED EVEN ON A RECENT RUN, and it names which. One layer being older than
  the rest is harder to spot than the whole site being behind, because every other number is current.

## Record what cannot be rebuilt
- THE DIVIDING LINE IS RECONSTRUCTIBILITY, NOT IMPORTANCE. Usage, charting, field maps, matchups and
  scheme all come back out of play-by-play whenever they are asked for, so losing them costs a
  download. Two things do not come back at all, and they are the ones the history layer exists for:
  - **Sleeper trending** is what the room is doing RIGHT NOW. There is no endpoint for last Tuesday's
    add rate and no way to derive one. A morning it does not run is a morning gone for good.
  - **Depth chart position** is published by nflverse as the CURRENT chart with no history behind it,
    so a promotion is visible the day it happens and invisible a week later.
- SHAPE FOLLOWS BEHAVIOUR, the same split as rankings against status. Trending is a SERIES — the
  counts move daily and the movement is the signal. Depth is an EVENT LOG — 342 players sit still,
  and logging "still second on the depth chart" every morning buries the handful of lines that matter.
- AN UNMATCHED TRENDING NAME KEEPS ITS COUNT AND NEVER A GUESSED ID. The pool is 350; the room
  speculates on more. A free agent added 60,000 times is worth recording, and attaching him to the
  wrong player is not — the same rule the matcher follows everywhere else.
- THE SKIP CANNOT BE TESTED AGAINST DAY-ONE DATA. On the first run every entry is a first sighting,
  so there is nothing to skip and a mutation deleting the guard passes cleanly. `depthChangesFor` is
  extracted and unit-tested for exactly that, including the case a rank comparison alone would miss:
  A TRADE IS A MOVE, and the rank is often identical on both sides of it.
- The history layer went live 2026-08-18. Anything before that in the continuous series was recovered
  by backfill-history from the repo's own commits, and what it could not reach is permanent.

## The season rollover
- `scripts/lib/season.js` is the ONLY place that knows what season it is. It reads Sleeper's
  free `/state/nfl` (season, week, season_type) and falls back to the calendar if that is
  unreachable. Nine scripts used to carry their own hand-typed `[2023, 2024, 2025]`, three of
  them with comments asking the next person to keep them in step by remembering.
- THE ROLLOVER IS A FAILURE WITH NO SYMPTOM. On the first Sunday of the regular season the
  fetch scripts go on asking for the seasons they were told about, every build succeeds, the
  site renders, and every number on it belongs to last year. Nothing errors, so nothing tells
  anyone — the same shape as nflverse moving the stats file, which went unnoticed for months.
- `dataSeasons(3)` is the window to fetch and it moves by itself: `[2023,2024,2025]` in August,
  `[2024,2025,2026]` the moment real games count. `latestDataSeason()` is the newest season that
  actually HAS rows — in the preseason that is LAST season, because asking nflverse for a 2026
  stats file in August gets a 404 or an empty file that reads as everyone scoring zero.
- The date fallback is deliberately conservative: it calls a season "pre" for a few days longer
  than it should rather than declare a regular season that has not started. And the league year
  rolls over in MARCH — January's playoffs still belong to the season that started in September.
- `scripts/check-season.js` runs LAST in the Action, after the push, `if: always()`, same bargain
  as check-overrides and check-feeds. It fails when the data on disk does not contain the season
  being played. There is a test that drives the calendar to Week 1 with today's data and asserts
  the check GOES RED — an alarm that cannot be made to ring is not an alarm.
- ALL NINE ARE MIGRATED NOW. build-teams, build-rankings, build-injury-curves and build-scheme were
  the last four, found by the rollover dry run rather than by reading the code — and this bullet
  used to list three of them as "still hand-pinned", which is how a list of known gaps quietly
  becomes a list of things nobody rechecks. The only year still decided by a person is
  `build-draft-outcomes.js` FIRST_CLASS/LAST_CLASS, which is editorial (a class is only judged once
  it has three seasons behind it) and is not in the daily Action.
  `tests/rollover.test.js` now fails on any daily script holding a year nothing can move.
- IN-SEASON, THREE PRESEASON PRODUCTS START LYING and check-season says so: ADP describes a
  market that has closed, SOS was built off last season's defences, and the projections are
  season-long medians when the useful number has become rest-of-season.

## Beyond GSIS — the id crosswalk and the buckets it unlocks
- `scripts/lib/ids.js` reads nflverse's `players` release, which carries gsis_id alongside
  pfr_id, pff_id, espn_id and esb_id. This is the thing that was stopping seventeen of
  nflverse's twenty-five buckets from being used: most are NOT keyed on GSIS, and without a
  crosswalk the only way in is name matching — the exact hazard the GSIS backfill removed,
  reintroduced once per dataset. MEASURED: 339 of 350 carry a pfr_id, 298 a pff_id.
- Ids are STRINGS, always. They arrive from CSVs where a numeric id is parsed into a Number;
  an espn_id is a key, not a quantity, and must never be compared as a float.
- NEVER BLANK AN ID BECAUSE A FETCH FAILED — same rule as the GSIS backfill. `poolCrosswalk`
  reports what it could not resolve rather than dropping it silently, because a bucket covering
  200 of 350 and one covering 340 are different products.
- `scripts/lib/teams.js` is the one team vocabulary. nflverse AND PFR both call the Rams `LA`;
  everything here calls them `LAR`. fetch-advstats walked into that trap on its first run and
  produced 34 "teams" — `LA`, plus PFR's `2TM`/`3TM` markers, which are traded players and not
  franchises at all. The alias used to live inside build-scheme.js; a second copy would drift,
  so both read it from the lib now. `isTeam()` is the guard, and a team count that is not 32
  fails the run.
- `scripts/fetch-advstats.js` — PFR advanced splits → data/advstats.json, daily. This is the
  first layer that separates what a player DID from what was done to him: yards before the
  catch (his quarterback) versus after it (him), broken tackles, drops, aDOT, and for QBs
  pressure rate, pocket time and on-target rate. 288 of 350 covered.
- THE DEFENSIVE SPLIT IS AGGREGATED BY TEAM, NOT BY PLAYER. Keyed by player it matched 22 of
  350 and correctly so — the pool is QB/RB/WR/TE and the people charted are the defenders
  covering them. By team it becomes the matchup layer the site never had: what a defence
  actually allows WHEN TARGETED, rather than points conceded, which is mostly a story about how
  often it was on the field. Rates are RECOMPUTED FROM TOTALS, never averaged across players —
  averaging percentages weights a nickel corner's twelve targets like a No.1's season.
- A sum check cannot see a swap. `ybc + yac = yards` holds either way round, and a mutation
  that exchanged the two columns passed it — while saying the exact opposite of what the split
  exists to say. The per-reception rates come from their own columns and are the asymmetric
  witness. When a test is symmetric in the thing it is checking, it is decoration.

## Charting — who was the READ
- `data/charting.json` is built by `build-scheme.js`, not by a script of its own. FTN charts
  per PLAY and carries no player id, so attributing a drop or a first read to a person needs
  pbp's `receiver_player_id` — 93MB that build-scheme already downloads. ONE DOWNLOAD, THREE
  OUTPUTS (scheme, usage, charting). A separate script would double the cost of the most
  expensive step in the daily Action for nothing.
- `read_thrown` is a CATEGORY, NOT A COUNT: `1` first read, `2` second read, `CHK` checkdown,
  `SD` scramble drill, `DES` designed (screens and the like), and `0` for everything that is not
  a charted dropback. Reading it as a number, or letting an unmapped value through, makes every
  rate computed from it quietly wrong — there is a test that the buckets sum to the targets.
- THIS IS THE LAYER VOLUME CANNOT REACH. 90 targets of which 60 are first reads is the centre of
  an offence; 90 of which 45 are checkdowns is a safety valve. Measured 2025: Tee Higgins 90.8%
  first read, and Chase Brown 52.8% checkdown against 19.1% first read.
- Rates are a share of DROPBACKS, never of all snaps — dividing play-action by every play halves
  it and reads a play-action offence as a conventional one. External validity: LAR top the
  play-action table at 32.7%, which is McVay exactly, and KC sit bottom at 14.3%.
- A charted pass with no `receiver_player_id` counts for the TEAM and for nobody in particular.
  That is the honest split: the play happened, the attribution did not.

## Splitting app-pages.js — measured, then declined
- It is the largest asset (3,244 lines, 51KB gzipped) and the obvious maintenance target. MEASURED:
  splitting it at its section banners into six classic scripts produces **56KB gzipped, not 51** —
  gzip has a smaller window to work with across separate files, so the payload grows. Plus six
  requests instead of one.
- LAZY LOADING IS NOT AVAILABLE HERE. 97 inline onclick handlers need their globals present when the
  markup is parsed; deferring any file breaks every handler it defines, silently.
- Total JS is 121KB gzipped for the entire site, which is a healthy budget and not a problem anyone
  has. There is no user-facing benefit to trade the risk against — and the risk is real: a duplicated
  top-level `let` across files kills a whole script while its functions still hoist.
- So it stays one file. If it is ever split, the reason will be developer navigation and the measured
  cost is +5KB and five extra requests. Re-run the measurement rather than re-deciding from memory.

## One global scope, five files
- The asset scripts are CLASSIC SCRIPTS SHARING ONE GLOBAL SCOPE, which is deliberate — the markup
  carries ~108 inline onclick handlers and an inline handler can only see globals. The cost is that a
  duplicated top-level `let` or `const` is a SyntaxError, and it fails in the worst possible way.
- FUNCTION DECLARATIONS STILL HOIST. The dead file's functions all appear on window, so the site looks
  loaded. Its `let` bindings never initialise, so the first read throws ReferenceError from somewhere
  unrelated — `let usagePromise` in app-pages.js collided with app-profile.js, app-profile.js died,
  the router threw on `currentProfileId`, and EVERY DEEP LINK ON THE SITE fell back to the home page.
  Nothing appeared in the console, because the error is at parse time on a file the page still lists.
- `tests/globals.test.js` reads the load order out of index.html and fails on any top-level name
  declared twice. THE FIRST VERSION OF THAT CHECK ONLY READ THE FIRST NAME in `let a = null, b = null`
  — which is exactly the shape that got through — so the multi-declarator parse is asserted on its own.
- Diagnosing this from the browser needs a `<script src>` and `window.addEventListener('error')`. A
  parse error does not surface in a try/catch, does not appear in the console listing, and `typeof`
  on the missing binding just says "undefined". What identifies it is that the file's FUNCTIONS exist
  while its LETS do not.

## The matchup board is a record, not a forecast
- MEASURED, AND THE ANSWER IS UNCOMFORTABLE. `scripts/research-matchup-stability.js` splits each of
  2023-25 at several weeks and correlates a defence's vsBaseline over the first N weeks with its
  rating over the rest of the season. **r = 0.05 to 0.32 for QB, RB and WR** — and it does NOT improve
  as the sample grows: the week-8 split is no better than the week-4 one. TE reads higher early (0.67
  at week 4) on the thinnest sample and collapses to 0.11 by week 10, which is what noise looks like.
- SO THE BOARD DESCRIBES WHAT A DEFENCE HAS ALLOWED AND SAYS SO ON THE PAGE. Every reader will use it
  to predict; the gap between what it says and what it will be used for is not something a reader can
  infer from the numbers, so the measured range is printed above the table and carried in meta. A test
  fails if the caveat loses the figures or stops naming the script that reproduces them.
- Research, not a build: it writes no file and is not in the Action, same bargain as
  research-vegas-weather.js. It exists so the question is answered by a measurement rather than
  reopened from memory.

## The sample is games, not player-games
- A FLAT PLAYER-GAME FLOOR SOUNDS EVEN-HANDED AND IS NOT. Measured across 2025 a defence faces 2.39
  pool receivers per game and 1.07 quarterbacks, so the old floor of 8 player-games demanded 3.3 games
  of evidence at receiver and 7.5 at quarterback. Simulated forward, THE QB MATCHUP BOARD PUBLISHED
  NOTHING UNTIL WEEK 8 and was not full until week 10 — over half a season on last year's data,
  because the unit was wrong rather than the threshold.
- A defensive performance is a GAME. `MIN_GAMES = 4` distinct weeks asks the same question of every
  position and needs no per-position rate to be estimated or kept up to date; `MIN_PLAYER_GAMES = 4`
  survives as a backstop for four games against one player. Simulated: every position now publishes
  from week 4 and is essentially full by week 8.
- This changed nothing on completed seasons — every defence has 17 games there — which is the point.
  It only moves the weeks the old floor got wrong.
- `build-matchups.js --simulate 2026:6` drives the calendar forward, same flag and same stamp as
  build-ros.js. THE PATHS THAT MATTER MOST CANNOT BE REACHED UNTIL THEY ARRIVE, and by then it is too
  late to discover the board is empty.

## The opening weeks are the hard case
- SIMULATED AGAINST 2025, the In Season section was nearly EMPTY for the first three weeks — which is
  when people look hardest. Weekly usage had 0 players in week 1 (a change needs two games); the
  matchup board had 0 of 32 defences in week 1, 1 by week 2, 11 by week 3 and 27 by week 4.
- THE FLOORS ARE NOT THE PROBLEM AND WERE NOT LOWERED. A trend off one game is not a trend and a
  defensive rate off three player-games is noise. The fix is to show what IS valid that early:
  - Weekly usage falls back to LEVELS, which are complete facts with nothing yet to compare them
    against, and the qualifier says "LEVELS — NO PRIOR WEEK TO COMPARE".
  - The matchup board falls back to the previous season, states how many defences failed to qualify,
    and says to treat it as a prior rather than as this year's defence.
- Both are verified by BUILDING a week-1 season and looking at the page, because these paths cannot
  be reached before September. Week 1 of a simulated 2026: usage went 0 -> 40 rows, matchups 0 -> 32.
- `tests/no-simulated-data.test.js` is what makes that safe. The ros.json guard already existed; it
  now covers EVERY generated file, plus a second shape of the same mistake — rows for a season the
  league has not played, checked against the calendar rather than a hardcoded year.

## Weekly usage — what a player was given
- `data/weekly-usage.json`, the fifth output of the one pbp download, joined to `snap_counts` on PFR
  id via lib/ids.js rather than by name. Snap counts ship per game; `offense_pct` is a FRACTION (1 =
  every snap), and published unconverted a full-time starter reads as 1% and the board ranks the
  league upside down.
- SHARES NEED A TEAM DENOMINATOR AND THE POOL CANNOT PROVIDE ONE. The 350-player pool is the
  fantasy-relevant players, not every player, so team totals from it are short by whatever the
  unrostered receivers caught — every share comes out too high, by a different amount for every team,
  which is invisible in aggregate and changes who ranks where. Denominators come from pbp.
- WOPR TAKES DECIMALS, NOT PERCENTAGES. `1.5 x target share + 0.7 x air-yards share` with shares as
  decimals. Fed percentages it produces a number a hundred times too large THAT RANKS EVERYONE IN THE
  SAME ORDER, so nothing about the board looks wrong — it is just not WOPR any more, quoted against a
  published scale where 0.6 is a WR1.
- THE COMPARISON IS A PLAYER AGAINST HIMSELF, over his own previous four weeks. A 60% snap share means
  one thing for a committee back and another for a starter; the only reading that travels is direction.
- WEEK 18 IS NOT A NORMAL WEEK and the board says so when showing one. Teams with seeding settled rest
  starters, so the biggest movers are rest days shaped exactly like demotions.
- ROUTES RUN IS NOT AVAILABLE. Yards per route run is the other metric this layer wants; route
  participation is charted by PFF and FTN, not recorded in play-by-play. Snap share is the closest free
  substitute and is a different thing — a receiver on the field for a run play ran no route.
- External check: 83% of qualified receivers land within three points of the season target share in
  stats.json, built independently. The residual is the real difference between averaging weekly shares
  and aggregating a season.

## In Season — the matchup board
- `data/matchups.json`, built by `scripts/build-matchups.js` from `data/weekly` — no new download, the
  weekly shards already carry `opp` and `fpts` for 8,524 player-games across three seasons. In the
  daily Action after fetch-stats, which refreshes what it reads.
- FANTASY POINTS ALLOWED IS THE MOST-USED MATCHUP NUMBER IN THE SPORT AND IT CONFLATES TWO THINGS:
  how good the defence is, and how good the offences it happened to draw were. A defence that faced
  the three best receiving corps looks porous and has not been measured. So the file publishes a
  second number — `vsBaseline`, the same games measured against THAT PLAYER'S OWN season average —
  and states that it is the one to trust.
- THE CORRECTION IS NOT DECORATIVE AND THERE IS A TEST THAT IT ISN'T. Measured on 2025, **twelve of
  thirty-two defences move five or more places** between the two rankings. If that ever collapses to
  zero the second column is the first one wearing a different name and should go.
- External check: PHI lead the 2025 WR board at -2.19, and they also lead the completion-percentage-
  allowed board built from an entirely different source. DAL are last at +3.55.
- THE POPULATION IS THE TOP-350 POOL, so this is points allowed to players worth STARTING rather than
  to everybody at the position. For a start/sit decision that is the right population and for a
  league-wide claim it is not, which is why the file says so.
- THE THIN PATH IS THE ONE THAT MATTERS AND IT CANNOT BE TESTED AGAINST A COMPLETED SEASON. Every
  cell on a finished year clears the eight-player-game floor comfortably, so a mutation deleting the
  floor passed against real data. `shapeCell` is extracted and unit-tested for exactly this: Weeks 1
  to 3 are when one afternoon is the entire sample and the board looks identical to one built on
  seventeen games.
- The page states which season it was built from and, before Week 1, that defensive personnel changes
  completely across an offseason — a past season describes that season's defence, not the one lining
  up on Sunday.

## Film lives inside Draft Lab
- Film Room had a nav item, a page, a route and one article. A section earns a top-level slot when
  there is enough in it to be worth navigating to. Both are scouting, so they share `/draft` with a
  view switch and film sits at `/draft/film`.
- RETIRING A SECTION IS NOT DELETING A NAV ITEM — the same list the Compare retirement worked through:
  nav (both bars), page markup, ROUTE_PAGES, route metadata, the render hook, the sitemap note, and a
  308 from the retired URL. `/film` redirects to `/draft` rather than quietly rendering the home page.

## In season
- `data/ros.json` — rest-of-season projections, built by `scripts/build-ros.js`. From the first
  Sunday, projections-2026.json answers a question nobody is asking: what matters in Week 8 is
  not the seventeen-game median built in August, it is the nine games left.
- THE WEIGHT IS THE PRODUCT, and it is DERIVED, not chosen. `scripts/build-ros-weights.js` fits
  it against our own game logs: for every player-season-week, how well does
  `w·(season so far) + (1-w)·(prior expectation)` predict the rest of the season. Measured:
  **0.32 on actuals after two games, crossing 0.5 at week seven, 0.83 by week fourteen** — which
  is the quantified version of "do not overreact to three games". The blend beats BOTH ends at
  every week, by up to 29% on RMSE against trusting the season so far; if it ever stops doing
  that, publish the better end instead of the blend.
- **Tight ends stabilise much later than backs** — 0.25 weight at week 3 against a back's 0.40 —
  so a TE breakout deserves less trust than an RB breakout at the same point. Each position has
  its own curve for this reason.
- The prior is currently LAST SEASON'S PPG standing in for a preseason projection, because
  nobody archived the projections actually published. From 2026 the history series holds the
  real thing and the weights should be refitted on it.
- ROS IS NOT A RE-RANKING. rankings.json is untouched and the medians there stay the analyst's
  call. ros.json answers a different question and is allowed to order players differently.
- IN THE PRESEASON IT WRITES NOTHING and says why. A rest-of-season projection before any
  football has been played is the season projection under another name, and shipping it implies
  an update that never happened. Not in the daily Action's critical path for that reason —
  it no-ops until September and there is a test asserting it.
- `fetch-adp.js` FREEZES AT KICKOFF. ADP is a draft artefact; once drafts are done the feed
  describes a market that has closed, and a Value Board still comparing ranks to it is
  describing an argument nobody is having. The last preseason board is kept and stamped
  `historical` with `closedAt`, rather than overwritten with a meaningless feed.
- `build-sos.js` follows the season: last season's defences until FOUR weeks of the new one are
  played, then this season's. Four weeks is thin, but past that a thin sample of the defences
  that actually exist beats a full sample of the ones that do not.

## Vegas and weather — measured, then declined
- `scripts/research-vegas-weather.js` is RESEARCH, not a build: it writes no data file and is
  not in the Action. It exists to answer a question before we pay for it, and to stop the same
  question being reopened from memory later.
- Implied team total is widely held to be among the best weekly fantasy inputs, and it is not in
  our feeds going forward — adding it means a live odds API, a key, a rate limit and a new way
  for the 6am run to fail. So the value was measured first, for free, out of nflverse's
  `schedules/games.csv`, which already carries `total_line`, `spread_line`, `temp`, `wind` and
  `roof` for every past game.
- THE TEST IS INCREMENTAL, not correlational. A good player scores well and also plays in
  high-total games, so raw correlation flatters the market badly. The only question that decides
  anything is whether the line improves a forecast that ALREADY knows the player's trailing
  average — because that average is what we would use otherwise.
- MEASURED over 12,758 player-weeks, 2023-25: implied team total improves RMSE by **+0.04%
  overall**. By position: QB +0.63%, RB +0.15%, TE +0.07%, WR +0.00%. Weather is the same story
  — wind +0.04%, temperature +0.04%. The extreme-wind split is real but tiny: 15mph+ costs about
  0.65 points against trailing form, calm days give about 0.34 back.
- CONCLUSION: NOT WORTH A LIVE DEPENDENCY. The market is genuinely informative about GAMES
  (implied total correlates with points scored at r=0.415) — it is just nearly redundant with
  what a player's own recent scoring already tells us. The one arguable exception is quarterbacks.
- The honest limitation: this used a season-long trailing average and a linear fit. A sharper
  baseline or a non-linear treatment might extract more. But 0.04% is not a close call, and
  re-running this script is how to revisit it rather than arguing from memory.

## Depth charts and combine
- `data/context.json` — `scripts/fetch-context.js`, daily. Two more nflverse buckets, cheap now
  that lib/ids.js exists.
- THE OFFENSIVE DEPTH-CHART GROUP IS NAMED BY ITS PERSONNEL, `"3WR 1TE"` — not by the word
  "offense". Filtering on `/off/i` matched nothing, produced an empty section, and threw no
  error; the site would simply have had no depth charts on it. The groups are now an explicit
  deny-list (`Base 4-3 D`, `Base 3-4 D`, `Special Teams`) and anything unrecognised is SKIPPED
  rather than assumed offensive — a receiver listed third among kick returners must never read
  as the third receiver. Coverage is asserted, so an empty join fails instead of shipping.
- A DEPTH CHART IS WHAT A TEAM PUBLISHES, NOT WHAT IT DOES. Teams list players for reasons that
  have nothing to do with snaps and the order is routinely wrong about committees. It belongs
  beside usage, never instead of it.
- Combine percentiles are computed against EVERY PLAYER ON RECORD AT THAT POSITION, not against
  the current pool: a 4.5 forty is unremarkable for a receiver and exceptional for a tight end,
  and a pool-relative figure would move a player's athleticism every time the pool churned.
- LOWER IS BETTER for the forty, cone and shuttle, so those percentiles are inverted. Getting
  that backwards ranks the slowest players in the league as the most athletic and looks entirely
  normal on a page — there is a test that the fastest forty at a position outscores the slowest.
- This is also the fix for the hand-written athletic percentiles in players-curated.json, which
  broke the repo's own first rule: data files are generated by a committed script, never typed.

## The re-render loop
- `ensureX()` CACHES its promise. Once the data is in hand it resolves on the next microtask, so a
  callback that re-enters the function which scheduled it goes round forever and FREEZES THE TAB —
  not a slow page, an unresponsive renderer. This has now cost three: the profile usage tab, the
  Defence board, and the body map.
- THE GUARD IS "DID THE DATA ARRIVE", NEVER "IS THE PAGE STILL OPEN". The Defence board was guarded
  on `page-lab` being active, which is true for exactly as long as the reader is on it, so it
  excluded nothing. A DOM check can never terminate the loop, because the DOM is what the render is
  producing.
- `loadJSON` SWALLOWS a failed fetch and resolves with null, so every one of these loops is also
  reachable with the data never arriving at all. That is why `if (!labCharting)` at the CALL SITE is
  not a latch: it is true again on the second pass. Only an unconditional assignment latches —
  `statsReady = true`, or `historyAdp = d || []`, which lands truthy whatever the fetch did.
- Out of season data/ros.json is legitimately ABSENT, so `rosData` stays null forever and testing it
  would BE the loop. When "no data" is a permanent valid answer the latch (`rosChecked`) is the only
  correct guard. The two guards are not interchangeable; pick by whether null is a failure or an answer.
- Do not fold an unrelated condition into the fetch decision. The freeze was one line doing two jobs:
  `if (labCharting && labMode !== 'defense')` fetched whenever the MODE was wrong, not when the data
  was missing. Whether to FETCH depends only on whether the data is here.
- `tests/render-loops.test.js` scans the assets as ONE program (they are classic scripts sharing a
  global scope — scoped per file it found nothing, because the ensure* functions live in app-core.js
  and the call sites do not). It flags a `.then` callback that re-enters its own enclosing function
  with no condition that can go false. It found two more live loops on its first run.
- IT STRIPS COMMENTS BEFORE READING GUARDS. It very nearly shipped satisfied by a COMMENT that
  happened to name the binding it described — deleting the real `if (!usageData) return;` left it
  green because the paragraph above still said "usageData". Anything reading code for meaning has to
  read the code, not the prose around it.

## Stats & Charts (the old Leaders page)
- ONE page, TWO halves. **Stats** is production — what happened, from the box score and Next Gen
  tracking. **Charts** is how it happened, from FTN charting and PFR advanced splits. The
  distinction is the reason it earns a section: a target count cannot tell a first read from a
  checkdown, and a receiving line cannot separate the yards a quarterback earned a man from the
  yards he made himself.
- The route is `/lab/{mode}/{pos}/{season}/{metric}`. THE MODE SEGMENT IS NEW, so a first
  segment that parses as a POSITION is read as the old `/lab/wr/2025/ppg` shape and defaults to
  stats — links shared before the split still work and self-upgrade in the address bar.
- SEASON BUTTONS FOLLOW THE HALF THAT IS SHOWING. FTN does not chart as far back as the box
  scores go, so offering a year the data cannot fill renders an empty board for no stated reason.
  `build-scheme.js --all` backfills charting for every season (2023: 151 players, 2024: 187,
  2025: 226) — the default run only refreshes the live one.
- The scatter belongs to the Stats half only. It is built from production stats, and leaving it
  under a charting board sits an unrelated chart beneath the table and implies they are about
  the same thing.
- Charting boards carry their OWN qualifier (`chartQualifies`), because the counts live in
  different files from the stats ones. A 100% first-read rate on four charted targets is not a
  finding, and the rule that every board excludes what falls under its qualifier matters more
  here than anywhere else on the site.
- FOUR MODES, AND THE LAST TWO CARRY FEWER DIMENSIONS. Athletic has no season (a man's forty does
  not change in September) and Defence has no position (it ranks 32 teams). The route writes only
  the segments the board actually has — `lab/athletic/{pos}/{metric}`, `lab/defense/{season}/{metric}`
  — because a URL naming a dimension the board does not carry is a link that lies about itself and,
  worse, one the parser misreads on the way back in. The season and position pickers HIDE rather
  than sit there inviting a click that changes nothing, the same rule the Teams division picker follows.
- A DEFENCE ROW IS A TEAM, so everything built for a player has to ask. Unchecked it printed "RANGE
  ACROSS QUALIFIED WRs" over 32 defences, a tooltip reading "SEA () — Yards per Target Allowed", and
  a Team column every row left blank. The board links to `/teams/{code}` rather than to a profile.
- Four controls doing four different jobs used to sit in one row of identical pills, so "which
  half of the site am I looking at" looked exactly like "which year". They are grouped, labelled
  and the mode switch is set apart — it changes what every other control on the page means.

## Generated files are written only when they changed
- `scripts/lib/write.js` — `writeJSONIfChanged(file, obj)`. Every build stamps `meta.generated` with
  the moment it ran, so a file whose data is identical to yesterday's still landed as a fresh commit
  every morning. THE RULE ALREADY EXISTED HERE: build-history.js is idempotent because a doubled day
  skews every average computed over the series later. This is that rule applied to the files that are
  rewritten whole.
- THE TIMESTAMP IS NOT DISCARDED, IT IS DEFERRED. When the data moves, the file carries the moment it
  moved; what it never carries is a moment when only the clock moved. `generated` now means "when
  this data last changed", which is the reading people already assume it has.
- THE DANGEROUS DIRECTION IS THE QUIET ONE. A comparison that is too eager reads a real change as
  "unchanged", freezes a file forever, and every build still reports success — the same shape as
  nflverse moving the stats file. So the tests lean on that side: eleven separate one-field changes
  must each still write, and the VOLATILE exemption list is asserted to stay short and to contain
  only things that look like clocks.
- KEY ORDER IS NOT A CHANGE, ARRAY ORDER IS. Object key order is not meaningful in JSON and a build
  that enumerates a map differently must not read as a change; but rankings are ordered, so two files
  with the same rows in a different order are different files.
- A LOG THAT CLAIMS A WRITE IT DID NOT MAKE IS WORSE THAN A NOISY ONE. Every converted build reports
  "unchanged — not rewritten" rather than printing "wrote" unconditionally.
- There is a test that walks daily-update.yml, opens every script it runs, and fails if one still
  calls `fs.writeFileSync(..., JSON.stringify(...))` directly. It found two on its first run —
  fetch-injuries and build-playcallers — that the manual pass had missed.

## The field map — where a player works
- `data/fieldmap.json` is the FOURTH OUTPUT of the one pbp download, built by `scripts/lib/fieldmap.js`
  and called from build-scheme. Field position is pure pbp and needs no participation join, but it
  needs the RAW csv rather than the lean map, because leanPbp keeps six columns and this wants
  `pass_location`, `air_yards`, `run_location` and `run_gap`.
- THE GRID SIZE WAS MEASURED, NOT CHOSEN, and the two positions came out different. A quarterback at
  200+ attempts FILLS a 3x4 map — median 8 to 84 throws a cell. A receiver at 50+ targets does NOT:
  **the deep-middle cell has a median of ONE target and 116 of 132 qualified receivers sit under
  five**. Even at 90+ targets the median is 2. So passers get a real spatial grid and receivers get
  two one-dimensional strips, depth and side. A 3x4 receiver map would be mostly single throws
  wearing a percentage.
- A SHARE AND A RATE HAVE DIFFERENT SAMPLE RULES, which is why the file carries two floors. A share
  ("14% of his targets were deep") is read against the well-sampled season total and is sound at any
  cell size; a rate inside the cell ("he completes 31% of them") is built on that cell alone. So the
  count and the share always publish and the RATE goes null under the floor, marked `thin`. The cell
  renders a dash — the count is real, the rate would not be.
- RUN BLOCKING SCHEME IS NOT AVAILABLE AND IS NOT IN THE FILE. Wide zone against inside zone is the
  split everyone asks for; `run_gap` records WHERE THE BALL WENT, which is a different question — a
  wide-zone run can hit any gap. No free feed carries the concept, and naming a gap chart "zone vs
  gap" would be inventing the one column nobody has. The caveat travels IN the file and a test
  asserts it is still there.
- Reception Perception is a paid manual-charting product and is not ingestible. What stands in for it
  is already here: NGS separation and cushion, FTN contested/drop/first-read, and this target map.
- About 7% of pass attempts carry no location — throwaways, batted balls, spikes. They are EXCLUDED
  rather than assigned to a zone, so every share is of LOCATED attempts, and the run fails under 80%.
- THE COLOUR RAMP WAS VALIDATED, NOT PICKED, which on a heatmap matters more than anywhere else on
  the site because the shade IS the finding. Two arms, blue below the position average and red above
  it, three intensities each, near-surface neutral between them. What decides the ramp's brightness
  is the ink: the figure sits INSIDE the cell, so every step must clear 4.5:1 against `#f0efec`.
  **Gold was tried first and cannot support three steps** — it is intrinsically light, so the band
  between "clears the card at 2:1" and "still takes light ink at 4.5:1" is too narrow. Blue against
  red is also the pair the dataviz reference recommends, warm against cool.
- Running the CATEGORICAL validator on a ramp fails by design and is not a real failure — the skill
  says so. A ramp is judged by `validateOrdinal`: lightness monotone, adjacent dL >= 0.06, single
  hue. `tests/field-palette.test.js` pins the steps and re-derives the contrast maths locally, so a
  swapped colour goes red without the skill being a dependency.
- EACH COLUMN IS SCALED ON ITS OWN. Every passer completes far more short throws than deep ones, so
  a scale shared across the table would paint the whole deep column blue and say nothing about who
  is good at it. The spatial grid scales against that ONE quarterback's own cells instead, because
  it answers "where is he best" rather than "who is best here".
- ON A PHONE IT SHOWED TWO COLUMNS. Measured at 375px: the table is 1,275px wide and the player
  column alone took 207px, so a reader saw the name and one number. Three changes took it to six
  columns — the name column STICKS (without it, scrolling right makes every number unattributable on
  a board of 46 backs), the team column is dropped as the Players table and Value Board already do,
  and the data columns are CAPPED. min-width alone did nothing: a floor does not stop growth, and
  the long headers pushed the columns to 93px anyway.
- THE GROUP HEADER USES THREE SEPARATE LEAD CELLS, NOT `colspan="3"`. A colspan cannot be taken apart
  by CSS, so hiding the team column would have slid "By gap" and "By situation" one column left and
  sat every group label over the wrong run of data — silently, and only on phones. There is a test.
- THE SORT STATE IS PER POSITION (`labField.${pos}`). The column sets differ — sorting backs by
  "Mid" and switching to receivers left the shared sorter holding `gaps.middle`, which no receiver
  column has, and sortTableRows correctly returns rows UNSORTED when the key is missing. The board
  silently lost its order. A table id per position makes the mismatch impossible rather than handled.

## The player profile
- IT OPENS ON OVERVIEW, NOT MEDICAL. A profile that leads with a man's injury history leads with
  the narrowest thing the site knows about him, and it buried the usage, charting and advanced
  splits behind a tab most readers never clicked. Medical is last: something you go looking for.
- The reset reads the first tab out of the markup rather than assuming an index, so reordering
  the tabs cannot silently undo it.
- COMPARISON LIVES IN THE PROFILE, not in its own section. Nobody wants a comparison in the
  abstract — they are on someone's page wondering about one other man. The picker only ever
  offers the SAME position, because percentiles are within position and a 90th-percentile
  receiver and back are not the same athlete.
- RETIRING A SECTION IS NOT DELETING A NAV ITEM. Compare also had a route, route metadata, a
  render hook, a switchPage branch, a sitemap entry, a page shell, a vercel rewrite and a social
  card. The shells test caught the orphaned card. Retired URLs get a 308 rather than quietly
  rendering the home page.

## Fun stats — the findings section
- IT FOLLOWS THE POSITION AND SITS UNDER THE BOARD. Pinned at the top of the page it read as a
  banner to scroll past on the way to the real thing, and a receiver's oddities say nothing about
  a quarterback's — each position has its own finders (checkdown share and yards after contact
  for backs, pressure faced and receiver drops for quarterbacks, first reads and contested rate
  for pass catchers).
- It is DERIVED, never written. Each finder is a rule over the
  qualified pool, so it re-reads itself whenever the data moves — weekly once the season starts,
  with nobody editing copy. Proof it is real: each season produces different facts (2023 Drake
  London, 2024 A.J. Brown, 2025 Tee Higgins on first-read rate).
- A FACT HAS TO CLEAR A BAR TO BE STATED, and if nothing clears it nothing is shown. "The
  highest drop rate was 4.1%" is not a finding, and padding the strip is how a page starts lying
  quietly.
- THE INTERESTING FACTS ARE GAPS, NOT EXTREMES. "Most targets" is available anywhere; "100
  targets of which only 44% were the first read" is a fact about a role and exists nowhere else.
- One card per player — Tee Higgins legitimately led both first-read and contested rate in 2025,
  and two cards about one man reads as a strip with one idea.
- A SHARE OF RECEIVING YARDS CANNOT EXCEED 100%, and it did: "146% of Isiah Pacheco's receiving
  yards came after the catch" rendered live. A back who catches BEHIND the line has NEGATIVE
  yards before the catch, and a negative denominator runs the share past 100. It is not an edge
  case — **145 of 555 receiving seasons are negative**, essentially every pass-catching back.
  `yacShare()` in app-core.js is now the single reader: it returns a share only where one exists,
  and flags `behindLine` so the page says something true instead of an impossible number.

## The profile overview
- IT LEADS WITH PRODUCTION. A reader could open a player and see no production at all, because
  the season totals sat behind a tab on a profile that opened somewhere else. The headline of his
  last season is first now, with only the numbers that define his position — a row of twenty
  stats is the same as no row.
- The game log stays in the Stats tab. It is one player's, and Stats & Charts ranks players
  against each other, so moving it there would bury it somewhere nobody would look either. The
  fix for "people miss it" is the headline plus two ways out: deeper into him, or across to
  where he RANKS, which is the one thing a profile cannot show.
- `switchProfileTab(tab, el)` takes an OPTIONAL element. Inline handlers pass `this`; anything
  moving tabs programmatically has nothing to pass, and the missing fallback made it throw on
  `el.classList` — aborting before the render and leaving the profile with no active tab.

## What has changed — the movement card
- Every other card on a profile describes a STATE. This one describes a DIRECTION, and it exists
  only because the daily build stopped overwriting itself and started keeping a line a day.
  Nobody else can say when a status flipped or which way a draft board has been drifting,
  because nobody else kept the days.
- THE DIRECTION GOES IN WORDS. A lower pick number is EARLIER, so a FALLING ADP figure means the
  room likes him MORE. Printed as a bare delta it reads as the exact opposite of what happened,
  which is worse than not printing it at all. The sparkline is inverted for the same reason —
  the line rises when the reader's opinion of him should.
- THE RECORD HAS A BEGINNING. With nothing to show, the card says the log does not go back far
  enough rather than rendering silence, which reads as "nothing happened". The date is taken
  from the log itself, so it stays true as the series grows.
- `loadJSONL` in app-core.js reads the series. A single unparseable line is SKIPPED and counted,
  not fatal — a truncated write at the end of a log must not take the eleven months in front of
  it down with it.

## Medical Intelligence
- THE PAGE LEADS WITH WHO IS HURT TODAY. It used to open on a research tool, with the 287
  profiles beginning 2,280px down — but nobody arrives asking how ACLs heal in general, they
  arrive asking whether anyone on their team is hurt right now. The counts come from the same
  live status the rest of the site uses, so they can never disagree with a player's own badge.
- NO EMOJI. The injury-type cards led with a leg, a foot and a brain — the only place on the
  site using emoji as a visual language, on the page where tone matters most. A torn Achilles is
  somebody's career. `inj.icon` stays in injury-research.json (hand-written research, not worth
  a migration) and nothing renders it.
- EVERY RETURN RATE CARRIES WHAT IT MEASURES. The cards showed a bare "Return: 65%" while the
  data held `returnRateLabel: "60–69% of WRs return"` all along. A number that consequential
  without its unit is a Rorschach test — a reader can as easily take it for a chance of full
  recovery, or of ever playing again.
- A 23,000px page gets a contents line. `medJump` scrolls WITHOUT touching the address, because
  the address bar is the router here and a stray fragment is a URL that means nothing on reload.
- IT DOES NOT USE scrollIntoView. That cannot be offset, so a target lands under the sticky nav
  and the reader sees the wrong thing at the top of the screen. The position is computed against
  the nav's real height instead.
- NOTE FOR ANYONE VERIFYING THIS: programmatic scrolling is a NO-OP in the automated browser —
  even a raw `window.scrollTo(0,500)` leaves scrollY at 0 — so the jump cannot be exercised
  there. What is checkable is that every anchor resolves, the computed target clears the nav,
  and the address stays clean. Do not "fix" a jump on the strength of an automated scroll test.

## Surfacing rest of season
- The Rankings page gains a **Preseason / Rest of season** toggle, AND THE TOGGLE ONLY EXISTS
  WHEN data/ros.json DOES. Out of season the file is absent, `rosData` is null, and there is no
  second view to offer — which is the correct answer, not an error. Forcing the view in that
  state falls back to preseason rather than rendering an empty board.
- IN THE ROS VIEW THE BAND TOGGLES ARE HIDDEN. Missed-time risk draws a second downside onto a
  whisker that does not exist here and there is no chart to switch to; left on screen they invite
  a click that changes nothing — the same mistake the Teams page made with its division picker.
- IT IS NOT A RE-RANKING. rankings.json is untouched and the medians stay the analyst's. This
  answers a different question, which is why it may order players differently AND why it lives
  behind a toggle rather than quietly replacing what he wrote.
- AN ABSENT DATA FILE DOES NOT 404 HERE. vercel.json rewrites anything unmatched to index.html,
  so fetching a file that is not there returns **200 with a page of HTML**. `loadJSON` would try
  to parse it, fail, and warn on the console for every visitor all summer — with "not in season
  yet" and "the file is corrupt" looking identical. `ensureRos` checks the CONTENT TYPE instead:
  `application/json` is a real file, `text/html` is the catch-all answering for something that
  is not there. Vercel sends `nosniff`, so the header can be trusted. Any future
  sometimes-absent data file needs the same treatment.
- `build-ros.js --simulate 2025:8 --write` produces a REAL FILE from simulated data, which is the
  only way to build the pages that read it before September. It is stamped `meta.simulated`, the
  UI prints a red warning when it sees the stamp, and **tests/ros.test.js FAILS if a stamped file
  is ever committed**. The capability has to exist without being able to ship — a stamped file
  looks exactly like a real one to every page that reads it.

## The body map
- `data/injury-anatomy.json` — `scripts/build-injury-anatomy.js`, daily, AFTER build-injury-curves
  because it reads them. A reader who wants to understand a knee injury does not want a list
  sorted alphabetically; he wants to point at a knee.
- THIS IS THE FEATURE MOST LIKELY TO TEMPT SOMEBODY INTO INVENTING A NUMBER. A body map wants to
  say "MCL Grade II — four to six weeks". That sentence is available from general knowledge,
  sounds authoritative, and has no source. So each region carries THREE SEPARATE LAYERS, each
  labelled: FREQUENCY counted from our own injury reports, RECOVERY derived from those same
  reports, and RESEARCH which exists for **seven injuries only**.
- THE RESEARCH LAYER COVERS 30 OF 37 CONDITIONS, each with a NAMED STUDY. Not "orthopedic
  literature" — an author, a journal and a year, rendered on the page under the number it
  belongs to, because a figure whose source lives only in a data file is one the reader has to
  take on trust. A CITATION MUST CARRY A YEAR — the first version of that test accepted any
  string containing "AJSM", which let "AJSM, orthopedic sports medicine literature" through, and
  a journal name with no paper attached is as unfalsifiable as no citation at all. Tightening it
  to require `(YYYY)` caught FOUR pre-existing entries — high_ankle, turf_toe, pcl and hamstring
  — every one of the originals that had been gesturing at a body of work rather than citing one.
  All 20 now name a dated paper.
- THE SEVEN REMAINING GAPS STATE WHY THEY ARE GAPS. "No NFL cohort study" is a fact about the
  literature, not about the effort, and silence reads as "nobody bothered". Each carries a
  `noResearch` line naming what was looked for and not found — and a test rejects a reason that
  smuggles a figure into itself, because a "reason" containing a timeline IS a timeline.
- A CONDITION WITHOUT RESEARCH IS LISTED AND SAYS SO. It appears because it genuinely occurs at
  that region, tagged NO SOURCED DETAIL, and the panel states we have no timeline rather than
  printing a plausible one. Two tests enforce it: `hasSourcedDetail` can never be true without a
  matching entry in injury-research.json, and an unsourced condition may not contain a duration
  or a percentage anywhere in its record. Both mutation-tested — inventing an MCL timeline goes
  red, and marking everything sourced goes red.
- BODY PARTS ARE MATCHED SIDE-INSENSITIVELY. Teams write "Shoulder", "right Shoulder" and "Right
  Shoulder", and an exact match dropped every prefixed one — thirteen shoulder episodes sat in
  the unmapped list purely because somebody typed a side. Which side it is has never mattered to
  a reader pointing at a body map. Anything still unmapped is RECORDED in meta, and a test fails
  if a common part belongs to no region.
- The figure is a plain dummy, not an anatomical drawing: regions have to be big enough to hit
  with a thumb, and every region is a real `<button>` layered over an `aria-hidden` SVG, because
  a drawing full of `<path onmouseover>` is unreachable by keyboard.

## The phone
- MEASURE AT 390px BEFORE AND AFTER, in a browser, and put the numbers in the commit. Every
  finding in this section came from a measurement and none of them from reading the CSS.
- The phone-wide overrides live in ONE block at the END of `styles.css`, not scattered. At equal
  specificity the later rule wins, and this file has a history of a mobile fix being silently
  beaten by a later block re-setting the same property. Component-local mobile rules stay with
  their component; anything cross-cutting goes in the block at the bottom.
- BUT ORDER ONLY BREAKS TIES. The first version of the 16px form-control rule was
  `input, select, textarea` and it changed nothing at all, because `.players-search-input` beats a
  bare element selector on specificity from anywhere in the file. The rule names the classes, and
  a test asserts it names every control the markup actually uses.
- A FORM CONTROL UNDER 16px ZOOMS iOS ON FOCUS and does not zoom back out. Every field here was
  under it. Fix the font size — never `maximum-scale`, which takes pinch-zoom from the people who
  need it most.
- A FLEX ROW OF PILLS MUST WRAP. `.position-filter` could not, so the Stats & Charts mode switch
  set the page width to 537px against a 390px viewport and scrolled the whole DOCUMENT sideways.
  Wrapping is free on a desktop, where the row never reaches it.
- WHEN A TABLE IS TOO WIDE, PIN ITS FIRST COLUMN — do not drop a column until it fits. The field
  map settled this once; the players table (540px in a 385px box) and the scheme table (475 in
  307) now do the same. Dropping a column makes the phone reader the only one who cannot see it.
  A sticky cell must repaint its own background or the scrolled columns show through it, and the
  head and the body do not share one — the body sits on `--bg`, the header on `--bg-elevated`.
- 44px IS THE FLOOR FOR ANYTHING A THUMB HAS TO HIT, under `(pointer: coarse), (max-width: 768px)`.
  The hamburger was 30×24 — the only navigation a phone has.
- AN OFF-CANVAS DRAWER IS STILL IN THE TAB ORDER. Parked at `right:-300px` it kept fourteen
  controls focusable on a desktop that has no way to open it. `visibility: hidden` when closed.
  Switch visibility with a DELAY (`visibility 0s linear .3s` closing, `0s` opening) rather than
  transitioning it: discrete interpolation flips at a different moment in different engines, and
  in a throttled frame it never flips at all.
- THE PHONE HAD NO SEARCH. `.nav-search` is `display:none` under 768px and nothing replaced it, so
  the only way to a player was the Players page's own box. The drawer carries a REAL input now —
  iOS raises the keyboard only for a focus that happens inside the tap itself, so the desktop
  trick of switching page and calling `focus()` behind a timeout lands on a box with no keyboard.
  It hands the query to `filterPlayers`; there is still exactly one search on this site.
- A CSS TEST MUST STRIP COMMENTS FIRST. Every rule here is explained in prose that quotes the
  declaration it explains, so a test that greps the raw file passes on the comment describing a
  rule that has been deleted. That is how the `visibility: hidden` mutant escaped.

## The rollover, rehearsed
- `node scripts/dry-run-rollover.js` COPIES the repo to a temp dir, tells it the season has
  flipped, runs the daily Action's steps in the Action's order, and classifies each one: OK (it
  produced the new season), LOUD (it failed and said so — correct, nflverse has no file for a
  season that has not started), NET (a socket died; says nothing), QUIET (exit 0 and the file it
  wrote still describes the old season — the only dangerous outcome). Then it runs check-season
  and expects RED. An alarm that has never been made to ring is a claim, not a guarantee.
- It reads the step list OUT of daily-update.yml. A list kept beside the workflow drifts from it,
  and the drift would be silent in the one tool built to find silence.
- `SIGNAL_SEASON_STATE='{"season":2026,"week":1,"phase":"regular"}'` drives lib/season.js from
  outside for a single process. It ABORTS if CI or GITHUB_ACTIONS is set, and announces itself on
  every read: a file built under a simulated calendar describes a season nobody has played.
- WHAT THE FIRST RUN FOUND: `build-scheme.js` never migrated to lib/season.js. It read the season
  off the calendar month, so told the league was in 2026 week 1 it fetched 2025, exited 0, and
  printed "unchanged" five times — scheme, charting, fieldmap, player-usage and weekly-usage would
  all have stayed a year behind under this season's heading, and weekly usage is what the In
  Season section reads. season.js's own docblock listed nine scripts it was written to replace;
  five had been migrated and nothing said the other four had not.
- AVAILABILITY IS MEASURED OVER COMPLETED SEASONS, NEVER ONE IN PROGRESS. Games played out of 17
  means a live season counts every game not yet played as a game missed: in week 3 a healthy
  starter reads as 3 of 17 and every floor on the site collapses. `lastCompletedSeason()` for
  build-rankings and build-injury-curves, NOT `dataSeasons()`.
- `build-rankings.js` RUNS IN THE DAILY ACTION, after update-data and fetch-stats and before
  build-ros and build-history, which read what it writes. It was run by hand for most of a year
  while printing a live injury status beside each missed-time case — four days stale when this was
  found, with no alarm anywhere. check-season now reds the run if its `builtAt` is more than three
  days old in season, and tests/daily-pipeline.test.js fails if the step is removed or reordered.
- A test that greps for a symbol NEAR a guard passes when the guard is gutted. Scope the assertion
  to the branch itself — the CI check in season.js was reduced to a console warning and stayed
  green, because two unrelated `process.exit(1)` calls sat a few lines below it.

## The waiver wire
- `data/depth-league.json` IS THE POINT OF THE PAGE. The 350-player pool is the players already
  rostered; a waiver board is about the others, so a depth layer that stops at the pool has nothing
  to say about the exact players it is asked about. fetch-context now keeps the whole league at the
  four skill positions — 1,066 players — in its OWN file, because the profile and Stats & Charts
  both load context.json and neither needs 31 other teams' backup receivers (+135KB on two of the
  most-visited paths).
- THE REASON IS THE NAMES, NOT THE RANK. "3rd at WR" is a number; "behind Nico Collins and Jayden
  Higgins" is why the add is or is not worth making.
- NO DENOMINATOR ON THE DEPTH LINE. "3 of 16 at WR" reads as better than it is — before the cutdown
  a published chart lists the whole 90-man camp roster, so the 16 is a headcount of everyone with a
  locker. The rank and the names ahead of him are the true parts.
- A DIRECTION NEEDS TWO READINGS, and Sleeper publishes no history of its own, so the series only
  reaches as far back as the site has been keeping it (it began 2026-08-20). On day one the board
  says so instead of drawing a trend through one point — the same call the In Season boards make in
  their opening weeks.
- AN UNMATCHED NAME KEEPS ITS COUNT AND NEVER A GUESSED ID. The room speculates on players outside
  the pool; a free agent added 60,000 times is worth listing, attaching him to the wrong player is
  not. Unlinked names are styled as text, because a link that goes nowhere is worse than none.
- FIRST SIGHTINGS ARE NOT MOVES. On the first run every depth entry is one — publishing them would
  announce 354 promotions on day one.
- IT DROPS THE CONTROLS THAT DO NOT REACH IT. One morning's adds have no position and no season, so
  both filters are hidden — the same call the field map's view toggle got. And the preseason banner
  is suppressed on this view: "every board here is built from 2025" is true of the matchup board and
  false of a list of adds from this morning, and a caveat that does not apply teaches people to skip
  the ones that do.
- A ROUTE KEY WITH A SLASH IN IT NOW RESOLVES. `metaForRoute` read only the first segment, so
  `season/usage` and `draft/film` had titles written for them that were never once used — both
  served the parent's. Two-segment keys are looked up before the per-prefix handlers.

## In-season cadence — two tiers
- MEASURED AGAINST NFLVERSE'S OWN SCHEDULE, THE DAILY BUILD IS ALREADY RIGHT FOR THE STATS. They
  rebuild play-by-play after every window — TNF 05:30 UTC Fri, early window 22:00 UTC Sun, late
  window 00:05 UTC Mon, SNF 05:30 UTC Mon, MNF 05:30 UTC Tue — and all of it lands overnight, so
  the 11:00 UTC build has the weekend in it by Monday morning and Monday night's game by Tuesday
  morning. Running the 200MB half more often would cost everything and change nothing.
- WHAT IS BADLY TIMED IS THE LIVE STATE. Inactives are official ninety minutes before kickoff, so a
  build that ran at 6:00 ET does not have them: a reader setting a lineup at noon on Sunday is
  looking at a status page from before the teams said who was playing. Same for the adds a room
  makes on Tuesday night, before Wednesday's waivers process.
- So there are two tiers, split by WHERE THE DATA COMES FROM: `full` (everything, including the
  nflverse CSVs) once a day, and `light` (Sleeper statuses, trending, ESPN news, and the boards
  derived from them — all API calls, about a second of work) four more times a week in season.
  Schedules: Sun 16:30 UTC (12:30 ET, after inactives), Sun 22:30 UTC, Tue 23:00 UTC (claims go in
  Tuesday night), Thu 23:00 UTC (TNF inactives).
- `scripts/lib/cadence.js` decides, AND IT READS THE CRON THAT FIRED, NOT THE CLOCK. GitHub delays
  scheduled runs, sometimes past the hour, so `getUTCHours() === 11` would quietly demote a late
  daily build to a status refresh and skip the day's real work. `github.event.schedule` is the exact
  expression that triggered the run and is never late.
- The mapping is a RULE, not a list: the full build is whichever cron sits at 11:00 UTC, everything
  else is light. A list of cron strings in the planner would be a second copy of the workflow's
  schedule and the two would drift the first time either was edited.
- OUT OF SEASON THE LIGHT SCHEDULES ARE NO-OPS, decided at runtime from lib/season.js rather than by
  a month range in the cron — a month range is a boundary somebody has to remember, which is the
  thing season.js exists to abolish. Four no-op runs a week is cheaper than that.
- THE POOL REBUILD IS FULL-ONLY even though it runs first: build-players downloads the nflverse
  rosters for the GSIS crosswalk, and a status refresh does not need the pool rebuilt. Membership is
  deliberately hysteretic, so nobody joins or leaves it between Sunday morning and Sunday lunchtime.
- SERIES ARE SAMPLED ONCE A DAY; EVENT LOGS ARE WRITTEN WHENEVER THE EVENT HAPPENS. This is what the
  cadence turned from a distinction into a rule. ADP, ranks and trending are series and stay with
  the full build, or a delta over them carries a time-of-day wobble. Status and depth are event logs
  and the light refresh writes them with `build-history.js --events-only` — skipping the file
  entirely left the log saying Healthy while players.json said "Questionable (Hand)", and the log IS
  the state the script diffs against, so every later change would have been computed from a position
  that never existed. tests/history.test.js caught that within minutes of the tiers being wired up.
- THE WIRE'S READING IS DATED BY THE DATA, NOT THE CLOCK. trending.json carries the moment the room
  was counted; a light refresh updates it and the full build writes the day's history line. Reading
  "today" off the wall clock printed a fresh count beside an arrow computed from the morning's, and
  when nothing had refreshed at all it compared a number with itself and reported "steady, 0%" over
  a board where plenty had moved.
- The commit message names the tier. A light refresh touches no nflverse file, and a commit saying
  "stats synced from nflverse" on a Sunday afternoon sends whoever reads the log looking for a
  change that is not in it.

## What a player is running into — the team environment
- `data/environment.json` — `scripts/build-environment.js`, daily. Every other board here measures a
  PLAYER; this one measures what he was handed. Two backs with identical numbers are not identical
  if one of them runs behind a top-five line, and nothing on the site said so.
- THERE ARE TWO READINGS OF A LINE AND THEY DO NOT AGREE. Next Gen Stats computes an EXPECTED yards
  figure for every carry from the position, speed and direction of all 22 players at the handoff —
  so the blocking is priced INTO the bar rather than subtracted afterwards. Pro Football Reference
  charts YARDS BEFORE CONTACT by watching the play. **Measured across 238 team-seasons they agree at
  r = 0.32.** Both are published, the gap between a team's two ranks is shown, and they are never
  averaged: in 2025 Miami is 1st by tracking and 28th by charting, San Francisco 2nd and 23rd.
- THE EXPECTATION IS THE PART THAT PERSISTS: **r = 0.42 year over year** across 192 team pairs, which
  is what makes it an environment rather than a result. A back's own RYOE repeats at 0.22.
- DELIBERATELY NOT PFF. Their run-blocking grade is the number usually quoted for this, and it is a
  paid, hand-graded product nobody outside can check or reproduce. Everything here is free and
  carries its own source.
- The agreement and the persistence are COMPUTED BY THE BUILD and travel in meta, so the page prints
  a number that is currently true rather than one somebody measured once and typed in.
- THE TEAM IS THE ONE HE PLAYED FOR THAT SEASON. Both source CSVs carry it per row; reading it from
  today's pool attributes a 2023 season to whoever employs him now. That single mistake moved the
  vendor agreement from 0.32 to 0.15 while this was being written. PFR files a traded player under
  `2TM`/`3TM`, which is not a franchise — `isRealTeam` is exported and unit-tested, because a
  mutation that gutted it to `return true` passed a test that only checked the name still appeared.
- THE PASSING CSV USES DIFFERENT COLUMN NAMES FROM THE RUSHING ONE — `team` not `tm`,
  `pass_attempts` not `att`, `times_pressured` not `prss`. Read with the rushing names it produced a
  complete set of nulls that rendered perfectly. The build now fails if fewer than 20 teams carry a
  pressure rate.

## Rushing: three legs, and they disagree
- RYOE is the number everyone quotes and the one most likely to be over-read. MEASURED HERE over
  2018-2025: RYOE per attempt repeats year to year at **r = 0.22**, and as a percentage at **0.09** —
  the form it is usually quoted in is the least repeatable of the three. Yards per carry repeats
  better at 0.29. Skew is +0.57 and the 90th percentile is 0.86 against a maximum of 2.87, so a
  season figure is carried by a handful of long runs. It is a description, never a projection input.
- SO THE THREE TRAVEL TOGETHER: RYOE for talent isolation, EPA per carry for what the run was worth
  in the situation, yards per carry as the raw check. 2025 is the clean demonstration — **Rhamondre
  Stevenson is 1st in RYOE percentage and 41st of 46 in EPA per carry**, and Rachaad White is 40th
  and 2nd. A board showing either alone would name the wrong back.
- `rush_pct_over_expected` IS NOT RYOE AS A PERCENTAGE, whatever the name suggests. It runs 0.34 to
  0.49 across qualified backs: it is the SHARE OF CARRIES that beat their expectation, which is a
  consistency measure worth having under an honest name (`beatRate`). Read as the percentage form it
  would have printed 0.4% beside a James Cook season he ran 28% above the bar. The percentage form
  is DERIVED — RYOE over the expectation — because nothing published gives it.
- `data/rushing.json` is the SIXTH OUTPUT of the one play-by-play download, via `lib/rushing.js`.
  EPA per carry is an average over a skewed distribution, so success rate travels with it — the same
  question asked in a way one long touchdown cannot dominate. Kneels and spikes are excluded;
  counted in they drag every leader down by an amount unrelated to running the ball.
- A CONSTANT NAMED `FIRST_<x>_SEASON` IS EXEMPT from the no-hand-typed-seasons rule and the rollover
  test says so. NGS has no expected-yards figure before 2018 — the columns exist and are empty. That
  is a fact about history, not a boundary that moves with the calendar.

## The environment card, and the two bugs the daily bot found
- The team page carries "What they hand a runner": the two line readings side by side with their
  ranks, the gap between them, pressure faced, the scheme strip and the play-caller. THE GAP IS A
  NUMBER ON THE PAGE, not something averaged away — Miami is 1st by tracking and 28th by charting,
  and a single score would have split the difference and explained nothing.
- The card bows out rather than rendering an empty shell when the file or the team row is absent,
  and `ensureEnvironment` latches with an unconditional assignment (`envData = d || {}`), because
  loadJSON resolves with null on a failed fetch and a guard on `envData` being falsy would re-enter
  the render that scheduled it.
- THE DAILY BOT'S COMMIT IS THE ONE MOST LIKELY TO BREAK A TEST, and on 2026-08-23 it broke two —
  four failed runs before anyone looked. Both were assertions about DATA that had moved, not about
  rules:
  - `tests/retrieve.test.js` asked whether "cook" was ambiguous and asserted several came back. True
    until Brady Cook fell out of the 350. The pool is hysteretic but it churns, so the test now
    finds a shared surname IN THE POOL and asks about that one. A fixture named in the test is a
    fixture that will be wrong eventually.
  - `tests/wire.test.js` asserted a player's depth rank equalled the number of names ahead of him.
    Atlanta listed two quarterbacks at QB3, so the man published as QB4 genuinely has four ahead.
    Ranks TIE; the rank and the count are different facts and both are true.
- A cascade worth recognising: the full build failed on those tests, so no fresh data was committed,
  so the following light runs — which correctly no-opped in the preseason — still failed their
  `always()` test step on the now-stale data. One broken assertion reds every run after it.
