// NBL1 support: turns NBL1 "rosetta" API data into the same Synergy-shaped objects the Big V side uses,
// so every page (results, box score, ladder, stats, scout) works unchanged.
// Pure functions only (no fetch), so they're tested in Node with saved responses.
//
// IDs: NBL1's data is also Sportradar/Synergy underneath, and rosetta exposes those ids as `external_id`.
// We use them everywhere (teams, players, games) so ids line up across endpoints.

// Conference + gender = one "competition" in the app's dropdown. `division` matches rosetta's division name,
// `conf` is the URL segment rosetta uses for that conference's matches.
export const NBL1_COMPETITIONS = [
  ['south-men', 'South Men', 'south'], ['south-women', 'South Women', 'south'],
  ['north-men', 'North Men', 'north'], ['north-women', 'North Women', 'north'],
  ['central-men', 'Central Men', 'central'], ['central-women', 'Central Women', 'central'],
  ['east-men', 'East Men', 'east'], ['east-women', 'East Women', 'east'],
  ['west-men', 'West Men', 'west'], ['west-women', 'West Women', 'west'],
  ['finals-men', 'Finals Men', 'finals', 'National Finals Men'], ['finals-women', 'Finals Women', 'finals', 'National Finals Women'],
].map(([id, division, conf, label]) => ({ id, division, conf, name: label ?? division }));

const extId = (o) => o?.external_id ?? o?.id ?? null;
const divisionOf = (season) => season?.competition?.division?.[0]?.name ?? null;

// rosetta times are UTC without a "Z"; the app (like Synergy's startTimeLocal) wants the venue's local time.
export function utcToLocal(utc, timeZone = 'Australia/Melbourne') {
  if (!utc) return null;
  const d = new Date(`${utc.replace(/Z$/, '')}Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-AU', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function statusOf(m) {
  if (m.match_status === 'complete' || m.status === 'CONFIRMED') return 'CONFIRMED';
  if (/live|progress|half|break|quarter/i.test(m.match_status ?? '')) return 'IN_PROGRESS';
  return 'SCHEDULED';
}

function entityFromTeam(team) {
  const logo = team.team_logo ?? team.external_team_logo ?? null;
  return {
    entityId: extId(team),
    nameFullLocal: team.name,
    additionalNames: { nameShortLocal: team.team_code ?? team.team_nickname ?? '' },
    images: logo ? [{ imageType: 'LOGO', url: logo }] : [],
  };
}

// ---------- Seasons ----------

export function seasonsFor(rosettaSeasons, competition) {
  const mine = rosettaSeasons.filter((s) => divisionOf(s) === competition.division);
  const latestYear = Math.max(0, ...mine.map((s) => Number(s.year)));
  return mine.map((s) => ({
    seasonId: s.id,
    nameLocal: s.name,
    // rosetta doesn't say which season is current; the newest year is.
    status: Number(s.year) === latestYear ? 'ACTIVE' : 'COMPLETE',
    startDate: s.start_date?.slice(0, 10) ?? `${s.year}-01-01`,
    year: s.year,
    conf: competition.conf,
  }));
}

// ---------- Fixtures ----------

export function fixturesFromMatches(matches, seasonId) {
  const resources = { entities: {}, venues: {}, seasons: {}, competitions: {} };
  const data = [];
  for (const m of matches) {
    if (m.season?.id !== seasonId) continue;
    if (!m.home_team || !m.away_team || !m.start_time) continue;
    const venueTz = m.venue?.timezone || 'Australia/Melbourne';
    const home = entityFromTeam(m.home_team);
    const away = entityFromTeam(m.away_team);
    resources.entities[home.entityId] = home;
    resources.entities[away.entityId] = away;
    if (m.venue) resources.venues[extId(m.venue)] = { venueId: extId(m.venue), nameLocal: m.venue.name };
    const compId = m.season.competition?.id ?? m.season.id;
    resources.seasons[m.season.id] = { seasonId: m.season.id, nameLocal: m.season.name, competitionId: compId };
    resources.competitions[compId] = { competitionId: compId, nameLocal: m.season.competition?.name ?? '' };
    const final = m.match_type !== 'regular';
    data.push({
      fixtureId: extId(m),
      fixtureType: final ? 'FINAL' : 'REGULAR',
      roundNumber: final ? null : String(m.round),
      status: statusOf(m),
      startTimeLocal: utcToLocal(m.start_time, venueTz),
      startTimeUTC: m.start_time.replace(/Z$/, '').slice(0, 19),
      venueId: m.venue ? extId(m.venue) : null,
      seasonId: m.season.id,
      competitors: [
        { entityId: home.entityId, isHome: true, score: m.home_score ?? null },
        { entityId: away.entityId, isHome: false, score: m.away_score ?? null },
      ],
    });
  }
  return { data, includes: { resources } };
}

// ---------- Ladder ----------

export function standingsFor(rosettaStandings, season, competition) {
  const resources = { entities: {} };
  const data = rosettaStandings
    .filter((s) => s.season?.year === season.year && divisionOf(s.season) === competition.division)
    // NBL1's ladder carries placeholder "TBC" teams (0 games) at the bottom.
    .filter((s) => !/^(TBC|TBA)$/i.test(s.team?.name ?? ''))
    .map((s) => {
      const e = entityFromTeam(s.team);
      resources.entities[e.entityId] = e;
      return {
        entityId: e.entityId,
        position: s.position,
        fixtureType: 'REGULAR',
        calculated: {
          OVERALL: {
            played: s.played,
            wins: s.won,
            losses: s.lost,
            winPercentageDisplay: (s.win_percentage ?? 0) * 100,
            scoredFor: s.points_for,
            scoredAgainst: s.points_against,
            percentageDisplay: (s.points_percentage ?? 0) * 100,
            resultString: s.last_5 ?? '', // despite the name it's the whole season, oldest first
          },
        },
      };
    });
  return { data, includes: { resources } };
}

// ---------- One game ----------

// rosetta stat names -> Synergy's. Anything NBL1 doesn't record (fouls drawn, unsportsmanlike fouls,
// team rebounds, coach technicals) is simply absent, and the UI shows "–" for it.
function synergyStats(s) {
  return {
    points: s.points,
    fieldGoalsMade: s.field_goals_made,
    fieldGoalsAttempted: s.field_goals_attempted,
    pointsTwoMade: s.two_points_made,
    pointsTwoAttempted: s.two_points_attempted,
    pointsThreeMade: s.three_points_made,
    pointsThreeAttempted: s.three_points_attempted,
    freeThrowsMade: s.free_throws_made,
    freeThrowsAttempted: s.free_throws_attempted,
    reboundsOffensive: s.offensive_rebounds,
    reboundsDefensive: s.defensive_rebounds,
    rebounds: s.rebounds,
    assists: s.assists,
    steals: s.steals,
    blocks: s.blocks,
    turnovers: s.turnovers,
    // `fouls` is every foul (personal + offensive + technical), same meaning as Synergy's foulsTotal.
    foulsTotal: s.fouls,
    foulsPersonal: s.personal_fouls,
    foulsTechnical: s.technical_fouls,
    foulsOffensive: s.offensive_fouls,
    plusMinus: s.plus_minus,
    efficiency: s.efficiency,
  };
}

export function gameFromMatch(match) {
  const venueTz = match.venue?.timezone || 'Australia/Melbourne';
  const fixture = fixturesFromMatches([{ ...match, season: match.season }], match.season?.id);
  // live/all's season object lacks a display name; derive one like "2026 South Women".
  for (const s of Object.values(fixture.includes.resources.seasons)) {
    s.nameLocal ??= `${match.season?.year ?? ''} ${divisionOf(match.season) ?? ''}`.trim();
  }
  if (!fixture.data.length) {
    fixture.data.push({ fixtureId: extId(match), competitors: [], startTimeLocal: utcToLocal(match.start_time, venueTz) });
  }

  const persons = {};
  const people = (match.player_match_statistics ?? [])
    .filter((p) => String(p.period) === '0')
    .map((p) => {
      const personId = extId(p.player);
      persons[personId] = { personId, nameFullLocal: p.player?.full_name ?? `${p.player?.first_name ?? ''} ${p.player?.last_name ?? ''}`.trim() };
      return {
        entityId: extId(p.team),
        personId,
        bib: p.jersey_number ?? '',
        isPlayer: true,
        participated: p.participated !== false,
        starter: Boolean(p.starter),
        statistics: { ...synergyStats(p), minutes: p.minutes_string ?? null },
      };
    });

  const teamRows = match.team_match_statistics ?? [];
  const teams = teamRows
    .filter((t) => String(t.period) === '0')
    .map((t) => {
      const mine = people.filter((p) => p.entityId === extId(t.team) && p.participated);
      const opp = teamRows.find((o) => String(o.period) === '0' && extId(o.team) !== extId(t.team));
      return {
        entityId: extId(t.team),
        statistics: {
          ...synergyStats(t),
          pointsAgainst: opp?.points,
          minutes: t.minutes ? `PT${t.minutes}M` : null,
          // Team efficiency isn't in the team row; the box score's total is the players' sum.
          efficiency: mine.reduce((n, p) => n + (p.statistics.efficiency ?? 0), 0),
        },
      };
    });
  // NBL1 numbers overtime oddly (first OT is period 11, period_type "overtime"), so renumber overtimes
  // to follow straight on from the last regular period: Q1-Q4 then 5, 6, ... (shown as OT, OT2).
  const quarters = teamRows.filter((t) => Number(t.period) > 0 && t.period_type !== 'overtime');
  const lastQuarter = Math.max(0, ...quarters.map((t) => Number(t.period)));
  const otNumbers = [...new Set(teamRows.filter((t) => t.period_type === 'overtime').map((t) => Number(t.period)))].sort((a, b) => a - b);
  const periods = teamRows
    .filter((t) => Number(t.period) > 0)
    .map((t) => ({
      entityId: extId(t.team),
      periodId: t.period_type === 'overtime' ? lastQuarter + otNumbers.indexOf(Number(t.period)) + 1 : Number(t.period),
      statistics: { points: t.points },
    }));

  return {
    fixture,
    people: { data: people, includes: { resources: { persons } } },
    teams: { data: teams, includes: {} },
    periods: { data: periods, includes: {} },
  };
}

// ---------- Season totals (NBL1 has no full season-stats endpoint, so we add up the box scores) ----------

const SUM_KEYS = [
  'points', 'fieldGoalsMade', 'fieldGoalsAttempted', 'pointsTwoMade', 'pointsTwoAttempted', 'pointsThreeMade',
  'pointsThreeAttempted', 'freeThrowsMade', 'freeThrowsAttempted', 'reboundsOffensive', 'reboundsDefensive', 'rebounds',
  'assists', 'steals', 'blocks', 'turnovers', 'foulsTotal', 'foulsPersonal', 'foulsTechnical', 'foulsOffensive', 'efficiency',
];

const secs = (iso) => {
  const m = /PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(iso ?? '');
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : 0;
};

function addInto(target, stats) {
  for (const k of SUM_KEYS) target[k] = (target[k] ?? 0) + (stats[k] ?? 0);
}

// games: list of gameFromMatch() results for finished games. Returns Synergy-shaped
// { players: {data, includes}, teams: {data} } for playerSeasonRows / teamComparison.
export function seasonTotals(games) {
  const players = new Map();
  const persons = {};
  const entities = {};
  const teams = new Map();

  for (const g of games) {
    for (const e of Object.values(g.fixture.includes.resources.entities)) entities[e.entityId] = e;
    Object.assign(persons, g.people.includes.resources.persons);
    for (const p of g.people.data) {
      if (!p.participated) continue;
      const key = `${p.personId}:${p.entityId}`;
      const row = players.get(key) ?? { personId: p.personId, entityId: p.entityId, totals: {}, games: 0, starts: 0, seconds: 0 };
      addInto(row.totals, p.statistics);
      row.games += 1;
      row.starts += p.starter ? 1 : 0;
      row.seconds += secs(p.statistics.minutes);
      players.set(key, row);
    }
    for (const t of g.teams.data) {
      const row = teams.get(t.entityId) ?? { entityId: t.entityId, totals: {}, games: 0, pointsAgainst: 0 };
      addInto(row.totals, t.statistics);
      row.games += 1;
      row.pointsAgainst += t.statistics.pointsAgainst ?? 0;
      teams.set(t.entityId, row);
    }
  }

  const perGame = (total, games) => (games ? total / games : 0);
  const playerData = [...players.values()].map((r) => {
    const t = r.totals;
    const mpg = Math.round(perGame(r.seconds, r.games));
    return {
      personId: r.personId,
      entityId: r.entityId,
      statistics: {
        ...t,
        games: r.games,
        gamesStarted: r.starts,
        minutesPerGame: `PT${Math.floor(mpg / 60)}M${mpg % 60}S`,
        pointsPerGame: perGame(t.points, r.games),
        reboundsPerGame: perGame(t.rebounds, r.games),
        reboundsOffensivePerGame: perGame(t.reboundsOffensive, r.games),
        reboundsDefensivePerGame: perGame(t.reboundsDefensive, r.games),
        assistsPerGame: perGame(t.assists, r.games),
        stealsPerGame: perGame(t.steals, r.games),
        blocksPerGame: perGame(t.blocks, r.games),
        turnoversPerGame: perGame(t.turnovers, r.games),
        foulsPersonalPerGame: perGame(t.foulsPersonal, r.games),
        freeThrowsAttemptedPerGame: perGame(t.freeThrowsAttempted, r.games),
        pointsThreeMadePerGame: perGame(t.pointsThreeMade, r.games),
        pointsThreeAttemptedPerGame: perGame(t.pointsThreeAttempted, r.games),
      },
    };
  });
  const teamData = [...teams.values()].map((r) => ({
    entityId: r.entityId,
    statistics: { ...r.totals, games: r.games, pointsAgainst: r.pointsAgainst },
  }));
  return {
    players: { data: playerData, includes: { resources: { persons, entities } } },
    teams: { data: teamData, includes: { resources: { entities } } },
  };
}
