import { api } from './api-client';
import { MatchStatus, RefereeRole } from './types';

/**
 * Returns a KST-formatted timestamp string for logging.
 * Example: "2026-04-15 02:22:04 KST"
 */
export function nowKST(): string {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Asia/Seoul',
    hour12: false,
  }).replace('T', ' ') + ' KST';
}

export interface MatchInfo {
  year: string;
  leagueId: string;
  gameId: string;
  meetSeq: string;
  roundNumber: number;
  startTime?: Date;
  homeTeamName: string;
  awayTeamName: string;
}

/**
 * Standardize external API team names to match the database exactly.
 */
export function normalizeTeamName(name: string): string {
  const norm = name.trim().toUpperCase();
  const map: Record<string, string> = {
    // English fallback
    'SEOUL': 'FC 서울',
    'FC SEOUL': 'FC 서울',
    'JEONBUK': '전북 현대 모터스',
    'JEJU': '제주 SK FC',
    'INCHEON': '인천 유나이티드',
    'DAEJEON HANA': '대전 하나 시티즌',
    'DAEJEON': '대전 하나 시티즌',
    'GANGWON': '강원 FC',
    'BUCHEON': '부천 FC 1995',
    'GIMCHEON': '김천 상무 FC',
    'BUSAN': '부산 아이파크',
    'GYEONGNAM': '경남 FC',
    'SUWON': '수원 삼성 블루윙즈',
    'DAEGU': '대구 FC',
    'CHEONAN': '천안 시티 FC',
    'GIMHAE': '김해 FC 2008',
    'ULSAN': '울산 HD FC',
    'POHANG': '포항 스틸러스',
    'GWANGJU': '광주 FC',
    'ANYANG': 'FC 안양',
    'SEONGNAM': '성남 FC',
    'GIMPO': '김포 FC',
    'ANSAN': '안산 그리너스 FC',
    'CHUNGBUK CHEONGJU': '충북 청주 FC',
    'CHUNGNAM ASAN': '충남 아산 FC',
    'ASAN': '충남 아산 FC',
    
    // Korean mapping to exact DB format
    '서울': 'FC 서울',
    '수원FC': '수원 FC',
    'SUWON FC': '수원 FC',
    '충북청주': '충북 청주 FC',
    '김해': '김해 FC 2008',
    '부천': '부천 FC 1995',
    '전북': '전북 현대 모터스',
    '제주': '제주 SK FC',
    '인천': '인천 유나이티드',
    '대전': '대전 하나 시티즌',
    '강원': '강원 FC',
    '김천': '김천 상무 FC',
    '부산': '부산 아이파크',
    '경남': '경남 FC',
    '수원': '수원 삼성 블루윙즈',
    '대구': '대구 FC',
    '천안': '천안 시티 FC',
    '울산': '울산 HD FC',
    '포항': '포항 스틸러스',
    '광주': '광주 FC',
    '안양': 'FC 안양',
    '성남': '성남 FC',
    '김포': '김포 FC',
    '안산': '안산 그리너스 FC',
    '충남아산': '충남 아산 FC'
  };

  return map[norm] || map[name.trim()] || name.trim();
}

/**
 * Maps scraped leagueId to API league slug.
 */
function mapLeagueIdToSlug(leagueId: string): string {
  // Mapping based on user's production server setting
  return leagueId === '1' ? 'k-league-1' : 'k-league-2';
}

/**
 * Helper to find match ID from API based on scraped info.
 */
async function getApiMatchId(match: MatchInfo): Promise<string | null> {
  const year = parseInt(match.year);
  const leagueSlug = mapLeagueIdToSlug(match.leagueId);
  const scheduleRes = await api.getSchedule(year, leagueSlug);
  
  const found = scheduleRes.matches.find(m => 
    (m.homeTeamName.includes(match.homeTeamName) || match.homeTeamName.includes(m.homeTeamName)) && 
    (m.awayTeamName.includes(match.awayTeamName) || match.awayTeamName.includes(m.awayTeamName))
  );
  
  return found?.id || null;
}

export async function getTodayMatches(targetDate?: string): Promise<MatchInfo[]> {
  try {
    // KST 기준 대상 날짜 설정 (서버 타임존이 KST로 설정된 경우)
    const nowKstDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const todayStr = targetDate || `${nowKstDate.getFullYear()}.${String(nowKstDate.getMonth() + 1).padStart(2, '0')}.${String(nowKstDate.getDate()).padStart(2, '0')}`;
    console.log(`[${nowKST()}] Checking matches for ${todayStr}...`);

    const parts = todayStr.split('.');
    const year = parts[0];
    const month = parts[1];
    
    const matches: MatchInfo[] = [];

    for (const leagueId of ['1', '2']) {
      try {
        const res = await fetch('https://www.kleague.com/getScheduleList.do', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Accept-Language': 'ko-KR,ko;q=0.9'
          },
          body: JSON.stringify({ year, month, leagueId })
        });
        const data = (await res.json()) as any;
        
        if (data?.data?.scheduleList) {
          for (const item of data.data.scheduleList) {
            if (item.gameDate === todayStr) {
              const [h, mi] = (item.gameTime || '').split(':').map((x: string) => parseInt(x, 10));
              if (!Number.isNaN(h) && !Number.isNaN(mi)) {
                const startTime = new Date(nowKstDate.getFullYear(), nowKstDate.getMonth(), nowKstDate.getDate(), h, mi);
                matches.push({
                  year: String(item.year),
                  leagueId: String(item.leagueId),
                  gameId: String(item.gameId),
                  meetSeq: String(item.meetSeq),
                  roundNumber: parseInt(item.roundId, 10),
                  homeTeamName: normalizeTeamName(item.homeTeamName),
                  awayTeamName: normalizeTeamName(item.awayTeamName),
                  startTime,
                });
              }
            }
          }
        }
      } catch (e) {
        console.error(e);
      }
    }

    console.log(`[${nowKST()}] Found ${matches.length} matches for ${todayStr}.`);
    return matches;
  } catch (err) {
    console.error(`[${nowKST()}] getTodayMatches error:`, err);
    return [];
  }
}

export async function syncRefereeInfo(match: MatchInfo) {
  try {
    const monthStr = String(match.startTime?.getMonth() !== undefined ? match.startTime.getMonth() + 1 : new Date().getMonth() + 1).padStart(2, '0');
    
    const res = await fetch('https://www.kleague.com/getScheduleList.do', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      },
      body: JSON.stringify({ 
        year: match.year, 
        month: monthStr, 
        leagueId: match.leagueId 
      })
    });
    const data = (await res.json()) as any;
    
    let refereeData: any = null;
    if (data?.data?.scheduleList) {
      refereeData = data.data.scheduleList.find((item: any) => String(item.gameId) === match.gameId && String(item.meetSeq) === match.meetSeq);
    }
    
    if (refereeData) {
      console.log(`[${nowKST()}] Referee data for ${match.homeTeamName} vs ${match.awayTeamName} fetched.`);
      const assignments: { id: string; role: RefereeRole }[] = [];
      const roleMap: Record<string, RefereeRole> = {
        'refreeName1': RefereeRole.MAIN,
        'refreeName2': RefereeRole.ASSISTANT,
        'refreeName3': RefereeRole.ASSISTANT,
        'refreeName4': RefereeRole.WAITING,
        'refreeName7': RefereeRole.VAR,
        'refreeName8': RefereeRole.VAR,
      };

      for (const [key, role] of Object.entries(roleMap)) {
        const name = refereeData[key];
        if (name && typeof name === 'string' && name.trim()) {
          const refereeId = await ensureReferee(name.trim());
          if (refereeId) assignments.push({ id: refereeId, role });
        }
      }

      if (assignments.length > 0) {
        const matchId = await getApiMatchId(match);
        if (matchId) {
          await api.assignReferees(matchId, assignments);
          console.log(`[${nowKST()}] Successfully assigned ${assignments.length} referees to match ${matchId}`);
        }
      } else {
        console.log(`[${nowKST()}] No referees found in schedule API for ${match.homeTeamName} vs ${match.awayTeamName}`);
      }
    } else {
      console.log(`[${nowKST()}] Match ${match.gameId} not found in schedule data.`);
    }
  } catch (error) {
    console.error(`[${nowKST()}] syncRefereeInfo error:`, error);
  }
}

async function ensureReferee(name: string): Promise<string | null> {
  const searchRes = await api.searchReferee(name);
  if (searchRes.referees.length > 0) {
    return searchRes.referees[0].id;
  }
  
  console.log(`Referee ${name} not found. Registering new...`);
  const registerRes = await api.registerReferee({ name });
  return registerRes.referee.id;
}

export async function syncMatchResult(match: MatchInfo) {
  try {
    console.log(`[${nowKST()}] Fetching match result API directly...`);
    const postBody = new URLSearchParams({
      year: match.year,
      meetSeq: match.meetSeq,
      gameId: match.gameId,
      leagueId: match.leagueId
    });

    const matchInfoRes = await fetch('https://www.kleague.com/api/ddf/match/matchInfo.do', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      },
      body: postBody.toString(),
    });
    
    const matchInfoData = (await matchInfoRes.json()) as any;
    
    const gameStatus: string = matchInfoData?.data?.gameStatus ?? '';
    const homeScore: number = matchInfoData?.data?.homeGoal ?? 0;
    const awayScore: number = matchInfoData?.data?.awayGoal ?? 0;

    let homeYellow = 0;
    let homeRed = 0;
    let awayYellow = 0;
    let awayRed = 0;

    const parseEvents = (events: any[]) => {
      if (!events || !Array.isArray(events)) return;
      for (const ev of events) {
        if (ev.eventName === '경고') {
          if (ev.homeOrAway === 'HOME') homeYellow++;
          else if (ev.homeOrAway === 'AWAY') awayYellow++;
        } else if (ev.eventName === '퇴장') {
          if (ev.homeOrAway === 'HOME') homeRed++;
          else if (ev.homeOrAway === 'AWAY') awayRed++;
        }
      }
    };

    parseEvents(matchInfoData?.data?.firstHalf);
    parseEvents(matchInfoData?.data?.secondHalf);

    console.log(`[${nowKST()}] Scores extracted: ${homeScore} - ${awayScore}`);
    console.log(`[${nowKST()}] Cards extracted: Home(Y:${homeYellow}, R:${homeRed}), Away(Y:${awayYellow}, R:${awayRed})`);

    const isFinished = gameStatus === 'FE';
    const isLive = gameStatus === 'SH' || gameStatus === 'FH';
    const apiStatus = isFinished ? MatchStatus.FINISHED : isLive ? MatchStatus.LIVE : MatchStatus.SCHEDULED;
    console.log(`[${nowKST()}] Match status: "${gameStatus}" → ${apiStatus}`);

    const matchId = await getApiMatchId(match);
    if (matchId) {
      await api.updateMatchResult(matchId, { scoreHome: homeScore, scoreAway: awayScore });
      await api.updateMatchStatus(matchId, apiStatus);
      console.log(`[${nowKST()}] Updating match ${matchId} status to: ${apiStatus}`);
      await api.updateMatchCards(matchId, {
        homeYellowCards: homeYellow,
        homeRedCards: homeRed,
        awayYellowCards: awayYellow,
        awayRedCards: awayRed,
      });
      console.log(`[${nowKST()}] Successfully synced result and cards for match ${matchId}`);
    } else {
      console.warn(`[${nowKST()}] Could not find match ID for result sync: ${match.homeTeamName} vs ${match.awayTeamName}`);
    }
  } catch (error) {
    console.error(`[${nowKST()}] syncMatchResult error:`, error);
  }
}
