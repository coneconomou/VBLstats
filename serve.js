// Tiny static server so ES modules load (they won't from file://). No dependencies on purpose.
// Also proxies the NBL1 "rosetta" API (see /nbl1-api below).
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT) || 5173;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

// ---------- NBL1 proxy ----------
// NBL1's stats API only answers requests that say they come from nbl1.com.au (browsers block it from
// anywhere else), so the app asks this server, which adds that origin. Agreed with the owner as a
// workaround; it may break if NBL1 changes their API.
const ROSETTA = 'https://prod.rosetta.nbl.com.au/get/';
const ROSETTA_HEADERS = { Origin: 'https://www.nbl1.com.au', Referer: 'https://www.nbl1.com.au/', 'User-Agent': 'Mozilla/5.0' };
const ALLOWED = /^(nbl1\/(seasons|matches|standings)\b|match\/[\w-]+\/live\/all$)/;
const MEMO_MS = 5 * 60 * 1000; // matches the API's own cache time
const memo = new Map();
const cacheDir = join(root, '.cache', 'nbl1-matches');

// A full match is ~1 MB, almost all play-by-play and video data the app never uses.
function slimMatch(json) {
  const drop = ['play_by_play', 'match_video', 'calculated_player_statistics', 'calculated_team_statistics', 'betting', 'odds'];
  for (const m of json.data ?? []) for (const k of drop) delete m[k];
  return json;
}

async function rosetta(path, search) {
  const key = path + search;
  const isMatch = path.startsWith('match/');
  const file = isMatch ? join(cacheDir, `${path.split('/')[1]}.json`) : null;
  // Finished games never change, so they're kept on disk and only ever downloaded once.
  if (file) {
    try { return await readFile(file, 'utf8'); } catch { /* not cached yet */ }
  }
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.body;

  const res = await fetch(ROSETTA + path + search, { headers: ROSETTA_HEADERS });
  if (!res.ok) throw Object.assign(new Error(`NBL1 API ${res.status}`), { status: res.status });
  let json = await res.json();
  if (isMatch) json = slimMatch(json);
  const body = JSON.stringify(json);
  memo.set(key, { at: Date.now(), body });
  if (file && json.data?.[0]?.match_status === 'complete') {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, body);
  }
  return body;
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = decodeURIComponent(url.pathname);

  if (path.startsWith('/nbl1-api/')) {
    const apiPath = path.slice('/nbl1-api/'.length);
    // Only the handful of read-only endpoints the app uses: this is not a general-purpose proxy.
    if (req.method !== 'GET' || !ALLOWED.test(apiPath)) { res.writeHead(403).end('Not allowed'); return; }
    try {
      const body = await rosetta(apiPath, url.search);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch (err) {
      res.writeHead(err.status ?? 502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`VBL Stats running at http://localhost:${port}`));
