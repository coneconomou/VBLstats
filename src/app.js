import { getSeasons, getSeasonFixtures, getGame } from './api.js';
import {
  summariseFixture, finalsFromSeason, pickCurrentSeason, periodScores, boxScore, COLUMNS,
} from './stats.js';

// Big V competitions in Synergy. IDs are stable across seasons; the current season is looked up live.
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
];
const COMP_KEY = 'vblstats.competition';

const app = document.getElementById('app');
const picker = document.getElementById('competition');

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
    : `<div class="${cls} logo-fallback">${esc(team.short || team.name.slice(0, 3))}</div>`;
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

// ---------- Finals list ----------

let listRequest = 0;

async function renderList() {
  picker.hidden = false;
  const compId = picker.value;
  const req = ++listRequest;
  loading();
  try {
    const seasons = await getSeasons(compId);
    const season = pickCurrentSeason(seasons.data);
    if (!season) throw new Error('No seasons found for this competition');
    const fixtures = await getSeasonFixtures(season.seasonId);
    if (req !== listRequest) return; // user switched competition mid-load
    const finals = finalsFromSeason(fixtures.data, fixtures.includes);
    app.innerHTML = `
      ${fixtures.stale ? '<p class="notice">Stats service is busy, showing the last saved results.</p>' : ''}
      <h2 class="section-title">${esc(season.nameLocal)} · Finals</h2>
      ${finals.length ? `<div class="cards">${finals.map(card).join('')}</div>`
        : '<p class="muted center">No finals scheduled yet.</p>'}`;
  } catch (err) {
    if (req === listRequest) showError(err);
  }
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

// ---------- Game page ----------

async function renderGame(id) {
  picker.hidden = true;
  loading();
  try {
    const { fixture, people, teams, periods } = await getGame(id);
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
  } catch (err) {
    showError(err);
  }
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

function route() {
  const m = /^#\/game\/([\w-]+)/.exec(location.hash);
  window.scrollTo(0, 0);
  if (m) renderGame(m[1]); else renderList();
}

picker.innerHTML = COMPETITIONS.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('');
picker.value = COMPETITIONS.some(([id]) => id === storedCompetition()) ? storedCompetition() : COMPETITIONS[0][0];
picker.addEventListener('change', () => {
  try { localStorage.setItem(COMP_KEY, picker.value); } catch { /* private mode etc. */ }
  renderList();
});
window.addEventListener('hashchange', route);
route();
