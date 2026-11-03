// Pure data shaping for the Synergy API responses. No DOM, no fetch, so it can be unit tested in Node.

const ID_FIELD = {
  entities: 'entityId', persons: 'personId', venues: 'venueId', seasons: 'seasonId', competitions: 'competitionId',
};

// Synergy resource keys in `includes` are prefixed with the org id ("b1bt2:<uuid>"), so match on the id field instead.
export function lookup(includes, type, id) {
  if (!id) return null;
  const bucket = includes?.resources?.[type] ?? {};
  return Object.values(bucket).find((r) => r[ID_FIELD[type]] === id) ?? null;
}

// "PT33M17S" -> "33:17", "PT40M" -> "40:00", "PT200M" -> "200:00"
export function formatMinutes(iso) {
  if (!iso) return '';
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(iso);
  if (!m) return '';
  const mins = Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
  const secs = Math.floor(Number(m[3] ?? 0));
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// toFixed alone rounds 28.95 down to "28.9" (binary floats), so round first.
const round1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

export function pct(made, att) {
  if (!att) return '–';
  const v = (made / att) * 100;
  return round1(v); // always one decimal so columns line up
}

export function entityLogo(entity) {
  return entity?.images?.find((i) => i.imageType === 'LOGO')?.url ?? null;
}

// CONFIRMED is what Synergy uses for a completed, signed-off game.
export function gameState(status) {
  if (status === 'IN_PROGRESS') return 'live';
  if (status === 'CONFIRMED' || status === 'FINISHED' || status === 'COMPLETE') return 'final';
  return 'upcoming';
}

// Absolute start time ("YYYY-MM-DDTHH:mm:ss" in UTC) for ordering and "has it started" checks.
// startTimeLocal is venue wall-clock time, so comparing it across venues in different time zones
// (e.g. Perth vs Melbourne in NBL1) or with the viewer's clock gives wrong answers.
export const startKey = (f) => f.startTimeUTC ?? f.startTimeLocal;

export function summariseFixture(fixture, includes) {
  const teams = [...fixture.competitors]
    // Home team on the left, like the BV site.
    .sort((a, b) => Number(b.isHome) - Number(a.isHome))
    .map((c) => {
      const entity = lookup(includes, 'entities', c.entityId);
      return {
        id: c.entityId,
        name: entity?.nameFullLocal ?? 'TBA',
        short: entity?.additionalNames?.nameShortLocal ?? '',
        logo: entityLogo(entity),
        score: c.score === null || c.score === '' ? null : Number(c.score),
        isHome: c.isHome,
      };
    });
  const venue = lookup(includes, 'venues', fixture.venueId);
  const competition = lookup(includes, 'competitions', lookup(includes, 'seasons', fixture.seasonId)?.competitionId);
  const season = lookup(includes, 'seasons', fixture.seasonId);
  return {
    id: fixture.fixtureId,
    start: fixture.startTimeLocal,
    startUtc: startKey(fixture),
    state: gameState(fixture.status),
    type: fixture.fixtureType,
    round: roundKey(fixture),
    venue: venue?.nameLocal ?? '',
    competition: competition?.nameLocal ?? '',
    season: season?.nameLocal ?? '',
    teams,
  };
}

// Synergy keeps placeholder fixtures (e.g. a "TBA" grand final with no teams and no start time, seen in
// Championship Women 2026). They can't be shown or compared, so drop them right after loading.
export function cleanFixtures(fixtures) {
  return fixtures.filter((f) => f.competitors?.length === 2 && f.startTimeLocal);
}

// ---------- Rounds ----------
// Like the BV fixtures page: numbered rounds for the regular season, and every final grouped
// under one "Finals" tab (finals can span several round numbers depending on the competition).

export const roundKey = (f) => (f.fixtureType === 'FINAL' ? 'finals' : String(f.roundNumber ?? ''));

export const roundLabel = (key) => (key === 'finals' ? 'Finals' : `Round ${key}`);

export function roundsFromSeason(fixtures) {
  const keys = [...new Set(fixtures.map(roundKey))].filter(Boolean);
  // Finals last, numbered rounds in numeric (not string) order.
  return keys.sort((a, b) => (a === 'finals') - (b === 'finals') || Number(a) - Number(b));
}

export function gamesInRound(fixtures, includes, key) {
  return fixtures
    .filter((f) => roundKey(f) === key)
    .map((f) => summariseFixture(f, includes))
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc) || a.id.localeCompare(b.id));
}

// The round of the most recent game that has started; before the season starts, the first round.
// `nowUtc` is "YYYY-MM-DDTHH:mm:ss" in UTC, compared with each game's absolute start (startKey).
export function defaultRound(fixtures, nowUtc) {
  const rounds = roundsFromSeason(fixtures);
  const started = fixtures
    .filter((f) => startKey(f) <= nowUtc || gameState(f.status) !== 'upcoming')
    .sort((a, b) => startKey(b).localeCompare(startKey(a)));
  return started.length ? roundKey(started[0]) : rounds[0] ?? null;
}

export function pickCurrentSeason(seasons) {
  const active = seasons.filter((s) => s.status === 'ACTIVE');
  const pool = active.length ? active : seasons;
  return [...pool].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))[0] ?? null;
}

// periods: per-team, per-period entity stats -> { [entityId]: [p1, p2, ...] }
export function periodScores(periods) {
  const out = {};
  for (const p of periods) {
    (out[p.entityId] ??= [])[p.periodId - 1] = p.statistics?.points ?? 0;
  }
  return out;
}

export const COLUMNS = [
  ['MIN', 'Minutes'], ['PTS', 'Points'],
  ['FGM', 'Field goals made'], ['FGA', 'Field goals attempted'], ['FG%', 'Field goal %'],
  ['2PM', '2-pointers made'], ['2PA', '2-pointers attempted'], ['2P%', '2-point %'],
  ['3PM', '3-pointers made'], ['3PA', '3-pointers attempted'], ['3P%', '3-point %'],
  ['FTM', 'Free throws made'], ['FTA', 'Free throws attempted'], ['FT%', 'Free throw %'],
  ['OR', 'Offensive rebounds'], ['DR', 'Defensive rebounds'], ['REB', 'Total rebounds'],
  ['AST', 'Assists'], ['STL', 'Steals'], ['BLK', 'Blocks'], ['TO', 'Turnovers'],
  ['PF', 'Fouls'], ['+/-', 'Plus/minus'], ['EFF', 'Efficiency'],
];

function statCells(s, { plusMinus = true } = {}) {
  return [
    formatMinutes(s.minutes), s.points,
    s.fieldGoalsMade, s.fieldGoalsAttempted, pct(s.fieldGoalsMade, s.fieldGoalsAttempted),
    s.pointsTwoMade, s.pointsTwoAttempted, pct(s.pointsTwoMade, s.pointsTwoAttempted),
    s.pointsThreeMade, s.pointsThreeAttempted, pct(s.pointsThreeMade, s.pointsThreeAttempted),
    s.freeThrowsMade, s.freeThrowsAttempted, pct(s.freeThrowsMade, s.freeThrowsAttempted),
    s.reboundsOffensive, s.reboundsDefensive, s.rebounds,
    s.assists, s.steals, s.blocks, s.turnovers,
    // The BV widget's PF column is every foul (personal + technical + offensive...), i.e. foulsTotal.
    s.foulsTotal,
    plusMinus ? s.plusMinus : '',
    s.efficiency,
  ].map((v) => v ?? 0);
}

export function boxScore(entityId, personStats, includes, entityStats) {
  const players = personStats
    .filter((p) => p.entityId === entityId && p.isPlayer)
    .map((p) => {
      const person = lookup(includes, 'persons', p.personId);
      return {
        bib: p.bib ?? '',
        name: person?.nameFullLocal ?? 'Unknown',
        starter: p.starter,
        dnp: !p.participated,
        cells: p.participated ? statCells(p.statistics ?? {}) : null,
        points: p.statistics?.points ?? 0,
      };
    })
    // Starters first, then by shirt number, same as the BV widget.
    .sort((a, b) => Number(b.starter) - Number(a.starter) || Number(a.bib) - Number(b.bib));

  const t = entityStats?.statistics ?? {};
  const blank = Array(COLUMNS.length).fill('');
  const teamRow = [...blank];
  const col = (label) => COLUMNS.findIndex(([l]) => l === label);
  teamRow[col('MIN')] = '00:00';
  teamRow[col('OR')] = t.reboundsTeamOffensive ?? 0;
  teamRow[col('DR')] = t.reboundsTeamDefensive ?? 0;
  teamRow[col('REB')] = t.reboundsTeamTotal ?? 0;
  teamRow[col('TO')] = t.turnoversTeam ?? 0;
  teamRow[col('PF')] = (t.foulsCoachTechnical ?? 0) + (t.foulsCoachDisqualifying ?? 0);

  return {
    players,
    // NBL1 data has no team rebounds/turnovers or coach fouls, so no Team/Coach row there.
    team: t.reboundsTeamOffensive === undefined ? null : teamRow,
    totals: entityStats ? statCells(t, { plusMinus: false }) : null,
  };
}

// ---------- Ladder ----------

export function secondsOf(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(iso ?? '');
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

// entityId -> name of the opponent in that team's next scheduled or live game.
export function nextOpponents(fixtures, includes) {
  const out = {};
  const upcoming = fixtures
    .filter((f) => gameState(f.status) !== 'final')
    .sort((a, b) => startKey(a).localeCompare(startKey(b)));
  for (const f of upcoming) {
    const [a, b] = f.competitors;
    if (!a || !b) continue;
    for (const [me, them] of [[a, b], [b, a]]) {
      out[me.entityId] ??= lookup(includes, 'entities', them.entityId)?.nameFullLocal ?? 'TBA';
    }
  }
  return out;
}

export function ladderRows(standings, includes, nextOpp = {}) {
  return standings
    .filter((s) => s.fixtureType === 'REGULAR' || !s.fixtureType)
    .map((s) => {
      const o = s.calculated?.OVERALL ?? {};
      const entity = lookup(includes, 'entities', s.entityId);
      return {
        position: s.position,
        id: s.entityId,
        name: entity?.nameFullLocal ?? 'Unknown',
        logo: entityLogo(entity),
        played: o.played ?? 0,
        wins: o.wins ?? 0,
        losses: o.losses ?? 0,
        winPct: o.winPercentageDisplay ?? 0,
        pointsFor: o.scoredFor ?? 0,
        pointsAgainst: o.scoredAgainst ?? 0,
        pct: o.percentageDisplay ?? 0,
        // resultString is oldest -> newest, so the last five are at the end.
        lastFive: (o.resultString ?? '').slice(-5),
        next: nextOpp[s.entityId] ?? null,
      };
    })
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
}

// ---------- Player season stats ----------

const r1 = (v) => (v === null || v === undefined ? '–' : round1(v));

// key: sort key on the row; fmt: how the cell displays. Percentages are recomputed from makes/attempts
// so "no attempts" shows as "–" instead of a misleading 0.
export const PLAYER_COLUMNS = [
  { key: 'gp', label: 'GP', title: 'Games played' },
  { key: 'gs', label: 'GS', title: 'Games started' },
  { key: 'mpg', label: 'MIN', title: 'Minutes per game', fmt: (r) => formatMinutes(r.minIso) },
  { key: 'ppg', label: 'PPG', title: 'Points per game', fmt: (r) => r1(r.ppg) },
  { key: 'rpg', label: 'RPG', title: 'Rebounds per game', fmt: (r) => r1(r.rpg) },
  { key: 'orpg', label: 'OR', title: 'Offensive rebounds per game', fmt: (r) => r1(r.orpg) },
  { key: 'drpg', label: 'DR', title: 'Defensive rebounds per game', fmt: (r) => r1(r.drpg) },
  { key: 'apg', label: 'APG', title: 'Assists per game', fmt: (r) => r1(r.apg) },
  { key: 'spg', label: 'SPG', title: 'Steals per game', fmt: (r) => r1(r.spg) },
  { key: 'bpg', label: 'BPG', title: 'Blocks per game', fmt: (r) => r1(r.bpg) },
  { key: 'tpg', label: 'TPG', title: 'Turnovers per game', fmt: (r) => r1(r.tpg) },
  { key: 'fpg', label: 'FPG', title: 'Personal fouls per game', fmt: (r) => r1(r.fpg) },
  { key: 'fgm', label: 'FGM', title: 'Field goals made (season)' },
  { key: 'fga', label: 'FGA', title: 'Field goals attempted (season)' },
  { key: 'fgp', label: 'FG%', title: 'Field goal %', fmt: (r) => pct(r.fgm, r.fga) },
  { key: 'twm', label: '2PM', title: '2-pointers made (season)' },
  { key: 'twa', label: '2PA', title: '2-pointers attempted (season)' },
  { key: 'twp', label: '2P%', title: '2-point %', fmt: (r) => pct(r.twm, r.twa) },
  { key: 'thm', label: '3PM', title: '3-pointers made (season)' },
  { key: 'tha', label: '3PA', title: '3-pointers attempted (season)' },
  { key: 'thp', label: '3P%', title: '3-point %', fmt: (r) => pct(r.thm, r.tha) },
  { key: 'ftm', label: 'FTM', title: 'Free throws made (season)' },
  { key: 'fta', label: 'FTA', title: 'Free throws attempted (season)' },
  { key: 'ftp', label: 'FT%', title: 'Free throw %', fmt: (r) => pct(r.ftm, r.fta) },
  { key: 'fd', label: 'FD', title: 'Fouls drawn (season)', fmt: (r) => r.fd ?? '–', optional: true },
];

const ratio = (m, a) => (a ? m / a : -1); // -1 sorts "no attempts" below 0%

export function playerSeasonRows(stats, includes) {
  return stats
    .filter((p) => (p.statistics?.games ?? 0) > 0)
    .map((p) => {
      const s = p.statistics;
      const team = lookup(includes, 'entities', p.entityId);
      const row = {
        id: `${p.personId}:${p.entityId}`,
        name: lookup(includes, 'persons', p.personId)?.nameFullLocal ?? 'Unknown',
        teamId: p.entityId,
        team: team?.nameFullLocal ?? '',
        logo: entityLogo(team),
        gp: s.games ?? 0,
        gs: s.gamesStarted ?? 0,
        minIso: s.minutesPerGame,
        mpg: secondsOf(s.minutesPerGame),
        ppg: s.pointsPerGame ?? 0,
        rpg: s.reboundsPerGame ?? 0,
        orpg: s.reboundsOffensivePerGame ?? 0,
        drpg: s.reboundsDefensivePerGame ?? 0,
        apg: s.assistsPerGame ?? 0,
        spg: s.stealsPerGame ?? 0,
        bpg: s.blocksPerGame ?? 0,
        tpg: s.turnoversPerGame ?? 0,
        fpg: s.foulsPersonalPerGame ?? 0,
        fgm: s.fieldGoalsMade ?? 0,
        fga: s.fieldGoalsAttempted ?? 0,
        twm: s.pointsTwoMade ?? 0,
        twa: s.pointsTwoAttempted ?? 0,
        thm: s.pointsThreeMade ?? 0,
        tha: s.pointsThreeAttempted ?? 0,
        ftm: s.freeThrowsMade ?? 0,
        fta: s.freeThrowsAttempted ?? 0,
        fd: s.foulsDrawn ?? null, // NBL1 doesn't record fouls drawn
        // Extra fields for the Scout page (not table columns).
        personId: p.personId,
        fouls: s.foulsTotal ?? 0, // every foul type, the number that matters for foul trouble
        tech: s.foulsTechnical ?? 0,
        unsp: s.foulsUnsportsmanlike ?? 0,
        dq: s.foulsDisqualifying ?? 0,
        fdpg: s.foulsDrawnPerGame ?? null,
        ftapg: s.freeThrowsAttemptedPerGame ?? 0,
        thmpg: s.pointsThreeMadePerGame ?? 0,
        thapg: s.pointsThreeAttemptedPerGame ?? 0,
      };
      row.foulspg = row.gp ? row.fouls / row.gp : 0;
      row.fgp = ratio(row.fgm, row.fga);
      row.twp = ratio(row.twm, row.twa);
      row.thp = ratio(row.thm, row.tha);
      row.ftp = ratio(row.ftm, row.fta);
      return row;
    });
}

export function sortRows(rows, key, dir = 'desc') {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    // Tie-break on name so the order is stable and predictable.
    return c * sign || a.name.localeCompare(b.name);
  });
}
