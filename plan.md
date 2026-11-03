# Plan

Show Big V stats the way I like: results by round (each game with final score, quarters and full box score), the ladder, player season stats, and a Scout report for refereeing a game between two teams.

## Decisions
- **Decided:** Static HTML/JS, no framework or build. Calls the NBL Synergy proxy directly (it allows CORS).
- **Decided:** Results page (was Finals) with round tabs 1..N plus "Finals", like basketballvictoria.com.au/bigv/fixtures. All `fixtureType: FINAL` games go under Finals regardless of round number. Defaults to the round of the most recent game that has started. Games in a round are listed oldest first. Round is in the URL (`#/results/7`) so the game page's back link returns to it.
- **Decided:** Competition picker for all Big V comps, default Championship Men, remembered in localStorage.
- **Decided:** Box score columns match the official BV widget (MIN … EFF). PF = all fouls (`foulsTotal`), like the widget.
- **Decided:** Every decimal stat shows exactly 1 decimal place; percentages show "–" when there were no attempts.
- **Decided:** Three pages: Results, Ladder, Stats. Competition + season pickers in the header apply to all of them (season defaults to the current one).
- **Decided:** Ladder = Synergy standings (OVERALL), same numbers as /bigv/ladder incl. finals games. "Next" column only shows when a team has an upcoming game.
- **Decided:** Stats = player season stats like /bigv/statistics, but columns reordered (averages first, then shooting) and every column sortable by clicking its header instead of the Points/Rebounds/Assists/Blocks tabs. Team filter. "F" from the BV site is labelled FD (fouls drawn).
- **Decided:** Player season stats aren't saved in localStorage (~700 KB, would push saved games out).
- **Decided:** Finished games are saved in localStorage after first load (they never change); list falls back to last saved copy when the API is busy.
- **Decided:** Scout tab (`#/scout/<teamA>/<teamB>`): pick 2 teams in the selected division/season. Defaults to the next scheduled game, else the top two on the ladder; upcoming games are listed as quick picks. Everything is computed from data in `src/scout.js` (pure, tested), no hand-written text.
- **Decided:** Scout contents: matchup header (ladder spot, record, last 5 incl. finals, next meeting), rule-based referee notes, season averages side by side with league ranks, top-3 leaders per team (scoring, rebounding, assists, threes, fouls committed, fouls drawn), head-to-head (falls back to last season if they haven't met) with the last meeting vs season averages and every player's line, last 5 games per team.
- **Decided:** Fouls in Scout = all player fouls (personal + offensive + technical + unsportsmanlike); team totals exclude coach/bench technicals. Team season averages include finals (the ladder doesn't).
- **Open:** Captain "(C)" marker: not in the Synergy data we fetch, so it's left out.
- **Open:** Hosting somewhere other than localhost (any static host works).
