import { api } from './api-client';
import { MatchInfo } from './scraper';

/**
 * Maps scraped leagueId to API league slug.
 */
function mapLeagueIdToSlug(leagueId: string): string {
  // Mapping based on user's production server setting
  return leagueId === '1' ? 'k-league-1' : 'k-league-2';
}

export async function syncRoundAndMatch(match: MatchInfo) {
  const year = parseInt(match.year);
  const leagueSlug = mapLeagueIdToSlug(match.leagueId);

  // 1. Get League ID
  const leaguesRes = await api.getLeagues(year);
  const league = leaguesRes.leagues.find(l => l.slug === leagueSlug);
  
  if (!league) {
    console.error(`League not found for year ${year} and slug ${leagueSlug}`);
    return;
  }

  // 2. Find/Create Round
  const roundsRes = await api.getRounds(league.id, match.roundNumber);
  let round = roundsRes.rounds.find(r => r.number === match.roundNumber);

  if (!round) {
    console.log(`Creating new round: Round ${match.roundNumber} for league ${league.slug}`);
    const createRoundRes = await api.createRound({
      leagueId: league.id,
      number: match.roundNumber,
      slug: `round-${match.roundNumber}`
    });
    round = createRoundRes.round;
  }

  // 3. Sync Match Schedule
  // Get all matches for this season/league to find the specific match
  const scheduleRes = await api.getSchedule(year, leagueSlug);
  let dbMatch = scheduleRes.matches.find(m => 
    m.homeTeamName === match.homeTeamName && m.awayTeamName === match.awayTeamName
  );

  if (!dbMatch) {
    dbMatch = scheduleRes.matches.find(m => 
      (m.homeTeamName.includes(match.homeTeamName) || match.homeTeamName.includes(m.homeTeamName)) &&
      (m.awayTeamName.includes(match.awayTeamName) || match.awayTeamName.includes(m.awayTeamName))
    );
  }

  const playedAtIso = match.startTime?.toISOString();

  if (dbMatch) {
    // Check if update is needed (time or venue - though spec says venue doesn't matter for matching, we can sync it)
    if (playedAtIso && dbMatch.playedAt !== playedAtIso) {
      console.log(`Updating match time for ${match.homeTeamName} vs ${match.awayTeamName}: ${dbMatch.playedAt} -> ${playedAtIso}`);
      await api.updateMatchSchedule(dbMatch.id, { playedAt: playedAtIso });
    }
  } else {
    // Create new match
    console.log(`Match not found. Creating new match: ${match.homeTeamName} vs ${match.awayTeamName} in Round ${match.roundNumber}`);
    
    // Find Team IDs
    const homeTeamRes = await api.searchTeam(match.homeTeamName);
    const awayTeamRes = await api.searchTeam(match.awayTeamName);
    
    const homeTeam = homeTeamRes.teams[0];
    const awayTeam = awayTeamRes.teams[0];

    if (!homeTeam || !awayTeam) {
      console.error(`Failed to find team IDs: Home(${match.homeTeamName}): ${homeTeam?.id}, Away(${match.awayTeamName}): ${awayTeam?.id}`);
      return;
    }

    if (playedAtIso) {
      await api.createMatch({
        roundId: round.id,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        playedAt: playedAtIso,
        // venue: match.venue // MatchInfo doesn't have venue yet, but we could add if needed
      });
    }
  }

  // 4. Handle isFocus logic
  if (!round.isFocus) {
    console.log(`Setting Round ${match.roundNumber} as focused round for ${league.slug}`);
    await api.setFocusRound(round.id);
  }
}
