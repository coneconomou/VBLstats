// Online NBL1 proxy (worker/nbl1-proxy.js), with a fake upstream.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/nbl1-proxy.js';

const GAME = '0b5b0bde-0f2a-11ef-9a4e-1d1f2e3c4b5a';
const PAGES = 'https://coneconomou.github.io';
let upstreamCalls = [];

function fakeUpstream(url, init) {
  upstreamCalls.push({ url, init });
  const data = url.includes('/match/')
    ? [{ match_status: 'complete', play_by_play: [1, 2, 3], match_video: {}, home_team: {} }]
    : [{ id: 1 }];
  return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
}

async function get(path, origin = PAGES) {
  globalThis.fetch = fakeUpstream;
  return worker.fetch(new Request(`https://vblstats-nbl1.example.workers.dev${path}`, { headers: { Origin: origin } }));
}

test('passes allowed paths on with the nbl1.com.au origin and lets the Pages site read them', async () => {
  upstreamCalls = [];
  const res = await get('/nbl1-api/nbl1/standings/2026/regular?limit=200');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), PAGES);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=300');
  assert.equal(upstreamCalls[0].url, 'https://prod.rosetta.nbl.com.au/get/nbl1/standings/2026/regular?limit=200');
  assert.equal(upstreamCalls[0].init.headers.Origin, 'https://www.nbl1.com.au');
});

test('refuses anything off the allow-list without calling NBL1', async () => {
  upstreamCalls = [];
  for (const path of ['/nbl1-api/nbl1/users', '/nbl1-api/nbl1/seasons/..%2f..%2fother', '/nbl1/seasons', '/']) {
    assert.equal((await get(path)).status, 403, path);
  }
  assert.equal((await get('/nbl1-api/%E0%A4%A')).status, 400);
  assert.equal(upstreamCalls.length, 0);
});

test('slims finished games and marks them cacheable for good', async () => {
  const res = await get(`/nbl1-api/match/${GAME}/live/all`);
  const json = await res.json();
  assert.equal(json.data[0].play_by_play, undefined);
  assert.ok(json.data[0].home_team);
  assert.match(res.headers.get('Cache-Control'), /immutable/);
});

test('other sites get the data but browsers will not let them read it', async () => {
  const res = await get('/nbl1-api/nbl1/seasons', 'https://example.com');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});
