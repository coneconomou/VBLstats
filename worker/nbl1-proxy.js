// Cloudflare Worker: the online twin of serve.js's /nbl1-api, so NBL1 works on the GitHub Pages site.
// Deploy: npm run deploy-worker (wrangler.toml). Same allow-list and slimming as serve.js (src/rosetta.js).
// No disk cache here: finished games are instead marked cacheable for a year, so each phone/browser
// only downloads them once.
import { ROSETTA, ROSETTA_HEADERS, isAllowed, slimMatch, isValidResponse, isFinishedMatch } from '../src/rosetta.js';

// Only the app's pages may read the answers (browsers enforce this; it keeps other sites from using it).
const ORIGINS = ['https://coneconomou.github.io'];
const PREFIX = '/nbl1-api/';

function reply(body, status, origin, cache) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': cache, Vary: 'Origin' };
  if (ORIGINS.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(body, { status, headers });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const url = new URL(request.url);
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { return new Response('Bad request', { status: 400 }); }
    if (!path.startsWith(PREFIX) || !isAllowed(path.slice(PREFIX.length))) return new Response('Not allowed', { status: 403 });
    const apiPath = path.slice(PREFIX.length);

    try {
      const res = await fetch(ROSETTA + apiPath + url.search, { headers: ROSETTA_HEADERS });
      if (!res.ok) return reply(JSON.stringify({ error: `NBL1 API ${res.status}` }), res.status, origin, 'no-store');
      let json = await res.json();
      if (!isValidResponse(json)) return reply(JSON.stringify({ error: 'NBL1 API sent something unexpected' }), 502, origin, 'no-store');
      if (apiPath.startsWith('match/')) json = slimMatch(json);
      // Finished games never change; everything else follows the API's own 5 min cache.
      const cache = isFinishedMatch(apiPath, json) ? 'public, max-age=31536000, immutable' : 'public, max-age=300';
      return reply(JSON.stringify(json), 200, origin, cache);
    } catch (err) {
      return reply(JSON.stringify({ error: err.message }), 502, origin, 'no-store');
    }
  },
};
