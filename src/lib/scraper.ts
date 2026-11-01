import { api } from './api-client';
import { MatchStatus, RefereeRole } from './types';
import { findReversedScheduleMatch, findScheduleMatch } from './match-lookup';

// 로컬 검증 때 모의 서버로 바꿀 수 있도록 env로 덮어쓸 수 있게 둔다
const KLEAGUE_BASE_URL = process.env.KLEAGUE_BASE_URL?.replace(/\/$/, '') || 'https://www.kleague.com';
const KLEAGUE_TIMEOUT_MS = 15_000;

const monthlyScheduleCache = new Map<string, any[]>();

async function getLeagueScheduleList(
  year: string,
  month: string,
  leagueId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<any[]> {
  const key = `${year}-${month}-${leagueId}`;
  const cached = monthlyScheduleCache.get(key);
  if (cached && !options.forceRefresh) return cached;

  const response = await fetch(`${KLEAGUE_BASE_URL}/getScheduleList.do`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year, month, leagueId }),
    signal: AbortSignal.timeout(KLEAGUE_TIMEOUT_MS),
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
export function nowKST(date: Date = new Date()): string {
  return date.toLocaleString('sv-SE', {
    timeZone: 'Asia/Seoul',
    hour12: false,
  }).replace('T', ' ') + ' KST';
}

/** KST 기준 날짜를 K리그 일정 API 형식(YYYY.MM.DD)으로 만든다. */
export function kstDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).replace(/-/g, '.');
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
  refreshSource?: boolean;
}

export interface RefereeName {
  name: string;
  role: RefereeRole;
}

export interface MatchCards {
  homeYellowCards: number;
  homeRedCards: number;
  awayYellowCards: number;
  awayRedCards: number;
}

export interface MatchResult {
  gameStatus: string;
  /** null이면 아직 시작 전이라 seevar 상태를 건드리지 않는다 */
  status: MatchStatus | null;
  scoreHome: number;
  scoreAway: number;
  cards: MatchCards;
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

/** 항상 K리그에서 새로 받은 리그·월 단위 일정. 경기마다 심판(refreeName1~8), 스코어, gameStatus가 함께 들어 있다. */
export async function fetchScheduleList(year: string, month: string, leagueId: string): Promise<any[]> {
  return getLeagueScheduleList(year, month, leagueId, { forceRefresh: true });
}

export function findScheduleItem(list: any[], match: MatchInfo): any | undefined {
  return list.find((item) => String(item.gameId) === match.gameId && String(item.meetSeq) === match.meetSeq);
}

const REFEREE_FIELDS: Record<string, RefereeRole> = {
  'refreeName1': RefereeRole.MAIN,
  'refreeName2': RefereeRole.ASSISTANT,
  'refreeName3': RefereeRole.ASSISTANT,
  'refreeName4': RefereeRole.WAITING,
  'refreeName7': RefereeRole.VAR,
  'refreeName8': RefereeRole.VAR,
};

/** 일정 항목을 MatchInfo로 바꾼다. 날짜·시각을 해석할 수 없으면 null. */
export function toMatchInfo(item: any): MatchInfo | null {
  const startTime = parseKstMatchStartTime(String(item?.gameDate ?? ''), String(item?.gameTime ?? ''));
  if (!startTime) return null;

  return {
    year: String(item.year),
    leagueId: String(item.leagueId),
    gameId: String(item.gameId),
    meetSeq: String(item.meetSeq),
    roundNumber: parseInt(item.roundId, 10),
    gameStatus: String(item.gameStatus || ''),
    sourceRefereeCount: Object.keys(REFEREE_FIELDS).filter(
      (key) => typeof item[key] === 'string' && item[key].trim()
    ).length,
    homeTeamName: normalizeTeamName(item.homeTeamName),
    awayTeamName: normalizeTeamName(item.awayTeamName),
    startTime,
  };
}

export async function getTodayMatches(
  targetDate?: string,
  options: { strict?: boolean; refreshSource?: boolean } = {}
): Promise<MatchInfo[]> {
  try {
    const todayStr = targetDate || kstDateString();
    console.log(`[${nowKST()}] Checking matches for ${todayStr}...`);

    const [year, month] = todayStr.split('.');
    const matches: MatchInfo[] = [];

    for (const leagueId of ['1', '2']) {
      try {
        const scheduleList = await getLeagueScheduleList(year, month, leagueId, {
          forceRefresh: options.refreshSource,
        });
        for (const item of scheduleList) {
          if (item.gameDate !== todayStr) continue;
          const match = toMatchInfo(item);
          if (match) matches.push(match);
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

/** 일정 항목의 심판 명단. 주심(refreeName1)이 비어 있으면 아직 공개 전이라 빈 배열을 돌려준다. */
export function extractRefereeNames(item: any): RefereeName[] {
  const main = item?.refreeName1;
  if (typeof main !== 'string' || !main.trim()) return [];

  const referees: RefereeName[] = [];
  for (const [field, role] of Object.entries(REFEREE_FIELDS)) {
    const name = item[field];
    if (typeof name === 'string' && name.trim()) referees.push({ name: name.trim(), role });
  }
  return referees;
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

/** 심판 이름을 seevar 심판 ID로 바꿔 배정한다. 반영한 인원 수를 돌려준다. */
export async function pushRefereeAssignments(matchId: string, referees: RefereeName[]): Promise<number> {
  const assignments: { id: string; role: RefereeRole }[] = [];
  for (const { name, role } of referees) {
    const refereeId = await ensureReferee(name);
    // 같은 심판이 같은 역할로 두 번 들어가면 seevar API가 요청 전체를 거부한다
    if (refereeId && !assignments.some((a) => a.id === refereeId && a.role === role)) {
      assignments.push({ id: refereeId, role });
    }
  }

  if (assignments.length > 0) await api.assignReferees(matchId, assignments);
  return assignments.length;
}

export async function syncRefereeInfo(
  match: MatchInfo,
  options: SyncOptions = {}
): Promise<boolean> {
  try {
    const monthStr = getKstMonth(match.startTime ?? new Date());

    const scheduleList = await getLeagueScheduleList(match.year, monthStr, match.leagueId, {
      // Daily scheduling must see referee names published after the 02:22 schedule check.
      // Season backfill can opt out because it processes immutable historical rows.
      forceRefresh: options.refreshSource ?? true,
    });
    const refereeData = findScheduleItem(scheduleList, match);
    if (!refereeData) {
      throw new Error(`Match ${match.gameId} not found in schedule data.`);
    }

    console.log(`[${nowKST()}] Referee data for ${match.homeTeamName} vs ${match.awayTeamName} fetched.`);
    const referees = extractRefereeNames(refereeData);
    if (referees.length === 0) {
      console.log(`[${nowKST()}] No referees found in schedule API for ${match.homeTeamName} vs ${match.awayTeamName}`);
      return false;
    }

    const matchId = options.matchId ?? await getApiMatchId(match);
    if (!matchId) {
      throw new Error(`Could not find match ID for referee sync: ${match.homeTeamName} vs ${match.awayTeamName}`);
    }

    const count = await pushRefereeAssignments(matchId, referees);
    console.log(`[${nowKST()}] Successfully assigned ${count} referees to match ${matchId}`);
    return true;
  } catch (error) {
    if (options.strict) throw error;
    console.error(`[${nowKST()}] syncRefereeInfo error:`, error);
    return false;
  }
}

/** K리그 gameStatus를 seevar 상태로 바꾼다. 빈 값은 아직 시작 전이라 null. */
export function mapGameStatus(gameStatus: string): MatchStatus | null {
  if (!gameStatus) return null;
  if (gameStatus === 'FE') return MatchStatus.FINISHED;
  // FH(전반)·SH(후반) 말고 하프타임·연장 같은 코드가 와도 경기 중으로 본다
  return MatchStatus.LIVE;
}

/** 매치센터 데이터에서 상태·스코어·카드를 뽑는다. */
export async function fetchMatchResult(match: MatchInfo): Promise<MatchResult> {
  const postBody = new URLSearchParams({
    year: match.year,
    meetSeq: match.meetSeq,
    gameId: match.gameId,
    leagueId: match.leagueId
  });

  const matchInfoRes = await fetch(`${KLEAGUE_BASE_URL}/api/ddf/match/matchInfo.do`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: postBody.toString(),
    signal: AbortSignal.timeout(KLEAGUE_TIMEOUT_MS),
  });

  if (!matchInfoRes.ok) {
    throw new Error(`K League match info request failed: ${matchInfoRes.status} ${matchInfoRes.statusText}`);
  }
  const data = ((await matchInfoRes.json()) as any)?.data;

  const cards: MatchCards = { homeYellowCards: 0, homeRedCards: 0, awayYellowCards: 0, awayRedCards: 0 };
  // 연장 전·후반(EfirstHalf/EsecondHalf) 카드도 센다
  for (const half of ['firstHalf', 'secondHalf', 'EfirstHalf', 'EsecondHalf']) {
    const events = data?.[half];
    if (!Array.isArray(events)) continue;
    for (const ev of events) {
      if (ev.eventName === '경고') {
        if (ev.homeOrAway === 'HOME') cards.homeYellowCards++;
        else if (ev.homeOrAway === 'AWAY') cards.awayYellowCards++;
      } else if (ev.eventName === '퇴장') {
        if (ev.homeOrAway === 'HOME') cards.homeRedCards++;
        else if (ev.homeOrAway === 'AWAY') cards.awayRedCards++;
      }
    }
  }

  const gameStatus: string = data?.gameStatus ?? '';
  return {
    gameStatus,
    status: mapGameStatus(gameStatus),
    scoreHome: data?.homeGoal ?? 0,
    scoreAway: data?.awayGoal ?? 0,
    cards,
  };
}

export async function syncMatchResult(
  match: MatchInfo,
  options: SyncOptions = {}
): Promise<boolean> {
  try {
    console.log(`[${nowKST()}] Fetching match result API directly...`);
    const result = await fetchMatchResult(match);
    const { cards } = result;

    console.log(`[${nowKST()}] Scores extracted: ${result.scoreHome} - ${result.scoreAway}`);
    console.log(`[${nowKST()}] Cards extracted: Home(Y:${cards.homeYellowCards}, R:${cards.homeRedCards}), Away(Y:${cards.awayYellowCards}, R:${cards.awayRedCards})`);
    console.log(`[${nowKST()}] Match status: "${result.gameStatus}" → ${result.status ?? 'not started'}`);

    if (!result.status) {
      console.log(`[${nowKST()}] Match has not started yet. Skipping result sync.`);
      return false;
    }

    const matchId = options.matchId ?? await getApiMatchId(match);
    if (matchId) {
      await api.updateMatchResult(matchId, { scoreHome: result.scoreHome, scoreAway: result.scoreAway });
      await api.updateMatchStatus(matchId, result.status);
      console.log(`[${nowKST()}] Updating match ${matchId} status to: ${result.status}`);
      await api.updateMatchCards(matchId, cards);
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
