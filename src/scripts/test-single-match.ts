import { syncRefereeInfo, syncMatchResult, MatchInfo } from '../lib/scraper';
import { syncRoundAndMatch } from '../lib/round-service';

async function testMatch() {
  // 테스트하고 싶은 과거 경기 정보를 입력하세요
  const sampleMatch: MatchInfo = {
    year: '2026',
    leagueId: '1',
    gameId: '40',
    meetSeq: '1',
    roundNumber: 7, // 추가된 필드
    homeTeamName: '인천', // DB에 등록된 팀 명칭과 일치해야 합니다
    awayTeamName: '울산',
    startTime: new Date('2026-04-11T16:30:00')
  };

  console.log(`--- 테스트 시작: ${sampleMatch.homeTeamName} vs ${sampleMatch.awayTeamName} ---`);

  try {
    console.log('1. 라운드 포커스 및 경기 일정 동기화 테스트 중...');
    await syncRoundAndMatch(sampleMatch);
    console.log('라운드 포커스 동기화 완료.');

    console.log('2. 심판 정보 동기화 테스트 중...');
    await syncRefereeInfo(sampleMatch);
    console.log('심판 정보 동기화 완료.');

    console.log('2. 경기 결과(점수/카드) 동기화 테스트 중...');
    await syncMatchResult(sampleMatch);
    console.log('경기 결과 동기화 완료.');

    console.log('--- 테스트 종료 ---');
    console.log('API 서버(localhost:3000)를 확인하여 데이터가 정상적으로 반영되었는지 확인해주세요.');
  } catch (error) {
    console.error('테스트 중 오류 발생:', error);
  }
}

testMatch();
