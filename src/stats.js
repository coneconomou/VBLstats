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

export function pct(made, att) {
  if (!att) return '–';
  const v = (made / att) * 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
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
    state: gameState(fixture.status),
    type: fixture.fixtureType,
    round: fixture.roundNumber,
    venue: venue?.nameLocal ?? '',
    competition: competition?.nameLocal ?? '',
    season: season?.nameLocal ?? '',
    teams,
  };
}

// Finals newest first; ties keep a stable order by start time then id.
export function finalsFromSeason(fixtures, includes) {
  return fixtures
    .filter((f) => f.fixtureType === 'FINAL')
    .map((f) => summariseFixture(f, includes))
    .sort((a, b) => b.start.localeCompare(a.start) || a.id.localeCompare(b.id));
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
    team: teamRow,
    totals: entityStats ? statCells(t, { plusMinus: false }) : null,
  };
}
