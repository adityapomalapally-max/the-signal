# The Signal — Data Update Script

## When to Run
User says: "get news", "update data", "refresh", or "update the signal"

## Steps

### 1. Fetch ESPN Injuries
Search: "NFL injury report today [current date]"
For each significant injury found:
- Check if player exists in `data/players.json` → update status
- Check if player exists in `data/medicals.json` → add new injury entry
- If new player: add to both files

### 2. Cross-Reference Sleeper
Fetch: `https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=25`
- Note which players are trending and why
- If a trending player has a new injury, add to medicals.json

### 3. Web Search New Injuries
Search for any major NFL injuries in the past 48 hours
For each significant injury:
- Research the specific injury type
- Find research-backed recovery stats
- Add complete medical profile entry

### 4. Update Player Statuses
**Never hand-edit `data/players.json`.** It is generated, and `update-data.js`
reconciles every status against the Sleeper feed on the next run — an edit made
here survives until 6 AM ET and then silently disappears.

Hand-set a status in `data/injury-overrides.json` instead. Every entry needs a
`setAt` date and a `source`, and every entry expires (21 days by default), so a
note can't outlive the report behind it the way the old hand-edits did:

```json
{
  "player": "Chris Olave", "pos": "WR", "sleeperId": "8144",
  "status": "PUP (Achilles)", "statusClass": "status-out",
  "setAt": "2026-08-17", "expires": "2026-09-07",
  "source": "ESPN, Aug 17 2026",
  "note": "why this beats the feed"
}
```

Then run `node scripts/check-overrides.js` — it resolves each entry against the
pool and exits non-zero on anything that wouldn't apply. `--schema` prints the
full field list.

An override beats the feed, EXCEPT a live IR / Out / PUP / NFI / Suspended /
Doubtful, which always wins. So an override can quiet a camp "Questionable" the
feed is shouting, but it can never talk a player down off IR.

Roster changes (team, etc.) need no action — the feed owns them.

### 5. Update Medical Profiles
Review `data/medicals.json` and:
- Add currentStatus updates for players with new info
- Add new injury entries with research-backed data
- Update trending flags based on current news cycle

### 6. Commit and Push
```bash
cp /mnt/user-data/outputs/nfl-platform.html /home/claude/the-signal/index.html
cd /home/claude/the-signal
git add .
git commit -m "Data update: [date] — [summary of changes]"
git push origin main
```

### 7. Report to User
Summarize:
- How many player statuses were updated
- Any new medical profiles added
- Any significant injury news
- Any trending players of note

## Quality Checks
- Never fabricate injury data — only add what's confirmed by sources
- Always include source attribution in medical profiles
- Research stats must come from PubMed, OJSM, or other peer-reviewed sources
- If unsure about an injury detail, note it as "unconfirmed" or skip it
