// Scout report: everything a referee wants to know before a game between two teams.
// Pure functions over Synergy data (no DOM, no fetch), so the whole report can be built and tested in Node.
import { lookup, entityLogo, gameState, summariseFixture } from './stats.js';

const per = (total, games) => (games ? (total ?? 0) / games : 0);
const ratio = (made, att) => (att ? (made / att) * 100 : null);

// Player fouls only: the team total also counts coach and bench technicals.
export const playerFouls = (s) => (s.foulsTotal ?? 0) - (s.foulsCoachTechnical ?? 0)
  - (s.foulsBenchTechnical ?? 0) - (s.foulsCoachDisqualifying ?? 0);

export const teamTechs = (s) => (s.foulsTechnical ?? 0) + (s.foulsCoachTechnical ?? 0) + (s.foulsBenchTechnical ?? 0);

// get(stats, games) works for a season (games = s.games) and for one game (games = 1), so the same
// list drives both the season comparison and "last meeting vs season average".
// low: true means a lower number ranks first (e.g. points allowed).
export const TEAM_METRICS = [
  { key: 'pts', label: 'Points', get: (s, g) => per(s.points, g) },
  { key: 'opp', label: 'Points allowed', get: (s, g) => per(s.pointsAgainst, g), low: true },
  { key: 'fgp', label: 'FG%', get: (s) => ratio(s.fieldGoalsMade, s.fieldGoalsAttempted), pct: true },
  { key: 'thm', label: '3PM', get: (s, g) => per(s.pointsThreeMade, g) },
  { key: 'tha', label: '3PA', get: (s, g) => per(s.pointsThreeAttempted, g) },
  { key: 'thp', label: '3P%', get: (s) => ratio(s.pointsThreeMade, s.pointsThreeAttempted), pct: true },
  { key: 'fta', label: 'FTA', get: (s, g) => per(s.freeThrowsAttempted, g) },
  { key: 'ftp', label: 'FT%', get: (s) => ratio(s.freeThrowsMade, s.freeThrowsAttempted), pct: true },
  { key: 'reb', label: 'Rebounds', get: (s, g) => per(s.rebounds, g) },
  { key: 'oreb', label: 'Off. rebounds', get: (s, g) => per(s.reboundsOffensive, g) },
  { key: 'ast', label: 'Assists', get: (s, g) => per(s.assists, g) },
  { key: 'tov', label: 'Turnovers', get: (s, g) => per(s.turnovers, g), low: true },
  { key: 'stl', label: 'Steals', get: (s, g) => per(s.steals, g) },
  { key: 'blk', label: 'Blocks', get: (s, g) => per(s.blocks, g) },
  { key: 'fouls', label: 'Fouls committed', get: (s, g) => per(playerFouls(s), g), ref: true },
  { key: 'fd', label: 'Fouls drawn', get: (s, g) => per(s.foulsDrawn, g), ref: true },
  { key: 'tech', label: 'Technicals', get: (s, g) => per(teamTechs(s), g), ref: true },
  { key: 'unsp', label: 'Unsportsmanlike', get: (s, g) => per(s.foulsUnsportsmanlike, g), ref: true },
];

// 1-based rank of `value` within `values`; ties share the better rank.
export function rankOf(values, value, low = false) {
  return values.filter((v) => v !== null && (low ? v < value : v > value)).length + 1;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// Season comparison table: each metric for both teams, with league rank (1 = most, or fewest for `low`).
export function teamComparison(teamSeasonStats, idA, idB) {
  const byId = Object.fromEntries(teamSeasonStats.map((t) => [t.entityId, t.statistics ?? {}]));
  const a = byId[idA];
  const b = byId[idB];
  if (!a || !b) return [];
  return TEAM_METRICS.map((m) => {
    const all = teamSeasonStats.map((t) => m.get(t.statistics ?? {}, t.statistics?.games));
    const va = m.get(a, a.games);
    const vb = m.get(b, b.games);
    return {
      ...m,
      a: va,
      b: vb,
      rankA: va === null ? null : rankOf(all, va, m.low),
      rankB: vb === null ? null : rankOf(all, vb, m.low),
      teams: teamSeasonStats.length,
    };
  });
}

export function teamList(fixtures, includes) {
  const ids = new Set(fixtures.flatMap((f) => f.competitors.map((c) => c.entityId)));
  return [...ids]
    .map((id) => {
      const e = lookup(includes, 'entities', id);
      return { id, name: e?.nameFullLocal ?? 'Unknown', logo: entityLogo(e) };
    })
    .sort((x, y) => x.name.localeCompare(y.name));
}

const involves = (f, id) => f.competitors.some((c) => c.entityId === id);

// Finished games between the two teams (newest first) and their next scheduled meeting.
export function meetings(fixtures, includes, idA, idB) {
  const both = fixtures.filter((f) => involves(f, idA) && involves(f, idB));
  const played = both
    .filter((f) => gameState(f.status) === 'final')
    .sort((x, y) => y.startTimeLocal.localeCompare(x.startTimeLocal))
    .map((f) => summariseFixture(f, includes));
  const next = both
    .filter((f) => gameState(f.status) !== 'final')
    .sort((x, y) => x.startTimeLocal.localeCompare(y.startTimeLocal))[0];
  return { played, next: next ? summariseFixture(next, includes) : null };
}

// Upcoming games in the season, soonest first: quick picks for "who am I refereeing next".
export function upcomingGames(fixtures, includes, limit = 8) {
  return fixtures
    .filter((f) => gameState(f.status) !== 'final' && f.competitors.length === 2)
    .sort((x, y) => x.startTimeLocal.localeCompare(y.startTimeLocal))
    .slice(0, limit)
    .map((f) => summariseFixture(f, includes));
}

export function recentGames(fixtures, includes, teamId, n = 5) {
  return fixtures
    .filter((f) => involves(f, teamId) && gameState(f.status) === 'final')
    .sort((x, y) => y.startTimeLocal.localeCompare(x.startTimeLocal))
    .slice(0, n)
    .map((f) => {
      const me = f.competitors.find((c) => c.entityId === teamId);
      const them = f.competitors.find((c) => c.entityId !== teamId);
      const opp = lookup(includes, 'entities', them?.entityId);
      const scoreFor = Number(me.score);
      const scoreAgainst = Number(them?.score);
      return {
        id: f.fixtureId,
        start: f.startTimeLocal,
        home: me.isHome,
        opponent: opp?.nameFullLocal ?? 'TBA',
        opponentLogo: entityLogo(opp),
        scoreFor,
        scoreAgainst,
        won: scoreFor > scoreAgainst,
        final: f.fixtureType === 'FINAL',
      };
    });
}

// Current winning/losing run over every finished game, finals included (the ladder's form ignores finals).
export function currentStreak(fixtures, includes, teamId) {
  const games = recentGames(fixtures, includes, teamId, Infinity);
  if (!games.length) return null;
  const won = games[0].won;
  const n = games.findIndex((g) => g.won !== won);
  return { won, n: n === -1 ? games.length : n };
}

// How many of a team's finished games were decided by `margin` points or fewer.
export function closeGames(fixtures, teamId, margin = 5) {
  const games = fixtures.filter((f) => involves(f, teamId) && gameState(f.status) === 'final' && f.competitors.length === 2);
  const close = games.filter((f) => Math.abs(Number(f.competitors[0].score) - Number(f.competitors[1].score)) <= margin);
  return { close: close.length, played: games.length };
}

// Top players per category for one team. Players need a few games so a single big night doesn't top the list.
export const LEADER_CATEGORIES = [
  { key: 'points', title: 'Scoring', sort: 'ppg', cols: [['PPG', 'ppg']] },
  { key: 'rebounds', title: 'Rebounding', sort: 'rpg', cols: [['RPG', 'rpg'], ['OR', 'orpg']] },
  { key: 'assists', title: 'Assists', sort: 'apg', cols: [['APG', 'apg'], ['TO', 'tpg']] },
  { key: 'threes', title: 'Three-point shooting', sort: 'thmpg', cols: [['3PM', 'thmpg'], ['3PA', 'thapg'], ['3P%', 'thp', 'pct']] },
  { key: 'fouls', title: 'Fouls committed', sort: 'foulspg', cols: [['Fouls/g', 'foulspg'], ['Total', 'fouls', 'int'], ['Tech', 'tech', 'int']] },
  { key: 'drawn', title: 'Draws fouls', sort: 'fdpg', cols: [['FD/g', 'fdpg'], ['FTA/g', 'ftapg'], ['FT%', 'ftp', 'pct']] },
];

export function teamLeaders(playerRows, teamId, top = 3) {
  const mine = playerRows.filter((r) => r.teamId === teamId);
  const maxGp = Math.max(0, ...mine.map((r) => r.gp));
  const minGp = Math.min(3, maxGp);
  const eligible = mine.filter((r) => r.gp >= minGp);
  const out = {};
  for (const c of LEADER_CATEGORIES) {
    out[c.key] = [...eligible]
      .filter((r) => r[c.sort] > 0)
      .sort((x, y) => y[c.sort] - x[c.sort] || x.name.localeCompare(y.name))
      .slice(0, top);
  }
  // Discipline is about anyone who's been in trouble, regardless of games played.
  out.discipline = mine
    .filter((r) => r.tech + r.unsp + r.dq > 0)
    .sort((x, y) => (y.tech + y.unsp * 2 + y.dq * 3) - (x.tech + x.unsp * 2 + x.dq * 3) || x.name.localeCompare(y.name));
  return out;
}

// Last meeting: each team's numbers in that game next to its season averages, plus every player's line.
export function matchupBreakdown(game, teamSeasonStats, playerRows) {
  const seasonById = Object.fromEntries(teamSeasonStats.map((t) => [t.entityId, t.statistics ?? {}]));
  const out = {};
  for (const t of game.teams.data) {
    const s = t.statistics ?? {};
    const season = seasonById[t.entityId];
    const metrics = TEAM_METRICS.map((m) => {
      const g = m.get(s, 1);
      const avg = season ? m.get(season, season.games) : null;
      return { ...m, game: g, season: avg, delta: g !== null && avg !== null ? g - avg : null };
    });
    const players = game.people.data
      .filter((p) => p.entityId === t.entityId && p.isPlayer && p.participated)
      .map((p) => {
        const ps = p.statistics ?? {};
        const season = playerRows.find((r) => r.personId === p.personId && r.teamId === t.entityId);
        return {
          name: lookup(game.people.includes, 'persons', p.personId)?.nameFullLocal ?? 'Unknown',
          bib: p.bib ?? '',
          pts: ps.points ?? 0,
          reb: ps.rebounds ?? 0,
          ast: ps.assists ?? 0,
          fouls: ps.foulsTotal ?? 0,
          tech: ps.foulsTechnical ?? 0,
          unsp: ps.foulsUnsportsmanlike ?? 0,
          seasonPpg: season?.ppg ?? null,
          seasonRpg: season?.rpg ?? null,
          seasonApg: season?.apg ?? null,
          seasonFouls: season?.foulspg ?? null,
        };
      })
      .sort((x, y) => y.pts - x.pts || x.name.localeCompare(y.name));
    out[t.entityId] = { metrics, players };
  }
  return out;
}

// ---------- Referee notes ----------
// Plain-language observations generated from the numbers. Each rule only fires when it has something to say.

const n1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

export function refereeNotes({ a, b, comparison, close, streaks, lastMeeting, lastGame, leadersA, leadersB }) {
  const notes = [];
  const metric = (key) => comparison.find((m) => m.key === key);
  const teams = [[a, 'a', 'rankA', leadersA, close?.[a.id], streaks?.[a.id]], [b, 'b', 'rankB', leadersB, close?.[b.id], streaks?.[b.id]]];
  const top = (rank, total) => rank && total >= 6 && rank <= 3;
  const bottom = (rank, total) => rank && total >= 6 && rank >= total - 2;

  const fouls = metric('fouls');
  const fd = metric('fd');
  const fta = metric('fta');
  if (fouls) {
    for (const [t, side, rank] of teams) {
      const r = fouls[rank];
      let tag = '';
      if (top(r, fouls.teams)) tag = ': one of the most foul-prone teams';
      else if (bottom(r, fouls.teams)) tag = ': one of the cleanest teams';
      notes.push({ tone: top(r, fouls.teams) ? 'warn' : 'info', text: `${t.name} commit ${n1(fouls[side])} fouls a game (${ordinal(r)} of ${fouls.teams})${tag}.` });
    }
  }
  if (fd && fta) {
    for (const [t, side, rank] of teams) {
      if (top(fd[rank], fd.teams) || top(fta[rank], fta.teams)) {
        notes.push({ tone: 'info', text: `${t.name} attack contact: they draw ${n1(fd[side])} fouls and shoot ${n1(fta[side])} free throws a game (${ordinal(fta[rank])} for FTA).` });
      }
    }
  }
  const pts = metric('pts');
  if (pts) {
    const combined = pts.a + pts.b;
    notes.push({ tone: 'info', text: `They average ${n1(pts.a)} and ${n1(pts.b)} points: about ${Math.round(combined)} combined.` });
  }
  const tha = metric('tha');
  if (tha) {
    for (const [t, side, rank] of teams) {
      if (top(tha[rank], tha.teams)) notes.push({ tone: 'info', text: `${t.name} take a lot of threes (${n1(tha[side])} a game, ${ordinal(tha[rank])}): expect long rebounds and closeouts.` });
    }
  }
  for (const [t, , , leaders, cl, streak] of teams) {
    const flagged = leaders?.discipline ?? [];
    if (flagged.length) {
      const list = flagged.slice(0, 4).map((p) => {
        const bits = [p.tech && `${p.tech} tech`, p.unsp && `${p.unsp} unsportsmanlike`, p.dq && `${p.dq} DQ`].filter(Boolean).join(', ');
        return `${p.name} (${bits})`;
      }).join('; ');
      notes.push({ tone: 'warn', text: `${t.name} players with technical/unsportsmanlike fouls this season: ${list}.` });
    }
    if (cl && cl.played && cl.close / cl.played >= 0.3) {
      notes.push({ tone: 'info', text: `${cl.close} of ${t.name}'s ${cl.played} games were decided by 5 points or fewer.` });
    }
    if (streak && streak.n >= 3) {
      notes.push({ tone: 'info', text: `${t.name} have ${streak.won ? 'won' : 'lost'} their last ${streak.n} games.` });
    }
  }
  if (lastMeeting && lastGame) {
    const [h, w] = lastMeeting.teams;
    const tf = (id) => {
      const s = lastGame.teams.data.find((t) => t.entityId === id)?.statistics ?? {};
      return { fouls: playerFouls(s), techs: teamTechs(s), unsp: s.foulsUnsportsmanlike ?? 0 };
    };
    const fh = tf(h.id);
    const fw = tf(w.id);
    const extras = [];
    if (fh.techs + fw.techs) extras.push(`${fh.techs + fw.techs} technical${fh.techs + fw.techs > 1 ? 's' : ''}`);
    if (fh.unsp + fw.unsp) extras.push(`${fh.unsp + fw.unsp} unsportsmanlike`);
    const fouledOut = lastGame.people.data
      .filter((p) => (p.statistics?.foulsTotal ?? 0) >= 5)
      .map((p) => lookup(lastGame.people.includes, 'persons', p.personId)?.nameFullLocal)
      .filter(Boolean);
    notes.push({
      tone: extras.length || fouledOut.length ? 'warn' : 'info',
      text: `Last meeting: ${h.name} ${h.score}–${w.score} ${w.name}, with ${fh.fouls} and ${fw.fouls} fouls`
        + `${extras.length ? ` and ${extras.join(', ')}` : ''}${fouledOut.length ? `. Finished with 5+ fouls: ${fouledOut.join(', ')}` : ''}.`,
    });
  }
  return notes;
}
