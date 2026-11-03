// Data for two leagues behind one interface (getSeasons, getSeasonFixtures, getStandings, getGame, ...).
//
// Big V: the BV site reads everything through NBL's cached proxy of the Synergy (Atrium Sports) API.
// It's public, sends CORS `*`, and caches ~2 minutes, so we can call it straight from the browser.
// Gotcha: when the upstream is busy it answers 200 with `"data": null` (and caches that for ~2 min),
// so every successful response is also saved locally and used as a fallback.
//
// NBL1: comes from NBL1's own "rosetta" API through our local server (serve.js /nbl1-api), then
// src/nbl1.js reshapes it to look like the Synergy data above.
import { cleanFixtures } from './stats.js';
import {
  NBL1_COMPETITIONS, seasonsFor, fixturesFromMatches, standingsFor, gameFromMatch, seasonTotals,
} from './nbl1.js';

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

const bigv = {};

bigv.getSeasons = (competitionId) => synergy(`competitions/${competitionId}/seasons`);

bigv.getSeasonFixtures = (seasonId) =>
  synergy(`seasons/${seasonId}/fixtures`, { limit: '500', include: 'entities,venues,competitions,seasons' })
    .then((r) => ({ ...r, data: cleanFixtures(r.data) }));

bigv.getStandings = (seasonId) =>
  synergy(`seasons/${seasonId}/standings`, { limit: '200', include: 'entities' });

bigv.getTeamSeasonStats = (seasonId) =>
  synergy(`statistics/for/entity/in/seasons/${seasonId}`, { limit: '100' });

bigv.getSeasonPlayerStats = (seasonId) =>
  synergy(`statistics/for/person/in/seasons/${seasonId}`, { limit: '1000', include: 'persons,entities' }, { save: false });

bigv.getGame = async (fixtureId) => {
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
};

// ---------- NBL1 ----------

const nbl1Memo = new Map();
const NBL1_MEMO_MS = 5 * 60 * 1000;

function rosetta(path) {
  const hit = nbl1Memo.get(path);
  if (hit && Date.now() - hit.at < NBL1_MEMO_MS) return hit.promise;
  const promise = fetch(`/nbl1-api/${path}`)
    .then(async (res) => {
      if (!res.ok) {
        // 404 here means the page was opened without the app's local server (e.g. a static host).
        throw new Error(res.status === 404 ? 'NBL1 needs the VBL Stats app (its local server) running.' : `NBL1 data error ${res.status}`);
      }
      return (await res.json()).data ?? [];
    })
    .catch((err) => { nbl1Memo.delete(path); throw err; });
  nbl1Memo.set(path, { at: Date.now(), promise });
  return promise;
}

// The app only passes season ids around; rosetta needs the year + conference to fetch a season.
const nbl1Seasons = new Map();
function nbl1Season(seasonId) {
  const s = nbl1Seasons.get(seasonId);
  if (!s) throw new Error('Unknown NBL1 season: pick it again from the season list.');
  return s;
}

const nbl1 = {};

nbl1.getSeasons = async (competitionId) => {
  const comp = NBL1_COMPETITIONS.find((c) => c.id === competitionId);
  const seasons = seasonsFor(await rosetta('nbl1/seasons'), comp);
  for (const s of seasons) nbl1Seasons.set(s.seasonId, { ...s, comp });
  return { data: seasons, includes: {} };
};

nbl1.getSeasonFixtures = async (seasonId) => {
  const s = nbl1Season(seasonId);
  const matches = await rosetta(`nbl1/matches/in/season/${s.year}/regular/${s.conf}`);
  const fx = fixturesFromMatches(matches, seasonId);
  return { ...fx, data: cleanFixtures(fx.data) };
};

nbl1.getStandings = async (seasonId) => {
  const s = nbl1Season(seasonId);
  return standingsFor(await rosetta(`nbl1/standings/${s.year}/regular?limit=200`), s, s.comp);
};

nbl1.getGame = async (fixtureId) => {
  const [match] = await rosetta(`match/${fixtureId}/live/all`);
  if (!match) throw new Error('Game not found');
  return gameFromMatch(match);
};

// NBL1 has no full season-stats endpoint, so season stats are added up from every finished game's box score.
// The local server keeps finished games on disk, so only the first time is slow.
let onTotalsProgress = null;
export function setTotalsProgress(fn) { onTotalsProgress = fn; }

// Totals are rebuilt after NBL1_MEMO_MS so newly finished games get counted (rebuilding is quick:
// finished games come from the local server's disk cache). Incomplete totals are never kept, so the
// next visit retries the games that failed.
const totalsMemo = new Map();

async function loadGames(fixtureIds, onDone) {
  const games = [];
  const failed = [];
  let next = 0;
  // NBL1 takes 2-4 s per uncached game; 10 at a time makes a first full season ~1 min, still gentle on their API.
  const worker = async () => {
    while (next < fixtureIds.length) {
      const id = fixtureIds[next++];
      try { games.push(await nbl1.getGame(id)); } catch { failed.push(id); }
      onDone?.();
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));
  return { games, failed };
}

function nbl1Totals(seasonId) {
  const hit = totalsMemo.get(seasonId);
  if (hit && Date.now() - hit.at < NBL1_MEMO_MS) return hit.promise;

  const promise = (async () => {
    const fixtures = await nbl1.getSeasonFixtures(seasonId);
    const done = fixtures.data.filter((f) => f.status === 'CONFIRMED').map((f) => f.fixtureId);
    let finished = 0;
    const first = await loadGames(done, () => onTotalsProgress?.(++finished, done.length));
    // One retry for games that failed (usually a momentary hiccup upstream).
    const retry = first.failed.length ? await loadGames(first.failed) : { games: [], failed: [] };
    const totals = seasonTotals([...first.games, ...retry.games]);
    const incomplete = retry.failed.length ? { missing: retry.failed.length, total: done.length } : null;
    if (incomplete) forget();
    return {
      players: { ...totals.players, incomplete },
      teams: { ...totals.teams, incomplete },
    };
  })().catch((err) => { forget(); throw err; });
  // Only drop our own entry: a newer rebuild may have replaced it in the meantime.
  const forget = () => { if (totalsMemo.get(seasonId)?.promise === promise) totalsMemo.delete(seasonId); };
  totalsMemo.set(seasonId, { at: Date.now(), promise });
  return promise;
}

nbl1.getSeasonPlayerStats = async (seasonId) => (await nbl1Totals(seasonId)).players;
nbl1.getTeamSeasonStats = async (seasonId) => (await nbl1Totals(seasonId)).teams;

// ---------- Public interface ----------

export const LEAGUES = { bigv: 'Big V', nbl1: 'NBL1' };
let league = 'bigv';
const sources = { bigv, nbl1 };
export function setLeague(l) { league = sources[l] ? l : 'bigv'; }
export const getLeague = () => league;

export const getSeasons = (...a) => sources[league].getSeasons(...a);
export const getSeasonFixtures = (...a) => sources[league].getSeasonFixtures(...a);
export const getStandings = (...a) => sources[league].getStandings(...a);
export const getTeamSeasonStats = (...a) => sources[league].getTeamSeasonStats(...a);
export const getSeasonPlayerStats = (...a) => sources[league].getSeasonPlayerStats(...a);
export const getGame = (...a) => sources[league].getGame(...a);
