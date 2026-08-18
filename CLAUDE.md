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
- Still hand-pinned and still needing a decision each year, because they are editorial rather
  than mechanical: `build-teams.js` SEASON/STATS_SEASON, `build-sos.js` SEASON/DEF_SEASON,
  `fetch-adp.js` SEASON, `build-draft-outcomes.js` FIRST_CLASS/LAST_CLASS.
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
