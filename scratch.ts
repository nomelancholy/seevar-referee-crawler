import { api } from './src/lib/api-client';

async function main() {
  const scheduleRes1 = await api.getSchedule(2026, 'k-league-1');
  const scheduleRes2 = await api.getSchedule(2026, 'k-league-2');
  
  const allTeams = new Set<string>();
  
  for (const m of scheduleRes1.matches) {
    allTeams.add(m.homeTeamName);
    allTeams.add(m.awayTeamName);
  }
  for (const m of scheduleRes2.matches) {
    allTeams.add(m.homeTeamName);
    allTeams.add(m.awayTeamName);
  }
  
  console.log(Array.from(allTeams));
}
main().catch(console.error);
