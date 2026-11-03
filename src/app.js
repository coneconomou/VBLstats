import {
  getSeasons, getSeasonFixtures, getGame, getStandings, getSeasonPlayerStats,
} from './api.js';
import {
  summariseFixture, finalsFromSeason, pickCurrentSeason, periodScores, boxScore, COLUMNS,
  nextOpponents, ladderRows, playerSeasonRows, sortRows, PLAYER_COLUMNS,
} from './stats.js';

// Big V competitions in Synergy. IDs are stable across seasons; seasons are looked up live.
const COMPETITIONS = [
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
const COMP_KEY = 'vblstats.competition';

const app = document.getElementById('app');
const compPicker = document.getElementById('competition');
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

function storedCompetition() {
  try { return localStorage.getItem(COMP_KEY); } catch { return null; }
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
  app.innerHTML = `<p class="muted center">${esc(text)}</p>`;
}

function showError(err) {
  app.innerHTML = `<div class="error"><p>Couldn't load stats.</p><p class="muted">${esc(err.message)}</p>
    <button onclick="location.reload()">Try again</button></div>`;
}

const staleNotice = (...results) => (results.some((r) => r?.stale)
  ? '<p class="notice">Stats service is busy, showing the last saved results.</p>' : '');

const seasonName = () => state.seasons.find((s) => s.seasonId === state.seasonId)?.nameLocal ?? '';

// ---------- Competition + season ----------

async function ensureSeasons() {
  const compId = compPicker.value;
  if (state.seasonsFor === compId) return;
  const { data } = await getSeasons(compId);
  state.seasons = [...data].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
  state.seasonId = pickCurrentSeason(data)?.seasonId ?? null;
  state.seasonsFor = compId;
  state.statsTeam = 'all';
  // "2026 Championship Men" -> "2026"; older seasons are named inconsistently, so fall back to the full name.
  seasonPicker.innerHTML = state.seasons
    .map((s) => `<option value="${esc(s.seasonId)}">${esc(/^\d{4}\b/.exec(s.nameLocal)?.[0] ?? s.nameLocal)}</option>`).join('');
  seasonPicker.value = state.seasonId ?? '';
  if (!state.seasonId) throw new Error('No seasons found for this competition');
}

// ---------- Finals list ----------

async function renderFinals(token) {
  const fixtures = await getSeasonFixtures(state.seasonId);
  if (token !== renderToken) return;
  const finals = finalsFromSeason(fixtures.data, fixtures.includes);
  app.innerHTML = `
    ${staleNotice(fixtures)}
    <h2 class="section-title">${esc(seasonName())} · Finals</h2>
    ${finals.length ? `<div class="cards">${finals.map(card).join('')}</div>`
      : '<p class="muted center">No finals scheduled yet.</p>'}`;
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
          ${PLAYER_COLUMNS.map((c) => `<th class="sortable ${c.key === key ? 'sorted' : ''}" data-key="${c.key}" title="${esc(c.title)}">${esc(c.label)}${arrow(c.key)}</th>`).join('')}
        </tr></thead>
        <tbody>${rows.map((r, i) => `
          <tr>
            <td class="num">${i + 1}</td>
            <td class="name"><span class="team-cell">${logo(r, 'tiny-logo')}<span>${esc(r.name)}<span class="sub">${esc(r.team)}</span></span></span></td>
            ${PLAYER_COLUMNS.map((c) => `<td class="${c.key === key ? 'sorted' : ''}">${esc(c.fmt ? c.fmt(r) : r[c.key])}</td>`).join('')}
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
    <a class="back" href="#/">← Finals</a>
    <section class="scoreboard">
      <p class="muted small">${esc(game.season || game.competition)}${game.type === 'FINAL' ? ' · Finals' : ''}</p>
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
  const team_ = `<tr class="team-row"><td class="num"></td><td class="name">Team/Coach</td>${box.team.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`;
  const totals = box.totals
    ? `<tr class="totals"><td class="num"></td><td class="name">Total</td>${box.totals.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>` : '';
  return `
    <section class="box">
      <h3>${logo(team, 'tiny-logo')}${esc(team.name)}</h3>
      <div class="table-wrap"><table class="boxscore"><thead>${head}</thead><tbody>${rows}${team_}${totals}</tbody></table></div>
    </section>`;
}

// ---------- Routing ----------

const PAGES = { finals: renderFinals, ladder: renderLadder, stats: renderStats };

function currentPage() {
  if (location.hash.startsWith('#/ladder')) return 'ladder';
  if (location.hash.startsWith('#/stats')) return 'stats';
  return 'finals';
}

async function route() {
  const token = ++renderToken;
  const gameId = /^#\/game\/([\w-]+)/.exec(location.hash)?.[1];
  const page = gameId ? null : currentPage();
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  pickers.hidden = Boolean(gameId);
  window.scrollTo(0, 0);
  loading();
  try {
    if (gameId) {
      await renderGame(gameId, token);
    } else {
      await ensureSeasons();
      if (token === renderToken) await PAGES[page](token);
    }
  } catch (err) {
    if (token === renderToken) showError(err);
  }
}

compPicker.innerHTML = COMPETITIONS.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('');
compPicker.value = COMPETITIONS.some(([id]) => id === storedCompetition()) ? storedCompetition() : COMPETITIONS[0][0];
compPicker.addEventListener('change', () => {
  try { localStorage.setItem(COMP_KEY, compPicker.value); } catch { /* private mode etc. */ }
  route();
});
seasonPicker.addEventListener('change', () => {
  state.seasonId = seasonPicker.value;
  state.statsTeam = 'all';
  route();
});
window.addEventListener('hashchange', route);
route();
