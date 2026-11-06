// `npm run install-app`: creates the double-click Pregame app for this computer's OS.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const run = (cmd, args) => process.exit(spawnSync(cmd, args, { stdio: 'inherit' }).status ?? 1);

if (process.platform === 'win32') {
  run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'install-shortcuts.ps1')]);
} else if (process.platform === 'darwin') {
  // Pass this Node's path: apps opened from Finder don't get the Terminal's PATH, so they can't find node.
  run('bash', [join(here, 'install-mac.sh'), process.execPath]);
} else {
  console.log('No desktop app for this OS yet. Run `npm start` and open http://localhost:5173 instead.');
}
