// serve.js: static files, NBL1 proxy rules and the disk cache, against a fake upstream (no real API calls).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createApp, HEALTH_PATH, HEALTH_BODY } from '../serve.js';

const GAME = '4c4cfadc-eb5a-11f0-a854-83821a5837a7';
const upstreamCalls = [];
const fakeMatch = { data: [{ id: GAME, match_status: 'complete', play_by_play: [1, 2, 3], home_score: '67' }] };
const fakeFetch = async (url) => {
  upstreamCalls.push(url);
  return { ok: true, status: 200, json: async () => structuredClone(url.includes('/match/') ? fakeMatch : { data: [] }) };
};

let server;
let base;
let cacheDir;

before(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'vblstats-test-'));
  server = createApp({ fetchImpl: fakeFetch, cacheDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await rm(cacheDir, { recursive: true, force: true });
});

// Raw request so odd paths like "/%" reach the server untouched (fetch would normalise them).
function get(path) {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method: 'GET', path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves the app and the launcher health check', async () => {
  assert.equal((await get('/')).status, 200);
  assert.equal((await get('/src/app.js')).status, 200);
  assert.equal((await get('/app/icon.png')).status, 200);
  assert.deepEqual(await get(HEALTH_PATH), { status: 200, body: HEALTH_BODY });
});

test('a malformed URL gets a 400 instead of crashing the server', async () => {
  assert.equal((await get('/%')).status, 400);
  assert.equal((await get('/nbl1-api/%E0%A4%A')).status, 400);
  assert.equal((await get('/')).status, 200, 'still running');
});

test('only app files are served: no .git, tests, cache or traversal', async () => {
  for (const p of ['/.git/HEAD', '/package.json', '/test/stats.test.js', '/.cache/nbl1-matches/x.json', '/src/../serve.js', '/src/%2e%2e/serve.js', '/app/launch.ps1']) {
    assert.equal((await get(p)).status, 404, p);
  }
});

test('NBL1 proxy only allows the exact endpoints the app uses', async () => {
  upstreamCalls.length = 0;
  assert.equal((await get('/nbl1-api/nbl1/seasons')).status, 200);
  assert.equal((await get('/nbl1-api/nbl1/standings/2026/regular?limit=200')).status, 200);
  assert.equal((await get('/nbl1-api/nbl1/matches/in/season/2026/regular/south')).status, 200);
  for (const p of [
    '/nbl1-api/nbl1/seasons/..%2f..%2f..%2fother',
    '/nbl1-api/nbl1/seasons/../../other',
    '/nbl1-api/nbl1/users',
    '/nbl1-api/match/../nbl1/users/live/all',
    '/nbl1-api/nbl1/standings/2026/regular/../../x',
  ]) {
    assert.equal((await get(p)).status, 403, p);
  }
  assert.equal(upstreamCalls.length, 3, 'blocked requests never reach NBL1');
  assert.ok(upstreamCalls.every((u) => u.startsWith('https://prod.rosetta.nbl.com.au/get/nbl1/')));
});

test('finished games are slimmed, cached on disk, and a corrupt cache file is refetched', async () => {
  upstreamCalls.length = 0;
  const first = JSON.parse((await get(`/nbl1-api/match/${GAME}/live/all`)).body);
  assert.equal(first.data[0].play_by_play, undefined, 'play-by-play dropped');
  const file = join(cacheDir, `${GAME}.json`);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).data[0].home_score, '67');
  assert.deepEqual((await readdir(cacheDir)).filter((f) => f.endsWith('.tmp')), [], 'no temp files left');

  await get(`/nbl1-api/match/${GAME}/live/all`);
  assert.equal(upstreamCalls.length, 1, 'second request served from disk');

  // As if a write was interrupted, then the app restarted (fresh server, nothing in memory).
  await writeFile(file, '{"data":');
  const restarted = createApp({ fetchImpl: fakeFetch, cacheDir });
  await new Promise((r) => restarted.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${restarted.address().port}/nbl1-api/match/${GAME}/live/all`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).data[0].home_score, '67');
    assert.equal(upstreamCalls.length, 2, 'corrupt file triggered a refetch');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).data[0].home_score, '67', 'cache file repaired');
  } finally {
    restarted.close();
  }
});
