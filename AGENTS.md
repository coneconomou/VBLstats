# VBL Stats

Personal web app (live at https://coneconomou.github.io/VBLstats/, pushing to `master` on github.com/coneconomou/VBLstats redeploys it) showing Big V (Basketball Victoria) and NBL1 results, box scores, ladder, player stats and a referee Scout report, my way.

Read `plan.md` first.

## How it works
- Static site, no build step, no dependencies. `npm start` (= `node serve.js`) serves it at http://localhost:5173 for development.
- `serve.js` listens on 127.0.0.1 only and serves only `index.html`, `src/*.js|css` and `app/icon.png` (add new asset paths to `staticFile()`). `/__vblstats` answers `vblstats` so the launcher can tell it's ours.
- Desktop app: `app/VBL Stats.vbs` -> `app/launch.ps1` starts serve.js on port 5199 (or the next free one up to 5209) and opens Edge/Chrome in `--app` mode with its own profile (`%LOCALAPPDATA%\VBLStats\browser`), then stops the server when the window closes. `npm run install-app` (`app/install.js`) (re)creates the Desktop + Start menu shortcuts on Windows, or on macOS builds `~/Applications/VBL Stats.app` (`app/install-mac.sh`, launcher `app/mac-launcher.sh`: same logic as launch.ps1, Chrome/Edge `--app`, server stops on Cmd+Q) plus a Desktop link. Re-run it if the project folder moves. `.sh` files must stay LF (`.gitattributes`).
- Big V data comes straight from the browser via NBL's public Synergy proxy: `https://prod.services.nbl.com.au/api_cache/bbv/synergy?route=...&format=true`. Same source the BV site uses.
- NBL1 data comes from NBL1's own API (`https://prod.rosetta.nbl.com.au/get/...`), which only answers requests with an nbl1.com.au Origin. `serve.js` proxies it at `/nbl1-api/...` adding that header (owner OK'd this workaround; it can break if NBL1 changes things). Online (GitHub Pages, https://coneconomou.github.io/VBLstats/) the same proxy runs as a Cloudflare Worker, `worker/nbl1-proxy.js`, deployed with `npm run deploy-worker` to https://vblstats-nbl1.vblstats.workers.dev; `src/api.js` uses it when the page is on github.io. Both proxies share their allow-list/slimming in `src/rosetta.js`. Locally, finished games are cached slimmed on disk in `.cache/nbl1-matches/` (gitignored).
- NBL1 has no full season-stats endpoint: Stats/Scout add up every finished game's box score (`seasonTotals` in `src/nbl1.js`). First load of a season takes ~1 min, then it's instant from the disk cache.
- `src/stats.js`, `src/scout.js`: pure data shaping (tested). `src/nbl1.js`: turns NBL1 data into the same Synergy shapes (tested). `src/api.js`: one interface for both leagues + fetching/caching. `src/app.js`: rendering + hash routing.

## Working here
- `npm test` runs `node --test` (no network: fake fetch for api/serve tests) against saved real API responses in `test/fixtures/` (Big V CM 2026, checked against the official box score, ladder and stats pages; NBL1 South 2026, checked for internal consistency and against NBL1's leaders).
- The API sometimes returns `"data": null` with a 200 when it's busy/throttled, and caches that for ~2 min. Don't hammer it while testing.
