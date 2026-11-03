// Tiny static server so ES modules load (they won't from file://). No dependencies on purpose.
// Also proxies the NBL1 "rosetta" API (see /nbl1-api below).
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

// Launcher check-in address: lets app/launch.ps1 tell this server apart from some other program on the port.
export const HEALTH_PATH = '/__vblstats';
export const HEALTH_BODY = 'vblstats';

// Only the app's own files are served (not .git, tests, the NBL1 cache, ...).
function staticFile(path) {
  if (path === '/' || path === '/index.html') return join(root, 'index.html');
  if (path === '/app/icon.png') return join(root, 'app', 'icon.png');
  if (/^\/src\/[\w-]+\.(js|css)$/.test(path)) return join(root, path);
  return null;
}

// ---------- NBL1 proxy ----------
// NBL1's stats API only answers requests that say they come from nbl1.com.au (browsers block it from
// anywhere else), so the app asks this server, which adds that origin. Agreed with the owner as a
// workaround; it may break if NBL1 changes their API.
const ROSETTA = 'https://prod.rosetta.nbl.com.au/get/';
const ROSETTA_HEADERS = { Origin: 'https://www.nbl1.com.au', Referer: 'https://www.nbl1.com.au/', 'User-Agent': 'Mozilla/5.0' };
// The exact endpoints the app uses, matched whole, so "../" tricks can't reach anything else.
const ALLOWED = [
  /^nbl1\/seasons$/,
  /^nbl1\/matches\/in\/season\/\d{4}\/regular\/[a-z]+$/,
  /^nbl1\/standings\/\d{4}\/regular$/,
  /^match\/[0-9a-f-]{36}\/live\/all$/,
];
const MEMO_MS = 5 * 60 * 1000; // matches the API's own cache time

// A full match is ~1 MB, almost all play-by-play and video data the app never uses.
function slimMatch(json) {
  const drop = ['play_by_play', 'match_video', 'calculated_player_statistics', 'calculated_team_statistics', 'betting', 'odds'];
  for (const m of json.data ?? []) for (const k of drop) delete m[k];
  return json;
}

const isValidResponse = (json) => json && Array.isArray(json.data);

export function createApp({ fetchImpl = fetch, cacheDir = join(root, '.cache', 'nbl1-matches') } = {}) {
  const memo = new Map();

  async function readCached(file) {
    try {
      const body = await readFile(file, 'utf8');
      // A half-written file (e.g. power cut mid-save) must not be served forever: refetch instead.
      return isValidResponse(JSON.parse(body)) ? body : null;
    } catch { return null; }
  }

  async function rosetta(path, search) {
    const key = path + search;
    const isMatch = path.startsWith('match/');
    const file = isMatch ? join(cacheDir, `${path.split('/')[1]}.json`) : null;
    // Finished games never change, so they're kept on disk and only ever downloaded once.
    if (file) {
      const cached = await readCached(file);
      if (cached) return cached;
    }
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < MEMO_MS) return hit.body;

    const res = await fetchImpl(ROSETTA + path + search, { headers: ROSETTA_HEADERS });
    if (!res.ok) throw Object.assign(new Error(`NBL1 API ${res.status}`), { status: res.status });
    let json = await res.json();
    if (!isValidResponse(json)) throw Object.assign(new Error('NBL1 API sent something unexpected'), { status: 502 });
    if (isMatch) json = slimMatch(json);
    const body = JSON.stringify(json);
    memo.set(key, { at: Date.now(), body });
    if (file && json.data[0]?.match_status === 'complete') {
      // Write to a temp file then rename, so a crash mid-write never leaves a broken cache file.
      await mkdir(cacheDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, body);
      await rename(tmp, file);
    }
    return body;
  }

  return createServer(async (req, res) => {
    let path;
    let search;
    try {
      const url = new URL(req.url, 'http://localhost');
      path = decodeURIComponent(url.pathname);
      search = url.search;
    } catch {
      res.writeHead(400).end('Bad request'); // e.g. "/%": used to crash the whole server
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }

    if (path === HEALTH_PATH) {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(HEALTH_BODY);
      return;
    }

    if (path.startsWith('/nbl1-api/')) {
      const apiPath = path.slice('/nbl1-api/'.length);
      if (!ALLOWED.some((re) => re.test(apiPath))) { res.writeHead(403).end('Not allowed'); return; }
      try {
        const body = await rosetta(apiPath, search);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(body);
      } catch (err) {
        res.writeHead(err.status ?? 502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    const file = staticFile(path);
    if (!file) { res.writeHead(404).end('Not found'); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
}

// Run directly (npm start / the launcher), as opposed to being imported by the tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 5173;
  // Loopback only: nothing else on the network can reach this server.
  createApp().listen(port, '127.0.0.1', () => console.log(`VBL Stats running at http://localhost:${port}`));
}
