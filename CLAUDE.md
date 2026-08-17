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
