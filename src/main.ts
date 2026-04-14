import cron from 'node-cron';
import { getTodayMatches, syncRefereeInfo, syncMatchResult, MatchInfo } from './lib/scraper';
import { syncRoundAndMatch } from './lib/round-service';

async function scheduleMatchTasks(match: MatchInfo) {
  if (!match.startTime) return;

  const now = new Date();
  
  // 1. Referee Sync: Kickoff - 70 minutes
  const refereeSyncTime = new Date(match.startTime.getTime() - 70 * 60 * 1000);
  const msUntilRefereeSync = refereeSyncTime.getTime() - now.getTime();

  if (msUntilRefereeSync > 0) {
    console.log(`Scheduling referee sync for ${match.homeTeamName} at ${refereeSyncTime.toISOString()}`);
    setTimeout(async () => {
      console.log(`Starting referee sync for ${match.homeTeamName}...`);
      await syncRefereeInfo(match);
    }, msUntilRefereeSync);
  } else {
    // If we're already within 70 mins, run it now
    console.log(`Already within referee sync window for ${match.homeTeamName}. Running now.`);
    await syncRefereeInfo(match);
  }

  // 2. Result Sync: Kickoff + 127 minutes
  const resultSyncTime = new Date(match.startTime.getTime() + 127 * 60 * 1000);
  const msUntilResultSync = resultSyncTime.getTime() - now.getTime();

  if (msUntilResultSync > 0) {
    console.log(`Scheduling result sync for ${match.homeTeamName} at ${resultSyncTime.toISOString()}`);
    setTimeout(async () => {
      console.log(`Starting result sync for ${match.homeTeamName}...`);
      await syncMatchResult(match);
    }, msUntilResultSync);
  } else {
    // If we missed the window, still try once
    console.log(`Kickoff + 127m has already passed for ${match.homeTeamName}. Running once now.`);
    await syncMatchResult(match);
  }
}

async function dailyTask() {
  console.log(`Running daily match check at ${new Date().toISOString()}`);
  try {
    const matches = await getTodayMatches();
    console.log(`Found ${matches.length} matches today.`);
    
    for (const match of matches) {
      // Step 2: Sync Round Focus and Match Schedule
      await syncRoundAndMatch(match);
      
      // Step 3 & 4: Schedule subsequent tasks
      await scheduleMatchTasks(match);
    }
  } catch (error) {
    console.error('Error in daily task:', error);
  }
}

// 새벽 02:22 KST 실행
// 서버 타임존이 KST(Asia/Seoul)인 경우: '22 2 * * *'
// 서버 타임존이 UTC인 경우:             '22 17 * * *'  (17:22 UTC = 02:22 KST+1)
// 타임존 확인: timedatectl | pm2 logs 첫 줄 시각 확인
cron.schedule('22 2 * * *', dailyTask);

// Run on startup to catch any matches if the process starts mid-day
console.log('Crawler started. Initializing...');
dailyTask();
