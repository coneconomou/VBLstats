# Plan

Show Big V finals results the way I like: a list of finals games, and for each game the final score (with quarters) plus the full box score.

## Decisions
- **Decided:** Static HTML/JS, no framework or build. Calls the NBL Synergy proxy directly (it allows CORS).
- **Decided:** Finals = fixtures with `fixtureType: FINAL` in the competition's current (ACTIVE) season. Matches the "Finals" tab on basketballvictoria.com.au/bigv/fixtures.
- **Decided:** Competition picker for all Big V comps, default Championship Men, remembered in localStorage.
- **Decided:** Box score columns match the official BV widget (MIN … EFF). PF = all fouls (`foulsTotal`), like the widget.
- **Decided:** Every decimal stat shows exactly 1 decimal place; percentages show "–" when there were no attempts.
- **Decided:** Three pages: Finals, Ladder, Stats. Competition + season pickers in the header apply to all of them (season defaults to the current one).
- **Decided:** Ladder = Synergy standings (OVERALL), same numbers as /bigv/ladder incl. finals games. "Next" column only shows when a team has an upcoming game.
- **Decided:** Stats = player season stats like /bigv/statistics, but columns reordered (averages first, then shooting) and every column sortable by clicking its header instead of the Points/Rebounds/Assists/Blocks tabs. Team filter. "F" from the BV site is labelled FD (fouls drawn).
- **Decided:** Player season stats aren't saved in localStorage (~700 KB, would push saved games out).
- **Decided:** Finished games are saved in localStorage after first load (they never change); list falls back to last saved copy when the API is busy.
- **Open:** Captain "(C)" marker: not in the Synergy data we fetch, so it's left out.
- **Open:** Hosting somewhere other than localhost (any static host works).
