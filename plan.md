# Plan

Show Big V finals results the way I like: a list of finals games, and for each game the final score (with quarters) plus the full box score.

## Decisions
- **Decided:** Static HTML/JS, no framework or build. Calls the NBL Synergy proxy directly (it allows CORS).
- **Decided:** Finals = fixtures with `fixtureType: FINAL` in the competition's current (ACTIVE) season. Matches the "Finals" tab on basketballvictoria.com.au/bigv/fixtures.
- **Decided:** Competition picker for all Big V comps, default Championship Men, remembered in localStorage.
- **Decided:** Box score columns match the official BV widget (MIN … EFF). PF = all fouls (`foulsTotal`), like the widget. Percentages to 1 decimal, "–" when no attempts.
- **Decided:** Finished games are saved in localStorage after first load (they never change); list falls back to last saved copy when the API is busy.
- **Open:** Captain "(C)" marker: not in the Synergy data we fetch, so it's left out.
- **Open:** Hosting somewhere other than localhost (any static host works).
