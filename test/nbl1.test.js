// NBL1 adapter: rosetta responses (saved, trimmed) -> the Synergy shapes the rest of the app uses.
// Game: Hobart Chargers 67–99 Nunawading Spectres, NBL1 South Women round 1, 27 Mar 2026 6pm AEDT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NBL1_COMPETITIONS, utcToLocal, seasonsFor, fixturesFromMatches, standingsFor, gameFromMatch, seasonTotals,
} from '../src/nbl1.js';
import {
  summariseFixture, roundsFromSeason, gamesInRound, ladderRows, boxScore, periodScores, playerSeasonRows, sortRows, cleanFixtures,
} from '../src/stats.js';
import { teamComparison, teamLeaders, matchupBreakdown, refereeNotes, closeGames, currentStreak } from '../src/scout.js';

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url))).data;
const southWomen = NBL1_COMPETITIONS.find((c) => c.id === 'south-women');
const seasons = seasonsFor(load('nbl1-seasons'), southWomen);
const sw2026 = seasons.find((s) => s.year === '2026');
const matches = load('nbl1-matches-south-2026');
const match = load('nbl1-match')[0];
const HOB = 'ded43d10-7b55-11eb-9e56-8205bb8987e9';

test('utcToLocal converts to the venue time zone (DST-aware)', () => {
  assert.equal(utcToLocal('2026-03-27T07:00:00', 'Australia/Tasmania'), '2026-03-27T18:00:00'); // AEDT +11
  assert.equal(utcToLocal('2026-07-25T08:30:00', 'Australia/Melbourne'), '2026-07-25T18:30:00'); // AEST +10
  assert.equal(utcToLocal('2026-07-25T08:30:00', 'Australia/Adelaide'), '2026-07-25T18:00:00'); // ACST +9:30
});

test('seasons: one per year for the division, newest is active', () => {
  assert.deepEqual(seasons.map((s) => s.nameLocal).sort(), ['2025 South Women', '2026 South Women']);
  assert.equal(sw2026.status, 'ACTIVE');
  assert.equal(seasons.find((s) => s.year === '2025').status, 'COMPLETE');
  assert.equal(sw2026.conf, 'south');
  const finals = seasonsFor(load('nbl1-seasons'), NBL1_COMPETITIONS.find((c) => c.id === 'finals-men'));
  assert.ok(finals.some((s) => s.nameLocal === "2026 Men's National Finals"));
});

test('fixtures: only this season (South Women, not Men), finals grouped', () => {
  const fx = fixturesFromMatches(matches, sw2026.seasonId);
  assert.equal(fx.data.length, 218, '209 regular + 9 finals');
  assert.equal(cleanFixtures(fx.data).length, 218);
  const rounds = roundsFromSeason(fx.data);
  assert.equal(rounds.at(-1), 'finals');
  assert.equal(rounds[0], '1');
  assert.equal(gamesInRound(fx.data, fx.includes, 'finals').length, 9);

  const g = summariseFixture(fx.data.find((f) => f.fixtureId === match.id), fx.includes);
  assert.deepEqual(g.teams.map((t) => [t.name, t.score, t.short]), [['Hobart Chargers', 67, 'HOB'], ['Nunawading Spectres', 99, 'NUN']]);
  assert.equal(g.start, '2026-03-27T18:00:00');
  assert.equal(g.state, 'final');
  assert.equal(g.venue, 'Hutchins School');
  assert.equal(g.round, '1');
  assert.ok(g.teams[0].logo.startsWith('https://'));
});

test('ladder', () => {
  const st = standingsFor(load('nbl1-standings-2026'), sw2026, southWomen);
  const rows = ladderRows(st.data, st.includes);
  assert.ok(rows.length >= 10);
  assert.deepEqual(rows.map((r) => r.position), rows.map((_, i) => i + 1));
  const top = rows[0];
  assert.equal(top.wins + top.losses, top.played);
  assert.equal(top.lastFive.length, 5);
  assert.ok(rows.every((r) => r.name !== 'Unknown'));
  assert.ok(!rows.some((r) => r.name === 'TBC'), 'placeholder teams dropped');
  const menComp = NBL1_COMPETITIONS.find((c) => c.id === 'south-men');
  const sm2026 = seasonsFor(load('nbl1-seasons'), menComp).find((s) => s.year === '2026');
  const men = ladderRows(standingsFor(load('nbl1-standings-2026'), sm2026, menComp).data, {});
  const menTeams = new Set(fixturesFromMatches(matches, sm2026.seasonId).data.flatMap((f) => f.competitors.map((c) => c.entityId)));
  assert.equal(men.length, menTeams.size, 'ladder has exactly the teams that play');
});

test('game: box score adds up (players = team totals, quarters = final score)', () => {
  const game = gameFromMatch(match);
  const hob = game.teams.data.find((t) => t.entityId === HOB).statistics;
  const players = game.people.data.filter((p) => p.entityId === HOB && p.participated);
  const sum = (k) => players.reduce((n, p) => n + (p.statistics[k] ?? 0), 0);
  assert.equal(hob.points, 67);
  assert.equal(sum('points'), 67);
  assert.equal(sum('foulsTotal'), hob.foulsTotal);
  assert.equal(sum('fieldGoalsMade'), hob.fieldGoalsMade);
  assert.equal(hob.pointsAgainst, 99);
  assert.deepEqual(periodScores(game.periods.data)[HOB], [17, 12, 19, 19]);

  const box = boxScore(HOB, game.people.data, game.people.includes, game.teams.data.find((t) => t.entityId === HOB));
  const broomhall = box.players.find((p) => p.name === 'Chloe Broomhall');
  assert.equal(broomhall.bib, '11');
  assert.equal(broomhall.starter, true);
  assert.deepEqual(broomhall.cells.slice(0, 2), ['33:53', 14]);
  assert.equal(box.team, null, 'NBL1 has no Team/Coach row');
  assert.equal(box.totals[1], 67);
  assert.ok(box.players.some((p) => p.dnp && p.name === 'Isobel Geard'));
  assert.equal(game.fixture.includes.resources.seasons[match.season.id].nameLocal, '2026 South Women');
});

test('season totals from box scores feed the stats page and scout', () => {
  // Two copies of the same game stands in for "a season": totals double, averages stay put.
  const game = gameFromMatch(match);
  const totals = seasonTotals([game, game]);
  const rows = playerSeasonRows(totals.players.data, totals.players.includes);
  const b = rows.find((r) => r.name === 'Chloe Broomhall');
  assert.deepEqual([b.gp, b.gs, b.ppg, b.rpg, b.fgm, b.minIso, b.fd], [2, 2, 14, 11, 12, 'PT33M53S', null]);
  assert.equal(sortRows(rows, 'ppg')[0].team, 'Nunawading Spectres');
  assert.ok(!rows.some((r) => r.name === 'Isobel Geard'), 'DNP players have no season row');

  const team = totals.teams.data.find((t) => t.entityId === HOB).statistics;
  assert.deepEqual([team.games, team.points, team.pointsAgainst], [2, 134, 198]);

  const NUN = game.teams.data.find((t) => t.entityId !== HOB).entityId;
  const cmp = teamComparison(totals.teams.data, HOB, NUN);
  assert.equal(cmp.find((m) => m.key === 'pts').a, 67);
  assert.equal(cmp.find((m) => m.key === 'opp').a, 99);
  assert.equal(cmp.find((m) => m.key === 'fd').a, null, 'fouls drawn not recorded in NBL1');
  assert.equal(cmp.find((m) => m.key === 'unsp').a, null);

  const leaders = teamLeaders(rows, HOB);
  assert.equal(leaders.drawn.length, 0);
  assert.ok(leaders.points.length > 0);
  const bd = matchupBreakdown(game, totals.teams.data, rows);
  assert.equal(bd[HOB].metrics.find((m) => m.key === 'pts').delta, 0);

  const fx = fixturesFromMatches(matches, sw2026.seasonId);
  const notes = refereeNotes({
    a: { id: HOB, name: 'Hobart Chargers' }, b: { id: NUN, name: 'Nunawading Spectres' }, comparison: cmp,
    close: { [HOB]: closeGames(fx.data, HOB), [NUN]: closeGames(fx.data, NUN) },
    streaks: { [HOB]: currentStreak(fx.data, fx.includes, HOB), [NUN]: currentStreak(fx.data, fx.includes, NUN) },
    lastMeeting: summariseFixture(fx.data.find((f) => f.fixtureId === match.id), fx.includes),
    lastGame: game, leadersA: leaders, leadersB: teamLeaders(rows, NUN),
  });
  assert.match(notes.map((n) => n.text).join('\n'), /Last meeting: Hobart Chargers 67–99 Nunawading Spectres, with 15 and 17 fouls/);
});

test('overtime: NBL1 period 11 becomes OT straight after Q4', () => {
  // Eltham Wildcats 91–89 Nunawading Spectres (South Men preliminary final, one overtime).
  const game = gameFromMatch(load('nbl1-match-overtime')[0]);
  const q = periodScores(game.periods.data);
  const eltham = game.teams.data.find((t) => t.statistics.points === 91).entityId;
  assert.deepEqual(q[eltham], [25, 24, 23, 11, 8]);
  assert.equal(Math.max(...Object.values(q).map((p) => p.length)), 5, 'no empty OT columns');
  assert.equal(q[eltham].reduce((a, b) => a + b, 0), 91);
});

test('NBL1 fixtures keep an absolute UTC start for cross-time-zone comparisons', () => {
  const fx = fixturesFromMatches(matches, sw2026.seasonId);
  const f = fx.data.find((x) => x.fixtureId === match.id);
  assert.equal(f.startTimeUTC, '2026-03-27T07:00:00');
  assert.equal(f.startTimeLocal, '2026-03-27T18:00:00');
});
