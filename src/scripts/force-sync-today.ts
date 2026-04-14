/**
 * force-sync-today.ts
 *
 * 오늘 경기 목록을 크롤링하여 라운드 포커스 및 경기 일정을 즉시 강제 동기화합니다.
 * 크론 타이밍을 기다리지 않고 수동으로 확인할 때 사용하세요.
 *
 * 실행:
 *   npm run sync:today
 *   또는
 *   npx ts-node -r tsconfig-paths/register src/scripts/force-sync-today.ts
 */

import { getTodayMatches, nowKST } from '../lib/scraper';
import { syncRoundAndMatch } from '../lib/round-service';

async function forceSyncToday() {
  console.log(`[${nowKST()}] ===== 오늘 경기 강제 동기화 시작 =====`);

  try {
    console.log(`[${nowKST()}] K-League 스케줄 페이지 크롤링 중...`);
    const matches = await getTodayMatches();

    if (matches.length === 0) {
      console.log(`[${nowKST()}] ⚠️  오늘 경기가 없습니다. 크롤링 결과를 확인해주세요.`);
      console.log('  → kleague.com/schedule.do 접속 후 TODAY 버튼 기준 날짜를 직접 확인하세요.');
      return;
    }

    console.log(`[${nowKST()}] ✅ 오늘 경기 ${matches.length}개 발견:`);
    matches.forEach((m, i) => {
      console.log(`  [${i + 1}] R${m.roundNumber} | ${m.homeTeamName} vs ${m.awayTeamName} | leagueId=${m.leagueId} | gameId=${m.gameId}`);
    });

    console.log('');
    console.log(`[${nowKST()}] syncRoundAndMatch() 실행 중...`);

    for (const match of matches) {
      console.log(`\n[${nowKST()}] --- ${match.homeTeamName} vs ${match.awayTeamName} (Round ${match.roundNumber}) ---`);
      await syncRoundAndMatch(match);
      console.log(`[${nowKST()}] 완료: ${match.homeTeamName} vs ${match.awayTeamName}`);
    }

    console.log('');
    console.log(`[${nowKST()}] ===== 강제 동기화 완료 =====`);
    console.log('  → seevar 관리 페이지에서 해당 라운드가 포커스로 설정됐는지 확인하세요.');
  } catch (error) {
    console.error(`[${nowKST()}] ❌ 오류 발생:`, error);
    process.exit(1);
  }
}

forceSyncToday();
