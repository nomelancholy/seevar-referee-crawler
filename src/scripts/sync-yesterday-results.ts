import { getTodayMatches, syncMatchResult } from '../lib/scraper';
import { syncRoundAndMatch } from '../lib/round-service';

async function syncYesterday() {
  const matches = await getTodayMatches("2026.04.18");
  for (const match of matches) {
    if (
      match.homeTeamName.includes("부산") || match.homeTeamName.includes("BUSAN") ||
      match.homeTeamName.includes("충북") || match.homeTeamName.includes("CHUNGBUK")
    ) {
      console.log(`Syncing missing match: ${match.homeTeamName} vs ${match.awayTeamName}`);
      await syncRoundAndMatch(match);
      await syncMatchResult(match);
    }
  }
  console.log("Done syncing missing results!");
}

syncYesterday();
