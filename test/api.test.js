// api.js NBL1 season totals: games that fail to load are retried, reported as missing, and not cached,
// so a later visit picks them up. Uses a fake fetch (no real API calls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLeague, getSeasons, getSeasonPlayerStats, getTeamSeasonStats } from '../src/api.js';

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url)));
const seasons = load('nbl1-seasons');
const match = load('nbl1-match').data[0];
const seasonId = match.season.id; // 2026 South Women
// Three finished games in the season, all copies of the saved match under different ids.
const ids = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003'];
const listItem = load('nbl1-matches-south-2026').data.find((m) => m.id === match.id);
const matchList = { data: ids.map((id) => ({ ...listItem, id, external_id: id })) };

let brokenGame = ids[2];
const calls = [];
globalThis.fetch = async (url) => {
  calls.push(url);
  const json = (body) => ({ ok: true, status: 200, json: async () => structuredClone(body) });
  if (url === '/nbl1-api/nbl1/seasons') return json(seasons);
  if (url.startsWith('/nbl1-api/nbl1/matches/in/season/2026/regular/south')) return json(matchList);
  const id = /match\/([\w-]+)\/live\/all/.exec(url)?.[1];
  if (id === brokenGame) return { ok: false, status: 503, json: async () => ({}) };
  if (id) return json({ data: [{ ...match, id, external_id: id }] });
  throw new Error(`unexpected ${url}`);
};

test('NBL1 totals: failed games are retried, flagged, and picked up on the next visit', async () => {
  setLeague('nbl1');
  await getSeasons('south-women');

  const first = await getSeasonPlayerStats(seasonId);
  assert.deepEqual(first.incomplete, { missing: 1, total: 3 });
  assert.equal(calls.filter((u) => u.includes(brokenGame)).length, 2, 'retried once');
  const hobart = first.data.find((p) => p.statistics.points > 0);
  assert.equal(hobart.statistics.games, 2, 'only the 2 games that loaded');

  brokenGame = null; // NBL1 recovers
  const second = await getTeamSeasonStats(seasonId);
  assert.equal(second.incomplete, null, 'incomplete totals were not kept, so this rebuilt them');
  assert.ok(second.data.every((t) => t.statistics.games === 3));

  const before = calls.length;
  await getSeasonPlayerStats(seasonId);
  assert.equal(calls.length, before, 'complete totals are reused');
});
