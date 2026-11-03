// Scout report logic, on real CM 2026 data (same fixtures as stats.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ladderRows, playerSeasonRows } from '../src/stats.js';
import {
  playerFouls, teamComparison, rankOf, ordinal, teamList, meetings, recentGames, closeGames,
  teamLeaders, matchupBreakdown, refereeNotes, upcomingGames, currentStreak,
} from '../src/scout.js';

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url)));
const season = load('season');
const teamStats = load('team-season-stats').data;
const standings = load('standings');
const ps = load('season-player-stats');
const players = playerSeasonRows(ps.data, ps.includes);
const ladder = ladderRows(standings.data, standings.includes);
const game = { fixture: load('fixture'), people: load('people'), teams: load('teams'), periods: load('periods') };
const MU = 'e6c2e026-775e-11eb-abab-0a8204c5dd46';
const CAM = 'e66db056-775e-11eb-abab-0a8204c5dd46';
const byName = (name) => ladder.find((r) => r.name === name).id;

test('ordinal and rank helpers', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  assert.equal(rankOf([5, 9, 7], 7), 2);
  assert.equal(rankOf([5, 9, 7], 7, true), 2);
  assert.equal(rankOf([5, 9, 9], 9), 1, 'ties share the better rank');
});

test('playerFouls excludes coach/bench technicals (matches summed player fouls)', () => {
  const sum = (id) => game.people.data.filter((p) => p.entityId === id).reduce((n, p) => n + (p.statistics?.foulsTotal ?? 0), 0);
  for (const t of game.teams.data) assert.equal(playerFouls(t.statistics), sum(t.entityId));
});

test('teamComparison: per-game values and league ranks', () => {
  // Team season stats include finals (the ladder doesn't), so check against the raw totals.
  const raw = Object.fromEntries(teamStats.map((t) => [t.entityId, t.statistics]));
  const cmp = teamComparison(teamStats, MU, CAM);
  const pts = cmp.find((m) => m.key === 'pts');
  assert.equal(pts.a, raw[MU].points / raw[MU].games);
  assert.equal(pts.teams, 11);
  const ppg = teamStats.map((t) => t.statistics.points / t.statistics.games);
  const best = teamStats[ppg.indexOf(Math.max(...ppg))].entityId;
  assert.equal(teamComparison(teamStats, best, MU).find((m) => m.key === 'pts').rankA, 1);
  // "Points allowed" ranks low-to-high.
  const opp = teamStats.map((t) => t.statistics.pointsAgainst / t.statistics.games);
  const stingiest = teamStats[opp.indexOf(Math.min(...opp))].entityId;
  assert.equal(teamComparison(teamStats, stingiest, MU).find((m) => m.key === 'opp').rankA, 1);
  const fg = cmp.find((m) => m.key === 'fgp');
  assert.equal(fg.a, (raw[MU].fieldGoalsMade / raw[MU].fieldGoalsAttempted) * 100);
});

test('team list, meetings, recent games, close games', () => {
  assert.equal(teamList(season.data, season.includes).length, 11);
  const m = meetings(season.data, season.includes, MU, CAM);
  assert.ok(m.played.length >= 2);
  assert.equal(m.played[0].id, '2b1652bd-9556-11f1-bfef-9b790063e63e', 'the final is the most recent meeting');
  assert.equal(m.next, null, 'season over');
  assert.deepEqual(upcomingGames(season.data, season.includes), []);

  const recent = recentGames(season.data, season.includes, CAM);
  assert.equal(recent.length, 5);
  assert.deepEqual([recent[0].opponent, recent[0].scoreFor, recent[0].scoreAgainst, recent[0].won], ['McKinnon', 86, 100, false]);
  assert.ok(recent[0].start > recent[1].start, 'newest first');

  const c = closeGames(season.data, CAM);
  assert.equal(c.played, ladder.find((r) => r.id === CAM).played + 2, 'regular season + 2 finals');
  assert.ok(c.close >= 0 && c.close <= c.played);
});

test('currentStreak counts finals too', () => {
  // Camberwell: won 5 to end the regular season, won the first final, lost the next.
  assert.deepEqual(currentStreak(season.data, season.includes, CAM), { won: false, n: 1 });
  assert.equal(currentStreak([], season.includes, CAM), null);
});

test('teamLeaders', () => {
  const cam = teamLeaders(players, CAM);
  assert.equal(cam.points[0].name, 'Jackson Meshanic');
  assert.equal(cam.points.length, 3);
  assert.ok(cam.rebounds[0].rpg >= cam.rebounds[1].rpg);
  assert.ok(cam.threes.every((r) => r.thmpg > 0));
  assert.ok(cam.discipline.every((r) => r.tech + r.unsp + r.dq > 0));
  const war = teamLeaders(players, byName('Warrandyte'));
  assert.equal(war.points[0].name, 'Lanyc Shuler');
});

test('matchupBreakdown: last meeting vs season averages', () => {
  const bd = matchupBreakdown(game, teamStats, players);
  const mu = bd[MU];
  const pts = mu.metrics.find((m) => m.key === 'pts');
  assert.equal(pts.game, 100);
  assert.equal(pts.delta.toFixed(2), (100 - pts.season).toFixed(2));
  const fouls = mu.metrics.find((m) => m.key === 'fouls');
  assert.equal(fouls.game, 28);
  const pom = mu.players.find((p) => p.name === 'Stefan Pomasan');
  assert.deepEqual([pom.pts, pom.fouls, pom.tech], [16, 5, 2]);
  assert.ok(pom.seasonPpg > 0);
  assert.equal(mu.players[0].name, 'Aaron Dolny', 'sorted by points');
});

test('refereeNotes', () => {
  const a = { id: MU, name: 'Melbourne University' };
  const b = { id: CAM, name: 'Camberwell' };
  const notes = refereeNotes({
    a, b,
    comparison: teamComparison(teamStats, MU, CAM),
    close: { [MU]: closeGames(season.data, MU), [CAM]: closeGames(season.data, CAM) },
    streaks: { [MU]: { won: true, n: 3 }, [CAM]: currentStreak(season.data, season.includes, CAM) },
    lastMeeting: meetings(season.data, season.includes, MU, CAM).played[0],
    lastGame: game,
    leadersA: teamLeaders(players, MU),
    leadersB: teamLeaders(players, CAM),
  });
  const text = notes.map((n) => n.text).join('\n');
  assert.match(text, /Melbourne University commit \d+\.\d fouls a game \(\d+(st|nd|rd|th) of 11\)/);
  assert.match(text, /Camberwell commit/);
  assert.match(text, /Last meeting: Melbourne University 100–111 Camberwell, with 28 and 13 fouls/);
  assert.match(text, /Finished with 5\+ fouls: .*Stefan Pomasan/);
  assert.match(text, /Melbourne University have won their last 3 games/);
  assert.doesNotMatch(text, /Camberwell have (won|lost)/, 'Camberwell lost their last game after a win: no streak');
});

test('referee note never invents "0.0 fouls drawn" when fouls drawn is not recorded (NBL1)', () => {
  const a = { id: 'A', name: 'Team A' };
  const b = { id: 'B', name: 'Team B' };
  const stats = (fta) => ({ games: 10, freeThrowsAttempted: fta, points: 900, pointsAgainst: 900 });
  // 6 teams so ranks count; A shoots the most free throws. No foulsDrawn anywhere (NBL1).
  const league = ['A', 'B', 'C', 'D', 'E', 'F'].map((id, i) => ({ entityId: id, statistics: stats(300 - i * 20) }));
  const notes = refereeNotes({ a, b, comparison: teamComparison(league, 'A', 'B') }).map((n) => n.text).join('\n');
  assert.match(notes, /Team A attack contact: they shoot 30\.0 free throws a game \(1st for FTA\)/);
  assert.doesNotMatch(notes, /draw 0\.0 fouls/);
});
