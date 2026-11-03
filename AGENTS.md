# VBL Stats

Personal web app showing Big V (Basketball Victoria) and NBL1 results, box scores, ladder, player stats and a referee Scout report, my way.

Read `plan.md` first.

## How it works
- Static site, no build step, no dependencies. `npm start` (= `node serve.js`) serves it at http://localhost:5173 for development.
- Desktop app: `app/VBL Stats.vbs` -> `app/launch.ps1` starts serve.js on port 5199 and opens Edge/Chrome in `--app` mode with its own profile (`%LOCALAPPDATA%\VBLStats\browser`), then stops the server when the window closes. `npm run install-app` (re)creates the Desktop + Start menu shortcuts; re-run it if the project folder moves.
- Big V data comes straight from the browser via NBL's public Synergy proxy: `https://prod.services.nbl.com.au/api_cache/bbv/synergy?route=...&format=true`. Same source the BV site uses.
- NBL1 data comes from NBL1's own API (`https://prod.rosetta.nbl.com.au/get/...`), which only answers requests with an nbl1.com.au Origin. `serve.js` proxies it at `/nbl1-api/...` adding that header (owner OK'd this workaround; it can break if NBL1 changes things). So NBL1 only works through serve.js, not a static host. Finished games are cached slimmed on disk in `.cache/nbl1-matches/` (gitignored).
- NBL1 has no full season-stats endpoint: Stats/Scout add up every finished game's box score (`seasonTotals` in `src/nbl1.js`). First load of a season takes ~1 min, then it's instant from the disk cache.
- `src/stats.js`, `src/scout.js`: pure data shaping (tested). `src/nbl1.js`: turns NBL1 data into the same Synergy shapes (tested). `src/api.js`: one interface for both leagues + fetching/caching. `src/app.js`: rendering + hash routing.

## Working here
- `npm test` runs `node --test` against saved real API responses in `test/fixtures/` (Big V CM 2026, checked against the official box score, ladder and stats pages; NBL1 South 2026, checked for internal consistency and against NBL1's leaders).
- The API sometimes returns `"data": null` with a 200 when it's busy/throttled, and caches that for ~2 min. Don't hammer it while testing.
