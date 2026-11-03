// The BV site reads everything through NBL's cached proxy of the Synergy (Atrium Sports) API.
// It's public, sends CORS `*`, and caches ~2 minutes, so we can call it straight from the browser.
// Gotcha: when the upstream is busy it answers 200 with `"data": null` (and caches that for ~2 min),
// so every successful response is also saved locally and used as a fallback.
import { cleanFixtures } from './stats.js';

const BASE = 'https://prod.services.nbl.com.au/api_cache/bbv/synergy';
const STORE_PREFIX = 'vblstats.api.';

export class UnavailableError extends Error {}

function readStore(key) {
  try { return JSON.parse(localStorage.getItem(STORE_PREFIX + key)); } catch { return null; }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Probably over quota: drop everything we saved and try once more.
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(STORE_PREFIX)).forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
    } catch { /* storage unavailable, fine */ }
  }
}

async function fetchRoute(route, params) {
  const qs = new URLSearchParams({ route, format: 'true', ...params });
  const res = await fetch(`${BASE}?${qs}`, { headers: { 'x-quark-req-src': 'web-bbv' } });
  if (!res.ok) throw new Error(`Stats API error ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json.data)) throw new UnavailableError('The stats service is busy right now. Try again in a couple of minutes.');
  return { data: json.data, includes: json.includes ?? {} };
}

// Same TTL as the proxy's own cache: refetching sooner can't return anything newer, and the
// upstream throttles easily, so switching pages back and forth reuses what we already have.
const MEMO_MS = 2 * 60 * 1000;
const memo = new Map();

// Network first, saved copy if the network fails. `stale` tells the UI it's looking at saved data.
// `save: false` for big responses that would eat the localStorage quota (and evict saved games).
async function synergy(route, params = {}, { save = true } = {}) {
  const key = `${route}?${new URLSearchParams(params)}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.promise;

  const promise = (async () => {
    try {
      const result = await fetchRoute(route, params);
      if (save) writeStore(key, result);
      return result;
    } catch (err) {
      memo.delete(key); // don't remember failures
      const saved = save && readStore(key);
      if (saved) return { ...saved, stale: true };
      throw err;
    }
  })();
  memo.set(key, { at: Date.now(), promise });
  return promise;
}

export const getSeasons = (competitionId) => synergy(`competitions/${competitionId}/seasons`);

export const getSeasonFixtures = (seasonId) =>
  synergy(`seasons/${seasonId}/fixtures`, { limit: '500', include: 'entities,venues,competitions,seasons' })
    .then((r) => ({ ...r, data: cleanFixtures(r.data) }));

export const getStandings = (seasonId) =>
  synergy(`seasons/${seasonId}/standings`, { limit: '200', include: 'entities' });

export const getTeamSeasonStats = (seasonId) =>
  synergy(`statistics/for/entity/in/seasons/${seasonId}`, { limit: '100' });

export const getSeasonPlayerStats = (seasonId) =>
  synergy(`statistics/for/person/in/seasons/${seasonId}`, { limit: '1000', include: 'persons,entities' }, { save: false });

export async function getGame(fixtureId) {
  // A finished game never changes, so once we have it there's no need to hit the API again.
  const savedGame = readStore(`game.${fixtureId}`);
  if (savedGame) return savedGame;

  const [fixture, people, teams, periods] = await Promise.all([
    fetchRoute(`fixtures/${fixtureId}`, { include: 'entities,venues,competitions,seasons' }),
    fetchRoute(`statistics/for/person/in/fixtures/${fixtureId}`, { include: 'persons', limit: '200' }),
    fetchRoute(`statistics/for/entity/in/fixtures/${fixtureId}`),
    fetchRoute(`statistics/for/entity/in/fixtures/${fixtureId}/periods`, { limit: '100' }),
  ]);
  if (!fixture.data.length) throw new Error('Game not found');
  const game = { fixture, people, teams, periods };
  if (fixture.data[0].status === 'CONFIRMED' && people.data.length) writeStore(`game.${fixtureId}`, game);
  return game;
}
