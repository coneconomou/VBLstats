# VBL Stats

Personal web app showing Big V (Basketball Victoria) results, box scores, ladder, player stats and a referee Scout report, my way.

Read `plan.md` first.

## How it works
- Static site, no build step, no dependencies. `npm start` (= `node serve.js`) serves it at http://localhost:5173 for development.
- Desktop app: `app/VBL Stats.vbs` -> `app/launch.ps1` starts serve.js on port 5199 and opens Edge/Chrome in `--app` mode with its own profile (`%LOCALAPPDATA%\VBLStats\browser`), then stops the server when the window closes. `npm run install-app` (re)creates the Desktop + Start menu shortcuts; re-run it if the project folder moves.
- Data comes straight from the browser via NBL's public Synergy proxy: `https://prod.services.nbl.com.au/api_cache/bbv/synergy?route=...&format=true`. Same source the BV site uses.
- `src/stats.js`, `src/scout.js`: pure data shaping (tested). `src/api.js`: fetching + local fallback cache. `src/app.js`: rendering + hash routing.

## Working here
- `npm test` runs `node --test` against saved real API responses in `test/fixtures/` (CM 2026, checked against the official box score, ladder and stats pages).
- The API sometimes returns `"data": null` with a 200 when it's busy/throttled, and caches that for ~2 min. Don't hammer it while testing.
