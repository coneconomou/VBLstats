import {
  getSeasons, getSeasonFixtures, getGame, getStandings, getSeasonPlayerStats, getTeamSeasonStats,
  LEAGUES, setLeague, getLeague, setTotalsProgress,
} from './api.js';
import { NBL1_COMPETITIONS } from './nbl1.js';
import {
  summariseFixture, roundsFromSeason, gamesInRound, defaultRound, roundLabel, pickCurrentSeason, periodScores, boxScore, COLUMNS,
  nextOpponents, ladderRows, playerSeasonRows, sortRows, PLAYER_COLUMNS,
} from './stats.js';
import {
  teamList, meetings, upcomingGames, recentGames, closeGames, teamComparison, teamLeaders, LEADER_CATEGORIES,
  matchupBreakdown, refereeNotes, ordinal, currentStreak,
} from './scout.js';
import { markSvg } from './mark.js';

document.querySelector('.brand').insertAdjacentHTML('afterbegin', markSvg());

// Big V competitions in Synergy. IDs are stable across seasons; seasons are looked up live.
const BIGV_COMPETITIONS = [
  ['ee3cafaa-76a3-11eb-a481-2a86bfd2d24d', 'Championship Men'],
  ['ee4035f8-76a3-11eb-a481-2a86bfd2d24d', 'Championship Women'],
  ['ee43298e-76a3-11eb-a481-2a86bfd2d24d', 'Division One Men'],
  ['ee46747c-76a3-11eb-a481-2a86bfd2d24d', 'Division One Women'],
  ['ee4a0420-76a3-11eb-a481-2a86bfd2d24d', 'Division Two Men'],
  ['ee4d24e8-76a3-11eb-a481-2a86bfd2d24d', 'Division Two Women'],
  ['ee501d7e-76a3-11eb-a481-2a86bfd2d24d', 'Youth Championship Men'],
  ['ee53fe30-76a3-11eb-a481-2a86bfd2d24d', 'Youth Championship Women'],
  ['ee57fec2-76a3-11eb-a481-2a86bfd2d24d', 'Youth League One Men'],
  ['ee64436c-76a3-11eb-a481-2a86bfd2d24d', 'Youth League One Women'],
  ['ee615c24-76a3-11eb-a481-2a86bfd2d24d', 'Youth League Two Men'],
  ['ee6709f8-76a3-11eb-a481-2a86bfd2d24d', 'Youth League Two Women'],
  ['a5809a1b-b1d9-11ef-823f-656618bcf3f0', 'Youth League Three Men'],
];
const COMPETITIONS_BY_LEAGUE = {
  bigv: BIGV_COMPETITIONS,
  nbl1: NBL1_COMPETITIONS.map((c) => [c.id, c.name]),
};
const LEAGUE_KEY = 'vblstats.league';
// Big V keeps the original key so the saved choice from before leagues existed still applies.
const compKey = (league) => (league === 'bigv' ? 'vblstats.competition' : `vblstats.competition.${league}`);

const app = document.getElementById('app');
const compPicker = document.getElementById('competition');
const leaguePicker = document.getElementById('league');
const seasonPicker = document.getElementById('season');
const pickers = document.querySelector('.pickers');

const state = {
  seasonsFor: null, // competition id the season list was loaded for
  seasons: [],
  seasonId: null,
  statsTeam: 'all',
  statsSort: { key: 'ppg', dir: 'desc' },
};

// Every navigation bumps this; async renders check it so a slow old page can't overwrite a newer one.
let renderToken = 0;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function stored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode etc. */ }
}

function formatDate(local) {
  const d = new Date(local); // startTimeLocal has no zone, so the browser treats it as local time: what we want.
  return d.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function logo(team, cls) {
  return team.logo
    ? `<img class="${cls}" src="${esc(team.logo)}" alt="" loading="lazy">`
    : `<div class="${cls} logo-fallback">${esc(team.short || (team.name ?? '').slice(0, 3))}</div>`;
}

function status(game) {
  if (game.state === 'live') return '<span class="badge live">LIVE</span>';
  if (game.state === 'final') return '<span class="badge">FINAL</span>';
  return '';
}

function loading(text = 'Loading…') {
  app.innerHTML = `<p class="muted center loading-msg">${esc(text)}</p>`;
}

function showError(err) {
  app.innerHTML = `<div class="error"><p>Couldn't load stats.</p><p class="muted">${esc(err.message)}</p>
    <button onclick="location.reload()">Try again</button></div>`;
}

const staleNotice = (...results) => (results.some((r) => r?.stale)
  ? '<p class="notice">Stats service is busy, showing the last saved results.</p>' : '');

// NBL1 season totals are added up from box scores; say so when some games wouldn't load.
const incompleteNotice = (inc) => (inc
  ? `<p class="notice">${inc.missing} of ${inc.total} games couldn't be loaded from NBL1, so these season numbers leave them out. Reload the page to try again.</p>` : '');

const seasonName = () => state.seasons.find((s) => s.seasonId === state.seasonId)?.nameLocal ?? '';

// ---------- Competition + season ----------

// Returns false if a newer navigation started while the seasons were loading: that navigation owns the
// season picker now, so this one must not touch it (a slow response for an old competition used to
// overwrite the picker for the new one).
async function ensureSeasons(token) {
  const compId = compPicker.value;
  const key = `${getLeague()}:${compId}`;
  if (state.seasonsFor === key) return true;
  const { data } = await getSeasons(compId);
  if (token !== renderToken) return false;
  state.seasons = [...data].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
  state.seasonId = pickCurrentSeason(data)?.seasonId ?? null;
  state.seasonsFor = key;
  state.statsTeam = 'all';
  // "2026 Championship Men" -> "2026"; older seasons are named inconsistently, so fall back to the full name.
  seasonPicker.innerHTML = state.seasons
    .map((s) => `<option value="${esc(s.seasonId)}">${esc(/^\d{4}\b/.exec(s.nameLocal)?.[0] ?? s.nameLocal)}</option>`).join('');
  seasonPicker.value = state.seasonId ?? '';
  if (!state.seasonId) throw new Error('No seasons found for this competition');
  return true;
}

// ---------- Results ----------

// "YYYY-MM-DDTHH:mm:ss" in UTC, to compare with each game's absolute start time.
const nowUtc = () => new Date().toISOString().slice(0, 19);

async function renderResults(token, requestedRound) {
  const fixtures = await getSeasonFixtures(state.seasonId);
  if (token !== renderToken) return;
  const rounds = roundsFromSeason(fixtures.data);
  if (!rounds.length) {
    app.innerHTML = `<h2 class="section-title">${esc(seasonName())} · Results</h2><p class="muted center">No games scheduled yet.</p>`;
    return;
  }
  // A round from the URL that this season doesn't have (e.g. after switching season) falls back to the default.
  const round = rounds.includes(requestedRound) ? requestedRound : defaultRound(fixtures.data, nowUtc());
  const games = gamesInRound(fixtures.data, fixtures.includes, round);

  app.innerHTML = `
    ${staleNotice(fixtures)}
    <h2 class="section-title">${esc(seasonName())} · ${esc(roundLabel(round))}</h2>
    <nav class="rounds" aria-label="Round">
      ${rounds.map((r) => `<a href="#/results/${r}" class="${r === round ? 'active' : ''}">${r === 'finals' ? 'Finals' : esc(r)}</a>`).join('')}
    </nav>
    ${games.length ? `<div class="cards">${games.map(card).join('')}</div>`
      : '<p class="muted center">No games in this round.</p>'}`;
  // Centre the active round in the strip. Not scrollIntoView: that can also scroll the whole page sideways.
  const strip = app.querySelector('.rounds');
  const active = strip.querySelector('a.active');
  strip.scrollLeft = active.offsetLeft - strip.clientWidth / 2 + active.offsetWidth / 2;
}

function card(g) {
  const [a, b] = g.teams;
  const played = g.state !== 'upcoming';
  const row = (t, other) => `
    <div class="card-team ${played && t.score > other.score ? 'won' : ''}">
      ${logo(t, 'card-logo')}<span class="card-name">${esc(t.name)}</span>
      <span class="card-score">${played ? esc(t.score ?? '') : ''}</span>
    </div>`;
  return `
    <a class="card" href="#/game/${esc(g.id)}">
      ${row(a, b)}${row(b, a)}
      <div class="card-meta">${status(g)}<span>${esc(formatDate(g.start))}</span></div>
    </a>`;
}

// ---------- Ladder ----------

async function renderLadder(token) {
  const [standings, fixtures] = await Promise.all([
    getStandings(state.seasonId),
    // Only needed for the "Next" column, so a failure here shouldn't block the ladder.
    getSeasonFixtures(state.seasonId).catch(() => null),
  ]);
  if (token !== renderToken) return;
  const next = fixtures ? nextOpponents(fixtures.data, fixtures.includes) : {};
  const rows = ladderRows(standings.data, standings.includes, next);
  const showNext = rows.some((r) => r.next);
  const form = (s) => [...s].map((c) => `<span class="form ${c === 'W' ? 'w' : c === 'L' ? 'l' : ''}">${esc(c)}</span>`).join('');

  app.innerHTML = `
    ${staleNotice(standings)}
    <h2 class="section-title">${esc(seasonName())} · Ladder</h2>
    ${rows.length ? `
    <div class="table-wrap">
      <table class="data ladder">
        <thead><tr>
          <th class="num">#</th><th class="name">Team</th>
          <th title="Played">P</th><th title="Wins">W</th><th title="Losses">L</th><th title="Win percentage">Win%</th>
          <th title="Points for">PF</th><th title="Points against">PA</th><th title="Points for ÷ points against">%</th>
          <th class="left" title="Last five results, oldest to newest">Last 5</th>
          ${showNext ? '<th class="left">Next</th>' : ''}
        </tr></thead>
        <tbody>${rows.map((r) => `
          <tr>
            <td class="num">${esc(r.position)}</td>
            <td class="name"><span class="team-cell">${logo(r, 'tiny-logo')}${esc(r.name)}</span></td>
            <td>${r.played}</td><td class="strong">${r.wins}</td><td>${r.losses}</td>
            <td>${Math.round(r.winPct)}%</td>
            <td>${r.pointsFor}</td><td>${r.pointsAgainst}</td><td>${r.pct.toFixed(1)}%</td>
            <td class="left">${form(r.lastFive)}</td>
            ${showNext ? `<td class="left muted">${esc(r.next ?? '')}</td>` : ''}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '<p class="muted center">No ladder yet.</p>'}`;
}

// ---------- Player stats ----------

async function renderStats(token) {
  const res = await getSeasonPlayerStats(state.seasonId);
  if (token !== renderToken) return;
  const all = playerSeasonRows(res.data, res.includes);
  const teams = [...new Map(all.map((r) => [r.teamId, r.team])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  if (!teams.some(([id]) => id === state.statsTeam)) state.statsTeam = 'all';

  app.innerHTML = `
    ${incompleteNotice(res.incomplete)}
    <div class="page-head">
      <h2 class="section-title">${esc(seasonName())} · Player stats</h2>
      <select id="team-filter" aria-label="Team">
        <option value="all">All teams</option>
        ${teams.map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('')}
      </select>
    </div>
    <div id="stats-table"></div>`;

  const filter = document.getElementById('team-filter');
  filter.value = state.statsTeam;
  filter.addEventListener('change', () => { state.statsTeam = filter.value; drawStatsTable(all); });
  drawStatsTable(all);
}

function drawStatsTable(all) {
  // Columns a league doesn't record (NBL1: fouls drawn) are left out rather than shown as a row of dashes.
  const columns = PLAYER_COLUMNS.filter((c) => !c.optional || all.some((r) => r[c.key] !== null && r[c.key] !== undefined));
  const { key, dir } = state.statsSort;
  const rows = sortRows(state.statsTeam === 'all' ? all : all.filter((r) => r.teamId === state.statsTeam), key, dir);
  const arrow = (k) => (k === key ? (dir === 'desc' ? ' ↓' : ' ↑') : '');
  const target = document.getElementById('stats-table');
  if (!rows.length) { target.innerHTML = '<p class="muted center">No player stats yet.</p>'; return; }

  target.innerHTML = `
    <div class="table-wrap">
      <table class="data stats">
        <thead><tr>
          <th class="num">#</th>
          <th class="name sortable ${key === 'name' ? 'sorted' : ''}" data-key="name">Player${arrow('name')}</th>
          ${columns.map((c) => `<th class="sortable ${c.key === key ? 'sorted' : ''}" data-key="${c.key}" title="${esc(c.title)}">${esc(c.label)}${arrow(c.key)}</th>`).join('')}
        </tr></thead>
        <tbody>${rows.map((r, i) => `
          <tr>
            <td class="num">${i + 1}</td>
            <td class="name"><span class="team-cell">${logo(r, 'tiny-logo')}<span>${esc(r.name)}<span class="sub">${esc(r.team)}</span></span></span></td>
            ${columns.map((c) => `<td class="${c.key === key ? 'sorted' : ''}">${esc(c.fmt ? c.fmt(r) : r[c.key])}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  target.querySelectorAll('th.sortable').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.key;
    // First click on a stat sorts high-to-low (what you usually want); names start A-Z.
    state.statsSort = k === key
      ? { key: k, dir: dir === 'desc' ? 'asc' : 'desc' }
      : { key: k, dir: k === 'name' ? 'asc' : 'desc' };
    drawStatsTable(all);
  }));
}

// ---------- Game page ----------

async function renderGame(id, token) {
  const { fixture, people, teams, periods } = await getGame(id);
  if (token !== renderToken) return;
  const game = summariseFixture(fixture.data[0], fixture.includes);
  const quarters = periodScores(periods.data);
  const nPeriods = Math.max(0, ...Object.values(quarters).map((q) => q.length));
  const [home, away] = game.teams;

  const periodLabel = (i) => (i < 4 ? `Q${i + 1}` : `OT${i - 3 > 1 ? i - 3 : ''}`);
  const quarterTable = nPeriods ? `
    <table class="quarters">
      <tr><th></th>${Array.from({ length: nPeriods }, (_, i) => `<th>${periodLabel(i)}</th>`).join('')}</tr>
      ${[home, away].map((t) => `<tr><td>${esc(t.short || t.name)}</td>${Array.from({ length: nPeriods }, (_, i) => `<td>${quarters[t.id]?.[i] ?? ''}</td>`).join('')}</tr>`).join('')}
    </table>` : '';

  const won = (t, o) => (game.state === 'final' && t.score > o.score ? 'won' : '');
  app.innerHTML = `
    <a class="back" href="#/results/${esc(game.round)}">← ${esc(roundLabel(game.round))}</a>
    <section class="scoreboard">
      <p class="muted small">${esc(game.season || game.competition)} · ${esc(roundLabel(game.round))}</p>
      <div class="score-row">
        <div class="side home">${logo(home, 'big-logo')}<span class="team-name">${esc(home.name)}</span></div>
        <div class="score">
          <div class="digits"><span class="${won(home, away)}">${esc(home.score ?? '–')}</span><span class="dash">–</span><span class="${won(away, home)}">${esc(away.score ?? '–')}</span></div>
          ${status(game)}
        </div>
        <div class="side away">${logo(away, 'big-logo')}<span class="team-name">${esc(away.name)}</span></div>
      </div>
      ${quarterTable}
      <p class="muted small">${esc(game.venue)}<br>${esc(formatDate(game.start))}</p>
    </section>
    ${people.data.length
      ? [home, away].map((t) => teamBox(t, people, teams)).join('')
      : '<p class="muted center">No box score yet.</p>'}`;
}

function teamBox(team, people, teams) {
  const box = boxScore(team.id, people.data, people.includes, teams.data.find((t) => t.entityId === team.id));
  const head = `<tr><th class="num">#</th><th class="name">Player</th>${COLUMNS.map(([l, title]) => `<th title="${esc(title)}">${esc(l)}</th>`).join('')}</tr>`;
  const rows = box.players.map((p) => `
    <tr class="${p.starter ? 'starter' : ''} ${p.dnp ? 'dnp' : ''}">
      <td class="num">${esc(p.bib)}</td>
      <td class="name">${esc(p.name)}${p.starter ? '<span class="star" title="Starter">●</span>' : ''}</td>
      ${p.dnp ? `<td colspan="${COLUMNS.length}" class="dnp-cell">DNP</td>` : p.cells.map((c) => `<td>${esc(c)}</td>`).join('')}
    </tr>`).join('');
  const team_ = box.team ? `<tr class="team-row"><td class="num"></td><td class="name">Team/Coach</td>${box.team.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>` : '';
  const totals = box.totals
    ? `<tr class="totals"><td class="num"></td><td class="name">Total</td>${box.totals.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>` : '';
  return `
    <section class="box">
      <h3>${logo(team, 'tiny-logo')}${esc(team.name)}</h3>
      <div class="table-wrap"><table class="boxscore"><thead>${head}</thead><tbody>${rows}${team_}${totals}</tbody></table></div>
    </section>`;
}

// ---------- Scout ----------

const f1 = (v) => (v === null || v === undefined ? '–' : (Math.round(v * 10) / 10).toFixed(1));
const metricVal = (m, v) => (v === null || v === undefined ? '–' : f1(v));
// Counts from a single game read better as "100" than "100.0"; percentages keep their decimal.
const gameVal = (v) => (v === null || v === undefined ? '–' : Number.isInteger(v) ? String(v) : f1(v));

function formPills(s) {
  return [...(s ?? '')].map((c) => `<span class="form ${c === 'W' ? 'w' : c === 'L' ? 'l' : ''}">${esc(c)}</span>`).join('');
}

function shortDate(local) {
  return new Date(local).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

// Loads one season's worth of scouting data. Player stats are the big one; if they fail we still show the rest.
async function scoutSeasonData(seasonId) {
  const [fixtures, standings, teamStats, playerStats] = await Promise.all([
    getSeasonFixtures(seasonId),
    getStandings(seasonId).catch(() => null),
    getTeamSeasonStats(seasonId).catch(() => null),
    getSeasonPlayerStats(seasonId).catch(() => null),
  ]);
  return {
    fixtures,
    ladder: standings ? ladderRows(standings.data, standings.includes) : [],
    teamStats: teamStats?.data ?? [],
    players: playerStats ? playerSeasonRows(playerStats.data, playerStats.includes) : [],
    incomplete: playerStats?.incomplete ?? teamStats?.incomplete ?? null,
  };
}

async function renderScout(token, [idA, idB] = []) {
  const season = await scoutSeasonData(state.seasonId);
  if (token !== renderToken) return;
  const { fixtures } = season;
  const teams = teamList(fixtures.data, fixtures.includes);
  if (teams.length < 2) {
    app.innerHTML = `<h2 class="section-title">${esc(seasonName())} · Scout</h2><p class="muted center">Not enough teams in this season yet.</p>`;
    return;
  }
  const upcoming = upcomingGames(fixtures.data, fixtures.includes);
  const valid = (id) => teams.some((t) => t.id === id);
  if (!valid(idA) || !valid(idB) || idA === idB) {
    // Default to the next scheduled game, else the top two on the ladder.
    const pick = upcoming[0]?.teams.map((t) => t.id) ?? season.ladder.slice(0, 2).map((r) => r.id);
    [idA, idB] = pick.length === 2 ? pick : [teams[0].id, teams[1].id];
  }
  const a = teams.find((t) => t.id === idA);
  const b = teams.find((t) => t.id === idB);

  // Head-to-head: this season first; if they haven't met yet, the previous season.
  let h2h = meetings(fixtures.data, fixtures.includes, idA, idB);
  let h2hSeason = { ...season, id: state.seasonId, name: seasonName() };
  if (!h2h.played.length) {
    const idx = state.seasons.findIndex((s) => s.seasonId === state.seasonId);
    const prev = state.seasons[idx + 1];
    if (prev) {
      try {
        const prevData = await scoutSeasonData(prev.seasonId);
        const prevMeet = meetings(prevData.fixtures.data, prevData.fixtures.includes, idA, idB);
        if (prevMeet.played.length) {
          h2h = { played: prevMeet.played, next: h2h.next };
          h2hSeason = { ...prevData, id: prev.seasonId, name: prev.nameLocal };
        }
      } catch { /* no previous-season head-to-head, fine */ }
    }
  }
  const lastMeeting = h2h.played[0] ?? null;
  const lastGame = lastMeeting ? await getGame(lastMeeting.id).catch(() => null) : null;
  if (token !== renderToken) return;

  const ladderBy = Object.fromEntries(season.ladder.map((r) => [r.id, r]));
  const comparison = teamComparison(season.teamStats, idA, idB);
  const leadersA = teamLeaders(season.players, idA);
  const leadersB = teamLeaders(season.players, idB);
  const close = { [idA]: closeGames(fixtures.data, idA), [idB]: closeGames(fixtures.data, idB) };
  const streaks = { [idA]: currentStreak(fixtures.data, fixtures.includes, idA), [idB]: currentStreak(fixtures.data, fixtures.includes, idB) };
  const notes = refereeNotes({ a, b, comparison, close, streaks, lastMeeting, lastGame, leadersA, leadersB });
  const breakdown = lastGame ? matchupBreakdown(lastGame, h2hSeason.teamStats, h2hSeason.players) : null;

  const option = (t, sel) => `<option value="${esc(t.id)}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}</option>`;
  const teamHead = (t) => {
    const l = ladderBy[t.id];
    const form = recentGames(fixtures.data, fixtures.includes, t.id).map((g) => (g.won ? 'W' : 'L')).reverse().join('');
    return `
      <div class="scout-team">
        ${logo(t, 'scout-logo')}
        <div class="scout-team-name">${esc(t.name)}</div>
        ${l ? `<div class="muted small">${ordinal(l.position)} on ladder · ${l.wins}–${l.losses}</div>` : ''}
        ${form ? `<div title="Last 5 games incl. finals, oldest to newest">${formPills(form)}</div>` : ''}
      </div>`;
  };
  const nextInfo = h2h.next
    ? `<div class="small">Next meeting</div><div>${esc(formatDate(h2h.next.start))}</div><div class="muted small">${esc(h2h.next.venue)} · ${esc(roundLabel(h2h.next.round))}</div>`
    : '<div class="muted small">No upcoming game between these teams</div>';

  app.innerHTML = `
    ${staleNotice(fixtures)}
    ${incompleteNotice(season.incomplete)}
    <div class="page-head">
      <h2 class="section-title">${esc(seasonName())} · Scout</h2>
      <div class="scout-pickers">
        <select id="scout-a" aria-label="Team A">${teams.map((t) => option(t, idA)).join('')}</select>
        <span class="muted">vs</span>
        <select id="scout-b" aria-label="Team B">${teams.map((t) => option(t, idB)).join('')}</select>
      </div>
    </div>
    ${upcoming.length ? `
      <div class="quick-picks"><span class="muted small">Upcoming:</span>
        ${upcoming.map((g) => `<a href="#/scout/${esc(g.teams[0].id)}/${esc(g.teams[1].id)}">${esc(g.teams[0].short || g.teams[0].name)} v ${esc(g.teams[1].short || g.teams[1].name)} <span class="muted">${esc(shortDate(g.start))}</span></a>`).join('')}
      </div>` : ''}

    <section class="panel scout-head">
      ${teamHead(a)}
      <div class="scout-mid"><div class="vs">VS</div>${nextInfo}</div>
      ${teamHead(b)}
    </section>

    ${notes.length ? `
    <section class="panel">
      <h3>Referee notes</h3>
      <ul class="notes">${notes.map((n) => `<li class="${n.tone}">${esc(n.text)}</li>`).join('')}</ul>
    </section>` : ''}

    ${comparison.length ? `
    <section class="panel">
      <h3>Season averages <span class="muted small">per game incl. finals · small number = league rank</span></h3>
      <div class="table-wrap"><table class="data compare">
        <thead><tr><th class="left">Stat</th><th>${esc(a.name)}</th><th>${esc(b.name)}</th></tr></thead>
        <tbody>${comparison.map((m) => {
          const better = m.a === m.b || m.a === null || m.b === null ? 0 : (m.a > m.b ? 1 : -1);
          return `<tr class="${m.ref ? 'ref' : ''}">
            <td class="left">${esc(m.label)}${m.ref ? ' <span class="ref-dot" title="Referee-relevant">●</span>' : ''}</td>
            <td class="${better > 0 ? 'strong' : ''}">${metricVal(m, m.a)} <span class="rank">${m.rankA ? ordinal(m.rankA) : ''}</span></td>
            <td class="${better < 0 ? 'strong' : ''}">${metricVal(m, m.b)} <span class="rank">${m.rankB ? ordinal(m.rankB) : ''}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>` : ''}

    <section class="scout-grid">
      ${[[a, leadersA], [b, leadersB]].map(([t, L]) => `
        <div class="panel">
          <h3>${logo(t, 'tiny-logo')}${esc(t.name)}: key players</h3>
          ${season.players.length ? LEADER_CATEGORIES.map((c) => leaderTable(c, L[c.key])).join('') : '<p class="muted">Player stats unavailable right now.</p>'}
        </div>`).join('')}
    </section>

    <section class="panel">
      <h3>Head to head${h2hSeason.id !== state.seasonId && h2h.played.length ? ` <span class="muted small">(${esc(h2hSeason.name)}: no meetings yet this season)</span>` : ''}</h3>
      ${h2h.played.length ? `<div class="cards">${h2h.played.map(card).join('')}</div>` : '<p class="muted">These teams haven\'t played each other this season or last.</p>'}
      ${breakdown ? lastMeetingHtml(lastMeeting, breakdown, h2hSeason.name) : (lastMeeting ? '<p class="muted">Box score for the last meeting is unavailable right now.</p>' : '')}
    </section>

    <section class="scout-grid">
      ${[a, b].map((t) => `
        <div class="panel">
          <h3>${logo(t, 'tiny-logo')}${esc(t.name)}: last 5 games</h3>
          ${recentHtml(recentGames(fixtures.data, fixtures.includes, t.id))}
          <p class="muted small">${close[t.id].close} of ${close[t.id].played} games decided by 5 or fewer.</p>
        </div>`).join('')}
    </section>`;

  const go = () => {
    const x = document.getElementById('scout-a').value;
    const y = document.getElementById('scout-b').value;
    location.hash = `#/scout/${x}/${y}`;
  };
  document.getElementById('scout-a').addEventListener('change', go);
  document.getElementById('scout-b').addEventListener('change', go);
}

function leaderTable(cat, rows) {
  if (!rows?.length) return '';
  const fmt = (r, [, key, kind]) => {
    if (kind === 'int') return r[key];
    if (kind === 'pct') return r[key] < 0 ? '–' : f1(r[key] * 100);
    return f1(r[key]);
  };
  return `
    <div class="leader">
      <div class="leader-title">${esc(cat.title)}</div>
      <table class="mini">
        <thead><tr><th class="left">Player</th><th>GP</th>${cat.cols.map(([l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr><td class="left">${esc(r.name)}</td><td class="muted">${r.gp}</td>${cat.cols.map((c, i) => `<td class="${i === 0 ? 'strong' : ''}">${esc(fmt(r, c))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>`;
}

function lastMeetingHtml(meeting, breakdown, seasonLabel) {
  const vsAvg = (v, avg) => `${esc(v)}${avg === null || avg === undefined ? '' : ` <span class="muted">(${f1(avg)})</span>`}`;
  const delta = (d, m) => {
    if (d === null) return '';
    const good = m.low ? d < 0 : d > 0;
    const cls = Math.abs(d) < 0.05 ? '' : (m.ref ? (d > 0 ? 'up-ref' : 'down-ref') : (good ? 'up' : 'down'));
    return `<span class="${cls}">${d > 0 ? '+' : ''}${f1(d)}</span>`;
  };
  return `
    <h4>Last meeting vs ${esc(seasonLabel)} averages <span class="muted small">${esc(formatDate(meeting.start))}</span></h4>
    <div class="scout-grid">
      ${meeting.teams.map((t) => {
        const bd = breakdown[t.id];
        if (!bd) return '';
        return `
        <div>
          <div class="leader-title">${logo(t, 'tiny-logo')}${esc(t.name)} <span class="muted">${esc(t.score)}</span></div>
          <table class="mini">
            <thead><tr><th class="left">Stat</th><th>Game</th><th>Avg</th><th>+/-</th></tr></thead>
            <tbody>${bd.metrics.map((m) => `<tr><td class="left">${esc(m.label)}</td><td class="strong">${gameVal(m.game)}</td><td class="muted">${metricVal(m, m.season)}</td><td>${delta(m.delta, m)}</td></tr>`).join('')}</tbody>
          </table>
          <table class="mini players">
            <thead><tr><th class="left">Player <span class="muted">(season avg)</span></th><th>PTS</th><th>REB</th><th>AST</th><th>PF</th></tr></thead>
            <tbody>${bd.players.map((p) => `<tr class="${p.fouls >= 5 ? 'foul-out' : p.fouls >= 4 ? 'foul-trouble' : ''}">
              <td class="left">${esc(p.name)}${p.tech ? ' <span class="tag">T</span>' : ''}${p.unsp ? ' <span class="tag">U</span>' : ''}</td>
              <td>${vsAvg(p.pts, p.seasonPpg)}</td><td>${vsAvg(p.reb, p.seasonRpg)}</td><td>${vsAvg(p.ast, p.seasonApg)}</td><td>${vsAvg(p.fouls, p.seasonFouls)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>`;
      }).join('')}
    </div>
    <p class="muted small"><span class="foul-key trouble">Orange</span> = 4 fouls, <span class="foul-key out">red</span> = 5 or more. <span class="tag">T</span> technical, <span class="tag">U</span> unsportsmanlike.</p>`;
}

function recentHtml(games) {
  if (!games.length) return '<p class="muted">No games played yet.</p>';
  return `<table class="mini recent"><tbody>${games.map((g) => `
    <tr onclick="location.hash='#/game/${esc(g.id)}'">
      <td class="muted">${esc(shortDate(g.start))}</td>
      <td class="left">${g.home ? 'vs' : '@'} ${esc(g.opponent)}${g.final ? ' <span class="tag">Final</span>' : ''}</td>
      <td><span class="form ${g.won ? 'w' : 'l'}">${g.won ? 'W' : 'L'}</span></td>
      <td class="strong">${g.scoreFor}–${g.scoreAgainst}</td>
    </tr>`).join('')}</tbody></table>`;
}

// ---------- Routing ----------

const PAGES = { results: renderResults, ladder: renderLadder, stats: renderStats, scout: renderScout };

function currentPage() {
  if (location.hash.startsWith('#/ladder')) return 'ladder';
  if (location.hash.startsWith('#/stats')) return 'stats';
  if (location.hash.startsWith('#/scout')) return 'scout';
  return 'results';
}

async function route() {
  const token = ++renderToken;
  const gameId = /^#\/game\/([\w-]+)/.exec(location.hash)?.[1];
  const page = gameId ? null : currentPage();
  // Page-specific URL bits: the round for results, the two team ids for scout.
  const param = page === 'scout'
    ? (/^#\/scout\/([\w-]+)\/([\w-]+)/.exec(location.hash)?.slice(1) ?? [])
    : /^#\/results\/([\w-]+)/.exec(location.hash)?.[1];
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  pickers.hidden = Boolean(gameId);
  window.scrollTo(0, 0);
  loading();
  try {
    if (gameId) {
      await renderGame(gameId, token);
    } else {
      if (await ensureSeasons(token) && token === renderToken) await PAGES[page](token, param);
    }
  } catch (err) {
    if (token === renderToken) showError(err);
  }
}

function fillCompetitions() {
  const league = getLeague();
  const comps = COMPETITIONS_BY_LEAGUE[league];
  compPicker.innerHTML = comps.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('');
  const saved = stored(compKey(league));
  compPicker.value = comps.some(([id]) => id === saved) ? saved : comps[0][0];
  state.seasonsFor = null; // force the season list to reload for the new competition list
}

leaguePicker.innerHTML = Object.entries(LEAGUES).map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('');
setLeague(stored(LEAGUE_KEY) ?? 'bigv');
leaguePicker.value = getLeague();
fillCompetitions();
// NBL1 season stats are built from every game's box score; show how far along that is.
setTotalsProgress((done, total) => {
  const msg = app.querySelector('.loading-msg');
  if (msg) msg.textContent = `Adding up ${total} NBL1 box scores: ${done}/${total} (only slow the first time)`;
});
// A new competition/season has different rounds, so drop the round from the URL and show its default.
// Scout keeps its two teams across seasons (same club ids), but not across competitions.
function rerouteForNewSeason({ newCompetition = false } = {}) {
  const page = currentPage();
  const base = `#/${page}`;
  const reset = page === 'results' || (page === 'scout' && newCompetition);
  if (reset && location.hash !== base) location.hash = base; // hashchange routes
  else route();
}
compPicker.addEventListener('change', () => {
  store(compKey(getLeague()), compPicker.value);
  rerouteForNewSeason({ newCompetition: true });
});
leaguePicker.addEventListener('change', () => {
  setLeague(leaguePicker.value);
  store(LEAGUE_KEY, getLeague());
  fillCompetitions();
  // Game pages belong to one league, so switching league goes back to Results.
  if (/^#\/game\//.test(location.hash)) location.hash = '#/results';
  else rerouteForNewSeason({ newCompetition: true });
});
seasonPicker.addEventListener('change', () => {
  state.seasonId = seasonPicker.value;
  state.statsTeam = 'all';
  rerouteForNewSeason();
});
window.addEventListener('hashchange', route);
route();
