import { api } from './api-client';
import { MatchStatus, RefereeRole } from './types';
import { findReversedScheduleMatch, findScheduleMatch } from './match-lookup';

const monthlyScheduleCache = new Map<string, any[]>();

async function getLeagueScheduleList(year: string, month: string, leagueId: string): Promise<any[]> {
  const key = `${year}-${month}-${leagueId}`;
  const cached = monthlyScheduleCache.get(key);
  if (cached) return cached;

  const response = await fetch('https://www.kleague.com/getScheduleList.do', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year, month, leagueId }),
  });
  if (!response.ok) {
    throw new Error(`K League schedule request failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as any;
  const list = Array.isArray(data?.data?.scheduleList) ? data.data.scheduleList : [];
  monthlyScheduleCache.set(key, list);
  return list;
}

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
  gameStatus?: string;
  sourceRefereeCount?: number;
  startTime?: Date;
  homeTeamName: string;
  awayTeamName: string;
}

export interface SyncOptions {
  strict?: boolean;
  matchId?: string;
}

/**
 * Parses a K League date/time pair as an absolute KST timestamp.
 * This intentionally does not depend on the crawler host's timezone or today's date.
 */
export function parseKstMatchStartTime(gameDate: string, gameTime: string): Date | null {
  const dateMatch = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(gameDate);
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(gameTime);
  if (!dateMatch || !timeMatch) return null;

  const [, year, month, day] = dateMatch;
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return null;

  const parsed = new Date(
    `${year}-${month}-${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getKstMonth(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
  }).format(date);
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
    'SUWON FC': '수원 FC',
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
    'SEOUL E-LAND': '서울 이랜드 FC',
    'JEONNAM': '전남 드래곤즈',
    'PAJU': '파주 프런티어 FC',
    'HWASEONG': '화성 FC',
    'YONGIN': '용인 FC',
    
    // Korean mapping to exact DB format
    '서울': 'FC 서울',
    '수원FC': '수원 FC',
    '충북청주': '충북 청주 FC',
    '청주': '충북 청주 FC',
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
    '수원삼성': '수원 삼성 블루윙즈',
    '대구': '대구 FC',
    '천안': '천안 시티 FC',
    '울산': '울산 HD FC',
    '포항': '포항 스틸러스',
    '광주': '광주 FC',
    '안양': 'FC 안양',
    '성남': '성남 FC',
    '김포': '김포 FC',
    '안산': '안산 그리너스 FC',
    '충남아산': '충남 아산 FC',
    '아산': '충남 아산 FC',
    '서울E': '서울 이랜드 FC',
    '서울 이랜드': '서울 이랜드 FC',
    '서울이랜드': '서울 이랜드 FC',
    '전남': '전남 드래곤즈',
    '파주': '파주 프런티어 FC',
    '화성': '화성 FC',
    '용인': '용인 FC'
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
export async function getApiMatchResolution(
  match: MatchInfo
): Promise<{ matchId: string | null; needsTeamSwap: boolean }> {
  const year = parseInt(match.year);
  const leagueSlug = mapLeagueIdToSlug(match.leagueId);
  const scheduleRes = await api.getSchedule(year, leagueSlug);
  const target = {
    roundNumber: match.roundNumber,
    homeTeamName: match.homeTeamName,
    awayTeamName: match.awayTeamName,
  };
  const found = findScheduleMatch(scheduleRes.matches, target);
  if (found) return { matchId: found.id, needsTeamSwap: false };

  const reversed = findReversedScheduleMatch(scheduleRes.matches, target);
  return { matchId: reversed?.id ?? null, needsTeamSwap: Boolean(reversed) };
}

export async function getApiMatchId(match: MatchInfo): Promise<string | null> {
  return (await getApiMatchResolution(match)).matchId;
}

export async function getTodayMatches(
  targetDate?: string,
  options: { strict?: boolean } = {}
): Promise<MatchInfo[]> {
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
        const scheduleList = await getLeagueScheduleList(year, month, leagueId);

        if (scheduleList.length > 0) {
          for (const item of scheduleList) {
            if (item.gameDate === todayStr) {
              const startTime = parseKstMatchStartTime(todayStr, String(item.gameTime || ''));
              if (startTime) {
                matches.push({
                  year: String(item.year),
                  leagueId: String(item.leagueId),
                  gameId: String(item.gameId),
                  meetSeq: String(item.meetSeq),
                  roundNumber: parseInt(item.roundId, 10),
                  gameStatus: String(item.gameStatus || ''),
                  sourceRefereeCount: [
                    'refreeName1',
                    'refreeName2',
                    'refreeName3',
                    'refreeName4',
                    'refreeName7',
                    'refreeName8',
                  ].filter((key) => typeof item[key] === 'string' && item[key].trim()).length,
                  homeTeamName: normalizeTeamName(item.homeTeamName),
                  awayTeamName: normalizeTeamName(item.awayTeamName),
                  startTime,
                });
              }
            }
          }
        }
      } catch (e) {
        if (options.strict) throw e;
        console.error(e);
      }
    }

    console.log(`[${nowKST()}] Found ${matches.length} matches for ${todayStr}.`);
    return matches;
  } catch (err) {
    if (options.strict) throw err;
    console.error(`[${nowKST()}] getTodayMatches error:`, err);
    return [];
  }
}

export async function syncRefereeInfo(
  match: MatchInfo,
  options: SyncOptions = {}
): Promise<boolean> {
  try {
    const monthStr = getKstMonth(match.startTime ?? new Date());
    
    const scheduleList = await getLeagueScheduleList(match.year, monthStr, match.leagueId);
    const refereeData = scheduleList.find(
      (item: any) => String(item.gameId) === match.gameId && String(item.meetSeq) === match.meetSeq
    );
    
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
        const matchId = options.matchId ?? await getApiMatchId(match);
        if (matchId) {
          await api.assignReferees(matchId, assignments);
          console.log(`[${nowKST()}] Successfully assigned ${assignments.length} referees to match ${matchId}`);
          return true;
        } else {
          throw new Error(`Could not find match ID for referee sync: ${match.homeTeamName} vs ${match.awayTeamName}`);
        }
      } else {
        console.log(`[${nowKST()}] No referees found in schedule API for ${match.homeTeamName} vs ${match.awayTeamName}`);
      }
    } else {
      throw new Error(`Match ${match.gameId} not found in schedule data.`);
    }
    return false;
  } catch (error) {
    if (options.strict) throw error;
    console.error(`[${nowKST()}] syncRefereeInfo error:`, error);
    return false;
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

export async function syncMatchResult(
  match: MatchInfo,
  options: SyncOptions = {}
): Promise<boolean> {
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
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: postBody.toString(),
    });
    
    if (!matchInfoRes.ok) {
      throw new Error(`K League match info request failed: ${matchInfoRes.status} ${matchInfoRes.statusText}`);
    }
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

    const matchId = options.matchId ?? await getApiMatchId(match);
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
      return true;
    } else {
      throw new Error(`Could not find match ID for result sync: ${match.homeTeamName} vs ${match.awayTeamName}`);
    }
  } catch (error) {
    if (options.strict) throw error;
    console.error(`[${nowKST()}] syncMatchResult error:`, error);
    return false;
  }
}
