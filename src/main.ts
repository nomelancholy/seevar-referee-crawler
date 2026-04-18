import cron from 'node-cron';
import { getTodayMatches, syncRefereeInfo, syncMatchResult, nowKST, MatchInfo } from './lib/scraper';
import { syncRoundAndMatch } from './lib/round-service';

async function scheduleMatchTasks(match: MatchInfo, index: number) {
  if (!match.startTime) return;

  const now = new Date();
  
  // 1. Referee Sync: Kickoff - 40 minutes + (index * 1 minute)
  const refereeSyncTime = new Date(match.startTime.getTime() - 40 * 60 * 1000 + index * 60 * 1000);
  const msUntilRefereeSync = refereeSyncTime.getTime() - now.getTime();

  if (msUntilRefereeSync > 0) {
    console.log(`[${nowKST()}] Scheduling referee sync for ${match.homeTeamName} at ${refereeSyncTime.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace('T', ' ')} KST`);
    setTimeout(async () => {
      console.log(`[${nowKST()}] Starting referee sync for ${match.homeTeamName}...`);
      await syncRefereeInfo(match);
    }, msUntilRefereeSync);
  } else {
    // If we're already within 40 mins, run it now
    console.log(`[${nowKST()}] Already within referee sync window for ${match.homeTeamName}. Running now.`);
    await syncRefereeInfo(match);
  }

  // 2. Result Sync: Match Day at 23:20 KST + (index * 1 minute)
  const nowKstDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const resultSyncTime = new Date(nowKstDate.getFullYear(), nowKstDate.getMonth(), nowKstDate.getDate(), 23, 20 + index, 0);
  const msUntilResultSync = resultSyncTime.getTime() - now.getTime();

  if (msUntilResultSync > 0) {
    console.log(`[${nowKST()}] Scheduling result sync for ${match.homeTeamName} at ${resultSyncTime.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace('T', ' ')} KST`);
    setTimeout(async () => {
      console.log(`[${nowKST()}] Starting result sync for ${match.homeTeamName}...`);
      await syncMatchResult(match);
    }, msUntilResultSync);
  } else {
    // If we missed the window, still try once
    console.log(`[${nowKST()}] 23:20 KST has already passed for ${match.homeTeamName}. Running once now.`);
    await syncMatchResult(match);
  }
}

async function dailyTask() {
  console.log(`[${nowKST()}] Running daily match check...`);
  try {
    const matches = await getTodayMatches();
    // scraper 내부에서 이미 상세 로그 출력
    
    let matchOffset = 0;
    for (const match of matches) {
      // Step 2: Sync Round Focus and Match Schedule
      await syncRoundAndMatch(match);
      
      // Step 3 & 4: Schedule subsequent tasks
      await scheduleMatchTasks(match, matchOffset);
      matchOffset++;
    }
  } catch (error) {
    console.error(`[${nowKST()}] Error in daily task:`, error);
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
