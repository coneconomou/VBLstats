# VBL Stats

Big V and NBL1 basketball results, box scores, ladders, player stats and a referee Scout report, in one dark-mode app.

## Setup (Mac or Windows)

1. Install [Node.js](https://nodejs.org) (the LTS version).
2. Open Terminal (Mac) or PowerShell (Windows) in this folder and run:

   ```
   npm run install-app
   ```

   - **Mac:** creates **VBL Stats** in your Applications folder plus a Desktop shortcut. Opens best in Chrome or Edge (its own app window); otherwise it opens in your default browser. Quit it with Cmd+Q.
   - **Windows:** creates **VBL Stats** shortcuts on the Desktop and in the Start menu.
3. Double-click **VBL Stats**.

No app? `npm start`, then open http://localhost:5173 in a browser.

If you move this folder, run `npm run install-app` again.

## Notes

- NBL1 stats/scout for a season take about a minute the first time (it adds up every game's box score), then they're instant.
- For developers: read `AGENTS.md` and `plan.md`. Tests: `npm test`.
