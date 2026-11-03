// Expected values are copied from the official BV watch-game box score for this fixture
// (Melbourne University 100 – 111 Camberwell, 2026 CM final), so these tests catch mapping mistakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatMinutes, pct, summariseFixture, finalsFromSeason, pickCurrentSeason, periodScores, boxScore, COLUMNS,
} from '../src/stats.js';

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url)));
const fixture = load('fixture');
const people = load('people');
const teams = load('teams');
const periods = load('periods');
const MU = 'e6c2e026-775e-11eb-abab-0a8204c5dd46';
const CAM = 'e66db056-775e-11eb-abab-0a8204c5dd46';
const col = (label) => COLUMNS.findIndex(([l]) => l === label);

test('formatMinutes', () => {
  assert.equal(formatMinutes('PT33M17S'), '33:17');
  assert.equal(formatMinutes('PT40M'), '40:00');
  assert.equal(formatMinutes('PT0M22S'), '00:22');
  assert.equal(formatMinutes('PT200M'), '200:00');
  assert.equal(formatMinutes(null), '');
});

test('pct', () => {
  assert.equal(pct(5, 14), '35.7');
  assert.equal(pct(1, 2), '50.0');
  assert.equal(pct(0, 0), '–');
});

test('scoreboard: home team first, scores, venue, final', () => {
  const g = summariseFixture(fixture.data[0], fixture.includes);
  assert.deepEqual(g.teams.map((t) => [t.name, t.score]), [['Melbourne University', 100], ['Camberwell', 111]]);
  assert.equal(g.state, 'final');
  assert.equal(g.venue, 'Melbourne University Sports Centre');
  assert.equal(g.season, '2026 Championship Men');
  assert.ok(g.teams[0].logo.startsWith('https://'));
});

test('quarter scores', () => {
  const q = periodScores(periods.data);
  assert.deepEqual(q[MU], [23, 18, 27, 32]);
  assert.deepEqual(q[CAM], [23, 29, 29, 30]);
});

test('player row matches the official box score', () => {
  const box = boxScore(MU, people.data, people.includes, teams.data.find((t) => t.entityId === MU));
  const pom = box.players.find((p) => p.name === 'Stefan Pomasan');
  // # | MIN | PTS | FGM FGA FG% | 2PM 2PA 2P% | 3PM 3PA 3P% | FTM FTA FT% | OR DR REB | AST STL BLK TO PF | +/- | EFF
  assert.equal(pom.bib, '10');
  assert.equal(pom.starter, true);
  assert.deepEqual(pom.cells, ['33:17', 16, 5, 14, '35.7', 0, 2, '0.0', 5, 12, '41.7', 1, 2, '50.0', 0, 1, 1, 8, 2, 1, 2, 5, -9, 16]);
});

test('starters listed first, DNPs flagged', () => {
  const box = boxScore(MU, people.data, people.includes, teams.data.find((t) => t.entityId === MU));
  assert.deepEqual(box.players.slice(0, 5).map((p) => p.starter), [true, true, true, true, true]);
  assert.deepEqual(box.players.slice(0, 3).map((p) => p.name), ['Lukas Kafritsas', 'Aaron Dolny', 'Stefan Pomasan']);
  const dnp = box.players.filter((p) => p.dnp).map((p) => p.name).sort();
  assert.deepEqual(dnp, ['James Avgerinos', 'Matthew Foster Jnr']);
});

test('team/coach and totals rows', () => {
  const box = boxScore(MU, people.data, people.includes, teams.data.find((t) => t.entityId === MU));
  assert.equal(box.team[col('OR')], 3);
  assert.equal(box.team[col('DR')], 1);
  assert.equal(box.team[col('REB')], 4);
  assert.equal(box.team[col('PF')], 0);
  assert.deepEqual(box.totals, ['200:00', 100, 40, 93, '43.0', 28, 52, '53.8', 12, 41, '29.3', 8, 11, '72.7', 17, 29, 46, 26, 6, 3, 10, 28, '', 115]);
});

test('finals list for the season', () => {
  const season = load('season');
  const finals = finalsFromSeason(season.data, season.includes);
  assert.equal(finals.length, 5);
  assert.ok(finals.every((f) => f.type === 'FINAL'));
  assert.ok(finals.every((f) => f.teams.every((t) => t.name !== 'TBA')), 'team names resolved');
  assert.ok(finals[0].start >= finals.at(-1).start, 'newest first');
  assert.ok(finals.some((f) => f.id === fixture.data[0].fixtureId));
});

test('pickCurrentSeason prefers the active season', () => {
  const s = pickCurrentSeason(load('seasons').data);
  assert.equal(s.nameLocal, '2026 Championship Men');
  assert.equal(pickCurrentSeason([{ status: 'COMPLETE', startDate: '2024' }, { status: 'COMPLETE', startDate: '2025' }]).startDate, '2025');
});

// Ladder + player stats expectations copied from basketballvictoria.com.au/bigv/ladder and /bigv/statistics
// for Championship Men 2026.
import { ladderRows, nextOpponents, playerSeasonRows, sortRows, PLAYER_COLUMNS } from '../src/stats.js';

test('ladder matches the official one', () => {
  const s = load('standings');
  const rows = ladderRows(s.data, s.includes);
  assert.equal(rows.length, 11);
  assert.deepEqual(rows.map((r) => r.name).slice(0, 3), ['Hume City', 'McKinnon', 'Melbourne University']);
  const hume = rows[0];
  assert.deepEqual(
    [hume.position, hume.played, hume.wins, hume.losses, hume.winPct, hume.pointsFor, hume.pointsAgainst, hume.pct.toFixed(2), hume.lastFive],
    [1, 20, 15, 5, 75, 1950, 1741, '112.00', 'LWWLL'],
  );
  assert.equal(rows.at(-1).name, 'Wyndham');
});

test('nextOpponents only looks at games not yet played', () => {
  const season = load('season');
  assert.deepEqual(nextOpponents(season.data, season.includes), {}, 'season is over');
  const fake = structuredClone(season.data.find((f) => f.fixtureType === 'FINAL'));
  fake.status = 'SCHEDULED';
  const next = nextOpponents([fake], season.includes);
  assert.equal(Object.keys(next).length, 2);
  assert.ok(Object.values(next).every((n) => n !== 'TBA'));
});

test('player season stats match the official table', () => {
  const p = load('season-player-stats');
  const rows = playerSeasonRows(p.data, p.includes);
  assert.equal(rows.length, 172);
  const top = sortRows(rows, 'ppg', 'desc')[0];
  assert.equal(top.name, 'Lanyc Shuler');
  assert.equal(top.team, 'Warrandyte');
  const cell = (label) => {
    const c = PLAYER_COLUMNS.find((x) => x.label === label);
    return c.fmt ? c.fmt(top) : top[c.key];
  };
  assert.deepEqual(
    ['GP', 'GS', 'MIN', 'PPG', 'APG', 'FGM', 'FGA', 'FG%', 'FPG', 'FD', 'RPG'].map(cell),
    [20, 20, '36:40', '29.0', '7.1', 218, 396, '55.1', '1.9', 111, '5.1'],
  );
});

test('players with no 3-point attempts show a dash and sort last on 3P%', () => {
  const p = load('season-player-stats');
  const rows = playerSeasonRows(p.data, p.includes);
  const stanley = rows.find((r) => r.name === 'Oliver Stanley');
  assert.equal(PLAYER_COLUMNS.find((c) => c.label === '3P%').fmt(stanley), '–');
  const sorted = sortRows(rows, 'thp', 'desc');
  assert.ok(sorted.indexOf(stanley) > sorted.findIndex((r) => r.thp === 0), 'below players who shot 0%');
});

test('sortRows: ascending, and name tie-break', () => {
  const rows = [{ name: 'B', x: 1 }, { name: 'A', x: 1 }, { name: 'C', x: 0 }];
  assert.deepEqual(sortRows(rows, 'x', 'asc').map((r) => r.name), ['C', 'A', 'B']);
  assert.deepEqual(sortRows(rows, 'x', 'desc').map((r) => r.name), ['A', 'B', 'C']);
});
